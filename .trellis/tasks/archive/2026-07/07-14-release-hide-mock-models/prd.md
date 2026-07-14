# Release 隐藏 Mock 模型并升级 Actions

## Goal

消除 GitHub Actions 的 Node.js 20 弃用告警，并确保正式打包的 Release 应用不再暴露或执行 `mock-local` 模型；本地 Debug 开发和自动化测试继续保留确定性 Mock 能力。

## Background

- 当前打包 workflow 使用基于 Node.js 20 runtime 的旧版 `actions/checkout` 与 `actions/setup-node`。
- `desktop/src-tauri/src/services/model_config.rs` 会在模型配置读取和执行前动态补种 `mock-local` 默认配置，Release 与 Debug 没有构建门禁。
- `desktop/src/features/model-config/components/ModelConfigPage.tsx` 仍有静态 Mock 选项、空配置 Mock 回退和恢复 Mock 默认值逻辑。
- 仅隐藏前端选项无法阻止旧工作区中已有的 Mock 默认配置继续被 Release resolver 或 deterministic gateway 使用。

## Requirements

1. GitHub Actions 使用官方 Node.js 24 runtime 版本并继续固定完整 commit SHA：
   - `actions/checkout` 升级至 `v7.0.0`。
   - `actions/setup-node` 升级至 `v6.4.0`。
   - 项目构建 Node 保持 `22.22.0`，不修改依赖或锁文件。
2. Debug 与普通测试构建继续暴露、补种和执行 `mock-local`。
3. Release 构建必须：
   - 不返回 `mock-local` provider profile 或 Mock 模型配置。
   - 不补种 Mock 配置，并清理旧工作区 `model_configs` 中已有的 Mock 行。
   - 拒绝通过查询、保存、默认配置解析或 deterministic gateway 继续使用 Mock。
   - 保留 `model_invocations` 等既有历史审计记录。
4. 模型配置页以 runtime 返回的 provider profiles 为显示事实源：
   - Release 不显示 `Mock Local`、`mock-*` 或 `mock://local`。
   - provider profiles 为空时不得回退静态 Mock。
   - “恢复默认”在 Debug 保持 Mock 行为，在 Release 只生成真实 Provider 草稿且保存后才生效。
5. 不新增环境变量、数据库 migration、Tauri capability、依赖或公共 Runtime DTO。
6. 同步长期项目文档，明确 Mock 仅限 Debug/测试，Release 不暴露。

## Acceptance Criteria

- [x] workflow 中 checkout/setup-node 使用已核验的 Node.js 24 Action runtime 完整 SHA，项目 Node 仍为 `22.22.0`。
- [x] Debug 构建与普通自动化测试仍可看到并使用 Mock Local。
- [x] Release provider profiles、配置列表和模型配置 UI 均不渲染 `mock-local`、`Mock Local`、`mock-*` 或 `mock://local`。
- [x] 全新工作区与预存 Mock 配置的旧工作区都满足 Release 隐藏与拒绝执行合同。
- [x] Release 清理当前 Mock 配置时不删除历史模型调用审计。
- [x] Release 没有真实默认配置时明确不可用，不自动选择真实模型参与执行。
- [x] OpenAI、DeepSeek、火山引擎的选择、保存和连接测试不受影响。
- [x] 前端定向测试、Rust Debug 测试、Rust Release 门禁测试、release check、workflow 静态检查与文档一致性检查通过。

## Out of Scope

- 升级项目运行时 Node.js 版本或 npm/Rust 依赖。
- 删除 deterministic mock adapter 或依赖它的 Debug/自动化测试。
- 删除历史任务、历史模型调用或改变审计数据。
- 修改模型配置公共 DTO、数据库 schema 或 UI 视觉设计。
