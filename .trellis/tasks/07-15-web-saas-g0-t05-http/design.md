# G0-T05 设计：Gin 路由与 HTTP 边界

## 1. 设计目标

本设计只建立 HTTP transport 底座，不创建业务 operation，也不启动监听器。边界必须在业务 Handler
出现前解决：统一错误、CORS、方法限制、body/header/timeout、panic recovery、低基数完成日志，以及
后续 G0-T06/G0-T07 可组合的构造合同。

已确认覆盖旧方案中的“CORS 默认关闭、OPTIONS 一律 405”：默认仍是空白名单和同源部署，但允许用户端
与管理端分别配置同站跨 Origin 前端，合法浏览器预检返回 204。

## 2. 依赖与所有权

### 2.1 已批准依赖

- `github.com/gin-gonic/gin v1.12.0`：仅 HTTP transport 包和统一响应包导入。
- `golang.org/x/net v0.51.0/publicsuffix`：仅用于 schemeful-site/eTLD+1 判断；不自行猜测公共后缀。
- 不直接使用 Gin 间接带入的 validator；当前 OpenAPI 没有业务 request DTO，不提前加入 DTO 校验器。

依赖只能通过 Go 命令写入 `go.mod/go.sum`，且由单一 owner 串行执行。

### 2.2 包结构

```text
server/
├── conf/app.yaml.example
├── internal/
│   ├── config/                 # HTTP/CORS 启动配置与严格校验
│   ├── httpapi/                # Gin router 与全部入站 middleware
│   ├── httpserver/             # 只构造 http.Server，不监听
│   └── buildcontract/          # 依赖、导入和禁用调用守卫
└── lib/
    ├── apperror/               # 新增 100403/100404
    ├── logger/                 # 固定 method=OTHER
    └── response/               # ErrorResponse 唯一写出入口
```

`httpapi` 避免与标准库 `net/http` 同名。业务 Service、Repository、generated DTO、OpenAPI schema 不
依赖 Gin。

## 3. 配置模型

`config.Config` 增加 `HTTP HTTPConfig`：

```go
type HTTPConfig struct {
    ReadHeaderTimeout   time.Duration
    ReadTimeout         time.Duration
    WriteTimeout        time.Duration
    IdleTimeout         time.Duration
    MaxHeaderBytes      int
    DefaultJSONBodyBytes int64
    CORS                CORSConfig
}

type CORSConfig struct {
    UserAllowedOrigins  []string
    AdminAllowedOrigins []string
}
```

完整 `app.yaml` 必须显式提供所有字段；所谓默认值仅指 `app.yaml.example` 展示的推荐值，不调用
Viper defaults，不合并模板，不允许缺字段后静默补值。

校验规则：

- 四类 timeout、header/body limit 必须为正数，并精确保留已冻结值。
- Origin 只接受规范的绝对 `http`/`https` Origin；禁止 userinfo、path、query、fragment、wildcard、
  `null`、空 host、尾点、非 ASCII host 和非规范默认端口。
- scheme 与 hostname 归一化为小写；默认端口省略，非默认端口保留；同组重复项拒绝。
- 配置阶段只做语法和重复校验。是否与当前 API 同一 schemeful site 依赖请求的外部 Origin，在
  middleware 运行时校验；G0-T06 后续提供基于 trusted proxy 的外部 Origin 解析。
- 两组 slice 在配置与 Router 构造边界都复制，调用方后续修改不得改变运行中策略。

## 4. Router 构造合同

建议最小签名：

```go
type RouteKey struct {
    Method   string
    Template string
}

type Options struct {
    Logger                 *slog.Logger
    DefaultBodyBytes       int64
    BodyLimitOverrides     map[RouteKey]int64
    UserAllowedOrigins     []string
    AdminAllowedOrigins    []string
    RequestID              func(context.Context) string
    ExternalOrigin         func(*http.Request) (string, error)
    RegisterRoutes         func(user, admin *gin.RouterGroup)
}

func New(options Options) (*gin.Engine, error)
```

约束：

- 使用 `gin.New()`，显式装配 middleware；禁止 `gin.Default/Logger/Recovery`。
- 关闭 `RedirectTrailingSlash`；未精确匹配的 API 路径必须进入统一 NoRoute，不允许框架生成 301/307。
- 建立 `/api/v1` 与 `/api/admin/v1` Group。`RegisterRoutes=nil` 合法，G0-T05 本身不注册业务路由。
- `RequestID=nil` 时返回空值；G0-T05 不读 `X-Request-ID`。G0-T06 提供可信读取函数并写响应 Header。
- `ExternalOrigin=nil` 时仅用直连 `Request.TLS + Request.Host` 解析，不读 `X-Forwarded-*`；G0-T06
  后续注入可信代理解析函数。
- body override 只允许 GET/POST、正数 byte 值和两个 API 前缀下的精确 Gin template；构造后复制
  map。注册完成后核对 override 指向真实 route，拼写错误快速失败。

## 5. Middleware 顺序与数据流

```text
request
  → method 低基数归一化
  → logging（最外层，fresh typed context，defer 一条完成日志）
  → safe recovery
  → CORS（合法预检在此 204 终止）
  → method guard
  → body limit
  → registered handler / NoRoute
  → response status + safe error code
  → logging completion
```

### 5.1 Logging

- 已冻结九种方法记录真实名称；其余方法统一记录 `OTHER`，绝不记录 raw method。
- registered route 使用 Gin template；NoRoute/guard 使用固定低基数模板：
  `/api/v1/{unmatched}`、`/api/admin/v1/{unmatched}`、`/{unmatched}`。
- 从可信 `RequestID` 函数读取 ID，传给 `logger.NewContext`；完成时仅调用
  `logger.LogRequestComplete`。
- `response` 在 Gin context 中只保存整数 error code，日志不接触原始 error。
- `LogRequestComplete` 理论失败时只写固定无参数内部故障消息，不拼接返回错误；构造期和测试保证
  method/template/status/elapsed 合法。

### 5.2 Recovery

- recovery 位于 logging 内层，捕获 panic 但不记录 panic 值或 stack。
- 响应未提交：写 `500 + 100500` 统一 JSON。
- 响应已提交：不覆盖、不追加 JSON、不缓存整份响应；只标记内部 `100500` 供完成日志使用。
- 任何分支都只产生一条请求完成日志。

### 5.3 CORS

API surface 先由精确前缀判定，`/api/v11` 不能误匹配 `/api/v1`。

Origin 处理：

- 无 Origin：视作非 CORS 请求，继续处理。
- `Origin: null` 或语法非法：`403 + 100403`，不返回 allow Header。
- 同源 Origin：继续处理；空白名单也允许。
- 跨 Origin：必须同时满足对应 user/admin 精确白名单与同一 schemeful site。
- schemeful site 使用 scheme + eTLD+1；IP/localhost 使用 scheme + exact host，端口不参与 site，
  但参与 Origin 精确匹配。
- G0-T05 不启用 `SameSite=None`，真正跨站 Origin 即使误配也在运行时拒绝。

合法预检必须有 `Origin` 与 `Access-Control-Request-Method`；请求 Header 列表可缺省。Header 名按
ASCII 大小写不敏感校验，允许集合固定为 `Content-Type`、`Idempotency-Key`。

| 场景 | 结果 |
| --- | --- |
| 合法 OPTIONS 预检 | 204，空 body，Allow/ACAO/credentials/methods/headers/max-age/Vary |
| 非法 Origin/method/header | 403 + 100403，无任何 allow Header |
| 普通/缺字段 OPTIONS | 405 + 100405 |
| 白名单普通 GET/POST（含 4xx/5xx） | 回显 Origin、credentials、Expose X-Request-ID |
| 非白名单普通跨域请求 | 403 + 100403 |

所有 API 响应追加 `Vary: Origin`，OPTIONS 再追加两个预检请求 Header 维度；只追加、按大小写不敏感
去重，绝不覆盖后续 Session 的 `Vary: Cookie`。拒绝响应保留 Vary，但不返回 allow Header。

### 5.4 Method guard

- GET/POST 继续路由。
- OPTIONS 只有已被 CORS 识别的合法预检成功；其他 OPTIONS 返回 405。
- PUT/PATCH/DELETE/CONNECT/TRACE 与任意其他方法返回 `405 + 100405`。
- HEAD 返回 405、Allow/CORS，真实线路 body 为空；错误码仅进入完成日志，不新增私有 Header。
- `Allow` 固定 `GET, POST, OPTIONS`。
- `http.Server.DisableGeneralOptionsHandler=true`，避免 `OPTIONS *` 被标准库提前返回 200。

### 5.5 Body limit 与绑定

- 已知 `Content-Length > limit` 时在 handler 前快速返回 413。
- 所有请求体用 `http.MaxBytesReader` 包装，不预读、不缓存、不记录 body。
- chunked/未知长度只能在读取时识别；统一 `BindJSON` 必须在任何业务副作用前完整绑定。
- `BindJSON` 只接受一个 JSON 值并继续读取至 EOF；第二个值或任何导致超限的尾随字节必须拒绝。
- `BindJSON` 对 `*http.MaxBytesError` 返回 413，其余 JSON 绑定错误返回 400。
- route override 通过 `method + c.FullPath()` 查询；未匹配 route 使用默认 1 MiB。

## 6. 统一错误响应

`lib/response` 建议合同：

```go
func WriteError(c *gin.Context, requestID string, err error) apperror.Code
func ErrorCode(c *gin.Context) apperror.Code
```

映射顺序：

1. wrapped `*http.MaxBytesError` → `100413/413`；
2. wrapped `*apperror.Error` → catalog status/code/message；
3. 其他 error → `100500/500`。

唯一 JSON 类型为 generated `ErrorResponse`。不得使用 `gin.H`、第二套 DTO、`err.Error()`、cause、
panic、SQL、路径、Prompt、Header 或 body。HEAD 只写 status 并记录 error code。

## 7. `http.Server` 构造

```go
type Options struct {
    Address           string
    Handler           http.Handler
    Logger            *slog.Logger
    ReadHeaderTimeout time.Duration
    ReadTimeout       time.Duration
    WriteTimeout      time.Duration
    IdleTimeout       time.Duration
    MaxHeaderBytes    int
}

func New(options Options) (*http.Server, error)
```

- 空地址、nil handler/logger、非正 timeout/header limit 快速失败。
- 精确设置四类 timeout、header limit、handler 与 `DisableGeneralOptionsHandler=true`。
- `ErrorLog` 使用安全 writer：忽略标准库提供的原始文本，只向已注入 slog 写固定消息，防止未来
  G0-T07 Serve 时回退到默认 stderr 或泄漏 TLS/连接错误细节。
- 不调用 Listen/Serve/Shutdown，不创建 goroutine，不处理 signal/readiness/drain。

## 8. Build contract

AST/模块守卫至少覆盖：

- Gin v1.12.0、x/net v0.51.0 是直接依赖，无 replace。
- Gin import 只出现在 `internal/httpapi`、`lib/response`。
- 禁止 `gin.Default/Logger/Recovery`、`gin.H`、`engine.Run`、全局 `http.TimeoutHandler`。
- `gin.New()` 只在 router 构造；生产代码没有占位 GET/POST/Any/Handle/Match 业务注册。
- 只有 generated `ErrorResponse`；HTTP 生产代码不把 `.Error()` 写入响应或日志。
- G0-T05 不出现 Listen/Serve/Shutdown/signal/goroutine；规则在 G0-T07 由所属任务调整。
- 每项源码扫描守卫都有 bad fixture，避免空树自证。

## 9. 文档同步

实现同批更新：

- 技术方案中三处 OPTIONS 405、CORS 默认关闭/同域限定及安全章节。
- G0-T05/G0-T06 checklist 交付物与证据边界。
- `error-handling.md` 追加经 G0-T05 批准的 100403/100404。
- 新建 active `http-guidelines.md`；更新 backend index、OpenAPI request ID 所有权、logging 所有权。
- 实现落地后才按真实文件更新 directory structure，不提前写占位目录。

## 10. 明确不做

- OpenAPI operation/generated DTO 变更、业务 Handler、validator DTO 规则。
- request ID 生成/Header、trusted proxy、CrossOriginProtection、Session Cookie。
- listen/lifecycle/readiness/drain/shutdown、health、SPA、metrics、tracing。
- 上传/SSE 的最终专用 body 与流式 deadline。
