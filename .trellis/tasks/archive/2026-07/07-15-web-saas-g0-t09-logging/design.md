# G0-T09 技术设计

## 边界与数据流

```text
typed context helper ──> logit fresh/fork field store
                                  │
Service / HTTP / Worker ──> *slog.Logger
                                  │
                     application safeHandler
                       │ drop unknown/Any/error
                       │ protect trusted fields
                                  ↓
                     logit.NewSlogHandler
                                  ↓
                     JSON stdout / test writer
```

`lib/logger` 是唯一 logit adapter。它返回 `*slog.Logger`，不把 logit Logger、Field 或 Handler
暴露给业务。G0-T09 不 import Gin、OpenTelemetry、Prometheus 或 `internal/config` 生产代码。

## 构造与编码

- `Options` 只包含 `Writer`、`Service`、`Version`、`MinLevel` 和安全的 `OnWriteError func()` hook。
  Writer 为空时使用 stdout；Service/Version 为空快速失败。
- 使用 `logit.NewJSONEncoder()`，在构造阶段一次性把 key 固定为
  `timestamp/level/message`；encoder 构造后不再修改。
- 底座使用 `logit.NewSimpleLogger`，再通过 `logit.NewSlogHandler` 适配 slog；source 默认关闭。
- service/version 直接装入底层 logit Handler 后再包 safeHandler，避免业务显式 attr 覆盖。
- 不调用 `slog.SetDefault`。stdout SimpleLogger 无需 close；未来文件 logger 的 owner/close 由
  G0-T07 单独设计。
- logit 的 `func(error)` write hook 只被适配为不携带原始错误的 `func()`；默认回调写固定 stderr
  告警且不接触本 logger。回调必须 non-reentrant。

## safeHandler

safeHandler 是防御性边界，不做内容分类器：

- 业务 record 只允许 `status_code`、`error_code`、`elapsed_ms` 三个非负整数 attr；其他显式
  attr、group、Any、error、bytes、LogValuer 全部丢弃。
- `service/version/request_id/trace_id` 等可信字段只能由构造器或 typed context 写入，显式 attrs
  不得覆盖。
- message 无法可靠做内容脱敏，因此 build contract 要求生产 slog 调用使用字符串字面量；
  动态 message 与 `slog.Any` 在源码层拒绝。
- `WithAttrs` 在进入下层 Handler 前应用同样过滤。`WithGroup` 不把 name 传给下层，并返回
  group-scoped 丢弃状态；此后 `WithAttrs` 和 record group attrs 都丢弃，消息仍可输出。
- 过滤先检查原始 `slog.Value.Kind()`，KindLogValuer 不调用 `Resolve`，直接丢弃。

这比敏感 key 黑名单更窄：新增安全字段必须在拥有它的业务任务中明确语义、类型和泄漏测试，
不能因为 key 看起来无害就自动放行。

## Context 合同

- `NewContext(parent, ContextFields)` 使用 logit fresh store，适合每个入站请求或独立 job。
- `ForkContext(parent, ContextFields)` 克隆已有 store，适合并发出站请求或 child operation；不在
  parent 上原地覆盖 direction/method/operation。
- `ContextFields` 仅包含已批准标量。request/trace/user/task/invocation ID 作为 metadata；
  direction、method、route template、operation、peer service 作为普通字段。空字段不写入。
- helper 必须保留 parent deadline/cancel；不生成 request ID 或 trace ID。
- helper 返回 `(context.Context, error)`。direction 是 typed enum；method 只允许
  GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS/CONNECT/TRACE；route template 最大 256 字节、必须以
  `/` 开头，只允许字母、数字、`/._-:{}`，并拒绝 scheme/host/query/fragment/CRLF/空格和 `..`；
  operation/peer/ID 是最大 128 字节的安全 token，只允许字母、数字、点、下划线和连字符。
  这些规则验证结构而非猜测秘密内容；opaque ID 的可信来源由拥有它的后续任务保证。
- Fork 读取 parent 已有 request/trace/user/task 字段：省略时继承，相同值允许，不同值返回错误；
  invocation 和 child operation 允许覆盖。它始终克隆 store，不修改 parent 或 sibling。

## 完成事件

`LogRequestComplete` 接收 typed `RequestResult` 并返回错误。Inbound status 只允许 100～599：
100～399 为 Info、400～499 为 Warn、500～599 为 Error。Outbound status 可为 0；此时省略
`status_code`、必须有正 `error_code` 并记 Error，表示没有收到 HTTP 响应。其他情况下
`error_code=0` 省略，否则必须为正整数；`elapsed_ms` 为非负 int64。它固定写一条
“HTTP 请求完成”事件，方向从 typed context 读取。G0-T05 可直接复用，但本任务不承诺 Gin
middleware 行为。

## 安全与兼容

- 完整 Config/JSON、error cause 和任意对象通过 slog 进入时被丢弃；黑盒测试必须检查最终
  logit writer，而不是只测过滤函数。
- Build contract 在 `lib/logger` 外拒绝 package-level slog logging、`slog.Default/New`、
  `slog.With`、NewLogLogger、Text/JSON Handler、SetDefault、Handler 提取和日志方法值，防止业务
  绕过 safeHandler 或动态 message 检查。
- 两个 fresh context 和两个 fork sibling 并发运行 Race 测试，防止 logit 可变 store 复用串线。
- logit v1.0.0 要求 Go 1.24，已与目标 Go 1.26.5 兼容；它没有第三方 module 依赖。
- v1.0.0 仍无公开 LICENSE。当前开发依赖项目所有者授权，G7-T05 前必须补公开许可证据。

## 回滚

本任务只新增 `lib/logger`、build contract、直接依赖和文档。回滚可整体删除这些文件并移除
logit module，不涉及数据、配置、HTTP 合同或部署迁移。
