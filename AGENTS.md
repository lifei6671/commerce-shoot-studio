# AGENTS.md

本文件是 `commerce-shoot-studio` 的项目级 Agent 指南。后续 AI/Agent 进入本仓库时，先读本文件，再读 `docs/` 中的当前方案和任务清单。

## 项目定位

`commerce-shoot-studio` 是一个本地优先的桌面商拍工作台。

当前阶段目标是把已有 mock/local state 功能重构成真实单机 MVP。后续可能切换到 SaaS runtime，但第一阶段不做用户体系、支付、团队协作和云端任务队列。

当前事实源：

- `docs/2026-06-30-local-first-saas-ready-implementation-plan.md`
- `docs/2026-07-01-local-first-implementation-task-checklist.md`
- `docs/2026-06-30-scene-module-ecom-details-image-technical-plan.md`

推进开发时按 `docs/2026-07-01-local-first-implementation-task-checklist.md` 的 M0 -> M7 顺序执行，不跳依赖。

## 已确认协作硬约束

- 默认使用简体中文沟通、注释和文档说明。
- 未经用户明确同意，不准修改既有 UI 视觉效果、布局风格、设计 token、组件圆角、阴影、间距和色彩体系。
- UI 对接后端时，只做数据和交互接线；如果必须改变用户操作路径、页面结构或视觉呈现，先说明方案并等待确认。
- 涉及 UI 交互方案的新功能，先逐步向用户确认交互，再实现，避免做偏。
- 所有页面功能必须接真实 runtime / Rust / SQLite / 文件系统能力；mock 只能作为明确标注的调试 provider 或测试替身，不能伪装成已完成能力。
- 需求变更或存在技术取舍时，先找用户确认推荐方案、影响范围和风险。
- 每完成一个功能点，必须自 review 一遍代码，重点看 bug、分层、状态回写、Windows 兼容和敏感信息泄漏。
- 当前交付前的数据库 schema 仍处于 baseline 阶段；除非用户另行要求，不需要为本阶段每次数据库变更编写演进 migration。

## 技术栈

- 桌面壳：Tauri v2
- 前端：React 18 + TypeScript + Vite + Vitest
- 后端 runtime：Rust
- 本地持久化：SQLite
- 本地文件：workspace 目录内相对路径管理

常用命令以根目录 `Makefile` 为准：

```bash
make test
make frontend-build
make cargo-check
make check
```

涉及 Rust 单元或集成测试时使用：

```bash
cargo test --manifest-path desktop/src-tauri/Cargo.toml -- --nocapture
```

## 目录结构

```text
desktop/
├── src/
│   ├── app/                 # 应用壳、导航、顶栏、页面组合
│   ├── features/            # 业务功能模块
│   │   ├── generation/      # 商品图与详情图相关 UI
│   │   ├── clothing/        # 服饰试穿相关 UI
│   │   ├── scenes/          # 场景图相关 UI
│   │   ├── history/         # 生成历史 UI
│   │   ├── model-config/    # 模型配置 UI
│   │   └── settings/        # 设置 UI
│   ├── runtime/             # 前端唯一 runtime 合同层
│   │   ├── ports/           # Public Runtime Ports
│   │   └── types/           # DTO / 状态 / 错误类型
│   ├── shared/              # 通用 UI 和小工具
│   └── test/                # 前端测试 setup
└── src-tauri/
    ├── src/
    │   ├── commands/        # Tauri command 边界，仅做入参/出参/错误转换
    │   ├── domain/          # 领域模型、领域错误、纯业务状态
    │   ├── services/        # 用例编排
    │   └── infrastructure/  # SQLite、文件系统、Provider adapter 等实现
    └── tests/               # Rust 集成测试
```

## 架构原则

### 前端边界

- 页面和 feature 只能调用 `desktop/src/runtime` 暴露的 Public Runtime Ports。
- 页面不要直接调用 SQLite、Provider SDK、远端 API 或 Rust 内部实现。
- 新增 Tauri IPC 时，优先放到 runtime local adapter 内，不要散落在页面组件中。
- SaaS 切换时页面不写 `if (isTauri)`；页面只根据 `RuntimeInfoPort.features` 显示或隐藏入口。

### Rust DDD 分层

Rust 代码按以下方向组织：

- `domain`：领域类型、领域错误、状态枚举和不依赖 IO 的规则。
- `services`：用例编排，例如 workspace 初始化、任务创建、资产导入、模型调用流程。
- `infrastructure`：SQLite、文件系统、Provider HTTP、下载、系统能力适配。
- `commands`：Tauri IPC 边界，只负责 serde DTO、参数校验、调用 service、转换错误。

不要把所有逻辑堆进 `lib.rs` 或单个 service 文件。`lib.rs` 保持 Tauri builder 和模块注册入口。

### Runtime Ports

已规划的 Public Runtime Ports：

- `WorkspacePort`
- `SettingsPort`
- `ShellPort`
- `RuntimeInfoPort`
- `AssetPort`
- `GenerationPort`
- `PromptPlanPort`
- `CapabilityPort`
- `ModelConfigPort`
- `SecretPort`
- `AiAssistPort`

`ModelGatewayPort` 是 runtime 内部端口，不暴露给 React feature。

## 数据与安全口径

当前已确认的 MVP 口径：

- API Key 存 SQLite 本地密钥表，不使用 macOS Keychain / Windows Credential Manager。
- API Key 只能进入 `model_secrets.secret_value`。
- `model_configs` 只保存模型配置和 `secret_ref`，不直接保存 API Key。
- `LocalModelConfigView` 不包含 secret 明文。
- 日志、`task_events.detail_json`、settings、asset、导出默认包和前端 DTO 都不能包含 API Key 明文。
- raw prompt、系统 Prompt、Provider raw request、Provider raw response 永不入库。
- 模型“测试连接”的控制台诊断只能输出脱敏摘要，且不得持久化；禁止输出请求/响应原文、Authorization、Cookie、原始 header、API Key、Prompt、图片数据或用户配置的 Base URL / endpoint 原始路径。
- 真实模型调用默认不输出 raw Prompt。仓库 `make dev` 会在 Debug 构建中设置 `COMMERCE_SHOOT_STUDIO_DEBUG_PROMPTS=1`，将 system、user 和 roleless Prompt 输出到终端 `stderr`；同一开关也允许输出归一化后的模型结果摘要，但必须移除图片数据、URL、header、凭据和 secret。其它 Debug 启动方式需显式设置该变量。这些例外不得写入 `model-gateway-diagnostics.jsonl`、SQLite、`task_events`、导出包或前端 DTO，且 Release 构建必须编译期禁用。
- SQLite 只保存 workspace 内相对路径，不保存用户原始绝对路径。
- workspace / DB 文件要做权限加固：macOS/Linux 目录建议 `0700`、DB 文件建议 `0600`；Windows 使用当前用户 ACL。

## 工作流

### 默认开发顺序

按任务清单推进：

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

不要为了后续里程碑提前扩范围。当前任务没要求的 SaaS、支付、团队、云队列都不要实现。

### TDD 和自 review

新增功能或修 bug 时：

1. 先写能失败的测试。
2. 确认失败原因是目标功能缺失或 bug 存在。
3. 写最小实现让测试通过。
4. 每完成一个功能点，自己 review 一遍：
   - 是否有明显 bug 或边界漏掉。
   - 是否破坏 DDD 分层。
   - 是否泄漏 secret / raw prompt / raw response。
   - 是否有 Windows 路径、文件锁、权限问题。
   - 是否过度抽象或扩大范围。
5. 运行相关验证命令。

测试中允许使用 `expect` / `unwrap` 等清晰失败方式；生产代码必须显式传播 IO、DB、RPC、外部 API 错误。

### 需要先找用户确认的事项

以下变更不能擅自做：

- 新增、升级、移除依赖或手动修改 lockfile。
- 新增或修改数据库 schema / migration。
- 修改公共 Runtime Port、DTO、事件结构或跨模块协议。
- 修改配置项、权限、Tauri capability、打包签名策略。
- 引入新的外部服务、Provider、网关或 SaaS API。
- 批量重命名、大范围移动文件、跨模块重构。
- 改变已确认安全口径，例如 API Key 存储方式。

如果必须做这些事，先用简短说明列出影响范围、风险和推荐方案，等用户确认。

## 前端规范

- 复用 `desktop/src/shared/ui` 中的基础组件。
- UI 不直接关心 Provider、model routing、raw prompt。
- 设置页、模型页、历史页不能继续把 mock 当真实完成。
- 页面状态可以临时存在，但持久化事实必须来自 runtime。
- 新增页面逻辑优先补 Vitest / Testing Library 测试。
- 文本和注释使用简体中文；复杂交互或业务规则处添加简短中文注释。

### UI 视觉与交互边界

- 不要因为接后端、补测试或重构状态管理而顺手重做 UI。
- 模型配置页、设置页等已确认视觉稿的页面，必须保持原有视觉效果；只允许做用户明确要求的交互状态，例如 loading、disabled、toast。
- 下拉、按钮、输入框等已有组件优先复用现有实现；需要调整共享组件时，先确认不会影响其它页面视觉。
- 点击测试连接、保存、清理等异步动作时，按钮必须有 loading / disabled 状态，防止重复点击。
- 异步失败必须用全局 toast 展示明确错误原因，不能静默失败。
- 全局 toast 统一从 `desktop/src/shared/ui/toast.tsx` 使用，分为 success / error / warning，默认 3 秒自动消失。

### 设置页规则

- 设置页所有配置都是变更后立即保存、立即生效，不再提供底部“保存设置 / 恢复默认设置 / 未保存更改”操作栏。
- 工作区目录和输出目录在首次初始化时确定默认值，默认路径遵循 macOS / Windows 官方建议的应用数据目录。
- 设置页路径选择、打开文件夹、开机启动、最小化到托盘、提示音播放、缓存清理都必须是真实能力，不允许 mock。
- 提示音必须真实播放，支持 `clear`、`soft`、`success`、`viral`。
- 设置保存是即改即存链路，连续快速操作时只能让最后一次保存结果回写页面，避免旧响应覆盖新状态。

### 模型配置页规则

- 模型配置页必须通过 `ModelConfigPort`、`CapabilityPort`、`SecretPort`、`RuntimeInfoPort` 接真实后端，不允许页面维护假 provider 状态。
- 除固定为 `mock://local` 的 Mock Local 外，本地模型配置的 Base URL 可编辑并持久化，但只接受无凭据、无查询参数的 HTTPS 地址；provider 是否可用以持久化 `connectionStatus` 和连接指纹为准，provider、model、Base URL、endpoint、API Key 任一变化后必须回到 `untested / 不可用`，直到测试成功。
- 测试连接必须异步执行，测试中禁止修改当前卡片的 provider、model、base URL、API Key，并禁用重复点击。
- 测试失败必须 toast 展示归一化后的错误原因；不要直接暴露 Provider raw error、raw response 或 secret。
- API Key 输入框未配置时可输入；已配置时默认显示脱敏值，点击眼睛后可查看当前输入框内明文，但不得从后端 DTO 回传 secret 明文。
- 保存配置必须有 loading 过渡和 toast 提示。
- Mock Local provider 只用于本地调试和自动化测试，不触发真实模型调用。

### Provider 接入规则

- MVP provider allowlist 为 `mock-local`、`openai`、`deepseek`、`volcengine`。
- MVP 不开放任意 custom gateway；SQLite 中的 provider/profile 不能绕过 Rust 内置 allowlist。
- 用户可为内置 provider profile 的本地模型配置修改并持久化 Base URL；Mock Local 固定为 `mock://local`，其他 provider 只接受无凭据、无查询参数的 HTTPS 地址。连接探测和真实调用使用该持久化地址。React 页面不提供 endpoint path 编辑；OpenAI / 火山引擎的特殊图像 endpoint 由 Rust 强制映射，其他类别继续使用已保存的 endpoint path 或 provider profile 默认值。
- DeepSeek 当前只开放文生文能力。
- OpenAI-compatible 文生文默认走 `/chat/completions`。
- OpenAI 图生图的 `clothing-tryon-generation` 与 `image-edit` 固定走 `/v1/images/edits` 的 `multipart/form-data`；只接受 PNG、JPEG、WebP，按 1:1、横向、竖向映射目标尺寸，输入图不裁剪、不转码。保存配置、Provider 连接探测和历史配置执行都必须强制解析该 endpoint，不能回写旧 `/v1/responses`；当前仅有本地 HTTP/单元测试证据，未验证真实 OpenAI 外网调用。
- 火山引擎文生图和图生图使用 Ark `/api/v3/images/generations`；图生图测试图片可用很小的 base64 图片。连接探测必须按精确 Seedream 模型能力构造参数：`doubao-seedream-5-0-pro-260628` 不支持组图和流式字段，禁止发送 `sequential_image_generation`、`sequential_image_generation_options`、`stream`，并使用 `1K` 降低探测耗时和费用；Seedream 5.0 Lite、4.5、4.0 使用单图非流式探测，发送 `sequential_image_generation: "disabled"`、`stream: false` 且不发送组图 options；未登记模型使用不含这些可选字段的最小请求，不猜测能力。单张参考图发送字符串，多张参考图发送数组。火山引擎文生图/图生图连接探测和真实图片调用使用 300 秒总超时，图生文探测保持 60 秒；OpenAI 图片调用仍使用既有时限。前端生成任务无进展窗口为 360 秒，必须长于最长 Provider timeout，queued 未启动窗口保持不变。
- 火山引擎图生文使用 Ark `/api/v3/responses`，图片理解输入按官方 `input_image` + `input_text` 结构组织。
- React 页面不要让用户自由编辑真实执行 endpoint；Rust runtime 对 OpenAI / 火山引擎的特殊图像能力强制解析内置 endpoint，其他类别使用已保存的 endpoint path 或 provider profile 默认值。
- 图片尺寸选项必须由 Rust runtime 按当前 `image-edit` 的 provider + model 精确返回；React 只展示选项并回传 provider 原始 `size` 值，不能自行维护模型尺寸表。`doubao-seedream-5-0-pro-260628` 只暴露官方 1K/2K 八种宽高比（包含 21:9）的精确像素选项，不沿用旧 Seedream 2K/4K 表；未知模型不猜测尺寸，直接返回空选项。

## Rust 规范

- Tauri command 使用 owned 参数，不在 async command 中借用 `&str`。
- 新 command 必须注册到 `tauri::generate_handler![]`。
- command 返回 `Result<T, E>`，错误要能序列化给前端。
- 文件路径用 `PathBuf` / `OsString`，不要字符串拼路径。
- 物理文件写入先写 temp，再 atomic rename。
- Windows 下删除或 rename 前确保文件句柄关闭。
- Windows 兼容是首版要求，不是后补项；任何文件、目录、托盘、自启动、路径展示和打开文件夹逻辑都要考虑 Windows 行为。
- 开机启动和最小化到系统托盘必须调用真实 Tauri / 系统能力，不允许只做 UI mock。
- 默认 workspace / output 目录必须使用系统推荐的 app data / application support 位置，不要默认写到源码目录或用户随意目录。
- 不要把用户选择的原始绝对路径写入资产、任务和导出元数据；workspace 内资源落库使用相对路径。
- SQLite 后续必须启用：
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA journal_mode = WAL`
  - `PRAGMA busy_timeout = 5000`
- migration 失败时禁止进入主界面。

## Git 与本地文件注意事项

- 不要提交 `.idea/`、`.codex/`、本地 token、API Key、密码、私有配置。
- 当前项目可能存在用户未提交改动；不要 revert 非本轮修改。
- 提交前至少运行和本次切片相关的验证命令。
- 如果用户要求提交，只 stage 本轮相关文件，避免混入无关本地变更。

## 当前开发状态提示

截至 2026-07-01：

- 已开始 M0。
- 前端 `desktop/src/runtime` 已建立 Runtime Port 类型骨架。
- Rust `WorkspaceService` 已建立 workspace 初始化 / 修复 / 云同步目录 warning 骨架。
- Rust `WorkspaceDatabase` 已建立 SQLite 打开、PRAGMA 和 migration runner 骨架。
- Rust `StartupRecoveryService` 已建立启动恢复 no-op 入口和 `cache/tmp` 清理骨架。
- 前端启动已接 `BootstrappedApp`：首次进入显示简单初始化 loading，workspace 初始化完成后默认进入商品页。
- M1 的 `RuntimeInfoPort` 底层命令和本地 adapter 已建立，可返回 local mode、版本号和 feature flags。
- M1 的 `SettingsPort` 底层持久化已建立：SQLite `settings` 单行 JSON、Rust service / command、前端 local adapter。
- M1 的 `ShellPort` 底层能力已建立：目录选择、reveal path、通知 no-op command 和前端 local adapter。
- M1 设置页已接真实 `SettingsPort` / `ShellPort` / `RuntimeInfoPort`：可加载、即改即存、选择目录、打开目录，并根据 runtime feature 禁用系统通知；页面不再保留底部手动保存操作栏。
- M2 的 Asset 后端基础能力已建立：`assets` baseline schema、Rust `AssetService` / Tauri command、前端 `localAssetPort` adapter。
- M2 已支持导入图片到 workspace 相对路径、sha256 去重、PNG/JPEG 尺寸读取、`staged/active/deleted` 生命周期、列表/详情、reveal、软删除和 GC。
- M3 的任务历史后端基础已建立：`generation_tasks` / `task_events` baseline schema、Rust `GenerationService` / Tauri command、前端 `localGenerationPort` adapter。
- M3 已支持 create/get/list/getTaskDetail、idempotency key、failed idempotency 返回 `TASK_RETRY_REQUIRED`、input asset relations、创建任务时激活输入资产、retry/cancel/delete 基础语义。
- 普通任务重试必须调用 `retryTask`，由 runtime 写入 `retry_of_task_id` / `attempt_no`；商品与服饰单图重试为保留单项 `items` 输入，使用 `createTask` 创建子任务，并在冻结输入中持久化 `parentTaskId`、该项 `imageId` 和 `imageNo`，不伪造 runtime 级 retry 关联。历史恢复必须优先原样使用冻结输入中的稳定 `imageId`，仅为旧任务合成 fallback。商品/服饰单图重试成功后必须在同一事务内把唯一 active output 归并到父任务稳定槽位并隐藏子任务；失败槽位删除即使没有 output asset，也必须按稳定 `imageId` / `imageNo` 写删除 tombstone，保证历史恢复不复活卡片，后续晚到的重试结果也必须拒绝归并。同槽位旧派生任务被替换或删除时，仍处于 `queued` / `running` 的任务必须原子转为 `cancelled` 并隐藏，执行器的 stage、结果持久化和终态回写都必须拒绝隐藏任务。
- 生成历史的展示状态以当前结果槽为事实源，不修改父 `generation_task` 的原始审计终态：全部结果槽成功显示“已完成”，成功与失败并存显示“部分失败”，全部失败显示“失败”，非 stale 的 `queued` / `running` 任务显示“生成中”。
- M5 的模型配置基础已建立：`model_configs` / `model_secrets` baseline schema、内置 provider profile allowlist、Rust `ModelConfigService` / `SecretService` / `CapabilityService`、前端 local adapters 和模型配置页真实 UI。
- 默认内置 `mock-local` provider，并为 `listing-copy`、`prompt-plan`、`viral-style-analysis`、`scene-image-generation`、`product-detail-generation`、`clothing-tryon-generation`、`image-edit` 生成默认 mock 配置；mock 不触发真实模型调用。
- 当前 provider allowlist 是 `mock-local`、`openai`、`deepseek`、`volcengine`。DeepSeek 第一版只开放文生文能力；OpenAI 和火山引擎可作为多能力 provider profile。
- provider 可用性持久化在 `model_configs.connection_status` 等字段中；连接指纹包含 provider、模型、Base URL、执行模式、endpointPath 和 secret version，修改 API Key、模型、Base URL 或接入路径后会自动回到 `untested`。
- M6 的 deterministic `ModelGatewayService` 基础已建立，可对 7 个 capability 返回 mock 输出，不触发真实 Provider 调用。
- 下一步继续 M6/M7：真实 Provider HTTP adapter 依赖确认、ModelGateway invocation 表、LocalTaskExecutor 接 mock gateway、Windows 文件名规则、历史页 UI 对接。涉及素材库 UI、历史页 UI、导入交互或初始化失败恢复入口等 UI 交互时必须先确认方案。
