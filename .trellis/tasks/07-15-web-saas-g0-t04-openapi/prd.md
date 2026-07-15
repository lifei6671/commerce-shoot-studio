# 建立 OpenAPI 合同与生成链

## Goal

为 Web SaaS 一期建立仓库内受评审的 OpenAPI 单一事实源，并使用锁定版本可重复生成 Go HTTP
DTO models 与 TypeScript 类型，使后续 G0-T05、G1～G6 不再手写第二套 HTTP 合同。

## Background

- G0-T01～G0-T03 已完成；G0-T04 是 G0-T05、G05-T01 和 Remote Runtime Client 的前置。
- DS0-02 已批准 `oapi-codegen v2.7.2`、`openapi-typescript 7.13.0` 与独立 `web/`
  npm lockfile；生成锁文件后仍需执行依赖安全和许可证门禁。
- DS0-03 已批准技术方案第 5、6 章的用户/管理 API、整数错误码、分页、
  `Idempotency-Key`、AI 改写 POST SSE、生成前报价和积分 DTO 边界。
- 当前仓库没有 OpenAPI 文件、生成 DTO、生成脚本或 `web/` 包；Desktop Runtime 类型是
  Local-first 合同，不是 Remote HTTP DTO 的事实源，本任务不得修改 Desktop 展示层。

## Confirmed Requirements

- OpenAPI 输入只能来自仓库内受审文件；禁止远程 `$ref`、构建时下载 schema、用户上传或
  第三方 schema。
- 业务路由只允许 GET / POST。所有修改操作使用动作式 POST；跨域拒绝不签发或声明 CSRF
  Token / Cookie / Header。
- 用户 API 使用 `/api/v1`，管理 API 使用 `/api/admin/v1`，保持不同认证状态与安全方案。
- `ErrorResponse.code` 为整数，包含安全 `message` 与 `requestId`；不得重新定义字符串错误码。
- 普通列表使用 `page/pageSize`；高增长事件、积分流水、模型调用等使用稳定 cursor 合同。
- 需要幂等的写操作显式声明 `Idempotency-Key`；普通资料更新只使用 version 乐观锁。
- `POST /api/v1/ai-assist/rewrites/stream` 声明 `text/event-stream`，并定义
  `meta/delta/done/error` payload；其他异步任务继续 polling，不声明 WebSocket 或通用 SSE。
- 生成类型只能位于生成目录，文件头必须标记禁止手改；Service Command/View、Entity 和
  Desktop Runtime 类型不得被生成物替代。
- 生成链必须锁定精确工具版本、可重复执行，并提供“重新生成后工作树无 diff”的检查。
- 本任务不实现 Gin 路由、中间件、Handler、Service、数据库 schema、RemoteRuntimeClient 或 UI。

## Confirmed Scope Decision

2026-07-15 用户选择方案 A：G0-T04 只建立生成链和已经冻结的共享/核心 components，不把
51 个只有路径和方法、但请求/响应字段尚未冻结的业务 operation 写成宽泛 `object` 或空响应。
初始 OpenAPI 使用合法的 `paths: {}`；G2～G6 所属业务任务在字段合同冻结后向同一 schema
增量添加 operation。技术方案和清单必须同步这一责任边界，但既有一期路由库存继续有效。

本轮首批 components 固定为：

- `ErrorResponse`。
- 普通分页与 cursor 分页的请求/元数据基元，以及 `Idempotency-Key` Header 参数。
- AI 改写 `meta`、`delta`、`done`、`error` 四类 SSE payload；OpenAPI 只把响应媒体类型表达为
  `text/event-stream` 字符串流，事件顺序、flush、心跳和反压继续由后续合同测试保证。
- `GenerationPlanQuoteView`、`CreditSummaryView`、`CreditLedgerItemView`。

OpenAPI 版本使用 `3.0.3`。由于部署配置允许用户/管理 Cookie 名变化，本轮不声明需要静态
Cookie 名的 OpenAPI `apiKey in: cookie` security scheme，也不虚构 CSRF schema；同源 Session
约束保留在合同描述中，具体 HTTP 装配由 G0-T05/G0-T06/G2 负责。

## Acceptance Criteria

- [x] 仓库内存在唯一受审 OpenAPI 入口，全部引用均为本地且不可逃逸输入目录。
- [x] schema 以 `paths: {}` 起步且只包含已冻结的共享/核心 components；测试证明未来新增
  operation 只能使用 GET/POST，并且不包含 CSRF Token 合同或通用 SSE/WebSocket。
- [x] `oapi-codegen v2.7.2` 可重复生成 Go DTO models 到
  `server/internal/models/dto/generated`，生成物不含 GORM tag。
- [x] `openapi-typescript 7.13.0` 可重复生成 TypeScript 类型到独立 Web 边界，不修改
  `desktop/package.json`、Desktop lockfile 或 Desktop Runtime 类型。
- [x] 自动测试拒绝远程/逃逸 `$ref`、非 GET/POST 业务方法、重复 operationId、生成物手改和
  生成 diff；Go/TS 生成结果与 schema 一致。
- [x] 新增依赖与 lockfile 仅包含已批准工具边界；`go mod verify`、Go 测试/Race、npm audit、
  生成检查、许可证/漏洞扫描和 `git diff --check` 全部通过，或明确记录外部工具不可用风险。

## Out of Scope

- G0-T05 的 Gin HTTP 运行时、统一错误写出、405 和 request ID 中间件。
- G0-T06 的 `CrossOriginProtection` 装配及 Session 响应 Header。
- G0.5 的完整状态机、迁移、CAS、幂等事务和故障注入。
- G1～G4 的业务实现、数据库映射、Provider 调用与积分结算。
- G5/G6 的 Remote API Client、Web 页面、认证状态和管理端交互。
