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
- SQLite 保存相对路径、脱敏摘要、结构化状态，以及本地密钥表中的 API Key。
- API Key 只能进入 SQLite 本地密钥表；raw prompt、Provider raw response 永不入库。
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

- 状态：已确认。
- 方案：MVP 使用 `rusqlite + migration helper`。
- 影响：M0 所有数据库任务。
- 验收：依赖选择写入方案文档或 PR 描述。

### D0-02 Secret 存储依赖

- 状态：已确认。
- 方案：MVP 使用 SQLite 本地密钥表存储 API Key，不使用 macOS Keychain / Windows Credential Manager。
- 影响：M5。
- 验收：明确本地密钥表 schema、workspace 隔离、文件权限、备份/导出排除和日志脱敏策略。

### D0-03 第一条真实模型通道

- 状态：已确认。
- 方案：先接一个稳定官方 Provider，再接 OpenAI-compatible 网关。
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
- 当前状态：已完成基础闭环。`StartupRecoveryService` 已能在 workspace 初始化时把异常退出遗留的 `running` 任务恢复为 `interrupted`，写入 `TASK_INTERRUPTED` 标准错误和 `task.interrupted` 事件；同时会清理 `cache/tmp` 中孤儿临时文件。
- 主要文件：
  - `desktop/src-tauri/src/services/workspace*`
  - `desktop/src-tauri/src/services/startup_recovery*`
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
- 当前状态：已完成 SQLite `settings` 表、Rust `SettingsService` / Tauri command、前端 `localSettingsPort` adapter；设置页 UI 接入仍待 M1-T04。
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
  - settings 表只存设置 JSON，不存 secret。
  - `make test`、`make cargo-check` 通过。
- 退出条件：设置页不再依赖 local mock。

### M1-T02 ShellPort 本地壳能力

- 依赖：M0-T01。
- 当前状态：已完成 Rust shell commands 和前端 `localShellPort` adapter；系统通知仍按 MVP 口径 no-op，`RuntimeInfo.supportsSystemNotification=false`。
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
- 当前状态：已完成 Rust `runtime_info` 命令和前端 `localRuntimeInfoPort` adapter；页面 feature gating 仍待 M1-T02/M1-T04 串接。
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
- 当前状态：已完成设置页加载/保存真实 settings，目录选择和打开目录走 `ShellPort`，系统通知入口按 `RuntimeInfoPort.features` 禁用。
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
- 当前状态：已完成。交付前不做 migration 演进，当前直接扩展 baseline schema；已建立 `assets` 表、`lifecycle`、索引、Rust `AssetService` 查询能力和覆盖测试。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/database/mod.rs`
  - `desktop/src-tauri/src/domain/assets.rs`
  - `desktop/src-tauri/src/services/assets.rs`
- 执行动作：
  - 建立 `assets` 表和索引。
  - 支持 `lifecycle`、`deleted_at`、`sha256`、`relative_path` 唯一约束。
  - 默认查询过滤 `deleted_at IS NULL`。
- 验收标准：
  - asset CRUD 单测覆盖。
  - `relative_path` 唯一约束生效。
  - `make cargo-check` 通过。
- 退出条件：资产元数据有 SQLite source of truth。

### M2-T02 importImages 真实导入

- 依赖：M2-T01。
- 当前状态：已完成后端基础能力。通用导入会按扩展名接受 PNG/JPEG/WEBP/GIF，校验扩展名 MIME，并读取 PNG/JPEG 的宽高；同时支持 sha256、workspace `cache/tmp` 写入、atomic rename、相对路径入库、非模特导入后的 `staged` 生命周期、模特导入后的 `active` 生命周期和同 kind/hash 未删除资产复用。模特资产导入会额外真实解码上述四种格式，在本地生成顶部居中裁剪的 320×320 PNG 头像缩略图；模型源文件限制为 64 MiB，最大宽高为 8192px，decoder 最大分配为 128 MiB。Asset DTO 通过 `thumbnailPath` 返回存在的缩略图路径，旧资产缺失时由前端回退原图。
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
  - 模特导入后有 320×320 头像缩略图，且不调用 AI；原图仍保留为任务输入。
  - 失败时 temp 被清理。
  - `make cargo-check` 通过。
- 退出条件：导入图片不再依赖浏览器内存状态。

### M2-T03 AssetPort list/get/reveal

- 依赖：M2-T02、M1-T02。
- 当前状态：已完成 runtime 基础能力。Rust command 与 `localAssetPort` 已接通；素材库 UI 对接未开始，需要单独确认交互方案。
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
- 当前状态：已完成后端基础能力。`deleteAsset` 已默认标记 `lifecycle=deleted` 并写 `deleted_at`，默认列表过滤 `deleted_at`；被任务引用的资产不会被 GC 物理清理。
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
- 当前状态：部分完成。`WorkspacePort.runGarbageCollection` 已接本地 command；GC 会清理未引用且超过 24 小时的 `staged` 资产，以及未引用的 `deleted` 资产，并同步清理已删除模特的头像缩略图；`deletedFiles` 和 `reclaimedBytes` 会包含实际删除的缩略图，即使对应原图已不存在。Windows 保留字符、长路径和真机文件锁行为仍待补充。
- 主要文件：
  - `desktop/src-tauri/src/services/assets*`
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
- 当前状态：已完成 baseline schema。交付前不做 migration 演进，当前直接扩展 baseline；已建立 `generation_tasks`、`generation_task_input_assets`、`generation_assets`、`task_events`、CHECK 约束、外键和 `idempotency_key` 唯一索引。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/database/mod.rs`
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
- 当前状态：已完成后端和 runtime 基础能力。Rust `GenerationService` / Tauri command / 前端 `localGenerationPort` 已实现 `createTask`、`getTask`、`getTaskDetail`、`listTasks`，已覆盖双击幂等、failed idempotency、input asset relations、创建任务时将输入资产从 `staged` 提升为 `active`，以及 `GenerationTaskDetail` 聚合 input assets、output assets、events。
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
- 当前状态：部分完成。创建、重试、取消会写 `task_events`；完整执行器 stage 流转和 Tauri event emit 仍待 M7 / UI 对接前补充。
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
- 当前状态：部分完成。`retryTask` 创建新 task 并写 `retry_of_task_id` / `attempt_no`，`cancelTask` 更新状态并写事件，`deleteTask` 写 `hidden_at` 做历史软隐藏；输入资产关系已落库，结果资产关系仍待 M7 联动。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src/runtime/local/generation*`
- 执行动作：
  - `retryTask` 创建新 task，写 `retry_of_task_id` 和 `attempt_no`。
  - `cancelTask` 更新状态和事件。
  - `deleteTask` 只写 `hidden_at`，不删除资产。
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
- 退出条件：PromptPlanPort 可被商品详情流程调用；服饰菜单使用独立的 `clothing-scene-planning` 结构化规划任务。

### M4-T03 创建任务时冻结 PromptPlanSnapshot

- 依赖：M3-T02、M4-T02。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src-tauri/src/services/prompt_plan*`
- 执行动作：
  - 商品详情图必须要求 confirmed PromptPlan。
  - 服饰菜单先通过 `clothing-scene-planning` 任务生成场景/动作规划，再创建出图任务。
  - 创建 task 时复制 `PromptPlanSnapshot` 到 `generation_tasks.prompt_plan_snapshot_json`。
  - 保存 `prompt_template_version`、`prompt_resolver_version`、`resolved_prompt_hash`。
- 验收标准：
  - 编辑原 plan 不影响历史 task detail。
  - 任务详情读取冻结 snapshot。
  - SQLite 不保存 raw prompt。
  - `make cargo-check` 通过。
- 退出条件：PromptPlan 当前态和 task 快照分离。

### M4-T04 商品 UI 接 PromptPlanPort / 服饰 UI 接结构化规划任务

- 依赖：M4-T02、M4-T03。
- 主要文件：
  - `desktop/src/features/product/*`
  - `desktop/src/features/clothing/*`
  - `desktop/src/features/generation/*`
- 执行动作：
  - 商品详情图生成前走 plan create/edit/confirm。
  - 服饰试穿生成前走 `clothing-scene-planning`，让模型基于服装图、模特图和场景输入输出可展示的场景/动作方案。
  - 场景图 MVP 继续单阶段 intent，不要求 `promptPlanId`。
- 验收标准：
  - 商品详情图未确认 plan 时不能创建对应生成任务。
  - 服饰菜单未完成场景/动作规划时不能创建对应出图任务。
  - 场景任务不传 `promptPlanId` 也可创建。
  - `make test`、`make frontend-build` 通过。
- 退出条件：商品详情 PromptPlan 语义和服饰规划任务语义在 UI 层明确。

## 10. M5：Capability + Model Config + Secret

目标：建立本地模型配置和能力查询边界，密钥只通过 `SecretPort` 进入 SQLite 本地密钥表。

### M5-T01 provider profiles allowlist

- 依赖：D0-03。
- 当前状态：已完成后端基础能力。已内置 `mock-local`、`openai`、`deepseek`、`volcengine` provider profile allowlist，MVP 不开放 custom gateway，`provider_profile_id` 由 Rust allowlist 校验；DeepSeek 和火山引擎按 OpenAI-compatible 形态维护 endpoint 默认值。OpenAI 已开放已实现的文生文、图生文、`clothing-base-model-generation` 纯文生图，以及图生图 `clothing-tryon-generation` / `image-edit` capability；后两项统一固定到 `/v1/images/edits`。`clothing-base-model-generation` 固定生成 2:3 纵向图且不接收参考图；需要商品参考图或任意用户比例的 `scene-image-generation` / `product-detail-generation` 仍不对 OpenAI 开放。
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

### M5-T01A Provider 连接探测抽象

- 依赖：M5-T01、M5-T03。
- 当前状态：已完成第一版。已新增 Rust `ProviderConnectionTester` 抽象和 `HttpProviderConnectionTester`，`ModelConfigService.testConfig` 会用当前 workspace SQLite 中的 API Key，对内置 provider 的 models endpoint 发起最小 HTTP 探测，并将结果写回 `model_configs.connection_status`、`connection_message`、`connection_tested_at` 和连接指纹。
- 主要文件：
  - `desktop/src-tauri/src/services/provider_connection.rs`
  - `desktop/src-tauri/src/services/model_config.rs`
  - `desktop/src-tauri/tests/model_config_service.rs`
- 执行动作：
  - mock-local 不触发网络请求，直接视为可用。
  - OpenAI / DeepSeek / 火山引擎只从 Rust 内置 profile 解析 baseUrl 和 models path。
  - 连接测试只读取 HTTP status，不保存 provider raw response。
  - 401 / 403 / 429 / 404 / timeout / network error 归一化为可展示文案。
- 验收标准：
  - API Key 不进入 `LocalModelConfigView`。
  - `testConfig` 成功和失败状态均可持久读取。
  - 配置、endpoint 或 API Key 变化后连接状态自动回到 `untested`。
  - 单测可注入 fake tester，避免测试阶段真实访问 Provider。
  - `make cargo-check` 和 Rust 全量测试通过。
- 退出条件：模型配置页的“测试连接”具备真实 Provider 探测能力，但不代表真实生成链路已接入。

### M5-T02 model_configs migration 和 ModelConfigPort

- 依赖：M5-T01。
- 当前状态：已完成后端和 runtime 基础能力。已建立 `model_configs` baseline schema、Rust `ModelConfigService` / Tauri command / 前端 `localModelConfigPort`，并为每个能力自动准备一个默认 mock 配置；provider 可用性由真实连接测试或 mock-local 规则持久化。
- 主要文件：
  - `desktop/src-tauri/migrations/*model_config*`
  - `desktop/src-tauri/src/services/model_config*`
  - `desktop/src/runtime/local/model-config*`
- 执行动作：
  - 建立 `model_configs` 表。
  - `model_configs` 只保存模型配置和 `secret_ref`，不直接保存 API Key。
  - 持久化 provider 连接状态和连接指纹。
  - 修改 API Key、模型、执行模式或 endpointPath 后，连接状态自动回到 `untested`。
  - 实现 `listConfigs`、`getConfig`、`saveConfig`、`setDefaultConfig`、`deleteConfig`、`listProviderProfiles`、`testConfig`。
  - `LocalModelConfigView` 不含 secret 明文。
  - remote mode 误调用返回 `MODEL_CONFIG_UNAVAILABLE`。
- 验收标准：
  - API Key 不进入 `model_configs`。
  - `LocalModelConfigView` 不包含 secret 明文。
  - 默认配置唯一性生效。
  - provider 连接测试结果可持久读取，配置或密钥变化后自动失效。
  - `make test`、`make cargo-check` 通过。
- 退出条件：模型配置页可接真实本地配置。

### M5-T03 SecretPort

- 依赖：D0-02、M5-T01。
- 当前状态：已完成后端和 runtime 基础能力。已建立 `model_secrets` baseline schema、Rust `SecretService` / Tauri command / 前端 `localSecretPort`；API Key 只写入 `model_secrets.secret_value`，前端 DTO 只返回 `SecretStatus`。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/secrets*`
  - `desktop/src-tauri/migrations/*model_secret*`
  - `desktop/src-tauri/src/services/secrets*`
  - `desktop/src/runtime/local/secrets*`
- 执行动作：
  - Public `SecretScope` 不传 workspaceId。
  - runtime 用 active workspace 注入 `ResolvedSecretScope`。
  - 建立 `model_secrets` 表保存 API Key。
  - API Key 记录必须包含 workspace、provider profile、capability 维度。
  - 初始化 workspace 时尽力加固目录和 SQLite 文件权限。
  - 备份、导出和诊断包默认排除 `model_secrets.secret_value`。
  - 返回 `SecretStatus`，不返回明文。
- 验收标准：
  - API Key 只出现在 `model_secrets.secret_value`。
  - 日志、task events、settings、前端 DTO 均无 API Key 明文。
  - 切换 workspace 后 secret 状态隔离。
  - macOS 本机验证 workspace / DB 权限。
  - Windows 真机验证 workspace / DB ACL。
- 退出条件：SQLite 本地密钥边界可用。

### M5-T04 CapabilityPort

- 依赖：M5-T02、M5-T03。
- 当前状态：已完成后端和 runtime 基础能力。`CapabilityPort` 会从本地默认配置、secret 状态、provider 连接状态和内置 provider profile 实时计算能力；默认 mock 配置可在无外网时用于模型配置和自动化测试，但 `clothing-scene-planning`、`clothing-base-model-generation`、`clothing-tryon-generation` 三项 real-provider-only 能力在仅有 `mock-local` 时必须返回不可用。基准模特生成不能复用 `clothing-tryon-generation` 的图生图配置；服饰场景规划可复用同属 `image-to-text` 类别且已测试可用的真实默认模型配置，避免旧 workspace 只配置商品卖点图生文模型时被误判为无可用模型。基准模特公开元数据固定为 0 张输入、2:3、1 张输出；服饰规划和试穿最多接收 5 张服装图加 1 张模特图，并只声明当前 UI 支持的 3:4、1:1、9:16 比例。
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
- 当前状态：已完成第一版。页面从 Public Runtime Ports 读取 10 个 capability、provider profiles、local configs 和 secret status；保存配置走 `ModelConfigPort`，保存 API Key 走 `SecretPort`，连接测试会触发 Rust runtime 的 Provider 探测，结果持久化后刷新能力状态。保存分类配置时会将该分类 capability 与当前 `ProviderProfile.supportedCapabilities` 求交集，不向后端提交 Provider 未实现的能力；重载分类配置、读取 secret status 和 reveal 明文也复用同一个 Provider 支持的代表 capability，因此 OpenAI 仅保存 `clothing-base-model-generation` 时不会被该分类中的 Mock 默认配置覆盖回显，API Key scope 也保持一致。`clothing-base-model-generation` 已作为独立于图生图试穿的文生图配置项展示与保存。OpenAI 图生图 profile 会在“图生图 Provider”菜单中出现；选择并保存时，页面会分别提交 `clothing-tryon-generation` 与 `image-edit` 两项配置，实际 endpoint 仍由 Rust runtime 固定解析。`图生文` 类别会同时保存 `product-selling-points` 和 `clothing-scene-planning`，但测试连接只发起一次代表该类别 Provider/model/API Key 的最小探测；Rust runtime 会复用同类别、同 provider 的已有 secret，并同步同类别、同配置的默认项状态，避免模型测试和具体业务能力重复耦合。
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
  - mock-local 不要求 API Key，OpenAI / DeepSeek / 火山引擎需要密钥并重新测试后才算可用。
  - `make test`、`make frontend-build` 通过。
- 退出条件：模型配置页不再是 mock 数据。

## 11. M6：ModelGateway Contract

目标：统一模型调用合同，再接真实 Provider。

### M6-T01 Internal ModelGatewayPort 和 invocation 表

- 依赖：M5-T04。
- 当前状态：已完成第一版。已建立 `model_invocations` baseline 表，`ModelGatewayService.invoke` 会生成 `invocation_id`，写入 capability、provider profile、model、状态、request summary、output summary 和 usage summary；不保存 raw request、raw response 或 raw prompt。开发期 baseline 会在旧 workspace 已应用 migration 1 时幂等补齐新增表。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/database/mod.rs`
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
- 当前状态：已完成第一版。`DeterministicModelGatewayAdapter` 已从 service 内联逻辑拆到 infrastructure provider adapter，支持 10 个 capability 的 deterministic mock 输出，不触发真实 Provider 调用；其中 `clothing-scene-planning` 会返回结构化场景方案 JSON，每个场景包含 4 个动作，`clothing-base-model-generation` 返回文生图结果；每次调用会写入脱敏 invocation 记录。
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
- 当前状态：部分完成。已接入真实同步 HTTP 请求和文本流式请求；OpenAI-compatible 响应归一化支持 Chat Completions `choices[].message.content` 和 Responses API `output_text` 两类文本出参，并统一 `usage` 字段；OpenAI Images Generations 当前仅用于不携带参考图的 `clothing-base-model-generation`，固定请求 `1024x1536` 与业务 2:3 纵向约束一致，收到参考图或其他生图 kind 时快速失败，不丢图或静默折算比例。OpenAI 图生图已通过 `/v1/images/edits` 发送 `multipart/form-data`：只接受 PNG、JPEG、WebP，按 1:1、横向、竖向映射目标尺寸但不裁剪或转码输入图；保存配置、Provider 连接探测和历史配置执行都会强制解析该 endpoint，避免旧 `/v1/responses` 路径回写。上述证据来自本地 HTTP/单元测试，未验证真实 OpenAI 外网调用。已实现 Provider 结果 URL 脱敏。Provider `async-task` 提交与轮询、OpenAI Responses `image_generation` 工具仍待后续切片。
- 主要文件：
  - `desktop/src-tauri/src/infrastructure/providers/openai_compatible.rs`
  - `desktop/src-tauri/src/infrastructure/providers/openai_images.rs`
  - `desktop/src-tauri/src/infrastructure/providers/http_model_gateway.rs`
  - `desktop/src-tauri/tests/provider_adapter.rs`
- 执行动作：
  - 建立 adapter 接口骨架。
  - 支持 sync / stream / async-task 结果归一化的结构。
  - URL 入库前脱敏。
  - MVP 不开放任意 custom gateway。
- 验收标准：
  - 编译通过。
  - 单测覆盖 URL 脱敏。
  - 本地调试诊断日志只记录状态、耗时、响应长度、脱敏后的响应结构摘要和经清理的 `providerErrorCode`；禁止保存或打印 Provider raw response body、Authorization、Cookie、raw header 或 API Key，且 raw response 不得进入 SQLite、`task_events`、导出包或前端 DTO。
  - `make cargo-check` 通过。
- 退出条件：真实 Provider 接入点稳定。

### M6-T04 Provider 错误归一化

- 依赖：M6-T02、M6-T03。
- 当前状态：已完成基础错误映射。已新增 Rust `domain::errors`，覆盖 429、timeout、network、401/403、常规未知错误等归一化规则；`providerErrorCode` 会做字符级清理和疑似 secret 替换，不使用 Provider raw error 作为 message。HTTP status 和 timeout/network typed error 会从 HTTP adapter 经 `ModelGatewayError` / `ModelConfigError` 保留到 `LocalTaskExecutor`，最终按 `retryable`、`providerStatusCode` 和安全 message 归一化，不再把 429 或网络失败误报为能力缺失。Adapter 本地输入/能力校验使用独立 `ProviderRequestInvalid` 分支并回到 `Validation`，不伪造 HTTP 500 或 `providerStatusCode`；仅真实非 2xx 响应使用 `ProviderHttp`。
- 主要文件：
  - `desktop/src-tauri/src/domain/errors*`
  - `desktop/src-tauri/tests/provider_error.rs`
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
- 当前状态：部分完成。已新增 Rust `LocalTaskExecutor` 内部服务，支持 `maxConcurrentTasks = 1`，能领取最早 queued task，更新 running / completed / failed 状态，写入 `task.started`、`task.provider-called`、`task.succeeded`、`task.failed` 事件，并在模型能力不可用时写入 `MODEL_CAPABILITY_UNAVAILABLE` 标准错误；workspace 初始化已能恢复异常 `running` 任务为 `interrupted`。已支持服饰基准模特任务以独立的 `clothing-base-model-generation` 文生图 capability 渲染 Prompt，年龄可为婴儿、儿童、青少年、青年、中年或老年，未成年人必须按年龄呈现且不得成人化或性感化；该任务与服饰规划、试穿一样要求真实 Provider。已支持服饰场景规划任务保存结构化 `output_json`，规划 prompt 由 `clothing_scene_planning.toml` 配置；规划结果进入第二步场景选择时默认全部未选中，用户手动勾选、画幅和角度修改会保存在 App 层，生成完成或切换到其它菜单再返回后仍保留；已支持服饰试穿任务按 `items[]` 展开逐动作调用，并会把服装原图、参考图和模特图一并作为模型参考输入；第三步正式出图 prompt 由 `clothing_tryon_generation.toml` 配置，每个动作会拼接用户选择的图片比例、场景标题、场景描述、拍摄画幅、拍摄角度、拍摄位置和动作要求，并明确要求严格参考模特与服装原图，不得伪造其他人物，不得修改服装花纹、文字、Logo 等关键细节。服饰规划和试穿默认配置仍是 `mock-local` 时会失败提示配置真实模型，不再把 deterministic mock 结果展示成真实生成结果。尚未接 cancellation token、Tauri event emit、应用关闭主动取消。
- 体型映射：UI 使用纤细、苗条、精瘦、匀称、健美、运动型、肌肉型、壮硕、结实、丰满、微胖、大码，默认匀称，不提供肥胖。任务输入仅保存短标签，Prompt 渲染时注入对应完整描述；大码映射丰满，历史 `标准`、`肌肉` 映射匀称、肌肉型，未知值原样保留。
- 性别发型映射：UI 使用男、女短标签，Prompt 渲染时分别注入自然短发/中短发和自然中长发/长发的完整默认描述；用户外貌细节与内置发型冲突时，以用户输入为主，未知性别值原样保留。
- 基准模特画幅约束：Prompt 的 system、user 和 `rolelessPrompt` 均严格要求输出为 2:3 纵向比例（宽:高=2:3），禁止输出其它比例。
- 年龄映射：UI 使用婴儿、儿童、青少年、青年、中年、老年短标签。任务输入仅保存短标签，Prompt 渲染时注入对应完整年龄描述，并同步写入 user message 与 `rolelessPrompt`；未知历史年龄值原样保留。
- 人群映射：UI 使用欧美白人、中国人、东亚人、东南亚人、非裔、中东人、拉丁裔短标签。任务输入仅保存短标签，Prompt 渲染时注入对应完整族裔描述，并同步写入 user message 与 `rolelessPrompt`；未知历史人群值原样保留。
- 服饰规划与试穿参考图映射：1–5 张服装图 + 恰好 1 张模特图按真实 `userImages` 顺序映射为 A-F，两阶段 Prompt 都不再固定假设 B 是模特；缺失服装图、缺失模特或多张模特图时快速失败。试穿 `negative_prompt` 作为负向约束进入 system 和 `rolelessPrompt`。
- 主要文件：
  - `desktop/src-tauri/src/services/local_task_executor*`
  - `desktop/src-tauri/tests/local_task_executor.rs`
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
- 当前状态：部分完成。`LocalTaskExecutor` 已能把 `scene + image-generation` 映射为 `scene-image-generation` capability，并通过 deterministic `ModelGatewayService` 完成 mock 调用，生成 `model_invocations` 记录；服饰菜单已补充 `clothing-base-model-generation` 文生图、`clothing-scene-planning` 图生文规划映射和 `clothing-tryon-generation` 逐动作出图映射。基准模特 Prompt 支持婴儿、儿童、青少年、青年、中年、老年；规划阶段会渲染 `clothing_scene_planning.toml` 并要求模型输出可展示的场景/动作结构，第三步出图阶段会渲染 `clothing_tryon_generation.toml` 并拼接用户上传服装图、用户选择模特和第二步选中的场景动作。服饰基准模特、规划和试穿执行路径要求真实 provider，`mock-local` 只保留为底层 adapter/测试替身。真实同步 HTTP 和文本流式调用入口已接入；`async-task` Provider 提交与轮询仍待后续切片。
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
- 当前状态：已完成第一版。`LocalTaskExecutor` 会把图片类任务的 ModelGateway 输出保存为 `generated` 资产，支持 deterministic adapter 返回的 PNG data URL，也支持 HTTP(S) 结果 URL 下载；结果先经过 `cache/tmp` 再 atomic rename 到 `assets/generated`，并写入 `generation_assets` 输出关系和 `task.result-saved` 事件。真实同步 HTTP 生成请求已接入；`async-task` Provider 结果轮询仍依赖后续 M6/M7 切片。
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

- [ ] API Key 只出现在 `model_secrets.secret_value`。
- [ ] SQLite 不包含 raw prompt。
- [ ] SQLite 不包含 Provider raw response。
- [ ] `task_events.detail_json` 不包含 Authorization、Cookie、raw headers、raw request、raw response。
- [ ] Provider URL 入库前脱敏。
- [ ] 备份、导出和诊断包默认不包含 API Key。

### 本地工作区

- [ ] 首次启动可创建 workspace。
- [ ] 缺目录可修复。
- [ ] migration 失败不能进入主界面。
- [ ] 云同步目录有风险提示。
- [ ] running 任务重启后恢复为 failed / interrupted。

### 资产

- [x] 导入图片只保存相对路径。
- [x] 删除被历史引用的 asset 不破坏历史。
- [x] deleted asset 默认不出现在资源库。
- [x] GC 不删除被任务引用文件。

### 任务

- [ ] `createTask` 双击不重复创建。
- [ ] failed idempotency key 返回 `TASK_RETRY_REQUIRED`。
- [ ] `retryTask` 创建新 task。
- [ ] `deleteTask` 只隐藏任务历史。
- [ ] stage 变化写 `task_events` 并 emit。

### PromptPlan

- [ ] 商品详情图要求 confirmed PromptPlan。
- [ ] 服饰试穿要求先完成 `clothing-scene-planning` 结构化规划。
- [ ] 场景图 MVP 可无 `promptPlanId`。
- [ ] task 创建时保存 `PromptPlanSnapshot`。
- [ ] 编辑原 plan 不影响历史 task。

### 模型配置

- [x] `LocalModelConfigView` 不含 secret 明文。
- [x] `model_configs` 不直接保存 API Key。
- [x] `model_secrets` 按 workspace 隔离。
- [ ] remote mode 不暴露 provider、model、baseUrl、endpointPath。
- [x] `provider_profile_id` 不能绕过 allowlist。
- [x] 保存配置或 secret 后 `CapabilityPort` 立即反映。
- [x] provider 可用性持久化，修改 API Key、模型或 endpointPath 后自动失效。
- [x] 切换离开并返回已配置 Provider 后恢复 API Key 遮罩状态，不自动 reveal 明文，且过期状态/明文响应不会覆盖当前 Provider。

### Windows 兼容

- [ ] 文件名清理覆盖 Windows 保留字符和保留设备名。
- [ ] 删除失败不会破坏 DB 状态。
- [ ] Windows 下 workspace 目录和 SQLite 文件仅当前用户可读写。
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
