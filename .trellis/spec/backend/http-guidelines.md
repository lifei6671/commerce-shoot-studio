# HTTP 边界规范

> G0-T05 已落地的 Gin、CORS、统一错误、请求体限制与 `http.Server` 可执行合同。

## 场景：建立 Web SaaS Gin 入站边界

### 1. Scope / Trigger

- 新增或修改 Gin router、middleware、HTTP 错误响应、body limit、CORS、panic recovery、入站日志
  或 `http.Server` 构造时触发。
- OpenAPI 业务 operation 仍只允许 GET/POST；OPTIONS 预检属于 transport，不进入 OpenAPI。
- G0-T05 不拥有业务 Handler、request ID 生成、trusted proxy、CrossOriginProtection、监听和生命周期。

### 2. Signatures

```go
type RouteKey struct {
    Method   string
    Template string
}

type Options struct {
    Logger             *slog.Logger
    DefaultBodyBytes   int64
    BodyLimitOverrides map[RouteKey]int64
    UserAllowedOrigins []string
    AdminAllowedOrigins []string
    RequestID          func(context.Context) string
    ExternalOrigin     func(*http.Request) (string, error)
    RegisterRoutes     func(user, admin *gin.RouterGroup)
}

httpapi.New(httpapi.Options) (*gin.Engine, error)
response.WriteError(c *gin.Context, requestID string, err error) apperror.Code
httpapi.BindJSON(c *gin.Context, target any) error
httpserver.New(httpserver.Options) (*http.Server, error)
```

### 3. Contracts

- 只使用 `gin.New()`；禁止默认 Gin Logger/Recovery、`engine.Run()` 和全局 `http.TimeoutHandler`。
- 中间件顺序固定：method 归一化 → logging → safe recovery → CORS → method guard → body limit →
  handler/NoRoute。
- 用户 API `/api/v1` 与管理 API `/api/admin/v1` 使用独立 Origin 白名单，默认空列表只允许同源。
- 白名单 Origin 必须精确匹配且与 API 同一 schemeful site；使用 `publicsuffix` 判断 eTLD+1，禁止
  通过域名最后两段猜测。IP/localhost 使用相同 scheme + exact host。
- 合法预检返回 204；非法 Origin/method/header 返回 `403 + 100403`；普通 OPTIONS 返回
  `405 + 100405`。允许 headers 只有 Content-Type、Idempotency-Key；credentials=true，max-age=600。
- PUT/PATCH/DELETE/CONNECT/TRACE 和其他非标准方法返回 `405 + 100405`；HEAD 返回 405 且线路
  body 为空。非标准方法日志统一为 `OTHER`。
- 默认 JSON body 上限 1048576 字节；已知长度快速拒绝，chunked/未知长度在统一 BindJSON 读取时
  识别。BindJSON 必须完整消费请求体，只允许一个 JSON 值，尾随数据也受同一上限约束。任何业务
  副作用必须发生在绑定成功之后。
- Gin 的尾斜杠自动重定向必须关闭；未精确匹配的 GET/POST 始终进入统一 404，不生成框架 301/307。
- 统一错误只实例化 generated `ErrorResponse`。raw error、panic、stack、路径、query、body、Header、
  Prompt、SQL 和 secret 不进入响应或日志。
- request ID 只从可信注入函数消费。G0-T06 负责生成/响应 Header，并提供 trusted external Origin；
  CORS 与 CrossOriginProtection 复用同一 typed 白名单。
- `http.Server` 固定 read-header/read/write/idle 为 5s/30s/5m/60s，header 上限 32768，关闭标准库
  General OPTIONS Handler，且只构造不监听。

### 4. Validation & Error Matrix

| 条件 | HTTP/行为 |
| --- | --- |
| wrapped `apperror.Error` | 使用 catalog status/code/safe message |
| `http.MaxBytesError` | 413 / 100413 |
| JSON 绑定失败 | 400 / 100400 |
| 未知错误或未提交响应 panic | 500 / 100500 |
| GET/POST 未匹配 API 路由 | 404 / 100404 |
| 非法 CORS 或 G0-T06 来源拒绝 | 403 / 100403，无 allow Header |
| 合法 CORS 预检 | 204，空 body，固定 allow/vary/cache Header |
| 普通 OPTIONS | 405 / 100405 |
| HEAD | 405，空 body，完成日志 error_code=100405 |
| 非标准方法 | 405 / 100405，日志 method=OTHER |
| 配置 wildcard/null/path/query/fragment/userinfo/cross-site | 拒绝配置或请求，不回显原值 |

所有 API 响应都必须追加 `Vary: Origin`；OPTIONS 还必须追加
`Access-Control-Request-Method` 与 `Access-Control-Request-Headers`。追加时按大小写不敏感去重，
不得覆盖 Session 的 `Vary: Cookie`。允许 Origin 的 4xx/5xx 也必须携带对应 CORS Header，使浏览器
能读取统一错误体；拒绝响应不携带任何 `Access-Control-Allow-*`。

### 5. Good/Base/Bad Cases

- Good：`https://app.example.com` 访问 `https://api.example.com`，用户白名单精确命中且同站，预检
  204，实际响应回显该 Origin；管理白名单不因此放行。
- Base：空白名单、无 Origin 的同源请求正常处理；GET 未匹配返回 404/100404。
- Bad：`https://attacker.example.net`、`Origin: null`、Authorization 预检、跨组 Origin 或 raw
  `PROPFIND-secret` 均被拒绝，攻击者值不进入最终 writer。

### 6. Tests Required

- config：完整字段、严格类型、origin 语法/规范化/重复/marker 不泄漏、slice 防御性复制。
- response：wrapped errors、MaxBytes、未知错误、HEAD、generated DTO 唯一性、恶意 marker。
- CORS：204/403/405、header 大小写和可选列表、schemeful site、public suffix、用户/管理隔离、Vary。
- method/body：OPTIONS star、真实 HEAD 线路、OTHER、Content-Length/chunked、route override、无副作用。
- recovery/logging：已提交/未提交 panic、状态级别、恰好一条完成日志、并发 request ID 隔离、Race。
- server/build contract：timeout/header、DisableGeneralOptionsHandler、安全 ErrorLog、禁用 API/导入边界。
- 所有定向和 Race 测试显式 `-timeout=60s`；不以 mock body 或 `ResponseRecorder` 冒充真实 HEAD 线路。

### 7. Wrong vs Correct

#### Wrong

```go
engine := gin.Default()
engine.Use(corsWithWildcardAndCredentials())
log.Info(request.URL.String(), "error", err)
```

#### Correct

```go
engine := gin.New()
// 显式装配固定顺序的安全 middleware；只记录 route template 与整数错误码。
engine.Use(logging, recovery, cors, methodGuard, bodyLimit)
```

## 设计决策

- 默认同源、可配置同站跨 Origin，而不是任意跨站；因此不启用 `SameSite=None`。
- 用户端与管理端白名单分离，防止普通前端 Origin 自动获得管理 API 跨域能力。
- route body override 使用服务端 method+template 注册，不接受客户端或任意动态输入。
- HEAD 遵循线路空 body 语义，错误码只进入完成日志；不发明私有错误 Header。
- raw 非标准方法归一化为 `OTHER`，维持日志低基数并避免攻击者控制字段。
