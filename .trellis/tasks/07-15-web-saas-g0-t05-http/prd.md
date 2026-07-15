# 建立 Gin 路由与 HTTP 边界

## Goal

在不虚构业务 operation、不启动监听器的前提下，为 Web SaaS Go 服务建立可复用、可测试的 Gin
HTTP 边界：用户/管理 API 前缀、统一安全错误、方法限制、请求体上限、panic recovery、入站完成
日志以及 `http.Server` timeout 构造合同，为 G0-T06/G0-T07 和后续业务 Handler 提供稳定底座。

## Background

- G0-T03 已冻结整数应用错误，G0-T04 已生成唯一 `ErrorResponse` DTO，G0-T09 已提供 typed
  logging context；G0-T05 的前置依赖已满足。
- Gin 精确版本 `v1.12.0` 已在 DS0-02 批准。实现必须使用 `gin.New()`，不得使用会输出原始路径
  或 panic 信息的 `gin.Default()`、默认 Logger/Recovery。
- OpenAPI 当前仍为 `paths: {}`。本任务只能建立注册边界和测试路由，不得添加占位业务 operation、
  手写第二套 HTTP DTO 或生成 Gin server wrapper。
- 用户 API 前缀为 `/api/v1`，管理 API 前缀为 `/api/admin/v1`。业务 operation 只允许 GET/POST；
  OPTIONS 用于浏览器 CORS 预检；PUT/PATCH/DELETE/HEAD/CONNECT/TRACE 必须返回 405 和整数错误码。
- trusted proxy、request ID 生成与响应 Header、CrossOriginProtection 中间件属 G0-T06；但
  CrossOriginProtection 必须复用 G0-T05 冻结的用户端/管理端来源白名单。进程装配、监听、
  readiness、drain/shutdown 属 G0-T07；Metrics/Tracing 属 G0-T10；SPA/health 属 G0-T11。

## Requirements

### R1 依赖与分层

- 通过 Go 命令精确加入直接依赖 `github.com/gin-gonic/gin v1.12.0`，不得手工修改 `go.sum`。
- 通过 Go 命令将 Gin v1.12.0 已间接使用的 `golang.org/x/net v0.51.0` 提升为直接依赖，仅使用
  `publicsuffix` 做 schemeful-site/eTLD+1 校验；不得用“域名最后两段”猜测公共后缀。
- Gin 只能出现在 HTTP 边界包和 `lib/response`；Service、Repository、`lib/apperror`、配置和
  OpenAPI generated DTO 不得依赖 Gin。
- `lib/response` 是唯一统一错误 JSON 写出入口，必须复用 generated `ErrorResponse`。

### R2 路由与方法边界

- 使用 `gin.New()` 建立用户/管理 API 注册边界，不注册尚未进入 OpenAPI 的业务路由。
- 两个 API 前缀下 GET/POST 未匹配请求走统一 NoRoute；采用 API 前缀级方法守卫，使
  PUT/PATCH/DELETE/HEAD/CONNECT/TRACE 在 OpenAPI 仍为空时也稳定返回 405，而不是依赖尚不存在的
  具体路由。
- HEAD 遵循 HTTP 线路语义：返回 405、`Allow: GET, POST, OPTIONS` 和适用的 CORS Header，但
  响应体为空；完成日志记录 `error_code=100405`，不新增私有错误码 Header。其他禁用方法继续返回
  统一 `ErrorResponse` JSON。
- OPTIONS 必须受控处理浏览器 CORS 预检：只允许配置命中的来源和冻结后的 method/header 集合；
  非法来源或非法预检请求不得返回允许跨域的 Header。
- CORS 来源按 `scheme + host + port` 精确匹配显式白名单，禁止 `*` 与 `Origin: null`；命中时
  回显具体 `Access-Control-Allow-Origin`、设置 `Vary: Origin`，并返回
  `Access-Control-Allow-Credentials: true` 以支持 Session Cookie。
- 第一版只允许与 API 外部 Origin 属于同一 schemeful site 的跨 Origin 前端，例如同一站点下的
  `app`/`admin`/`api` 子域或本地开发的不同端口；不支持第三方网站跨站携带 Session Cookie，
  不在本任务或 G0-T06/G2 启用 `SameSite=None`。
- `/api/v1` 只使用 `http.cors.user_allowed_origins`，`/api/admin/v1` 只使用
  `http.cors.admin_allowed_origins`，两组不得隐式合并；空列表表示仅允许同源请求。来源不得包含
  path、query、fragment、userinfo 或通配符。
- G0-T06 的用户端/管理端 `CrossOriginProtection` 必须分别复用对应白名单，禁止再维护第二套可信
  Origin 配置。
- 非法 CORS Origin、method 或 request header 固定返回 `403 + 100403`，且不得附加任何
  `Access-Control-Allow-*` Header。
- 合法预检固定返回 `204 No Content` 和空 body；`Allow` 为 `GET, POST, OPTIONS`，
  `Access-Control-Allow-Methods` 为 `GET, POST`，允许的非简单请求 Header 仅为 `Content-Type`、
  `Idempotency-Key`，不允许 `Authorization`。`Origin` 与 `Access-Control-Request-Method` 必填；
  `Access-Control-Request-Headers` 可缺省，存在时按逗号拆分、去除 OWS 并按 ASCII 大小写不敏感
  规则校验为允许 Header 的子集。
- 预检缓存固定 `Access-Control-Max-Age: 600`；预检响应设置
  `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`。普通白名单跨域
  GET/POST 也返回匹配的 allow-origin/credentials，并暴露 G0-T06 将写入的 `X-Request-ID`。
- CORS 只能向 `Vary` 追加并去重，禁止覆盖既有 `Vary: Cookie` 等缓存维度；白名单 Origin 的
  普通响应包括 4xx/5xx 都必须保留允许跨域的响应 Header，使浏览器可读取统一错误体。
- 所有 API 响应追加 `Vary: Origin`；OPTIONS 无论是否构成合法预检，都再追加
  `Access-Control-Request-Method` 与 `Access-Control-Request-Headers`，避免中间缓存混用无 Origin、
  普通 OPTIONS、合法预检和拒绝响应。
- 缺少浏览器预检 Header 的普通 OPTIONS 不是成功预检，固定返回 `405 + 100405`；不得让
  `net/http` 的 `OPTIONS *` 默认 200 绕过 Gin 边界。
- 未匹配请求日志只能使用固定低基数 route template，禁止记录 raw path、query 或完整 URL。
- API 前缀下未登记的非标准方法同样返回 `405 + 100405`；日志不得记录攻击者提供的原始方法名，
  统一归一化为固定 `method=OTHER`。`logger.ContextFields.Method` 的允许值相应增加 `OTHER`。

### R3 错误、绑定与请求体

- 统一错误体精确包含整数 `code`、安全中文 `message` 和 `requestId`，Content-Type 为 JSON。
- 新增通用 `NOT_FOUND=100404`，HTTP status 为 404，安全消息固定为“请求路径不存在”；Gin
  `NoRoute` 必须通过统一错误写出入口返回该合同。
- 新增通用 `FORBIDDEN=100403`，HTTP status 为 403，安全消息固定为“请求被拒绝”；用于 CORS、
  G0-T06 CrossOriginProtection 等安全边界的无细节拒绝，禁止向客户端暴露具体判定原因。
- 通过 `errors.As` 识别 wrapped `*apperror.Error`；未知错误固定映射 `100500/500`。
- `*http.MaxBytesError` 固定映射 `100413/413`；JSON 绑定失败映射 `100400/400`。不得回传 cause、
  panic、堆栈、SQL、路径、Provider 数据、Prompt、Header 或原始 body。
- body limit 不得预读或缓存完整请求体；已知 Content-Length 可提前拒绝，chunked/未知长度通过
  `http.MaxBytesReader` 在统一 JSON 绑定读取时失败。Handler 必须先完成绑定再执行任何业务副作用；
  透明 middleware 不承诺在未读取 chunked body 时提前发现超限。
- 统一 JSON 绑定只接受一个完整 JSON 值，必须继续读取到 EOF；第二个 JSON 值、非法尾随数据以及
  让请求体超过上限的尾随空白都必须在业务副作用前拒绝。
- 所有 API 路由默认使用 1 MiB body 上限；未来业务路由可通过服务端 Router Options，按精确
  `HTTP method + Gin route template` 显式覆盖。覆盖值必须为正数，不得从客户端 Header、query
  或任意运行时输入动态决定。
- 本任务不猜测上传上限；上传任务冻结具体路由值后再注册覆盖。SSE POST 请求仍使用默认 1 MiB，
  流式响应持续时间与 write deadline 由 SSE 所属任务处理。

### R4 日志与 panic recovery

- 每个已冻结标准方法的 API 请求先创建 fresh typed logging context，完成时仅通过
  `logger.LogRequestComplete` 写 status/error/elapsed；405、413、未匹配和 panic 也恰好一条。
- logging middleware 在最外层，安全 recovery 在其内层，使未提交响应的 panic 映射
  `100500/500` 后，外层仍能看到最终状态。
- panic 原值与堆栈不进入响应或日志；本任务不为已提交响应/SSE panic 引入全量响应缓冲。
- G0-T05 只从 typed request context 消费可信注入的 request ID，并写入统一错误响应与完成日志；
  不从 Header 信任或生成 ID，不承诺响应 Header。测试通过受控 middleware 注入固定 ID。
- request ID 生成、响应 Header 和代理信任规则由 G0-T06 一次性实现，禁止出现第二套生成逻辑。

### R5 HTTP Server 构造合同

- 提供只构造、不 Listen/Serve 的 `http.Server` 边界，要求 address、handler、read-header/read/
  write/idle timeout 与 max-header-bytes 均合法。
- 本任务在唯一配置合同中新增 `http` 段并同步完整注释模板和严格启动校验；实际 `app.yaml` 继续
  由部署者从 `app.yaml.example` 创建，不进入 Git。字段与默认值冻结为：
  - `read_header_timeout: 5s`
  - `read_timeout: 30s`
  - `write_timeout: 5m`
  - `idle_timeout: 60s`
  - `max_header_bytes: 32768`
  - `default_json_body_bytes: 1048576`
  - `cors.user_allowed_origins: []`
  - `cors.admin_allowed_origins: []`
- 默认 JSON body 上限为 1 MiB，Header 上限为 32 KiB；5 分钟 write timeout 为后续 AI 改写
  SSE 预留，但 SSE 所属任务仍必须冻结更短的业务持续时间并做流式超时验收。
- G0-T05 的 Router Options 接收校验后的两组来源；G0-T07 负责进程装配和生命周期。具体
  listen address、Listen/Serve 和 shutdown，不在本任务配置。

### R6 可执行守卫

- build contract 固化 Gin 直接依赖版本、允许导入层、`gin.New()` 唯一构造方式、默认
  Logger/Recovery 禁止、generated ErrorResponse 唯一性和 HTTP 层不泄漏原始错误的调用面。

## Acceptance Criteria

- [x] AC1：Gin v1.12.0 作为直接依赖，只有批准的 HTTP 边界包导入；不存在 `gin.Default()`、默认
  Logger/Recovery、第二套错误 DTO 或占位业务路由。
- [x] AC2：NoRoute、CORS 拒绝、wrapped 应用错误、JSON 绑定错误、body 超限、未知错误和未提交
  响应 panic 分别精确
  返回批准的 HTTP status/整数 code/安全 message/`requestId`，所有恶意 marker 不泄漏。
- [x] AC3：两个 API 前缀的 GET/POST 注册边界可用；PUT/PATCH/DELETE/HEAD/CONNECT/TRACE 稳定
  返回 405、`100405` 和冻结后的 `Allow`；合法浏览器 CORS 预检按冻结合同成功，非法来源或非法
  method/header 不获得跨域授权。
- [x] AC3.1：用户端与管理端 CORS 来源白名单分别严格校验、互不串用；空列表保持同源，禁止
  wildcard/null/带路径来源；只允许同一 schemeful site，跨站来源拒绝；G0-T06 可直接复用同一
  typed 配置。
- [x] AC3.2：合法预检精确返回 204、固定 methods/headers、credentials、600 秒缓存、三项 Vary；
  普通允许跨域响应暴露 `X-Request-ID`；非预检 OPTIONS 返回 405，非法预检返回 403，均不泄漏。
- [x] AC3.3：真实 `net/http` HEAD 响应为 405、空 body、正确 Allow/CORS，完成日志记录 100405；
  不以 `httptest.ResponseRecorder` 中可能保留的 handler 写入内容伪装线路 body 可读。
- [x] AC4：已知长度与 chunked body 超限均在 handler 产生副作用前返回 413；正常 JSON 绑定可用，
  其中 chunked/未知长度必须通过统一 BindJSON 先完整校验再进入业务逻辑；middleware 不预读、
  不缓存、不记录 body；默认值与精确 method/template 覆盖并发隔离正确，非法覆盖配置快速失败。
- [x] AC5：GET/POST、六种直接禁用方法、OTHER、OPTIONS 的 204/403/405 分支、未匹配、413 和 panic 均
  只有一条入站完成日志；字段、级别、
  fallback route template 和并发隔离正确，raw path/query/body/panic 不进入最终 writer。
- [x] AC6：配置加载器精确解析并校验已冻结的 HTTP/CORS 字段；`http.Server` 构造器精确装配
  5s/30s/5m/60s 四类 timeout、32768 header limit 和 handler，非法 options 快速失败；没有监听、
  goroutine、signal、drain 或 shutdown 实现。
- [x] AC7：配置变更仅限 R5 已冻结的 HTTP/CORS 段；不修改 OpenAPI/generated DTO、Desktop/UI、
  数据库或业务 Service；同步技术方案、checklist 与 backend HTTP spec。
- [x] AC8：gofmt、tidy diff、module verify、vet、定向/全量/Shuffle/Race、server build/run、依赖与
  泄漏扫描及 `git diff --check` 通过，或明确记录工具缺失风险。

## Out of Scope

- 真实业务 operation、Service、Session、鉴权、权限、CSRF/trusted proxy、request ID 生成/回传。
- R5 已冻结字段之外的新 HTTP 配置、进程装配、Listen/Serve、readiness、信号、drain、shutdown。
- SPA/静态文件、health/readiness、Metrics/Tracing、SSE/上传的最终专用限制。
- 对外诊断、pprof、数据库、Provider/Blob/SMTP 出站调用。

## Open Questions

无。当前需求与公共合同已由用户逐项确认，可以进入设计、实施计划和最终 review。
