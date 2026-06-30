# AI 服装展示图生成桌面端 MVP 实施决策

> 创建时间：2026-06-12
>
> 来源方案：`docs/2026-06-11-commerce-tryon-v3.5-license-reviewed.md`
>
> 执行清单：`docs/2026-06-11-commerce-tryon-v3.5-implementation-checklist.md`

## 1. 决策目标

本文冻结 v3.5 第一阶段 MVP 的开发边界、强制约束和阶段评审点。

后续开发人员只看本文和实施清单时，应能判断：

1. 本期必须交付什么；
2. 本期明确不做什么；
3. 哪些变更进入编码前必须单独确认；
4. 每个阶段如何证明自己没有越界。

## 2. MVP 必交付范围

MVP 只交付本地单机商拍生成工作流：

1. 桌面端应用使用 Tauri 2.x、React 和 TypeScript。
2. 工作流采用固定链路画布：
   `人物图 -> 服装图组 -> Prompt -> 模型 -> 执行 -> 结果`。
3. 图片、组合、Prompt 绑定、模型配置、任务历史和结果只保存在本地工作区。
4. 本地状态权威来源为 Rust command、SQLite 和工作区 assets 文件目录。
5. 前端只保存 UI 草稿、选中态、缓存和派生状态。
6. 接入至少一个固定真实第三方 Provider。
7. 任务执行必须保存不可变快照，包括 final prompt、模型参数和输入 asset 相对路径。
8. 任务状态机必须支持启动恢复、取消、重试、重跑、历史展示和事件兜底。
9. 安全收口必须覆盖 API Key、Authorization Header、Provider 请求摘要、本地路径和 raw response 脱敏。

## 3. 仓库目录边界

本仓库包含两个项目，按阶段分别放置代码：

```text
commerce-shoot-studio/
├── desktop/          # 第一期：Tauri 2 + React + TypeScript 桌面端
├── license-server/   # 第二期：Go + Gin + PostgreSQL 授权后端
└── docs/             # 方案、任务清单和验收文档
```

目录约束：

1. 第一期所有桌面端代码、依赖、前端源码和 Tauri Rust 代码都放在 `desktop/`。
2. 第二期授权后端代码放在 `license-server/`。
3. `docs/` 只保存方案、任务清单、验收报告和设计决策。
4. 仓库根目录不放具体业务源码，只保留仓库级说明、许可证和必要配置。

## 4. MVP 明确不交付范围

以下能力本期不实现，也不得在 MVP 代码路径中预留可启用入口：

1. 不做通用 DAG 工作流引擎。
2. 不允许用户新增核心节点、删除核心节点或任意连线。
3. 不做自定义脚本节点。
4. 不做云端商拍业务后端。
5. 不做云端业务数据同步。
6. 不做多人协作和多用户权限。
7. 不做自建 AI 推理服务。
8. 不做批量队列或多任务并发。
9. 不做复杂图片编辑器。
10. 不开放通用 custom Provider。
11. 不允许用户覆盖 Provider base URL。
12. 不接入 License Server、设备激活、套餐功能开关或支付 webhook。

## 5. 强制工程约束

### 5.1 本地数据边界

1. 图片文件复制到工作区 assets 目录。
2. SQLite 只保存工作区相对路径，不保存用户导入前的完整本地路径。
3. 结果图片也必须进入工作区资产体系。
4. `sha256` 只作为同一 `assets.type` 内的去重字段，不参与文件名生成。
5. 文件名使用 `asset_<ULID>.<ext>`。

### 5.2 API Key 与敏感信息

1. API Key 只能由 Rust 层读取和使用。
2. API Key 不得进入前端持久化状态。
3. API Key 不得写入 SQLite。
4. API Key 不得进入日志、任务摘要或 raw response。
5. 前端只展示是否已配置和脱敏状态。
6. Provider 的 Authorization Header、签名 URL、临时凭证和完整请求体必须脱敏或不持久化。

### 5.3 工作流与状态权威

1. React Flow 只负责节点渲染态、视口、拖拽、缩放和选中交互。
2. React Flow `nodes[].data` 只能从 Zustand、React Query 或 Rust command 结果派生。
3. React Flow `nodes[].data` 不得作为业务事实持久化。
4. Zustand 只保存当前草稿、选中节点和 UI 派生状态。
5. SQLite / Rust command 是已保存业务事实的权威来源。

### 5.4 Prompt 与模型

1. PromptResolver 只在 Rust 层实现。
2. Prompt 预览和执行快照必须共用同一个 Rust Resolver。
3. MVP 支持 `default`、`append`、`override` 三种 Prompt 修改模式。
4. 模型定义使用 Rust 静态注册表。
5. 服装图数量限制从 `ModelDefinition.inputLimits` 派生。
6. 输出数量通过 `ModelDefinition.output.countParamKey` 归一化为 `normalizedOutputCount`。

### 5.5 任务状态机

1. MVP 全局只允许一个运行中生成任务。
2. 单任务并发必须由 Rust AppState 和 SQLite partial unique index 双重保证。
3. 运行中状态集合为：
   `queued`、`preparing`、`calling_model`、`waiting_result`、`saving_result`。
4. 应用启动时必须把历史运行中任务置为 `failed`。
5. 启动恢复失败码固定写入 `APP_UNEXPECTED_SHUTDOWN`。
6. 任务历史和快照不得因恢复、取消、重试或重跑被删除。

## 6. 第二期边界

第二期才允许实现：

1. License Server。
2. 设备激活。
3. 授权 token 与 refresh token。
4. 套餐功能开关。
5. 支付 webhook。
6. License Server 管理端和审计链路。

第二期 License Server 只能处理商业授权、设备、token、支付回调和功能开关。

它不得保存：

1. 用户导入图片；
2. 生成结果；
3. Prompt 内容；
4. 任务历史；
5. 工作区数据库；
6. 商拍业务状态。

## 7. 需人工确认或阶段评审的变更

以下任务进入编码前必须单独确认影响范围，或在阶段评审中记录结论：

1. T01：在 `desktop/` 初始化 Tauri、React、TypeScript 和相关依赖，会新增依赖与锁文件。
2. T02：接入 React Flow、Zustand 和 React Query，会新增前端依赖。
3. T03：引入 SQLx、SQLite migration 和工作区目录策略，涉及数据库结构与配置。
4. T05-T10：新增或修改 SQLite 表、Rust command 和前端服务契约。
5. T18-T22：新增任务状态机表结构、Provider 适配和生成执行契约。
6. T23-T27：新增取消、重试、凭据、安全配置和日志脱敏契约。
7. T11-T17、T28-T29：全部属于第二期，不进入本期 MVP。

未经确认，不得主动新增第三方依赖、数据库 migration、环境变量、公共 API 或跨包重构。

## 8. 验收映射

### 8.1 对应方案 23.1 第一版必须交付

本文第 2 节覆盖第一版必须交付的本地桌面应用、固定工作流、图片导入、组合、Prompt、模型、任务执行、结果保存和安全收口。

### 8.2 对应方案 23.2 第一版暂不交付

本文第 4 节覆盖第一版暂不交付的通用 DAG、脚本节点、云端业务后端、多人协作、复杂图片编辑、自定义 Provider、License Server 和支付 webhook。

### 8.3 对应方案 25.2 MVP 强制约束

本文第 5 节覆盖 API Key 安全、单任务并发、PromptResolver 单权威、本地相对路径、固定 Provider、任务快照、启动恢复和第二期授权边界。

## 9. T00 退出条件

T00 完成后，后续开发必须遵守：

1. 不做本文明确禁止的 MVP 外能力。
2. 不把第二期授权和支付能力提前接入本期代码路径。
3. 不把 API Key、完整本地路径、base64 图片、Authorization Header 或 Provider raw response 写入不安全存储。
4. 涉及依赖、数据库、配置、公共命令契约的任务，先确认或在阶段评审中记录。
