# 商拍工坊 Local-first 真实实现任务清单

> 日期：2026-07-01
>
> 来源方案：`docs/2026-06-30-local-first-saas-ready-implementation-plan.md`
>
> 目标：把当前 mock/local state 项目拆成可推进、可执行、可验收的本地单机 MVP 任务。

## 1. 执行原则

- 先做本地真实 source of truth，再接真实 Provider。
- 每个任务必须能独立验收，不能只完成“代码写了”。
- React feature 只调用 Public Runtime Ports。
- Rust runtime 拥有 SQLite、文件系统、Secret、Prompt 模板和 ModelGateway。
- SQLite 只保存相对路径、脱敏摘要和结构化状态。
- API Key、raw prompt、Provider raw response 永不入库。
- macOS / Windows 差异由 runtime adapter 屏蔽，页面不写平台分支。

## 2. 全局验证命令

每个开发切片完成后至少运行和本切片相关的命令：

```bash
make test
make frontend-build
make cargo-check
git diff --check
```

涉及 Rust 单元测试后增加：

```bash
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib -- --nocapture
```

涉及完整联调时运行：

```bash
make dev
```

发布或大范围改动前运行：

```bash
make check
```

Windows 相关能力需要 Windows 真机或 CI 补验，macOS 上只能做结构级检查。

## 3. 里程碑总览

```text
M0 Workspace + SQLite migration
  ↓
M1 Settings + Shell + RuntimeInfo
  ↓
M2 Asset
  ↓
M3 Task History 基础
  ↓
M4 PromptPlan
  ↓
M5 Capability + Model Config + Secret
  ↓
M6 ModelGateway contract
  ↓
M7 真实场景生图闭环
```

## 4. 编码前决策门禁

### D0-01 SQLite 依赖

- 状态：待确认。
- 建议：MVP 使用 `rusqlite + migration helper`。
- 影响：M0 所有数据库任务。
- 验收：依赖选择写入方案文档或 PR 描述。

### D0-02 Secret 存储依赖

- 状态：待确认。
- 建议：macOS Keychain + Windows Credential Manager，优先选 Tauri plugin 或成熟 Rust crate。
- 影响：M5。
- 验收：明确 macOS / Windows 两端实现路径。

### D0-03 第一条真实模型通道

- 状态：待确认。
- 建议：先接一个稳定官方 Provider，再接 OpenAI-compatible 网关。
- 影响：M6 / M7。
- 验收：确认 provider profile allowlist 的第一批条目。

## 5. M0：Workspace + SQLite Migration

目标：应用有真实本地工作区和 `workspace.db`，工作区不可用时不能进入主界面。

### M0-T01 定义 Runtime Port 类型骨架

- 依赖：无。
- 主要文件：
  - `desktop/src/runtime/ports/*`
  - `desktop/src/runtime/types/*`
- 执行动作：
  - 建立 `WorkspacePort`、`SettingsPort`、`ShellPort`、`RuntimeInfoPort`、`AssetPort`、`GenerationPort`、`PromptPlanPort`、`CapabilityPort`、`ModelConfigPort`、`SecretPort` 类型。
  - 建立 `AppErrorCode`、`NormalizedTaskError`、分页 DTO、task DTO、asset DTO。
  - 暂不接真实 Tauri command，只做类型和最小 mock adapter 测试。
- 验收标准：
  - TypeScript 能引用所有 Port 类型，无悬空类型。
  - 前端页面不直接 import Tauri API。
  - `make test` 通过。
  - `make frontend-build` 通过。
- 退出条件：runtime 类型层能作为后续任务的唯一前端合同。

### M0-T02 建立 Rust workspace 初始化服务

- 依赖：D0-01。
- 主要文件：
  - `desktop/src-tauri/src/domain/*`
  - `desktop/src-tauri/src/services/*`
  - `desktop/src-tauri/src/infrastructure/filesystem/*`
  - `desktop/src-tauri/src/commands/*`
- 执行动作：
  - 实现 `initializeWorkspace`、`getWorkspaceStatus`、`repairWorkspace` 的 Rust 服务骨架。
  - 创建目录结构：`assets/source`、`assets/reference`、`assets/model`、`assets/generated`、`assets/thumbnail`、`cache/tmp`、`exports`、`logs`。
  - 默认 workspace 放系统应用数据目录。
  - 检测常见云同步目录并返回 warning。
- 验收标准：
  - 首次启动能创建 workspace 目录。
  - 缺目录时 `repairWorkspace` 能补齐。
  - 选择云同步目录时能返回风险提示。
  - `make cargo-check` 通过。
- 退出条件：本地 workspace 生命周期由 Rust runtime 管理。

### M0-T03 建立 SQLite 打开、PRAGMA 和 migration 体系

- 依赖：M0-T02。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/database/*`
  - `desktop/src-tauri/migrations/*`
- 执行动作：
  - 打开或创建 `workspace.db`。
  - 启动时执行 `PRAGMA foreign_keys = ON`、`journal_mode = WAL`、`busy_timeout = 5000`。
  - 建立 migrations 表和 migration runner。
  - migration 失败时返回 `SQLITE_MIGRATION_FAILED`，禁止进入主界面。
- 验收标准：
  - 空 workspace 能生成 `workspace.db`。
  - migration 版本可查询。
  - 人为破坏 migration 时进入失败页，而不是进入主界面。
  - `make cargo-check` 通过。
  - Rust migration 单测通过。
- 退出条件：业务读写前 migration 必定完成。

### M0-T04 启动恢复和 temp 清理骨架

- 依赖：M0-T03。
- 主要文件：
  - `desktop/src-tauri/src/services/workspace*`
  - `desktop/src-tauri/src/services/task_recovery*`
- 执行动作：
  - 启动时扫描 `running` 任务，恢复为 `failed` / `TASK_INTERRUPTED`。
  - 清理 `cache/tmp` 中孤儿临时文件。
  - 写入恢复事件摘要，不保存绝对路径。
- 验收标准：
  - 模拟 `running` 任务后重启，任务被恢复为 failed。
  - 临时文件清理不影响正式 assets。
  - `make cargo-check` 通过。
- 退出条件：异常退出后不会留下假 running 状态。

### M0-T05 初始化页接真实 workspace 状态

- 依赖：M0-T02、M0-T03。
- 主要文件：
  - `desktop/src/app/*`
  - `desktop/src/features/settings/*`
  - `desktop/src/runtime/local/*`
- 执行动作：
  - 前端启动时调用 `WorkspacePort.getWorkspaceStatus` / `initializeWorkspace`。
  - migration 失败时显示错误、打开目录、切换 workspace、备份新建 workspace 入口。
  - 去掉只靠前端状态判断初始化完成的逻辑。
- 验收标准：
  - 首次启动可初始化并进入主界面。
  - migration 失败不能进入主界面。
  - `make test` 通过。
  - `make frontend-build` 通过。
- 退出条件：主界面进入条件由 runtime workspace 状态决定。

## 6. M1：Settings + Shell + RuntimeInfo

目标：设置、本地壳能力和 runtime feature detection 走真实 Port。

### M1-T01 SettingsPort 持久化

- 依赖：M0-T03。
- 主要文件：
  - `desktop/src-tauri/src/services/settings*`
  - `desktop/src-tauri/src/commands/settings*`
  - `desktop/src/runtime/local/settings*`
- 执行动作：
  - 实现 `getSettings` / `saveSettings`。
  - 设置写入 SQLite `settings`。
  - 支持 workspace 目录、导出目录、历史保留等字段。
- 验收标准：
  - 修改设置后重启仍保留。
  - SQLite 中只存配置 JSON，不存 secret。
  - `make test`、`make cargo-check` 通过。
- 退出条件：设置页不再依赖 local mock。

### M1-T02 ShellPort 本地壳能力

- 依赖：M0-T01。
- 主要文件：
  - `desktop/src-tauri/src/commands/shell*`
  - `desktop/src/runtime/local/shell*`
- 执行动作：
  - 实现目录选择、路径 reveal、系统通知。
  - macOS 映射 Finder，Windows 映射 Explorer。
  - Web/remote adapter 返回 feature unavailable。
- 验收标准：
  - macOS 可选择目录并 reveal。
  - Windows 行为列入真机待验。
  - `make frontend-build`、`make cargo-check` 通过。
- 退出条件：页面只通过 `ShellPort` 使用系统壳能力。

### M1-T03 RuntimeInfoPort 和 feature gating

- 依赖：M1-T02。
- 主要文件：
  - `desktop/src/runtime/*`
  - `desktop/src/features/settings/*`
  - `desktop/src/features/model-config/*`
- 执行动作：
  - 实现 `getRuntimeInfo`。
  - 返回 local / remote、版本号和 feature flags。
  - 页面根据 flags 隐藏本地目录、reveal、本地模型配置、secret 管理入口。
- 验收标准：
  - 页面无 `if (isTauri)` 判断。
  - local mode 显示本地能力入口。
  - remote stub 隐藏本地模型配置入口。
  - `make test` 通过。
- 退出条件：平台和 runtime 差异由 feature flags 驱动。

### M1-T04 设置页接真实 Port

- 依赖：M1-T01、M1-T02、M1-T03。
- 主要文件：
  - `desktop/src/features/settings/components/SettingsPage.tsx`
  - `desktop/src/features/settings/*test*`
- 执行动作：
  - 设置页读取 `SettingsPort`。
  - 工作区目录选择调用 `ShellPort.chooseDirectory`。
  - 根据 `RuntimeInfoPort.features` 控制入口可见性。
- 验收标准：
  - 设置页重启后值不丢。
  - remote feature disabled 时入口隐藏。
  - `make test`、`make frontend-build` 通过。
- 退出条件：设置页真实读写闭环完成。

## 7. M2：Asset

目标：资产导入、读取、删除和 GC 都由 runtime 统一管理。

### M2-T01 建立 assets migration 和 DAO

- 依赖：M0-T03。
- 主要文件：
  - `desktop/src-tauri/migrations/*assets*`
  - `desktop/src-tauri/src/infrastructure/database/*asset*`
- 执行动作：
  - 建立 `assets` 表和索引。
  - 支持 `deleted_at`、`sha256`、`relative_path` 唯一约束。
  - 默认查询过滤 `deleted_at IS NULL`。
- 验收标准：
  - asset CRUD 单测覆盖。
  - `relative_path` 唯一约束生效。
  - `make cargo-check` 通过。
- 退出条件：资产元数据有 SQLite source of truth。

### M2-T02 importImages 真实导入

- 依赖：M2-T01。
- 主要文件：
  - `desktop/src-tauri/src/services/assets*`
  - `desktop/src-tauri/src/commands/assets*`
  - `desktop/src/runtime/local/assets*`
- 执行动作：
  - 校验 MIME、大小、图片宽高。
  - 复制到 temp，计算 sha256。
  - DB 事务插入 asset。
  - atomic rename 到正式 assets 路径。
  - SQLite 只保存相对路径。
- 验收标准：
  - 导入图片后 assets 表有记录。
  - workspace 内有正式资产文件。
  - 失败时 temp 被清理。
  - `make cargo-check` 通过。
- 退出条件：导入图片不再依赖浏览器内存状态。

### M2-T03 AssetPort list/get/reveal

- 依赖：M2-T02、M1-T02。
- 主要文件：
  - `desktop/src/runtime/local/assets*`
  - `desktop/src/features/*asset*`
- 执行动作：
  - 实现 `listAssets`、`getAsset`、`revealAsset`。
  - 返回前端可渲染 asset URL。
  - 不返回用户原始绝对路径。
- 验收标准：
  - 资产库可显示导入图片。
  - reveal 使用系统文件管理器。
  - `make test`、`make frontend-build` 通过。
- 退出条件：前端资产列表来自 SQLite。

### M2-T04 deleteAsset 和引用保护

- 依赖：M2-T01。
- 主要文件：
  - `desktop/src-tauri/src/services/assets*`
  - `desktop/src-tauri/src/services/generation*`
- 执行动作：
  - `deleteAsset` 默认软删除。
  - 被历史任务引用的 asset 不能物理删除。
  - 无引用 asset 可进入 GC。
- 验收标准：
  - 被任务引用的 asset 删除不破坏历史。
  - deleted asset 默认不出现在资源库。
  - `ASSET_REFERENCED_BY_HISTORY` 能被归一化返回。
  - `make cargo-check` 通过。
- 退出条件：资产删除不会破坏历史追溯。

### M2-T05 GC 与 Windows 文件系统规则

- 依赖：M2-T04。
- 主要文件：
  - `desktop/src-tauri/src/services/gc*`
  - `desktop/src-tauri/src/infrastructure/filesystem/*`
- 执行动作：
  - GC 只清理不被引用且已标记删除的文件。
  - 处理 Windows 保留字符、保留设备名、长路径风险。
  - Windows 删除失败只记录待清理，不破坏 DB 状态。
- 验收标准：
  - GC 不删除被任务引用的文件。
  - 文件名清理测试覆盖 Windows 保留字符。
  - `make cargo-check` 通过。
  - Windows 真机补验文件锁行为。
- 退出条件：资产文件系统和 DB 状态一致。

## 8. M3：Task History 基础

目标：任务历史和状态机从 mock 改成 SQLite 事实。

### M3-T01 generation tasks migration

- 依赖：M0-T03、M2-T01。
- 主要文件：
  - `desktop/src-tauri/migrations/*generation*`
  - `desktop/src-tauri/src/infrastructure/database/*task*`
- 执行动作：
  - 建立 `generation_tasks`、`generation_task_input_assets`、`generation_assets`、`task_events`。
  - 加 `status` / `kind` / `stage` / `role` CHECK 约束。
  - 加外键和 `idempotency_key` 唯一索引。
- 验收标准：
  - migration 能从空库跑通。
  - 外键约束阻止非法 asset 引用。
  - failed idempotency 行为可测试。
  - `make cargo-check` 通过。
- 退出条件：任务历史表结构可支撑 M3-M7。

### M3-T02 GenerationPort create/get/list

- 依赖：M3-T01。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src-tauri/src/commands/generation*`
  - `desktop/src/runtime/local/generation*`
- 执行动作：
  - 实现 `createTask`、`getTask`、`listTasks`。
  - 保存 input snapshot 和 input asset relations。
  - `createTask` 双击不重复创建。
  - failed idempotency 命中返回 `TASK_RETRY_REQUIRED`。
- 验收标准：
  - 双击创建只生成一条 task。
  - failed task 同 key 再 create 返回错误。
  - `GenerationTaskDetail` 聚合 input assets、outputs、events。
  - `make test`、`make cargo-check` 通过。
- 退出条件：History 有真实任务数据源。

### M3-T03 状态机与 task_events

- 依赖：M3-T02。
- 主要文件：
  - `desktop/src-tauri/src/services/task_events*`
  - `desktop/src-tauri/src/services/generation*`
- 执行动作：
  - 支持 `queued`、`running`、`succeeded`、`failed`、`cancelled`。
  - 支持 stage 流转。
  - 每次 stage 变化写 `task_events`。
  - `detail_json` 遵守脱敏白名单。
- 验收标准：
  - stage 变化写入事件。
  - `detail_json` 不含 raw request、raw response、Authorization、绝对路径。
  - `make cargo-check` 通过。
- 退出条件：任务诊断可追溯。

### M3-T04 retry/cancel/delete 语义

- 依赖：M3-T03。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src/runtime/local/generation*`
- 执行动作：
  - `retryTask` 创建新 task，写 `retry_of_task_id` 和 `attempt_no`。
  - `cancelTask` 更新状态和事件。
  - `deleteTask` 只写 `deleted_at`，不删除资产。
- 验收标准：
  - retry 新旧 task 关联正确。
  - delete 后默认历史不显示，`includeDeleted` 可查。
  - delete 不物理删除输入资产或结果资产。
  - `make cargo-check` 通过。
- 退出条件：任务操作语义稳定。

### M3-T05 runtime task event emit

- 依赖：M3-T03。
- 主要文件：
  - `desktop/src-tauri/src/commands/generation*`
  - `desktop/src/runtime/local/generation*`
  - `desktop/src/features/history/*`
- 执行动作：
  - task event 写入后 emit `generation-task-updated` 或 `generation-task-event-created`。
  - 前端优先订阅事件，轮询兜底。
- 验收标准：
  - 任务状态变化后 UI 自动更新。
  - 事件不可用时仍可手动刷新/轮询。
  - `make test`、`make frontend-build` 通过。
- 退出条件：长任务状态不依赖页面假进度。

### M3-T06 History 页面真实化

- 依赖：M3-T02、M3-T04。
- 主要文件：
  - `desktop/src/features/history/*`
  - `desktop/src/app/*`
- 执行动作：
  - History 从 `GenerationPort.listTasks` 读取。
  - 任务详情从 `getTask` 读取 events、input assets、outputs。
  - 展示失败阶段和错误码。
- 验收标准：
  - 重启后历史仍存在。
  - failed 任务可看到失败阶段和错误码。
  - deleted task 默认不显示。
  - `make test`、`make frontend-build` 通过。
- 退出条件：History 不再依赖 mock/local state。

## 9. M4：PromptPlan

目标：生成方案可创建、编辑、确认，并在任务创建时冻结快照。

### M4-T01 prompt_plans migration 和 DAO

- 依赖：M0-T03。
- 主要文件：
  - `desktop/src-tauri/migrations/*prompt_plan*`
  - `desktop/src-tauri/src/infrastructure/database/*prompt_plan*`
- 执行动作：
  - 建立 `prompt_plans` 和 `prompt_plan_items`。
  - 支持 draft / confirmed 状态。
  - 支持 item 排序和 required / editable 字段。
- 验收标准：
  - plan CRUD 单测通过。
  - item cascade delete 生效。
  - `make cargo-check` 通过。
- 退出条件：PromptPlan 当前态可持久化。

### M4-T02 PromptPlanPort

- 依赖：M4-T01。
- 主要文件：
  - `desktop/src-tauri/src/services/prompt_plan*`
  - `desktop/src-tauri/src/commands/prompt_plan*`
  - `desktop/src/runtime/local/prompt-plan*`
- 执行动作：
  - 实现 `createPlan`、`getPlan`、`updatePlan`、`deletePlanItem`、`confirmPlan`。
  - confirmed plan 不支持原地回 draft。
  - raw prompt 不返回 UI。
- 验收标准：
  - plan 可创建、编辑、确认。
  - confirmed 后再改必须新建 draft。
  - `make test`、`make cargo-check` 通过。
- 退出条件：PromptPlanPort 可被商品/服饰流程调用。

### M4-T03 创建任务时冻结 PromptPlanSnapshot

- 依赖：M3-T02、M4-T02。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src-tauri/src/services/prompt_plan*`
- 执行动作：
  - 商品详情图和服饰试穿必须要求 confirmed PromptPlan。
  - 创建 task 时复制 `PromptPlanSnapshot` 到 `generation_tasks.prompt_plan_snapshot_json`。
  - 保存 `prompt_template_version`、`prompt_resolver_version`、`resolved_prompt_hash`。
- 验收标准：
  - 编辑原 plan 不影响历史 task detail。
  - 任务详情读取冻结 snapshot。
  - SQLite 不保存 raw prompt。
  - `make cargo-check` 通过。
- 退出条件：PromptPlan 当前态和 task 快照分离。

### M4-T04 商品/服饰 UI 接 PromptPlanPort

- 依赖：M4-T02、M4-T03。
- 主要文件：
  - `desktop/src/features/product/*`
  - `desktop/src/features/clothing/*`
  - `desktop/src/features/generation/*`
- 执行动作：
  - 商品详情图、服饰试穿生成前走 plan create/edit/confirm。
  - 场景图 MVP 继续单阶段 intent，不要求 `promptPlanId`。
- 验收标准：
  - 商品/服饰未确认 plan 时不能创建对应生成任务。
  - 场景任务不传 `promptPlanId` 也可创建。
  - `make test`、`make frontend-build` 通过。
- 退出条件：PromptPlan 语义在 UI 层明确。

## 10. M5：Capability + Model Config + Secret

目标：建立本地模型配置和能力查询边界，密钥只在安全存储中。

### M5-T01 provider profiles allowlist

- 依赖：D0-03。
- 主要文件：
  - `desktop/src-tauri/src/domain/model_config*`
  - `desktop/src-tauri/src/services/model_config*`
- 执行动作：
  - 定义内置 provider profile allowlist。
  - MVP 不开放任意 custom gateway。
  - `provider_profile_id` 只能引用内置 profile。
- 验收标准：
  - 手动修改 SQLite 不能绕过 allowlist。
  - `custom-disabled` 不可被调用。
  - `make cargo-check` 通过。
- 退出条件：模型配置不能指向任意 baseUrl。

### M5-T02 model_configs migration 和 ModelConfigPort

- 依赖：M5-T01。
- 主要文件：
  - `desktop/src-tauri/migrations/*model_config*`
  - `desktop/src-tauri/src/services/model_config*`
  - `desktop/src/runtime/local/model-config*`
- 执行动作：
  - 建立 `model_configs` 表。
  - 实现 `listConfigs`、`getConfig`、`saveConfig`、`setDefaultConfig`、`deleteConfig`、`listProviderProfiles`、`testConfig`。
  - `LocalModelConfigView` 不含 secret 明文。
  - remote mode 误调用返回 `MODEL_CONFIG_UNAVAILABLE`。
- 验收标准：
  - SQLite 不保存 API Key。
  - `LocalModelConfigView` 不包含 secret 明文。
  - 默认配置唯一性生效。
  - `make test`、`make cargo-check` 通过。
- 退出条件：模型配置页可接真实本地配置。

### M5-T03 SecretPort

- 依赖：D0-02、M5-T01。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/keychain*`
  - `desktop/src-tauri/src/services/secrets*`
  - `desktop/src/runtime/local/secrets*`
- 执行动作：
  - Public `SecretScope` 不传 workspaceId。
  - runtime 用 active workspace 注入 `ResolvedSecretScope`。
  - macOS Keychain / Windows Credential Manager 保存 secret。
  - 返回 `SecretStatus`，不返回明文。
- 验收标准：
  - SQLite、日志、前端 DTO 均无 API Key 明文。
  - 切换 workspace 后 secret 状态隔离。
  - macOS 本机验证 Keychain。
  - Windows Credential Manager 真机待验。
- 退出条件：密钥存储安全边界可用。

### M5-T04 CapabilityPort

- 依赖：M5-T02、M5-T03。
- 主要文件：
  - `desktop/src-tauri/src/services/capability*`
  - `desktop/src/runtime/local/capability*`
- 执行动作：
  - local mode 从 `model_configs + SecretStatus + ProviderProfile` 实时计算能力。
  - 保存或删除配置、保存或删除 secret 后，capability 立即刷新。
  - UI 不自行拼 capability 状态。
- 验收标准：
  - 新增配置和 secret 后生成按钮立即可用。
  - 删除 secret 后能力立即不可用。
  - `make test`、`make cargo-check` 通过。
- 退出条件：CapabilityPort 是能力状态唯一入口。

### M5-T05 模型配置页真实化

- 依赖：M5-T02、M5-T03、M5-T04。
- 主要文件：
  - `desktop/src/features/model-config/components/ModelConfigPage.tsx`
  - `desktop/src/features/model-config/*test*`
- 执行动作：
  - 页面展示 provider profiles 和 local configs。
  - 保存配置走 `ModelConfigPort`。
  - 保存 API Key 走 `SecretPort`。
  - 连接测试走 `testConfig`。
  - remote mode 隐藏配置入口。
- 验收标准：
  - 页面不出现 demo key。
  - 保存后重启仍有配置状态。
  - secret 明文不回显。
  - `make test`、`make frontend-build` 通过。
- 退出条件：模型配置页不再是 mock 数据。

## 11. M6：ModelGateway Contract

目标：统一模型调用合同，再接真实 Provider。

### M6-T01 Internal ModelGatewayPort 和 invocation 表

- 依赖：M5-T04。
- 主要文件：
  - `desktop/src-tauri/migrations/*model_invocation*`
  - `desktop/src-tauri/src/services/model_gateway*`
- 执行动作：
  - 建立 `model_invocations`。
  - 定义 `ModelInvocationInput`、`ModelInvocation`、`ResolvedModelInvocationInput`。
  - 写入 request summary、usage、脱敏 error。
- 验收标准：
  - 不保存 raw request / raw response。
  - 不保存 raw prompt。
  - `make cargo-check` 通过。
- 退出条件：模型调用有内部统一记录。

### M6-T02 DeterministicModelGatewayAdapter

- 依赖：M6-T01。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/providers/deterministic*`
  - `desktop/src-tauri/src/services/model_gateway*test*`
- 执行动作：
  - 实现测试专用 adapter。
  - 支持成功、失败、超时、异步 running 模拟。
  - 不用于产品 UI 默认入口。
- 验收标准：
  - contract tests 覆盖同步成功、失败、异步轮询。
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib -- --nocapture` 通过。
- 退出条件：后续任务状态机可无外网测试。

### M6-T03 OpenAI / OpenAI-compatible adapter 骨架

- 依赖：M6-T01。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/providers/openai*`
  - `desktop/src-tauri/src/infrastructure/providers/openai_compatible*`
- 执行动作：
  - 建立 adapter 接口骨架。
  - 支持 sync / stream / async-task 结果归一化的结构。
  - URL 入库前脱敏。
  - MVP 不开放任意 custom gateway。
- 验收标准：
  - 编译通过。
  - 单测覆盖 URL 脱敏。
  - 不打印 Authorization/header/raw response。
  - `make cargo-check` 通过。
- 退出条件：真实 Provider 接入点稳定。

### M6-T04 Provider 错误归一化

- 依赖：M6-T02、M6-T03。
- 主要文件：
  - `desktop/src-tauri/src/domain/errors*`
  - `desktop/src-tauri/src/services/model_gateway*`
- 执行动作：
  - 将 rate limit、timeout、content rejected、network、unknown 映射到 `AppErrorCode`。
  - message 用产品可展示文案，不透出 raw provider error。
  - retryable 规则可测试。
- 验收标准：
  - 常见错误映射有单测。
  - `providerErrorCode` 脱敏。
  - `make cargo-check` 通过。
- 退出条件：任务失败原因稳定可展示。

## 12. M7：真实场景生图闭环

目标：完成第一条真实场景图片生成链路。

### M7-T01 LocalTaskExecutor

- 依赖：M3-T03、M6-T02。
- 主要文件：
  - `desktop/src-tauri/src/services/local_task_executor*`
  - `desktop/src-tauri/src/lib.rs`
- 执行动作：
  - 从 queued task 取任务执行。
  - `maxConcurrentTasks = 1`。
  - 管理 cancellation token。
  - 更新 status / stage / events。
  - 关闭应用时取消 running task。
- 验收标准：
  - queued task 能变 running / succeeded / failed。
  - stage 变化写 events 并 emit。
  - 同时只跑一个任务。
  - `make cargo-check` 通过。
- 退出条件：本地任务队列可运行。

### M7-T02 场景任务调用 ModelGateway

- 依赖：M7-T01、M6-T03。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src-tauri/src/services/model_gateway*`
- 执行动作：
  - `SceneImageGenerationInput` 进入 executor。
  - runtime 内部渲染 prompt，不返回 UI。
  - 调用 `ModelGatewayPort`。
  - 处理 sync / stream / async-task。
- 验收标准：
  - Deterministic adapter 下场景任务能完整成功。
  - 失败时写错误码和失败 stage。
  - `make cargo-check` 和相关 Rust 测试通过。
- 退出条件：场景任务能通过模型网关执行。

### M7-T03 下载结果到 assets

- 依赖：M7-T02、M2-T02。
- 主要文件：
  - `desktop/src-tauri/src/services/assets*`
  - `desktop/src-tauri/src/services/generation*`
- 执行动作：
  - Provider 结果先下载到 `cache/tmp`。
  - 校验 MIME、大小、hash。
  - atomic rename 到 `assets/generated`。
  - 插入 `assets` 和 `generation_assets`。
- 验收标准：
  - 成功任务有真实 generated asset。
  - SQLite 只保存相对路径。
  - 下载失败返回 `DOWNLOAD_RESULT_FAILED`。
  - `make cargo-check` 通过。
- 退出条件：生成结果真实落盘。

### M7-T04 场景 UI 接真实 GenerationPort

- 依赖：M7-T03、M3-T06。
- 主要文件：
  - `desktop/src/features/scenes/*`
  - `desktop/src/features/generation/*`
  - `desktop/src/features/history/*`
- 执行动作：
  - 场景页创建真实 task。
  - 生成按钮根据 `CapabilityPort` 状态启用。
  - 结果页渲染 generated asset URL。
  - History 可重新打开结果。
- 验收标准：
  - UI 不再用 `setTimeout` 判定成功。
  - 成功结果来自真实 asset。
  - failed task 显示错误码和阶段。
  - `make test`、`make frontend-build` 通过。
- 退出条件：场景生图 UI 完整走真实 runtime。

### M7-T05 重试、取消、恢复闭环

- 依赖：M7-T04。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src/features/history/*`
  - `desktop/src/features/generation/*`
- 执行动作：
  - failed task 可 retry。
  - running task 可 cancel。
  - 应用重启后异常 running 恢复为 failed / interrupted。
  - task detail 展示 events。
- 验收标准：
  - retry 创建新 task 并关联旧 task。
  - cancel 写入 cancelled 状态和事件。
  - 重启恢复不留下 running。
  - `make test`、`make cargo-check` 通过。
- 退出条件：真实场景生图闭环可验收。

## 13. 横向验收清单

### 数据安全

- [ ] SQLite 不包含 API Key。
- [ ] SQLite 不包含 raw prompt。
- [ ] SQLite 不包含 Provider raw response。
- [ ] `task_events.detail_json` 不包含 Authorization、Cookie、raw headers、raw request、raw response。
- [ ] Provider URL 入库前脱敏。

### 本地工作区

- [ ] 首次启动可创建 workspace。
- [ ] 缺目录可修复。
- [ ] migration 失败不能进入主界面。
- [ ] 云同步目录有风险提示。
- [ ] running 任务重启后恢复为 failed / interrupted。

### 资产

- [ ] 导入图片只保存相对路径。
- [ ] 删除被历史引用的 asset 不破坏历史。
- [ ] deleted asset 默认不出现在资源库。
- [ ] GC 不删除被任务引用文件。

### 任务

- [ ] `createTask` 双击不重复创建。
- [ ] failed idempotency key 返回 `TASK_RETRY_REQUIRED`。
- [ ] `retryTask` 创建新 task。
- [ ] `deleteTask` 只隐藏任务历史。
- [ ] stage 变化写 `task_events` 并 emit。

### PromptPlan

- [ ] 商品详情图和服饰试穿要求 confirmed PromptPlan。
- [ ] 场景图 MVP 可无 `promptPlanId`。
- [ ] task 创建时保存 `PromptPlanSnapshot`。
- [ ] 编辑原 plan 不影响历史 task。

### 模型配置

- [ ] `LocalModelConfigView` 不含 secret 明文。
- [ ] remote mode 不暴露 provider、model、baseUrl、endpointPath。
- [ ] `provider_profile_id` 不能绕过 allowlist。
- [ ] 保存配置或 secret 后 `CapabilityPort` 立即反映。

### Windows 兼容

- [ ] 文件名清理覆盖 Windows 保留字符和保留设备名。
- [ ] 删除失败不会破坏 DB 状态。
- [ ] Windows Credential Manager 不泄漏 secret。
- [ ] Explorer reveal 通过 `ShellPort`。
- [ ] Windows 真机完成导入、删除、GC、生成结果保存验收。

## 14. 推进建议

第一轮建议只推进到 M3：

```text
M0 Workspace
  +
M1 Settings / RuntimeInfo
  +
M2 Asset
  +
M3 Task History
```

原因：

- M0-M3 能先移除最危险的 fake source of truth。
- M4-M7 依赖 M0-M3 的任务、资产、事件和错误合同。
- Provider 接入前，可以用 deterministic adapter 验证任务状态机。

第一轮完成的外部可见结果：

- 设置能真实持久化。
- 图片能真实导入 workspace。
- 历史任务来自 SQLite。
- 任务失败、重试、删除语义稳定。
- UI 不再假装生成成功。
