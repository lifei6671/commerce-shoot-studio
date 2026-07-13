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
- 当前状态：部分完成。普通任务由 `retryTask` 创建新 task 并写 `retry_of_task_id` / `attempt_no`；商品与服饰单图重试为保留仅含目标项的 `items` 输入，使用 `createTask` 创建子任务，并在冻结输入中写 `parentTaskId`、目标 `imageId` 和 `imageNo`，不写 runtime 级 retry 关联；成功后由 M7 结果事务把唯一 active output 归并父任务稳定槽位并隐藏子任务。`cancelTask` 更新状态并写事件，`deleteTask` 写 `hidden_at` 做历史软隐藏；输入和结果资产关系均已落库。
- 主要文件：
  - `desktop/src-tauri/src/services/generation*`
  - `desktop/src/runtime/local/generation*`
- 执行动作：
  - 普通任务由 `retryTask` 创建新 task，写 `retry_of_task_id` 和 `attempt_no`；商品与服饰单图重试用 `createTask` 创建只含目标项的子任务，并在冻结输入中写 `parentTaskId`、`imageId` 和 `imageNo`，不写 `retry_of_task_id` / `attempt_no`；成功后唯一 active output 原子归并父任务稳定槽位并隐藏子任务。
  - `cancelTask` 更新状态和事件。
  - `deleteTask` 只写 `hidden_at`，不删除资产。
- 验收标准：
  - 普通 retry 新旧 task 的 `retry_of_task_id` / `attempt_no` 关联正确；商品与服饰单图 retry 的冻结输入能关联父 task 与目标 `imageId` / `imageNo`，成功后唯一 active output 在同一事务内归并父任务稳定槽位并隐藏子任务。
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

2026-07-13 列表流式分页：生成记录弹窗按当前分类默认渲染 10 条，滚动接近底部时
每次追加 10 条；切换“全部 / 商品 / 场景 / 服饰”会重置为该分类前 10 条，删除已显示
记录后自动补位。缩略图使用原生延迟加载和异步解码。该实现只减少弹窗首次打开时的
DOM 与图片解码，不改变 App 启动期完整历史恢复、重试归并和未完成任务续跑语义。
组件定向测试 4/4、前端全量 288/288、`make frontend-build` 与 `git diff --check`
均通过；真实桌面长列表滚动手感仍待人工验收，本项不标记完成。

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
  - 场景图先走 `scene-prompt-planning` 结构化规划，用户审核后再创建
    `scene-image-generation` 父任务，并用 `promptPlanId` 关联规划任务。
- 验收标准：
  - 商品详情图未确认 plan 时不能创建对应生成任务。
  - 服饰菜单未完成场景/动作规划时不能创建对应出图任务。
  - 场景生图任务冻结两份 Prompt 版本、catalog 版本、Campaign Style Lock 和 items。
  - `make test`、`make frontend-build` 通过。
- 退出条件：商品详情 PromptPlan 语义和服饰规划任务语义在 UI 层明确。

## 10. M5：Capability + Model Config + Secret

目标：建立本地模型配置和能力查询边界，密钥只通过 `SecretPort` 进入 SQLite 本地密钥表。

### M5-T01 provider profiles allowlist

- 依赖：D0-03。
- 当前状态：已完成后端基础能力。已内置 `mock-local`、`openai`、`deepseek`、`volcengine` provider profile allowlist，`provider_profile_id` 由 Rust allowlist 校验；用户可为内置 profile 的模型配置修改并持久化 Base URL，Mock Local 固定为 `mock://local`，其他 provider 只接受无凭据、无查询参数的 HTTPS 地址。React 页面不开放 endpoint path 编辑；OpenAI / 火山引擎的特殊图像 endpoint 由 Rust 强制映射，其他类别使用已保存的 endpoint path 或 profile 默认值。协议和 capability 矩阵仍由 Rust 内置映射控制。OpenAI 已开放 `scene-prompt-planning` 图生文与 `scene-image-generation` 图生图；前者走 Responses，后者与 `clothing-tryon-generation` / `image-edit` 一样走 `/v1/images/edits` multipart。火山规划走 Responses，场景生图走 `/images/generations`。
- 主要文件：
  - `desktop/src-tauri/src/domain/model_config*`
  - `desktop/src-tauri/src/services/model_config*`
- 执行动作：
  - 定义内置 provider profile allowlist。
  - 允许内置 profile 持久化其模型配置的 Base URL；Mock Local 固定为 `mock://local`，其他 provider 只接受无凭据、无查询参数的 HTTPS 地址；不开放任意 custom provider/profile。
  - `provider_profile_id` 只能引用内置 profile。
- 验收标准：
  - 手动修改 SQLite 不能绕过 allowlist。
  - `custom-disabled` 不可被调用。
  - `make cargo-check` 通过。
- 退出条件：模型配置只能引用内置 provider profile；Mock Local 固定使用 `mock://local`，其他 Base URL 只能是无凭据、无查询参数的 HTTPS 地址；React 页面不开放 endpoint path 编辑，Base URL 也不能改变协议或 capability 映射。

### M5-T01A Provider 连接探测抽象

- 依赖：M5-T01、M5-T03。
- 当前状态：已完成第一版。已新增 Rust `ProviderConnectionTester` 抽象和 `HttpProviderConnectionTester`，`ModelConfigService.testConfig` 会用当前 workspace SQLite 中的 API Key 和通过安全校验的持久化 Base URL，对内置 provider 的 runtime 映射 endpoint 发起最小 HTTP 探测，并将结果写回 `model_configs.connection_status`、`connection_message`、`connection_tested_at` 和连接指纹。
- 主要文件：
  - `desktop/src-tauri/src/services/provider_connection.rs`
  - `desktop/src-tauri/src/services/model_config.rs`
  - `desktop/src-tauri/tests/model_config_service.rs`
- 执行动作：
  - mock-local 不触发网络请求，直接视为可用。
  - OpenAI / DeepSeek / 火山引擎使用已持久化的 Base URL；OpenAI / 火山引擎的特殊图像 endpoint 由 Rust 强制映射，其他类别使用已保存的 endpoint path 或 profile 默认值。
  - 火山引擎图片探测按精确 Seedream 模型能力构造请求：`doubao-seedream-5-0-pro-260628` 不发送组图与流式字段并使用 `1K`，Seedream 5.0 Lite、4.5、4.0 使用 `sequential_image_generation: "disabled"`、`stream: false` 的单图非流式探测且不发送组图 options；未登记模型使用不含这些可选字段的最小请求；单张参考图发送字符串。火山文生图/图生图探测总超时为 300 秒，图生文探测保持 60 秒。
  - 连接测试只读取 HTTP status，不保存 provider raw response。
  - 连接探测可在终端输出请求/响应脱敏摘要（provider profile、脱敏后的 Base URL origin、模型、Content-Type、字节数、状态码、耗时、响应长度和白名单错误码），不落库且不包含原始 body、secret、header 或用户配置的 Base URL / endpoint 原始路径。
  - 401 / 403 / 429 / 404 / timeout / network error 归一化为可展示文案。
- 验收标准：
  - API Key 不进入 `LocalModelConfigView`。
  - `testConfig` 成功和失败状态均可持久读取。
  - 配置、Base URL、endpoint 或 API Key 变化后连接状态自动回到 `untested`。
  - 单测可注入 fake tester，避免测试阶段真实访问 Provider。
  - 单测锁定诊断摘要不包含 API Key、请求 body、Prompt、图片数据、原始响应或非白名单错误码。
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
  - 修改 API Key、模型、Base URL、执行模式或 endpointPath 后，连接状态自动回到 `untested`。
  - 实现 `listConfigs`、`getConfig`、`saveConfig`、`setDefaultConfig`、`deleteConfig`、`listProviderProfiles`、`testConfig`。
  - `LocalModelConfigView` 不含 secret 明文。
  - remote mode 误调用返回 `MODEL_CONFIG_UNAVAILABLE`。
- 验收标准：
  - API Key 不进入 `model_configs`。
  - `LocalModelConfigView` 不包含 secret 明文。
  - 默认配置唯一性生效。
  - provider 连接测试结果可持久读取，配置、Base URL 或密钥变化后自动失效。
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
- 当前状态：已完成后端和 runtime 基础能力。`CapabilityPort` 会从本地默认配置、secret 状态、provider 连接状态和内置 provider profile 实时计算能力；默认 mock 配置可在无外网时用于模型配置和自动化测试，但 `image-edit`、`image-text-recognition`、`clothing-scene-planning`、`clothing-base-model-generation`、`clothing-tryon-generation`、`scene-prompt-planning`、`scene-image-generation` 共七项能力均为 real-provider-only。场景规划和场景生图最多接收 3 张参考图，类别分别为 `image-to-text`、`image-to-image`，并声明 3:4、1:1、9:16 比例。
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
- 当前状态：已完成第一版。页面从 Public Runtime Ports 读取 12 个 capability、provider profiles、local configs 和 secret status。`图生文` 分类包含商品卖点、图片文字识别、服饰规划和场景规划；`图生图` 分类包含场景生图、服饰试穿和图片编辑。保存分类配置时仍与 Provider allowlist 求交集，endpoint 由 Rust runtime 固定解析。
- 主要文件：
  - `desktop/src/features/model-config/components/ModelConfigPage.tsx`
  - `desktop/src/features/model-config/*test*`
- 执行动作：
  - 页面展示 provider profiles 和 local configs。
  - 保存配置（包含非 Mock Local provider 可编辑的 HTTPS Base URL）走 `ModelConfigPort`。
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
- 当前状态：已完成第一版。`DeterministicModelGatewayAdapter` 已从 service 内联逻辑拆到 infrastructure provider adapter，覆盖 12 个 capability 的底层测试替身，不触发真实 Provider 调用；`image-text-recognition` 等 real-provider-only 能力不会因此在业务 UI 中变为可用或产生可展示假结果。每次调用会写入脱敏 invocation 记录。
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
- 当前状态：部分完成。已接入真实同步 HTTP 请求和文本流式请求；OpenAI-compatible 响应归一化支持 Chat Completions `choices[].message.content` 和 Responses API `output_text` 两类文本出参，并统一 `usage` 字段；OpenAI Images Generations 当前仅用于不携带参考图的 `clothing-base-model-generation`，固定请求 `1024x1536` 与业务 2:3 纵向约束一致，收到参考图或其他生图 kind 时快速失败，不丢图或静默折算比例。OpenAI 图生图已通过 `/v1/images/edits` 发送 `multipart/form-data`：只接受 PNG、JPEG、WebP，`image-edit` 优先使用 runtime 按当前模型校验过的显式 `size`，旧任务仍按 1:1、横向、竖向映射目标尺寸；火山引擎图生图也会校验并透传当前模型支持的显式 `size`，`doubao-seedream-5-0-pro-260628` 使用独立的官方 1K/2K 精确尺寸表，连接探测继续使用 1K，真实场景任务未显式指定尺寸时按冻结比例选择 2K，且真实最小请求不发送该模型不支持的组图或流式字段。保存配置、Provider 连接探测和历史配置执行都会强制解析对应 endpoint。火山引擎文生图/图生图真实调用使用 300 秒总超时；OpenAI `clothing-tryon-generation` / `image-edit` 保持 60 秒，`clothing-scene-planning` 和其余普通能力为 90 秒，`prompt-plan` 为 300 秒；前端任务无进展窗口为 360 秒并长于最长 Provider timeout，queued 未启动窗口保持不变。诊断同时保留机器可读的 `elapsedMs` 与人类可读的 `elapsed` 总耗时；Debug 开关开启时会额外输出已剔除图片数据、URL、header、凭据和 secret 的归一化模型结果摘要。上述证据来自本地 HTTP/单元测试，尚未重新验证优化后的真实火山引擎外网调用。Provider `async-task` 提交与轮询、OpenAI Responses `image_generation` 工具仍待后续切片。
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
- 本地调试诊断日志只记录状态、机器可读的 `elapsedMs`、人类可读的 `elapsed` 总耗时、响应长度、脱敏后的响应结构摘要和经清理的 `providerErrorCode`；禁止保存或打印 Provider raw response body、Authorization、Cookie、raw header 或 API Key，且 raw response 不得进入 SQLite、`task_events`、导出包或前端 DTO。
  - 真实模型调用默认不输出 raw Prompt；`make dev` 会在 Debug 构建中设置 `COMMERCE_SHOOT_STUDIO_DEBUG_PROMPTS=1`，将 system、user、roleless Prompt 和脱敏后的归一化模型结果摘要输出到终端 `stderr`。其它 Debug 启动方式需显式设置该变量。这些例外不得写入 `model-gateway-diagnostics.jsonl`、SQLite、`task_events`、导出包或前端 DTO，Release 构建编译期禁用。
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

2026-07-12 验证状态：场景菜单已完成两阶段真实任务接线。规划阶段使用
`scene-prompt-planning` + 25 模板 TOML catalog，用户确认后由一个
`scene-image-generation` 父任务按稳定 item 槽位并发生成；OpenAI 走 Responses /
`/v1/images/edits`，火山走 Responses / `/images/generations`。场景 fake timer 已移除，
历史恢复、部分失败、取消、删除、尺寸修改和单图重试已接入既有合同。`make check` exit 0，
覆盖 249 项 Vitest、frontend build、cargo check 和 0 个高危 npm audit；Rust 全量
`cargo test` exit 0，lib 182/182 及全部 integration tests 通过，`git diff --check` 通过。
付费真实 Provider 外网 smoke test 与真实桌面竞态仍需人工验收。

2026-07-12 兼容性修复状态：已完成并验证。H/D 输出叙事、模式字段边界、Prompt
审核交互和场景单图重试归并已与本轮 `ecom-details-image` 迁移合同对齐；已通过场景
定向测试、前后端全量测试、生产构建、Rust 检查、依赖审计和补丁格式检查。付费真实
Provider 外网 smoke test 仍由人工验收。

2026-07-12 生图参数修复：场景审核页统一显示“场景方案”和“场景摘要”，只展示模型生成的
摘要，不展示或编辑完整 Prompt；Seedream 5.0 / 5.0 Lite 不再复用 4.x 的低像素 2K 尺寸，3:4
映射改为 `1728x2304`。场景成功结果进入生成历史“场景”分类的既有链路已增加回归
断言；参考图仍不单独生成历史记录。付费真实 Provider 重试仍待人工验收。

2026-07-12 模板兼容修复：已逐项 review 原 `ecom-details-image` 25 个模板，catalog
恢复原 variant ID、品类覆盖和安全化后的镜头、光线、姿态、情绪及 Anti-AI 执行语义。
当前自动路由目标版本为 routing/planning/generation/catalog `v3/v10/v7/v5`；此前 v9 精简策略的
自动化合同已通过 `make check`（249 项 Vitest、frontend build、cargo check、0 个高危 npm
audit）和 Rust 全量 `cargo test`（lib 182/182 及全部 integration tests），v10 的新增定向合同
覆盖渠道与交付物优先级、infographic 完整度和文化器物事实边界；25 模板按真实参考图
与补充信息进行路由的语义表现和付费 Provider A/B 仍待人工验收。规划结果必须通过独立
`variantId` 冻结唯一 variant，并同时输出用户摘要与完整可执行 Prompt；人物参考主体允许
在身份和身体比例不变的前提下受控调整姿态、视线和表情；只有服装本身是商品参考或用户
要求保留时才锁定现有服装。旧 Prompt/catalog
版本任务仍可查看，但重试必须重新规划。真实人物杂志图的付费 Provider A/B 仍待人工验收。
Generation Prompt 改为薄执行器，只消费第二步的完整 Prompt、参考图和尺寸，不再叠加
Style Lock、模板规则或独立负向约束；所有非当前版本任务仍可查看，但重试前必须重新规划。
25 个模板新增各自的 `executor_identity`；第三步按 `templateId` 注入对应专业身份并直接
生图，Prompt 不得出现“上一步”“本阶段”等模型不可见的流程上下文。

2026-07-13 信息图语义修复：当前版本升级为 routing/planning/generation/catalog
`v3/v10/v7/v5`。routing 区分交付物形式、画面语言和投放渠道，“用于小红书发布的信息图”
不得仅因渠道词退化为 social-media；planning 与 catalog 为 infographic 恢复结构化布局、
HEX 色板、移动端字号、4-6 个证据型 callout、主体占比、留白和文化器物事实边界。自动化
合同已补；本轮又补充取消后的结构化结果原子写入、Seedream 5 Pro 探测/真实生成尺寸分离、
非终态场景任务恢复轮询和标题编号幂等回归。`make check` 通过 255 项 Vitest、frontend build、
cargo check 和 0 个 npm 漏洞，Rust 全量通过 185 项 lib tests 及全部 integration/doc tests。真实参考图的语义路由和付费
Provider 视觉效果仍待人工验收，本项不标记完成。

### M7-T01 LocalTaskExecutor

- 依赖：M3-T03、M6-T02。
- 当前状态：部分完成。已新增 Rust `LocalTaskExecutor` 内部服务，后台执行支持 `maxConcurrentTasks = 4`（同步执行器和单元测试仍为 1），能领取最早 queued task，更新 running / completed / failed 状态，写入 `task.started`、`task.provider-called`、`task.succeeded`、`task.failed` 事件，并在模型能力不可用时写入 `MODEL_CAPABILITY_UNAVAILABLE` 标准错误；workspace 初始化已能恢复异常 `running` 任务为 `interrupted`。已支持服饰基准模特任务以独立的 `clothing-base-model-generation` 文生图 capability 渲染 Prompt，年龄可为婴儿、儿童、青少年、青年、中年或老年，未成年人必须按年龄呈现且不得成人化或性感化；该任务与服饰规划、试穿一样要求真实 Provider。已支持服饰场景规划任务保存结构化 `output_json`，规划 prompt 由 `clothing_scene_planning.toml` 配置；规划结果进入第二步场景选择时默认全部未选中，用户手动勾选、画幅和角度修改会保存在 App 层，生成完成或切换到其它菜单再返回后仍保留；已支持服饰试穿任务按 `items[]` 展开逐动作调用，并会把服装原图、参考图和模特图一并作为模型参考输入；第三步正式出图 prompt 由 `clothing_tryon_generation.toml` 配置，每个动作会拼接用户选择的图片比例、场景标题、场景描述、拍摄画幅、拍摄角度、拍摄位置和动作要求，并明确要求严格参考模特与服装原图，不得伪造其他人物，不得修改服装花纹、文字、Logo 等关键细节。服饰规划和试穿默认配置仍是 `mock-local` 时会失败提示配置真实模型，不再把 deterministic mock 结果展示成真实生成结果。尚未接 cancellation token、Tauri event emit、应用关闭主动取消。
- 体型映射：UI 使用纤细、苗条、精瘦、匀称、健美、运动型、肌肉型、壮硕、结实、丰满、微胖、大码，默认匀称，不提供肥胖。任务输入仅保存短标签，Prompt 渲染时注入对应完整描述；大码映射丰满，历史 `标准`、`肌肉` 映射匀称、肌肉型，未知值原样保留。
- 性别发型映射：UI 使用男、女短标签，Prompt 渲染时分别注入自然短发/中短发和自然中长发/长发的完整默认描述；用户外貌细节与内置发型冲突时，以用户输入为主，未知性别值原样保留。
- 基准模特画幅约束：Prompt 的 system、user 和 `rolelessPrompt` 均严格要求输出为 2:3 纵向比例（宽:高=2:3），禁止输出其它比例。
- 年龄映射：UI 使用婴儿、儿童、青少年、青年、中年、老年短标签。任务输入仅保存短标签，Prompt 渲染时注入对应完整年龄描述，并同步写入 user message 与 `rolelessPrompt`；未知历史年龄值原样保留。
- 人群映射：UI 使用欧美白人、中国人、东亚人、东南亚人、非裔、中东人、拉丁裔短标签。任务输入仅保存短标签，Prompt 渲染时注入对应完整族裔描述，并同步写入 user message 与 `rolelessPrompt`；未知历史人群值原样保留。
- 服饰规划与试穿参考图映射：runtime 先把恰好 1 张模特图规范化为第 1 张参考图 A，再把 1–5 张服装图依次映射为 B-F；缺失服装图、缺失模特或多张模特图时快速失败。试穿 `negative_prompt` 作为负向约束进入 system 和 `rolelessPrompt`。
- 服饰 model-first 输入：唯一模特图固定为第 1 张参考图（A），其后的 1–5 张才是服装参考图；该顺序由 runtime 校验，规划 Prompt 不再要求模型回传冗余参考图索引。规划阶段不携带出图比例，只输出完整 `modelFeatures`（性别外观、年龄感、族裔外观、面部、体态、发型、肤色、整体气质和身份锚点）、场景与动作；用户已选择场景时，Prompt 按编号要求逐字复制并保持顺序，runtime 仅接受唯一的标题扩写匹配并整体重排场景对象，无法唯一匹配时拒绝结果。规划结果通过校验后，持久化 `output_json` 只保留顶层 `modelFeatures` 与 `scenes`，不保留 Provider 附带的内部分析、校验或比例字段。`modelFeatures` 会与冻结输入资产一起传入正式试穿任务，并在第三步与图片比例一并注入试穿 Prompt。
- 服饰试穿执行：真实 Provider 使用 Tokio + async reqwest + JoinSet，单个 `clothing-tryon-generation` 任务内按最多 4 个动作一批并发调用；后台容量检查和 task claim 在同一个 SQLite `BEGIN IMMEDIATE` 事务内完成，async supervisor 负责把异常退出安全回写为 failed 且不覆盖 cancelled。ModelGateway 的 async、stream 和 blocking 真实调用共享进程级 Provider 并发限流池，统一限制 OpenAI / 火山引擎 3 路、DeepSeek 4 路；localhost、IPv4/IPv6 loopback 按规范化 origin 共用 1 路，不同本地 origin 分池，Provider 连接测试不属于该调用链。服饰单项持有的 Provider permit 覆盖 HTTP 提交、响应读取、结果 URL 下载、暂存资产记录和文件落盘，成功、失败、取消或异常退出均通过 RAII 释放；结果下载和暂存写入在 blocking worker 中执行。同批调用结束后，runtime 按 `item_index` 排序，在一个事务内为单项多图分配全局唯一、稳定递增的 `sort_order`，写入输出关系并把 `staged` 资产激活；任务已取消/隐藏或事务失败时，只清理无任何输入、输出引用的暂存资产。单项 Provider 调用、结果保存和失败彼此隔离，Provider 失败保留 typed `TaskModelInvocationError`，对应 item 事件只记录脱敏字段且不阻断同批其他动作；取消会中止仍在 JoinSet 中的 Provider 子任务，已进入下载和落盘的结果完成后会在关联前再次校验任务状态。至少有一张结果保存成功时父任务成功并记录 `failed_item_count`；全部单项未保存时，父任务按最低 `item_index` 在 Provider 与持久化失败中确定代表错误，再规范化为安全任务错误。
- 主要文件：
  - `desktop/src-tauri/src/services/local_task_executor*`
  - `desktop/src-tauri/tests/local_task_executor.rs`
- 执行动作：
  - 从 queued task 取任务执行。
  - 后台执行器使用 `maxConcurrentTasks = 4`；同步执行器和单元测试保持 1。
  - 管理 cancellation token。
  - 更新 status / stage / events。
  - 关闭应用时取消 running task。
- 验收标准：
  - queued task 能变 running / succeeded / failed。
  - stage 变化写 events 并 emit。
  - 后台同时最多运行 4 个任务，且所有 ModelGateway 真实调用仍受进程级 Provider 并发限流池约束。
  - `make cargo-check` 通过。
- 退出条件：本地任务队列可运行。

### M7-T02 场景任务调用 ModelGateway

- 依赖：M7-T01、M6-T03。
- 当前状态：场景链路与自动路由已有实现，前端 Scene 相关回归和后端 Prompt、参考资产、
  脱敏、variant/routing、安全入库问题已修复，并通过 `make check` 与 Rust 全量测试。目标合同是在同一个
  real-provider-only `scene-prompt-planning` 任务内部先用精简 routing index 执行模板路由，
  返回并冻结 conversion driver、视觉方向和模板，再只注入选中模板完整规则执行最终规划，
  由 planning 在冻结模板内选择 variant override 或使用 `base`。Rust 只校验结构、catalog 归属
  和冻结路由一致性，不重新实现主体识别或证据门槛；H/D 推荐模板不是 allowlist，routing
  Prompt 要求 25 个模板在主体匹配且满足证据门槛时均可到达，full-pack 允许有明确目的差异的模板复用；
  生图阶段逐项渲染 `scene_image_generation.toml`，最多 4 项 `JoinSet` 并发且继续
  受 Provider semaphore 限制。至少一项成功时父任务成功并记录失败数，全部失败时
  返回最低 item index 的规范化错误。Mock Local 只保留为底层测试替身，不伪装真实结果。
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
- 当前状态：场景页已接入真实 `createTask -> runTask(taskId) -> poll detail`，规划与
  生图均不再使用 fake timer。结果卡只读取 generated assets，按当前结果槽派生完成、
  部分失败或失败状态；历史可恢复和重新打开场景任务。场景结果复用既有下载、删除、
  尺寸修改与稳定槽位归并能力；生成的人物或商品场景图会作为父任务结果进入生成历史
  的“场景”筛选。实时结果和历史恢复都会把冻结参考图重建为首位只读“原图”卡；原图不
  单独创建记录，也不计入生成数量、历史缩略图、选择、下载、长图或相册。history fallback
  与并发历史查看回归已修复并通过 Vitest。相册只查看成功的 generated assets，并按图片固有
  比例展示，不在图片外补浅色背景。真实 OpenAI/火山引擎外网、macOS/Windows 系统保存
  对话框和真实桌面快速历史切换竞态仍待手工验收。
  商品、服饰和场景结果卡的 AI 改图已统一接入真实 `image-edit` 任务；实时结果和从历史打开
  的结果都提交当前展示资产与用户微调要求；完整 Provider Prompt 只在 Rust 执行器内存组装，
  不写 task JSON。执行时读取当前默认真实图生图配置，`mock-local` 不得产生可归并结果；成功
  后替换原稳定槽位，失败保留原图。浮层提交按钮只显示“重新生成”，不再显示积分 icon 和数字。
  同一套结果卡现已接入真实“编辑文字”两阶段链路：打开浮层立即显示骨架屏，Rust 使用当前
  generated asset 与执行时最新真实 `image-text-recognition` 配置返回逐行文字及归一化位置；未
  识别到文字时全局 warning toast 提示并关闭浮层。用户未修改时确认按钮禁用；只提交变化行，
  清空行明确记为 `delete`，其余记为 `replace`，再由 `result-image-text-rewrite` 任务使用执行时
  最新真实 `image-edit` 配置修改当前图片并归并原稳定槽位。Prompt、Base64 和 Provider 原始
  响应不持久化；OCR 解析兼容完整 JSON Markdown 围栏，格式拒绝日志只输出安全分类，不输出
  识别原文、坐标值或 Provider raw response。OCR Prompt v2 使用无歧义的归一化
  `left/top/right/bottom`，Rust 转换成内部严格 xywh；若模型仍返回旧版字段，只在整批坐标可
  一致判定为 `x/y/right/bottom` 时统一转换，仍歧义的越界单项直接忽略，不扩成图片边缘大框；
  任一文字项的 bbox 缺失、类型、范围或 edge 顺序不可靠时也只跳过该项，保留其它有效文字并
  连续重建 line ID，全部位置无效时按空结果 toast 关闭；JSON、items 和 text 合同错误仍整批
  失败。改字执行边界仍严格拒绝越界。bbox
  只作为空间提示，图生图必须用 originalText 唯一匹配，歧义或找不到时保持不变，不得擦除整个
  近似框。真实 OpenAI/火山引擎定位改字视觉效果仍待付费 Provider 人工验收。
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
  - 历史展示状态按当前结果槽派生且不回写父 `generation_task` 的原始审计终态：结果槽全为 `complete` 时显示“已完成”，`complete` 与 `failed` 并存时显示“部分失败”，全为 `failed` 时显示“失败”，非 stale 的 `queued` / `running` 任务仍显示“生成中”。
  - `make test`、`make frontend-build` 通过。
- 退出条件：场景生图 UI 完整走真实 runtime。

### M7-T05 重试、取消、恢复闭环

- 依赖：M7-T04。
- 当前状态：场景父任务取消、中断恢复和单图重试已有实现；单图重试冻结原 item、参考资产
  和稳定 `imageId/imageNo`，成功后原子归并父任务槽位并隐藏子任务。跨任务 `imageId` 作用域、
  创建期间取消、重试任务取消、成功子任务归并期间 reset、重启后的 retry 结果恢复，以及恢复
  记录删除时 planning task 关联问题均已修复并通过前端/Rust 回归。Prompt 或 catalog 版本
  不匹配的旧任务仍可查看结果，但重试会明确要求重新规划；失败 retry 不覆盖已有成功父图。
  React/WebView 重载时，仍为 `queued` / `running` 的场景父任务和 retry 会恢复轮询与取消追踪；
  进程重启后已由 startup recovery 标记为 `interrupted` 的任务不会被重新启动。相关 child task
  继续保留在删除关联中。用户开始另一轮普通场景请求时，旧恢复任务仍独立更新自己的历史
  记录，但不得覆盖当前画布。
  AI 改图按当前 workspace 自己的展示 record 定位父任务与资产；只有属于该 workspace 的 history
  record ID 才能参与解析，避免其它 workspace 的全局 ID 遮蔽当前画布，也避免相同稳定 `imageId`
  在不同记录间串写。编辑文字同样复用该精确 record 的资产与稳定槽位；自动化已覆盖商品、服饰、
  场景三类实时结果及对应三类历史入口，并覆盖跨 workspace 保留画布和不同记录复用相同稳定
  `imageId` 的隔离场景。历史查看身份现按 workspace 保存；依次打开 A、B 历史再返回 A 时，A 的
  历史结果画布仍保持只读结果查看布局，不会重新显示生成配置面板，生成记录浮层也只高亮 A。
  dialog session、识别 request、提交 request 和 source asset identity 共同隔离迟到响应；切换
  history scope 后，旧提交的 success/error/finally 不得关闭、toast 或覆盖新浮层，也不得让新记录
  中相同 `imageId` 的卡片显示生成中；scope 切换不得提前释放旧提交锁，A → B → A 返回 A 时仍
  锁定。提交锁保存在生命周期长于结果画布组件的可订阅 store 中；提交期间卸载并重新挂载同一
  scope/图片仍显示生成中，每个 `finally` 只能移除自身 operation token。提交期间禁止关闭，资产
  变化后旧识别结果不能继续提交。
  2026-07-13 验证：`PreviewCanvas.text-edit.test.tsx` 16/16、`App.test.tsx` 146/146、前端全量
  276/276、Rust 全量测试、
  `make check`、`cargo fmt --check` 与 `git diff --check` 均通过；真实 OpenAI/火山付费改图仍待手工验收。
  真实桌面快速新建、取消和重启重试竞态仍待手工验收。
  同日补齐商品、服饰、场景和历史共享结果画布的下载契约：长图读取真实 asset 后合成受限尺寸的
  PNG，全部/分组/已选 ZIP 写入真实图片字节并保留扩展名；下载入口具备 loading、防重复提交和
  错误 toast。ZIP 按顺序读取图片并在原始资产累计超过 32 MiB 时提示分组或分批下载，避免当前
  JSON IPC 的 number array 造成 WebView 内存失控。自动化覆盖 Canvas 安全失败、PNG 字节、真实 ZIP
  内容、单图/归档最终 IPC 体积上限和保存期间重复点击；本轮 `make check` 前端全量 283/283 通过，
  macOS / Windows 原生保存对话框与下载文件打开仍待真机验收。
  后续复审进一步把单图、长图和 ZIP 收口到同一个同步操作锁：任一下载读取资产、编码或等待
  原生保存时，其余所有下载入口均禁用，避免多个 32 MiB 任务并发占用 WebView 内存。跨类型互斥
  回归测试与下载定向测试 8/8、当前 `make check` 前端全量 289/289 通过；真实原生保存行为仍按
  上述边界待 macOS / Windows 真机验收。
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

### M7-T06 场景输出语义与 UI 合同对齐

- 依赖：M7-T02、M7-T04。
- 当前状态：H/D 叙事、摘要边界、固定图片包和 UI 合同已完成自动化验证；审核页不再展示
  内部模板/variant，历史缩略图 fallback 不再使用原图。routing v3 / planning v10 的模板推荐
  非白名单、合理复用、`base` variant、主体条件化及 system rules 精简合同也已有自动化证据；
  25 模板真实语义可达性和付费 Provider 外网 smoke test 仍由人工验收。
- 执行动作：
  - 由 Prompt TOML 按 `visual`、`pain-point`、`emotional` 三种
    `conversionDriver` 选择 H1-H5 主图叙事，Rust 不硬编码业务规则。
  - D1-D9 固定对齐“首屏承接、痛点、机制、利益、步骤、场景、对比、信任、
    FAQ/CTA”的通用 PDP 叙事；缺少证据时不得虚构包装、认证、评价、优惠或多 SKU。
  - 模板、variant 和品类执行规则保存在 Prompt/catalog TOML 中，Rust 不硬编码业务文案。
  - `single` 的 `imageNo/sortOrder/code/purpose/ratio` 来自冻结输入，`templateId` 由 routing
    冻结；Rust 校验结构、catalog 归属和 planning 与冻结路由一致性，不承担业务模板或
    variant 的语义选择。Style Lock、标题、Prompt、
    负向约束和残留占位符继续严格校验，但 Prompt 与独立负向约束不要求逐字子串一致。
  - routing v3 选择 conversion driver、视觉方向并为每项冻结模板；planning v10 不能改选模板，
    只在冻结模板内选择 variant；
    没有适用 override 时使用 `base`。H/D 只固定 code、purpose 和顺序，推荐模板不作 allowlist；
    routing Prompt 要求 25 个模板均受主体与证据门槛约束且保持可达，真实语义仍待人工验收；
    full-pack 允许合理复用模板。single 固定 `conversionDriver=visual`。商品摄影模板恢复多角度
    与景别节奏；人物、空间、界面和创意
    模板仍服从自身语言。棚拍、海报和信息图可轮换 Style Lock 定义的 HEX 背景，自然环境类
    模板改为锁定环境材质、地点族、主色倾向和光线连续性。主体占比和详情文字密度仅应用于
    匹配图型。短文案可基于参考图或用户输入中的证据生成，但不得从缺失输入猜测品牌、功能、
    参数、效果、促销或认证；受众或平台缺失时使用中性、跨平台安全构图。
  - 规划失败时返回场景配置页并保留参考图，通过 toast 展示归一化错误；Debug 诊断仅
    增加有限 `validationReason` 分类，不输出模型原文、Prompt 或图片内容。
  - `hero-pack`、`detail-pack`、`full-pack` 的固定 5/9/14 项在 Prompt 审核页不可删除
    或拖拽；任一 Prompt 去除首尾空白后为空时禁用生图入口。
  - 在“单张场景图、主图组、详情页组、完整图片包”四个标题后紧邻增加说明图标，
    鼠标悬停或键盘聚焦时复用共享 Tooltip 分别解释 1/5/9/14 张输出数量和业务用途；
    浮层通过 Portal 挂载到 `body`，不得被左侧滚动面板裁剪。
  - 当前 `multi-product` 收窄为参考图中已有的同款多角度或同系列组合，对外文案改为
    “多角度组合”；任意多 SKU 生成等待独立商品资产角色。
  - 模板 executor、variant、文字与证据政策及原生视觉语言优先于跨图视觉方向；视觉方向
    仅提供色板、光线和版式基线。D1-D9 信息职责由当前模板按自身构图语言表现，镜头、背景、
    服装保真和字体策略按商品、人物、空间、界面或混合主体条件化应用。
- 验收标准：
  - 三种 `conversionDriver` 分别得到对应 H1-H5 序列，D1-D9 顺序稳定且完整。
  - UI 不展示或提交场景模板、模板分类或视觉方向。
  - 单图 planning 结果与冻结输入或路由不一致时由 Rust 拒绝，规划失败不会进入空审核页。
  - 固定图片包不能删减，空 Prompt 不能启动任务。
  - 四个 Tooltip 可通过鼠标悬停和键盘聚焦读取，文案准确描述数量和用途，且不被
    左侧滚动面板裁剪。
  - `make test`、`make frontend-build`、`make cargo-check`、`make check` 和
    `git diff --check` 通过。
- 退出条件：代码、定向测试和全量质量门均通过；完成前保持未勾选。

### M7-T07 场景自动模板路由与必填补充信息

- 依赖：M7-T02、M7-T06。
- 当前状态：实现和自动化修复已完成；`make check` exit 0，覆盖 249 项 Vitest、frontend build、
  cargo check 和 0 个高危 npm audit，Rust 全量 `cargo test` exit 0，lib 182/182 及全部
  integration tests 通过。25 模板在真实参考图上的路由语义、付费 Provider A/B 和真实桌面
  竞态仍待人工验收，因此本项保持未完成。
- 执行动作：
  - UI 删除场景模板、模板分类和视觉方向选择，只保留参考图、输出内容、输出尺寸与
    必填补充信息；补充信息去除首尾空白后为空时禁止创建规划任务。
  - 新增 `scene_template_routing.toml`，当前为 v3，但继续使用既有
    `scene-prompt-planning` capability；不新增 capability、GenerationPort、数据库 schema、
    migration 或依赖。
  - 同一个 `prompt-plan` 任务先执行模板路由调用，再执行选中模板的完整规划调用；planning
    使用 v10、catalog 使用 v5、generation 使用 v7。
  - routing 调用只注入精简 routing index，选择 conversion driver、视觉方向与模板；planning
    调用只注入路由实际选中的去重模板完整规则，在冻结模板内选择 variant。Rust 只拒绝结构、
    catalog 归属、冻结路由一致性或 variant 归属不合法的结果，不维护主体/证据语义判定。
  - 路由结果只驻留 executor 内存，不写 `generation_tasks`、SQLite、task events、诊断文件
    或前端 DTO；最终规划通过校验后才允许持久化。
  - 两次调用顺序复用既有 Provider semaphore；第一次失败、路由非法或任务已取消时不得
    发起第二次调用。
  - H/D 固定 code、purpose、数量和顺序，但推荐模板仅用于排序；routing Prompt 要求模型从
    25 个模板中选择主体匹配且证据充分的模板，该语义效果仍待真实参考图人工验收。full-pack
    可在不同 purpose 或构图角色下复用模板，不做
    全局唯一校验；planning 未命中 variant override 时使用 `base`。
  - 当前模板的原生视觉语言、executor、文字和证据政策优先于视觉方向；视觉方向只维护跨图
    色板、光线和版式基线。详情职责及镜头、背景、服装、字体规则按模板和主体类型条件化执行。
  - routing v3 区分交付物形式、画面语言和投放渠道；渠道词不能覆盖明确的信息图或详情形式。
    planning v10 的 system rules 保留事实与证据、模板优先、Style Lock 核心、variant/base、
    自包含 Prompt、摘要边界和安全注入；数量、code/purpose 顺序、字段、版本和冻结路由一致性
    由 output format 与 Rust 校验。planning 输入只包含 code/purpose 和冻结模板完整配置，不含
    routing 的 `recommendedTemplateIds`。
- 验收标准：
  - [x] 四种输出模式均无需用户选择模板或视觉方向，空补充信息不能提交。
  - [x] routing 与 planning 在同一任务内按顺序调用同一 capability，并记录两个脱敏
    invocation ID。
  - [x] planning 请求只包含选中模板完整规则，不包含未选模板或完整 catalog。
  - [x] single、5/9/14 项的 code、purpose、数量及模板/variant 归属通过校验；推荐模板不会
    被当成 allowlist，full-pack 合理模板复用可通过。
  - [ ] 25 个模板均有主体/证据充分时的可达用例，证据不足的受限模板会被拒绝。
  - [x] 无适用 variant override 时规范化为 `base`，并拒绝不属于冻结模板的 variant。
  - [ ] 模板视觉语言优先级、详情职责表达和商品/人物/空间/界面主体条件化规则已通过真实
    参考图语义验收。
  - [x] planning 请求不包含 `recommendedTemplateIds`；精简后的 system rules 不重复数量、
    顺序、稳定 ID、版本和字段类型合同，Rust/output format 仍能拒绝非法结构。
  - [x] routing 失败、结果非法或调用间取消时不执行 planning，也不写最终 output。
  - [x] SQLite、task events、诊断和前端 DTO 不包含路由结果、raw Prompt、Base64、临时 URL
    或 raw Provider 内容。
  - [x] 定向 Vitest/Rust 测试、`make test`、`make frontend-build`、`make cargo-check`、
    `make check` 和 `git diff --check` 通过。
- 退出条件：上述未勾选验收项全部取得实现和验证证据后方可完成。

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
- [x] 场景图要求完成 `scene-prompt-planning` 并通过 `promptPlanId` 关联。
- [x] 场景 H/D 叙事、可见字段边界、固定图片包和四模式 Tooltip 已通过自动化验证。
- [ ] task 创建时保存 `PromptPlanSnapshot`。
- [ ] 编辑原 plan 不影响历史 task。

### 模型配置

- [x] `LocalModelConfigView` 不含 secret 明文。
- [x] `model_configs` 不直接保存 API Key。
- [x] `model_secrets` 按 workspace 隔离。
- [ ] remote mode 不暴露 provider、model、baseUrl、endpointPath。
- [x] `provider_profile_id` 不能绕过 allowlist。
- [x] 保存配置或 secret 后 `CapabilityPort` 立即反映。
- [x] provider 可用性持久化，修改 API Key、模型、Base URL 或 endpointPath 后自动失效。
- [x] 切换离开并返回已配置 Provider 后恢复 API Key 遮罩状态，不自动 reveal 明文，且过期状态/明文响应不会覆盖当前 Provider。

### Windows 兼容

- [ ] 文件名清理覆盖 Windows 保留字符和保留设备名。
- [ ] 删除失败不会破坏 DB 状态。
- [ ] Windows 下 workspace 目录和 SQLite 文件仅当前用户可读写。
- [ ] Explorer reveal 通过 `ShellPort`。
- [ ] Windows 真机完成导入、删除、GC、生成结果保存验收。

### 桌面双架构打包脚本

2026-07-13 已提供宿主原生打包入口：macOS 脚本支持 `arm64`、`x64`、`all` 与
`app`、`dmg`、`all`；Windows PowerShell 脚本支持 `x64`、`arm64`、`all` 与
`nsis`、`msi`、`all`。默认构建当前宿主架构并执行一次 `npm ci`，可显式跳过依赖
安装。`all` 表示依次构建两个独立 target，不是 universal 或多架构合并安装包。
第一版始终生成未签名产物，不包含 Apple 公证、Windows Authenticode、自动更新或
发布上传。本记录只确认脚本接口已提供，不勾选现有 Windows 兼容大项。

同日复审补强 Windows 本地脚本：`-Arch all` 会从同一个 Visual Studio 安装为 x64 与
ARM64 target 分别调用 `Launch-VsDevShell.ps1`，并校验 `VSCMD_ARG_TGT_ARCH`，避免复用
错误架构的 `cl` / `link` / `rc` 环境；`msi` / `all` 还会在构建前要求管理员 PowerShell，
检查 VBSCRIPT capability 与 `cscript.exe`，纯 NSIS 不增加该要求。当前只有官方契约和
脚本结构证据，Windows 真机构建、安装与启动仍未验证，因此不勾选平台验收项。

同日已配置 `.github/workflows/package-desktop.yml`：支持手动和 `v*` tag 触发，固定
macOS ARM64、macOS Intel x64、Windows x64、Windows ARM64 四个独立矩阵项；使用
锁定提交 SHA 的 checkout、setup-node、Tauri Action，固定 Node.js `22.22.0`、Rust
`1.96.0`，并以 `contents: read`、`--no-sign` 只上传名称隔离的 Actions Artifacts。
Windows Job 在 MSI 构建前检查 VBScript capability 与 `cscript.exe`。本地 YAML 解析和
结构复审已通过，但 workflow 尚未推送运行；`windows-11-arm` runner 仍处于 Public
Preview。`v*` tag 触发不会创建或更新 GitHub Release，因此 workflow 配置不等于发布完成。

- [ ] macOS ARM64 的 app、dmg 在对应宿主完成构建、架构、资源和启动验收。
- [ ] macOS x64 的 app、dmg 在对应宿主完成构建、架构、资源和启动验收。
- [ ] Windows x64 的 NSIS、MSI 在对应宿主完成构建、安装、资源和启动验收。
- [ ] Windows ARM64 的 NSIS、MSI 在对应宿主完成构建、安装、资源和启动验收。
- [ ] GitHub Actions 四个 Job 在线成功，并下载核验各自未签名 artifact 的架构、资源和安装/启动行为。
- [ ] 正式发布前完成 macOS 签名/公证与 Windows Authenticode 策略确认和验证。

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
