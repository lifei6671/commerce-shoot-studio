# G0-T06 设计：trusted proxy、Request ID 与 CSRF 基线

## 1. 设计目标

在 G0-T05 已建立的 Gin Router 上补齐请求来源信任链。业务 Handler 出现前，服务端必须完成：

1. 服务端签发 Request ID 并贯通响应、错误体与完成日志；
2. 默认关闭 Gin 代理信任，只在显式 CIDR 命中时严格解析单跳 forwarded tuple；
3. 使用可信外部 Origin 执行 CORS 与标准库 `CrossOriginProtection`；
4. 为全部用户/管理业务 API 响应设置禁止缓存与 Cookie 缓存维度。

本任务不实现 Session、认证、限流、业务路由、健康检查、监听生命周期、Tracing 或 Metrics。

## 2. 已确认公共合同

### 2.1 trusted proxy

- 配置字段固定为 `security.trusted_proxy_cidrs`，显式空列表表示直连部署。
- 同一层 Ingress/LB 可以有多个出口 CIDR，但请求只允许一跳代理元数据。
- CIDR 必须是规范 IPv4/IPv6 network；拒绝重复、host bits、`0.0.0.0/0` 和 `::/0`。
- 非可信来源的所有 forwarded Header 均忽略，使用直连 RemoteAddr、TLS 和 Host。
- 可信代理访问业务 API 时，XFF/XFP/XFH 必须全部存在且各自只有一个合法值；缺失、多行、逗号链、
  空值或非法值统一返回 `403 + 100403`。
- 不支持 `Forwarded`、`X-Real-IP`、CDN 或供应商私有 Header。

### 2.2 Request ID

- Router 构造时使用 `crypto/rand.Reader` 一次读取 32 字节进程密钥；请求期使用
  HMAC-SHA256(process key, atomic sequence) 并截取 16 字节，编码为 32 位小写十六进制。
- 完全忽略入站 `X-Request-ID`，不复用、不回显、不记录。
- 构造期密钥读取失败阻止 Router 创建；请求期不访问熵源。不使用客户端值、时间戳、纯计数器、
  固定值或 `math/rand` 降级。

### 2.3 CSRF 与缓存

- 用户端和管理端分别使用一个 `net/http.CrossOriginProtection` 实例。
- trusted Origin 只能来自 G0-T05 已解析的对应 CORS policy，不增加配置或 bypass。
- 不签发 CSRF Token/Cookie，不增加 CSRF Header 或 OpenAPI 字段。
- `/api/v1` 与 `/api/admin/v1` 的全部成功/错误响应设置
  `Cache-Control: no-store, private` 和 `Vary: Cookie`。
- 静态资源、`/healthz`、`/readyz` 不属于该缓存规则；后续 SSE 显式覆盖自己的缓存合同。

## 3. 配置模型

`SecurityConfig` 增加 typed prefix 列表：

```go
type SecurityConfig struct {
    TrustedProxyCIDRs []netip.Prefix
    VerificationCode  VerificationCodeConfig
}
```

配置文档层使用 `*[]string` 区分“字段缺失”和“显式空列表”。构建时对每项执行：

1. 禁止空白和首尾空格；
2. `netip.ParsePrefix`；
3. 拒绝 `prefix.Addr().Is4In6()`，避免 mapped `/96` 绕过 IPv4 全网禁令；
4. `prefix == prefix.Masked()`，否则拒绝 host bits；
5. 拒绝 bits 为 0 的全网 prefix；
6. 用 `prefix.String()` 检查重复；
7. 返回新 slice，避免调用方后续修改影响运行配置。

模板把字段放在 `security.verification_code` 同级，并说明：默认空、只填真实 Ingress/LB 出口网段、
代理必须覆盖而不是追加 XFF。真实且被忽略的 `conf/app.yaml` 不读取、不改写。

## 4. Router 构造合同

G0-T05 的 `Options` 在 baseline 阶段直接收口，不保留旧兼容 wrapper：

```go
type Options struct {
    Logger              *slog.Logger
    DefaultBodyBytes    int64
    BodyLimitOverrides  map[RouteKey]int64
    UserAllowedOrigins  []string
    AdminAllowedOrigins []string
    TrustedProxyCIDRs   []netip.Prefix
    RegisterRoutes      func(user, admin *gin.RouterGroup)
}
```

- 删除仅为 G0-T06 预留的 `ExternalOrigin` 注入；可信外部 Origin 只能来自同一 proxy resolver。
- 删除旧 `RequestID func(context.Context) string`，不向生产 Options 暴露替换算法或返回任意 ID 的 seam。
- `New` 构造 Router 时固定用 `io.ReadFull(crypto/rand.Reader, key[:])` 读取一次 32 字节进程内密钥；
  package-private `newWithEntropy(options, io.Reader)` 只供同包测试注入 known-vector、short read 与
  error，不使用全局可变变量。
- 构造时复制 prefix 和 Origin 数据；调用方修改 slice 不影响运行策略。

`Options` 位于 Go `internal/` 包，当前没有外部调用方；本次是 baseline 收口，不保留 deprecated alias、
空 wrapper 或双轨兼容。

## 5. trusted proxy resolver

### 5.1 Gin 防御性设置

构造 Engine 后显式执行：

```text
ForwardedByClientIP = false
RemoteIPHeaders = nil
TrustedPlatform = ""
AppEngine = false
SetTrustedProxies(nil | canonical CIDR strings)
```

`SetTrustedProxies` 满足 Gin 自身安全配置，但业务不得调用 `Context.ClientIP()` 获取事实；Gin 原生算法
支持多跳和非法值回退，不符合本任务严格单跳合同。

### 5.2 一次性解析结果

`proxy.go` 定义 package-private typed metadata：

```go
type requestMetadata struct {
    clientIP       netip.Addr
    externalOrigin originInfo
    trustedProxy   bool
}
```

middleware 只解析一次并写入 request context。CORS、COP 和未来同包中间件只读该对象，不再次解析
Header。G0-T06 不提前导出尚无消费者的公共 accessor。

### 5.3 直连与代理路径

```text
RemoteAddr
  ├─ 不命中 trusted CIDR
  │    ├─ clientIP = direct peer IP
  │    └─ externalOrigin = Request.TLS + Request.Host
  └─ 命中 trusted CIDR
       ├─ 非业务 API：忽略 forwarded tuple，使用直连事实
       └─ 业务 API：严格解析单值 XFF + XFP + XFH
            ├─ 全部合法 → typed trusted metadata
            └─ 任一非法 → 403 + 100403
```

Header 使用 `Header.Values` 检测重复行；值中包含逗号即拒绝。XFF 使用 `netip.ParseAddr`，拒绝 zone，
再执行 `Unmap()`；RemoteAddr 同样 unmap 后再匹配 IPv4 prefix。XFP 只允许精确小写 `http` /
`https`；XFH 只允许规范 ASCII DNS/IP/localhost 和合法非默认端口，不允许 userinfo、scheme、path、
query、fragment、空白、控制字符或尾点。原始 XFH 必须与按 XFP 重建的 canonical authority 完全相等，
因此大写 DNS、默认端口和非规范 IPv6 表示均拒绝。

无论直连还是可信代理路径，resolver 在产生 typed metadata 后都删除 request 中全部
`X-Forwarded-*`、`Forwarded` 与 `X-Real-IP`，使下游无法误用原始代理输入；AST 守卫只作为辅助，
不声称能单独证明动态 Header 访问不存在。

直连 Host 同样使用现有 Origin parser 校验。无效 RemoteAddr/Host 属于 transport 来源错误，业务 API
统一 403，不把原值送入响应或日志。

## 6. Request ID 生命周期

Request ID generator 在 Router 构造时创建并由 runtime 私有持有：

```text
io.ReadFull(entropy, 32-byte process key)
  ├─ success → construct generator
  └─ short read/error → New returns error; router is unavailable
```

每个请求不再读取熵源，而是对原子递增的 `uint64` sequence 做大端编码，计算
`HMAC-SHA256(processKey, sequence)`，截取前 16 字节并编码成 32 位小写 hex。密钥只存在于进程内存，
不进入配置、日志、响应、Trace、Metrics 或持久化。

generator 只长期持有不可变 key 与 `atomic.Uint64`；每个请求新建独立 HMAC 实例，不跨请求共享
`hash.Hash`。递增 sequence 保证输入不重复，截断输出提供 128-bit 碰撞安全性，但不宣称数学硬唯一；
`uint64` 回绕超出首版单进程可达寿命，不增加复杂持久化或分布式序列。

Request ID 继续由最外层 request lifecycle/completion middleware 持有，避免下游替换 Request context
后污染完成日志。lifecycle 先设置 API Header baseline，再从 generator 取得无失败的下一 ID：

```text
append API Cache-Control/Vary baseline
  → atomic sequence
  → HMAC-SHA256 + truncate 16 bytes + lowercase hex
  → Gin typed context / logger.NewContext / response X-Request-ID
```

生产构造不得调用 Go 1.26 遇错会 runtime fatal 的 `crypto/rand.Read`；package-private 测试构造器
注入的 short read/error 必须作为 Router 构造错误返回。默认 Reader 自身的灾难性 runtime failure
仍遵循 Go runtime 语义，但故障只可能发生在 Router 初始化阶段，不存在请求期随机源降级。

签发成功后调用 `response.BindRequestID` 一次，统一错误 writer 改为从其私有 Gin context key 读取
Request ID，不再允许 caller 自由传入字符串：

```go
func BindRequestID(c *gin.Context, requestID string) error
func RequestID(c *gin.Context) string
func WriteError(c *gin.Context, err error) apperror.Code
```

`BindRequestID` 只接受 32 位小写 hex，重复绑定即使同值也快速失败；`RequestID` 缺失时只返回空值，
不生成。Bind API 仅允许 httpapi lifecycle 调用，并由 build contract 限制 owner。

lifecycle 保留本地 `logContext` 并在 `Next` 返回后使用该稳定值写完成日志，不从可能被 handler 替换的
`Request.Context()` 回读。HEAD、OPTIONS、403、404、405、413、500 与成功响应都保持同一 Header；
错误 JSON 同时使用同值。

## 7. `CrossOriginProtection` 装配

从已经完成规范化和防御性复制的 `corsPolicy.userOrigins/adminOrigins` 各构造一个标准库实例，并对
对应集合中的每个 canonical Origin 调用 `AddTrustedOrigin`。不从原始 Options slice 再构造第二份
信任事实。

采用 Gin middleware 调用 `Check`，不使用 `protection.Handler(engine)`：外层 Handler 会绕过 Gin
Request ID、CORS、统一 ErrorResponse 与完成日志，标准库默认拒绝体也不符合项目合同。

代理可能把外部 Host 改成内部 Host。缺少 `Sec-Fetch-Site` 时，标准库只比较 `Origin.Host` 与
`Request.Host`，因此检查前创建 request 浅副本，仅把副本 Host 替换为 typed external authority；
不修改下游真实 request，也不直接读取 XFH。

标准库行为保持原样：

- GET/HEAD/OPTIONS 通过 COP，之后 HEAD/普通 OPTIONS 仍由 G0-T05 method guard 返回 405；
- `Sec-Fetch-Site: same-origin|none` 通过；
- same-site/cross-site 只有精确命中本 surface trusted Origin 才通过；
- 缺少 Fetch Metadata 时，同 external Host 或精确 trusted Origin 通过；
- Origin 与 Fetch Metadata 都缺少时按标准库非浏览器边界通过，完整 Session 验收留 G2-T03。

`Check` 返回错误时忽略错误文本，统一写 `403 + 100403` 并中止。

## 8. Middleware 顺序

```text
request
  → request lifecycle / completion
       ├─ API response Header baseline（Cache-Control + Cookie/Origin/OPTIONS Vary）
       └─ Request ID + stable fresh logging context
  → safe recovery
  → trusted proxy resolver
  → CORS（使用 typed external Origin）
  → CrossOriginProtection
  → method guard
  → body limit
  → handler / NoRoute
  → exactly one completion log
```

该顺序保证：

- Router 初始化成功后，任何早期拒绝都有 Request ID、缓存 Header 和完成日志；
- recovery 覆盖 proxy/CORS/COP/method/body/handler 的 panic；lifecycle 仅执行受控无失败的 API
  Header baseline、HMAC Request ID 生成与日志合同；
- CORS 先验证同站并为允许 Origin 的 CSRF 错误附加可读 Header；
- COP 不会把配置中语法合法但跨站的 Origin 变成独立豁免；
- body 在所有来源与方法检查通过前不被读取。

## 9. 缓存与 `Vary`

lifecycle 内的 response Header baseline stage 只按精确 API surface 生效：

```text
Cache-Control: no-store, private
Vary: Cookie
Vary: Origin
```

OPTIONS 还预先追加 `Access-Control-Request-Method` 与 `Access-Control-Request-Headers`。继续复用
大小写不敏感的 `appendVary`；CORS 可再次追加并由 helper 去重，不得 Set 或删除既有 `Cookie`。
拒绝响应清理的只有 `Access-Control-Allow-*`，不清理 Cache-Control、Vary 或 X-Request-ID。

## 10. Build contract

扩展 G0-T05 HTTP AST/源码守卫：

- resolver 成功后删除全部 forwarded/X-Real-IP 输入；Header 字面量只允许出现在
  `internal/httpapi/proxy.go` 与测试，AST 规则作为纵深防御；
- 禁止生产代码调用 `gin.Context.ClientIP()`、启用 Gin forwarded shortcut 或 TrustedPlatform；
- 禁止 `CrossOriginProtection.Handler`、`AddInsecureBypassPattern`、第二套 trusted-origin 配置；
- 禁止 CSRF 专用 Token/Cookie/Header（例如 `X-CSRF-Token`）、对应配置/DTO/OpenAPI 合同；不得以
  通用 `Cookie` / `Header` 字面量扫描误伤 Session 与 `Vary: Cookie`；
- Request ID 生产实现禁止 `math/rand`、时间戳、纯计数器输出和入站 Header；原子计数器只允许作为
  HMAC 的进程内唯一输入；
- 禁止生产调用 `crypto/rand.Read`；entropy seam 只能存在于 package-private 测试构造路径；
- 进程密钥禁止进入配置、响应、日志、Trace、Metrics 或持久化；
- 禁止跨请求缓存/共享可变 `hash.Hash`；每次生成必须创建独立 HMAC 实例；
- `response.BindRequestID` 只允许 lifecycle 调用，`WriteError` 不接受自由 request ID 参数；
- `response.RequestID` 只读取生命周期已绑定值，完成日志不得从下游可变 Request context 回读身份；
- response Header baseline stage 只能作用于两个 API surface，Vary 必须追加而不是覆盖；
- 每条静态规则提供 bad fixture，避免空树或字符串自证。

## 11. 文档与范围

实现同批更新技术方案、实施清单、`http-guidelines.md`、backend index/directory/config/logging/openapi
所有权说明和本任务证据。真实配置、README、Makefile、OpenAPI paths/generated DTO、Desktop/Web UI、
数据库与依赖文件不在本任务范围。
