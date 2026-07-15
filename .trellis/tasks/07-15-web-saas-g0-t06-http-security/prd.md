# 建立 trusted proxy、请求 ID 与 CSRF 基线

## Goal

在 G0-T05 的 Gin/HTTP 边界上建立第一版来源信任基线：默认不信任任何代理，只有显式配置的
单层 Ingress/LB 才能影响客户端 IP、外部 scheme/host 与同站判断；每个请求由服务端签发稳定的
Request ID；用户端与管理端分别使用 Go 标准库 `net/http.CrossOriginProtection` 拒绝不安全的
跨域浏览器写请求，并复用现有 typed CORS Origin 白名单。

本任务只建立 transport/security 基线，不实现 Session、业务路由、监听生命周期、限流、Tracing、
Metrics、健康检查或 CSRF Token 协议。

## Requirements

### 已冻结合同

- G0-T06 依赖 G0-T05 与 DS0-04；不改变 G0-T05 已冻结的 GET/POST-only、OPTIONS、CORS、统一错误、
  body/header limit、recovery 和完成日志语义。
- `server/conf/app.yaml` 的安全配置显式包含 trusted proxy CIDR，仓库模板默认空列表；完整配置继续
  严格解析，不使用环境变量、Viper default 或模板合并。
- 空 trusted proxy 配置必须调用等价于 `gin.Engine.SetTrustedProxies(nil)` 的关闭路径；任何客户端
  自带的 `X-Forwarded-*` 都不能改变客户端 IP、外部 Origin 或同站判断。
- 第一期最多支持一层反向代理/Ingress，不支持 CDN；同一层代理允许配置多个实际出口 CIDR。
  只有 `RemoteAddr` 命中其中一个显式 CIDR 时，才允许可信代理元数据参与解析。
- trusted proxy 配置字段固定为 `security.trusted_proxy_cidrs`；只接受规范 IPv4/IPv6 CIDR，拒绝
  重复值、带 host bits 的非规范网络、`0.0.0.0/0`、`::/0` 与全部 IPv4-mapped IPv6 CIDR。
- 请求中的 IPv4-mapped IPv6 RemoteAddr/XFF 在拒绝 zone 后执行 `Unmap()`，再按普通 IPv4 CIDR
  匹配；该行为只规范化客户端地址，不放宽 proxy 配置输入。
- 非可信来源携带的 `X-Forwarded-*` 全部忽略，并使用直连 `RemoteAddr`、TLS 与 Host；不得信任
  `Forwarded`、`X-Real-IP` 或其他供应商 Header。
- 可信代理访问业务 API 时必须提供恰好一个完整单跳 tuple：`X-Forwarded-For` 是单个合法 IP，
  `X-Forwarded-Proto` 是 `http` 或 `https`，`X-Forwarded-Host` 是单个规范 `host[:port]`。任一字段
  缺失、为空、重复、多行、包含逗号链或非法值都统一返回 `403 + 100403`，且不回显原值。
- 后续 `/healthz`、`/readyz` 不依赖 forwarded tuple，避免可信代理内的探针因不携带外部元数据而
  失败；具体健康路由仍由 G0-T11 实现。
- trusted proxy 解析结果是后续上传限制、客户端 IP、审计、限流、外部 scheme/host 和同站判断的
  唯一代理事实源；不得在下游再次直接解析原始 `X-Forwarded-*`。
- 每个请求由服务端生成 Request ID，写入响应 `X-Request-ID`，注入 G0-T09 的 fresh logger context，
  并供 G0-T05 的统一错误体与完成日志消费；不得直接信任客户端传入的 `X-Request-ID`。
- Router 构造时使用 `crypto/rand.Reader` 一次读取 32 字节进程内密钥；每个请求使用
  `HMAC-SHA256(密钥, 原子递增计数器)` 并截取前 16 字节，编码为 32 位小写十六进制。Request ID
  对客户端保持 opaque，不承诺时间有序或可解析，不新增第三方依赖。
- 入站 `X-Request-ID` 无论合法、非法或多值都完全忽略，不复用、不回显、不记录；响应 Header、
  统一错误体与完成日志必须使用本请求同一个服务端 ID。
- 启动密钥读取出现可恢复 short read/error 时 Router 构造失败，不进入请求处理；Go 1.26 默认
  `crypto/rand` 的灾难性故障遵循 runtime fatal。请求路径不再读取系统熵源，也不降级到客户端值、
  时间戳、纯计数器、`math/rand` 或固定值。
- 用户 `/api/v1` 与管理 `/api/admin/v1` 分别装配独立的
  `net/http.CrossOriginProtection`；两端各自复用 G0-T05 对应的 typed CORS Origin 白名单，禁止建立
  第二套 trusted-origin 配置，禁止添加 bypass。
- 非安全跨域浏览器请求返回统一 `403 + 100403`；不得回显 Origin、Header、代理地址、底层错误或
  其他敏感值。
- 不签发 CSRF Token/Cookie，不增加 CSRF Header/OpenAPI 字段，不自行实现 Token 算法。
- API 安全响应基线追加 `Cache-Control: no-store, private` 与 `Vary: Cookie`；CORS 只能追加并按
  大小写不敏感去重 `Vary`，不得覆盖 `Cookie` 或既有 Origin/预检维度。
- 缓存响应头覆盖 `/api/v1` 与 `/api/admin/v1` 的全部成功和错误响应，包括进入业务 Handler 前的
  早期拒绝；不覆盖静态资源、`/healthz`、`/readyz`。后续 SSE 可按所属任务显式覆盖为
  `no-cache, no-transform`。
- 新增配置必须同步到无真实凭据、带完整中文说明的 `server/conf/app.yaml.example`；被 Git 忽略的
  实际 `server/conf/app.yaml` 不读取、不改写、不回显。
- 不新增第三方依赖；使用 Go 1.26 标准库、现有 Gin 与既有项目包完成。

### Out of Scope

- Session Store、Cookie 名、Session 签发/刷新/失效与认证中间件（G2）。
- 完整 CSRF 登录态验收和缺少浏览器来源 Header 的业务策略（G2-T03）。
- 真实 Ingress 配置、CDN、多跳代理、PROXY protocol、Forwarded 标准 Header。
- HTTP listen/serve/shutdown、readiness 与应用装配（G0-T07）。
- Tracing、Metrics、持久限流、审计与业务客户端 IP 消费方。

## Acceptance Criteria

- [ ] 默认空 trusted proxy 配置时，Gin 不信任任何代理；伪造 `X-Forwarded-*` 不改变可信客户端 IP、
  外部 scheme/host 或同站判断。
- [ ] 显式单层 trusted proxy CIDR 列表经严格校验；重复、非规范、全网、IPv4-mapped IPv6 与非法
  CIDR 快速失败且不回显配置值。
- [ ] 可信代理与非可信来源、IPv4/IPv6、缺失/重复/多值/非法 forwarded Header 均有 table-driven
  边界测试。
- [ ] 每个请求获得服务端生成的 Request ID，响应 Header、统一错误体和完成日志一致；并发请求隔离，
  客户端伪造 Header 不被复用。
- [ ] Router 只在构造时读取 32 字节随机密钥；请求期用 HMAC-SHA256 + 原子计数器生成 32 位小写
  十六进制 ID。密钥读取失败阻止构造；请求路径不读取熵源，不使用时间戳、纯计数器、`math/rand`
  或客户端值 fallback。
- [ ] 用户端与管理端 `CrossOriginProtection` 分别复用对应 CORS 白名单；同源 POST、各自允许的同站
  Origin、跨域 POST、白名单串用、GET/HEAD/OPTIONS 和缺少来源 Header 均有测试。
- [ ] CSRF 拒绝统一返回 `403 + 100403`，遵守 HEAD/日志/敏感信息安全边界；不产生 CSRF
  Token/Cookie/Header 合同。
- [ ] 目标响应包含 `Cache-Control: no-store, private` 与去重后的 `Vary: Cookie`，并与 G0-T05 的
  `Vary: Origin` / 预检维度共存。
- [ ] build contract 阻止下游直接解析未验证的 forwarded Header、第二套 CSRF trusted-origin 配置、
  CSRF bypass/Token/Cookie 和不受信 Request ID。
- [ ] 完成 TDD RED/GREEN、定向测试、shuffle、race、`gofmt`、`go vet`、全量 Go 测试、构建/运行、
  依赖/secret 扫描与 `git diff --check`；无法运行的正式工具按 G0-T12 边界记录。
- [ ] 同步技术方案、实施清单、Trellis backend spec 与任务证据；不修改 README、Desktop UI、
  OpenAPI 业务 paths 或 Makefile。

## Notes

- 本任务涉及公共配置与 HTTP 安全行为，属于复杂任务；实现前必须补齐 `design.md`、`implement.md`，
  完成用户确认，并重新执行 `trellis-before-dev`。
- 2026-07-15 用户已确认严格单跳方案：同层允许多个 CIDR；可信代理业务 API 必须提供完整单值
  XFF/XFP/XFH tuple，非法或缺失统一 403；非可信来源忽略 forwarded Header；不支持
  `Forwarded` / `X-Real-IP`；拒绝重复、非规范及全网 CIDR。
- 2026-07-15 用户追加确认配置拒绝所有 IPv4-mapped IPv6 CIDR；请求地址仍先 `Unmap()`，再按正常
  IPv4 CIDR 匹配。
- 2026-07-15 用户先确认逐请求 `crypto/rand`，随后根据 Go 1.26 runtime fatal 约束批准调整为：Router
  启动时一次读取 32 字节密钥，请求期以 HMAC-SHA256 + 原子计数器生成 32 位 ID；启动读取失败拒绝
  构造，不使用弱随机降级。入站同名 Header 仍完全忽略。
- 2026-07-15 用户已确认全部用户/管理业务 API 成功和错误响应设置
  `Cache-Control: no-store, private` 与 `Vary: Cookie`；静态资源和健康检查不覆盖，后续 SSE
  显式使用自己的缓存合同。
- G0-T05 当前仍保持未暂存、未提交；G0-T06 不触发自动提交或归档。
