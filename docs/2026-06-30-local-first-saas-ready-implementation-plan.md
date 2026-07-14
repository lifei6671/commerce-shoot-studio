# 商拍工坊真实实现方案：单机优先，SaaS 可切换

> 日期：2026-06-30
>
> 范围：重新实现当前项目的真实业务能力，不沿用历史 checklist。
>
> 当前目标：先完成本地单机版本；后续可切换到远端服务，演进为 SaaS。

## 1. 核心结论

当前项目应按 `Local-first + Port/Adapter` 架构重做业务运行时。

第一阶段不做云端业务后端，不做用户体系、套餐、支付和团队协作；但必须从第一天开始把核心能力抽象为接口，避免 UI、Tauri 命令、SQLite、Provider 调用互相耦合。

推荐总结构：

```text
React UI
  |
  v
Frontend Application Services
  |
  v
Typed Runtime Client
  |
  v
Runtime Port Interfaces
  |
  +-- Local Runtime Adapter  -> Tauri Rust -> SQLite / Local FS / Provider API
  |
  +-- Remote Runtime Adapter -> HTTPS API  -> SaaS Backend / Object Storage / Queue
```

前端只依赖 `Runtime Port Interfaces`，不直接依赖 Tauri、SQLite、Provider SDK 或远端 API 细节。

## 2. 阶段目标

### 2.1 当前单机版本目标

单机版本必须真实完成：

- 本地工作区初始化。
- 图片素材导入与资产管理。
- 模型配置与 API Key 本地保存和权限加固。
- 商品、服饰、场景三类生成任务。
- 生成方案计划、可展示摘要编辑和确认。
- ModelGateway 调用、轮询、下载和失败传播。
- 生成结果本地落盘。
- 历史记录持久化。
- 设置持久化。
- 启动后恢复历史与未完成任务状态。

### 2.2 后续 SaaS 版本目标

SaaS 版本可以替换这些能力的实现：

- 任务执行从本地 Provider 调用切到云端队列。
- 资产从本地文件切到对象存储。
- 历史从 SQLite 切到远端数据库。
- 模型配置、模型路由和密钥从本地 runtime 切到服务端租户级配置，客户端不感知 provider、model、baseUrl、endpointPath 等模型参数。
- Prompt 模板从本地 Rust 内置切到服务端维护，客户端不感知系统 Prompt 或最终拼接后的 raw prompt。
- 用户、套餐、额度、团队空间由云端服务提供。

SaaS 化不应要求重写页面组件和业务流程，只替换 runtime adapter。

## 3. 不变边界

### 3.1 UI 不直接做的事

React UI 禁止直接处理：

- Provider HTTP 请求。
- API Key 持久化或回显。
- SQLite 读写。
- 真实文件复制、删除、移动。
- 生成任务状态判定。
- 远端鉴权协议细节。
- 模型路由参数。
- 系统 Prompt、Prompt 模板和最终 raw prompt。

UI 只负责：

- 收集用户输入。
- 展示任务和资产状态。
- 调用 typed service。
- 展示错误、空态、加载态。

### 3.2 模型配置与 Prompt 所有权

模型配置和 Prompt 模板必须由 runtime 拥有，不属于 React UI。

单机版本：

- 模型配置可以由本地模型配置页写入，但保存后属于 Rust runtime 内部配置。
- API Key 由 Rust runtime 保存到 workspace SQLite 的本地密钥表，前端不持久化、不回显。
- provider、model、baseUrl、endpointPath、executionMode 只在 Rust runtime 内解析。
- Prompt 模板硬编码在 Rust 内，前端只传业务意图和用户输入。

SaaS 版本：

- 模型配置由服务端维护，客户端不接收、不缓存、不展示模型参数。
- 服务端按租户、套餐、能力类型和任务类型选择模型。
- Prompt 模板由服务端维护，客户端不接收、不缓存、不展示系统 Prompt。
- 客户端只传 `capability`、结构化业务输入和资产引用。

禁止模式：

```ts
await runtime.model.invoke({
  model: "gpt-image-2",
  baseUrl: "https://...",
  prompt: "完整系统 Prompt ...",
});
```

推荐模式：

```ts
await runtime.generation.createTask({
  workspace: "scene",
  kind: "image-generation",
  input: {
    capability: "scene-image-generation",
    category: "text-to-image",
    intent: {
      workspace: "scene",
      outputMode: "single",
      aspectRatio: "1:1",
      userSupplement: "用户填写的业务信息",
    },
    inputAssetIds: ["asset_123"],
  },
});
```

### 3.3 Rust / Runtime 层负责的事

本地单机版本中，Rust runtime 负责：

- 本地数据库。
- 本地文件系统资产目录。
- SQLite 本地密钥表。
- ModelGatewayAdapter。
- 任务状态机。
- 结果文件保存。
- 日志脱敏。
- 本地模型配置解析。
- 本地 Prompt 模板选择和渲染。

### 3.4 Model Gateway Adapter 负责的事

所有大模型调用都必须先经过 `ModelGatewayAdapter`，再落到具体 Provider 或第三方 API 网关。

`ModelGatewayAdapter` 负责：

- 构造请求。
- 将内部模型请求转换为 OpenAI 官方或 OpenAI-compatible 请求。
- 上传、读取或引用图片输入。
- 处理同步返回、流式返回和异步任务返回。
- 轮询异步任务。
- 下载或归一化结果资产。
- 归一化错误。
- 屏蔽 Provider 和第三方网关 raw response。

业务层不直接依赖某个 Provider 或第三方 API 网关的原始字段。

## 4. 模块边界

### 4.1 前端目录建议

```text
desktop/src/
├── app/
├── features/
│   ├── product/
│   ├── clothing/
│   ├── scenes/
│   ├── history/
│   ├── settings/
│   └── model-config/
├── runtime/
│   ├── ports/
│   ├── local/
│   ├── remote/
│   └── types/
└── shared/
```

说明：

- `features/*` 只做页面和业务用例编排。
- `runtime/ports` 定义稳定接口。
- `runtime/local` 调 Tauri command。
- `runtime/remote` 未来调 HTTPS API。
- `runtime/types` 放跨模块 DTO。

### 4.2 Rust 目录建议

```text
desktop/src-tauri/src/
├── commands/
├── domain/
├── infrastructure/
│   ├── database/
│   ├── filesystem/
│   ├── secrets/
│   └── providers/
├── services/
└── lib.rs
```

说明：

- `commands` 只做 Tauri 入参、出参和错误转换。
- `services` 编排用例。
- `domain` 放任务、资产、模型配置等核心类型。
- `infrastructure` 放 SQLite、密钥表、文件系统和 Provider 实现。

## 5. Runtime Port 接口

Port 分两类：

- `Public Runtime Ports`：前端 feature 可以调用。
- `Internal Runtime Ports`：只能由 runtime service 调用，前端不能直接访问。

前端 feature 不允许绕过 `GenerationPort` 直接调用模型生成图片，否则会破坏任务状态机、历史、重试和资产落盘。

### 5.1 WorkspacePort

```ts
export interface WorkspacePort {
  getWorkspaceStatus(): Promise<WorkspaceStatus>;
  initializeWorkspace(input: InitializeWorkspaceInput): Promise<WorkspaceStatus>;
  switchWorkspace(input: SwitchWorkspaceInput): Promise<WorkspaceStatus>;
  repairWorkspace(): Promise<WorkspaceRepairResult>;
  getStorageUsage(): Promise<WorkspaceStorageUsage>;
  runGarbageCollection(): Promise<GarbageCollectionResult>;
}
```

职责：

- 初始化本地工作区目录结构。
- 打开或创建 `workspace.db`。
- 执行 SQLite migrations。
- 检查工作区是否可用。
- 切换工作区。
- 修复缺失目录、孤儿文件、异常数据库状态。
- 统计本地缓存、资产、生成结果占用。
- 手动触发 GC 清理。

启动流程：

```text
读取 settings
  ↓
检查 workspaceDirectory
  ↓
initializeWorkspace
  ↓
创建目录结构
  ↓
打开 SQLite
  ↓
执行 migrations
  ↓
扫描 running 任务
  ↓
将无执行上下文的 running 任务恢复为 failed / interrupted
  ↓
清理 orphan temp files
  ↓
加载 settings / assets / recent tasks
  ↓
允许进入主界面
```

工作区目录建议：

```text
workspace/
├── workspace.db
├── assets/
│   ├── source/
│   ├── reference/
│   ├── model/
│   ├── generated/
│   └── thumbnail/
├── cache/
│   └── tmp/
├── exports/
└── logs/
```

### 5.2 SettingsPort

```ts
export interface SettingsPort {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
}
```

职责：

- 读取和保存应用设置。

本地实现：

- SQLite 或 JSON 配置表。

远端实现：

- 读取用户或 workspace 设置。
- 输出目录字段可能变为默认云端资产目录。

### 5.3 ShellPort

```ts
export interface ShellPort {
  chooseDirectory(input: ChooseDirectoryInput): Promise<string | null>;
  revealPath(path: string): Promise<void>;
  showNotification(input: NotificationInput): Promise<void>;
}
```

职责：

- 选择本地目录。
- 打开本地路径。
- 调用系统通知。
- 承接桌面壳能力，不属于 SaaS 业务 runtime。

本地实现：

- Tauri dialog。
- 系统文件管理器。
- 系统通知。

远端实现：

- Web SaaS 默认不实现本地目录选择和 reveal。
- 需要由 UI 根据 runtime capability 展示或隐藏相关入口。

### 5.4 RuntimeInfoPort

```ts
export interface RuntimeInfoPort {
  getRuntimeInfo(): Promise<RuntimeInfo>;
}
```

职责：

- 返回当前 runtime 模式和前端可用能力。
- UI 根据 `runtimeInfo.features` 显示或隐藏本地目录、reveal path、本地模型配置、本地密钥管理等入口。
- 页面不写 `if (isTauri)`。

### 5.5 SecretPort

```ts
export interface SecretPort {
  getSecretStatus(scope: SecretScope): Promise<SecretStatus>;
  saveSecret(scope: SecretScope, value: string): Promise<SecretStatus>;
  deleteSecret(scope: SecretScope): Promise<void>;
  testProviderConnection(scope: SecretScope): Promise<ProviderTestResult>;
}
```

职责：

- 保存模型 API Key。
- 返回脱敏状态。
- 测试 Provider 连通性。

本地实现：

- SQLite 本地密钥表。
- Rust Provider test client。

远端实现：

- SaaS 后端保存加密凭据。
- 前端只拿脱敏状态。

安全要求：

- UI 不持有长期明文。
- SQLite 可以保存 API Key，但只能保存在专用本地密钥表中，不能散落到 settings、task、event、asset 或前端 DTO。
- 日志不打印 Authorization、Token、API Key。
- 单机模式下 secret 默认按 workspace 隔离，不同 workspace 不共享 API Key。
- 本地密钥记录必须包含 `workspaceId` 和 `providerProfileId`，避免测试 workspace 与正式 workspace 共用凭据。
- workspace 目录必须做权限加固：macOS / Linux 目录建议 `0700`，SQLite 文件建议 `0600`；Windows 使用当前用户 ACL。
- 自动备份、导出和诊断包默认不得包含 API Key；如果未来提供“包含密钥”的导出，必须二次确认并明确风险。

### 5.6 CapabilityPort

```ts
export interface CapabilityPort {
  listCapabilities(): Promise<ModelCapability[]>;
  getCapability(capabilityId: ModelCapability["id"]): Promise<ModelCapability>;
}
```

职责：

- 作为模型能力唯一查询入口。
- 模型配置页判断能力是否已配置。
- 工作台生成按钮判断能力是否可用。
- SaaS 模式展示服务端返回的能力限制。
- UI 空态提示用户缺少哪类模型能力。
- `AiAssistPort` 和 `GenerationPort` 共用同一套 capability source of truth。

一致性规则：

- local mode 下 `CapabilityPort` 必须从 `model_configs`、`SecretStatus` 和 Rust 内置 `ProviderProfile` 实时计算。
- `ModelConfigPort.saveConfig`、`setDefaultConfig`、`deleteConfig`、`SecretPort.saveSecret`、`deleteSecret` 成功后，`CapabilityPort` 的结果必须立即反映。
- 如果 runtime 内部做 capability 缓存，以上写操作必须使缓存失效。
- UI 不允许自行拼接 capability 可用状态。

### 5.7 ModelConfigPort

```ts
export interface ModelConfigPort {
  listConfigs(): Promise<LocalModelConfigView[]>;
  getConfig(configId: string): Promise<LocalModelConfigView>;
  saveConfig(input: SaveLocalModelConfigInput): Promise<LocalModelConfigView>;
  setDefaultConfig(input: SetDefaultModelConfigInput): Promise<LocalModelConfigView>;
  deleteConfig(configId: string): Promise<void>;
  listProviderProfiles(): Promise<ProviderProfileView[]>;
  testConfig(configId: string): Promise<ProviderTestResult>;
}
```

职责：

- 只在 local mode 暴露本地模型配置视图。
- remote / SaaS mode 不暴露 provider、model、baseUrl、endpointPath、executionMode。
- SaaS 模式只通过 `CapabilityPort` 返回能力状态。
- API Key 不允许进入 `LocalModelConfigView`。
- `ResolvedModelConfig` 只能存在于 Rust runtime 内存中，不能序列化给前端。

remote mode 行为：

- 正常 UI 必须通过 `RuntimeInfo.features.supportsLocalModelConfig = false` 隐藏模型配置入口。
- 如果 remote adapter 仍收到 `ModelConfigPort` 调用，必须返回 `MODEL_CONFIG_UNAVAILABLE`，不能返回空配置误导 UI。

### 5.8 AssetPort

```ts
export interface AssetPort {
  listAssets(query?: AssetQuery): Promise<AssetPage>;
  listBuiltinModels(): Promise<BuiltinModelAsset[]>;
  getAsset(assetId: string): Promise<Asset>;
  importImages(input: ImportImagesInput): Promise<Asset[]>;
  revealAsset(assetId: string): Promise<void>;
  deleteAsset(assetId: string): Promise<void>;
}
```

职责：

- 导入商品图、服饰图、模特图、参考图。
- 管理生成结果。
- 提供前端可渲染的 asset URL。

本地实现：

- 原生文件选择器。
- 复制到 app workspace assets。
- SQLite 只保存相对路径和元数据。
- Tauri asset protocol 渲染。
- `listBuiltinModels()` 读取安装包内 `builtin-models/` 和 `builtin-model-thumbnails/`；这些内置模特是 local mode 的 bundled resource，不导入 workspace，不进入用户资产删除和 GC 链路。
- 模特资产导入后由 Rust 在本地生成 `assets/thumbnail/{assetId}.png` 的 320×320 顶部居中头像缩略图；`AssetDto.thumbnailPath` 只在文件存在时返回，模特库展示缩略图，任务输入和全身预览仍使用原图。
- 旧模特资产没有缩略图时回退原图；删除资产并运行 GC 时同步清理对应缩略图。

远端实现：

- 上传到对象存储。
- 返回 signed URL 或 CDN URL。
- 当前尚未实现 remote Asset adapter。未来 remote adapter 在没有云端内置模特 URL 合同前，`listBuiltinModels()` 必须返回空数组，不返回 local bundled path，也不把内置模特伪装成 workspace 资产。

### 5.9 GenerationPort

```ts
export interface GenerationPort {
  createTask(input: CreateGenerationTaskInput): Promise<GenerationTask>;
  getTask(taskId: string): Promise<GenerationTaskDetail>;
  listTasks(query: GenerationTaskQuery): Promise<GenerationTaskPage>;
  cancelTask(taskId: string): Promise<GenerationTask>;
  retryTask(taskId: string): Promise<GenerationTask>;
  deleteTask(taskId: string): Promise<void>;
  replaceResultImage(input: ReplaceGenerationResultImageInput): Promise<void>;
  deleteResultImage(input: DeleteGenerationResultImageInput): Promise<void>;
}
```

职责：

- 创建商品、服饰、场景生成任务。
- 查询任务状态。
- 重试、取消、删除任务。
- 提供历史记录。
- 编排图片生成、图片编辑、服饰试穿、商品详情图等所有会产生资产的能力。
- 对单张结果图执行原子替换或删除；替换保留原结果槽位，删除只移除该结果关系并软删除不再被可见任务引用的资产。
- 商品、服饰和场景的实时结果及历史恢复结果统一支持 AI 改图：创建 `image-edit` 任务时只关联当前展示图资产，并持久化用户微调要求与结果 lineage；完整 system/user/roleless Prompt 由执行器在内存组装，不进入 task JSON。执行器在运行时解析当前默认真实 `image-edit` 模型配置，`mock-local` 不得产生可归并结果；成功后原子替换父任务稳定槽位，失败时保留原图。
- 商品、服饰、场景三类实时结果及对应三类历史结果入口统一支持“编辑文字”：先通过 `AiAssistPort` 的 `image-text-recognition` 能力只提交当前 active generated `assetId`，由 Rust 在内存读取图片并使用执行时最新真实图生文配置识别文字、阅读顺序和归一化位置；空结果提示“未识别到文字”并关闭浮层。用户只提交发生变化的行，非空值生成 `replace`，清空值生成 `delete`；随后创建 `result-image-text-rewrite` 的 `image-edit` 任务，由执行时最新真实图生图配置按位置改字或擦除。识别 Prompt、改字 Prompt、图片 Base64 和 Provider 原始响应均不得进入 task JSON、SQLite 或前端 DTO。

本地实现：

- Rust service 创建 SQLite task。
- 本地异步执行模型调用。
- 结果下载到 workspace。

删除语义：

- `deleteTask` MVP 只软删除或隐藏任务历史，不物理删除输入资产和生成结果资产。
- 资产物理删除只能通过 `deleteAsset` 和 GC 规则执行。
- 被删除任务的结果资产仍可被资产库引用；任务详情不再出现在默认历史列表。
- `listTasks` 默认过滤 `deleted_at IS NULL`，只有 `includeDeleted = true` 时返回已隐藏任务。

远端实现：

- HTTPS 创建云端任务。
- 云端队列执行。
- 前端轮询或订阅状态。

### 5.10 PromptPlanPort

```ts
export interface PromptPlanPort {
  getPlan(planId: string): Promise<PromptPlan>;
  createPlan(input: CreatePromptPlanInput): Promise<PromptPlan>;
  updatePlan(planId: string, patch: PromptPlanPatch): Promise<PromptPlan>;
  confirmPlan(planId: string): Promise<PromptPlan>;
  deletePlanItem(planId: string, itemId: string): Promise<PromptPlan>;
}
```

命名说明：`PromptPlanPort` 表示“生成方案计划”能力，不表示客户端能读取 raw prompt。实际实现时也可以命名为 `CreativePlanPort`，以避免误解。

职责：

- 商品详情页模块计划。
- 商品详情业务方案编辑和确认。
- 根据业务输入生成可展示的计划摘要，但不向客户端暴露系统 Prompt 模板。
- 当前服饰场景规划不属于 `PromptPlanPort`：服饰菜单通过 `GenerationPort` 创建 `clothing-scene-planning` 任务。

商品菜单详情页模块清单以 `docs/2026-07-08-product-menu-detail-modules.md` 为准。当前商品菜单支持 14 个详情页模块：首屏主视觉、核心卖点图、使用场景图、多角度图、场景氛围图、商品细节图、品牌故事图、尺寸/容量/尺码图、效果对比图、详细规格/参数表、工艺制作图、配件/赠品图、系列展示图、商品成分图。

MVP 适用范围：

- 商品详情图采用两阶段流程：先通过 `PromptPlanPort` 创建、编辑并确认方案，再通过 `GenerationPort.createTask` 创建资产型任务。
- 服饰菜单采用 `GenerationPort` 三阶段链路：用户选择 AI 生成模特时，先创建 `clothing-base-model-generation` 文生图任务，基于性别、年龄、国家/族群、身材与外貌补充生成单人全身的基准模特图；年龄支持婴儿、儿童、青少年、青年、中年、老年，且 Prompt 必须按照所选年龄阶段生成，不得将未成年人错误改写为成年人。随后创建 `clothing-scene-planning` 图生文规划任务，输入服装原图、基准模特全身图、用户选择/自定义场景，输出可展示的模特特征、场景与动作结构；场景规划 Prompt 不携带出图比例，也不要求模型回传运行时已经确认的参考图索引。该规划 prompt 由 `desktop/src-tauri/src/services/prompts/clothing_scene_planning.toml` 配置。用户已选择场景时，Prompt 按编号要求模型逐字复制并保持顺序；运行时以用户场景标题为事实源，可接受唯一的标题扩写匹配并整体重排场景对象，无法唯一匹配时拒绝结果，避免标题与场景描述、动作错配。规划结果展示到第二步场景选择后默认全部未选中，用户手动选择的场景动作、画幅和角度修改保存在 App 层，生成完成或切换菜单后仍保留。用户确认动作后再创建 `clothing-tryon-generation` 资产型任务，第三步正式出图 prompt 由 `desktop/src-tauri/src/services/prompts/clothing_tryon_generation.toml` 配置，并拼接第一步用户上传的服装图、用户选择的模特图、第二步用户选择的场景、图片比例、拍摄画幅、拍摄角度、拍摄位置和动作要求，明确约束模型严格参考模特与服装原图，不得伪造其他人物，不得修改服装花纹、文字、Logo 等关键细节。基准模特、服饰规划和服饰试穿执行路径要求真实 provider，默认 `mock-local` 只作为测试替身，不能向 UI 展示为真实生成结果。模型配置页的 `图生文` 类别同时覆盖商品卖点提取和服饰场景规划；旧 workspace 只有商品卖点图生文真实配置时，runtime 可按同类别复用该可用配置执行服饰规划。`clothing-base-model-generation` 则必须解析其独立的 `text-to-image` capability，不能复用 `clothing-tryon-generation` 的图生图配置。
- 基准模特体型 UI 固定为纤细、苗条、精瘦、匀称、健美、运动型、肌肉型、壮硕、结实、丰满、微胖、大码，默认匀称且不提供肥胖；`generation_tasks.input_json` 只冻结短标签，runtime 在渲染 Prompt 时查表注入完整描述。大码复用丰满描述；历史 `标准`、`肌肉` 分别兼容为匀称、肌肉型，未知值原样保留。
- 基准模特性别 UI 使用男、女短标签；runtime 在渲染 Prompt 时注入对应的自然发型默认描述。用户填写的外貌细节与内置发型描述冲突时，以用户输入为主，不能强行保留冲突的默认发型。
- 基准模特输出必须严格为 2:3 纵向比例（宽:高=2:3），Prompt 的 system、user 和 `rolelessPrompt` 均明确禁止其它比例。
- 服饰试穿支持最多 5 张服装参考图和 1 张模特图；runtime 必须先把唯一模特图规范化为第 1 张参考图 A，再将 1–5 张服装图依次映射为 B-F，随后渲染 system、user、output 和 `rolelessPrompt`。`clothing_tryon_generation.toml` 的 `negative_prompt` 以“负向约束”并入真实发送的 Prompt。
- 基准模特年龄 UI 使用婴儿、儿童、青少年、青年、中年、老年短标签；`generation_tasks.input_json` 仍只保存短标签，runtime 在渲染 Prompt 时注入对应的完整年龄阶段描述，user message 与 `rolelessPrompt` 保持一致；未知历史年龄值原样保留。
- 基准模特人群 UI 使用欧美白人、中国人、东亚人、东南亚人、非裔、中东人、拉丁裔短标签；`generation_tasks.input_json` 仍只保存短标签，runtime 在渲染 Prompt 时注入对应的完整族裔描述，user message 与 `rolelessPrompt` 保持一致；未知历史人群值原样保留。
- 场景菜单采用两阶段 `GenerationPort` 链路：先创建 `scene-prompt-planning`
  图生文任务，基于 1-3 张参考图和场景配置输出 1/5/9/14 项结构化方案；
  用户审核后再创建一个父 `scene-image-generation` 图生图任务逐项执行。
  同一个规划任务内部串行执行两次同 capability 调用：先由
  `scene_template_routing.toml` 使用精简 routing index 选择 conversion driver、视觉方向和
  模板，再由 `scene_prompt_planning.toml` 只注入选中模板的完整规则生成最终方案并选择 variant。
  生图 Prompt 和 25 个模板目录分别来自 `scene_image_generation.toml` 和
  `scene_template_catalog.toml`，业务 Prompt 不硬编码在 Rust 中。
  当前版本为 routing `v3`、planning `v10`、generation `v7`、catalog `v5`。catalog 已逐项恢复原
  25 模板的 variant ID、品类执行规则以及安全化后的镜头、光线、姿态、情绪和
  Anti-AI 语义；固定 8K、真实品牌、平台数据、示例原文与无证据功效不迁入。
  父任务通过 `promptPlanId` 关联规划任务，并冻结 planning/generation Prompt 版本、
  catalog 版本、Campaign Style Lock 和最终 `items[]`。
  UI 不再展示或提交场景模板、模板分类或视觉方向；用户只选择输出内容和尺寸、上传参考图，
  并填写必填补充信息。补充信息为空时不得创建规划任务。`hero-pack` 的 H1-H5 由
  `visual/pain-point/emotional` 转化驱动力选择对应叙事，D1-D9 固定为
  “首屏承接 → 痛点 → 机制 → 利益 → 步骤 → 场景 → 对比 → 信任 → FAQ/CTA”。
  图片包的 5/9/14 项是固定 runtime 合同，不允许删除或拖拽。第二步为每项输出独立
  `variantId`、给用户查看的 `promptSummary` 和不展示的完整可执行 Prompt；审核页只展示
  场景摘要，不允许直接编辑隐藏 Prompt。输出内容四个标题复用共享 Tooltip 图标说明实际数量和用途。
  父生图任务及其成功、部分失败或失败结果进入生成历史的“场景”分类；
  打开实时或历史场景结果时，由冻结参考资产重建首位“原图”卡，但该卡不单独创建生成
  记录，也不计入生成数量、历史缩略图、选择、下载、长图预览或图片相册。生成的人物/商品
  场景图仍作为历史缩略图和相册内容；相册按图片固有比例展示，不在图片外补浅色背景。
  商品、服饰、场景和历史结果的下载入口复用共享 `PreviewCanvas`：长图先把真实 workspace asset
  读取为 Blob，再以 ImageBitmap 或临时 object URL 解码进 Canvas；Canvas 同时限制最大边长和总
  像素数，并保持所有分段使用同一缩放比例。输出 `.png` 必须是实际 PNG 字节，不允许 SVG/渐变
  占位回退。ZIP 下载写入原始生成资产字节、保留受支持扩展名并标记 UTF-8 文件名。异步下载期间
  禁止重复点击，读取、解码、合成、编码和保存错误必须 toast，用户取消保存对话框不视为失败。
  当前 JSON IPC 下 ZIP 顺序读取图片，原始资产累计超过 32 MiB 时提示用户按分组或分批下载；更大
  图片包需要后续改为二进制或流式写盘协议，不能继续扩大前端 number array。
  单图、长图和 ZIP 的最终字节在转换为 IPC number array 前统一限制为 32 MiB，超限时不得调用
  本地写盘命令，并提示当前版本限制。
  当前资产角色仍表示同一商品的多角度参考，因此 `multi-product` 仅允许表达参考图中
  已存在的同款/同系列组合，不承诺任意多 SKU 生成。
  规划 item 通过独立 `variantId` 冻结唯一变体；planning 在冻结模板内选择 variant，Rust 只
  校验结构、catalog 归属和冻结路由一致性。完整 Prompt 已在规划阶段应用模板、变体、品类和
  负向规则。参考图按商品、人物、空间、界面或组合主体
  解释，不再把人物一律标记为商品；人物型模板必须保持身份和身体比例，只有服装本身是
  商品参考或用户要求保留时才锁定现有服装，其它场景可按模板受控调整造型、姿态、视线和
  表情。Campaign Style Lock 不得承载具体主体事实。
  最终生图 TOML 是薄执行器：Rust 按当前 `templateId` 从 catalog 读取场景专业身份，
  然后只把该身份、完整 Prompt、参考图和尺寸交给 Provider，不出现流程阶段说明，也不追加
  Style Lock、模板执行规则、标题、用途或独立负向约束。single 不生成 Style Lock，
  多图的 Style Lock 已原样包含在每条完整 Prompt 中。
  routing v3 为每个固定 code/purpose 冻结一个 `templateId`，planning v10 不得改选路由模板，
  并只在该模板内选择唯一 variant override；没有适用 override 时使用统一 `base` 语义。single 的
  conversion driver 由 runtime 固定为 visual。H/D 的推荐模板只是排序提示，不是 allowlist；
  routing Prompt 要求 25 个 catalog 模板在主体匹配且满足证据门槛时均可到达；该语义可达性
  和证据判断不由 Rust 重复实现，真实参考图效果仍待人工验收。full-pack 允许相同模板承担不同
  业务目的或构图角色，不为机械去重牺牲用户意图、主体匹配或证据安全。商品摄影模板按
  原 Skill 形成多角度与景别节奏；人物、空间、界面和创意模板仍服从自身语言，不机械凑齐
  商品镜头。棚拍、海报和信息图可在 Style Lock 的 HEX 背景内轮换，自然环境类模板锁定
  环境材质、地点族、主色倾向和光线连续性。主体占比和详情文字密度只应用于匹配图型。
  短文案可基于参考图或用户输入中的证据生成；品牌、功能、参数、效果、促销和认证仍不得
  猜测。路由结果只存在于 executor 内存，不写入
  `generation_tasks`、SQLite、task events、诊断文件或前端 DTO；持久层只保存通过冻结路由
  一致性校验后的最终规划结果。模板 executor、variant、文字和证据政策以及原生视觉语言
  优先于跨图视觉方向；视觉方向只提供色板、光线和版式基线。D1-D9 的信息职责必须通过
  当前模板自身的构图语言表达，不强制套用统一信息图骨架；镜头、背景、服装保真和字体策略
  按商品、人物、空间、界面或混合主体条件化应用。两次调用复用既有 `scene-prompt-planning` capability、
  GenerationPort 和 Provider 并发限制，不新增 port、capability、数据库 schema 或 migration。
  routing v3 先识别交付物形式、再识别画面语言和投放渠道；渠道词不能覆盖更明确的信息图、
  详情屏或结构标注形式。planning v10 为 infographic 恢复结构化布局、HEX 色板、移动端字号、
  4-6 个证据型 callout、主体占比、留白和文化器物事实边界。single 仍不生成 Style Lock，但
  单项完整 Prompt 不得省略当前模板所需的视觉系统。
  planning v10 精简 system rules：只保留事实与证据、模板优先、Style Lock 核心、variant/base、
  自包含 Prompt、摘要边界和注入安全；确定性结构由 output format 与 Rust 校验。第二次调用
  只发送 code/purpose 与冻结模板，不发送 routing 的 `recommendedTemplateIds`。

确认规则：

- `draft` plan 可以编辑和删除 item。
- `confirmed` plan 不提供原地回退到 `draft` 的 MVP 路径。
- 用户确认后又要调整方案时，必须创建新的 draft plan；已被任务引用的 plan 不能原地修改影响历史。

本地实现：

- Rust 使用内置 Prompt 模板和本地规则生成。
- 后续可在 Rust 内部通过 `ModelGatewayPort` 接文本模型优化。

远端实现：

- SaaS 后端统一维护 Prompt 模板并生成 Prompt plan。
- 客户端不接收、不缓存、不展示系统 Prompt 或 raw prompt。

### 5.11 AiAssistPort

```ts
export interface AiAssistPort {
  generateListingCopy(input: ListingCopyAssistInput): Promise<AiAssistResult>;
  analyzeViralStyle(input: ViralStyleAnalysisInput): Promise<AiAssistResult>;
  recognizeImageText(input: RecognizeImageTextInput): Promise<ImageTextRecognitionResult>;
}
```

职责：

- 承接不产生图片资产的轻量文本和图片理解辅助能力；文字识别只接收 workspace `assetId`，不接收前端图片数据。
- 不暴露模型参数和 raw prompt。

说明：

- 商品图、场景图、服饰试穿、图生图、重绘等会产生资产的能力不走 `AiAssistPort`，必须走 `GenerationPort`。
- `AiAssistPort` 内部可以调用 runtime 内部的 `ModelGatewayPort`。

### 5.12 Internal ModelGatewayPort

```ts
export interface ModelGatewayPort {
  invoke(input: ModelInvocationInput): Promise<ModelInvocation>;
  getInvocation(invocationId: string): Promise<ModelInvocation>;
  cancelInvocation(invocationId: string): Promise<ModelInvocation>;
}
```

职责：

- 统一发起文生文、图生文、文生图、图生图调用。
- 屏蔽 OpenAI 官方接口和第三方 OpenAI-compatible 网关差异。
- 屏蔽同步、流式、异步任务三类出参差异。
- 返回内部统一的 `ModelInvocation`。
- 作为 runtime 内部端口，不直接暴露给 React feature。

本地实现：

- Rust 从 SQLite 本地密钥表读取密钥。
- Rust 按本地内部模型配置选择具体 `ModelGatewayAdapter`。
- Rust 使用内置 Prompt 模板渲染最终请求。
- Rust 处理 Provider 请求、轮询、下载和错误归一化。
- Rust 将调用摘要和脱敏错误写入本地数据库。

远端实现：

- SaaS 后端统一执行模型调用。
- SaaS 后端维护模型配置和 Prompt 模板。
- 前端只查询 invocation 状态，不直接接触 Provider。
- 前端不感知模型参数和系统 Prompt。

业务层调用规则：

- 文案生成、AI 帮写、爆款风格分析等轻量文本能力由 `AiAssistPort` 对前端暴露。
- 图片生成、图片编辑、图生图、服饰试穿必须由 `GenerationPort` 对前端暴露。
- `GenerationService` 内部调用 `ModelGatewayPort`。
- `ModelGatewayPort` 输入只包含 `capability` 和结构化 `intent`，不传模型参数和 raw prompt。

## 6. 核心数据模型

### 6.1 AppSettings

```ts
export type AppSettings = {
  workspaceDirectory: string;
  exportDirectory?: string;
  autoCreateDateFolders: boolean;
  restoreWorkspaceOnLaunch: boolean;
  retainGenerationHistory: boolean;
};

export type DesktopShellSettings = {
  launchAtStartup: boolean;
  minimizeToTrayOnClose: boolean;
  showTaskDoneNotifications: boolean;
  showFailureNotifications: boolean;
  proxy?: ProxySettings;
};

export type RuntimeFeatureFlags = {
  mode: "local" | "remote";
  supportsLocalFileReveal: boolean;
  supportsDirectoryPicker: boolean;
  supportsSystemNotification: boolean;
  supportsLocalModelConfig: boolean;
  supportsSecretManagement: boolean;
  supportsWorkspaceSwitch: boolean;
};

export type RuntimeInfo = {
  mode: "local" | "remote";
  version: string;
  features: RuntimeFeatureFlags;
};
```

### 6.2 ModelCapability

```ts
export type ModelCapability = {
  id:
    | "listing-copy"
    | "prompt-plan"
    | "product-selling-points"
    | "image-text-recognition"
    | "scene-prompt-planning"
    | "viral-style-analysis"
    | "scene-image-generation"
    | "product-detail-generation"
    | "clothing-base-model-generation"
    | "clothing-scene-planning"
    | "clothing-tryon-generation"
    | "image-edit";
  category: "text-to-text" | "text-to-image" | "image-to-image" | "image-to-text";
  available: boolean;
  unavailableReason?: string;
  displayName?: string;
  maxInputAssets?: number;
  supportedAspectRatios?: Array<"1:1" | "2:3" | "3:4" | "9:16" | "16:9">;
  maxImageCount?: number;
  estimatedCreditCost?: number;
};
```

`ModelCapability` 是客户端可见的模型能力抽象。客户端只知道“能不能做某类任务”，不知道背后使用哪个 provider、model、baseUrl 或 Prompt 模板。

local mode 下限制来自本地 ProviderProfile；remote mode 下限制来自 SaaS 后端。UI 不要硬编码图片数量、比例和输入数量限制。

`image-edit`、`image-text-recognition`、`clothing-scene-planning`、`clothing-base-model-generation`、
`clothing-tryon-generation`、`scene-prompt-planning` 和
`scene-image-generation` 是 real-provider-only 能力：`mock-local` 默认配置只用于
模型配置和自动化测试，不得让 `CapabilityPort.available` 返回 `true`。场景规划和
场景生图都最多接收 3 张参考图，并声明当前 UI 支持的 `3:4`、`1:1`、`9:16`
比例；前者类别为 `image-to-text`，后者为 `image-to-image`。基准模特能力固定
`maxInputAssets = 0`、`supportedAspectRatios = ["2:3"]`、`maxImageCount = 1`；
服饰规划和试穿最多接收 5 张服装图加 1 张模特图。
图片文字识别固定 `maxInputAssets = 1`，category 为 `image-to-text`；前端只传 active generated
`assetId`，Rust 读取资产后在内存构造 Provider 图片输入。

`PromptPlanPort` 是面向业务流程的生成方案端口，不等同于模型路由能力；当前 local runtime 同时公开 `prompt-plan` 作为 `ModelCapability`，用于模型配置、可用性计算和内部模型调用。页面仍只通过 `PromptPlanPort` 创建、编辑和确认方案，不直接读取 provider、model、baseUrl 或 Prompt 模板。

### 6.3 LocalModelConfigView

```ts
export type LocalModelConfigView = {
  id: string;
  capabilityId: ModelCapability["id"];
  displayName: string;
  providerLabel: string;
  protocol: "openai" | "openai-compatible";
  executionMode: "sync" | "stream" | "async-task" | "auto";
  model: string;
  baseUrl?: string;
  endpointPath?: string;
  secretStatus: SecretStatus;
  enabled: boolean;
  isDefault: boolean;
};
```

说明：

- `LocalModelConfigView` 是单机模式下给模型配置页展示和编辑的脱敏视图，不作为 SaaS 客户端 DTO。
- `capabilityId` 表示该配置服务于哪类业务能力。
- `protocol` 表示入参协议。第三方网关第一版只要求支持 OpenAI-compatible。
- `executionMode` 表示出参模式。`auto` 由 adapter 根据响应自动识别。
- `endpointPath` 用于兼容网关把 chat、image、task 查询拆成不同路径的情况。
- `baseUrl` 是单机模式下内置 provider profile 的可持久化配置；Mock Local 固定为 `mock://local`，其他 provider 的 React 页面允许编辑，但 Rust runtime 只接受无凭据、无查询参数的 HTTPS 地址。保存后用于连接探测和真实调用，且 Base URL 变化必须使连接状态回到 `untested`。
- OpenAI 当前暴露已实现的文生文、图生文、纯文生图和图生图能力；
  `scene-prompt-planning` 走 Responses 并按 `input_image` + `input_text` 发送参考图，
  `scene-image-generation`、`clothing-tryon-generation` 与 `image-edit` 统一使用
  `/v1/images/edits` 的 `multipart/form-data`。图片编辑仅接受 PNG、JPEG、WebP，
  按 1:1、横向、竖向映射目标尺寸，不裁剪或转码输入图。保存配置、Provider
  连接探测和历史配置执行都强制解析对应 endpoint。上述行为只在本地 HTTP/单元测试中
  验证，尚未验证真实 OpenAI 外网调用。
- `ModelConfigPort.listImageSizeOptions("image-edit")` 根据当前默认配置的 provider + model 返回受支持尺寸。OpenAI `gpt-image-2`、`gpt-image-1.5`、`gpt-image-1`、`gpt-image-1-mini` 返回方形、竖向、横向三组精确像素值；`doubao-seedream-5-0-pro-260628` 返回官方 1K/2K 八种宽高比（包含 21:9）的精确像素值；Seedream 5.0 / 5.0 Lite 的 2K `3:4`、`9:16`、`16:9` 分别映射为 `1728x2304`、`1440x2560`、`2560x1440`，4.5 / 4.0 保留各自登记的旧 2K/4K 表。未知模型返回空列表，不在前端猜测。
- 单机版 UI 可以展示和编辑本地模型配置；远端 SaaS 模式下 UI 不展示这些字段。
- 业务 UI 不应根据 `provider` 写分支逻辑。
- API Key 永远不进入 `LocalModelConfigView`，只允许通过 `SecretPort` 写入或删除。

Rust runtime 内部解析后使用 `ResolvedModelConfig`：

```rust
struct ResolvedModelConfig {
    id: String,
    capability_id: String,
    provider: ProviderKind,
    protocol: ProtocolKind,
    execution_mode: ExecutionMode,
    model: String,
    base_url: Url,
    endpoint_path: Option<String>,
    secret_value: SecretString,
    timeout: Duration,
}
```

`ResolvedModelConfig` 只能存在于 Rust runtime 内存中，不能序列化给前端。

当前 timeout 策略为：火山引擎的 `clothing-base-model-generation`、`scene-image-generation`、`product-detail-generation`、`clothing-tryon-generation`、`image-edit` 图片调用使用 300 秒；`prompt-plan` 使用 300 秒；OpenAI 的 `clothing-tryon-generation` / `image-edit` 保持 60 秒；`clothing-scene-planning` 使用 90 秒，其余同步能力使用 90 秒。火山图片连接探测同样使用 300 秒，图生文探测保持 60 秒；Seedream 5.0 Pro 探测使用 `1K`，真实场景任务未显式指定尺寸时按冻结比例选择 `2K` 档。前端任务无进展窗口使用 360 秒，长于最长 Provider timeout 并预留结果持久化时间；queued 未启动窗口不变。

### 6.4 ProviderProfileView

```ts
export type ProviderProfileView = {
  id: string;
  displayName: string;
  providerLabel: string;
  protocol: "openai" | "openai-compatible";
  supportedCategories: ModelCapability["category"][];
  supportedCapabilities: ModelCapability["id"][];
  customEnabled: boolean;
};

export type SaveLocalModelConfigInput = {
  id?: string;
  capabilityId: ModelCapability["id"];
  providerProfileId: string;
  displayName: string;
  executionMode: "sync" | "stream" | "async-task" | "auto";
  model: string;
  baseUrl?: string;
  endpointPath?: string;
  enabled: boolean;
};

export type SetDefaultModelConfigInput = {
  capabilityId: ModelCapability["id"];
  configId: string;
};

export type SecretScope = {
  providerProfileId: string;
  capabilityId?: ModelCapability["id"];
};

export type ResolvedSecretScope = SecretScope & {
  workspaceId: string;
};
```

`SecretScope` 是前端可传入范围，不包含 `workspaceId`。runtime 必须使用当前 active workspace 注入 `ResolvedSecretScope.workspaceId`，再读写 SQLite 本地密钥表。API Key 可以在 SQLite 专用表中明文落盘，这是 MVP 明确接受的本地风险；但不能进入日志、task events、settings、asset、导出默认包或前端 DTO。

模型配置页切换 Provider 时必须按新 Provider 与当前模型类别的 capability 调用 `SecretPort.getSecretStatus`，恢复该 Provider 已持久化的脱敏配置状态。切换本身不得调用 `revealSecret` 或把明文缓存到普通配置 DTO；只有用户主动点击眼睛按钮后才允许按当前 scope 读取明文。Provider 快速切换和 reveal 请求必须丢弃过期响应，避免旧 Provider 的状态或明文覆盖当前卡片。

### 6.5 Asset

```ts
export type Asset = {
  id: string;
  kind: "source" | "reference" | "model" | "generated" | "thumbnail";
  name: string;
  originalName: string;
  mimeType: string;
  relativePath: string;
  sha256: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  lifecycle: "staged" | "active" | "deleted";
  url?: string;
  localPath?: string;
  thumbnailPath?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type BuiltinModelAsset = {
  id: string;
  label: string;
  fileName: string;
  path: string;
  thumbnailPath?: string;
};
```

`localPath` 只允许在本地 adapter 返回；SaaS adapter 不保证存在。`BuiltinModelAsset.path` 和 `BuiltinModelAsset.thumbnailPath` 当前都是 local bundled resource 的绝对路径，仅供 Tauri asset protocol 转换，不能持久化到 SQLite、任务或导出元数据；当前 remote adapter 返回空的内置模特列表。

### 6.6 GenerationTask

```ts
export type GenerationTask = {
  id: string;
  workspace: "product" | "clothing" | "scene";
  kind: "image-generation" | "image-edit";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage?:
    | "validating"
    | "preparing"
    | "resolving_prompt"
    | "uploading_assets"
    | "calling_model"
    | "polling_provider"
    | "downloading_result"
    | "saving_result"
    | "finalizing";
  title: string;
  inputSummary: string;
  promptPlanId?: string;
  retryOfTaskId?: string;
  attemptNo: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deletedAt?: string;
  error?: NormalizedTaskError;
};
```

`GenerationTask` 只负责会产生资产的任务。文案生成、爆款风格分析、图片理解摘要走 `AiAssistPort`；如果需要历史记录，写入 `ai_assist_invocations`，不要混进 `generation_tasks`。

### 6.7 NormalizedTaskError

```ts
export type NormalizedTaskError = {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  stage?: GenerationTask["stage"];
  providerStatusCode?: number;
  providerErrorCode?: string;
};

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "WORKSPACE_NOT_INITIALIZED"
  | "WORKSPACE_UNAVAILABLE"
  | "SQLITE_MIGRATION_FAILED"
  | "ASSET_NOT_FOUND"
  | "ASSET_FILE_MISSING"
  | "ASSET_REFERENCED_BY_HISTORY"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "IMAGE_TOO_LARGE"
  | "PROMPT_PLAN_NOT_CONFIRMED"
  | "PROMPT_TEMPLATE_INVALID"
  | "PROMPT_TOO_LONG"
  | "MODEL_CAPABILITY_UNAVAILABLE"
  | "MODEL_CONFIG_UNAVAILABLE"
  | "MODEL_NOT_CONFIGURED"
  | "API_KEY_NOT_CONFIGURED"
  | "API_KEY_INVALID"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_CONTENT_REJECTED"
  | "PROVIDER_UNKNOWN_ERROR"
  | "NETWORK_ERROR"
  | "DOWNLOAD_RESULT_FAILED"
  | "SAVE_RESULT_FAILED"
  | "TASK_RETRY_REQUIRED"
  | "TASK_CANCELLED"
  | "TASK_INTERRUPTED"
  | "UNKNOWN_ERROR";
```

规则：

- UI 展示 `message`。
- 日志和诊断使用 `code`。
- 重试按钮根据 `retryable` 判断是否展示。
- `providerErrorCode` 必须脱敏。
- 不允许把 Provider raw error 直接作为 `message` 返回。

### 6.8 GenerationAsset

```ts
export type GenerationAsset = {
  id: string;
  taskId: string;
  title: string;
  promptSummary?: string;
  promptTemplateVersion?: string;
  ratio: string;
  status: "queued" | "running" | "succeeded" | "failed";
  assetId?: string;
  error?: NormalizedTaskError;
};
```

`promptSummary` 只能保存给用户看的摘要或图片说明，不能保存系统 Prompt 或最终 raw prompt。

### 6.9 PromptPlan

```ts
export type PromptPlan = {
  id: string;
  workspace: "product" | "clothing" | "scene";
  status: "draft" | "confirmed";
  items: PromptPlanItem[];
  userEditableSummary: string;
  resolverVersion: string;
  templateVersion: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
};

export type PromptPlanItem = {
  id: string;
  type:
    | "scene"
    | "composition"
    | "lighting"
    | "product_feature"
    | "model_pose"
    | "background"
    | "negative_constraint";
  title: string;
  displaySummary: string;
  intent: PromptPlanItemIntent;
  editable: boolean;
  required: boolean;
  sortOrder: number;
};

export type PromptPlanSnapshot = {
  planId: string;
  workspace: PromptPlan["workspace"];
  userEditableSummary: string;
  resolverVersion: string;
  templateVersion: string;
  items: PromptPlanItem[];
  confirmedAt: string;
  snapshotAt: string;
};
```

`PromptPlan` 是可执行结构，不是单纯展示摘要。用户确认后，任务保存：

- `promptPlanId`
- `promptPlanSnapshotJson`
- `promptTemplateVersion`
- `promptResolverVersion`
- `resolvedPromptHash`

`PromptPlanSnapshot` 表示任务创建时冻结的执行快照，不等同于当前 `prompt_plans` 表中的可编辑状态。任务详情必须读取 `generation_tasks.prompt_plan_snapshot_json`，不能重新读取当前 plan 后拼装历史。

最终 raw prompt 只在 Rust runtime 或 SaaS 服务端内部渲染，不返回 UI，不入库。

### 6.10 ModelInvocation

```ts
export type ModelInvocationInput =
  | SceneImageGenerationInput
  | ProductDetailGenerationInput
  | ClothingBaseModelGenerationInput
  | ClothingScenePlanningInput
  | ClothingTryOnGenerationInput
  | ListingCopyInput
  | ImageUnderstandingInput;

export type SceneImageGenerationInput = {
  idempotencyKey?: string;
  capability: "scene-image-generation";
  category: "image-to-image";
  inputAssetIds: string[];
  promptPlanId: string;
  planningPromptVersion: "v10";
  generationPromptVersion: "v7";
  templateCatalogVersion: "v5";
  campaignStyleLock: string;
  ratio: "1:1" | "3:4" | "9:16";
  items: Array<{
    imageId: string;
    imageNo: number;
    sortOrder: number;
    code: string;
    title: string;
    purpose: string;
    templateId: string;
    variantId: string;
    ratio: "1:1" | "3:4" | "9:16";
    promptSummary: string;
    prompt: string;
    negativeConstraints: string;
  }>;
};

场景图要求先完成 `scene-prompt-planning` 并由用户审核场景摘要，再创建
`SceneImageGenerationInput`。参考图只通过任务 `inputAssets(role=reference)` 关联；
渲染后的 system/user/roleless Prompt 仅存在于调用内存和显式 debug 输出中，
不写任务、SQLite、事件或诊断文件。版本不匹配的旧任务仍可查看已有结果，
但单图重试必须重新规划。

export type ProductDetailGenerationInput = {
  idempotencyKey?: string;
  capability: "product-detail-generation";
  category: "text-to-image" | "image-to-image";
  inputAssetIds: string[];
  promptPlanId: string;
  intent: {
    workspace: "product";
    platform: string;
    market: string;
    language: string;
    moduleIds: string[];
  };
};

export type ClothingBaseModelGenerationInput = {
  idempotencyKey?: string;
  capability: "clothing-base-model-generation";
  category: "text-to-image";
  inputAssetIds?: string[];
  intent: {
    workspace: "clothing";
    gender: string;
    age: "婴儿" | "儿童" | "青少年" | "青年" | "中年" | "老年";
    ethnicity: string;
    body: string;
    appearance?: string;
  };
};

export type ClothingTryOnGenerationInput = {
  idempotencyKey?: string;
  capability: "clothing-tryon-generation";
  category: "image-to-image";
  inputAssetIds: string[];
  promptPlanId?: string;
  intent: {
    workspace: "clothing";
    modelAssetId?: string;
    clothingAssetIds: string[];
    sceneIds: string[];
    aspectRatio: "1:1" | "3:4" | "9:16";
  };
};

export type ClothingScenePlanningInput = {
  idempotencyKey?: string;
  capability: "clothing-scene-planning";
  category: "image-to-text";
  inputAssetIds: string[];
  intent: {
    workspace: "clothing";
    modelAssetId?: string;
    clothingAssetIds: string[];
    selectedScenes: string[];
    customScene?: string;
    aiRecommended: boolean;
    aspectRatio: "1:1" | "3:4" | "9:16";
  };
};

export type ListingCopyInput = {
  idempotencyKey?: string;
  capability: "listing-copy";
  category: "text-to-text";
  intent: {
    workspace: "product";
    productSummary: string;
    platform: string;
    market: string;
    language: string;
    sellingPoints?: string[];
  };
};

export type ImageUnderstandingInput = {
  idempotencyKey?: string;
  capability: "viral-style-analysis";
  category: "image-to-text";
  inputAssetIds: string[];
  intent: {
    workspace: "product" | "scene" | "clothing";
    analysisGoal: "selling-points" | "style" | "quality-check";
  };
};

export type ModelInvocation = {
  id: string;
  capability: ModelInvocationInput["capability"];
  category: ModelInvocationInput["category"];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  providerTaskId?: string;
  outputText?: string;
  outputJson?: unknown;
  outputAssetIds?: string[];
  usage?: ModelUsage;
  error?: NormalizedTaskError;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
```

`ModelInvocation` 是模型调用层的统一出参。无论第三方网关原始返回是 OpenAI 同步 response、SSE chunk、还是 `task_id + poll_url`，业务层都只消费这个结构。

`ModelInvocationInput` 禁止包含 provider、model、baseUrl、endpointPath、messages、system prompt 或 raw prompt。单机版由 Rust 根据 `capability` 解析本地模型配置和内置 Prompt；SaaS 版由服务端根据 `capability` 解析远端模型配置和服务端 Prompt。

### 6.11 Public Port DTO

```ts
export type AssetQuery = {
  kind?: Asset["kind"];
  includeDeleted?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type AssetPage = {
  items: Asset[];
  total: number;
  page: number;
  pageSize: number;
};

export type CreateGenerationTaskInput = {
  idempotencyKey?: string;
  workspace: GenerationTask["workspace"];
  kind: GenerationTask["kind"];
  title?: string;
  input:
    | SceneImageGenerationInput
    | ProductDetailGenerationInput
    | ClothingTryOnGenerationInput;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  level: "info" | "warn" | "error";
  stage?: GenerationTask["stage"];
  code?: AppErrorCode;
  message: string;
  detailJson?: unknown;
  createdAt: string;
};

export type GenerationTaskDetail = {
  task: GenerationTask;
  inputAssets: Asset[];
  outputs: GenerationAsset[];
  events: TaskEvent[];
  promptPlanSnapshot?: PromptPlanSnapshot;
};

export type GenerationTaskQuery = {
  workspace?: GenerationTask["workspace"];
  status?: GenerationTask["status"][];
  kind?: GenerationTask["kind"][];
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
};

export type GenerationTaskPage = {
  items: GenerationTask[];
  total: number;
  page: number;
  pageSize: number;
};

export type WorkspaceStatus = {
  initialized: boolean;
  workspaceId?: string;
  workspaceDirectory?: string;
  dbReady: boolean;
  migrationVersion?: string;
  error?: NormalizedTaskError;
};

export type InitializeWorkspaceInput = {
  workspaceDirectory: string;
  createIfMissing: boolean;
};

export type SwitchWorkspaceInput = {
  workspaceDirectory: string;
};

export type WorkspaceRepairResult = {
  repaired: boolean;
  actions: string[];
  error?: NormalizedTaskError;
};

export type WorkspaceStorageUsage = {
  assetBytes: number;
  cacheBytes: number;
  exportBytes: number;
  logBytes: number;
  totalBytes: number;
};

export type GarbageCollectionResult = {
  deletedFiles: number;
  reclaimedBytes: number;
  errors: NormalizedTaskError[];
};

export type ChooseDirectoryInput = {
  title?: string;
  defaultPath?: string;
  canCreateDirectories?: boolean;
};

export type NotificationInput = {
  title: string;
  body: string;
};

export type ImportImagesInput = {
  files: string[];
  kind: Exclude<Asset["kind"], "generated" | "thumbnail">;
};

export type CreatePromptPlanInput = {
  workspace: PromptPlan["workspace"];
  inputSummary: string;
  inputAssetIds?: string[];
};

export type PromptPlanPatch = {
  userEditableSummary?: string;
  items?: PromptPlanItem[];
};

export type ListingCopyAssistInput = {
  capability: "listing-copy";
  intent: ListingCopyInput["intent"];
};

export type ViralStyleAnalysisInput = {
  capability: "viral-style-analysis";
  inputAssetIds: string[];
  intent: ImageUnderstandingInput["intent"];
};

export type AiAssistResult = {
  id: string;
  capability: "listing-copy" | "viral-style-analysis";
  status: "succeeded" | "failed";
  outputText?: string;
  outputJson?: unknown;
  usage?: ModelUsage;
  error?: NormalizedTaskError;
};

export type SecretStatus = {
  configured: boolean;
  lastVerifiedAt?: string;
  error?: NormalizedTaskError;
};

export type ProviderTestResult = {
  ok: boolean;
  latencyMs?: number;
  error?: NormalizedTaskError;
};

export type ProxySettings = {
  enabled: boolean;
  url?: string;
};

export type PromptPlanItemIntent = Record<string, unknown>;

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  estimatedCost?: number;
};
```

规则：

- `CreateGenerationTaskInput.input` 只允许资产型生成输入，不允许 `ListingCopyInput` 或其他文本辅助输入。
- `GenerationTaskDetail` 是任务详情页唯一 DTO，必须聚合输入资产、生成结果和事件明细。
- `TaskEvent.detailJson` 必须遵守 `task_events.detail_json` 脱敏规则。

## 7. 本地数据库建议

第一版建议使用 SQLite。

```text
settings
├── key
├── value_json
└── updated_at

model_configs
├── id
├── capability_id
├── provider_profile_id
├── display_name
├── protocol
├── execution_mode
├── model
├── base_url
├── endpoint_path
├── secret_ref
├── enabled
├── is_default
├── created_at
└── updated_at

model_secrets
├── id
├── workspace_id
├── provider_profile_id
├── capability_id
├── secret_kind
├── secret_value
├── created_at
├── updated_at
└── last_used_at

model_invocations
├── id
├── capability_id
├── category
├── status
├── provider_task_id
├── request_summary_json
├── output_text
├── output_json
├── usage_json
├── error_json
├── created_at
├── updated_at
├── completed_at
└── deleted_at

assets
├── id
├── kind
├── name
├── original_name
├── mime_type
├── relative_path
├── sha256
├── width
├── height
├── size_bytes
├── deleted_at
├── created_at
└── updated_at

prompt_plans
├── id
├── workspace
├── status
├── user_editable_summary
├── resolver_version
├── template_version
├── created_at
├── updated_at
└── confirmed_at

prompt_plan_items
├── id
├── plan_id
├── type
├── title
├── display_summary
├── intent_json
├── editable
├── required
├── sort_order
├── created_at
└── updated_at

generation_tasks
├── id
├── retry_of_task_id
├── attempt_no
├── idempotency_key
├── workspace
├── kind
├── status
├── stage
├── title
├── input_json
├── input_summary
├── prompt_plan_id
├── prompt_plan_snapshot_json
├── prompt_template_version
├── prompt_resolver_version
├── resolved_prompt_hash
├── error_json
├── created_at
├── updated_at
└── completed_at

generation_task_input_assets
├── task_id
├── asset_id
├── role
├── view_type
├── sort_order
├── is_primary
└── created_at

task_events
├── id
├── task_id
├── level
├── stage
├── code
├── message
├── detail_json
└── created_at

generation_assets
├── id
├── task_id
├── title
├── prompt_summary
├── prompt_template_version
├── ratio
├── status
├── asset_id
├── error_json
└── created_at

ai_assist_invocations
├── id
├── capability_id
├── status
├── input_summary
├── output_text
├── output_json
├── usage_json
├── error_json
├── created_at
├── updated_at
└── completed_at
```

原则：

- 数据库存相对路径，不存用户原始绝对路径。
- 不存 Provider raw response。
- API Key 只允许保存在 `model_secrets.secret_value`，不得复制到其他表。
- `model_secrets.secret_value` MVP 按本地明文密钥处理，依赖 workspace 文件权限和用户设备安全；后续可以在不改变 Public Port 的前提下升级为加密存储或系统凭据库。
- 不存系统 Prompt 或最终 raw prompt。
- `model_configs` 只服务本地单机 runtime，SaaS 模式不下发到客户端。
- `model_configs.provider_profile_id` 只能引用 Rust runtime 内置 profile；除 Mock Local 固定使用 `mock://local` 外，持久化 `base_url` 必须是无凭据、无查询参数的 HTTPS 地址，且不能改变协议或 capability 映射。React 页面不开放 `endpoint_path` 编辑；OpenAI / 火山引擎的特殊图像 endpoint 由 Rust 强制映射，其他类别使用已保存的 `endpoint_path` 或 profile 默认值。
- `model_configs.secret_ref` 只能引用同 workspace、同 provider profile 的 `model_secrets` 记录。
- `prompt_plans` / `prompt_plan_items` 保存当前可编辑方案。
- `generation_tasks.prompt_plan_snapshot_json` 保存任务执行时的冻结快照。
- 任务创建后，即使原 PromptPlan 被用户继续编辑，历史任务也必须保持可追溯。
- 错误信息必须脱敏。
- `input_json` 只能作为输入快照，不能作为资产引用、删除保护和历史查询的结构化事实来源。
- 输入资产关系必须写入 `generation_task_input_assets`。
- 任务诊断、阶段流转和失败原因必须写入 `task_events`。
- 普通任务重试采用“创建新 task，并用 `retry_of_task_id` / `attempt_no` 关联原任务”的策略。商品与服饰单图重试为保留仅含目标项的 `items` 输入，使用 `createTask` 创建子任务，并在冻结输入中持久化 `parentTaskId`、目标 `imageId` 和 `imageNo`；该例外不写 `retry_of_task_id` / `attempt_no`。子任务成功且仅有一个 active generated output 时，runtime 在同一事务内更新或补齐父任务稳定槽位、移除子任务输出关系并隐藏子任务。
- `generation_tasks.deleted_at` 用于隐藏历史任务，不触发资产物理删除。

SQLite 运行约束：

- 启动时执行 `PRAGMA foreign_keys = ON`。
- 启动时执行 `PRAGMA journal_mode = WAL`。
- 启动时执行 `PRAGMA busy_timeout = 5000`。
- 写操作走单 writer 连接。
- migrations 必须先于业务读写执行。
- migration 失败时禁止进入工作区。
- 所有 `status` / `kind` / `stage` / `role` 使用 `CHECK` 约束。
- 所有外键明确 `ON DELETE` 策略。

推荐外键策略：

```text
generation_task_input_assets.task_id -> generation_tasks.id ON DELETE CASCADE
generation_task_input_assets.asset_id -> assets.id ON DELETE RESTRICT
generation_assets.task_id -> generation_tasks.id ON DELETE CASCADE
generation_assets.asset_id -> assets.id ON DELETE SET NULL 或 RESTRICT
task_events.task_id -> generation_tasks.id ON DELETE CASCADE
prompt_plan_items.plan_id -> prompt_plans.id ON DELETE CASCADE
```

推荐索引：

```sql
CREATE UNIQUE INDEX idx_generation_tasks_idempotency_key
ON generation_tasks(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_assets_relative_path ON assets(relative_path);
CREATE INDEX idx_assets_kind_created_at ON assets(kind, created_at);
CREATE INDEX idx_assets_sha256 ON assets(sha256);
CREATE INDEX idx_assets_deleted_at ON assets(deleted_at);
CREATE INDEX idx_task_input_assets_task_id ON generation_task_input_assets(task_id);
CREATE INDEX idx_task_input_assets_asset_id ON generation_task_input_assets(asset_id);
CREATE INDEX idx_task_events_task_created_at ON task_events(task_id, created_at);
```

资产删除和 GC 规则：

- `deleteAsset` 默认做软删除，写入 `deleted_at`。
- 被历史任务引用的 asset 只能标记 `deleted_at`，不能直接物理删除。
- 无引用且已标记删除的 asset 可以进入 GC 清理。
- 资产列表默认过滤 `deleted_at IS NULL`。
- 历史任务详情可以继续显示已删除 asset 的摘要信息。
- GC 只清理不被任务引用且已标记删除的物理文件。

`idempotency_key` 语义：

- `idempotency_key` 只用于防止重复创建任务，不用于任务重试。
- 如果前端未传 `idempotencyKey`，由 runtime 生成。
- 如果 `idempotencyKey` 已存在且任务未 failed，直接返回已有 task。
- 如果 `idempotencyKey` 已存在且任务为 failed，`createTask` 返回 `TASK_RETRY_REQUIRED`，不插入新行，不复用旧任务。
- 普通任务的用户重试必须调用 `retryTask`。
- `retryTask` 创建新 task，并写入 `retry_of_task_id` 和 `attempt_no`。
- 商品与服饰单图重试为保留仅含目标项的 `items` 输入，使用 `createTask` 创建子任务；冻结输入必须包含 `parentTaskId`、目标 `imageId` 和 `imageNo`，且不写 `retry_of_task_id` / `attempt_no`；成功后唯一 active output 原子归并父任务稳定槽位并隐藏子任务。

`task_events.detail_json` 只允许保存脱敏后的结构化摘要：

- `provider_status_code`
- `normalized_error_code`
- `retryable`
- `elapsed_ms`
- `asset_count`
- `output_count`
- `file_size`
- `stage_context`
- `provider_profile_id`
- `invocation_id`

禁止保存：

- Authorization
- Cookie
- API Key
- raw request body
- raw response body
- raw headers
- provider image URL 中的签名参数
- 完整本地绝对路径
- 系统 Prompt
- 最终 raw prompt
- 用户上传图片的原始绝对路径

Provider 返回的图片 URL 入库前必须移除 `token`、`signature`、`expires`、`X-Amz-*`、`OSSAccessKeyId`、`security-token`、authorization query。如果无法确认 URL 已安全脱敏，则不入库，只保存 `source = provider_result_url_redacted`。

## 8. 任务状态机

所有生成任务统一走 `status + stage`。

`status` 是粗粒度生命周期：

```text
queued
  ↓
running
  ├── succeeded
  ├── failed
  └── cancelled
```

`stage` 是运行中阶段：

```text
validating
  ↓
preparing
  ↓
resolving_prompt
  ↓
uploading_assets
  ↓
calling_model
  ↓
polling_provider
  ↓
downloading_result
  ↓
saving_result
  ↓
finalizing
```

规则：

- UI 不能自行把任务改成成功。
- Provider 错误必须归一化后写入 `failed`。
- 普通任务用户重试时创建新 task，并用 `retry_of_task_id` / `attempt_no` 关联原任务；商品与服饰单图重试使用带 `parentTaskId`、目标 `imageId` 和 `imageNo` 的单项 `items` 输入创建子任务，不写 runtime 级 retry 关联，成功后把唯一 active output 原子归并父任务稳定槽位并隐藏子任务。
- 应用启动时，发现 `running` 但无执行上下文的任务，应恢复为 `failed`，错误为 `interrupted`。
- UI 可以展示阶段式进度，但不要展示假百分比。
- 每次 `stage` 变化、Provider 调用、轮询、下载、保存、失败都写入 `task_events`。

状态更新机制：

- `getTask` / `listTasks` 是恢复、刷新和远端兜底查询接口。
- local Tauri runtime 写入 `task_events` 后，应同步 emit `generation-task-updated` 或 `generation-task-event-created`。
- 前端 `useTask` 优先订阅 runtime 事件；事件不可用时再降级轮询。
- remote SaaS 模式可以映射为 SSE、WebSocket 或 polling，但页面组件不直接感知底层机制。
- MVP 不要求显示精确队列位置，但有 running task 时，新任务入口必须提示“已有任务处理中”或等价状态。

## 9. LocalTaskExecutor

`LocalTaskExecutor` 是单机 runtime 内部执行器，不暴露给 React UI。

职责：

- 从 `queued` 任务中取任务执行。
- 控制本地并发。
- 管理 `CancellationToken`。
- 更新 `status` 和 `stage`。
- 写入 `task_events`。
- 调用内部 `ModelGatewayPort`。
- 处理 Provider 同步、流式、异步轮询结果。
- 下载结果文件。
- 调用 Asset 服务保存生成结果。
- 处理失败、取消、超时。
- 应用关闭时尝试取消运行中任务。
- 应用启动时兜底恢复异常 `running` 任务。

MVP 并发策略：

```text
maxConcurrentTasks = 4（后台执行）
```

`maxConcurrentTasks` 只限制外层后台任务，单元测试和同步执行器仍使用 1。容量检查、queued task claim、running 状态和 started 事件在同一个 SQLite `BEGIN IMMEDIATE` 事务内完成，避免并发启动越过上限；async 执行由 supervisor 等待 JoinHandle，异常退出会安全回写 `LOCAL_TASK_EXECUTION_FAILED`，且不会覆盖 cancelled 终态。当前服饰试穿在单个 `clothing-tryon-generation` 任务内按最多 4 个动作一批并发调用，批次完成后再启动下一批。ModelGateway 的 async、stream 和 blocking 真实调用通过进程级 Provider 并发限流池统一约束：OpenAI / 火山引擎最多 3 路，DeepSeek 最多 4 路；localhost、IPv4/IPv6 loopback 按规范化 origin 共用 1 路，不同本地 origin 分池，因此多个外层任务不会将同一本地模型的请求并发相乘；Provider 连接测试不属于 ModelGateway 调用链。

服饰规划与试穿均使用 model-first 输入顺序：唯一模特图必须是第 1 张参考图，其后的 1–5 张为服装参考图。规划输出必须包含完整 `modelFeatures`（性别外观、年龄感、族裔外观、面部、体态、发型、肤色、整体气质和身份锚点）；runtime 在归一化和校验后写入 `output_json` 时只保留顶层 `modelFeatures` 与 `scenes`，不持久化 Provider 附带的分析或校验字段。前端将 `modelFeatures` 与已冻结的输入资产一起传给正式试穿任务，runtime 将其注入试穿 Prompt 以锁定同一模特身份。

真实试穿调用使用 Tokio + async reqwest + JoinSet；结果下载、暂存资产写入和文件落盘转交 blocking worker。每个单项持有的 Provider permit 从 HTTP 提交开始一直保留到对应结果下载、暂存资产记录和文件落盘完成，并在成功、失败、取消或异常退出时通过 RAII 释放，避免外层任务在结果仍写盘时继续穿透 Provider 与本地 IO 限流。单项结果先以 `staged` 资产落盘；同批 Provider 调用结束后，runtime 按 `item_index` 排序，在一个事务内为单项多图分配全局唯一、稳定递增的 `sort_order`，写入输出关系并把资产激活。任务已取消/隐藏或事务失败时，只清理无任何输入、输出引用的暂存资产。单项 Provider 调用、结果保存和失败会相互隔离：Provider 失败保留 typed `TaskModelInvocationError`，item 事件只记录脱敏 code、retryable、HTTP status 和 provider error code，不保存原始 message；取消会中止仍在 JoinSet 中的 Provider 子任务，已进入下载和落盘的结果完成后会在关联前再次校验任务状态。只要至少保存一张结果，父任务仍成功并在输出摘要记录 `failed_item_count`；全部单项均未保存时，父任务按最低 `item_index` 在 Provider 与持久化失败中确定代表错误，再规范化为安全任务错误，避免异步完成顺序改变历史分类。

MVP 不开放用户配置并发数。原因：

- SQLite 写入更简单。
- Provider 限流更容易处理。
- 避免多个大图下载同时写 workspace。
- UI 状态更稳定。
- 降低第一版任务恢复复杂度。

未来扩展：

```text
maxConcurrentTasks
queue priority
batch generation
pause / resume
task queue position
```

## 10. 大模型调用抽象

### 10.1 分层

大模型调用分三层：

```text
GenerationService / AiAssistService
  |
  v
ModelGatewayPort
  |
  v
ModelGatewayAdapter
  |
  +-- OpenAIAdapter
  +-- OpenAICompatibleGatewayAdapter
  +-- VolcengineAdapter
  +-- DeepSeekAdapter
```

说明：

- `GenerationPort` 和 `AiAssistPort` 是前端可见入口。
- `ModelGatewayPort` 是 runtime service 内部入口。
- `ModelGatewayAdapter` 处理协议和响应模式差异。
- 具体 adapter 只负责一个 Provider 或一类兼容网关。

### 10.2 支持的调用类型

第一版必须覆盖当前界面上的模型类别：

- `text-to-text`：AI 帮写、Prompt 优化、商品文案、场景方案。
- `image-to-text`：图片理解、卖点提取、风格分析、服饰场景动作规划。
- `text-to-image`：商品图、场景图、`clothing-base-model-generation` 基准模特生成。
- `image-to-image`：参考图生图、局部重绘、服饰试穿。

未来如果新增 embedding、视频或音频，不直接改业务 UI，而是扩展 `ModelInvocationInput.category` 和 adapter。

### 10.3 OpenAI-compatible 网关适配

第三方 API 网关通常入参兼容 OpenAI，但出参不完全一致。必须在 adapter 层屏蔽这些差异。

常见模式：

```text
模式 A：同步返回
request -> response with text/images

模式 B：流式返回
request -> SSE chunks -> final aggregated result

模式 C：异步任务返回
request -> task_id
task_id -> polling -> result url / result payload
```

内部统一规则：

- 同步返回直接归一化为 `ModelInvocation.status = "succeeded"`。
- 流式返回在 runtime 层聚合，完成后归一化为 `succeeded`。
- 异步任务返回先写入 `running`，保存 `providerTaskId`，由 adapter 轮询直到 `succeeded` 或 `failed`。
- Provider 返回的图片 URL 必须下载到本地 assets，再返回 `outputAssetIds`。
- Provider raw response 不暴露给 UI。

### 10.4 第三方网关安全边界

MVP 不开放任意 custom gateway。第一版只支持预设 profile：

```text
openai-official
volcengine-profile
apimart-openai-compatible-profile
custom-disabled
```

如果后续开放 custom gateway，高级模式必须满足：

- 默认只允许 `https://`。
- 禁止 `localhost`、`127.0.0.1`、`::1`。
- 禁止私有网段。
- 禁止 `file://`、`ftp://` 等协议。
- 禁止自动跟随跳转到私有地址。
- 限制响应体大小。
- 限制下载文件大小和 MIME。
- 所有 URL 入库前脱敏。
- 导入 workspace 中的 provider 配置必须二次确认。
- 本地调试诊断日志只记录 provider profile、脱敏后的 Base URL origin、请求/响应状态、机器可读的 `elapsedMs`、人类可读的 `elapsed` 总耗时、响应长度、脱敏后的响应结构摘要和经清理的 Provider error code；禁止保存或打印 Provider raw response body、Authorization、Cookie、raw header、API Key 或用户配置的 Base URL / endpoint 原始路径，raw response 也不得进入 SQLite、`task_events`、导出包或前端 DTO。
- 真实模型调用默认不打印 raw Prompt。`make dev` 会为 Debug 构建设置 `COMMERCE_SHOOT_STUDIO_DEBUG_PROMPTS=1`，将 system、user、roleless Prompt 和归一化模型结果摘要输出到终端 `stderr` 供本地调试；结果摘要必须剔除图片数据、URL、header、凭据和 secret。其它 Debug 启动方式需显式设置该变量。这些输出不写入 `model-gateway-diagnostics.jsonl`、SQLite、`task_events`、导出包或前端 DTO，且 Release 构建编译期禁用。
- 当前通用执行器分支（不含商品详情图逐项执行路径）在 HTTP 调用前遇到任务校验、资产读取或模型配置失败时，会在终端输出 `task_execution_error` 脱敏摘要；摘要只含 task、capability、错误码、重试标记、归一化 Provider 状态，以及场景规划失败时的有限 `validationReason` 分类，不含原始输入、Prompt、图片、密钥或原始错误文本。商品详情图逐项执行路径尚未统一接入该摘要。

### 10.5 Adapter 接口

```ts
export interface ModelGatewayAdapter {
  testConnection(config: ResolvedModelConfig): Promise<ProviderTestResult>;
  invoke(input: ResolvedModelInvocationInput): Promise<ModelInvocationAdapterResult>;
  poll?(input: PollModelInvocationInput): Promise<ModelInvocationAdapterResult>;
  cancel?(input: CancelModelInvocationInput): Promise<ModelInvocationAdapterResult>;
}
```

`ModelInvocationAdapterResult` 必须是内部标准结构：

```ts
export type ResolvedModelConfig = {
  id: string;
  capabilityId: ModelCapability["id"];
  protocol: "openai" | "openai-compatible";
  executionMode: "sync" | "stream" | "async-task" | "auto";
  model: string;
  baseUrl: string;
  endpointPath?: string;
  timeoutMs: number;
};

export type ResolvedModelInvocationInput = {
  invocationId: string;
  config: ResolvedModelConfig;
  input: ModelInvocationInput;
  renderedPromptHash?: string;
};

export type PollModelInvocationInput = {
  invocationId: string;
  config: ResolvedModelConfig;
  providerTaskId: string;
};

export type CancelModelInvocationInput = {
  invocationId: string;
  config: ResolvedModelConfig;
  providerTaskId?: string;
};

export type ProviderAssetRef = {
  source: "provider_result_url_redacted" | "provider_payload";
  mimeType?: string;
  sizeBytes?: number;
  redactedUrl?: string;
};

export type ModelInvocationAdapterResult =
  | {
      mode: "completed";
      outputText?: string;
      outputJson?: unknown;
      outputAssetRefs?: ProviderAssetRef[];
      usage?: ModelUsage;
    }
  | {
      mode: "running";
      providerTaskId: string;
      nextPollAfterMs?: number;
    }
  | {
      mode: "failed";
      error: NormalizedTaskError;
    };
```

### 10.6 本地模型调用约束

本地 `ModelGatewayAdapter` 必须由 Rust 实现。

要求：

- Rust 从 SQLite 本地密钥表读取密钥。
- Rust 读取输入资产文件。
- Rust 构造 OpenAI 或 OpenAI-compatible 请求。
- Rust 发起 Provider 或网关请求。
- Rust 处理同步、流式、异步任务出参。
- Rust 下载图片结果。
- Rust 保存到 workspace assets。
- Rust 写入 `model_invocations`。
- Rust 返回归一化结果给前端。

### 10.7 远端模型调用约束

SaaS 版本中：

- 前端不直接调用 Provider。
- Provider 或第三方网关由云端 worker / task queue 执行。
- 前端只查询 SaaS invocation 或 generation task 状态。
- 资产 URL 由后端签发。
- 云端仍必须返回同一个 `ModelInvocation` 标准结构。

## 11. 本地文件系统一致性

本地单机版本涉及 SQLite 和本地文件双写，必须统一顺序。

### 11.1 导入图片

```text
1. 校验文件类型和大小。
2. 复制到临时路径。
3. 计算 sha256，读取宽高和 MIME。
4. SQLite 事务插入 asset。
5. atomic rename 到正式 assets 路径。
6. 失败时清理 temp。
```

### 11.2 下载生成结果

```text
1. 下载到 cache/tmp。
2. 校验 MIME、大小和 hash。
3. atomic rename 到 assets/generated。
4. SQLite 事务插入 asset 和 generation_asset。
5. 失败时将 task 标记 failed，并清理 temp。
```

### 11.3 删除资产

```text
1. 先检查是否被历史任务引用。
2. 有引用时默认标记 deleted，不直接物理删除。
3. 无引用时在 DB 事务中删除引用或标记 deleted。
4. 事务提交后再删除物理文件。
5. 文件删除失败则写入 GC 待清理记录。
```

原则：

- 不允许先删物理文件再改数据库。
- 所有生成结果必须先落到 workspace assets，再返回给 UI。
- 孤儿文件和 deleted assets 由 GC 任务清理。

## 12. 跨平台兼容约束

MVP 必须同时考虑 macOS 和 Windows。业务能力与 IO 差异由 Rust runtime、Shell adapter 和 Runtime Ports 屏蔽，React feature 页面不写平台分支。AppShell、标题栏等宿主 chrome 可以使用 WebView 可执行的显式平台识别选择平台布局，但不得借此绕过 Runtime Ports 调用业务能力。

### 12.1 路径与文件名

- SQLite 只保存 workspace 内相对路径，不保存绝对路径。
- Rust 文件系统层使用 `PathBuf` / `OsString` 处理路径，不用字符串拼接路径。
- 前端展示路径时只展示脱敏后的相对路径或文件名。
- 物理文件名使用 runtime 生成的稳定 ID，不直接使用用户上传文件名作为最终文件名。
- 用户可见 `name` / `original_name` 必须做文件名字符清理，避免 Windows 保留字符和保留设备名。
- 避免过深目录结构，降低 Windows 长路径风险。

### 12.2 原子写入与文件锁

- temp 文件和最终文件必须位于同一 workspace 卷内，保证 rename 具备原子语义。
- Windows 下 rename 前必须确保下载句柄、图片解码句柄和 SQLite blob 读取句柄已经关闭。
- 不依赖“覆盖正在被打开的文件”这类平台差异行为。
- `deleteAsset` 物理删除失败时只写 GC 待清理，不把任务历史改坏。

### 12.3 SQLite 与工作区目录

- SQLite 统一启用 `foreign_keys`、`WAL`、`busy_timeout`。
- `switchWorkspace` 前必须停止本地 executor，并关闭当前 workspace 的 DB 连接和文件句柄。
- `initializeWorkspace` 应检测常见云同步目录并给出警告，例如 iCloud Drive、OneDrive、Dropbox、坚果云。
- 默认 workspace 建议放在系统应用数据目录，不推荐放在桌面、下载目录或云同步目录。
- migration 失败时禁止进入主界面，但必须提供查看错误、打开目录、切换 workspace、备份并新建 workspace 的恢复入口。

### 12.4 系统能力适配

- MVP 不依赖 macOS Keychain 或 Windows Credential Manager，secret 统一由 SQLite 本地密钥表保存。
- Rust runtime 必须在初始化 workspace 时尽力设置目录和 DB 文件权限；Windows 下使用当前用户 ACL，避免 Everyone / Users 可写。
- `ShellPort.revealPath` 在 macOS 映射 Finder，在 Windows 映射 Explorer。
- 系统通知、开机启动、托盘等能力通过 `RuntimeInfoPort.features` 暴露给 UI；当前窗口的拖动、最小化、最大化和关闭由共享 AppShell chrome 调用 Tauri window API，不下沉到业务 feature。
- Windows 使用平台专属 Tauri 配置关闭原生 decorations，显示 44px 自绘标题栏和三枚窗口按钮；应用内层不再重复绘制外框圆角和白色边框，由 Windows 11 系统窗口负责圆角裁切，保证关闭按钮悬停背景贴合右上外框。最大化按钮在窗口 resize 后读取真实 `isMaximized` 状态：普通状态显示单方框和“最大化”，最大化状态显示双方框和“还原”。Windows 继续启用 `shadow: true` 保留 DWM 阴影与圆角，并在 Tauri setup 中用 `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` 抑制蓝色/强调色系统外框，再将 Tao 为阴影保留的顶部非客户区 `DWMWA_CAPTION_COLOR` 设为标题栏白色，消除顶部蓝线；不支持相关属性时输出固定 warning 并继续启动。macOS 保持 `decorations: true`、Overlay 标题栏及原生交通灯。Windows 自绘标题栏必须验证拖动、双击最大化、交互控件隔离、关闭按钮贴边、最大化/还原图标同步、聚焦/失焦无强调色边框、边缘缩放、高 DPI 和最大化/还原布局；原生 Snap Layout 悬停菜单当前不在范围内。

## 13. 单机到 SaaS 的切换策略

### 13.1 RuntimeMode

```ts
export type RuntimeMode = "local" | "remote";
```

应用启动时解析 runtime mode：

```text
local  -> LocalRuntimeClient -> Tauri commands
remote -> RemoteRuntimeClient -> HTTPS API
```

第一版只实现 `local`。

### 13.2 禁止模式

不要让页面组件判断：

```ts
if (isTauri) {
  ...
} else {
  ...
}
```

页面只拿 runtime client：

```ts
const runtime = useRuntime();
await runtime.generation.createTask(input);
```

### 13.3 Remote Capability Contract

远端 capability 不返回 provider、model、baseUrl 或 Prompt 模板，但可以返回产品级元数据：

```ts
export type RemoteCapability = {
  id: ModelCapability["id"];
  available: boolean;
  unavailableReason?: string;
  displayName: string;
  qualityTier?: "fast" | "balanced" | "quality";
  estimatedCreditCost?: number;
  maxInputAssets?: number;
  supportedAspectRatios?: string[];
};
```

远端 API contract 从第一天预留：

- `tenantId`
- `workspaceId`
- `userId`
- auth session
- quota / credit cost
- rate limit
- signed URL 过期时间
- upload prepare / complete
- task queue position
- billing unavailable
- capability unavailable reason
- content policy rejection

Local 到 SaaS 迁移边界：

- MVP 不做本地 workspace 到 SaaS 的自动迁移。
- 本地 `model_configs` 不迁移到 SaaS，SaaS 模式由服务端重新维护模型配置。
- 本地历史和资产默认只读保留；是否提供一次性上传和导入工具，需要作为产品决策单独确认。
- 切换 `RuntimeMode` 不等于迁移数据，只表示后续新请求走新的 runtime adapter。

## 14. 实施优先级

### M0：Workspace + SQLite migration

目标：先建立本地 source of truth，应用不能在工作区不可用时进入主界面。

任务：

- `WorkspacePort`。
- workspace 目录结构。
- `workspace.db`。
- migrations。
- `PRAGMA foreign_keys` / `WAL` / `busy_timeout`。
- 启动恢复流程骨架。
- orphan temp files 清理。
- 云同步目录风险检测。
- migration 失败恢复入口。

### M1：Settings + Shell + RuntimeInfo

目标：把设置、本地壳能力和 runtime feature detection 接真实接口。

任务：

- `SettingsPort`。
- `ShellPort`。
- `RuntimeInfoPort`。
- 设置页真实读写。
- 工作区目录选择。
- 根据 runtime feature 控制 UI 能力入口。
- macOS / Windows 壳能力差异通过 `RuntimeInfoPort.features` 暴露。

### M2：Asset

目标：资产导入、读取、删除和 GC 都由 runtime 统一管理。

任务：

- `AssetPort`。
- `importImages`。
- `revealAsset`。
- `deleteAsset`。
- `sha256` / MIME / width / height。
- temp file + atomic rename。
- `deleted_at` / GC。
- 输入资产删除保护。
- Windows 文件名清理、长路径风险和文件锁处理。

### M3：Task History 基础

目标：先把任务历史和状态机从 mock 改成 SQLite 事实。

任务：

- `GenerationPort` 基础 command。
- `generation_tasks`。
- `generation_task_input_assets`。
- `generation_assets`。
- `task_events`。
- `status + stage`。
- `idempotency_key` 语义。
- runtime task event emit。
- History 页面从 SQLite 读取。

### M4：PromptPlan

目标：生成方案可创建、编辑、确认，并在任务创建时冻结快照。

任务：

- `PromptPlanPort`。
- `prompt_plans`。
- `prompt_plan_items`。
- confirm plan。
- task 创建时保存 snapshot。
- raw prompt 不入库。

### M5：Capability + Model Config + Secret

目标：建立本地模型配置和能力查询边界，同时确保密钥只通过 `SecretPort` 进入 SQLite 本地密钥表。

任务：

- `CapabilityPort`。
- `ModelConfigPort`。
- `SecretPort`。
- SQLite 本地密钥表。
- provider profiles。
- local model config view。
- connection test。
- capability 和 model config 写后同步。

### M6：ModelGateway contract

目标：先统一模型调用合同，再接真实 Provider。

任务：

- Internal `ModelGatewayPort`。
- `DeterministicModelGatewayAdapter` 仅测试。
- `OpenAIAdapter` / `OpenAICompatibleGatewayAdapter` 骨架。
- 同步 / 流式 / 异步任务出参归一化。

### M7：真实场景生图闭环

目标：完成第一条真实图片生成链路，并通过资产、历史、错误和重试闭环验收。

当前兼容性修复切片（已实现并通过自动化验证）：

- 将 H1-H5 从单一固定模板序列改成由 `conversionDriver` 驱动的三套主图叙事。
- 将 D1-D9 对齐通用 PDP 叙事，避免无事实源时强制生成包装、多品、评价或优惠。
- 模板与 variant 的业务规则由 Prompt/catalog TOML 提供，Rust 不硬编码业务文案。
- 单图规划的稳定序号、编号、用途和比例来自冻结输入，模板由 routing 冻结；Rust 校验结构、
  catalog 归属和 planning 与冻结路由一致性，不承担业务模板、variant 或证据门槛的语义选择。
  Style Lock、标题、Prompt 和负向约束仍须非空且无残留占位符，但 Prompt 与独立负向约束
  不做逐字子串匹配，允许模型使用等价措辞。
- 场景规划失败后返回配置页并保留参考图，不展示空 Prompt 审核页。
- 固定图片包在 Prompt 审核页不可删除或排序，空 Prompt 不得创建生图任务。
- 输出内容四种模式的标题提供共享 Tooltip 说明其 1/5/9/14 数量和用途。
- `multi-product` 暂时收窄到参考图已有的同款多角度/同系列组合。

本切片已修复前端 Scene 相关回归，以及后端 Prompt、参考资产、脱敏、variant/routing、
Scene `input.userImages` 入库前拒绝和显式尺寸/冻结比例一致性问题。`make check` 已通过，包含
249 项 Vitest、frontend build、cargo check 和 0 个高危 npm audit；Rust 全量 `cargo test`
已通过，lib 182/182 且全部
integration tests 成功。付费真实 Provider 外网 smoke test 与真实桌面快速新建、历史切换、
重启重试竞态仍由人工验收。

当前自动路由切片（自动化合同已验证，真实语义完成前不得标记完成）：

- UI 删除模板、模板分类和视觉方向选择；补充信息改为必填，空值不能创建规划任务。
- 一个 `scene-prompt-planning` 任务内部依次执行 routing v3 和 planning v10，两次调用共用
  `scene-prompt-planning` capability。
- 第一次只读取精简 routing index；第二次只读取路由选中的去重模板完整规则，并校验
  conversion driver、视觉方向和模板与冻结路由一致，并校验 planning 选择的 variant 属于冻结模板。
- H/D 只固定 code、purpose 与顺序，推荐模板不作为 allowlist；routing Prompt 要求 25 个模板
  在主体匹配且证据充分时均可路由。主体识别与证据门槛是模型行为约束，Rust 不维护第二套
  业务判定；真实参考图语义仍待人工验收。full-pack 允许有明确目的差异的模板复用，variant
  无适用 override 时使用 `base`。
- 模板原生视觉语言优先于跨图视觉方向基线；详情信息职责和镜头、背景、服装、字体规则按
  当前模板与主体类型条件化执行。
- planning system rules 只保留模型行为规则；数量、顺序、字段和版本由 Rust/output format
  保证。planning 只注入 code/purpose 与冻结模板，不注入 recommendedTemplateIds。
- 路由结果仅驻留内存，不进入 SQLite、task events、诊断或前端 DTO。
- catalog 升级为 v5，generation 使用 v7；不新增 capability、GenerationPort、schema、
  migration 或依赖。

任务：

- `GenerationService` 调 `ModelGatewayPort`。
- `LocalTaskExecutor` 执行任务。
- 下载结果到 assets。
- 失败归一化。
- 重试闭环。
- 任务详情可查看 `task_events`。

## 15. 需要单独确认的决策

以下事项进入编码前必须确认：

1. SQLite 依赖选择：MVP 建议 `rusqlite + migration 工具`；如选择 `sqlx` 需确认编译和迁移成本。
2. Secret 存储方式：MVP 已确认使用 SQLite 本地密钥表，不使用 macOS Keychain / Windows Credential Manager；正式发布前可再评估是否升级。
3. 第一条真实模型通道：建议先接稳定官方 Provider，再接 OpenAI-compatible 网关。
4. 单机版已确认允许用户为内置 provider profile 的模型配置自定义并持久化 `baseUrl`；Mock Local 固定为 `mock://local`，其他 provider 只接受无凭据、无查询参数的 HTTPS 地址。React 页面不开放 `endpointPath` 编辑。OpenAI / 火山引擎的特殊图像 endpoint 由 Rust 强制映射，其他类别沿用已保存的 `endpointPath` 或 profile 默认值；不开放任意 custom provider/profile。
5. 异步网关第一版是否只支持轮询，还是同时预留 webhook/callback。MVP 建议单机只做 polling。
6. SaaS 版服务端模型能力列表是否按租户、套餐、工作区或用户粒度返回。
7. SaaS 版是否允许客户端知道模型能力名称之外的任何模型元数据。
8. 本地 workspace 默认目录。
9. SaaS 版本是否需要多租户、团队空间和额度系统。
10. Local workspace 升级到 SaaS 时，历史和资产是只读保留、一次性导入，还是不提供迁移。
11. 本地 `model_configs` 是否永不迁移到 SaaS；默认建议不迁移，只由 SaaS 服务端重新配置。
12. `confirmed` PromptPlan 是否需要“取消确认”能力；MVP 默认不支持原地回退，只能新建 draft。
13. 任务状态更新在 SaaS 阶段优先采用 SSE、WebSocket 还是 polling。
14. Windows 本地密钥文件权限策略：确认 workspace 目录 ACL、备份排除策略和诊断包脱敏策略。
15. Windows 安装包、自动更新、代码签名和企业环境代理策略是否纳入 MVP。

这些涉及依赖、数据库、配置和外部协议，不能在没有确认时直接落代码。

## 16. 验证策略

### 16.1 每阶段必须验证

```bash
npm --prefix desktop run test
npm --prefix desktop run build
make cargo-check
git diff --check
```

涉及 Rust 业务逻辑后增加：

```bash
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib -- --nocapture
```

### 16.2 测试重点

- Port 接口 contract tests。
- Settings 持久化。
- Secret 只落 SQLite 本地密钥表，不进入其他表、日志、事件或前端 DTO。
- Asset 导入和删除。
- Task 状态机和 stage 流转。
- task input assets 删除保护。
- task events 写入。
- runtime task event emit。
- SQLite migration。
- temp file / atomic rename / orphan GC。
- Windows 文件名清理、文件锁和 SQLite 文件 ACL 行为。
- ModelGatewayPort contract tests。
- DeterministicModelGatewayAdapter contract tests。
- OpenAI-compatible 网关同步响应归一化。
- OpenAI-compatible 网关异步任务归一化。
- Provider / Gateway 错误归一化。
- 启动恢复。
- 前端空态、失败态、重试态。

### 16.3 验收清单

Workspace：

- 首次启动能初始化 workspace。
- workspace 缺目录时能修复。
- migration 失败时不能进入主界面。
- migration 失败时能查看错误、打开目录、切换 workspace 或备份新建 workspace。
- 启动时 `running` 任务被恢复为 `failed` / `interrupted`。
- 选择常见云同步目录作为 workspace 时会给出风险警告。

Asset：

- 导入图片后 SQLite 只保存相对路径。
- 删除被历史任务引用的 asset 不破坏历史。
- deleted asset 默认不出现在资源库。
- GC 不删除被任务引用的文件。

PromptPlan：

- PromptPlan 可创建、编辑、确认。
- 创建任务时保存 plan snapshot。
- 编辑原 plan 不影响历史任务。
- 任务详情读取冻结的 `PromptPlanSnapshot`，不重新拼当前 plan。
- SQLite 不保存 raw prompt。
- 商品详情图要求 confirmed PromptPlan。
- 服饰 AI 生成模特使用独立的 `clothing-base-model-generation` 文生图 capability，并支持婴儿、儿童、青少年、青年、中年、老年年龄阶段。
- 服饰试穿要求先完成 `clothing-scene-planning` 结构化规划。
- 场景图必须先完成 `scene-prompt-planning`，再由父生图任务通过 `promptPlanId`
  关联规划任务并冻结版本与用户确认方案。

Task：

- `createTask` 双击不会创建重复任务。
- `createTask` 命中 failed 的 `idempotencyKey` 时返回 `TASK_RETRY_REQUIRED`。
- `retryTask` 创建新 task，并关联 `retry_of_task_id`。
- 商品与服饰单图重试创建只含目标项的子 task，并在冻结输入中关联 `parentTaskId`、`imageId` 和 `imageNo`，不写 `retry_of_task_id`；成功后唯一输出原子归并父任务稳定槽位并隐藏子任务。
- `deleteTask` 只隐藏任务历史，不物理删除输入资产或生成结果资产。
- `stage` 变化会写 `task_events`。
- local mode 下 `task_events` 写入后会触发 runtime 事件。
- failed 任务能看到失败阶段和错误码。

Model Config：

- API Key 只保存在 `model_secrets.secret_value`。
- `LocalModelConfigView` 不包含 secret 明文。
- SaaS mode 不返回 provider、model、baseUrl、endpointPath。
- `provider_profile_id` 不能绕过内置 allowlist。
- 保存或删除模型配置后，`CapabilityPort` 立即反映能力变化。
- remote mode 误调用 `ModelConfigPort` 时返回 `MODEL_CONFIG_UNAVAILABLE`。
- 切换 workspace 后，secret 状态按 workspace 隔离。

Security：

- `task_events.detail_json` 不包含 Authorization、API Key、raw request、raw response。
- Provider URL 入库前必须脱敏。
- custom gateway MVP 不开放。

Windows：

- Windows 下导入、删除、GC 不因文件句柄未关闭导致数据库状态损坏。
- Windows 下 workspace 目录和 SQLite 文件仅当前用户可读写。
- Explorer reveal、系统通知和目录选择只通过 `ShellPort` / `RuntimeInfoPort.features` 暴露。
- 文件名清理能处理 Windows 保留字符、保留设备名和长路径风险。

## 17. 最终保留原则

1. 前端 feature 只调用 Public Runtime Ports。
2. 资产型任务只走 `GenerationPort`。
3. 文本辅助能力走 `AiAssistPort`。
4. `ModelGatewayPort` 只作为 runtime 内部端口。
5. `CapabilityPort` 是模型能力唯一查询入口。
6. `ModelConfigPort` 只服务 local mode，本地配置不进入 SaaS DTO。
7. `WorkspacePort` 是本地工作区生命周期唯一入口。
8. SQLite 保存相对路径、脱敏摘要、结构化状态，以及 `model_secrets` 中的本地 API Key。
9. API Key 只能进入 SQLite 本地密钥表；raw prompt、Provider raw response 永不入库。
10. PromptPlan 当前状态和 Task 执行快照必须分离。
11. MVP 不开放任意 custom gateway。
12. MVP 后台本地任务最多并发 4 个；同步执行器和单元测试固定为 1，真实 Provider 调用另受进程级限流池约束。
13. macOS / Windows 的业务能力和 IO 差异由 runtime adapter 屏蔽，React feature 页面不写平台分支；AppShell、标题栏等宿主 chrome 可以显式选择平台布局，但不得绕过 Runtime Ports 调用业务能力。
