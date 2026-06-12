# AI 服装展示图生成桌面端技术方案（评审修订版）

> 版本：v3.5-review
>
> 说明：本版本在 v3.4-review 基础上补充授权激活体系，明确 License Server 作为唯一允许的轻量服务端边界，覆盖 License 创建、状态查询、设备激活/解绑、授权 token 刷新、支付 webhook 和套餐功能开关。

## 1. 项目定位

### 1.1 产品目标

建设一个桌面端 AI 生图工作流工具，用户可在本地应用中完成：

1. 导入人物图片；
2. 导入多角度服装图片；
3. 将人物图片与服装图片组成一个图片组合；
4. 在工作流画布中查看该组合的处理链路；
5. 选择第三方生图模型；
6. 配置模型参数；
7. 使用内置 Prompt，或对内置 Prompt 进行替换 / 补充；
8. 点击执行按钮；
9. 应用本地调用第三方 AI 生图 API；
10. 展示等待动画、任务状态、生成结果和失败原因；
11. 将结果图片保存到本地工作区。
12. 通过激活码完成设备授权激活；
13. 按授权套餐启用或禁用本地功能。

### 1.2 非目标

第一阶段不做以下内容：

| 项目           | 是否支持 | 说明                       |
| ------------ | ---: | ------------------------ |
| 自建业务后端服务     |    否 | 图片、组合、Prompt、任务历史等业务状态本地保存 |
| License Server   |    是 | 仅用于授权、设备激活、支付回调和套餐功能开关 |
| 自建 AI 推理服务   |    否 | 仅接第三方 API                |
| 云端用户体系       |    否 | 本地单机应用                   |
| 多人协作         |    否 | 本地工作区                    |
| 通用 DAG 工作流引擎 |    否 | 第一阶段采用固定流程画布             |
| 脚本节点         |    否 | 避免安全和复杂度失控               |
| 自由图形编辑器      |    否 | 不是 Photoshop / Figma 类工具 |
| 长期云端任务队列     |    否 | 使用本地任务状态机                |

---

# 2. 技术选型

## 2.1 桌面端框架

推荐：

```text
Tauri 2.x + React + TypeScript
```

Tauri 适合该项目，因为它允许使用现有 Web 前端技术栈构建桌面应用，并提供 Rust 后端能力与前端交互；官方文档也明确 Tauri 可使用任意前端框架，并支持跨平台构建。([Tauri][1])

### 选择 Tauri 的原因

| 维度         | 结论                            |
| ---------- | ----------------------------- |
| 包体积        | 通常比 Electron 更轻               |
| 本地文件访问     | Rust command 处理更合适            |
| API Key 管理 | 可由 Rust 层接入系统密钥库              |
| 第三方 API 调用 | 避免浏览器 CORS 和密钥暴露              |
| 跨平台        | Windows / macOS / Linux 可统一架构 |
| 与前端技术融合    | React / TypeScript 开发效率高      |

---

## 2.2 工作流画布

推荐：

```text
React Flow
```

React Flow 适合节点式工作流 UI，它支持自定义节点、自定义边、节点状态、缩放、拖拽和复杂节点数据类型。官方文档提供了 TypeScript 下自定义节点类型、复杂节点数据和 Zustand 状态管理的说明。([React Flow][2])

### 为什么不用 Konva

Konva 适合自由画布、图像排版、图形编辑。

但本项目核心是：

```text
人物图节点 -> 服装图组节点 -> Prompt 节点 -> 模型节点 -> 执行节点 -> 结果节点
```

这属于节点式工作流，而不是像素级图形编辑。

所以：

| 需求        | React Flow | Konva |
| --------- | ---------: | ----: |
| 工作流节点     |          强 |     中 |
| 连线表达流程    |          强 |     弱 |
| 自定义节点 UI  |          强 |     中 |
| 图片自由摆放    |          中 |     强 |
| 任务状态节点    |          强 |     中 |
| 后续扩展为流程编排 |          强 |     弱 |

---

## 2.3 状态管理

推荐：

```text
Zustand + React Query
```

用途拆分：

| 工具            | 用途                                  |
| ------------- | ----------------------------------- |
| Zustand       | 本地编辑器状态、当前工作流、选中组合、节点状态             |
| React Query   | 调用 Tauri command、异步任务、模型配置读取、任务历史刷新 |
| SQLite / JSON | 本地持久化                               |
| Tauri Event   | Rust 层向前端推送任务状态                     |

React Flow 官方文档中也有使用 Zustand 管理 React Flow 状态的示例与说明。([React Flow][3])

状态权威边界：

1. SQLite / Rust command 是已保存业务事实的权威来源；
2. Zustand 保存当前编辑草稿、选中组合、任务缓存和 UI 派生状态；
3. React Flow 只负责节点渲染态、视口、缩放、拖拽和选中交互；
4. React Flow `nodes[].data` 必须由 Zustand / React Query 数据派生，不得作为保存业务字段的 canonical state；
5. 节点位置等纯画布 UI 状态可以由 React Flow 管理，若需要持久化，应单独保存为 layout state，不与业务对象混写。

---

## 2.4 本地存储

推荐第一阶段使用：

```text
SQLite + 本地 assets 文件目录
```

不建议只用 JSON，因为你会很快产生这些数据：

* 图片资源；
* 图片组合；
* Prompt 模板；
* Prompt 绑定；
* 模型配置；
* 任务历史；
* 结果图片；
* 错误记录；
* 执行日志。

这些数据之间有关系，SQLite 更利于查询、迁移和维护。

---

## 2.5 API Key 存储

推荐：

```text
系统密钥库 / Keychain / Credential Manager
```

不要把 API Key 存到：

```text
localStorage
workspace.json
SQLite 明文字段
前端源码
.env 文件
```

Tauri 生态中已有基于 Rust keyring / 系统 keychain 的社区插件或方案，可用于将敏感信息存入系统级凭据存储。([GitHub][4])

评审结论：

> API Key 必须由 Tauri Rust 层读取和使用，前端只拿到“是否已配置”和脱敏展示结果。

---

# 3. 总体架构

## 3.1 架构图

```text
┌────────────────────────────────────────────────────────────┐
│                     Tauri Desktop App                       │
├────────────────────────────────────────────────────────────┤
│ React Frontend                                              │
│                                                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐ │
│  │ Workflow Canvas      │   │ Right Property Panel         │ │
│  │ React Flow           │   │ Prompt / Model / Params      │ │
│  └─────────────────────┘   └─────────────────────────────┘ │
│                                                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐ │
│  │ Asset Library        │   │ Result / Task History        │ │
│  │ Person / Garment     │   │ Generated Images             │ │
│  └─────────────────────┘   └─────────────────────────────┘ │
│                                                            │
│  Zustand Store + React Query                               │
├────────────────────────────────────────────────────────────┤
│ Tauri Rust Local Execution Layer                            │
│                                                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐ │
│  │ Asset Manager        │   │ Prompt Resolver              │ │
│  └─────────────────────┘   └─────────────────────────────┘ │
│                                                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐ │
│  │ Provider Adapter     │   │ Local Task Runner            │ │
│  │ OpenAI/Fal/Fixed     │   │ Status Emit / Cancel / Retry │ │
│  └─────────────────────┘   └─────────────────────────────┘ │
│                                                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐ │
│  │ Credential / License │   │ SQLite / File Store          │ │
│  └─────────────────────┘   └─────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│ Local Workspace                                             │
│  workspace.db                                               │
│  assets/input                                               │
│  assets/output                                              │
│  cache                                                      │
└────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS                              HTTPS
                             ▼
              Third-party Image Generation APIs        License Server
                                                       License / Device
                                                       Token / Feature Flags
                                                       Payment Webhook
```

---

## 3.2 分层职责

| 层                 | 职责                          |
| ----------------- | --------------------------- |
| React UI          | 画布、节点、Prompt 编辑、模型选择、结果展示   |
| Zustand Store     | 当前编辑态、选中组合、节点状态             |
| Tauri Commands    | 本地文件、数据库、API Key、第三方 API 调用 |
| Provider Adapter  | 屏蔽不同第三方 API 差异              |
| Local Task Runner | 本地任务状态机、取消、失败、重试            |
| License Client    | 激活码验证、设备激活、授权 token 刷新、功能开关读取 |
| License Server    | License 管理、设备绑定、支付回调、套餐权益计算 |
| SQLite            | 结构化数据持久化                    |
| File Store        | 图片文件与结果文件管理                 |

---

# 4. 核心业务抽象

本系统的核心不是“节点”，而是以下对象：

```text
Asset              本地图片资源
ImageCombination   一组人物图 + 多张服装图
PromptTemplate     Prompt 模板
PromptBinding      图片组合上的 Prompt 配置
ModelDefinition    模型能力定义
ModelConfig        用户选择的模型与参数
GenerationTask     一次生成任务
GenerationResult   生成结果
License            授权码与套餐权益
LicenseActivation  当前设备激活状态
EntitlementToken   授权 token 与功能开关
DeviceBinding      授权设备绑定关系
```

---

# 5. 工作流模式设计

## 5.1 第一阶段采用固定流程

画布表现为工作流，但执行逻辑固定：

```text
[人物图输入]
      │
      ▼
[服装图组输入]
      │
      ▼
[Prompt 配置]
      │
      ▼
[模型选择]
      │
      ▼
[执行生成]
      │
      ▼
[结果展示]
```

第一阶段不允许用户任意新增节点、删除核心节点或自定义连线。

### 原因

如果第一阶段直接做通用 DAG，会引入：

* 节点输入输出 schema；
* 边连接规则；
* DAG 校验；
* 执行拓扑排序；
* 节点运行时；
* 中间产物缓存；
* 节点失败恢复；
* 自定义节点版本化。

这些不是当前业务闭环的关键。

---

## 5.2 画布节点

### 5.2.1 PersonInputNode

功能：

* 选择一张人物图；
* 支持拖入；
* 支持替换；
* 支持删除；
* 显示图片尺寸、文件大小、格式；
* 校验是否满足模型输入要求。

```ts
type PersonInputNodeData = {
  combinationId: string;
  imageId?: string;
  previewUrl?: string;
  status: "empty" | "ready" | "invalid";
  validationMessage?: string;
};
```

---

### 5.2.2 GarmentGroupNode

功能：

* 选择多张衣服图；
* 支持排序；
* 支持替换；
* 支持删除；
* 支持标记视角；
* 支持设置主参考图。

```ts
type GarmentView =
  | "front"
  | "side"
  | "back"
  | "detail"
  | "unknown";

type GarmentImageItem = {
  imageId: string;
  view: GarmentView;
  sortOrder: number;
  isPrimary?: boolean;
};

type GarmentGroupNodeData = {
  combinationId: string;
  images: GarmentImageItem[];
  status: "empty" | "ready" | "invalid";
  validationMessage?: string;
};
```

说明：`minCount / maxCount` 不写入节点数据，也不随工作区持久化。它们必须由当前选中模型的 `ModelDefinition.inputLimits` 在运行时派生。用户切换模型后，服装图数量约束应立即重新计算。

---

### 5.2.3 PromptConfigNode

功能：

* 展示当前 Prompt 配置状态；
* 支持默认、追加、替换；
* 展示最终 Prompt 预览；
* 显示 Prompt 是否超过模型限制。

```ts
type PromptOverrideMode = "default" | "append" | "override";

type PromptPartConfig = {
  mode: PromptOverrideMode;
  baseTemplateId?: string;
  appendText?: string;
  overrideText?: string;
};

type PromptBinding = {
  id: string;
  combinationId: string;

  system: PromptPartConfig;
  user: PromptPartConfig;
  negative?: PromptPartConfig;

  variables: Record<string, string>;

  createdAt: string;
  updatedAt: string;
};
```

---

### 5.2.4 ModelSelectNode

功能：

* 选择 Provider；
* 选择模型；
* 根据模型 schema 渲染参数表单；
* 显示模型是否支持多图、System Prompt、Negative Prompt；
* 显示 API Key 是否已配置。

```ts
type ModelProvider =
  | "openai"
  | "replicate"
  | "fal"
  | "stability"
  | "custom";

type ModelConfig = {
  id: string;
  provider: ModelProvider;
  modelId: string;
  displayName: string;
  params: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

---

### 5.2.5 ExecuteNode

功能：

* 根据组合状态判断是否可执行；
* 显示执行按钮；
* 显示任务状态；
* 支持取消；
* 支持失败重试；
* 支持查看请求摘要。

```ts
type ExecuteNodeData = {
  combinationId: string;
  canExecute: boolean;
  disabledReason?: string;
  currentTaskId?: string;
  taskStatus?: LocalTaskStatus;
  progress?: number;
  message?: string;
};
```

---

### 5.2.6 ResultNode

功能：

* 展示生成结果；
* 支持打开大图；
* 支持复制路径；
* 支持导出；
* 支持将结果加入资源库；
* 支持基于结果再次生成。

```ts
type ResultNodeData = {
  combinationId: string;
  taskId?: string;
  resultImageIds: string[];
  status: "empty" | "generating" | "ready" | "failed";
};
```

---

# 6. 图片组合模型

## 6.1 ImageCombination

```ts
type ImageCombination = {
  id: string;
  name: string;

  personImageId?: string;

  garmentImages: {
    imageId: string;
    view: GarmentView;
    sortOrder: number;
    isPrimary?: boolean;
  }[];

  modelConfigId?: string;
  promptBindingId?: string;

  createdAt: string;
  updatedAt: string;
};
```

## 6.2 执行条件

```ts
type CombinationValidationResult = {
  revision: number;
  valid: boolean;
  reasons: string[];
  warnings: string[];
  resolvedPrompt?: ResolvedPrompt;
  derivedLimits?: {
    person: ModelInputRoleLimit;
    garment: ModelInputRoleLimit;
    totalImages: { min: number; max: number };
    maxPromptLength: number;
  };
};
```

校验原则：

1. 不再硬编码“衣服图至少 2 张”；
2. 所有图片数量限制均从当前 `ModelDefinition.inputLimits` 派生；
3. 输入约束必须区分人物图、服装图、参考图、遮罩图等业务角色；
4. 总图片数量限制只用于 Provider 层输入上限，不替代业务角色限制；
5. Prompt 校验必须使用 Rust `PromptResolver` 得到的最终 Prompt；
6. 前端不得作为业务级执行校验的权威来源。

推荐将 `ModelDefinition.inputLimits` 调整为：

```ts
type ModelInputRoleLimit = {
  required: boolean;
  min: number;
  max: number;
};

type ModelInputLimits = {
  person: ModelInputRoleLimit;
  garment: ModelInputRoleLimit;
  reference?: ModelInputRoleLimit;
  mask?: ModelInputRoleLimit;

  totalImages: {
    min: number;
    max: number;
  };

  supportedMimeTypes: string[];
  maxFileSizeMB: number;
  maxPromptLength: number;
};
```

校验规则：

| 校验项 | 规则 |
| --- | --- |
| 人物图 | 按 `model.inputLimits.person.required/min/max` 校验 |
| 衣服图 | 按 `model.inputLimits.garment.required/min/max` 校验 |
| 总图片数 | 按 `model.inputLimits.totalImages.min/max` 校验 |
| 图片格式 | 必须在模型支持范围内 |
| 图片大小 | 不超过模型限制 |
| 模型配置 | 必须选择 |
| API Key | 当前 Provider 必须已配置 |
| Prompt | 通过 Rust `PromptResolver` 解析后不得为空，且不得超过模型限制 |
| 当前任务 | MVP 阶段全局只允许 1 个运行中任务 |

## 6.3 校验权威与刷新策略

执行条件校验整体由 Rust 层提供权威结果，新增 `validate_combination` command。

前端职责：

1. 收集当前组合、模型配置、PromptBinding 编辑态；
2. 在关键输入变更后触发 `validate_combination`；
3. 使用返回结果更新 `ExecuteNode.canExecute`、`disabledReason` 和 Prompt 预览；
4. 不在前端重复实现业务级 Prompt 解析和执行条件判断。

触发时机：

| 变更来源 | 是否触发 `validate_combination` | 说明 |
| --- | ---: | --- |
| 人物图选择 / 替换 / 删除 | 是 | 影响 person limit |
| 服装图增删 / 排序 / 主图 / 视角 | 是 | 影响 garment limit 与输入快照 |
| 模型选择 / 参数变化 | 是 | 影响 inputLimits、Prompt 长度、输出数量 |
| PromptBinding 任意字段变化 | 是 | 影响最终 Prompt 与长度 |
| Provider API Key 配置状态变化 | 是 | 影响是否可执行 |
| 任务开始 / 完成 / 失败 / 取消 | 是 | 影响 MVP 单任务并发限制 |

前端缓存策略：

```ts
type ValidationCache = {
  combinationId: string;
  revision: number;
  status: "idle" | "validating" | "valid" | "invalid" | "stale";
  result?: CombinationValidationResult;
  updatedAt?: string;
};
```

要求：

1. 每次组合、模型或 Prompt 编辑态变更时，前端递增本地 `revision`，并将校验状态标记为 `stale`；
2. `stale` 或 `validating` 状态下，执行按钮必须禁用，文案显示“正在校验当前配置”；
3. 调用 `validate_combination` 建议做 300ms debounce，避免 Prompt 输入时频繁请求 Rust；
4. Rust 返回结果时必须携带请求方传入的 `revision`，前端只接受与当前 revision 一致的结果；
5. 用户不需要手动点击“预览”才能刷新 `canExecute`；Prompt 预览和执行校验共用同一次 Rust 解析结果。
6. 如果前端采用自动保存策略，必须保证组合、Prompt、模型参数在触发校验前已落库；
7. 如果前端允许未保存草稿，必须通过 `draftCombination / draftPromptBinding / draftModelConfig` 将草稿传给 Rust，不得让校验结果落后于当前 UI。

Tauri command：

```ts
invoke<CombinationValidationResult>("validate_combination", {
  combinationId: string,
  draftCombination?: ImageCombination,
  draftPromptBinding?: PromptBinding,
  draftModelConfig?: ModelConfig,
  revision: number
});
```

Rust 层职责：

1. 加载组合、图片、模型定义、API Key 配置状态；
2. 如果收到草稿对象，优先使用草稿对象参与校验，但不得自动写入数据库；
3. 使用 `PromptResolver` 解析最终 Prompt；
4. 按当前 `ModelDefinition.inputLimits` 校验所有输入数量；
5. 校验图片格式、大小、Prompt 长度、模型能力；
6. 查询是否存在运行中任务；
7. 返回统一校验结果、动态限制值、最终 Prompt 和原样回传的 `revision`。

---

# 7. Prompt 系统设计

## 7.1 Prompt 类型

系统内区分三种 Prompt：

| 类型              | 含义               |
| --------------- | ---------------- |
| System Prompt   | 约束模型角色、输出原则、全局行为 |
| User Prompt     | 当前任务的生成意图        |
| Negative Prompt | 需要避免的内容          |

并不是所有第三方模型都支持三类 Prompt。模型定义中必须描述能力。

---

## 7.2 Prompt 修改模式

支持三种模式：

| 模式       | 含义               |
| -------- | ---------------- |
| default  | 使用内置模板           |
| append   | 保留内置模板，在后面追加用户内容 |
| override | 完全替换内置模板         |

### 合成规则

```text
default:
  final = baseTemplate

append:
  final = baseTemplate + "\n\n" + appendText

override:
  final = overrideText
```

---

## 7.3 PromptTemplate

```ts
type PromptTemplateType = "system" | "user" | "negative";

type PromptTemplate = {
  id: string;
  name: string;
  type: PromptTemplateType;
  content: string;
  variables: PromptVariable[];
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
};

type PromptVariable = {
  key: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
};
```

---

## 7.4 模板变量

支持变量：

```text
{{style}}
{{background}}
{{aspectRatio}}
{{garmentCategory}}
{{outputCount}}
```

示例模板：

```text
Use the person image as the model reference.
Use the garment images as multi-angle clothing references.

Target style: {{style}}
Background: {{background}}
Aspect ratio: {{aspectRatio}}

Requirements:
- Preserve the person's identity and natural body structure.
- Accurately transfer the garment color, pattern, fabric texture, and silhouette.
- Generate a clean e-commerce fashion display image.
```

---

## 7.5 Prompt 解析单权威设计

Prompt 最终解析只能有一个权威实现：

```text
Rust PromptResolver
```

前端不得实现最终 Prompt 解析逻辑。原因是前端预览与真实请求必须完全一致，避免因空白处理、变量 fallback、模板规则升级等细节差异导致“用户看到的 Prompt”和“实际发给模型的 Prompt”不一致。

### 7.5.1 前端职责

前端只负责：

1. 编辑 `PromptBinding`；
2. 保存变量值；
3. 调用 `preview_resolved_prompt` 获取最终预览；
4. 展示字符数、模型限制、警告信息；
5. 不拼接最终 Prompt，不替换模板变量。

前端可以做非权威辅助提示，例如输入框字符数统计，但不能作为执行依据。

### 7.5.2 Rust PromptResolver 职责

Rust 层提供唯一 Prompt 解析服务：

```rust
pub struct PromptResolver;

pub struct ResolvePromptInput {
    pub binding: PromptBinding,
    pub templates: Vec<PromptTemplate>,
    pub variables: std::collections::HashMap<String, String>,
    pub model_definition: ModelDefinition,
}

pub struct ResolvedPrompt {
    pub system: Option<String>,
    pub user: String,
    pub negative: Option<String>,
    pub warnings: Vec<String>,
    pub resolver_version: String,
}
```

解析规则：

```text
default:
  final = baseTemplate

append:
  final = baseTemplate + "

" + appendText

override:
  final = overrideText
```

模板变量替换规则：

```text
{{variableName}}
```

变量未定义时：

1. 如果变量声明为 required，则返回 warning，并阻止执行；
2. 如果变量非 required，则替换为空字符串；
3. 变量替换完成后执行 trim；
4. 最终 User Prompt 为空时禁止执行。

模板变量一致性校验：

1. `PromptResolver` 必须解析模板内容中的 `{{variableName}}` 占位符；
2. 模板中出现但 `variables_json` 未声明的变量，返回 `PROMPT_TEMPLATE_INVALID`；
3. `variables_json` 声明为 required 但模板内容未使用的变量，返回 warning；
4. required 变量缺少用户值且没有 defaultValue 时，阻止执行；
5. 保存内置或用户模板时应复用同一套变量校验逻辑，避免预览和执行阶段出现不同结果。

### 7.5.3 预览与执行共用 Resolver

```text
preview_resolved_prompt
start_generation
retry_generation_task
```

以上流程必须复用同一个 Rust `PromptResolver`，不得复制解析逻辑。

---

## 7.6 最终 Prompt 预览

Prompt 面板必须提供：

```text
最终 System Prompt
最终 User Prompt
最终 Negative Prompt
```

并显示：

| 指标     | 说明                   |
| ------ | -------------------- |
| 字符数    | 当前 Prompt 长度         |
| 模型限制   | 当前模型 maxPromptLength |
| 是否超限   | 超限时禁止执行              |
| 是否使用替换 | 标识用户是否覆盖内置模板         |
| 是否使用追加 | 标识用户是否追加补充           |

---

# 8. 模型系统设计

## 8.1 ModelDefinition

不同第三方 API 的能力差异很大，必须用 schema 描述模型能力。

```ts
type ModelInputRoleLimit = {
  required: boolean;
  min: number;
  max: number;
};

type ModelDefinition = {
  id: string;
  provider: ModelProvider;
  modelId: string;
  displayName: string;
  description?: string;
  definitionVersion: string;

  capabilities: {
    multiImage: boolean;
    systemPrompt: boolean;
    negativePrompt: boolean;
    seed: boolean;
    imageToImage: boolean;
    textToImage: boolean;
    maskImage: boolean;
    asyncTask: boolean;
  };

  inputLimits: {
    person: ModelInputRoleLimit;
    garment: ModelInputRoleLimit;
    reference?: ModelInputRoleLimit;
    mask?: ModelInputRoleLimit;
    totalImages: {
      min: number;
      max: number;
    };
    maxPromptLength: number;
    supportedMimeTypes: string[];
    maxFileSizeMB: number;
  };

  output: {
    supportedSizes: string[];
    maxOutputCount: number;
    supportedFormats: string[];
  };

  paramSchema: ModelParamSchema[];
};
```

## 8.1.1 ModelDefinition 来源机制

MVP 阶段 `ModelDefinition` 采用 Rust 静态注册表，不写入 SQLite，不允许用户在 UI 中编辑模型定义。

原则：

1. `list_model_definitions` 从 Rust 内置 registry 返回模型定义；
2. 新增官方支持模型、修改参数 schema、修改 inputLimits，均通过应用发版完成；
3. `ModelDefinition` 必须包含 `definitionVersion`，用于任务快照追溯；
4. `ModelConfig` 只保存用户选择的 provider、modelId 和 params，不复制完整模型定义；
5. `start_generation` 创建任务时必须把当时使用的完整 `ModelDefinition` 摘要写入 `modelConfigSnapshotJson`；
6. MVP 阶段不开放通用 `custom` Provider；
7. 第二阶段如需用户自定义 Provider 模型，另行引入 `custom_model_definitions` 表、Provider 配置表和导入校验机制。

推荐 Rust 侧结构：

```rust
pub struct ModelDefinitionRegistry {
    definitions: Vec<ModelDefinition>,
}

impl ModelDefinitionRegistry {
    pub fn list(&self) -> Vec<ModelDefinition>;
    pub fn get(&self, provider: &str, model_id: &str) -> Option<ModelDefinition>;
}
```

---

## 8.2 ModelParamSchema

```ts
type ModelParamSchema = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "slider";
  defaultValue?: unknown;
  options?: {
    label: string;
    value: unknown;
  }[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  description?: string;
};
```

---

## 8.3 示例模型定义

```ts
const modelDefinitions: ModelDefinition[] = [
  {
    id: "fal-fashion-v1",
    provider: "fal",
    modelId: "fashion-tryon-v1",
    displayName: "Fashion Try-on V1",
    definitionVersion: "2026.05.29",
    capabilities: {
      multiImage: true,
      systemPrompt: true,
      negativePrompt: true,
      seed: true,
      imageToImage: true,
      textToImage: false,
      maskImage: false,
      asyncTask: true,
    },
    inputLimits: {
      person: { required: true, min: 1, max: 1 },
      garment: { required: true, min: 2, max: 7 },
      totalImages: { min: 3, max: 8 },
      maxPromptLength: 4000,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      maxFileSizeMB: 10,
    },
    output: {
      supportedSizes: ["1024x1024", "1024x1536", "1536x1024"],
      maxOutputCount: 4,
      supportedFormats: ["png", "jpg"],
    },
    paramSchema: [
      {
        key: "size",
        label: "输出尺寸",
        type: "select",
        defaultValue: "1024x1536",
        options: [
          { label: "竖图 1024x1536", value: "1024x1536" },
          { label: "方图 1024x1024", value: "1024x1024" },
        ],
        required: true,
      },
      {
        key: "count",
        label: "生成数量",
        type: "slider",
        defaultValue: 1,
        min: 1,
        max: 4,
        step: 1,
      },
      {
        key: "seed",
        label: "随机种子",
        type: "number",
        required: false,
      },
    ],
  },
];
```

---

# 9. 第三方 API 适配器设计

## 9.1 设计目标

Provider Adapter 层负责屏蔽不同 API 差异。

前端不应该知道：

* 某个 API 是同步还是异步；
* 图片是 base64 上传还是 multipart；
* 返回的是图片 URL 还是 base64；
* 是否需要轮询；
* 错误码格式是什么。

前端只关心本地任务状态：

```text
preparing -> calling_model -> waiting_result -> downloading_result -> succeeded / failed
```

---

## 9.2 统一输入

```ts
type GenerateInput = {
  taskId: string;
  provider: ModelProvider;
  modelId: string;

  images: GenerateInputImage[];

  prompt: {
    system?: string;
    user: string;
    negative?: string;
  };

  params: Record<string, unknown>;
};

type GenerateInputImage = {
  id: string;
  role: "person" | "garment" | "reference" | "mask";
  view?: GarmentView;
  resolvedLocalPath: string;
  mimeType: string;
  sortOrder: number;
};
```

说明：`resolvedLocalPath` 只允许作为 Rust Provider Adapter 在任务生命周期内读取文件的临时绝对路径。生命周期从 `start_generation` 创建任务开始，到任务进入 `succeeded / failed / cancelled` 结束。该路径不得写入 SQLite、任务摘要、日志或任务快照。

---

## 9.3 统一输出

```ts
type GenerateResult = {
  taskId: string;
  provider: ModelProvider;
  modelId: string;

  images: {
    storageRelativePath: string;
    mimeType: string;
    width?: number;
    height?: number;
    sourceUrl?: string;
  }[];

  rawResponse?: unknown;
};
```

Provider 返回脱敏要求：

1. `rawResponse` 只允许作为 Provider Adapter 运行时调试对象，不得写入 SQLite、日志或任务快照；
2. `sourceUrl` 入库前必须移除签名参数、鉴权 token、临时访问凭证等敏感 query；
3. 如果无法确认 `sourceUrl` 已安全脱敏，则 `generation_task_results.source_url` 必须保存为 `NULL`；
4. 日志和 `response_summary_json` 只能保存 provider、modelId、状态码、耗时、图片数量、错误码等摘要信息。

下载与持久化顺序：

1. Provider Adapter 可以在内存中使用原始 `sourceUrl` 下载结果图片；
2. 原始 `sourceUrl` 只能在任务生命周期内临时存在；
3. 下载完成后保存本地 Asset，再对 `sourceUrl` 做脱敏处理；
4. SQLite、日志、任务摘要和快照只能接触脱敏后的 URL 或 `NULL`。

---

## 9.4 Rust 侧接口概念

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateInput {
    pub task_id: String,
    pub provider: String,
    pub model_id: String,
    pub images: Vec<GenerateInputImage>,
    pub prompt: PromptPayload,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptPayload {
    pub system: Option<String>,
    pub user: String,
    pub negative: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderRuntimeContext {
    pub cancellation_token: CancellationToken,
    pub timeout_policy: TimeoutPolicy,
    pub task_event_emitter: TaskEventEmitter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelMode {
    LocalOnly,
    RemoteRequested,
    RemoteConfirmed,
    RemoteNotSupported,
    RemoteFailed,
}

#[async_trait::async_trait]
pub trait ImageGenerationProvider {
    fn provider_name(&self) -> &'static str;

    async fn generate(
        &self,
        input: GenerateInput,
        api_key: String,
        ctx: ProviderRuntimeContext,
    ) -> Result<GenerateResult, ProviderError>;
}
```

说明：`CancelMode` 的序列化值必须与 SQLite `cancel_mode` CHECK 约束保持一致，例如 `RemoteConfirmed` 持久化为 `remote_confirmed`。

---

## 9.5 Provider 类型

```text
providers/
├── mod.rs
├── openai_provider.rs
├── replicate_provider.rs
├── fal_provider.rs
└── stability_provider.rs
```

第一阶段只需要实现一个真实固定 Provider。`custom_provider.rs` 不进入 MVP，避免在端到端闭环完成前引入通用 API 编排复杂度。

---

# 10. 本地任务状态机

## 10.1 任务状态

```ts
type LocalTaskStatus =
  | "idle"
  | "validating"
  | "preparing"
  | "calling_model"
  | "waiting_result"
  | "downloading_result"
  | "succeeded"
  | "failed"
  | "cancelled";
```

---

## 10.2 状态流转

```text
idle
  ↓
validating
  ↓
preparing
  ↓
calling_model
  ↓
waiting_result
  ↓
downloading_result
  ↓
succeeded

任意执行中状态
  ↓
failed

用户主动取消
  ↓
cancelled
```

---

## 10.3 阶段说明

| 状态                 | 说明                     |
| ------------------ | ---------------------- |
| validating         | 校验组合、模型、Prompt、API Key |
| preparing          | 读取图片、构造请求、解析 Prompt    |
| calling_model      | 发起第三方 API 请求           |
| waiting_result     | 等待第三方 API 返回或轮询        |
| downloading_result | 下载远端结果图并保存本地           |
| succeeded          | 任务完成                   |
| failed             | 任务失败                   |
| cancelled          | 用户取消                   |

---

## 10.4 进度策略

第三方模型通常不保证真实进度，因此第一阶段采用阶段式进度。

```ts
const statusProgressMap: Record<LocalTaskStatus, number> = {
  idle: 0,
  validating: 5,
  preparing: 15,
  calling_model: 35,
  waiting_result: 70,
  downloading_result: 90,
  succeeded: 100,
  failed: 100,
  cancelled: 100,
};
```

UI 上要标注为：

```text
阶段进度
```

避免让用户误解为模型真实推理进度。

---

## 10.5 任务对象

```ts
type LocalGenerationTask = {
  id: string;
  combinationId?: string;

  provider: ModelProvider;
  modelId: string;

  status: LocalTaskStatus;
  progress: number;
  message?: string;

  requestSummaryJson?: unknown;
  responseSummaryJson?: unknown;

  inputSnapshotJson: TaskInputSnapshot;
  finalPromptSnapshotJson: FinalPromptSnapshot;
  modelConfigSnapshotJson: ModelConfigSnapshot;
  assetSnapshotJson: AssetSnapshot[];

  resultImageIds: string[];

  cancelMode?: CancelMode;

  errorCode?: string;
  errorMessage?: string;
  errorDetail?: string;

  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type FinalPromptSnapshot = {
  system?: string;
  user: string;
  negative?: string;
  variables: Record<string, string>;
  templateIds: {
    system?: string;
    user?: string;
    negative?: string;
  };
  modes: {
    system: PromptOverrideMode;
    user: PromptOverrideMode;
    negative?: PromptOverrideMode;
  };
  resolverVersion: string;
  resolvedAt: string;
};

type TaskInputSnapshot = {
  combinationId?: string;
  combinationName?: string;
  personImageId?: string;
  garmentImages: {
    imageId: string;
    view: GarmentView;
    sortOrder: number;
    isPrimary?: boolean;
  }[];
  modelConfigId?: string;
  promptBindingId?: string;
  capturedAt: string;
};

type ModelConfigSnapshot = {
  provider: ModelProvider;
  modelId: string;
  displayName: string;
  params: Record<string, unknown>;
  modelDefinitionId: string;
  modelDefinitionVersion: string;
  capabilities: ModelDefinition["capabilities"];
  inputLimits: ModelDefinition["inputLimits"];
  output: ModelDefinition["output"];
  capturedAt: string;
};

type AssetSnapshot = {
  assetId: string;
  role: "person" | "garment" | "reference" | "mask" | "result";
  view?: GarmentView;
  sortOrder?: number;
  isPrimary?: boolean;

  fileName: string;
  storageRelativePath: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  sha256?: string;
  capturedAt: string;
};
```

说明：

1. `TaskInputSnapshot` 保存组合语义状态，用于表达“当时选了哪些图、顺序是什么、主参考图是哪张”；
2. `ModelConfigSnapshot` 保存模型与参数快照，避免后续模型定义升级后影响历史任务复现；
3. `AssetSnapshot.storageRelativePath` 只能保存工作区内相对路径，例如 `assets/input/person/asset_xxx.png`，不得保存用户导入前的完整本地路径；
4. `AssetSnapshot` 不保存图片 base64；
5. 结果图引用以 `generation_task_results` 为结构化事实来源，`assetSnapshotJson` 主要用于审计展示与输入复现；
6. 输入图引用必须同时写入 `generation_task_input_assets`，不得依赖扫描 `assetSnapshotJson` 判断删除约束。

---

## 10.6 AppState 与任务生命周期

Rust 层必须维护应用级运行态，避免异步任务、取消请求和窗口生命周期互相脱节。

推荐结构：

```rust
pub struct AppState {
    pub db: AppDb,
    pub task_runner: TaskRunner,
    pub cancellation_tokens: std::sync::Mutex<
        std::collections::HashMap<String, CancellationToken>
    >,
}
```

要求：

1. `start_generation` 创建任务并进入执行前，必须把 `taskId -> CancellationToken` 写入 `AppState.cancellation_tokens`；
2. `cancel_generation_task` 只能通过 `AppState` 查找 token 并触发取消，不得在前端保存取消句柄；
3. 任务进入 `succeeded / failed / cancelled` 后，必须从 `cancellation_tokens` 移除 token；
4. 应用启动时必须扫描 `validating / preparing / calling_model / waiting_result / downloading_result` 状态的历史任务，并统一置为 `failed`；
5. 启动恢复写入错误码 `APP_UNEXPECTED_SHUTDOWN`，提示用户上次应用退出时任务未完成；
6. 窗口关闭时如果存在运行中任务，应先提示用户；如果用户确认退出或进程异常退出，下次启动恢复逻辑必须兜底清理孤儿任务；
7. Provider 不支持远端取消时，本地关闭只能停止本地等待和状态更新，UI 必须提示第三方任务可能仍在执行并产生费用。

---

# 11. 本地事件推送

Tauri Rust 层执行任务时，通过事件向前端推送状态。

## 11.1 事件名称

```text
generation://task-created
generation://task-updated
generation://task-finished
generation://task-failed
generation://task-cancelled
```

---

## 11.2 前端监听

```ts
import { listen } from "@tauri-apps/api/event";

listen<LocalGenerationTask>("generation://task-updated", (event) => {
  const task = event.payload;
  useTaskStore.getState().upsertTask(task);
});
```

---

## 11.3 Rust 侧推送概念

```rust
app.emit("generation://task-updated", task)?;
```

---

## 11.4 事件丢失兜底

Tauri event 是状态推送，不是任务状态的唯一来源。前端 WebView 未 ready、页面刷新或监听器重建时可能错过事件。

前端要求：

1. 应用启动后主动调用 `list_running_generation_tasks` 或 `list_recent_generation_tasks` 拉取当前任务状态；
2. 进入组合详情或任务历史面板时主动调用 `get_generation_task / list_generation_tasks_by_combination` 刷新；
3. Event listener 只做增量更新，不能替代主动拉取；
4. 收到事件后如果本地任务缓存缺失，应调用 `get_generation_task` 补齐完整状态。

---

# 12. 本地存储设计

## 12.1 工作区目录

```text
fashion-ai-workspace/
├── workspace.db
├── assets/
│   ├── input/
│   │   ├── person/
│   │   └── garment/
│   ├── output/
│   └── cache/
├── logs/
└── exports/
```

---

## 12.2 文件命名规则

建议导入图片后按 hash 或 UUID 重命名，避免重名冲突。

```text
assets/input/person/asset_01J9XX.png
assets/input/garment/asset_01J9XY.webp
assets/output/result_01J9XZ.png
```

Asset 表记录原始文件名。

---

## 12.3 SQLite 初始化原则

SQLite 连接初始化必须执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

设计原则：

1. 所有关键引用必须声明外键；
2. 图片二进制、base64、完整请求体不得写入 SQLite；
3. 任务历史必须依赖快照字段保证可追溯；
4. 结果图引用必须结构化保存，不应只塞在 `result_json`；
5. 历史任务应尽量保留，即使组合被删除，也不应破坏任务审计。

连接池策略：

1. MVP 阶段写操作使用单 writer 连接，`max_connections = 1`；
2. 所有会修改 SQLite 的 command 必须走 writer 连接，避免多个 Tauri async command 并发写入造成锁竞争；
3. 读操作可以先复用同一个 pool，后续数据量增大后再拆 reader pool；
4. `busy_timeout = 5000` 只作为锁等待兜底，不能替代事务边界和单 writer 策略。

---

## 12.4 SQLite 表结构

### assets

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('person', 'garment', 'result', 'reference', 'mask')),
  file_name TEXT NOT NULL,
  storage_relative_path TEXT NOT NULL,
  thumbnail_relative_path TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_sha256 ON assets(sha256);
```

### image_combinations

```sql
CREATE TABLE image_combinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  person_image_id TEXT,
  model_config_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY(person_image_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY(model_config_id) REFERENCES model_configs(id) ON DELETE SET NULL
);
```

### image_combination_items

```sql
CREATE TABLE image_combination_items (
  id TEXT PRIMARY KEY,
  combination_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('garment', 'reference', 'mask')),
  view_type TEXT,
  sort_order INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY(combination_id) REFERENCES image_combinations(id) ON DELETE CASCADE,
  FOREIGN KEY(image_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_combination_items_combination_id ON image_combination_items(combination_id);
CREATE INDEX idx_combination_items_image_id ON image_combination_items(image_id);
```

### prompt_templates

```sql
CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('system', 'user', 'negative')),
  content TEXT NOT NULL,
  variables_json TEXT,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### prompt_bindings

`prompt_bindings` 保存当前组合的编辑态配置，不承担历史版本职责。历史追溯由 `generation_tasks.final_prompt_snapshot_json` 保证。

重要约束：`prompt_bindings.combination_id UNIQUE` 是组合到 PromptBinding 的唯一结构化关系。`image_combinations` 不再保存 `prompt_binding_id`，避免与 `prompt_bindings.combination_id` 形成循环外键。

```sql
CREATE TABLE prompt_bindings (
  id TEXT PRIMARY KEY,
  combination_id TEXT NOT NULL UNIQUE,

  system_mode TEXT NOT NULL,
  system_base_template_id TEXT,
  system_append_text TEXT,
  system_override_text TEXT,

  user_mode TEXT NOT NULL,
  user_base_template_id TEXT,
  user_append_text TEXT,
  user_override_text TEXT,

  negative_mode TEXT,
  negative_base_template_id TEXT,
  negative_append_text TEXT,
  negative_override_text TEXT,

  variables_json TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY(combination_id) REFERENCES image_combinations(id) ON DELETE CASCADE,
  FOREIGN KEY(system_base_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,
  FOREIGN KEY(user_base_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,
  FOREIGN KEY(negative_base_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL
);
```

### model_configs

```sql
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### generation_tasks

任务表不保存完整真实请求体，只保存脱敏摘要和不可变快照。

```sql
CREATE TABLE generation_tasks (
  id TEXT PRIMARY KEY,
  combination_id TEXT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,

  status TEXT NOT NULL CHECK (
    status IN (
      'idle',
      'validating',
      'preparing',
      'calling_model',
      'waiting_result',
      'downloading_result',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),
  progress INTEGER NOT NULL,
  message TEXT,

  request_summary_json TEXT,
  response_summary_json TEXT,

  input_snapshot_json TEXT NOT NULL,
  final_prompt_snapshot_json TEXT NOT NULL,
  model_config_snapshot_json TEXT NOT NULL,
  asset_snapshot_json TEXT NOT NULL,

  cancel_mode TEXT CHECK (
    cancel_mode IS NULL OR cancel_mode IN (
      'local_only',
      'remote_requested',
      'remote_confirmed',
      'remote_not_supported',
      'remote_failed'
    )
  ),

  error_code TEXT,
  error_message TEXT,
  error_detail TEXT,

  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY(combination_id) REFERENCES image_combinations(id) ON DELETE SET NULL
);

CREATE INDEX idx_generation_tasks_status ON generation_tasks(status);
CREATE INDEX idx_generation_tasks_created_at ON generation_tasks(created_at);
CREATE INDEX idx_generation_tasks_combination_created_at
  ON generation_tasks(combination_id, created_at DESC);
CREATE UNIQUE INDEX idx_generation_tasks_single_running
  ON generation_tasks((1))
  WHERE status IN ('validating', 'preparing', 'calling_model', 'waiting_result', 'downloading_result');
```

单任务并发约束：

1. MVP 阶段只能有一个运行中任务；
2. `start_generation` 必须在同一个事务内检查运行中任务、创建任务、写入任务输入资产引用；
3. Rust 进程内使用 `Mutex` 或等效单飞机制避免同进程重复点击并发进入；
4. SQLite partial unique index 作为最终兜底，防止多窗口或异常并发绕过应用层检查。

`request_summary_json` 允许保存：

```text
provider、modelId、params、图片数量、assetId、mimeType、width、height、fileSize、sha256、Prompt 长度、请求耗时。
```

禁止保存：

```text
图片 base64、API Key、完整鉴权 Header、完整本地敏感路径、未经脱敏的真实请求体。
```

### generation_task_results

```sql
CREATE TABLE generation_task_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY(task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_task_results_task_id ON generation_task_results(task_id);
CREATE INDEX idx_task_results_asset_id ON generation_task_results(asset_id);
```

`source_url` 存储要求：

1. 仅保存脱敏后的结果来源 URL；
2. 带签名、token、临时凭证或无法判断敏感性的 URL 不得入库；
3. Provider Adapter 可以先使用原始 URL 完成下载，但原始 URL 不得持久化；
4. 不依赖 `source_url` 做结果复现，结果复现以本地 `asset_id` 和任务快照为准。

### generation_task_input_assets

任务输入图片引用必须结构化保存，不能依赖扫描 `generation_tasks.asset_snapshot_json`。

```sql
CREATE TABLE generation_task_input_assets (
  task_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('person', 'garment', 'reference', 'mask')),
  view_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,

  PRIMARY KEY (task_id, asset_id, role, sort_order),
  FOREIGN KEY(task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_task_input_assets_task_id ON generation_task_input_assets(task_id);
CREATE INDEX idx_task_input_assets_asset_id ON generation_task_input_assets(asset_id);
```

写入规则：

1. `start_generation` 创建任务时，必须将人物图和服装图写入该表；
2. `retry_generation_task` 使用原任务快照时，必须复制原任务的输入资产引用到新任务；
3. `delete_asset` 判断历史输入引用时，只查询该表，不扫描 JSON；
4. 该表是删除保护和历史输入追溯的结构化事实来源。

---

## 12.5 数据库迁移策略

迁移策略必须在 M2 前落地。

推荐：

```text
sqlx migrate / refinery 二选一
```

要求：

1. 每个迁移文件单调递增；
2. 应用启动时自动执行 pending migrations；
3. 禁止运行时散落 `ALTER TABLE`；
4. `workspace.db` 记录 schema version；
5. 迁移前可选备份 `workspace.db`；
6. MVP 不支持自动降级回滚，只支持升级迁移；
7. 迁移失败时阻止打开工作区，并提示用户备份数据库。

示例：

```text
src-tauri/migrations/
├── 0001_init.sql
├── 0002_add_task_snapshots.sql
├── 0003_add_asset_thumbnail.sql
└── 0004_add_task_results.sql
```

---

# 13. Tauri Command 设计

## 13.1 图片资源

### import_image

```ts
invoke<Asset>("import_image", {
  filePath: string,
  assetType: "person" | "garment" | "reference"
});
```

职责：

1. 校验文件是否存在；
2. 校验格式；
3. 计算 sha256；
4. 复制到 workspace assets；
5. 读取图片宽高；
6. 写入 assets 表；
7. 返回 Asset。

路径要求：

1. `assets.storage_relative_path` 只保存工作区内相对路径，例如 `assets/input/person/asset_01J9XX.png`；
2. `assets.thumbnail_relative_path` 只保存工作区内相对路径；
3. 用户导入前的原始完整本地路径只允许在本次 command 调用内使用，不得写入 SQLite、日志、任务摘要或快照；
4. 返回给前端展示图片时，由 Rust command 按工作区根目录临时解析为可访问资源 URL。

---

### delete_asset

```ts
invoke<void>("delete_asset", {
  assetId: string
});
```

职责：

1. 检查是否被 `image_combinations.person_image_id` 引用；
2. 检查是否被 `image_combination_items.image_id` 引用；
3. 检查是否被 `generation_task_input_assets.asset_id` 引用；
4. 检查是否被 `generation_task_results.asset_id` 引用；
5. 默认禁止删除仍被组合、历史任务输入或历史任务结果引用的资源；
6. 对未被引用资源，先在事务内删除 assets 记录；
7. 事务提交后再删除工作区文件和缩略图；
8. 对强制删除能力，MVP 阶段不开放，避免破坏任务历史。

实现要求：

```sql
SELECT 1 FROM image_combinations WHERE person_image_id = ? LIMIT 1;
SELECT 1 FROM image_combination_items WHERE image_id = ? LIMIT 1;
SELECT 1 FROM generation_task_input_assets WHERE asset_id = ? LIMIT 1;
SELECT 1 FROM generation_task_results WHERE asset_id = ? LIMIT 1;
```

不得通过扫描 `generation_tasks.asset_snapshot_json` 判断引用关系。

原子性要求：

1. 不允许先删除文件再删除数据库记录；
2. 数据库删除失败时，文件必须保持原状；
3. 数据库删除提交成功后，如果文件删除失败，不回滚数据库；
4. 文件删除失败必须写入结构化日志，并由后续轻量 GC 清理未被数据库引用的孤儿文件；
5. 资源库列表以 SQLite 为准，孤儿文件不应重新出现在资源库中。

孤儿文件 GC：

1. 应用启动后可以执行一次轻量 GC；
2. 用户打开资源库页面时可以触发轻量 GC；
3. GC 只允许扫描工作区 `assets/` 和 `cache/` 目录；
4. GC 删除保护只以结构化表为准，包括 `assets.storage_relative_path` 和 `assets.thumbnail_relative_path`；
5. 任务快照中的 `AssetSnapshot.storageRelativePath` 只用于审计展示，不作为 GC 删除保护事实来源；
6. GC 只能删除结构化表中不存在引用的文件；
7. GC 不得扫描或删除用户导入前的原始文件路径。

---

## 13.2 图片组合

### save_image_combination

```ts
invoke<ImageCombination>("save_image_combination", {
  combination: ImageCombination
});
```

保存语义：

1. `save_image_combination` 必须在事务中保存组合主记录和 `image_combination_items`；
2. MVP 采用全量替换 items 策略：先删除当前组合旧 items，再按请求中的 `garmentImages` 重建；
3. 写入前必须校验 item 的 `imageId` 存在，且 asset 类型与 role 匹配；
4. 如果同一组合内出现重复 `sortOrder`，必须返回 `VALIDATION_ERROR`，不得自动猜测排序。

---

### get_image_combination

```ts
invoke<ImageCombination>("get_image_combination", {
  combinationId: string
});
```

---

### list_image_combinations

```ts
invoke<ImageCombination[]>("list_image_combinations");
```

### validate_combination

```ts
invoke<CombinationValidationResult>("validate_combination", {
  combinationId: string,
  draftCombination?: ImageCombination,
  draftPromptBinding?: PromptBinding,
  draftModelConfig?: ModelConfig,
  revision: number
});
```

职责：

1. 统一完成组合、模型、Prompt、API Key、运行中任务校验；
2. 内部调用 Rust `PromptResolver` 生成最终 Prompt；
3. 返回动态图片数量限制、Prompt 预览、错误原因和警告；
4. 作为 `ExecuteNode.canExecute` 的唯一权威来源。

---

## 13.3 Prompt

### save_prompt_binding

```ts
invoke<PromptBinding>("save_prompt_binding", {
  binding: PromptBinding
});
```

---

### preview_resolved_prompt

```ts
invoke<ResolvedPrompt>("preview_resolved_prompt", {
  combinationId: string,
  draftPromptBinding?: PromptBinding,
  draftModelConfig?: ModelConfig,
  revision?: number
});
```

返回：

```ts
type ResolvedPrompt = {
  revision?: number;
  system?: string;
  user: string;
  negative?: string;
  warnings: string[];
};
```

说明：

1. `preview_resolved_prompt` 只用于纯 Prompt 面板预览；
2. 执行按钮状态、Prompt 长度限制和错误原因必须以 `validate_combination` 为准；
3. 如果调用方已有 `validate_combination` 返回的 `resolvedPrompt`，不需要再额外调用 `preview_resolved_prompt`。

---

## 13.4 模型配置

### list_model_definitions

```ts
invoke<ModelDefinition[]>("list_model_definitions");
```

说明：MVP 阶段该 command 从 Rust 内置 `ModelDefinitionRegistry` 返回模型定义，不读取 SQLite，不允许用户编辑模型定义。

---

### save_model_config

```ts
invoke<ModelConfig>("save_model_config", {
  config: ModelConfig
});
```

---

## 13.5 API Key

### set_provider_api_key

```ts
invoke<void>("set_provider_api_key", {
  provider: ModelProvider,
  apiKey: string
});
```

---

### get_provider_credential_status

```ts
invoke<ProviderCredentialStatus>("get_provider_credential_status", {
  provider: ModelProvider
});
```

返回：

```ts
type ProviderCredentialStatus = {
  provider: ModelProvider;
  configured: boolean;
  maskedKey?: string;
};
```

---

## 13.6 生图任务

### start_generation

```ts
invoke<LocalGenerationTask>("start_generation", {
  combinationId: string
});
```

职责：

1. 加载组合；
2. 加载模型配置；
3. 加载 Prompt Binding；
4. 解析最终 Prompt；
5. 校验模型能力；
6. 读取 API Key；
7. 创建任务输入快照、Prompt 快照、模型参数快照、Asset 快照；
8. 创建 generation_task；
9. 启动异步任务；
10. 返回任务对象。

原子性要求：

1. `start_generation` 必须重新执行完整服务端校验，不得信任前端缓存的 `canExecute`；
2. 检查运行中任务、创建任务、写入 `generation_task_input_assets` 必须处于同一个数据库事务；
3. 如果 SQLite partial unique index 返回冲突，统一转换为 `VALIDATION_ERROR`，提示当前已有任务运行中；
4. 任务创建成功但异步执行启动失败时，必须将任务更新为 `failed` 并保存错误原因，不得留下永久运行中的脏状态。

---

### get_generation_task

```ts
invoke<LocalGenerationTask>("get_generation_task", {
  taskId: string
});
```

---

### list_running_generation_tasks

```ts
invoke<LocalGenerationTask[]>("list_running_generation_tasks");
```

用途：前端启动后主动拉取当前运行中任务，弥补 Tauri event 可能丢失的问题。

---

### list_recent_generation_tasks

```ts
invoke<LocalGenerationTask[]>("list_recent_generation_tasks", {
  limit?: number
});
```

用途：前端启动后主动拉取最近任务，展示启动恢复时被置为 `failed / APP_UNEXPECTED_SHUTDOWN` 的历史任务。该 command 必须按 `updated_at DESC` 返回，默认 `limit = 20`。普通任务历史仍可按 `created_at DESC` 展示。

---

### list_generation_tasks_by_combination

```ts
invoke<LocalGenerationTask[]>("list_generation_tasks_by_combination", {
  combinationId: string,
  limit?: number
});
```

用途：组合详情和任务历史面板按组合加载最近任务。该查询必须使用 `idx_generation_tasks_combination_created_at`。

---

### cancel_generation_task

```ts
invoke<void>("cancel_generation_task", {
  taskId: string
});
```

取消语义必须区分：

| 类型 | 含义 |
| --- | --- |
| 本地取消 | 停止本地等待、轮询、下载或状态更新 |
| 远端取消 | 调用第三方 Provider 的取消接口撤回远端任务 |

如果 Provider 不支持远端取消，任务状态仍可进入 `cancelled`，但 `cancelMode` 应记录为 `remote_not_supported`，UI 必须提示：

```text
已停止本地等待，但第三方任务可能仍在执行并产生费用。
```

---

### retry_generation_task

```ts
invoke<LocalGenerationTask>("retry_generation_task", {
  taskId: string
});
```

语义：使用原任务的不可变快照重试。

适用场景：

* 网络失败；
* Provider 超时；
* 下载结果失败；
* 本地保存结果失败。

不得使用当前组合的最新 Prompt 或最新模型参数替代旧快照。

重试前检查：

1. 读取原任务 `assetSnapshotJson` 和 `generation_task_input_assets`；
2. 按 `storageRelativePath` 解析工作区内文件路径；
3. 如果任一输入文件缺失，直接返回 `ASSET_FILE_MISSING`；
4. 缺失文件错误应指明 assetId、原始 fileName 和角色，避免用户只看到 Provider 调用失败。

---

### rerun_generation_from_current_combination

```ts
invoke<LocalGenerationTask>("rerun_generation_from_current_combination", {
  combinationId: string
});
```

语义：使用当前组合的最新图片、Prompt、模型配置重新执行。

适用场景：

* 用户修改 Prompt 后重新生成；
* 用户替换衣服图后重新生成；
* 用户切换模型后重新生成。

---

# 14. 前端模块结构

```text
src/
├── app/
│   ├── App.tsx
│   ├── routes.tsx
│   └── layout/
│
├── features/
│   ├── workflow/
│   │   ├── components/
│   │   │   ├── WorkflowCanvas.tsx
│   │   │   ├── nodes/
│   │   │   │   ├── PersonInputNode.tsx
│   │   │   │   ├── GarmentGroupNode.tsx
│   │   │   │   ├── PromptConfigNode.tsx
│   │   │   │   ├── ModelSelectNode.tsx
│   │   │   │   ├── ExecuteNode.tsx
│   │   │   │   └── ResultNode.tsx
│   │   │   └── edges/
│   │   ├── store/
│   │   │   └── workflowStore.ts
│   │   └── model/
│   │       └── workflowTypes.ts
│   │
│   ├── assets/
│   │   ├── components/
│   │   ├── services/
│   │   └── model/
│   │
│   ├── prompt/
│   │   ├── components/
│   │   ├── services/
│   │   └── model/
│   │
│   ├── model-config/
│   │   ├── components/
│   │   ├── services/
│   │   └── model/
│   │
│   ├── license/
│   │   ├── components/
│   │   │   └── LicenseActivationPanel.tsx
│   │   ├── services/
│   │   ├── store/
│   │   └── model/
│   │
│   └── generation-task/
│       ├── components/
│       ├── services/
│       ├── store/
│       └── model/
│
├── shared/
│   ├── components/
│   ├── hooks/
│   ├── utils/
│   └── tauri/
│
└── main.tsx
```

---

# 15. Rust 模块结构

```text
src-tauri/src/
├── main.rs
├── state.rs
│
├── commands/
│   ├── mod.rs
│   ├── assets.rs
│   ├── combinations.rs
│   ├── prompts.rs
│   ├── models.rs
│   ├── credentials.rs
│   ├── license.rs
│   └── generation.rs
│
├── domain/
│   ├── mod.rs
│   ├── asset.rs
│   ├── combination.rs
│   ├── prompt.rs
│   ├── model.rs
│   ├── license.rs
│   └── task.rs
│
├── storage/
│   ├── mod.rs
│   ├── sqlite.rs
│   ├── file_store.rs
│   └── migrations.rs
│
├── providers/
│   ├── mod.rs
│   ├── provider_trait.rs
│   ├── openai_provider.rs
│   ├── replicate_provider.rs
│   └── fal_provider.rs
│
├── services/
│   ├── mod.rs
│   ├── prompt_resolver.rs
│   ├── model_validator.rs
│   ├── license_client.rs
│   ├── task_runner.rs
│   ├── image_inspector.rs
│   └── credential_service.rs
│
└── error/
    ├── mod.rs
    └── app_error.rs
```

---

# 16. 主流程设计

## 16.1 导入图片流程

```text
用户拖入图片
    ↓
React 调用 import_image
    ↓
Rust 校验文件
    ↓
复制到 workspace/assets/input
    ↓
读取宽高、mime、size、sha256
    ↓
写入 assets 表
    ↓
返回 Asset
    ↓
前端更新资源库与当前组合
```

---

## 16.2 编辑图片组合流程

```text
用户选择人物图
    ↓
绑定到 ImageCombination.personImageId
    ↓
用户选择多张衣服图
    ↓
写入 image_combination_items
    ↓
用户设置视角 front / side / back / detail
    ↓
组合状态重新校验
    ↓
ExecuteNode 更新为可执行 / 不可执行
```

---

## 16.3 Prompt 配置流程

```text
用户打开 Prompt 节点
    ↓
选择 default / append / override
    ↓
编辑 System Prompt 补充或替换
    ↓
编辑 User Prompt 补充或替换
    ↓
编辑 Negative Prompt
    ↓
自动触发校验或点击预览最终 Prompt
    ↓
前端调用 validate_combination 或 preview_resolved_prompt
    ↓
Rust PromptResolver 解析模板变量
    ↓
展示最终发给模型的 Prompt
```

---

## 16.4 模型选择流程

```text
用户打开模型节点
    ↓
选择 Provider
    ↓
选择模型
    ↓
动态渲染参数表单
    ↓
检查 API Key 是否配置
    ↓
保存 ModelConfig
    ↓
组合状态重新校验
```

---

## 16.5 执行生成流程

```text
用户点击执行
    ↓
start_generation(combinationId)
    ↓
Rust 加载组合、图片、模型、Prompt
    ↓
校验输入合法性
    ↓
读取 API Key
    ↓
创建 input / prompt / model / asset 快照
    ↓
创建 generation_task
    ↓
emit task-updated: validating
    ↓
解析 Prompt
    ↓
emit task-updated: preparing
    ↓
调用 Provider Adapter
    ↓
emit task-updated: calling_model
    ↓
等待 API 返回或轮询
    ↓
emit task-updated: waiting_result
    ↓
下载结果图到 assets/output
    ↓
emit task-updated: downloading_result
    ↓
保存结果 Asset 和 task result
    ↓
emit task-finished: succeeded
    ↓
前端 ResultNode 展示结果
```

---

## 16.6 应用启动恢复流程

```text
应用启动
    ↓
初始化 SQLite + 执行 migrations
    ↓
扫描运行中任务状态
    ↓
将历史运行中任务置为 failed / APP_UNEXPECTED_SHUTDOWN
    ↓
前端主动拉取 running tasks / recent tasks
    ↓
恢复任务历史面板和组合详情状态
```

说明：

1. 运行中状态包括 `validating / preparing / calling_model / waiting_result / downloading_result`；
2. 启动恢复必须先于允许用户点击执行；
3. 恢复后的失败任务必须释放 `idx_generation_tasks_single_running` 约束；
4. 如果第三方任务可能仍在远端执行，UI 需要提示用户上次退出可能没有取消远端任务。

---

## 16.7 应用关闭流程

```text
用户关闭窗口
    ↓
Rust 检查是否存在运行中任务
    ↓
存在运行中任务则提示用户
    ↓
用户取消关闭：继续执行
用户确认关闭：触发本地取消并退出
    ↓
下次启动通过恢复流程兜底清理未完成任务
```

说明：

1. 关闭提示不保证远端任务一定取消成功；
2. 支持远端取消的 Provider 应尽量请求远端取消；
3. 不支持远端取消的 Provider 必须记录 `remote_not_supported`；
4. 进程崩溃或系统强杀无法执行关闭流程，因此启动恢复是必须兜底。

---

# 17. 错误处理设计

## 17.1 错误分类

```ts
type AppErrorCode =
  | "VALIDATION_ERROR"
  | "ASSET_NOT_FOUND"
  | "ASSET_FILE_MISSING"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "IMAGE_TOO_LARGE"
  | "PROMPT_TOO_LONG"
  | "PROMPT_TEMPLATE_INVALID"
  | "MODEL_NOT_SELECTED"
  | "MODEL_CAPABILITY_MISMATCH"
  | "API_KEY_NOT_CONFIGURED"
  | "API_KEY_INVALID"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_CONTENT_REJECTED"
  | "PROVIDER_UNKNOWN_ERROR"
  | "NETWORK_ERROR"
  | "SAVE_RESULT_FAILED"
  | "APP_UNEXPECTED_SHUTDOWN"
  | "TASK_CANCELLED";
```

---

## 17.2 UI 展示策略

| 错误          | UI 处理              |
| ----------- | ------------------ |
| 缺图片         | ExecuteNode 显示缺少输入 |
| API Key 未配置 | 跳转到模型设置            |
| Prompt 超长   | Prompt 面板高亮        |
| 模型不支持多图     | 模型节点警告             |
| 第三方限流       | 显示稍后重试             |
| 第三方内容拒绝     | 显示模型返回原因           |
| 网络超时        | 支持重试               |
| 保存结果失败      | 提示本地磁盘或权限问题        |
| 输入文件缺失      | 提示重新绑定或重新导入对应图片     |
| 上次异常退出      | 标记旧任务失败，允许用户重新执行    |

---

## 17.3 失败任务保存

失败任务也必须保存：

```text
generation_tasks.status = failed
generation_tasks.error_code = ...
generation_tasks.error_message = ...
generation_tasks.error_detail = ...
```

这样用户可以：

* 查看失败历史；
* 修改 Prompt 后重试；
* 更换模型后重试；
* 导出错误日志。

---

# 18. 安全设计

## 18.1 API Key 安全

要求：

1. API Key 不进入前端持久化；
2. API Key 不写入 SQLite；
3. API Key 不写入工作流文件；
4. API Key 不出现在日志；
5. 前端只展示脱敏值；
6. 第三方请求只由 Rust 层发起。

示例脱敏：

```text
sk-****-****-abcd
```

---

## 18.2 Prompt 与图片隐私

由于调用第三方 API，必须在 UI 明确提示：

```text
执行生成时，所选图片和 Prompt 将发送至当前选择的第三方模型服务商。
```

这不是后端架构问题，而是产品可信度问题。

---

## 18.3 日志脱敏

日志中禁止记录：

* 完整 API Key；
* 图片 base64；
* 用户本地完整敏感路径；
* 第三方完整鉴权请求头。

可以记录：

* provider；
* modelId；
* taskId；
* 错误码；
* 请求耗时；
* 图片数量；
* Prompt 长度。

同样约束适用于 `generation_tasks.request_summary_json`。任务表只能保存脱敏摘要，不得保存完整 base64 图片请求体。

---

## 18.4 Tauri 安全配置

MVP 阶段必须显式配置 Tauri 安全边界，避免桌面端能力被前端或第三方内容误用。

要求：

1. Tauri command capability 采用最小授权，只暴露当前业务需要的 command；
2. 文件系统 scope 只允许访问当前工作区、导入文件选择结果和应用必要目录；
3. 禁止前端直接持久化或读取 API Key，密钥读写只能走 Rust command；
4. CSP 禁止加载非必要远程脚本，结果图片展示优先使用本地受控资源 URL；
5. 打开外部链接必须走 Rust 层白名单或显式用户确认；
6. 任何 Provider 返回的 URL 下载前必须重新校验协议、域名解析结果和跳转目标；
7. 不允许在 WebView 中渲染第三方返回的 HTML。

---

## 18.5 授权激活设计

第一阶段允许新增一个轻量 License Server，但该服务端只负责商业授权，不保存用户图片、Prompt、任务历史和本地工作区数据。

### 18.5.1 设计目标

授权体系需要支持：

1. 创建 License；
2. 查询 License 状态；
3. 激活设备；
4. 解绑设备；
5. 刷新授权 token；
6. 接收支付平台 webhook；
7. 返回套餐功能开关。

### 18.5.2 总体边界

```text
Tauri Desktop App
    │
    │ HTTPS
    ▼
License Server
    ├── License API
    ├── Device Activation API
    ├── Token Refresh API
    ├── Entitlement API
    └── Payment Webhook API
```

边界原则：

1. License Server 不接收、不存储用户导入图片、生成结果、Prompt 内容和工作区数据库；
2. 客户端只上传激活码、设备指纹摘要、应用版本和必要诊断信息；
3. License Server 返回短期 `licenseToken` 和套餐功能开关；
4. 客户端按功能开关控制本地 UI、执行入口和模型能力上限；
5. 授权失败不得破坏本地工作区数据，只禁用受限功能。

### 18.5.3 License 状态

```ts
type LicenseStatus =
  | "inactive"
  | "active"
  | "expired"
  | "revoked"
  | "suspended";

type LicensePlan =
  | "trial"
  | "standard"
  | "pro"
  | "team";
```

状态语义：

| 状态 | 含义 |
| --- | --- |
| inactive | 已创建但未激活 |
| active | 可正常使用 |
| expired | 已过期 |
| revoked | 已撤销，不允许继续使用 |
| suspended | 因支付失败、风控或人工处理被暂停 |

### 18.5.4 套餐功能开关

```ts
type LicenseEntitlements = {
  plan: LicensePlan;
  features: {
    generation: boolean;
    exportResult: boolean;
    batchGeneration: boolean;
    removeWatermark: boolean;
    advancedModels: boolean;
    customProvider: boolean;
  };
  limits: {
    maxDevices: number;
    maxOutputCount: number;
    maxDailyGenerations?: number;
    maxGarmentImages?: number;
  };
  expiresAt?: string;
};
```

使用原则：

1. `generation=false` 时禁用执行生成；
2. `exportResult=false` 时禁用导出结果；
3. `maxOutputCount` 必须参与 `validate_combination`；
4. `advancedModels=false` 时隐藏或禁用高级模型；
5. `customProvider=false` 时即使第二阶段支持 custom Provider，也不得开放配置入口；
6. 前端展示可用功能，Rust 层仍必须在执行前做授权校验。

### 18.5.5 License Server API

#### 创建 License

```http
POST /v1/licenses
```

用途：后台管理系统或支付成功流程创建 License。

请求：

```ts
type CreateLicenseRequest = {
  plan: LicensePlan;
  customerEmail?: string;
  maxDevices: number;
  expiresAt?: string;
  paymentProvider?: "stripe" | "paddle" | "lemonsqueezy" | "manual";
  paymentCustomerId?: string;
  paymentSubscriptionId?: string;
};
```

响应：

```ts
type CreateLicenseResponse = {
  licenseId: string;
  activationCode: string;
  status: LicenseStatus;
  entitlements: LicenseEntitlements;
};
```

#### 查询 License 状态

```http
GET /v1/licenses/status?activationCode=...
```

响应：

```ts
type LicenseStatusResponse = {
  licenseId: string;
  status: LicenseStatus;
  activatedDeviceCount: number;
  maxDevices: number;
  entitlements: LicenseEntitlements;
};
```

#### 激活设备

```http
POST /v1/licenses/activate
```

请求：

```ts
type ActivateDeviceRequest = {
  activationCode: string;
  deviceFingerprintHash: string;
  deviceName?: string;
  appVersion: string;
  platform: "macos" | "windows" | "linux";
};
```

响应：

```ts
type ActivateDeviceResponse = {
  licenseId: string;
  deviceId: string;
  status: LicenseStatus;
  licenseToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  entitlements: LicenseEntitlements;
};
```

#### 解绑设备

```http
POST /v1/licenses/deactivate-device
```

请求：

```ts
type DeactivateDeviceRequest = {
  licenseToken: string;
  deviceId: string;
};
```

要求：

1. 只能解绑当前 License 下的设备；
2. 用户主动解绑当前设备后，客户端必须清除本地授权 token；
3. 服务端管理员解绑其他设备时，应记录审计日志。

#### 刷新授权 token

```http
POST /v1/licenses/refresh-token
```

请求：

```ts
type RefreshLicenseTokenRequest = {
  refreshToken: string;
  deviceId: string;
  appVersion: string;
};
```

响应：

```ts
type RefreshLicenseTokenResponse = {
  licenseToken: string;
  tokenExpiresAt: string;
  status: LicenseStatus;
  entitlements: LicenseEntitlements;
};
```

#### 返回套餐功能开关

```http
GET /v1/licenses/entitlements
Authorization: Bearer <licenseToken>
```

响应：

```ts
type EntitlementsResponse = {
  licenseId: string;
  deviceId: string;
  status: LicenseStatus;
  entitlements: LicenseEntitlements;
};
```

#### 接收支付平台 webhook

```http
POST /v1/webhooks/payments/{provider}
```

要求：

1. 必须校验支付平台签名；
2. 必须按支付平台事件 ID 做幂等处理；
3. 支付成功时创建或续期 License；
4. 订阅取消、退款、支付失败时更新 License 状态或到期时间；
5. webhook 原始 body 可短期保存用于排障，但不得记录支付密钥。

### 18.5.6 客户端 Tauri Commands

```ts
invoke<ActivateDeviceResponse>("activate_license", {
  activationCode: string
});

invoke<LicenseStatusResponse>("get_license_status");

invoke<void>("deactivate_current_device");

invoke<RefreshLicenseTokenResponse>("refresh_license_token");

invoke<EntitlementsResponse>("get_license_entitlements");
```

客户端职责：

1. 激活界面只收集激活码；
2. Rust 层生成设备指纹摘要并调用 License Server；
3. `licenseToken` 可以存 SQLite 脱敏摘要，真实 token 优先存系统密钥库；
4. `refreshToken` 必须存系统密钥库，不得写入 SQLite、日志或前端状态持久化；
5. 前端只展示授权状态、套餐、到期时间、设备数量和功能开关。

### 18.5.7 客户端本地表

```sql
CREATE TABLE license_state (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  device_id TEXT,
  status TEXT NOT NULL,
  plan TEXT,
  token_expires_at TEXT,
  entitlements_json TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

说明：

1. `license_state` 只保存当前设备授权状态和功能开关缓存；
2. 不保存完整 `licenseToken` 和 `refreshToken`；
3. `entitlements_json` 只用于离线展示和短期离线宽限；
4. 授权状态变化不影响工作区数据完整性。

### 18.5.8 激活界面

入口：应用设置页或首次启动引导。

界面状态：

| 状态 | UI 行为 |
| --- | --- |
| 未激活 | 显示激活码输入框和激活按钮 |
| 激活中 | 禁用按钮，显示等待状态 |
| 已激活 | 显示套餐、到期时间、设备状态、解绑按钮 |
| 已过期 | 禁用生成入口，提示续费或更换激活码 |
| 已撤销/暂停 | 禁用受限功能，提示联系支持 |

### 18.5.9 离线与刷新策略

原则：

1. `licenseToken` 使用短期有效期；
2. 客户端启动时尝试刷新授权 token；
3. 刷新失败但本地 token 未过期时，可继续使用；
4. 可设置短期离线宽限期，例如 72 小时；
5. 超过离线宽限期仍无法刷新时，禁用生成、导出等付费功能；
6. `revoked / suspended` 一旦从服务端同步到本地，不再享受离线宽限。

### 18.5.10 授权安全要求

1. 激活码不得写入日志；
2. 设备指纹必须先 hash 后上传，不上传原始硬件标识；
3. License Server 必须全程 HTTPS；
4. `licenseToken` 建议使用签名 JWT 或 JWS，并包含 `licenseId / deviceId / plan / entitlements / exp`；
5. 客户端必须校验 token 过期时间；
6. 关键功能执行前，Rust 层必须读取本地授权状态和功能开关再次校验；
7. 支付 webhook 必须验证签名和幂等键；
8. 管理后台创建 License 必须有管理员认证和审计日志。

---

# 19. 性能设计

## 19.1 图片预览

前端不要直接加载超大原图作为缩略图。

建议导入时生成缩略图：

```text
assets/cache/thumbs/{assetId}.jpg
```

Asset 表增加：

```sql
ALTER TABLE assets ADD COLUMN thumbnail_relative_path TEXT;
```

---

## 19.2 图片去重

导入时计算 sha256。

如果同一文件已存在：

* 可直接复用已有 Asset；
* 或提示用户是否重复导入。

去重边界：

1. MVP 阶段只在同一 `assets.type` 内按 sha256 去重；
2. 同一张图片分别作为 `person` 和 `garment` 导入时，应创建两个不同 Asset；
3. 跨类型复用会混淆资源库分类、删除保护和任务输入角色，第一阶段不做；
4. `result` 类型图片不与输入图片跨类型去重，保证任务结果审计清晰。

---

## 19.3 并发控制

第一阶段建议：

```text
同一时间只允许 1 个任务运行
```

后续可扩展：

```text
最多 N 个并发任务
```

原因：

* 第三方 API 可能限流；
* 多任务同时上传图片会导致状态复杂；
* 桌面端用户体验更可控。

---

## 19.4 超时策略

建议配置：

| 阶段        |    超时 |
| --------- | ----: |
| 上传 / 请求创建 |  60 秒 |
| 任务轮询      | 10 分钟 |
| 下载结果      | 120 秒 |
| 总任务       | 15 分钟 |

超时后状态置为：

```text
failed / PROVIDER_TIMEOUT
```

---

# 20. UI 设计建议

## 20.1 主界面布局

```text
┌────────────────────────────────────────────────────────────┐
│ 顶部工具栏：新建组合 / 保存 / 模型管理 / Prompt 模板 / 设置 │
├──────────────┬──────────────────────────────┬─────────────┤
│ 左侧资源库    │ 中间工作流画布                 │ 右侧属性面板 │
│              │                              │             │
│ 人物图片      │ [人物图] -> [服装图组]          │ 选中节点属性 │
│ 衣服图片      │     -> [Prompt] -> [模型]       │ Prompt 编辑  │
│ 结果图片      │     -> [执行] -> [结果]         │ 模型参数      │
│              │                              │ 任务状态      │
└──────────────┴──────────────────────────────┴─────────────┘
```

---

## 20.2 执行节点状态

### 不可执行

```text
未满足执行条件
- 缺少人物图片
- 服装图片数量不满足当前模型要求（至少 N 张）
- 未选择模型
```

说明：`N` 必须来自 `validate_combination` 返回的 `derivedLimits.garment.min`，不得写死为 2。

### 可执行

```text
当前组合已就绪
[执行生成]
```

### 执行中

```text
AI 生成中
当前阶段：等待模型返回
阶段进度：70%
已耗时：01:32
[取消]
```

### 失败

```text
生成失败
原因：Provider rate limited
[重试] [修改 Prompt] [切换模型]
```

### 成功

```text
生成完成
结果：3 张
[查看结果] [导出] [再次生成]
```

---

# 21. 配置管理

## 21.1 应用设置

MVP 阶段不暴露 `maxConcurrentTasks`，全局只允许一个运行中任务。并发队列、任务排队和多任务状态同步留到第二阶段。

```ts
type AppSettings = {
  workspacePath: string;
  licenseServerBaseUrl: string;
  defaultProvider?: ModelProvider;
  defaultModelConfigId?: string;
  defaultPromptTemplateIds: {
    system?: string;
    user?: string;
    negative?: string;
  };
  autoSave: boolean;
};
```

---

## 21.2 Provider 设置

```ts
type ProviderSettings = {
  provider: ModelProvider;
  baseUrl?: string;
  timeoutSeconds: number;
  enabled: boolean;
};
```

MVP 阶段只接入固定 Provider，不开放通用 `custom` Provider 配置面板。

原因：

1. 通用 `custom` Provider 会把产品范围扩大成 API 编排器；
2. 请求模板、响应路径和鉴权 Header 会显著增加校验、脱敏和调试复杂度；
3. 用户可配置 Base URL 会引入 SSRF、DNS 重绑定、跳转绕过和本地网络访问风险；
4. 对 MVP 来说，固定接入一个真实 Provider 更容易验证端到端闭环。

第二阶段如果开放 `custom` Provider，才允许配置：

```text
Base URL
鉴权 Header 名称
模型 ID
请求格式模板
响应路径
```

第二阶段 custom Provider 安全限制：

1. 默认只允许 `https://` Base URL；
2. 禁止 `localhost`、`127.0.0.0/8`、`::1`；
3. 禁止 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`；
4. 禁止 `169.254.0.0/16` 链路本地地址；
5. 禁止 `file://`、`ftp://` 等非 HTTP(S) 协议；
6. 禁止自动跟随跳转到私有地址段；
7. 从外部导入 workspace 或 Provider 配置时，必须提示用户确认 Base URL。

开发者本地调试可以通过显式开关允许本地地址，但默认关闭：

```ts
allowInsecureLocalProvider: false
```

---

# 22. 可评审风险点

## 22.1 第三方 API 能力差异风险

风险：

不同模型对多图输入、System Prompt、Negative Prompt、图片格式、返回方式支持不同。

措施：

* 使用 ModelDefinition 描述能力；
* 执行前校验；
* Provider Adapter 独立实现；
* 前端根据能力显示/隐藏配置项。

---

## 22.2 Prompt 不可控风险

风险：

用户替换内置 Prompt 后，生成质量波动明显。

措施：

* 保留内置模板；
* 支持 default / append / override；
* 提供最终 Prompt 预览；
* 给出模板恢复按钮；
* 记录每次任务使用的最终 Prompt。

---

## 22.3 API Key 泄露风险

风险：

桌面端应用容易误把 API Key 写入前端存储或日志。

措施：

* 统一由 Rust 层管理；
* 使用系统密钥库；
* 日志脱敏；
* 前端不持久化 Key；
* 任务 `request_summary_json` 中不得记录 API Key。

---

## 22.4 长任务用户体验风险

风险：

第三方 API 响应慢，用户误以为程序卡死。

措施：

* 本地任务状态机；
* 阶段式进度；
* Tauri event 实时更新；
* 支持取消；
* 支持失败重试；
* 展示耗时。

---

## 22.5 本地文件丢失风险

风险：

用户手动删除 assets 文件，数据库仍引用。

措施：

* 启动时可做轻量巡检；
* 打开组合时检测文件存在；
* 文件缺失时节点显示异常；
* 支持重新绑定图片。

---

## 22.6 草稿态校验滞后风险

风险：

用户已在 UI 中修改图片、Prompt 或模型参数，但变更尚未保存到 SQLite 时，如果 `validate_combination` 只按 `combinationId` 读取数据库，会导致执行按钮状态和最终 Prompt 预览落后于当前界面。

措施：

* 前端采用自动保存策略时，校验前必须确保当前编辑态已落库；
* 前端采用未保存草稿策略时，必须把 `draftCombination / draftPromptBinding / draftModelConfig` 传给 `validate_combination`；
* Rust 返回 `revision`，前端只接受与当前 revision 一致的校验结果；
* `stale` 和 `validating` 状态下禁用执行按钮。

---

## 22.7 SQLite 外键循环与并发风险

风险：

组合表与 PromptBinding 表如果互相保存外键，会形成循环引用；同时单任务并发如果只靠前端按钮禁用，可能被双击、多窗口或异步竞态绕过。

措施：

* 组合到 PromptBinding 的关系只保留 `prompt_bindings.combination_id UNIQUE`；
* `image_combinations` 不保存 `prompt_binding_id`；
* `start_generation` 使用事务和 Rust 进程内单飞机制；
* SQLite partial unique index 兜底限制运行中任务数量。

---

## 22.8 本地路径泄露风险

风险：

如果把用户导入前的完整本地路径写入 SQLite、任务摘要、日志或快照，可能泄露用户名、目录结构和商业素材位置。

措施：

* `assets` 只保存工作区内相对路径；
* `AssetSnapshot.storageRelativePath` 只保存工作区相对路径；
* `request_summary_json` 和日志禁止保存导入前完整路径；
* 前端展示资源时由 Rust 临时解析为受控资源 URL。

---

## 22.9 License 授权绕过与支付回调风险

风险：

激活码、授权 token、设备绑定和支付 webhook 如果处理不当，会导致授权绕过、设备数失控、伪造支付事件或敏感 token 泄露。

措施：

* 激活码、`licenseToken`、`refreshToken` 不得写入日志；
* `refreshToken` 必须存系统密钥库；
* 设备指纹必须 hash 后上传；
* Rust 层在执行生成、导出等关键功能前读取授权状态和功能开关；
* License Server 必须校验支付 webhook 签名和事件幂等键；
* 管理端创建 License 必须有管理员认证和审计日志；
* `revoked / suspended` 状态一旦同步到本地，必须立即禁用受限功能。

---

# 23. MVP 范围

## 23.1 第一版必须交付

| 模块       | 功能                   |
| -------- | -------------------- |
| 桌面框架     | Tauri + React 基础应用   |
| 资源库      | 导入人物图、衣服图、结果图展示      |
| 工作流画布    | 固定节点链路               |
| 图片组合     | 创建、保存、切换组合           |
| Prompt   | 默认、追加、替换、最终预览        |
| 模型       | 模型选择、参数配置、API Key 配置 |
| 授权       | 激活码输入、设备激活、授权状态、套餐功能开关 |
| 任务       | 执行、等待、取消、失败、重试       |
| Provider | 接入至少一个固定第三方生图 API    |
| 结果       | 保存本地、画布展示、打开大图       |
| 历史       | 查看任务历史和失败原因          |

---

## 23.2 第一版暂不交付

| 功能      | 原因      |
| ------- | ------- |
| 任意节点编排  | 复杂度过高   |
| 自定义脚本节点 | 安全风险    |
| 云端同步    | 超出纯桌面边界 |
| 多用户权限   | 无后端时无意义 |
| 云端业务数据存储 | 图片、Prompt、任务历史仍只保存在本地 |
| 批量队列    | 可第二阶段做  |
| 自建模型    | 当前边界不需要 |
| 通用 custom Provider | 安全和调试复杂度高 |
| 复杂图片编辑  | 不是核心目标  |

---

# 24. 里程碑计划

## M1：基础框架

目标：

* Tauri + React + TypeScript 启动；
* React Flow 画布；
* 固定节点渲染；
* 基础 Zustand store；
* 明确 React Flow / Zustand / SQLite 的状态权威边界；
* 应用启动时执行运行中任务恢复；
* 激活界面基础入口和未激活状态展示。

交付：

```text
可打开桌面应用
可看到固定工作流画布
可选中节点
```

---

## M2：本地资源与组合

目标：

* 图片导入；
* assets 目录管理；
* SQLite 初始化；
* SQLite 单 writer 连接策略；
* ImageCombination 保存；
* 同类型 sha256 去重策略；
* `delete_asset` 数据库优先删除与孤儿文件 GC 日志。

交付：

```text
可导入人物图和衣服图
可创建图片组合
可在画布节点中看到图片
```

---

## M3：Prompt 与模型配置

目标：

* Prompt 模板；
* default / append / override；
* 最终 Prompt 预览；
* 模型定义；
* 模型参数表单；
* API Key 配置；
* License Server 基础 API；
* activate / status / refresh / entitlements 客户端命令；
* 执行生成前的授权功能开关校验。

交付：

```text
可选择模型
可配置 Prompt
可预览最终 Prompt
可校验是否可执行
可输入激活码并看到授权状态
```

---

## M4：第三方 API 执行

目标：

* Provider Adapter；
* start_generation；
* AppState + CancellationToken 管理；
* 本地任务状态机；
* Tauri 事件推送；
* 前端启动主动拉取任务状态；
* 结果保存。

交付：

```text
可点击执行
可看到等待状态
可调用第三方模型
可展示生成结果
```

---

## M5：稳定性与评审增强

目标：

* 错误处理；
* 取消任务；
* 重试任务；
* 日志脱敏；
* 文件缺失检测；
* retry 前输入文件存在性检查；
* 任务历史；
* 支付平台 webhook 幂等处理；
* 设备解绑和授权 token 刷新稳定性。

交付：

```text
可用于真实评审和小范围试用
```

---

# 25. 评审修订清单

## 25.1 已采纳的关键修订

| 编号 | 问题 | 处理方式 |
| ---: | --- | --- |
| 1 | Prompt 解析双实现风险 | 统一为 Rust PromptResolver 单权威 |
| 2 | `request_json` 存 base64 导致数据库膨胀 | 改为 `request_summary_json`，禁止保存 base64 |
| 3 | 重试语义不清 | 拆分 `retry_generation_task` 与 `rerun_generation_from_current_combination` |
| 4 | Prompt 历史不可追溯 | 增加 `final_prompt_snapshot_json` |
| 5 | PromptBinding 缺少多版本 | MVP 不做多版本，依赖任务快照追溯历史 |
| 6 | 衣服图数量硬编码 | 改为按 `ModelDefinition.inputLimits` 派生 |
| 7 | 删除 asset 未检查任务引用 | 增加 `generation_task_input_assets` 与 `generation_task_results` 结构化引用检查 |
| 8 | 取消任务语义不足 | 区分本地取消与远端取消 |
| 9 | custom Provider SSRF 风险 | MVP 不开放通用 custom；第二阶段开放前必须限制 HTTPS、私有地址段、DNS 解析和跳转目标 |
| 10 | SQLite 外键未启用 | 启动时开启 PRAGMA，补充外键 |
| 11 | 并发配置与 MVP 冲突 | MVP 移除 `maxConcurrentTasks` |
| 12 | 数据库迁移策略缺失 | 增加迁移规范与目录约定 |
| 13 | 节点 min/max 来源不清 | 改为运行时派生，不持久化 |
| 14 | `image_combinations` 与 `prompt_bindings` 循环外键 | 删除 `image_combinations.prompt_binding_id`，以 `prompt_bindings.combination_id UNIQUE` 为唯一事实来源 |
| 15 | 草稿态校验可能落后于 UI | `validate_combination` 支持 `draftCombination / draftPromptBinding / draftModelConfig` 与 `revision` |
| 16 | 单任务并发只靠前端禁用不可靠 | 增加事务、Rust 单飞机制和 SQLite partial unique index |
| 17 | 本地完整路径泄露风险 | `assets` 和快照只保存工作区相对路径 |
| 18 | 通用 custom Provider 范围过大 | MVP 不开放通用 `custom` Provider，仅接入固定真实 Provider |
| 19 | Tauri 桌面端安全边界缺失 | 补充 command capability、文件系统 scope、CSP、外链和 URL 下载校验要求 |
| 20 | 应用关闭后遗留运行中任务 | 启动时将历史运行中任务置为 `failed / APP_UNEXPECTED_SHUTDOWN` |
| 21 | 取消任务缺少运行态骨架 | 增加 `AppState.cancellation_tokens` 管理和任务结束清理规则 |
| 22 | 组合任务历史查询缺索引 | 增加 `idx_generation_tasks_combination_created_at` |
| 23 | `resolvedLocalPath` 生命周期表述不准 | 改为任务生命周期内临时有效，不得持久化 |
| 24 | `delete_asset` 文件先删导致原子性风险 | 改为数据库事务提交后再删除文件，失败记录 GC 日志 |
| 25 | sha256 去重跨角色语义不清 | MVP 只在同一 `assets.type` 内去重 |
| 26 | retry 使用快照但未检查文件存在 | 重试前检查输入文件，缺失返回 `ASSET_FILE_MISSING` |
| 27 | Prompt 模板变量声明与内容可能不一致 | `PromptResolver` 统一校验占位符和 `variables_json` |
| 28 | React Flow 与 Zustand 可能双源 | 明确 React Flow 只管渲染态，业务事实由 Zustand/SQLite 派生 |
| 29 | SQLite WAL 下写者竞争 | MVP 写操作使用单 writer 连接策略 |
| 30 | `CancelMode` 序列化值与 SQLite CHECK 不一致 | 使用 `#[serde(rename_all = "snake_case")]` 对齐持久化值 |
| 31 | 启动恢复后的失败任务缺少前端拉取入口 | 新增 `list_recent_generation_tasks` |
| 32 | Provider 返回可能包含敏感 URL 或 raw 响应 | `rawResponse` 不持久化，`source_url` 入库前必须脱敏 |
| 33 | 组合任务历史索引未覆盖排序 | 改为 `(combination_id, created_at DESC)` 复合索引 |
| 34 | 孤儿文件 GC 缺少触发点 | 明确启动后和资源库打开时执行轻量 GC |
| 35 | 启动恢复任务可能因创建时间旧而不在最近列表 | `list_recent_generation_tasks` 改为按 `updated_at DESC` 返回 |
| 36 | `sourceUrl` 脱敏可能影响下载 | 允许内存中用原始 URL 下载，持久化前再脱敏 |
| 37 | GC 删除保护边界不清 | 明确 GC 只以 `assets` 结构化路径字段为删除保护事实来源 |
| 38 | 桌面端商业授权边界缺失 | 新增 License Server，限定只处理授权、设备、token、支付回调和功能开关 |
| 39 | 激活码验证如果只在前端实现容易被绕过 | 激活、刷新、套餐功能开关必须由 Rust 层调用 License Server 完成 |
| 40 | 授权 token 持久化存在泄露风险 | `refreshToken` 必须进入系统密钥库，SQLite 只保存授权状态和功能开关缓存 |
| 41 | 支付 webhook 可能被伪造或重复投递 | License Server 必须校验签名，并使用事件 ID 幂等处理 |
| 42 | 套餐功能开关如果只控制 UI 不可靠 | 生成、导出、高级模型等受限功能必须在 Rust 执行入口再次校验 |

---

## 25.2 MVP 开发强制约束

MVP 阶段必须遵守以下约束：

1. Prompt 最终解析只在 Rust 层执行；
2. 前端预览必须调用 `preview_resolved_prompt`；
3. `start_generation` 创建任务时必须保存不可变快照；
4. 任务表禁止保存 base64 图片；
5. API Key 不得进入前端、SQLite、日志和任务摘要；
6. 全局只允许一个运行中任务；
7. `delete_asset` 不允许破坏组合和历史任务引用；
8. 数据库连接必须启用外键；
9. 应用启动必须执行数据库迁移；
10. MVP 不开放通用 `custom` Provider；
11. `start_generation` 必须用事务和数据库约束保证全局单任务；
12. 前端草稿态必须通过 `validate_combination` 的 draft 参数参与权威校验；
13. SQLite、日志、任务摘要和快照不得保存用户导入前的完整本地路径；
14. Tauri command、文件系统 scope 和外部 URL 访问必须采用最小授权；
15. 应用启动必须清理历史运行中任务，避免 partial unique index 阻塞新任务；
16. `CancellationToken` 只能由 Rust `AppState` 管理，前端不得保存取消句柄；
17. 前端启动和进入任务页面必须主动拉取任务状态，不能只依赖 Tauri event；
18. `delete_asset` 必须数据库提交成功后再删除文件；
19. Prompt 模板保存和解析必须校验变量声明与模板占位符一致性；
20. React Flow 节点数据不得成为业务保存的 canonical state；
21. SQLite 写操作必须走单 writer 连接；
22. `CancelMode` 持久化值必须使用 snake_case；
23. `rawResponse` 不得写入 SQLite、日志或任务快照；
24. `source_url` 保存前必须脱敏，无法确认安全时保存为 `NULL`；
25. GC 只能扫描工作区 `assets/` 和 `cache/`，不得触碰用户原始文件路径；
26. 原始 `sourceUrl` 只允许在 Provider Adapter 内存中用于下载，不得持久化；
27. GC 删除保护只能依赖 `assets.storage_relative_path` 和 `assets.thumbnail_relative_path`，不得扫描任务快照 JSON 判断引用；
28. License Server 只能保存授权、设备、支付和套餐权益数据，不得接收图片、Prompt、任务历史或工作区数据库；
29. 激活码、`licenseToken`、`refreshToken`、支付平台签名密钥不得写入日志、SQLite、任务摘要或前端持久化状态；
30. `refreshToken` 必须保存到系统密钥库，SQLite 只允许保存 `license_state` 中的授权状态、过期时间和功能开关缓存；
31. 设备激活、解绑、token 刷新和套餐功能开关查询必须由 Rust command 完成，前端不得直接调用 License Server；
32. 生成、导出、批量生成、高级模型和 custom Provider 开关必须在 Rust 执行入口校验，前端禁用只作为 UI 提示；
33. 支付 webhook 必须验证平台签名，且必须基于事件 ID 幂等处理重复投递；
34. `revoked` 和 `suspended` 状态同步到客户端后必须立即禁用受限功能，不适用离线宽限。

---

## 25.3 后续阶段可扩展项

以下能力不进入 MVP，但 schema 和服务边界应预留：

| 能力 | 建议阶段 | 说明 |
| --- | --- | --- |
| PromptBinding 多版本 | 第二阶段 | 支持 Prompt A/B 实验、版本命名、回滚 |
| 多任务队列 | 第二阶段 | 引入 `maxConcurrentTasks`、队列策略、任务优先级 |
| 批量生成 | 第二阶段 | 基于多个 ImageCombination 批量执行 |
| Provider 调试面板 | 第二阶段 | 查看脱敏请求摘要和 Provider 响应摘要 |
| 通用 custom Provider | 第二阶段 | 需完成 Base URL、DNS、跳转、鉴权模板、响应路径和脱敏校验 |
| 本地模型 Provider | 第二/三阶段 | 需重新评估本地地址访问安全策略 |
| 工作流 DAG 化 | 第三阶段 | 节点输入输出 schema、拓扑执行、节点缓存 |
| License 管理后台 | 第二阶段 | 可视化创建、续期、撤销 License 和查看设备绑定审计 |
| 企业授权席位管理 | 第三阶段 | 团队成员、席位分配、组织级设备策略和批量解绑 |

---

## 25.4 给 Codex 的开发落地顺序

建议按以下顺序实现，避免返工：

```text
1. SQLite migrations + PRAGMA foreign_keys
2. SQLite 单 writer 连接策略 + 启动孤儿任务恢复
3. assets 相对路径存储 + 缩略图生成 + 同类型 sha256 去重
4. image_combinations / prompt_bindings 基础 CRUD
5. save_image_combination 事务化全量替换 items
6. delete_asset 数据库优先删除 + 孤儿文件 GC 日志与触发点
7. Rust PromptResolver + 模板变量一致性校验
8. preview_resolved_prompt
9. ModelDefinition role-based inputLimits
10. validate_combination 草稿态校验
11. generation_tasks + task snapshots
12. generation_task_input_assets / generation_task_results
13. AppState + CancellationToken 管理
14. TaskRunner 单任务事务与 partial unique index
15. 固定 Provider Adapter 基础实现
16. start_generation 端到端执行
17. cancel_generation_task 本地取消
18. retry_generation_task 基于快照重试 + 文件存在性检查
19. rerun_generation_from_current_combination 当前配置重跑
20. Tauri 安全配置与日志脱敏
21. License Server 基础 API：create/status/activate/deactivate/refresh/entitlements
22. 支付 webhook 签名校验、事件幂等和 License 状态同步
23. license_state migration + 系统密钥库 token 存储
24. activate_license / get_license_status / refresh_license_token / get_license_entitlements
25. 授权激活界面 + 未激活、过期、撤销、暂停状态展示
26. 生成、导出、高级模型和套餐限制的 Rust 入口校验
27. UI 任务历史与结果展示 + 启动主动拉取任务状态
28. Provider 返回摘要脱敏 + source_url 安全保存
```

---

## 25.5 验收标准

### Prompt 一致性验收

```text
同一个 PromptBinding：
preview_resolved_prompt 返回的结果
必须与 start_generation 保存的 final_prompt_snapshot_json 完全一致。
```

### Prompt 模板变量验收

```text
模板内容出现未声明变量时，保存或解析必须返回 PROMPT_TEMPLATE_INVALID。
required 变量缺值时，validate_combination 必须阻止执行。
声明了 required 但模板未使用的变量，必须返回 warning。
```

### 任务快照验收

```text
用户执行生成后，即使随后修改组合、Prompt、模型参数，历史任务详情中仍能看到当时使用的图片、Prompt 和模型参数。
```

### 重试验收

```text
retry_generation_task(taskId) 必须使用原任务快照。
rerun_generation_from_current_combination(combinationId) 必须使用当前最新配置。
两者结果中的 final_prompt_snapshot_json 应可区分。
```

### 数据库脱敏验收

```text
workspace.db 中不得出现：
- base64 图片内容；
- API Key；
- Authorization Header；
- 未脱敏的完整本地敏感路径。
```

### 删除资源验收

```text
被组合或历史任务引用的 asset 默认不可删除。
删除未引用 asset 后，资源库、组合、任务历史均不得出现坏引用。
模拟文件删除失败时，SQLite 记录不得回滚，必须写入 GC 日志。
```

### 图片去重验收

```text
同一文件以相同 type 重复导入时，可复用或提示重复导入。
同一文件分别作为 person 与 garment 导入时，必须创建不同 Asset。
```

### 草稿校验验收

```text
用户修改人物图、服装图顺序、Prompt 或模型参数后：
validate_combination 必须基于当前 UI 草稿返回结果。
旧 revision 的校验结果不得覆盖新 revision 的执行按钮状态。
```

### 单任务并发验收

```text
快速双击执行按钮、两个窗口同时调用 start_generation：
最多只能创建一个运行中任务。
第二个请求必须返回明确的已有任务运行中错误。
```

### 启动恢复验收

```text
手动构造 calling_model / waiting_result 等运行中历史任务后启动应用：
应用必须将其置为 failed / APP_UNEXPECTED_SHUTDOWN。
恢复后必须允许用户创建新任务。
```

### 事件兜底验收

```text
前端错过 task-updated event 后：
重新进入应用或任务页面必须通过主动拉取恢复正确任务状态。
启动恢复产生 failed / APP_UNEXPECTED_SHUTDOWN 任务后：
list_recent_generation_tasks 必须能返回该任务。
list_recent_generation_tasks 必须按 updated_at DESC 返回。
```

### 重试文件检查验收

```text
手动删除原任务输入图片文件后调用 retry_generation_task：
必须返回 ASSET_FILE_MISSING，且错误信息包含 assetId、fileName 和 role。
```

### 路径脱敏验收

```text
workspace.db、任务快照、request_summary_json、日志中不得出现用户导入前的完整本地路径。
assets 和 AssetSnapshot 只能保存工作区内相对路径。
rawResponse 不得持久化。
source_url 中不得保存签名参数、token 或临时访问凭证。
Provider Adapter 可以用原始 sourceUrl 下载结果，但原始 sourceUrl 不得出现在 SQLite、日志、任务摘要或快照中。
```

### 孤儿文件 GC 验收

```text
删除未引用 asset 时模拟文件删除失败：
应用启动后或打开资源库时，轻量 GC 应清理工作区内未被 SQLite 引用的孤儿文件。
GC 不得扫描或删除用户导入前的原始文件路径。
GC 删除保护必须以 assets.storage_relative_path 和 assets.thumbnail_relative_path 为准。
AssetSnapshot.storageRelativePath 不作为 GC 删除保护事实来源。
```

### 取消任务验收

```text
Provider 支持远端取消时，应记录 remote_confirmed。
Provider 不支持远端取消时，应记录 remote_not_supported，并提示可能继续计费。
```

### License 创建验收

```text
后台或支付成功流程调用 POST /v1/licenses 创建 License 后：
必须返回 activationCode、licenseId、status 和 entitlements。
创建操作必须记录管理员或支付事件来源。
License Server 不得保存用户图片、Prompt、任务历史或工作区数据库。
```

### License 状态查询验收

```text
客户端输入激活码后查询状态：
active 应展示套餐、到期时间、设备数量和功能开关。
expired / revoked / suspended 必须给出明确状态，不得允许继续激活受限功能。
查询过程不得把激活码写入日志。
```

### 设备激活与解绑验收

```text
activate_license 必须由 Rust 层生成设备指纹摘要并调用 License Server。
设备数超过 maxDevices 时必须返回明确错误。
deactivate_current_device 只能解绑当前设备，成功后本地 license_state 必须更新为 inactive。
解绑后受限功能入口必须立即禁用。
```

### 授权 Token 刷新验收

```text
应用启动时应尝试 refresh_license_token。
licenseToken 未过期时可继续使用缓存的 entitlements。
refreshToken 必须保存在系统密钥库，不得出现在 SQLite、日志或前端持久化状态中。
超过离线宽限期后，付费功能必须禁用，但不得破坏本地工作区数据。
```

### 支付 Webhook 验收

```text
License Server 接收支付平台 webhook 时必须验证平台签名。
同一事件 ID 重复投递只能处理一次。
支付成功应创建或续期 License。
订阅取消、退款、支付失败应更新 License 状态或到期时间。
webhook 原始 body 如需短期保存排障，必须脱敏且不得记录支付密钥。
```

### 套餐功能开关验收

```text
get_license_entitlements 必须返回 plan、features、limits 和 expiresAt。
generation=false 时 start_generation 必须失败并返回授权错误。
exportResult=false 时导出入口必须禁用，Rust 导出命令也必须拒绝执行。
maxOutputCount 必须参与 validate_combination 和 start_generation 校验。
advancedModels=false 时前端不可选择高级模型，Rust 执行入口也必须拒绝高级模型配置。
```
