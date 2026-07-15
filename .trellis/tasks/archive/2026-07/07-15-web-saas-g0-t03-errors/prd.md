# 建立整数错误与领域状态常量

## Goal

为 Web SaaS Go Runtime 建立不依赖 Gin 的稳定整数错误基元和领域状态类型边界，使后续
OpenAPI、HTTP 中间件、Service、Repository 与 Worker 共享单一事实源，同时不提前冻结
G0.5 才负责的完整状态机与迁移规则。

## Background

- G0-T01、G0-T02 已完成；本任务是 G0-T05 HTTP 边界和 G05-T01 状态表的前置。
- 已批准的错误合同要求 `code` 为整数，HTTP status 与业务错误码分离，客户端消息安全，
  Service 不依赖 Gin，底层 cause 只供 `errors.Is` / `errors.As` 和脱敏内部诊断使用。
- 已批准号段方向为：`100xxx` 通用、`110xxx` 认证、`120xxx` 用户、`130xxx` 资产、
  `140xxx` 生成、`150xxx` 模型、`160xxx` 配置/邮件、`170xxx` 积分、`190xxx` 管理端。
- 用户已确认首批六项 HTTP 错误目录，并继续冻结
  `140504 GENERATION_PROVIDER_RESULT_UNCERTAIN` 为仅用于任务结果的稳定错误码。
- 当前明确到数据库数值的状态只有 `async_jobs` 的 `queued=0`、`running=1`；邮件、上传、
  invocation 等仅冻结了状态名称，完整数值与迁移表由 G0.5 继续冻结。

## Requirements

- 新增 `server/lib/apperror`，使用标准库实现稳定整数 code、HTTP status、安全简体中文消息、
  cause、`Error()`、`Unwrap()` 与只读访问方法；不得依赖 Gin、OpenAPI 生成类型或日志实现。
- 错误码常量只在 `apperror` 维护；`server/lib/constant` 只维护按领域拆分的具名 `uint8`
  状态和其他跨模块常量，避免双重事实源。
- 同一个错误定义必须具备非零整数 code、合法 HTTP status 和非空安全消息；对外字符串不得
  拼接底层错误、SQL、路径、Provider 响应、Prompt 或凭据。
- 错误码必须位于所属模块号段且全局唯一；禁止字符串错误码、按 HTTP status 动态推导业务
  code、用一个通用 `status.go` 汇总所有领域状态。
- 领域状态必须使用不同的具名 `uint8` 类型，使跨领域比较不能直接编译；生产代码不得使用
  裸状态数字。
- 不新增依赖，不实现 Gin 中间件、HTTP JSON 响应、OpenAPI、数据库 schema 或状态迁移函数。
- 遵循 TDD：先用失败测试固定错误链、安全消息、号段/唯一性和强类型状态合同，再做最小实现。

## Confirmed First Catalog

2026-07-15 用户确认采用最小冻结方案，号段从“建议”升级为强制合同。首批可作为 HTTP
业务错误返回的定义固定如下：

| 常量名 | 整数码 | HTTP | 安全消息 |
| --- | ---: | ---: | --- |
| `INVALID_REQUEST` | `100400` | 400 | 请求参数无效 |
| `METHOD_NOT_ALLOWED` | `100405` | 405 | 请求方法不允许 |
| `REQUEST_BODY_TOO_LARGE` | `100413` | 413 | 请求体过大 |
| `INTERNAL_ERROR` | `100500` | 500 | 服务暂时不可用 |
| `GENERATION_TASK_NOT_FOUND` | `140404` | 404 | 生成任务不存在 |
| `AI_REWRITE_IN_PROGRESS` | `150409` | 409 | AI 改写正在处理中 |

`GENERATION_PROVIDER_RESULT_UNCERTAIN=140504` 只冻结为任务结果错误码。本轮不为它定义
同步 HTTP status 或可直接返回的 `AppError`，尤其不能根据尾号擅自映射为 HTTP 504。

本轮状态/枚举只固定仓库已经给出数值的：

- `AsyncJobStatusQueued=0`、`AsyncJobStatusRunning=1`。
- `ModelCategoryTextToText=1`、`ModelCategoryTextToImage=2`、
  `ModelCategoryImageToImage=3`、`ModelCategoryImageToText=4`。

邮件、上传、Task、Run、Invocation、积分等其他状态的数值与迁移规则留给 G0.5，避免抢跑
后续状态机门禁。

## Acceptance Criteria

- [x] `apperror` 可创建/包装错误并通过 `errors.Is` / `errors.As` 保留 cause 链，公开错误文本
  仅包含已登记的安全消息。
- [x] 错误目录测试证明整数码全局唯一、处于所属号段、HTTP status 合法且安全消息非空。
- [x] 至少覆盖已冻结的 `AI_REWRITE_IN_PROGRESS=150409` 和
  `GENERATION_PROVIDER_RESULT_UNCERTAIN=140504`，不擅自把业务码后三位当作 HTTP status。
- [x] `constant` 使用按领域文件拆分的具名 `uint8` 类型，精确固定 Async Job 状态和模型类别；
  不存在通用 `status.go`、跨领域通用 `Status` 类型或未确认状态值。
- [x] `gofmt -l` 无输出，`go mod tidy -diff`、`go mod verify`、`go vet ./...`、
  `go test ./...`、`go test -race ./...` 与根目录 `git diff --check` 全部通过。

## Out of Scope

- Gin 全局错误中间件、统一 JSON 写出和 request ID；属于 G0-T05。
- OpenAPI `ErrorResponse` 与生成 DTO；属于 G0-T04。
- 完整业务错误目录、数据库 schema、状态迁移表、CAS/事务/恢复规则；由所属 G0.5/G1
  任务在真实用例出现时冻结。
- 日志脱敏与 error code 日志字段；属于 G0-T09。
