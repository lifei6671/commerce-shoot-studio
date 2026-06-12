# AI 服装展示图生成桌面端技术方案（评审修订版）

> 版本：v3.5-license-review
>
> 说明：本版本在 v3.4-review 基础上补充商业授权激活体系。当前第一期先交付本地单机商拍生成工作流，授权、License Server、设备激活、套餐功能开关和支付 webhook 全部列为第二期需求，本期不实现、不阻塞 MVP。

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

第二期目标：

1. 通过激活码完成设备授权；
2. 按授权套餐启用或禁用本地功能；
3. 接入 License Server 和支付 webhook。

### 1.2 第一阶段边界

第一阶段不引入业务后端和授权后端，商拍业务状态全部保存在本地工作区。

| 能力           | 第一阶段口径 | 说明                       |
| ------------ | ------: | ------------------------ |
| 自建商拍业务后端服务  |      否 | 图片、组合、Prompt、任务历史等业务状态本地保存 |
| License Server   |      否 | 第二期再引入，用于授权、设备激活、支付回调和套餐功能开关 |
| 自建 AI 推理服务   |      否 | 仅接第三方 API                |
| 云端用户体系       |      否 | 本地单机应用                   |
| 多人协作         |      否 | 本地工作区                    |
| 通用 DAG 工作流引擎 |      否 | 第一阶段采用固定流程画布             |
| 脚本节点         |      否 | 避免安全和复杂度失控               |
| 自由图形编辑器      |      否 | 不是 Photoshop / Figma 类工具 |
| 长期云端任务队列     |      否 | 使用本地任务状态机                |

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
| SQLite + assets 文件目录 | 本地业务状态与图片文件持久化 |
| Tauri Event   | Rust 层向前端推送任务状态                     |

React Flow 官方文档中也有使用 Zustand 管理 React Flow 状态的示例与说明。([React Flow][3])

状态权威边界：

1. SQLite / Rust command 是已保存业务事实的权威来源；
2. Zustand 保存当前编辑草稿、选中组合、任务缓存和 UI 派生状态；
3. React Flow 只负责节点渲染态、视口、缩放、拖拽和选中交互；
4. React Flow `nodes[].data` 必须由 Zustand / React Query 数据派生，不得作为保存业务字段的 canonical state；
5. 节点位置等纯画布 UI 状态由 React Flow 管理；需要持久化时，必须单独保存为 layout state，不得与业务对象混写。

---

## 2.4 本地存储

第一阶段固定使用：

```text
SQLite + 本地 assets 文件目录
```

不得只用 JSON，因为本期会产生这些数据：

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

## 2.6 License Server 技术选型（第二期）

> 第二期需求。本期 MVP 不实现 License Server，不接入激活码、套餐功能开关或支付 webhook。

推荐后端采用：

```text
Go + Gin + PostgreSQL + sqlc/goose + Ed25519 JWS
```

原因：

| 维度 | 结论 |
| --- | --- |
| 开发效率 | 授权后端是典型 CRUD + 状态机 + webhook，Go 实现成本低 |
| 部署复杂度 | 单体 HTTP 服务即可，不需要微服务 |
| 数据一致性 | PostgreSQL 适合 License、设备、支付事件和审计日志 |
| Token 安全 | License Token 使用 Ed25519 签名，客户端只内置公钥 |
| 支付回调 | webhook 需要签名校验、幂等处理和事务更新 |
| 后续扩展 | 可扩展管理后台、企业席位、设备解绑和订阅同步 |

推荐后端组件：

```text
license-server/
├── Go 1.22+
├── Gin
├── pgx
├── sqlc
├── goose
├── PostgreSQL 15+
├── 进程内限流器，用于激活码状态查询和激活接口限流
└── Ed25519 key pair，用于签名 licenseToken
```

第二期首版不引入 Redis。License Server 按单实例轻量部署处理，激活码状态查询和激活接口先使用进程内限流器；如果后续进入多实例部署，再单独评估是否引入 Redis 或其他集中式限流存储。

第二期首版不得把授权服务做成复杂用户中心。它只负责：

1. License 创建；
2. License 状态查询；
3. 设备激活；
4. 当前设备解绑；
5. 授权 token 刷新；
6. 套餐功能开关返回；
7. 支付 webhook 同步订阅状态；
8. 管理端审计日志。

不负责：

1. 保存用户图片；
2. 保存 Prompt；
3. 保存任务历史；
4. 保存工作区数据库；
5. 调用第三方生图 API；
6. 参与本地任务队列。

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
                             │ HTTPS                         │ HTTPS
                             ▼                               ▼
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
| License Client    | 第二期：激活码验证、设备激活、授权 token 刷新、功能开关读取 |
| License Server    | 第二期：License 管理、设备绑定、支付回调、套餐权益计算 |
| SQLite            | 结构化数据持久化                    |
| File Store        | 图片文件与结果文件管理                 |


---

## 3.3 License Server 后端架构（第二期）

> 第二期需求。本期 MVP 不包含 License Server。

```text
┌────────────────────────────────────────────────────────────┐
│                      License Server                         │
├────────────────────────────────────────────────────────────┤
│ HTTP API                                                    │
│  /v1/licenses/status                                        │
│  /v1/licenses/activate                                      │
│  /v1/licenses/deactivate-device                             │
│  /v1/licenses/refresh-token                                 │
│  /v1/licenses/entitlements                                  │
│  /v1/webhooks/payments/{provider}                           │
├────────────────────────────────────────────────────────────┤
│ Application Service                                         │
│  LicenseService                                             │
│  DeviceService                                              │
│  TokenService                                               │
│  EntitlementService                                         │
│  PaymentWebhookService                                      │
│  AuditService                                               │
├────────────────────────────────────────────────────────────┤
│ Infrastructure                                              │
│  PostgreSQL                                                 │
│  JWS Signer / Key Rotation                                  │
│  Payment Provider Client                                    │
│  Rate Limiter                                               │
└────────────────────────────────────────────────────────────┘
```

设计边界：

1. License Server 是第二期唯一允许新增的轻量后端；
2. License Server 不保存任何商拍业务数据；
3. 客户端业务执行仍然发生在本地 Tauri Rust 层；
4. License Server 返回的是授权事实和功能开关，不返回业务配置；
5. 客户端必须能在短期网络不可用时继续使用已缓存授权；
6. 一旦同步到 `revoked / suspended`，客户端必须立即禁用受限能力。

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
  | "stability";

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

说明：MVP 阶段 `ModelProvider` 不包含 `custom`。第二阶段开放通用自定义 Provider 时，必须另行扩展类型、数据库表、导入校验和安全限制，不能提前把 `custom` 作为可保存的 MVP 配置值。

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

  createdAt: string;
  updatedAt: string;
};
```

说明：`ImageCombination` 不保存 `promptBindingId`。组合与 PromptBinding 的唯一结构化关系是 `prompt_bindings.combination_id UNIQUE`，读取组合详情时必须派生返回当前 PromptBinding，但不得把 `promptBindingId` 作为保存输入或数据库字段。

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
    maxOutputCount: number;
    maxGarmentImages?: number;
  };
  license?: {
    status: LicenseStatus;
    deviceStatus?: "active" | "deactivated";
    localAuthState: LocalAuthState;
    featureDeniedReason?: AppErrorCode | LicenseServerErrorCode | LocalLicenseErrorCode;
    effectiveEntitlements: LicenseEntitlements;
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
3. 调用 `validate_combination` 必须做 300ms debounce，避免 Prompt 输入时频繁请求 Rust；
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

1. 加载组合、图片、模型定义和 API Key 配置状态；
2. 如果收到草稿对象，优先使用草稿对象参与校验，但不得自动写入数据库；
3. 使用 `PromptResolver` 解析最终 Prompt；
4. 按当前 `ModelDefinition.inputLimits` 校验所有输入数量；
5. 校验图片格式、大小、Prompt 长度、模型能力和输出数量；
6. 查询是否存在运行中任务；
7. 返回统一校验结果、动态限制值、最终 Prompt、错误原因和原样回传的 `revision`。

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

前端只做非权威辅助提示，例如输入框字符数统计，不能作为执行依据。

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
  final = baseTemplate + "\n\n" + appendText

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
    countParamKey: string;
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
7. 第二阶段开放用户自定义 Provider 模型时，必须另行引入 `custom_model_definitions` 表、Provider 配置表和导入校验机制。
8. 输出数量必须通过 `ModelDefinition.output.countParamKey` 从模型参数中归一化为 `normalizedOutputCount`，`validate_combination / start_generation` 不得直接假设参数名一定是 `count`。第二期接入授权后，`LicenseGuard.check_output_count` 复用同一个 `normalizedOutputCount`。

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
      countParamKey: "count",
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

导入图片后统一按 `asset_<ULID>.<ext>` 重命名，避免重名冲突。

`sha256` 只作为数据库去重字段，不参与文件名生成。MVP 阶段只在同一 `assets.type` 内按 `sha256` 去重。

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
3. 读操作固定复用同一个 SQLx SQLite pool，本期不拆 reader pool；
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
3. Rust 进程内使用 `tokio::sync::Mutex` 保护 `start_generation` 单飞，避免同进程重复点击并发进入；
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
3. 不依赖 `source_url` 做结果复现，结果复现以本地 `asset_id` 和任务快照为准。

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
SQLx + sqlx migrate
```

要求：

1. 每个迁移文件单调递增；
2. 应用启动时自动执行 pending migrations；
3. 禁止运行时散落 `ALTER TABLE`；
4. `workspace.db` 记录 schema version；
5. Rust 使用 SQLx 操作 SQLite，迁移由 `sqlx migrate` 体系统一管理；
6. 迁移前必须自动备份 `workspace.db` 到工作区 `backups/` 目录，备份失败则阻止迁移；
7. MVP 不支持自动降级回滚，只支持升级迁移；
8. 迁移失败时阻止打开工作区，并提示用户备份数据库。

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

1. 应用启动后必须执行一次轻量 GC；
2. 用户打开资源库页面时必须触发轻量 GC；
3. GC 只允许扫描工作区 `assets/` 和 `cache/` 目录；
4. GC 只能删除 SQLite 中不存在引用的文件；
5. GC 不得扫描或删除用户导入前的原始文件路径。

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

1. 统一完成组合、模型、Prompt、API Key 和运行中任务校验；
2. 内部调用 Rust `PromptResolver` 生成最终 Prompt；
3. 返回动态图片数量限制、输出数量限制、Prompt 预览、错误原因和警告；
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
5. 校验 License active、设备 active、token 未过期或仍在离线宽限期内、`generation` 功能开关、输出数量限制和高级模型权限；
6. 校验模型能力；
7. 读取 API Key；
8. 创建任务输入快照、Prompt 快照、模型参数快照、Asset 快照；
9. 创建 generation_task；
10. 启动异步任务；
11. 返回任务对象。

原子性要求：

1. `start_generation` 必须重新执行完整 Rust 权威校验，不得信任前端缓存的 `canExecute`；
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

用途：前端启动后主动拉取最近任务，展示启动恢复时被置为 `failed / APP_UNEXPECTED_SHUTDOWN` 的历史任务。该 command 必须按 `updated_at DESC` 返回，默认 `limit = 20`。

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

## 13.7 授权激活（第二期）

> 第二期需求。本期 MVP 不实现以下 Tauri command。

### activate_license

```ts
invoke<ActivateDeviceResponse>("activate_license", {
  activationCode: string
});
```

职责：

1. Rust 层读取或生成 `installationId / appInstallSalt`；
2. 计算 `deviceFingerprintHash`；
3. 调用 License Server 激活设备；
4. 校验返回的 `licenseToken` 签名；
5. 将 `licenseToken / refreshToken` 保存到系统密钥库；
6. 将授权状态、`deviceStatus="active"`、`local_auth_state="active"` 和功能开关缓存到 `license_state`，并清空 `last_auth_error`；
7. 返回授权状态给前端展示。

### check_license_activation_code

```ts
invoke<LicenseStatusResponse>("check_license_activation_code", {
  activationCode: string
});
```

职责：

1. Rust 层读取或生成 `installationId / appInstallSalt`；
2. 计算 `deviceFingerprintHash`；
3. 附带 `appVersion / platform` 调用 License Server 的 `POST /v1/licenses/status`；
4. 仅用于激活前展示 License 状态、套餐和设备数量；
5. 不返回、不保存任何 token；
6. 激活码只能放在 POST body 中，不得放入 URL query、日志或前端持久化状态。

### get_license_status

```ts
invoke<LicenseStatusView>("get_license_status");
```

```ts
type LocalAuthState =
  | "inactive"
  | "active"
  | "needs_reactivation"
  | "device_deactivated";

type LocalLicenseErrorCode =
  | "KEYCHAIN_TOKEN_MISSING"
  | "KEYCHAIN_READ_FAILED"
  | "LICENSE_TOKEN_INVALID"
  | "LICENSE_TOKEN_EXPIRED"
  | "LICENSE_OFFLINE_GRACE_EXPIRED"
  | "LICENSE_SERVER_UNAVAILABLE";

type LicenseStatusView = {
  licenseId?: string;
  deviceId?: string;
  status: LicenseStatus;
  deviceStatus?: "active" | "deactivated";
  localAuthState: LocalAuthState;
  entitlements: LicenseEntitlements;
  tokenExpiresAt?: string;
  refreshAfter?: string;
  offlineGraceUntil?: string;
  lastAuthError?: LicenseServerErrorCode | LocalLicenseErrorCode;
  offline: boolean;
};
```

职责：

1. 从本地 `license_state` 和系统密钥库读取授权缓存；
2. 校验本地 `licenseToken` 签名和过期时间；
3. 返回套餐、到期时间、License 状态、设备状态、本机授权态、功能开关和是否需要刷新；
4. 不主动联网，避免设置页打开时产生额外等待；
5. 系统密钥库没有 `licenseToken` 时，不得报硬错误，应返回本地禁用后的 `LicenseStatusView`，并写入 `lastAuthError=KEYCHAIN_TOKEN_MISSING`；
6. 系统密钥库读取失败时，应返回本地禁用后的 `LicenseStatusView`，并写入 `lastAuthError=KEYCHAIN_READ_FAILED`；
7. 本地 token 验签成功且 `local_auth_state="active"` 时，应清空 `license_state.last_auth_error`，返回的 `LicenseStatusView.lastAuthError` 必须为空；
8. 本地返回的 cached entitlements 必须按 `status / device_status / local_auth_state` 归一化，付费 feature 和付费额度不得沿用历史 active 权益。

### refresh_license_token

```ts
invoke<LicenseStatusView>("refresh_license_token");
```

职责：

1. 从系统密钥库读取 `refreshToken`；
2. 调用 License Server 刷新授权状态；
3. 采用 refresh token rotation；
4. 服务端返回 `active` 且包含新 token 时，将新的 `licenseToken / refreshToken` 写回系统密钥库；
5. 服务端返回 `expired / revoked / suspended` 或当前设备 `deactivated` 时，清除系统密钥库中的 `licenseToken / refreshToken`，只保留 `license_state` 中的只读状态、设备状态和禁用后的功能开关；
6. 更新本地 `license_state.status / license_state.device_status / license_state.local_auth_state`，刷新成功时必须写入 `local_auth_state="active"` 并清空 `last_auth_error`；
7. 如果网络失败但仍在离线宽限期内，返回本地缓存状态并标记 `offline=true / lastAuthError=LICENSE_SERVER_UNAVAILABLE`，保持 `local_auth_state="active"` 和可用的 cached entitlements；
8. Rust 层必须对该 command 做单飞，避免同一个 refresh token 被并发使用；
9. 收到 `REFRESH_TOKEN_REUSED` 时必须清除系统密钥库中的 `licenseToken / refreshToken`，保留最近一次可信的 `license_state.status`，将 `license_state.local_auth_state` 更新为 `needs_reactivation`，并禁用付费功能。
10. 收到 `expired / revoked / suspended` 时必须写入 `local_auth_state="inactive"`，并将 cached entitlements 归一化为禁用态。
11. 网络失败且超过 `offlineGraceUntil` 时必须写入 `local_auth_state="inactive" / lastAuthError=LICENSE_OFFLINE_GRACE_EXPIRED`，并将 cached entitlements 归一化为禁用态。
12. 系统密钥库缺少 `refreshToken` 时不得调用 License Server，必须清除残留的 `licenseToken`，返回禁用后的 `LicenseStatusView`，并写入 `lastAuthError=KEYCHAIN_TOKEN_MISSING`。
13. 系统密钥库读取 `refreshToken` 失败时不得调用 License Server，必须返回禁用后的 `LicenseStatusView`，并写入 `lastAuthError=KEYCHAIN_READ_FAILED`。

### deactivate_current_device

```ts
invoke<LicenseStatusView>("deactivate_current_device");
```

职责：

1. 调用 License Server 解绑当前设备；
2. 清除系统密钥库中的 `licenseToken / refreshToken`；
3. 使用服务端返回的 `status / deviceStatus / entitlements` 更新本地 `license_state`；
4. 如果服务端解绑成功但响应体缺失，应保留本地已知的 License `status`，写入 `device_status=deactivated / local_auth_state=device_deactivated`，并生成本地禁用后的 entitlements；
5. 前端立即禁用受限功能入口；
6. 不向服务端传递可伪造的 `deviceId`，由服务端根据 `licenseToken` 推导当前设备。

### get_license_entitlements

```ts
invoke<LicenseStatusView>("get_license_entitlements");
```

职责：

1. 返回当前设备授权状态和可用功能开关；
2. 供前端渲染套餐 UI；
3. 不作为关键功能的唯一校验依据；
4. `start_generation / export_results / batch_generation` 等 Rust command 仍必须自行执行 `LicenseGuard`；
5. 不向服务端传递可伪造的 `deviceId`，由服务端根据 `licenseToken` 推导当前设备；
6. Rust 层必须用服务端返回的 `status / deviceStatus` 同步更新 `license_state.status / license_state.device_status`，并按设备状态更新 `license_state.local_auth_state`；
7. 服务端返回非 `active` 状态时，必须缓存禁用后的功能开关，并按状态清理或禁用本地授权能力；
8. `revoked / suspended / expired / device deactivated` 时必须清除系统密钥库中的 `licenseToken / refreshToken`；
9. 系统密钥库不存在 `licenseToken` 时，不得调用 License Server，应将本地 `license_state.entitlements_json` 归一化为禁用态后返回，并携带 `localAuthState / lastAuthError / offline=false`；
10. cached entitlements 归一化时，除明确允许的只读能力外，付费 feature 必须全部置为 `false`，付费额度必须归零或降为只读安全默认值，不得直接返回历史 active 权益；
11. 服务端 `EntitlementsResponse` 不得直接透传给前端，Rust 必须转换为 `LicenseStatusView`，并补齐 `localAuthState / offline / lastAuthError`；
12. 映射为 `LicenseStatusView` 时，`status / deviceStatus / entitlements` 来自服务端响应，`tokenExpiresAt / refreshAfter / offlineGraceUntil / localAuthState / lastAuthError / offline` 来自本地 `license_state`、系统密钥库校验结果和本次请求结果；
13. `/entitlements` active 成功时必须写入 `offline=false`，清空 `last_auth_error`，并将 `local_auth_state` 置为 `active`。

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
│   ├── fal_provider.rs
│   └── stability_provider.rs
│
├── services/
│   ├── mod.rs
│   ├── prompt_resolver.rs
│   ├── model_validator.rs
│   ├── license_client.rs
│   ├── license_guard.rs
│   ├── token_verifier.rs
│   ├── task_runner.rs
│   ├── image_inspector.rs
│   └── credential_service.rs
│
└── error/
    ├── mod.rs
    └── app_error.rs
```


---

## 15.2 License Server 后端模块结构（第二期）

第二期在当前 monorepo 中新增 `license-server/` 子目录：

```text
license-server/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── api/
│   │   ├── router.go
│   │   ├── license_handler.go
│   │   ├── device_handler.go
│   │   ├── entitlement_handler.go
│   │   └── payment_webhook_handler.go
│   ├── app/
│   │   ├── license_service.go
│   │   ├── device_service.go
│   │   ├── token_service.go
│   │   ├── entitlement_service.go
│   │   ├── payment_service.go
│   │   └── audit_service.go
│   ├── domain/
│   │   ├── license.go
│   │   ├── device.go
│   │   ├── entitlement.go
│   │   └── payment_event.go
│   ├── infra/
│   │   ├── postgres/
│   │   ├── signer/
│   │   ├── payment/
│   │   └── ratelimit/
│   └── config/
├── migrations/
├── sql/
└── go.mod
```

后端保持单体服务即可。第二期首版不需要拆分账号服务、订单服务、授权服务和 webhook 服务。

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
解析 Prompt
    ↓
创建 input / prompt / model / asset 快照
    ↓
创建 generation_task
    ↓
emit task-updated: validating
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

## 16.8 授权激活流程（第二期）

> 第二期需求。本期 MVP 不包含授权激活流程。

### 首次激活

```text
用户输入激活码
    ↓
前端调用 activate_license
    ↓
Rust 读取或生成 installationId
    ↓
Rust 计算 deviceFingerprintHash
    ↓
License Server 校验激活码、套餐、状态和设备数
    ↓
License Server 创建 device binding
    ↓
License Server 签发 licenseToken 和 refreshToken
    ↓
Rust 校验 licenseToken 签名
    ↓
Rust 将 licenseToken / refreshToken 写入系统密钥库
    ↓
Rust 将 license_state 写入本地 SQLite
    ↓
前端展示套餐、到期时间和可用功能
```

### 应用启动授权恢复

```text
应用启动
    ↓
Rust 读取 license_state
    ↓
Rust 从系统密钥库读取 token
    ↓
校验 licenseToken 签名、状态、refreshAfter 和 offlineGraceUntil
    ↓
如果需要刷新，则后台调用 refresh_license_token
    ↓
刷新成功：更新本地授权状态
刷新返回 expired / revoked / suspended：清除系统密钥库 token，写入 local_auth_state=inactive，并缓存禁用后的 entitlements
刷新返回 deviceStatus=deactivated：清除系统密钥库 token，写入 license_state.device_status=deactivated / local_auth_state=device_deactivated，并缓存禁用后的 entitlements
刷新失败但未超过离线宽限：继续允许已授权功能
超过离线宽限：禁用付费功能，但不破坏本地工作区
```

### 执行生成前授权校验（第二期）

```text
用户点击执行
    ↓
start_generation
    ↓
LicenseGuard.require_feature("generation")
    ↓
LicenseGuard.check_output_count(normalizedOutputCount)
    ↓
LicenseGuard.check_model_access(modelDefinition)
    ↓
继续执行组合、Prompt、模型、API Key 校验
```

说明：前端禁用按钮只是交互提示，生成、导出、批量生成、高级模型等关键能力必须在 Rust command 入口再次校验。

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
  | "TASK_CANCELLED"
  | "LICENSE_NOT_ACTIVATED"
  | "LICENSE_EXPIRED"
  | "LICENSE_REVOKED"
  | "LICENSE_SUSPENDED"
  | "LICENSE_DEVICE_LIMIT_EXCEEDED"
  | "LICENSE_TOKEN_INVALID"
  | "LICENSE_TOKEN_EXPIRED"
  | "LICENSE_REFRESH_REQUIRED"
  | "LICENSE_SERVER_UNAVAILABLE"
  | "FEATURE_NOT_ENTITLED"
  | "PAYMENT_WEBHOOK_INVALID";
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
| 未激活 / 授权过期 | 禁用生成和导出，提示输入激活码或续费 |
| 设备数超限       | 提示解绑旧设备或升级套餐         |
| 授权服务不可用     | 若未超过离线宽限则继续使用，否则禁用付费功能 |
| 功能未授权        | 禁用对应入口，提示升级套餐         |

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

只允许记录：

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

## 18.5 授权激活设计（第二期）

> 第二期需求。本期 MVP 不实现授权激活、License Server、套餐功能开关、设备绑定或支付 webhook；本节仅作为第二期设计依据。

第二期允许新增一个轻量 License Server，但它只能处理商业授权，不得演变成业务后端。

推荐方案：

```text
在线激活 + 本地签名授权缓存 + 离线宽限期 + Rust 层功能守卫
```

### 18.5.1 设计目标

授权体系必须支持：

1. 创建 License；
2. 查询 License 状态；
3. 激活设备；
4. 解绑当前设备；
5. 刷新授权 token；
6. 接收支付平台 webhook；
7. 返回套餐功能开关；
8. 支持短期离线使用；
9. 支持设备数限制；
10. 支持撤销、暂停和过期控制。

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
2. 客户端只上传激活码、设备指纹摘要、应用版本、平台和必要诊断字段；
3. License Server 返回签名 `licenseToken`、不透明 `refreshToken` 和套餐功能开关；
4. 客户端按功能开关控制本地 UI、执行入口和模型能力上限；
5. 授权失败不得破坏本地工作区数据，只禁用受限功能；
6. 业务状态仍以本地 SQLite 和文件工作区为准。

### 18.5.3 License 状态与套餐

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
  | "team"
  | "enterprise";
```

状态语义：

| 状态 | 含义 | 客户端行为 |
| --- | --- | --- |
| inactive | 已创建但未激活 | 允许输入激活码，禁用付费功能 |
| active | 可正常使用 | 按套餐功能开关启用能力 |
| expired | 已过期 | 禁用生成、导出、批量等付费功能 |
| revoked | 已撤销 | 立即禁用受限功能，不适用离线宽限 |
| suspended | 支付失败、风控或人工暂停 | 立即禁用受限功能，不适用离线宽限 |

状态流转要求：

1. `inactive` 只表示 License 已创建但尚未完成首台设备激活；
2. 首次激活成功必须在同一个事务内将 License 从 `inactive` 更新为 `active`，并创建当前设备绑定；
3. 已经为 `active` 的 License 允许新增设备或重复激活同一设备，但仍必须校验 `maxDevices`；
4. `expired / revoked / suspended` 不允许签发新的 `licenseToken / refreshToken`；
5. License 状态和设备状态必须分开表达，不得用 `status=active` 掩盖当前设备已解绑。

### 18.5.4 套餐功能开关

```ts
type LicenseEntitlements = {
  plan: LicensePlan;
  features: {
    generation: boolean;
    exportResult: boolean;
    batchGeneration: boolean;
    removeWatermark: boolean;
    promptTemplates: boolean;
    multiModelConfig: boolean;
    advancedModels: boolean;
    customProvider: boolean;
    errorLogExport: boolean;
  };
  limits: {
    maxDevices: number;
    maxOutputCount: number;
    maxDailyGenerations?: number;
    maxImageCombinations?: number;
    maxPromptTemplates?: number;
    maxGarmentImages?: number;
    maxWorkspaces?: number;
  };
  expiresAt?: string;
};
```

使用原则：

1. `generation=false` 时禁用执行生成；
2. `exportResult=false` 时禁用导出结果；
3. `maxOutputCount` 必须参与 `validate_combination` 和 `start_generation`；
4. `maxGarmentImages` 必须参与组合校验，但不得覆盖模型自身更严格的 `inputLimits`；
5. `advancedModels=false` 时前端隐藏高级模型，Rust 执行入口也必须拒绝；
6. `customProvider=false` 时第二阶段也不得开放自定义 Provider；
7. 前端展示功能差异，Rust 层执行强制拦截；
8. 授权不可用时，归一化后的禁用态 entitlements 必须将付费 `features` 置为 `false`，并将生成、导出、批量、模板、模型等付费额度归零或降为只读安全默认值。

### 18.5.5 Token 签名与刷新策略

授权 token 分两类：

| Token | 形态 | 存储位置 | 用途 |
| --- | --- | --- | --- |
| licenseToken | JWS / JWT，Ed25519 签名 | 系统密钥库，SQLite 只存摘要状态 | 客户端本地验签和功能守卫 |
| refreshToken | 随机不透明字符串 | 系统密钥库 | 向 License Server 换取新 licenseToken |

所有授权相关 HTTP API 均使用 `POST`。激活码、refresh token、license token 和支付平台签名不得放在 URL query 中，避免进入 access log、反向代理日志或错误日志。

`licenseToken` 必须包含：

```json
{
  "iss": "commerce-shoot-studio-license-server",
  "sub": "lic_01J...",
  "aud": "commerce-shoot-studio-desktop",
  "deviceId": "dev_01J...",
  "plan": "pro",
  "status": "active",
  "entitlements": {},
  "iat": 1781136000,
  "nbf": 1781136000,
  "exp": 1781740800,
  "refreshAfter": "2026-06-18T00:00:00Z",
  "offlineGraceUntil": "2026-06-25T00:00:00Z",
  "subscriptionExpiresAt": "2027-06-11T00:00:00Z"
}
```

JWS header 必须包含 `kid`，用于选择验签公钥。payload 不保留额外 `keyId` 字段，避免 header 与 payload 出现双来源不一致；排障日志记录 header `kid` 即可。

规则：

1. 私钥只存在 License Server；
2. 客户端只内置公钥或公钥集合；
3. `licenseToken` 到达 `refreshAfter` 后，客户端启动时应后台刷新；
4. 网络失败但未超过 `offlineGraceUntil` 时，可继续使用缓存授权；
5. 超过 `offlineGraceUntil` 后，禁用付费功能；
6. `revoked / suspended` 一旦同步到本地，不再享受离线宽限；
7. `refreshToken` 服务端只保存 hash，泄露数据库也不能直接换 token；
8. refresh token 必须 rotation，旧 token 使用后立即失效；
9. 客户端离线时无法感知远端刚发生的撤销或暂停，因此“立即禁用”只对已同步状态成立；离线期间最多允许到 `offlineGraceUntil`。

第二期首版固定时间窗口：

| 类型 | 固定值 |
| --- | ---: |
| refreshAfter | 7 天 |
| offlineGraceUntil | 14 天 |
| refreshToken 有效期 | 30 天，或不超过订阅到期时间 |
| 企业离线授权 | 单独签发 180 / 365 天离线 license 文件 |

### 18.5.6 设备绑定策略

禁止采集硬盘序列号、MAC 地址、CPU ID 等强硬件标识。第二期首版固定使用安装级 ID：

```text
installationId = 首次启动生成 UUID，保存到系统密钥库
appInstallSalt = 首次启动生成随机 salt，保存到系统密钥库
deviceFingerprintHash = HMAC-SHA256(appInstallSalt, installationId)
```

激活时上传：

```text
activationCode
deviceFingerprintHash
deviceName
platform
appVersion
```

服务端只保存 `deviceFingerprintHash`，不保存原始安装 ID。

激活码规则：

1. `activationCode` 必须使用高熵随机值，避免可枚举短码；
2. 服务端保存 `HMAC-SHA256(serverPepper, normalizedActivationCode)`，不得保存明文；
3. 如果未来改用人工可读短码，必须改用 Argon2id 慢 hash；
4. `POST /v1/licenses/status` 和 `POST /v1/licenses/activate` 必须按 IP、设备指纹、激活码前缀做进程内限流；
5. 激活码校验失败时返回统一错误，不暴露“是否存在”的可枚举差异。

设备规则：

1. 同一个 `deviceFingerprintHash` 重复激活，返回原设备绑定，不重复占用设备数；
2. 超过 `maxDevices` 返回 `LICENSE_DEVICE_LIMIT_EXCEEDED`；
3. 用户可解绑当前设备；
4. 管理后台可解绑任意设备，但必须记录审计日志；
5. 系统重装或密钥库丢失可能产生新设备，产品侧应提供人工解绑入口。

### 18.5.7 License Server PostgreSQL 表结构

#### licenses

```sql
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  activation_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'expired', 'revoked', 'suspended')),
  plan TEXT NOT NULL CHECK (plan IN ('trial', 'standard', 'pro', 'team', 'enterprise')),
  customer_email TEXT,
  max_devices INTEGER NOT NULL DEFAULT 1,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_licenses_status ON licenses(status);
CREATE INDEX idx_licenses_expires_at ON licenses(expires_at);
```

#### license_devices

```sql
CREATE TABLE license_devices (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE RESTRICT,
  device_fingerprint_hash TEXT NOT NULL,
  device_name TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('macos', 'windows', 'linux')),
  app_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deactivated')),
  first_activated_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  UNIQUE (license_id, device_fingerprint_hash)
);

CREATE INDEX idx_license_devices_license_id ON license_devices(license_id);
CREATE INDEX idx_license_devices_status ON license_devices(status);
```

#### license_refresh_tokens

```sql
CREATE TABLE license_refresh_tokens (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL REFERENCES license_devices(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_refresh_tokens_device_id ON license_refresh_tokens(device_id);
CREATE INDEX idx_refresh_tokens_expires_at ON license_refresh_tokens(expires_at);
```

#### license_payment_links

```sql
CREATE TABLE license_payment_links (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  provider_order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_license_payment_links_license_id
  ON license_payment_links(license_id);
CREATE INDEX idx_license_payment_links_customer
  ON license_payment_links(provider, provider_customer_id);
CREATE UNIQUE INDEX idx_license_payment_links_subscription
  ON license_payment_links(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX idx_license_payment_links_order
  ON license_payment_links(provider, provider_order_id);
```

说明：

1. 拉起支付时必须生成或获取支付平台订单 ID，并写入 `license_payment_links.provider_order_id`；
2. 不允许只把支付平台 ID 塞进 `licenses.metadata_json` 后再扫描查找；
3. 支付 webhook 必须从事件中提取支付订单 ID，并通过 `(provider, provider_order_id)` 在 `license_payment_links` 中定位 License；
4. `provider_subscription_id` 可用于记录订阅关系和辅助处理续费、取消、退款事件，但不得替代 `provider_order_id` 作为第二期首版的 License 定位依据；
5. `provider_customer_id` 只能作为辅助字段，不得单独作为 webhook 定位 License 的依据。
6. License 不提供物理删除 API，支付关联不得因后台误删 License 而级联丢失。

#### payment_events

```sql
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  license_id TEXT REFERENCES licenses(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  payload_hash TEXT NOT NULL,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,

  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_payment_events_license_id ON payment_events(license_id);
```

说明：License 不做物理删除，只能通过 `revoked / suspended / expired` 等状态表达失效；需要保留支付事件到 License 的结构化追溯链路。

#### license_audit_logs

```sql
CREATE TABLE license_audit_logs (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'admin', 'payment_webhook', 'client')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_audit_license_id ON license_audit_logs(license_id);
CREATE INDEX idx_audit_created_at ON license_audit_logs(created_at);
```

### 18.5.8 License Server API

#### 创建 License

```http
POST /v1/licenses
Authorization: Bearer <admin_token>
```

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
  paymentOrderId?: string;
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

要求：

1. 只在响应中返回一次明文 `activationCode`；
2. 服务端只保存 `activation_code_hash`；
3. 管理端必须记录 `license_audit_logs`；
4. 支付自动创建 License 时，来源必须关联 `payment_events`；
5. 支付自动创建 License 时，`paymentProvider` 必填且不能为 `manual`，并且必须包含 `paymentOrderId`；
6. `paymentOrderId` 必须在同一事务内写入 `license_payment_links.provider_order_id`；
7. `paymentSubscriptionId` 和 `paymentCustomerId` 只能作为辅助字段，不能单独创建可用于 webhook 定位的 `license_payment_links`；
8. `paymentProvider = "manual"` 时不得写入 `license_payment_links`。

#### 查询 License 状态

```http
POST /v1/licenses/status
```

请求：

```ts
type LicenseStatusRequest = {
  activationCode: string;
  deviceFingerprintHash: string;
  appVersion: string;
  platform: "macos" | "windows" | "linux";
};
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

说明：

1. 该接口只用于激活前展示，不返回 token；
2. 非 `active` 状态下，`entitlements.features` 必须全部为 `false`，或只返回明确允许的只读功能；
3. `expired / revoked / suspended` 不得返回原套餐的可用付费开关。

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
  deviceStatus: "active";
  licenseToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  refreshAfter: string;
  offlineGraceUntil: string;
  entitlements: LicenseEntitlements;
};
```

事务要求：

1. 根据 `activationCode` hash 锁定 License 行；
2. 校验状态、过期时间和设备数；
3. 如果 License 当前为 `inactive`，首次激活成功时在同一事务内更新为 `active`；
4. 如果同设备已激活，复用原设备绑定；
5. 如果新设备超过 `maxDevices`，拒绝激活；
6. 创建或更新 `license_devices`；
7. 创建新的 refresh token hash；
8. 签发 license token；
9. 写入审计日志。

#### 解绑当前设备

```http
POST /v1/licenses/deactivate-device
Authorization: Bearer <licenseToken>
```

请求：

```ts
type DeactivateDeviceRequest = {};
```

响应：

```ts
type DeactivateDeviceResponse = {
  licenseId: string;
  deviceId: string;
  status: LicenseStatus;
  deviceStatus: "deactivated";
  entitlements: LicenseEntitlements;
};
```

要求：

1. 服务端必须从 `licenseToken` 推导 `license_id / device_id`，不得信任请求 body 中的设备身份；
2. 服务端验签后必须查询 `licenses / license_devices` 当前状态，不能只信任 token payload；
3. `revoked / suspended / expired / device deactivated` 时必须拒绝解绑或返回当前不可用状态；
4. 解绑后撤销该设备所有 refresh token，但不得物理删除 refresh token 行；
5. 服务端必须返回 `deviceStatus="deactivated"` 和禁用后的 `entitlements`；
6. 客户端必须清除本地 token；
7. 服务端必须写入审计日志。

#### 刷新授权 token

```http
POST /v1/licenses/refresh-token
```

请求：

```ts
type RefreshLicenseTokenRequest = {
  refreshToken: string;
  appVersion: string;
};
```

响应：

```ts
type RefreshLicenseTokenResponse = {
  licenseToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  refreshAfter?: string;
  offlineGraceUntil?: string;
  status: LicenseStatus;
  deviceStatus: "active" | "deactivated";
  entitlements: LicenseEntitlements;
};
```

要求：

1. refresh token 必须 rotation；
2. 旧 refresh token 使用后立即撤销；
3. rotation 不得物理删除旧 refresh token 行，必须写入 `last_used_at / revoked_at` 并保留到 `expires_at` 或审计保留期结束；
4. 服务端必须从 refresh token hash 查出 `license_id / device_id`，不得信任请求 body 中的设备身份；
5. refresh token 校验、撤销旧 token、创建新 token、更新设备 `last_seen_at` 必须在同一数据库事务中完成；
6. 读取 refresh token 行时必须使用行级锁，例如 `SELECT ... FOR UPDATE`；
7. 状态为 `expired / revoked / suspended` 时仍返回状态，但不签发新的 `licenseToken / refreshToken`，且不返回可用付费功能；
8. 当前设备为 `deactivated` 时不签发新的 `licenseToken / refreshToken`，返回 `deviceStatus="deactivated"` 和禁用后的功能开关；
9. 写入审计日志；
10. 客户端 Rust 层必须对 `refresh_license_token` 做单飞，避免同一 refresh token 被并发使用；
11. MVP 不支持服务端重放同一次 rotation 结果，因为服务端不保存 refresh token 明文；
12. refresh token hash 命中记录后，必须先查询对应 `license_devices.status`；
13. 如果设备已 `deactivated`，优先返回 `deviceStatus="deactivated"`，不得把设备解绑误判为 `REFRESH_TOKEN_REUSED`；
14. 如果设备仍为 `active`，但 refresh token 行已存在 `revoked_at / last_used_at`，则返回 `REFRESH_TOKEN_REUSED`，客户端清除本地 token 并要求重新激活；
15. 客户端收到 `expired / revoked / suspended` 或 `deviceStatus="deactivated"` 后，必须清除系统密钥库中的 token，只保留 `license_state` 中的只读状态、设备状态和功能开关缓存。

#### 返回套餐功能开关

```http
POST /v1/licenses/entitlements
Authorization: Bearer <licenseToken>
```

请求：

```ts
type EntitlementsRequest = {};
```

响应：

```ts
type EntitlementsResponse = {
  licenseId: string;
  deviceId: string;
  status: LicenseStatus;
  deviceStatus: "active" | "deactivated";
  entitlements: LicenseEntitlements;
};
```

要求：

1. 服务端必须从 `licenseToken` 推导 `license_id / device_id`，不得信任请求 body 中的设备身份；
2. 服务端验签后必须查询 `licenses / license_devices` 当前状态，不能只信任 token payload；
3. 返回的 `status` 表达 License 状态，`deviceStatus` 表达当前设备绑定状态，不得用 `status=active` 隐藏设备已解绑；
4. `revoked / suspended / expired / device deactivated` 时必须返回禁用后的 `entitlements`；
5. 非 `active` 状态或 `deviceStatus="deactivated"` 时，`entitlements.features` 必须全部为 `false`，或只返回明确允许的只读功能。

#### 支付平台 webhook

```http
POST /v1/webhooks/payments/{provider}
```

要求：

1. 必须校验支付平台签名；
2. 必须按支付平台事件 ID 做幂等处理；
3. 必须从 webhook 事件中提取支付订单 ID，并通过 `license_payment_links(provider, provider_order_id)` 定位 License；
4. 不得通过 customer、metadata、邮箱、备注或描述字段猜测 License；
5. 支付成功时创建或续期 License；
6. 订阅取消、退款、支付失败时更新 License 状态或到期时间；
7. MVP 不保存 webhook 原始 body，只保存 `payload_hash`、事件 ID、处理状态和脱敏摘要；
8. webhook 处理必须在数据库事务中完成；
9. 重复事件如果已有 `processed / ignored` 状态，应直接返回成功；
10. 重复事件如果已有 `failed` 状态，允许在事务内重新处理，并更新 `processed_at / error_message / license_id`。

### 18.5.9 License Server 错误码

```ts
type LicenseServerErrorCode =
  | "LICENSE_NOT_FOUND"
  | "LICENSE_INACTIVE"
  | "LICENSE_EXPIRED"
  | "LICENSE_REVOKED"
  | "LICENSE_SUSPENDED"
  | "LICENSE_DEVICE_LIMIT_EXCEEDED"
  | "DEVICE_NOT_FOUND"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "REFRESH_TOKEN_INVALID"
  | "REFRESH_TOKEN_REUSED"
  | "PAYMENT_WEBHOOK_SIGNATURE_INVALID"
  | "PAYMENT_EVENT_DUPLICATED"
  | "RATE_LIMITED";
```

### 18.5.10 客户端本地表

```sql
CREATE TABLE license_state (
  id TEXT PRIMARY KEY,
  license_id TEXT,
  device_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'expired', 'revoked', 'suspended')),
  device_status TEXT CHECK (device_status IN ('active', 'deactivated')),
  local_auth_state TEXT NOT NULL DEFAULT 'inactive'
    CHECK (local_auth_state IN ('inactive', 'active', 'needs_reactivation', 'device_deactivated')),
  plan TEXT,
  token_expires_at TEXT,
  refresh_after TEXT,
  offline_grace_until TEXT,
  entitlements_json TEXT,
  last_checked_at TEXT,
  last_auth_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

说明：

1. `license_state` 只保存当前设备授权状态和功能开关缓存；
2. 不保存完整 `licenseToken` 和 `refreshToken`，两者都必须保存到系统密钥库；
3. `status` 表达 License 状态，`device_status` 表达当前设备绑定状态；
4. `local_auth_state` 表达本机授权链路状态，用于区分未激活、正常、需重新激活和当前设备已解绑；
5. `last_auth_error` 同时保存服务端授权错误码和本地授权错误码；
6. `REFRESH_TOKEN_REUSED` 不得把 `status` 改成不真实的 License 状态，只能更新 `local_auth_state / last_auth_error` 并禁用付费功能；
7. `entitlements_json` 只用于离线展示和短期离线宽限；
8. 读取 cached entitlements 前必须按 `status / device_status / local_auth_state` 归一化，禁止在本机授权不可用时返回历史 active 权益；
9. 授权状态变化不影响工作区数据完整性。

### 18.5.11 客户端 LicenseGuard

Rust 层必须提供统一授权守卫：

```rust
pub struct LicenseGuard;

impl LicenseGuard {
    pub async fn require_active(&self) -> Result<(), AppError>;
    pub async fn require_feature(&self, feature: LicenseFeature) -> Result<(), AppError>;
    pub async fn check_output_count(&self, count: u32) -> Result<(), AppError>;
    pub async fn check_model_access(&self, model: &ModelDefinition) -> Result<(), AppError>;
}
```

授权守卫规则：

1. `require_active` 必须先读取系统密钥库中的 `licenseToken` 并执行本地验签；
2. `require_active` 必须校验 `licenseToken.exp`、`license_state.token_expires_at` 和 `license_state.offline_grace_until`，token 已过期且超过离线宽限期时不得放行；
3. `require_active` 必须复用 `get_license_status` 的归一化规则，避免只读 SQLite 中的历史 active 状态；
4. `require_active` 必须同时满足 `license_state.status = 'active'`、`license_state.device_status = 'active'` 和 `license_state.local_auth_state = 'active'`；
5. `license_state.device_status IS NULL` 不得视为 active；
6. `require_feature / check_output_count / check_model_access` 必须先通过 `require_active`，再判断套餐功能开关和额度；
7. `require_active` 发现 token 缺失、验签失败、token 过期且离线宽限已过、或 cached entitlements 被归一化为禁用态时，必须返回明确的 License 错误码，不得静默降级为普通 `VALIDATION_ERROR`。

必须接入的 command：

| Command | 授权校验 |
| --- | --- |
| start_generation | `generation=true`、License active、设备 active、输出数量限制、高级模型限制 |
| rerun_generation_from_current_combination | 同 start_generation |
| retry_generation_task | 同 start_generation，但使用原任务模型快照判断 |
| export_results | `exportResult=true` |
| batch_generation | `batchGeneration=true` |
| save_prompt_template | `promptTemplates=true` 或数量未超限 |
| save_model_config | `multiModelConfig=true` 或仅允许默认模型 |

### 18.5.12 激活界面

入口：首次启动引导、设置页、执行节点未授权提示。

界面状态：

| 状态 | UI 行为 |
| --- | --- |
| 未激活 | 显示激活码输入框和激活按钮 |
| 激活中 | 禁用按钮，显示等待状态 |
| 已激活 | 显示套餐、到期时间、设备状态、解绑按钮 |
| 即将刷新 | 后台刷新授权，不阻塞用户当前操作 |
| 离线宽限 | 显示离线可用截止时间 |
| 已过期 | 禁用生成入口，提示续费或更换激活码 |
| 已撤销/暂停 | 禁用受限功能，提示联系支持 |

### 18.5.13 授权安全要求

1. 激活码不得写入日志；
2. `licenseToken / refreshToken` 不得写入日志、SQLite、任务摘要或前端持久化状态；
3. `licenseToken / refreshToken` 必须存系统密钥库；
4. License Server 必须全程 HTTPS；
5. 设备指纹必须先 hash 后上传；
6. License Server 数据库只保存 refresh token hash；
7. 支付 webhook 必须验证签名和幂等键；
8. 管理后台创建、撤销、续期 License 必须有管理员认证和审计日志；
9. 客户端不得直接从前端调用 License Server；
10. 所有授权请求必须由 Rust command 发起；
11. 公钥必须内置客户端，私钥绝不能进入客户端；
12. 支持签名密钥轮换，JWS header 必须包含 `kid`；
13. License Server 所有 HTTP API 必须使用 `POST`，不得通过 query string 传递激活码、token 或支付签名；
14. `deactivate / refresh / entitlements` 不得信任请求 body 中的 `deviceId`，设备身份必须从 token 或 token hash 推导；
15. 激活码必须高熵随机生成并使用服务端 pepper hash；
16. 激活码状态查询和激活接口必须限流，防止枚举和爆破；
17. refresh token rotation 必须处理并发请求，客户端单飞，服务端事务加行级锁。

# 19. 性能设计

## 19.1 图片预览

前端不要直接加载超大原图作为缩略图。

导入时必须生成缩略图：

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

* 同一 `assets.type` 内 `sha256` 命中时，直接复用已有 Asset，返回 `duplicate=true`，不创建新文件；
* 不同 `assets.type` 内 `sha256` 命中时，创建新的 Asset，用于保持人物图、服装图等业务角色隔离。

去重边界：

1. MVP 阶段只在同一 `assets.type` 内按 sha256 去重；
2. 同一张图片分别作为 `person` 和 `garment` 导入时，应创建两个不同 Asset；
3. 跨类型复用会混淆资源库分类、删除保护和任务输入角色，第一阶段不做；
4. `result` 类型图片不与输入图片跨类型去重，保证任务结果审计清晰。

---

## 19.3 并发控制

第一阶段固定：

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

固定配置：

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

# 20. UI 设计方案

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
  timeoutSeconds: number;
  enabled: boolean;
};
```

MVP 阶段只接入固定 Provider，不开放通用 `custom` Provider 配置面板，也不允许用户在工作区配置中覆盖 Provider Base URL。

原因：

1. 通用 `custom` Provider 会把产品范围扩大成 API 编排器；
2. 请求模板、响应路径和鉴权 Header 会显著增加校验、脱敏和调试复杂度；
3. 用户可配置 Base URL 会引入 SSRF、DNS 重绑定、跳转绕过和本地网络访问风险；
4. 对 MVP 来说，固定接入一个真实 Provider 更容易验证端到端闭环。

说明：如果开发环境确实需要覆盖 Provider Base URL，只能通过本地开发者配置或编译期配置完成，不得进入 `workspace.db`、工作区配置文件或可从 UI 编辑的 `ProviderSettings`。

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

第二阶段 custom Provider 不提供运行时 UI 开关来允许本地地址。仅本地开发构建允许通过编译期/环境开关临时放行本地地址，生产构建必须强制关闭：

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

激活码、授权 token、设备绑定和支付 webhook 如果处理不当，会导致授权绕过、设备数失控、伪造支付事件、重复发放权益或敏感 token 泄露。

措施：

* 激活码、`licenseToken`、`refreshToken` 不得写入日志；
* `licenseToken / refreshToken` 必须存系统密钥库，服务端只保存 refresh token hash；
* 设备指纹必须 hash 后上传；
* Rust 层在执行生成、导出、批量生成、高级模型等关键功能前读取授权状态和功能开关；
* License Server 必须校验支付 webhook 签名和事件幂等键；
* 管理端创建、续期、撤销 License 必须有管理员认证和审计日志；
* `revoked / suspended` 状态一旦同步到本地，必须立即禁用受限功能；
* 支持签名密钥轮换，客户端保留可用公钥集合；
* License Server 所有 HTTP API 使用 `POST`，敏感字段不得进入 URL query。

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
| 授权与 License Server | 第二期再做 |
| 支付 webhook | 第二期再做 |
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
* 应用启动时执行运行中任务恢复。

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
* API Key 配置。

交付：

```text
可选择模型
可配置 Prompt
可预览最终 Prompt
可校验是否可执行
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
* 任务历史。

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
| 35 | 桌面端商业授权边界缺失 | 新增轻量 License Server，限定只处理授权、设备、token、支付回调和功能开关 |
| 36 | 激活码验证如果只在前端实现容易被绕过 | 激活、刷新、套餐功能开关必须由 Rust 层调用 License Server 完成 |
| 37 | 授权 token 持久化存在泄露风险 | `licenseToken / refreshToken` 必须进入系统密钥库，SQLite 只保存授权状态和功能开关缓存 |
| 38 | 支付 webhook 可能被伪造或重复投递 | License Server 必须校验签名，并使用事件 ID 幂等处理 |
| 39 | 套餐功能开关如果只控制 UI 不可靠 | 生成、导出、高级模型等受限功能必须在 Rust 执行入口再次校验 |
| 40 | License Server 缺少可落地后端模型 | 补充 Go + PostgreSQL 技术选型、表结构、API、token rotation 和审计日志 |
| 41 | 激活码放在 URL query 会进入访问日志 | License Server 所有 HTTP API 统一使用 POST，激活码和 token 只允许放 body 或 Authorization |
| 42 | 支付 webhook 缺少稳定 License 关联 | 增加 `license_payment_links`，拉起支付时写入支付平台订单 ID，webhook 通过 `(provider, provider_order_id)` 定位 License |
| 43 | `licenseToken` 存储和验签声明不完整 | 明确 `licenseToken / refreshToken` 都存系统密钥库，token payload 包含 `iat / nbf / exp`，JWS header 包含 `kid` |
| 44 | 请求 body 中的 deviceId 可被客户端伪造 | `deactivate / refresh / entitlements` 的设备身份必须由服务端从 token 或 token hash 推导 |
| 45 | 激活码 hash 和限流缺失会导致枚举或离线爆破 | 明确高熵激活码、server pepper hash、接口限流和统一错误 |
| 46 | refresh token rotation 并发语义不清 | 客户端 refresh 单飞，服务端事务加行级锁，旧 token 重放统一返回 `REFRESH_TOKEN_REUSED` |
| 47 | `license_payment_links` nullable unique 语义不严谨 | `provider_order_id` 改为必填并加唯一索引，subscription/customer 仅作为辅助字段 |

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
26. 授权、License Server、设备激活、套餐功能开关和支付 webhook 不进入本期 MVP。

---

## 25.3 后续阶段可扩展项

以下能力不进入 MVP，但 schema 和服务边界应预留：

| 能力 | 落地阶段 | 说明 |
| --- | --- | --- |
| PromptBinding 多版本 | 第二阶段 | 支持 Prompt A/B 实验、版本命名、回滚 |
| 多任务队列 | 第二阶段 | 引入 `maxConcurrentTasks`、队列策略、任务优先级 |
| 批量生成 | 第二阶段 | 基于多个 ImageCombination 批量执行 |
| Provider 调试面板 | 第二阶段 | 查看脱敏请求摘要和 Provider 响应摘要 |
| 通用 custom Provider | 第二阶段 | 需完成 Base URL、DNS、跳转、鉴权模板、响应路径和脱敏校验 |
| License Server | 第二阶段 | 授权、设备激活、token、套餐功能开关和支付 webhook |
| 本地模型 Provider | 第二/三阶段 | 需重新评估本地地址访问安全策略 |
| 工作流 DAG 化 | 第三阶段 | 节点输入输出 schema、拓扑执行、节点缓存 |
| License 管理后台 | 第二阶段 | 可视化创建、续期、撤销 License 和查看设备绑定审计 |
| 企业授权席位管理 | 第三阶段 | 团队成员、席位分配、组织级设备策略和批量解绑 |
| 企业离线授权文件 | 第三阶段 | 给无公网环境客户签发长周期离线授权文件 |

---

## 25.4 给 Codex 的开发落地顺序

按以下顺序实现，避免返工：

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
21. UI 任务历史与结果展示 + 启动主动拉取任务状态
22. Provider 返回摘要脱敏 + source_url 安全保存
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
同一文件以相同 type 重复导入时，必须直接复用已有 Asset，并返回 duplicate=true。
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
```

### 孤儿文件 GC 验收

```text
删除未引用 asset 时模拟文件删除失败：
应用启动后或打开资源库时，轻量 GC 应清理工作区内未被 SQLite 引用的孤儿文件。
GC 不得扫描或删除用户导入前的原始文件路径。
```

### 取消任务验收

```text
Provider 支持远端取消时，应记录 remote_confirmed。
Provider 不支持远端取消时，应记录 remote_not_supported，并提示可能继续计费。
```


### License Server 数据库验收（第二期）

```text
以下授权和支付验收不进入本期 MVP。
```

```text
License Server 必须包含 licenses、license_devices、license_refresh_tokens、license_payment_links、payment_events、license_audit_logs 表。
activation_code 必须只保存 HMAC-SHA256(serverPepper, normalizedActivationCode)。
refreshToken 必须只保存 hash。
支付平台 order 与 License 的关系必须保存为 `license_payment_links.provider_order_id` 结构化索引，不得只放 metadata_json。
payment_events 必须用 license_id 结构化关联支付事件创建或影响的 License。
License 不得物理删除；License 相关子表外键不得通过 ON DELETE CASCADE 丢失设备、token 或支付追溯记录。
license_payment_links.provider_order_id 必须非空。
provider_customer_id 和 provider_subscription_id 只能作为辅助字段，不能单独作为 webhook 定位 License 的依据。
provider_order_id 必须使用 `(provider, provider_order_id)` 唯一索引。
所有 License 创建、激活、解绑、撤销、支付同步动作必须写入审计日志。
```

### License 创建验收（第二期）

```text
后台或支付成功流程调用 POST /v1/licenses 创建 License 后：
必须返回 activationCode、licenseId、status 和 entitlements。
明文 activationCode 只允许返回一次。
activationCode 必须是高熵随机值，不得使用可枚举短码。
支付自动创建 License 时必须包含 paymentOrderId，并同事务写入 license_payment_links.provider_order_id。
仅包含 paymentCustomerId 或 paymentSubscriptionId 时不得创建可用于 webhook 定位的 license_payment_links。
传入 paymentOrderId 时，paymentProvider 必填且不能为 manual。
paymentProvider = manual 时不得写入 license_payment_links。
License Server 不得保存用户图片、Prompt、任务历史或工作区数据库。
```

### License 状态查询验收（第二期）

```text
客户端输入激活码后查询状态：
必须调用 POST /v1/licenses/status，activationCode 只能放请求 body。
请求 body 必须包含 deviceFingerprintHash、appVersion 和 platform，以便服务端限流。
状态查询和激活接口必须限流，连续失败不得暴露 License 是否存在。
active 应展示套餐、到期时间、设备数量和功能开关。
expired / revoked / suspended 必须给出明确状态，不得允许继续激活受限功能。
expired / revoked / suspended 返回的 entitlements.features 必须全部为 false，或仅包含明确允许的只读功能。
查询过程不得把激活码写入日志。
```

### 设备激活与解绑验收（第二期）

```text
activate_license 必须由 Rust 层生成设备指纹摘要并调用 License Server。
installationId 和 appInstallSalt 必须首次启动随机生成并保存到系统密钥库。
deviceFingerprintHash 必须由 HMAC-SHA256(appInstallSalt, installationId) 计算。
同一设备重复激活不得重复占用设备数。
设备数超过 maxDevices 时必须返回 LICENSE_DEVICE_LIMIT_EXCEEDED。
activate_license 成功后必须写入 license_state.device_status=active / local_auth_state=active。
activate_license 成功后必须清空 license_state.last_auth_error。
deactivate_current_device 成功后不得伪造 License 状态；必须保留服务端返回或本地已知的 License status，并写入 license_state.device_status=deactivated / local_auth_state=device_deactivated。
deactivate-device 服务端响应必须包含 status、deviceStatus=deactivated 和禁用后的 entitlements。
deactivate_current_device Tauri command 必须返回 LicenseStatusView，供前端立即刷新激活界面和套餐功能开关。
deactivate_current_device 不得向服务端传递 deviceId，服务端必须从 licenseToken 推导当前设备。
deactivate_current_device 服务端验签后必须查询 licenses / license_devices 当前状态，不能只信任 token payload。
解绑后服务端必须标记当前设备为 deactivated，并标记该设备 refresh token revoked_at，但不得物理删除 refresh token 行。
解绑后受限功能入口必须立即禁用。
```

### 授权 Token 刷新验收（第二期）

```text
应用启动时应尝试 refresh_license_token。
licenseToken 未到 refreshAfter 时可继续使用缓存 entitlements。
licenseToken / refreshToken 必须保存在系统密钥库，不得出现在 SQLite、日志或前端持久化状态中。
refresh token 必须 rotation，旧 token 使用后应立即失效。
rotation 后的旧 refresh token 记录不得物理删除，必须保留 revoked_at / last_used_at 以识别重放。
Rust 层必须对 refresh_license_token 做单飞。
License Server 必须在事务中用行级锁处理 refresh token rotation。
服务端不得为并发 refresh 保存或重放 refresh token 明文。
旧 refresh token 被再次使用时必须返回 REFRESH_TOKEN_REUSED，并要求重新激活。
设备已解绑时使用旧 refresh token 刷新，必须优先返回 deviceStatus=deactivated，不得误判为 REFRESH_TOKEN_REUSED。
客户端收到 REFRESH_TOKEN_REUSED 后必须清除系统密钥库 token，写入 license_state.local_auth_state=needs_reactivation / last_auth_error=REFRESH_TOKEN_REUSED，并禁用付费功能。
客户端收到 REFRESH_TOKEN_REUSED 后不得把 license_state.status 改成 inactive，除非服务端明确返回 License status=inactive。
active 状态刷新成功时，客户端必须写回新的 licenseToken / refreshToken。
active 状态刷新成功时，客户端必须写入 license_state.device_status=active / local_auth_state=active。
active 状态刷新成功时，客户端必须清空 license_state.last_auth_error。
系统密钥库缺少 refreshToken 时，refresh_license_token 不得调用 License Server，必须清除残留 licenseToken，返回禁用视图，并写入 lastAuthError=KEYCHAIN_TOKEN_MISSING。
系统密钥库读取 refreshToken 失败时，refresh_license_token 不得调用 License Server，必须返回禁用视图，并写入 lastAuthError=KEYCHAIN_READ_FAILED。
expired / revoked / suspended 时不得返回新的 licenseToken / refreshToken。
客户端收到 expired / revoked / suspended 后必须清除系统密钥库 token，写入 local_auth_state=inactive，并缓存禁用后的 entitlements。
客户端收到 deviceStatus=deactivated 后必须清除系统密钥库 token，写入 license_state.device_status=deactivated / local_auth_state=device_deactivated，并缓存禁用后的 entitlements。
网络失败但仍在 offlineGraceUntil 内时，refresh_license_token 必须返回 offline=true / lastAuthError=LICENSE_SERVER_UNAVAILABLE，并保持 local_auth_state=active。
超过 offlineGraceUntil 后，refresh_license_token 必须写入 local_auth_state=inactive / lastAuthError=LICENSE_OFFLINE_GRACE_EXPIRED，并禁用付费 feature。
超过 offlineGraceUntil 后，付费功能必须禁用，但不得破坏本地工作区数据。
```

### 支付 Webhook 验收（第二期）

```text
License Server 接收支付平台 webhook 时必须验证平台签名。
同一事件 ID 重复投递只能处理一次。
支付成功应创建或续期 License。
订阅取消、退款、支付失败应更新 License 状态或到期时间。
webhook 必须通过 license_payment_links(provider, provider_order_id) 定位 License。
webhook 不得扫描 licenses.metadata_json 定位支付关系。
License 不得物理删除；支付事件必须保留 license_id 结构化追溯链路。
重复 webhook 事件为 processed / ignored 时必须直接返回成功。
重复 webhook 事件为 failed 时必须允许重新处理，并更新 processed_at / error_message / license_id。
webhook 原始 body 不保存；只保存 payload_hash、事件 ID、处理状态和脱敏摘要。
```

### 套餐功能开关验收（第二期）

```text
get_license_entitlements 必须返回 licenseId、deviceId、status 和 entitlements。
get_license_entitlements 必须返回 deviceStatus，用于区分 License active 但当前设备已解绑的场景。
get_license_entitlements Tauri command 必须返回 LicenseStatusView，并包含 localAuthState / lastAuthError。
get_license_entitlements 服务端 EntitlementsResponse 不得直接透传给前端，Rust 必须转换为 LicenseStatusView。
EntitlementsResponse 转换为 LicenseStatusView 时，status / deviceStatus / entitlements 来自服务端，tokenExpiresAt / refreshAfter / offlineGraceUntil / localAuthState / lastAuthError / offline 来自本地缓存、系统密钥库校验和本次请求结果。
get_license_entitlements active 成功时必须写入 offline=false，清空 license_state.last_auth_error，并将 local_auth_state 置为 active。
get_license_entitlements 服务端验签后必须查询 licenses / license_devices 当前状态，不能只信任 token payload。
get_license_entitlements 必须用服务端返回的 status / deviceStatus 同步更新本地 license_state.status / license_state.device_status。
系统密钥库没有 licenseToken 时，get_license_entitlements 不得调用 License Server，必须返回本地禁用后的 cached entitlements。
系统密钥库没有 licenseToken 时，cached entitlements 必须按 status / device_status / local_auth_state 归一化，付费 feature 必须全部为 false。
授权不可用时，cached entitlements 的付费 limits 必须归零或降为只读安全默认值，不得沿用历史 active 额度。
get_license_status 在系统密钥库没有 licenseToken 时不得报硬错误，必须返回 lastAuthError=KEYCHAIN_TOKEN_MISSING 的禁用视图。
get_license_status 在系统密钥库读取失败时必须返回 lastAuthError=KEYCHAIN_READ_FAILED 的禁用视图。
get_license_status 本地 token 验签成功且 local_auth_state=active 时，必须清空 license_state.last_auth_error。
revoked / suspended / expired / device deactivated 时必须返回禁用后的 entitlements。
客户端收到 revoked / suspended / expired / device deactivated 后必须清除系统密钥库 token。
LicenseGuard.require_active 必须读取系统密钥库中的 licenseToken 并完成本地验签。
LicenseGuard.require_active 必须校验 token 过期时间和 offlineGraceUntil，超过离线宽限后不得放行付费功能。
LicenseGuard.require_active 必须复用 get_license_status 的归一化规则，不得只读取 SQLite 中的历史 active 字段。
LicenseGuard.require_active 必须同时要求 license_state.status=active 且 license_state.device_status=active。
LicenseGuard.require_active 必须同时要求 license_state.local_auth_state=active。
license_state.device_status 为空时不得放行付费功能。
generation=false 时 start_generation 必须失败并返回 FEATURE_NOT_ENTITLED。
exportResult=false 时导出入口必须禁用，Rust 导出命令也必须拒绝执行。
validate_combination 返回值必须包含结构化 license 状态、effectiveEntitlements 和 featureDeniedReason，不得只返回文案 reasons。
maxOutputCount 必须通过 ModelDefinition.output.countParamKey 归一化为 normalizedOutputCount 后参与 validate_combination 和 start_generation 校验。
advancedModels=false 时前端不可选择高级模型，Rust 执行入口也必须拒绝高级模型配置。
```

### 签名密钥轮换验收（第二期）

```text
licenseToken 必须包含 iat、nbf、exp。
JWS header 必须包含 kid。
客户端必须支持至少两个有效公钥的验证窗口。
服务端轮换签名私钥后，旧 token 在有效期内仍可被客户端验证。
私钥不得出现在客户端、日志、仓库和构建产物中。
```
