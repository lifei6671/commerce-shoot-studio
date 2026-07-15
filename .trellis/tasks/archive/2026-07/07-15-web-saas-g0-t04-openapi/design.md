# G0-T04 技术设计

## 边界与数据流

```text
server/api/openapi.yaml
        │
        ├── oapi-codegen v2.7.2 ──> server/internal/models/dto/generated/types.gen.go
        └── openapi-typescript 7.13.0 ──> web/src/api/generated/openapi.ts

future G0-T05 Handler ──mapper── Service Command/View
future G5-T02 Web Client ──mapper── Runtime Port View
```

`openapi.yaml` 是 HTTP transport 合同的唯一事实源。生成的 Go/TypeScript 类型不替代 Entity、
Service Command/View、Desktop Runtime 类型或页面 view-model。Desktop package、lockfile、tsconfig、
Runtime Ports 和 UI 保持不变。

## 初始 OpenAPI

- 单文件 `server/api/openapi.yaml`，固定 OpenAPI `3.0.3`，所有 `$ref` 只能以 `#/` 开头。
- 初始 `paths: {}`。一期 51 个路径继续由技术方案维护，所属业务任务只有在 request/response
  字段冻结后才把 operation 加入 schema；禁止占位 `object`、空成功响应和自由
  `additionalProperties` 伪装完成。
- `components.schemas` 首批包含：
  - `ErrorResponse`：`code: integer`、`message: string`、`requestId: string`，三项必填。
  - `PageRequest` / `PageInfo`：`page` 默认 1，`pageSize` 默认 20、最大 100。
  - `CursorRequest` / `CursorPageInfo`：不透明 cursor、limit、`nextCursor`、`hasMore`；具体
    `(created_at,id)` 编解码由 Service 负责，不进入前端。
  - `AiAssistStreamMeta` / `AiAssistStreamDelta` / `AiAssistStreamDone` /
    `AiAssistStreamError` 与最终文本结果。
  - `GenerationPlanQuoteView`、`CreditSummaryView`、`CreditLedgerItemView`，只使用已批准字段。
- `components.parameters.IdempotencyKey` 固定 Header 名与必填字符串类型，不提前冻结未批准的
  长度、字符集或 UUID 格式。
- 不声明 CSRF Token/Cookie/Header；不声明 WebSocket、通用 SSE、Provider 原始结构或内部
  `result_uncertain` 对账字段。
- Cookie 名来自部署配置，OAS `apiKey in: cookie` 却要求静态 name，因此本轮不伪造标准
  security scheme。schema 顶层描述明确同源用户/管理 Session 分离；具体路由认证由所属任务
  加入 operation 时同步冻结。

## Go 生成链

`server/api/generate.go` 只保存 `go:generate` 指令：

```text
go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.2
```

配置文件仅启用 `models: true` 与 `skip-prune: true`，输出到
`internal/models/dto/generated/types.gen.go`。使用精确 `@v2.7.2`，不把生成器及其传递依赖加入
产品 `server/go.mod/go.sum`。不启用 Gin server、strict server、client、embedded spec、overlay、
remote template 或 import mapping；Gin wrapper 与安全 ErrorHandler 属于 G0-T05。

## TypeScript 生成链

创建 tooling-only 的独立 `web/` npm 包：

- `package.json` 只包含精确 `devDependency: openapi-typescript@7.13.0` 和固定本地输入/输出的
  `generate:openapi` 脚本；关闭 `default-non-nullable`，避免带服务端默认值的可省略请求字段
  在 TypeScript 中被错误生成为必填。
- 提交独立 `package-lock.json`，使用 `npm ci` 保证传递依赖可重复。
- 输出 `web/src/api/generated/openapi.ts`，用户端和管理端以后共享这一 transport 类型文件，
  但不共享认证状态。
- 本任务不安装 React、Ant Design、Vite、Tailwind、Radix、shadcn 或任何 UI 源码；G5-T01
  负责真正 Web 应用壳。

## 合同测试

在 `server/internal/buildcontract` 增加标准库/YAML 驱动测试并使用独立坏例验证：

- 固定 OpenAPI 版本与初始空 paths。
- 递归拒绝非内部 `$ref`。
- 拒绝非 GET/POST method 与重复 operationId；测试必须注入坏 operation，避免空 paths 自证。
- 固定首批 component/字段/整数与 SSE payload，不出现 CSRF、凭据、Prompt、Provider raw 字段。
- 固定生成脚本版本、输入和输出路径；生成文件必须带禁止手改头且 Go 产物无 GORM tag。
- 固定 schema 与双端生成物的 SHA-256 审查快照，并对首批 schema 使用精确字段白名单；孤立
  手改任一文件会直接使合同测试失败。合法合同变更必须同时 review schema、双端生成 diff 与快照。

生成确定性在生成物进入 Git index 后使用真实命令二次生成，再运行 `git diff --exit-code` 验证；
这样首次新增的 untracked 文件也不会形成假绿。G0-T12 再把它纳入统一 Makefile/CI，不在本轮
提前改根 Makefile。

## 兼容、风险与回滚

- 新 Web 包没有运行时入口，不改变 Desktop 或部署行为。
- 初始 schema 没有 paths，因此不会虚假承诺可调用 API；后续 operation 增量改动必须 review
  schema 与双端生成 diff。
- OpenAPI 3.0 无法机器表达 SSE 帧顺序、flush、心跳和反压；components 只冻结 payload，行为
  留给 G4-T10/G0-T05 合同测试。
- 回滚可整体删除 schema、生成物和 tooling-only Web 包；不涉及数据库、配置或运行时迁移。
