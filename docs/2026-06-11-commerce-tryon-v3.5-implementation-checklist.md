# AI 服装展示图生成桌面端 v3.5 实施任务清单

> 来源方案：`docs/2026-06-11-commerce-tryon-v3.5-license-reviewed.md`
>
> 目标：把 v3.5 技术方案拆成**可推荐顺序、可执行、可标记、可验证**的任务清单。
>
> 适用方式：按阶段顺序推进；每个任务完成后勾选执行项、验证项和退出条件。若后续进入编码执行，每个 `Txx` 任务固定作为一个独立 agent 子任务或一个短会话任务。

---

## 0. 使用规则

### 0.1 状态标记

- [ ] 未开始
- [ ] 执行中
- [ ] 已完成
- [ ] 阻塞中，需在任务备注里记录阻塞原因

### 0.2 优先级

- `P0`：MVP 阻断项，不完成会导致后续无法可靠实现。
- `P1`：MVP 必交付项，影响主流程可用性。
- `P2`：评审增强项，影响稳定性、安全性或可试用质量。

### 0.3 验证口径

每个任务必须至少满足：

1. 本任务列出的验证项已执行；
2. 涉及的单元测试、集成测试或手工验收有明确结果；
3. 未通过项必须记录原因和剩余风险；
4. 不得把未执行的命令写成已通过。

### 0.4 并行调度边界

可并行：

- 桌面端 UI 骨架与本地 SQLite 初始化；
- 本地 SQLite schema 与前端静态节点组件；
- Provider Adapter 与任务历史 UI，但必须在统一任务模型确定后再接线。

必须串行：

- SQLite migration -> Rust repository/command -> 前端调用；
- PromptResolver -> `preview_resolved_prompt` -> `start_generation` 快照；
- 任务状态机 -> 取消/重试/启动恢复/事件兜底。

---

## 1. 推荐执行路线图

```text
R0 决策冻结
  ↓
R1 桌面骨架 + 本地数据库基础
  ↓
R2 资源、组合、Prompt、模型配置
  ↓
R3 任务状态机 + Provider 执行
  ↓
R4 取消、重试、历史、事件兜底
  ↓
R5 安全、脱敏、验收收口
  ↓
R6 第二期授权与支付
```

---

## 2. 阶段总览

| 阶段 | 推荐顺序 | 目标 | 关键产出 | 阻塞后续 |
| --- | ---: | --- | --- | --- |
| R0 | 0 | 冻结 MVP 范围与工程约束 | 决策记录、风险清单 | 是 |
| R1 | 1 | 建立 Tauri + React + SQLite 基础 | 可启动桌面应用、固定画布、迁移框架 | 是 |
| R2 | 2 | 完成本地资源、组合、Prompt、模型配置 | 可导入图片、保存组合、预览 Prompt | 是 |
| R3 | 3 | 跑通第三方生成主流程 | start_generation、状态机、结果保存 | 是 |
| R4 | 4 | 补齐任务生命周期与体验 | 取消、重试、历史、事件兜底 | 否 |
| R5 | 5 | 安全与验收收口 | 脱敏、安全配置、总验收 | 否 |
| R6 | 第二期 | 授权服务与支付闭环 | License Server、设备激活、权益、webhook | 否 |

---

# R0：MVP 决策冻结

## T00：冻结范围、依赖与验收口径

**优先级**：P0

**依赖**：无

**责任代理**：`scope_planner`

**目标**：把 v3.5 方案中的 MVP 必交付、暂不交付、强制约束固化为后续开发的边界。

**涉及文件**：

- 修改：项目 README 或新增 `docs/implementation-decisions.md`
- 参考：`docs/2026-06-11-commerce-tryon-v3.5-license-reviewed.md`

**执行清单**：

- [x] 明确 MVP 只做固定工作流，不做通用 DAG 和脚本节点。
- [x] 明确图片、组合、Prompt、任务历史只保存在本地工作区。
- [x] 明确本期不引入业务后端和授权后端。
- [x] 明确 MVP 只接入固定真实 Provider，不开放通用 custom Provider。
- [x] 明确 API Key 不进入前端持久化、SQLite、日志。
- [x] 明确全局只允许一个运行中生成任务。
- [x] 明确授权、License Server、设备激活、套餐功能开关和支付 webhook 属于第二期。

**验证清单**：

- [x] 决策文档能逐条映射原方案 `23.1`、`23.2`、`25.2`。
- [x] 后续任务中没有包含 MVP 明确暂不交付能力。
- [x] 所有涉及公共 API、数据库、依赖和配置的任务均标记为需人工确认或阶段评审。

**退出条件**：

- [x] 后续开发人员只看决策文档和本清单，也能判断什么该做、什么不该做。

---

# R1：桌面骨架与本地数据库基础

## T01：初始化 Tauri 2 + React + TypeScript 桌面应用

**优先级**：P0

**依赖**：T00

**责任代理**：`desktop_scaffold_worker`

**目标**：建立可启动的桌面端基础工程。

**涉及文件**：

- 创建：`desktop/package.json`
- 创建：`desktop/src/main.tsx`
- 创建：`desktop/src/app/App.tsx`
- 创建：`desktop/src-tauri/src/main.rs`
- 创建：`desktop/src-tauri/tauri.conf.json`

**执行清单**：

- [x] 初始化 Tauri 2.x + React + TypeScript 工程。
- [x] 建立 `desktop/src/app`、`desktop/src/features`、`desktop/src/shared` 基础目录。
- [x] 建立 `desktop/src-tauri/src/commands`、`domain`、`storage`、`services`、`error` 基础目录。
- [x] 配置桌面窗口标题、应用标识和基础启动入口。
- [x] 保留最小空白页面，不接入业务逻辑。

**验证清单**：

- [x] 按仓库实际脚本启动前端开发服务成功。
- [x] 按仓库实际脚本启动 Tauri 桌面应用成功。
- [x] 应用窗口能打开且无前端运行时错误。

**退出条件**：

- [x] 桌面应用可打开，并展示基础 App shell。

---

## T02：建立固定工作流画布骨架

**优先级**：P0

**依赖**：T01

**责任代理**：`workflow_ui_worker`

**目标**：渲染固定节点链路，不实现自由编排。

**涉及文件**：

- 创建：`desktop/src/features/workflow/components/WorkflowCanvas.tsx`
- 创建：`desktop/src/features/workflow/components/nodes/PersonInputNode.tsx`
- 创建：`desktop/src/features/workflow/components/nodes/GarmentGroupNode.tsx`
- 创建：`desktop/src/features/workflow/components/nodes/PromptConfigNode.tsx`
- 创建：`desktop/src/features/workflow/components/nodes/ModelSelectNode.tsx`
- 创建：`desktop/src/features/workflow/components/nodes/ExecuteNode.tsx`
- 创建：`desktop/src/features/workflow/components/nodes/ResultNode.tsx`
- 创建：`desktop/src/features/workflow/store/workflowStore.ts`
- 创建：`desktop/src/features/workflow/model/workflowTypes.ts`

**执行清单**：

- [x] 接入 React Flow。
- [x] 固定渲染人物图、服装组、Prompt、模型、执行、结果 6 类节点。
- [x] 节点连线固定，不暴露新增、删除、任意连线入口。
- [x] Zustand 只保存当前草稿、选中节点和 UI 派生状态。
- [x] React Flow `nodes[].data` 只由 store/query 派生，不作为业务事实保存。
- [x] ExecuteNode 初始状态为不可执行。

**验证清单**：

- [x] 打开应用后可看到固定工作流画布。
- [x] 可选中节点，选中态不改变业务数据。
- [x] 刷新页面或重新打开应用后，不依赖 React Flow 节点数据恢复业务事实。

**退出条件**：

- [x] 固定节点链路可视化完成，且没有自由 DAG 能力入口。

---

## T03：建立 SQLite migration 与单 writer 连接策略

**优先级**：P0

**依赖**：T01

**责任代理**：`sqlite_foundation_worker`

**目标**：建立本地工作区数据库基础，保证迁移、外键和写入串行化。

**技术约束**：

- Rust 使用 SQLx 操作 SQLite。
- SQLite migration 使用 `sqlx migrate` 体系管理。

**涉及文件**：

- 创建：`desktop/src-tauri/src/storage/sqlite.rs`
- 创建：`desktop/src-tauri/src/storage/migrations.rs`
- 创建：`desktop/src-tauri/src/storage/file_store.rs`
- 创建：`desktop/src-tauri/src/state.rs`
- 创建：`desktop/src-tauri/migrations/0001_init.sql`

**执行清单**：

- [x] 应用启动时创建工作区目录。
- [x] 应用启动时执行 SQLite migration。
- [x] SQLite migration 前自动备份 `workspace.db` 到工作区 `backups/` 目录。
- [x] 备份失败时阻止 migration。
- [x] SQLite 连接启用 `PRAGMA foreign_keys = ON`。
- [x] 写操作统一通过单 writer 连接串行化执行。
- [x] 迁移失败时应用启动必须清晰失败，不静默降级到无数据库模式。

**验证清单**：

- [x] 首次启动能创建 `workspace.db`。
- [x] 重复启动不会重复执行已完成 migration。
- [x] 外键约束实际生效。
- [x] 并发写入不会绕过单 writer 策略。

**退出条件**：

- [x] 本地数据库可迁移、可查询、可约束，后续任务可基于此实现 CRUD。

---

## T04：实现启动恢复运行中任务

**优先级**：P0

**依赖**：T03

**责任代理**：`startup_recovery_worker`

**目标**：应用启动时清理历史运行中任务，避免 partial unique index 阻塞新任务。

**涉及文件**：

- 修改：`desktop/src-tauri/src/storage/sqlite.rs`
- 修改：`desktop/src-tauri/src/services/task_runner.rs`
- 修改：`desktop/src-tauri/src/state.rs`

**执行清单**：

- [x] 定义运行中状态集合：`queued`、`preparing`、`calling_model`、`waiting_result`、`saving_result`。
- [x] 启动时把历史运行中任务置为 `failed`。
- [x] 失败码写入 `APP_UNEXPECTED_SHUTDOWN`。
- [x] 保留任务快照和历史记录，不删除任务。
- [x] 恢复后允许创建新的运行中任务。

**验证清单**：

- [x] 手动构造运行中任务后启动应用，任务变为 failed。
- [x] 失败原因包含 `APP_UNEXPECTED_SHUTDOWN`。
- [x] 启动恢复后可创建新任务。

**退出条件**：

- [x] 应用异常退出不会永久阻塞后续生成任务。

---

# R2：资源、组合、Prompt 与模型配置

## T05：实现本地 assets 表、文件导入与相对路径存储

**优先级**：P0

**依赖**：T03

**责任代理**：`asset_worker`

**目标**：导入人物图、服装图和结果图，所有持久化路径使用工作区相对路径。

**涉及文件**：

- 修改：`desktop/src-tauri/migrations/0001_init.sql`
- 创建：`desktop/src-tauri/src/domain/asset.rs`
- 创建：`desktop/src-tauri/src/commands/assets.rs`
- 修改：`desktop/src-tauri/src/storage/file_store.rs`
- 创建：`desktop/src/features/assets/model/assetTypes.ts`
- 创建：`desktop/src/features/assets/services/assetService.ts`

**执行清单**：

- [x] 创建 `assets` 表。
- [x] 实现 `import_image` Tauri command。
- [x] 复制导入图片到工作区 assets 目录。
- [x] 导入文件统一命名为 `asset_<ULID>.<ext>`。
- [x] 只保存工作区相对路径。
- [x] 计算 sha256。
- [x] `sha256` 只作为数据库去重字段，不参与文件名生成。
- [x] 同一 `assets.type` 内按 sha256 去重。
- [x] 同一文件作为 person 与 garment 导入时创建不同 Asset。
- [x] 导入时生成 JPEG 缩略图，保存到 `assets/cache/thumbs/{assetId}.jpg`。

**验证清单**：

- [x] 导入人物图成功。
- [x] 导入服装图成功。
- [x] `workspace.db` 不出现用户导入前的完整本地路径。
- [x] 同 type 重复导入直接复用已有 Asset，并返回 `duplicate=true`。
- [x] 不同 type 导入同一文件生成不同 Asset。
- [x] 工作区文件名符合 `asset_<ULID>.<ext>`。

**退出条件**：

- [x] 资源库可展示导入图片，且数据库路径脱敏满足方案要求。

---

## T06：实现图片组合表与保存/读取/列表/校验命令

**优先级**：P0

**依赖**：T05

**责任代理**：`combination_worker`

**目标**：支持创建、保存、切换图片组合。

**涉及文件**：

- 修改：`desktop/src-tauri/migrations/0001_init.sql`
- 创建：`desktop/src-tauri/src/domain/combination.rs`
- 创建：`desktop/src-tauri/src/commands/combinations.rs`
- 创建：`desktop/src/features/assets/model/combinationTypes.ts`
- 创建：`desktop/src/features/assets/services/combinationService.ts`

**执行清单**：

- [x] 创建 `image_combinations` 表。
- [x] 创建 `image_combination_items` 表。
- [x] 实现 `save_image_combination`。
- [x] `save_image_combination` 使用事务全量替换 items。
- [x] 实现 `get_image_combination`。
- [x] 实现 `list_image_combinations`。
- [x] 实现基础 `validate_combination`，先校验人物图、服装图数量和资源存在性。

**验证清单**：

- [x] 可创建包含 1 张人物图和多张服装图的组合。
- [x] 保存后重新读取，图片顺序和角色保持一致。
- [x] 删除或缺失资源时校验返回明确错误。
- [x] 保存组合不会形成 `image_combinations` 与 `prompt_bindings` 循环外键。

**退出条件**：

- [x] 画布节点能从 SQLite 权威数据展示当前组合。

---

## T07：实现 delete_asset 引用检查与孤儿文件 GC

**优先级**：P1

**依赖**：T05、T06

**责任代理**：`asset_gc_worker`

**目标**：删除资源时保护组合与历史任务引用，并在文件删除失败时留下可恢复 GC 记录。

**涉及文件**：

- 修改：`desktop/src-tauri/src/commands/assets.rs`
- 修改：`desktop/src-tauri/src/storage/file_store.rs`
- 修改：`desktop/src-tauri/migrations/0001_init.sql`

**执行清单**：

- [ ] `delete_asset` 先检查组合引用。
- [ ] `delete_asset` 先检查历史任务输入和结果引用。
- [ ] 被引用 asset 默认不可删除。
- [ ] 未引用 asset 先提交数据库事务，再删除文件。
- [ ] 文件删除失败时不回滚数据库事务。
- [ ] 文件删除失败写入 GC 日志或待清理表。
- [ ] 应用启动和打开资源库时执行轻量 GC。
- [ ] GC 只扫描工作区 `assets/` 和 `cache/`。

**验证清单**：

- [ ] 被组合引用的 asset 不可删除。
- [ ] 被历史任务引用的 asset 不可删除。
- [ ] 模拟文件删除失败时，数据库记录已删除且 GC 记录存在。
- [ ] GC 不扫描用户原始导入路径。

**退出条件**：

- [ ] 删除资源不会制造坏引用，也不会触碰工作区外文件。

---

## T08：实现 Rust PromptResolver 单权威

**优先级**：P0

**依赖**：T06

**责任代理**：`prompt_resolver_worker`

**目标**：Prompt 解析只在 Rust 层实现，预览与执行共用同一 Resolver。

**涉及文件**：

- 修改：`desktop/src-tauri/migrations/0001_init.sql`
- 创建：`desktop/src-tauri/src/domain/prompt.rs`
- 创建：`desktop/src-tauri/src/services/prompt_resolver.rs`
- 创建：`desktop/src-tauri/src/commands/prompts.rs`
- 创建：`desktop/src/features/prompt/model/promptTypes.ts`
- 创建：`desktop/src/features/prompt/services/promptService.ts`

**执行清单**：

- [x] 创建 `prompt_templates` 表。
- [x] 创建 `prompt_bindings` 表，并以 `combination_id UNIQUE` 作为唯一事实来源。
- [x] 支持 `default`、`append`、`override` 三种 Prompt 修改模式。
- [x] 校验模板占位符与 `variables_json` 声明一致。
- [x] required 变量缺失时返回明确错误。
- [x] 声明 required 但模板未使用时返回 warning。
- [x] 实现 `save_prompt_binding`。
- [x] 实现 `preview_resolved_prompt`。
- [x] 前端最终 Prompt 预览只调用 `preview_resolved_prompt`。

**验证清单**：

- [x] 模板出现未声明变量时返回 `PROMPT_TEMPLATE_INVALID`。
- [ ] required 变量缺失时 `validate_combination` 阻止执行。
- [x] 同一 PromptBinding 的预览结果可被后续 `start_generation` 复用为快照。

**退出条件**：

- [x] 前端没有第二套 Prompt 拼接逻辑。

---

## T09：实现模型定义、参数表单与输入限制派生

**优先级**：P0

**依赖**：T06、T08

**责任代理**：`model_config_worker`

**目标**：模型选择和参数配置由 `ModelDefinition` 驱动，服装图 min/max 从模型能力派生。

**涉及文件**：

- 修改：`desktop/src-tauri/migrations/0001_init.sql`
- 创建：`desktop/src-tauri/src/domain/model.rs`
- 创建：`desktop/src-tauri/src/commands/models.rs`
- 创建：`desktop/src-tauri/src/services/model_validator.rs`
- 创建：`desktop/src/features/model-config/model/modelTypes.ts`
- 创建：`desktop/src/features/model-config/services/modelService.ts`

**执行清单**：

- [x] 定义固定 Provider 的 `ModelDefinition`。
- [x] 定义 `ModelParamSchema`。
- [x] 创建 `model_configs` 表。
- [x] 实现 `list_model_definitions`。
- [x] 实现 `save_model_config`。
- [x] 服装图数量限制从 `ModelDefinition.inputLimits` 派生。
- [x] 输出数量通过 `output.countParamKey` 归一化为 `normalizedOutputCount`。
- [x] 高级模型在本期由本地模型定义控制，不接入套餐权益。

**验证清单**：

- [ ] 切换模型后，服装图 min/max 校验随模型变化。
- [x] 参数表单能保存并重新读取。
- [x] `advancedModels=false` 时前端不可选择高级模型。

**退出条件**：

- [ ] 模型配置能参与 `validate_combination` 和后续生成快照。

---

## T10：实现草稿态 validate_combination

**优先级**：P0

**依赖**：T06、T08、T09

**责任代理**：`validation_worker`

**目标**：执行按钮状态由 Rust 权威校验返回，且基于当前 UI 草稿。

**涉及文件**：

- 修改：`desktop/src-tauri/src/commands/combinations.rs`
- 修改：`desktop/src-tauri/src/services/model_validator.rs`
- 修改：`desktop/src/features/workflow/store/workflowStore.ts`
- 修改：`desktop/src/features/workflow/components/nodes/ExecuteNode.tsx`

**执行清单**：

- [x] `validate_combination` 支持 `draftCombination`。
- [x] `validate_combination` 支持 `draftPromptBinding`。
- [x] `validate_combination` 支持 `draftModelConfig`。
- [x] 请求包含 `revision`。
- [x] 前端只接受最新 revision 的校验结果。
- [x] 返回结构化 reasons、warnings、effective limits。
- [x] 本期不接入 LicenseGuard；授权与套餐限制第二期再接入。

**验证清单**：

- [ ] 修改人物图后立即影响校验结果。
- [ ] 修改服装图顺序后校验基于当前草稿。
- [x] 修改 Prompt 或模型参数后校验基于当前草稿。
- [x] 旧 revision 返回不会覆盖新 revision 的执行按钮状态。

**退出条件**：

- [x] ExecuteNode 的可执行状态只来自 Rust 校验结果。

---

# R6：第二期授权与支付闭环

> 第二期需求。本期 MVP 不执行 T11-T17、T28-T29；这些任务仅作为后续授权和支付落地清单。

## T11：初始化 License Server 工程与 PostgreSQL migration

**优先级**：P2（二期）

**依赖**：T00

**责任代理**：`license_server_db_worker`

**目标**：建立轻量授权后端，不接收商拍业务数据。

**技术约束**：

- 后端语言使用 Go 1.22+。
- HTTP 框架固定使用 Gin。
- 数据库使用 PostgreSQL 15+。
- 数据访问使用 pgx + sqlc，迁移使用 goose。
- 第二期首版不引入 Redis，激活码状态查询和激活接口使用进程内限流。

**涉及文件**：

- 创建：`license-server/go.mod`
- 创建：`license-server/cmd/server/main.go`
- 创建：`license-server/internal/api/router.go`
- 创建：`license-server/internal/config/config.go`
- 创建：`license-server/migrations/0001_init.sql`

**执行清单**：

- [ ] 初始化 Go 1.22+ 服务。
- [ ] 接入 Gin 作为 License Server HTTP router。
- [ ] 建立 PostgreSQL 连接。
- [ ] 实现进程内限流器，用于激活码状态查询和激活接口。
- [ ] 创建 `licenses` 表。
- [ ] 创建 `license_devices` 表。
- [ ] 创建 `license_refresh_tokens` 表。
- [ ] 创建 `license_payment_links` 表。
- [ ] 创建 `payment_events` 表。
- [ ] 创建 `license_audit_logs` 表。
- [ ] activation code 只保存 server pepper hash。
- [ ] refresh token 只保存 hash。
- [ ] License 相关表不得通过物理删除丢失审计链路。

**验证清单**：

- [ ] migration 可在空 PostgreSQL 上执行成功。
- [ ] `license_payment_links.provider_order_id` 非空。
- [ ] `(provider, provider_order_id)` 使用唯一索引。
- [ ] provider customer/subscription 只能作为辅助字段。
- [ ] 表结构不包含图片、Prompt、任务历史或工作区数据库字段。

**退出条件**：

- [ ] License Server 数据库满足 v3.5 授权边界。

---

## T12：实现 License 创建与状态查询 API

**优先级**：P2（二期）

**依赖**：T11

**责任代理**：`license_api_worker`

**目标**：提供 License 创建、激活码状态查询和基础审计。

**涉及文件**：

- 创建：`license-server/internal/api/license_handler.go`
- 创建：`license-server/internal/app/license_service.go`
- 创建：`license-server/internal/app/audit_service.go`
- 创建：`license-server/internal/domain/license.go`
- 创建：`license-server/internal/infra/postgres/license_repo.go`

**执行清单**：

- [ ] 实现 `POST /v1/licenses`。
- [ ] 创建 License 时返回明文 `activationCode`，且只返回一次。
- [ ] activation code 使用高熵随机值。
- [ ] 支付自动创建 License 时必须传入 paymentOrderId。
- [ ] paymentOrderId 同事务写入 `license_payment_links.provider_order_id`。
- [ ] paymentProvider 为 manual 时不写入支付 link。
- [ ] 仅传 customerId 或 subscriptionId 时不得创建 webhook 定位 link。
- [ ] 实现 `POST /v1/licenses/status`。
- [ ] status 请求敏感字段只允许放 body。
- [ ] 状态查询和激活相关接口统一错误，避免枚举 License。
- [ ] 写入审计日志。

**验证清单**：

- [ ] 创建 License 返回 `activationCode`、`licenseId`、`status`、`entitlements`。
- [ ] 明文 activationCode 不入库。
- [ ] status 对 active/expired/revoked/suspended 返回正确状态和权益。
- [ ] 激活码不出现在日志和 URL query。

**退出条件**：

- [ ] 可通过 License Server 创建授权并查询状态。

---

## T13：实现设备激活、解绑与设备数限制

**优先级**：P2（二期）

**依赖**：T12

**责任代理**：`license_device_worker`

**目标**：完成设备绑定、重复激活幂等和当前设备解绑。

**涉及文件**：

- 创建：`license-server/internal/api/device_handler.go`
- 创建：`license-server/internal/app/device_service.go`
- 创建：`license-server/internal/domain/device.go`
- 修改：`license-server/internal/infra/postgres/license_repo.go`

**执行清单**：

- [ ] 实现 `POST /v1/licenses/activate`。
- [ ] 同一设备重复激活不得重复占用设备数。
- [ ] 超过 maxDevices 返回 `LICENSE_DEVICE_LIMIT_EXCEEDED`。
- [ ] 实现 `POST /v1/licenses/deactivate-current-device`。
- [ ] deactivate 不信任客户端传入 deviceId。
- [ ] 服务端从 token 推导当前设备。
- [ ] 解绑后标记 device 为 deactivated。
- [ ] 解绑后标记该设备 refresh token revoked。
- [ ] 写入审计日志。

**验证清单**：

- [ ] 同设备重复激活设备数不增加。
- [ ] 超设备数激活失败。
- [ ] 解绑后受限功能权益返回禁用。
- [ ] 解绑不物理删除 refresh token 记录。

**退出条件**：

- [ ] License 与设备绑定关系可可靠维护。

---

## T14：实现 Ed25519 licenseToken 签名与 refresh token rotation

**优先级**：P2（二期）

**依赖**：T13

**责任代理**：`token_service_worker`

**目标**：实现可离线验签的 licenseToken 和安全 refresh token 轮换。

**涉及文件**：

- 创建：`license-server/internal/app/token_service.go`
- 创建：`license-server/internal/infra/signer/ed25519_signer.go`
- 修改：`license-server/internal/api/license_handler.go`
- 修改：`license-server/internal/infra/postgres/license_repo.go`

**执行清单**：

- [ ] licenseToken payload 包含 `iat`、`nbf`、`exp`。
- [ ] JWS header 包含 `kid`。
- [ ] 服务端私钥只存在服务端配置或密钥管理系统。
- [ ] refresh token 只保存 hash。
- [ ] refresh token 使用后立即 rotation。
- [ ] 服务端事务中用行级锁处理 rotation。
- [ ] 旧 token 重放返回 `REFRESH_TOKEN_REUSED`。
- [ ] device deactivated 优先于 reused 判断。
- [ ] expired/revoked/suspended 不返回新 token。

**验证清单**：

- [ ] 客户端可用公钥验证 token。
- [ ] 旧 refresh token 再次使用返回 `REFRESH_TOKEN_REUSED`。
- [ ] 并发 refresh 不产生两个有效 refresh token。
- [ ] revoked/suspended/expired 不签发新 token。

**退出条件**：

- [ ] 授权 token 具备签名、轮换、重放识别和密钥轮换基础。

---

## T15：实现套餐功能开关 API

**优先级**：P2（二期）

**依赖**：T14

**责任代理**：`entitlement_worker`

**目标**：License Server 返回当前 License、设备状态和功能开关。

**涉及文件**：

- 创建：`license-server/internal/api/entitlement_handler.go`
- 创建：`license-server/internal/app/entitlement_service.go`
- 创建：`license-server/internal/domain/entitlement.go`

**执行清单**：

- [ ] 实现 `POST /v1/licenses/entitlements`。
- [ ] 返回 `licenseId`、`deviceId`、`status`、`deviceStatus`、`entitlements`。
- [ ] 服务端验签后查询 `licenses` 和 `license_devices` 当前状态。
- [ ] 不只信任 token payload。
- [ ] revoked/suspended/expired/device deactivated 返回禁用后的 entitlements。

**验证清单**：

- [ ] active 设备返回启用权益。
- [ ] device deactivated 返回禁用权益。
- [ ] revoked/suspended/expired 返回禁用权益。

**退出条件**：

- [ ] 客户端必须获得服务端权威套餐功能开关。

---

## T16：实现客户端 license_state、系统密钥库与授权命令

**优先级**：P2（二期）

**依赖**：T11、T14、T15

**责任代理**：`desktop_license_worker`

**目标**：客户端通过 Rust command 完成激活、刷新、状态和权益查询；token 进入系统密钥库。

**涉及文件**：

- 修改：`desktop/src-tauri/migrations/0001_init.sql`
- 创建：`desktop/src-tauri/src/domain/license.rs`
- 创建：`desktop/src-tauri/src/services/license_client.rs`
- 创建：`desktop/src-tauri/src/services/token_verifier.rs`
- 创建：`desktop/src-tauri/src/services/credential_service.rs`
- 创建：`desktop/src-tauri/src/commands/license.rs`
- 创建：`desktop/src/features/license/model/licenseTypes.ts`
- 创建：`desktop/src/features/license/services/licenseService.ts`

**执行清单**：

- [ ] 创建客户端 `license_state` 表。
- [ ] `license_state` 只保存授权状态、过期时间、功能开关缓存和错误状态。
- [ ] `licenseToken` 保存到系统密钥库。
- [ ] `refreshToken` 保存到系统密钥库。
- [ ] 首次启动生成 `installationId` 与 `appInstallSalt` 并保存到系统密钥库。
- [ ] 设备指纹使用 `HMAC-SHA256(appInstallSalt, installationId)`。
- [ ] 实现 `activate_license`。
- [ ] 实现 `check_license_activation_code`。
- [ ] 实现 `get_license_status`。
- [ ] 实现 `refresh_license_token`。
- [ ] 实现 `deactivate_current_device`。
- [ ] 实现 `get_license_entitlements`。
- [ ] 前端不得直接调用 License Server。

**验证清单**：

- [ ] 激活成功后写入 device_status=active、local_auth_state=active。
- [ ] token 不出现在 SQLite、日志和前端持久化状态。
- [ ] keychain 缺少 refreshToken 时不调用 License Server，并返回禁用视图。
- [ ] keychain 读取失败时不调用 License Server，并返回禁用视图。
- [ ] deactivate 后立即禁用受限功能。

**退出条件**：

- [ ] 桌面端授权状态可本地缓存、可刷新、可禁用，且 token 不落入不安全存储。

---

## T17：实现 LicenseGuard 与 ExecuteNode 授权态展示

**优先级**：P2（二期）

**依赖**：T10、T16

**责任代理**：`license_guard_worker`

**目标**：受限功能必须在 Rust 执行入口校验，前端禁用只作为提示。

**涉及文件**：

- 创建：`desktop/src-tauri/src/services/license_guard.rs`
- 修改：`desktop/src-tauri/src/commands/combinations.rs`
- 修改：`desktop/src-tauri/src/commands/generation.rs`
- 创建：`desktop/src/features/license/components/LicenseActivationPanel.tsx`
- 修改：`desktop/src/features/workflow/components/nodes/ExecuteNode.tsx`

**执行清单**：

- [ ] `LicenseGuard.require_active` 读取系统密钥库 licenseToken。
- [ ] 本地验签 licenseToken。
- [ ] 校验 token 过期时间和 offlineGraceUntil。
- [ ] 要求 `status=active`。
- [ ] 要求 `device_status=active`。
- [ ] 要求 `local_auth_state=active`。
- [ ] `validate_combination` 返回 license 状态、effectiveEntitlements、featureDeniedReason。
- [ ] `generation=false` 时 start_generation 返回 `FEATURE_NOT_ENTITLED`。
- [ ] `exportResult=false` 时 Rust 导出命令拒绝执行。
- [ ] `advancedModels=false` 时 Rust 执行入口拒绝高级模型。

**验证清单**：

- [ ] 未授权时 ExecuteNode 不显示可执行。
- [ ] revoked/suspended/expired/device deactivated 后立即禁用受限功能。
- [ ] 前端绕过按钮直接调用 command 时，Rust 仍拒绝。
- [ ] 离线宽限过期后付费功能禁用，但本地数据不被破坏。

**退出条件**：

- [ ] 授权不只是 UI 控制，Rust 入口具备强制守卫。

---

# R3：任务状态机与第三方 Provider 执行

## T18：实现 generation_tasks 与任务快照结构

**优先级**：P0

**依赖**：T08、T09、T10

**责任代理**：`task_schema_worker`

**目标**：任务创建时保存不可变快照，历史可追溯且不保存 base64 或敏感信息。

**涉及文件**：

- 修改：`desktop/src-tauri/migrations/0001_init.sql`
- 创建：`desktop/src-tauri/src/domain/task.rs`
- 创建：`desktop/src/features/generation-task/model/taskTypes.ts`

**执行清单**：

- [ ] 创建 `generation_tasks` 表。
- [ ] 创建 `generation_task_results` 表。
- [ ] 创建 `generation_task_input_assets` 表。
- [ ] 增加 `(combination_id, created_at DESC)` 复合索引。
- [ ] 任务快照保存 final prompt、模型参数、输入 asset 相对路径。
- [ ] `request_summary_json` 禁止保存 base64。
- [ ] `rawResponse` 不持久化。
- [ ] `source_url` 保存前脱敏，无法确认安全时保存为 `NULL`。

**验证清单**：

- [ ] 执行后修改组合、Prompt、模型参数，历史任务仍显示当时快照。
- [ ] `workspace.db` 不包含 base64、API Key、Authorization Header、完整本地路径。
- [ ] 输入 asset 与结果 asset 可结构化追溯。

**退出条件**：

- [ ] 任务历史具备不可变快照和安全持久化边界。

---

## T19：实现 AppState、CancellationToken 与单任务约束

**优先级**：P0

**依赖**：T04、T18

**责任代理**：`task_runtime_worker`

**目标**：全局只允许一个运行中任务，并由 Rust AppState 管理取消句柄。

**涉及文件**：

- 修改：`desktop/src-tauri/src/state.rs`
- 创建：`desktop/src-tauri/src/services/task_runner.rs`
- 创建：`desktop/src-tauri/src/commands/generation.rs`
- 修改：`desktop/src-tauri/migrations/0001_init.sql`

**执行清单**：

- [ ] AppState 管理运行中任务。
- [ ] AppState 管理 CancellationToken。
- [ ] 前端不得保存取消句柄。
- [ ] 数据库增加 partial unique index，限制全局运行中任务。
- [ ] `start_generation` 使用事务创建任务。
- [ ] Rust 单飞机制防止并发创建任务。
- [ ] 任务结束后清理 CancellationToken。

**验证清单**：

- [ ] 快速双击执行按钮最多创建一个运行中任务。
- [ ] 两个窗口同时调用 start_generation，最多创建一个运行中任务。
- [ ] 第二个请求返回明确的已有任务运行中错误。
- [ ] 任务成功、失败、取消后 CancellationToken 被清理。

**退出条件**：

- [ ] 单任务并发由 Rust 和 SQLite 双重保证。

---

## T20：实现固定 Provider Adapter

**优先级**：P1

**依赖**：T09

**责任代理**：`provider_adapter_worker`

**目标**：接入至少一个固定第三方生图 API，不开放通用 custom Provider。

**涉及文件**：

- 创建：`desktop/src-tauri/src/providers/provider_trait.rs`
- 创建：`desktop/src-tauri/src/providers/openai_provider.rs`
- 创建：`desktop/src-tauri/src/providers/mod.rs`
- 修改：`desktop/src-tauri/src/services/credential_service.rs`

**执行清单**：

- [ ] 定义统一 Provider 输入。
- [ ] 定义统一 Provider 输出。
- [ ] 实现至少一个固定 Provider。
- [ ] API Key 由 Rust 层从系统密钥库读取。
- [ ] 前端只展示是否已配置和脱敏状态。
- [ ] Provider 超时、取消和错误返回可映射到统一任务错误。
- [ ] 不实现自定义 base URL Provider。

**验证清单**：

- [ ] API Key 不进入前端、SQLite、日志或任务摘要。
- [ ] Provider 调用失败时返回结构化错误。
- [ ] Provider 返回摘要脱敏。
- [ ] source_url 不含签名参数、token 或临时访问凭证。

**退出条件**：

- [ ] 可安全调用一个固定真实 Provider。

---

## T21：实现 start_generation 端到端主流程

**优先级**：P0

**依赖**：T18、T19、T20

**责任代理**：`generation_flow_worker`

**目标**：点击执行后完成组合校验、Provider 调用、结果保存和任务状态更新。

**涉及文件**：

- 修改：`desktop/src-tauri/src/commands/generation.rs`
- 修改：`desktop/src-tauri/src/services/task_runner.rs`
- 修改：`desktop/src-tauri/src/services/prompt_resolver.rs`
- 修改：`desktop/src-tauri/src/storage/file_store.rs`
- 创建：`desktop/src/features/generation-task/services/taskService.ts`
- 修改：`desktop/src/features/workflow/components/nodes/ExecuteNode.tsx`
- 修改：`desktop/src/features/workflow/components/nodes/ResultNode.tsx`

**执行清单**：

- [ ] `start_generation` 基于当前草稿或已保存配置做权威校验。
- [ ] 创建任务时保存不可变快照。
- [ ] `final_prompt_snapshot_json` 来自 Rust PromptResolver。
- [ ] 状态流转覆盖 queued、preparing、calling_model、waiting_result、saving_result、succeeded、failed。
- [ ] 保存结果图片到工作区。
- [ ] 写入 `generation_task_results`。
- [ ] ResultNode 展示结果缩略图和打开大图入口。

**验证清单**：

- [ ] Prompt 预览结果与任务快照完全一致。
- [ ] 用户执行后修改组合或 Prompt，历史任务仍显示执行时快照。
- [ ] 成功任务能展示结果并打开大图。
- [ ] 失败任务保存失败原因。

**退出条件**：

- [ ] MVP 主流程可真实生成并保存结果。

---

## T22：实现 Tauri task-updated 事件与主动拉取兜底

**优先级**：P1

**依赖**：T21

**责任代理**：`task_event_worker`

**目标**：前端既能接收实时事件，也能在事件丢失后主动拉取恢复状态。

**涉及文件**：

- 修改：`desktop/src-tauri/src/services/task_runner.rs`
- 修改：`desktop/src-tauri/src/commands/generation.rs`
- 创建：`desktop/src/features/generation-task/store/taskStore.ts`
- 创建：`desktop/src/features/generation-task/services/taskEventService.ts`

**执行清单**：

- [ ] Rust 推送 `task-updated` 事件。
- [ ] 前端监听 `task-updated`。
- [ ] 实现 `get_generation_task`。
- [ ] 实现 `list_running_generation_tasks`。
- [ ] 实现 `list_recent_generation_tasks`。
- [ ] 前端启动时主动拉取运行中任务。
- [ ] 进入任务页面时主动拉取最新任务状态。

**验证清单**：

- [ ] 正常执行时 UI 实时更新状态。
- [ ] 前端错过事件后，重新进入页面能恢复正确状态。
- [ ] 启动恢复生成的 `APP_UNEXPECTED_SHUTDOWN` 任务能被 `list_recent_generation_tasks` 返回。

**退出条件**：

- [ ] 任务状态不依赖单一事件通道。

---

# R4：取消、重试、历史与界面收口

## T23：实现 cancel_generation_task

**优先级**：P1

**依赖**：T19、T21

**责任代理**：`cancel_task_worker`

**目标**：支持本地取消，并按 Provider 能力记录远端取消状态。

**涉及文件**：

- 修改：`desktop/src-tauri/src/commands/generation.rs`
- 修改：`desktop/src-tauri/src/services/task_runner.rs`
- 修改：`desktop/src-tauri/src/providers/provider_trait.rs`
- 修改：`desktop/src/features/workflow/components/nodes/ExecuteNode.tsx`

**执行清单**：

- [ ] 实现 `cancel_generation_task`。
- [ ] 本地取消触发 AppState 中 CancellationToken。
- [ ] Provider 支持远端取消时记录 `remote_confirmed`。
- [ ] Provider 不支持远端取消时记录 `remote_not_supported`。
- [ ] UI 提示可能继续计费的场景。
- [ ] `CancelMode` 持久化值使用 snake_case。

**验证清单**：

- [ ] 执行中任务可取消。
- [ ] Provider 支持远端取消时状态记录正确。
- [ ] Provider 不支持远端取消时提示正确。
- [ ] 取消后可再次创建新任务。

**退出条件**：

- [ ] 用户可停止本地等待，并获得清晰取消结果。

---

## T24：实现 retry_generation_task 与 rerun_generation_from_current_combination

**优先级**：P1

**依赖**：T18、T21

**责任代理**：`retry_rerun_worker`

**目标**：区分基于历史快照重试和基于当前配置重跑。

**涉及文件**：

- 修改：`desktop/src-tauri/src/commands/generation.rs`
- 修改：`desktop/src-tauri/src/services/task_runner.rs`
- 修改：`desktop/src/features/generation-task/services/taskService.ts`

**执行清单**：

- [ ] 实现 `retry_generation_task(taskId)`。
- [ ] retry 使用原任务快照。
- [ ] retry 前检查输入文件存在。
- [ ] 输入文件缺失返回 `ASSET_FILE_MISSING`，包含 assetId、fileName、role。
- [ ] 实现 `rerun_generation_from_current_combination(combinationId)`。
- [ ] rerun 使用当前组合、Prompt 和模型配置。
- [ ] 两种任务的快照来源可在历史中区分。

**验证清单**：

- [ ] retry 结果中的 `final_prompt_snapshot_json` 与原任务一致。
- [ ] rerun 结果中的 `final_prompt_snapshot_json` 使用当前配置。
- [ ] 删除原输入图片后 retry 返回 `ASSET_FILE_MISSING`。

**退出条件**：

- [ ] 用户能明确选择“重试旧任务”或“按当前配置再跑一次”。

---

## T25：实现任务历史与失败原因展示

**优先级**：P1

**依赖**：T18、T22、T24

**责任代理**：`history_ui_worker`

**目标**：展示任务历史、失败原因、输入快照、Prompt 快照和结果。

**涉及文件**：

- 创建：`desktop/src/features/generation-task/components/TaskHistoryPanel.tsx`
- 创建：`desktop/src/features/generation-task/components/TaskDetailPanel.tsx`
- 修改：`desktop/src/features/workflow/components/nodes/ResultNode.tsx`
- 修改：`desktop/src-tauri/src/commands/generation.rs`

**执行清单**：

- [ ] 实现 `list_recent_generation_tasks` UI。
- [ ] 实现 `list_generation_tasks_by_combination`。
- [ ] 展示任务状态、失败码和失败原因。
- [ ] 展示输入 asset 快照。
- [ ] 展示 final prompt 快照。
- [ ] 展示模型参数快照。
- [ ] 展示结果图和打开大图入口。
- [ ] 提供 retry 和 rerun 入口。

**验证清单**：

- [ ] 成功任务可查看结果。
- [ ] 失败任务可查看失败原因。
- [ ] 修改当前组合后，历史任务详情不变。
- [ ] retry/rerun 入口调用正确 command。

**退出条件**：

- [ ] 用户可追溯每次生成的输入、Prompt、模型参数和结果。

---

## T26：实现 API Key 设置界面与脱敏状态展示

**优先级**：P1

**依赖**：T20

**责任代理**：`credential_ui_worker`

**目标**：用户可配置 Provider API Key，但前端不能读取明文。

**涉及文件**：

- 修改：`desktop/src-tauri/src/commands/credentials.rs`
- 创建：`desktop/src/features/model-config/components/ProviderSettingsPanel.tsx`
- 修改：`desktop/src/features/model-config/services/modelService.ts`

**执行清单**：

- [ ] 实现 `set_provider_api_key`。
- [ ] 实现 `get_provider_credential_status`。
- [ ] API Key 写入系统密钥库。
- [ ] 前端只展示是否已配置和脱敏尾号。
- [ ] 保存失败向用户展示明确错误。

**验证清单**：

- [ ] API Key 不出现在 SQLite。
- [ ] API Key 不出现在前端持久化状态。
- [ ] API Key 不出现在日志。
- [ ] Provider 调用由 Rust 层读取 key。

**退出条件**：

- [ ] 用户可安全配置固定 Provider 凭据。

---

# R5：安全与最终验收

## T27：实现 Tauri 安全配置与日志脱敏

**优先级**：P0

**依赖**：T21、T26

**责任代理**：`desktop_security_worker`

**目标**：收紧桌面端 command、文件系统、CSP、外链和日志边界。

**涉及文件**：

- 修改：`desktop/src-tauri/tauri.conf.json`
- 修改：`desktop/src-tauri/src/error/app_error.rs`
- 修改：`desktop/src-tauri/src/services/task_runner.rs`

**执行清单**：

- [ ] Tauri command capability 最小授权。
- [ ] 文件系统 scope 限定工作区和用户选择文件。
- [ ] 外部 URL 访问做协议和目标校验。
- [ ] URL 下载禁止访问私有地址段。
- [ ] 日志脱敏 API Key、Authorization 和 Provider 请求敏感信息。
- [ ] 日志脱敏用户导入前完整本地路径。
- [ ] 禁止持久化 Provider raw response。

**验证清单**：

- [ ] 日志中不出现 API Key、Authorization Header 和 Provider 原始响应。
- [ ] `workspace.db` 不出现完整本地路径。
- [ ] Tauri 文件访问不能越权读取工作区外非用户选择文件。
- [ ] 外链和下载 URL 校验可拒绝不安全目标。

**退出条件**：

- [ ] 桌面端满足 v3.5 安全边界。

---

## T28：实现支付 webhook 签名校验与幂等处理

> 第二期需求。本期 MVP 不执行。

**优先级**：P2（二期）

**依赖**：T11、T12

**责任代理**：`payment_webhook_worker`

**目标**：License Server 能通过支付事件创建、续期、取消或暂停 License。

**涉及文件**：

- 创建：`license-server/internal/api/payment_webhook_handler.go`
- 创建：`license-server/internal/app/payment_service.go`
- 创建：`license-server/internal/domain/payment_event.go`
- 创建：`license-server/internal/infra/payment/verifier.go`

**执行清单**：

- [ ] 接收支付平台 webhook。
- [ ] 验证平台签名。
- [ ] 使用事件 ID 幂等处理重复投递。
- [ ] webhook 从事件中提取支付订单 ID。
- [ ] webhook 通过 `license_payment_links(provider, provider_order_id)` 定位 License。
- [ ] 不扫描 JSON metadata 定位 License。
- [ ] 支付成功创建或续期 License。
- [ ] 订阅取消、退款、支付失败更新 License 状态或到期时间。
- [ ] 重复 processed/ignored 事件直接返回成功。
- [ ] failed 事件允许重新处理并更新错误信息。
- [ ] 不保存 webhook 原始 body，只保存 payload_hash、事件 ID、处理状态和脱敏摘要。

**验证清单**：

- [ ] 签名错误 webhook 被拒绝。
- [ ] 同一事件重复投递只处理一次。
- [ ] 支付成功能创建或续期 License。
- [ ] 取消、退款、支付失败能同步 License 状态。
- [ ] webhook 不通过 metadata_json、customer、邮箱、备注或描述字段扫描定位。

**退出条件**：

- [ ] 支付事件可安全、幂等地同步授权状态。

---

## T29：实现签名密钥轮换支持

> 第二期需求。本期 MVP 不执行。

**优先级**：P2（二期）

**依赖**：T14、T16

**责任代理**：`key_rotation_worker`

**目标**：客户端支持多公钥验证窗口，服务端可轮换签名私钥。

**涉及文件**：

- 修改：`license-server/internal/infra/signer/ed25519_signer.go`
- 修改：`desktop/src-tauri/src/services/token_verifier.rs`
- 修改：`desktop/src-tauri/src/domain/license.rs`

**执行清单**：

- [ ] 服务端 JWS header 写入 `kid`。
- [ ] 客户端内置至少两个有效公钥验证窗口。
- [ ] 服务端私钥轮换后，旧 token 有效期内仍可验证。
- [ ] 私钥不得进入客户端、日志、仓库和构建产物。

**验证清单**：

- [ ] 新 kid token 可验证。
- [ ] 旧 kid token 在有效期内可验证。
- [ ] 未知 kid token 被拒绝。
- [ ] 仓库中没有私钥内容。

**退出条件**：

- [ ] 授权签名具备基础轮换能力。

---

## T30：执行 MVP 总验收

**优先级**：P0

**依赖**：T01-T10、T18-T27 中所有 P0/P1 任务

**责任代理**：`acceptance_reviewer`

**目标**：按方案 `25.5` 完成 MVP 验收，确认可用于真实评审和小范围试用。

**涉及文件**：

- 修改：`docs/acceptance-report.md`
- 参考：全部实现文件

**执行清单**：

- [ ] 执行 Prompt 一致性验收。
- [ ] 执行 Prompt 模板变量验收。
- [ ] 执行任务快照验收。
- [ ] 执行 retry/rerun 验收。
- [ ] 执行数据库脱敏验收。
- [ ] 执行删除资源验收。
- [ ] 执行图片去重验收。
- [ ] 执行草稿校验验收。
- [ ] 执行单任务并发验收。
- [ ] 执行启动恢复验收。
- [ ] 执行事件兜底验收。
- [ ] 执行重试文件检查验收。
- [ ] 执行路径脱敏验收。
- [ ] 执行孤儿文件 GC 验收。
- [ ] 执行取消任务验收。

**验证清单**：

- [ ] 每个验收项都有通过、失败或未执行记录。
- [ ] 每个失败项都有复现步骤和修复任务编号。
- [ ] 每个未执行项都有原因和风险说明。
- [ ] 验收报告不包含密钥、token、激活码或用户隐私路径。

**退出条件**：

- [ ] P0/P1 验收项全部通过，或剩余风险被明确接受。

---

## 3. 交付物清单

- [ ] 桌面端 Tauri + React 应用。
- [ ] 固定工作流画布。
- [ ] 本地 SQLite migration 与工作区 assets 文件目录。
- [ ] 图片导入、组合保存、Prompt 预览、模型配置。
- [ ] 固定 Provider Adapter。
- [ ] 本地任务状态机、事件推送、主动拉取兜底。
- [ ] 取消、重试、重跑、历史和结果展示。
- [ ] 日志脱敏、Tauri 安全配置。
- [ ] MVP 验收报告。

---

## 4. 强制不做清单

- [ ] 不做任意节点编排。
- [ ] 不做自定义脚本节点。
- [ ] 不做云端业务数据同步。
- [ ] 不做多用户权限。
- [ ] 本期不做授权、License Server、设备激活、套餐功能开关和支付 webhook。
- [ ] 不做批量队列。
- [ ] 不做自建模型。
- [ ] 不开放通用 custom Provider。
- [ ] 不做复杂图片编辑器。
- [ ] 不把 API Key 写入日志或 SQLite。

---

## 5. 第一轮推荐并行任务包

如果按多 agent 推进，第一轮固定最多 5 个子任务：

1. `scope_planner`：执行 T00，冻结 MVP 范围与约束。
2. `desktop_scaffold_worker`：执行 T01，初始化桌面端骨架。
3. `sqlite_foundation_worker`：执行 T03，建立本地 SQLite 基础。
4. `workflow_ui_worker`：执行 T02，建立固定画布骨架。
5. `startup_recovery_worker`：执行 T04，建立启动恢复运行中任务机制。

第一轮汇总后，再进入：

1. 资源与组合链路：T05、T06、T07；
2. Prompt 与模型链路：T08、T09、T10；
3. 生成任务链路：T18、T19、T20、T21、T22；
4. 稳定性和验收：T23-T27、T30；
5. 第二期授权链路：T11-T17、T28-T29。
