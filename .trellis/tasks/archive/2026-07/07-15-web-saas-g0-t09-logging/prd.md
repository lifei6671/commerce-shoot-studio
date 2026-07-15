# 建立日志安全基线

## Goal

为 Web SaaS Go 服务建立与 HTTP 框架无关的结构化日志安全边界：业务层只依赖标准库
`*slog.Logger`，底层锁定已获授权的 `github.com/lifei6671/logit v1.0.0`，并确保启动配置、
凭据、原始请求/响应、Prompt、Base64、完整 URL/路径和底层错误不会进入日志。

## Background

- G0-T09 是 G0-T05 Gin HTTP 边界和 G0-T10 Metrics/Tracing 的前置任务。
- DS0-02 已由项目所有者批准使用本人维护的 `logit v1.0.0`，该版本无公开 LICENSE 文件不
  阻塞当前开发，但仍是 G7-T05 正式发布门禁；不得回退到 API 不同的旧版本或
  `slog.JSONHandler`。
- `logit v1.0.0` 提供 `NewSlogHandler`、JSON encoder、fresh/fork context 和 writer error hook，
  但默认键为 `time/msg`，且会原样编码 `slog.Any`、`error`、字节和显式覆盖字段；因此它不是
  脱敏器，应用必须在 Handler 外增加安全边界。
- 当前启动配置只有 MySQL、Redis、Session 和验证码安全配置，没有 logging 字段。本任务采用
  JSON stdout 默认值与可注入 writer，不修改 `app.yaml` 或配置 DTO。

## Requirements

### R1 依赖与分层

- 精确锁定 `github.com/lifei6671/logit v1.0.0`，通过 Go 命令维护 `go.mod/go.sum`，不得手改
  校验文件。
- 只有 `server/lib/logger` 可以导入 logit；Service、Repository、Worker 以及未来 HTTP 层只
  接收标准库 `*slog.Logger` 或调用 logger 包的 typed context helper，不暴露 logit 类型。
- 不调用 `slog.SetDefault`，不启用 `slog.JSONHandler` 回退，不启用会暴露源码绝对路径的
  `WithSlogSource(true)`。
- `lib/logger` 外禁止 package-level `slog.Info/Error/Log/LogAttrs` 等默认 logger 入口，也禁止
  `slog.Default`、`slog.With`、`slog.New`、`NewLogLogger`、`NewTextHandler`、`NewJSONHandler` 和
  `SetDefault`；业务只能使用显式注入的 `*slog.Logger`。同时禁止提取 `Handler()` 或日志方法值
  绕过动态 message 检查。

### R2 输出合同

- 默认写单行 JSON stdout；测试可注入 `io.Writer`。顶层字段固定为
  `timestamp/level/message/service/version`，生产默认最低级别为 Info。
- `service`、`version` 由构造器注入且不能被业务 attrs 覆盖。
- 底层 encode/write 失败必须触发独立安全回调；回调不得递归写入同一个 logger，也不得输出
  writer 原始错误内容。
- writer error hook 固定为不接收原始 error 的 `func()`；默认实现只向独立 stderr 写固定安全
  告警，测试可注入原子计数 hook。

### R3 typed context 与完成日志

- `lib/logger` 提供 fresh request context 和 forked outbound/child context；两个请求、并发 sibling
  之间不得共享可变字段 store，取消和 deadline 必须保留。
- context 只接受明确的标量字段：direction、method、route template、operation、peer service、
  request/trace/user/task/invocation ID。不得接受任意 map、raw URL/query/body/header、配置或
  原始 payload。
- direction 使用固定 inbound/outbound 枚举；method 只允许已冻结的标准方法集合
  GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS/CONNECT/TRACE，保证未来 405 请求也先建立日志 context；
  route template 只接受受限模板语法并拒绝 scheme/host/query/fragment/CRLF/空格/`..`；operation、
  peer 和 ID 使用有界安全 token。非法结构返回错误，不静默清洗，也不声称可从任意随机字符串
  识别 secret。
- request/trace/user/task/invocation ID 只能承载服务端签发或所属任务已验证的 opaque ID；本任务
  固化字符集和长度，具体生成来源由 G0-T06/G2/G3/G4 的集成测试证明。
- fork 继承 request/trace/user/task 关联字段；调用方省略即继承，传入不同值必须快速失败。
  invocation/direction/method/operation/peer 可作为 child 维度覆盖，parent 和 sibling 不变。
- 请求/调用完成只记录固定消息以及 `status_code`、整数 `error_code`、非负整数
  `elapsed_ms`；空可选 ID 省略。可信 context 字段不能被显式 attrs 覆盖。
- inbound 完成必须有 100～599 status；outbound 在 DNS/TLS/连接/超时/取消等未收到响应时允许
  status=0 并省略 `status_code`，但必须提供正整数 `error_code`，仍写一条结束日志。
- G0-T09 只提供 transport-neutral 合同。真实 Gin 入站装配、request ID 生成、trace ID 传播和
  Provider/Blob/SMTP 出站集成分别由 G0-T05、G0-T06、G0-T10 和所属业务任务完成。

### R4 安全红线

- Handler 对业务显式 attrs 采用固定白名单，仅接受完成事件的整数/数值字段；未知字段、group、
  `slog.Any`、error、字节、LogValuer 和不符合类型的值直接丢弃，不做“猜测性脱敏”。
- `WithGroup` 不向 logit 转发 group name；进入 group 后丢弃所有 group-scoped attrs，避免敏感
  group 名进入 JSON key。过滤必须先检查 Kind，禁止执行 LogValuer。
- 禁止日志包含 API Key、密码、Session/验证码密钥、Authorization、Cookie、DSN、完整配置
  YAML/JSON、`system_configs` 敏感 JSON、raw/system Prompt、Provider raw request/response、
  SSE 文本、图片 Base64、原始文件内容、完整 URL/query/绝对路径或底层 cause。
- 记录应用错误时只能输出稳定整数 `error_code` 和固定安全消息；不得记录 `cause.Error()`。
- 生产 Go 源码的 slog 消息必须是受审字符串字面量，禁止动态 message；业务源码禁止
  `slog.Any`。通过 AST/build contract 固化这一调用面约束。

## Acceptance Criteria

- [x] AC1：logit 精确解析为 v1.0.0，只有 `lib/logger` 导入它；不存在 JSONHandler fallback、
  全局默认 logger 或 source 绝对路径输出。
- [x] AC2：真实 `bytes.Buffer -> logit -> safe Handler -> slog` 黑盒测试精确验证单行 JSON、
  顶层基础字段、Info 过滤及 direction/method/route_template/operation/peer_service、全部关联 ID、
  status/error/elapsed 的精确 key、值和类型，且不存在未知 key。
- [x] AC3：完整 `config.Config`、代表性 adversarial JSON、嵌套 group/map/struct/LogValuer、raw cause、
  URL/query、Authorization/Cookie、Prompt/Provider response、Base64 的唯一 marker 均不出现在最终
  writer；Session/验证码字节的 Base64 形式同样不泄漏；LogValuer 调用次数为 0。
- [x] AC4：fresh/fork context 在并发和 Race 下不串字段，child 继承允许字段但 sibling 修改隔离，
  deadline/cancel 保留，冲突关联 ID 和结构非法的 context 值快速失败且不写 marker，九种标准
  HTTP method 均可建 context，显式 attrs 不能覆盖 service/version/request/trace ID。
- [x] AC5：writer 失败只调用一次安全回调，不 panic、不递归、不输出原始错误；源码合同拒绝
  logit 越层导入、所有默认/自建 slog 绕过入口、`slog.Any` 和动态日志消息。
- [x] AC6：不修改配置、数据库、HTTP/OpenAPI、Desktop 或 UI；同步技术方案、任务清单和
  `.trellis/spec/backend/logging-guidelines.md`。
- [x] AC7：gofmt、tidy diff、module verify、vet、定向/全量/Shuffle/Race 测试、server run、
  依赖/SBOM/漏洞检查和 `git diff --check` 通过，或明确记录外部扫描工具缺失风险。

## Out of Scope

- Gin middleware、统一错误写出、405、body/timeouts 和 panic recovery（G0-T05）。
- trusted proxy、request ID 生成/响应回传与同源保护（G0-T06）。
- 启动装配、readiness、drain、flush/close 生命周期（G0-T07）。
- OTel trace/span 与 Prometheus metrics（G0-T10）。
- 文件日志、轮转、分流、日志级别配置及 `app.yaml` logging 协议。
- Provider/Blob/SMTP 的具体出站 wrapper、领域字段、审计日志和正式发布许可证闭环。
