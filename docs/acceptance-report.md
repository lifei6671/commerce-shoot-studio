# 商拍工坊 v3.5 MVP 验收报告

日期：2026-06-16

## 结论

本地自动化验收通过，桌面端 MVP 的工作台、Prompt、任务状态机、历史追溯、取消、重试、重跑、资源管理和安全脱敏边界已具备小范围评审条件。

仍有 3 个需要人工或外部环境完成的验收缺口：

1. 固定真实 Provider 成功调用：需要有效 Provider API Key 和可访问网络。
2. MVP 主流程真实生成保存：依赖固定真实 Provider 成功调用。
3. macOS Keychain UI 级凭据保存/读取：需要在本机运行 app 后手动确认系统密钥库状态。

## 验证命令

- `npm --prefix desktop run test`：通过，102 个前端测试通过。
- `npm --prefix desktop run build`：通过。
- `make cargo-check`：通过。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib -- --nocapture`：通过，103 个 Rust 单测通过。
- `npm --prefix desktop run tauri -- build --no-bundle`：通过。
- `git diff --check`：通过。

## MVP 验收项

### Prompt 一致性验收

状态：通过。

依据：
- Rust PromptResolver 单测覆盖模板解析、变量替换、默认值、追加和覆盖模式。
- 前端测试覆盖输出方案预览、剪贴板文案和工作台绑定恢复。
- 任务快照中的 `final_prompt_snapshot_json` 来自 Rust PromptResolver。

### Prompt 模板变量验收

状态：通过。

依据：
- 前端测试覆盖模板变量从正文识别、选项去重、默认值保留、可选可输入变量和方案中心变量默认值展示。
- Rust 单测覆盖缺失必填变量、未声明占位符和未使用变量告警。

### 任务快照验收

状态：通过。

依据：
- Rust 单测覆盖任务创建时持久化输入、Prompt、模型、资源和输出数量快照。
- 前端任务历史详情展示输入快照、最终 Prompt 和模型参数。
- 历史任务详情使用执行时快照，不依赖当前组合状态。

### retry/rerun 验收

状态：通过。

依据：
- Rust 单测覆盖 retry 使用原任务快照、rerun 使用当前组合和当前 Prompt。
- 前端任务历史提供“重试任务”和“按当前配置重跑”两个独立入口。
- 前端测试覆盖两个入口不会混成同一个动作。

### 数据库脱敏验收

状态：通过。

依据：
- Provider API Key 只由 Rust 读取系统密钥库，不写入 SQLite。
- `model_configs` 仅保存 provider、model_id 和 params_json。
- Provider summary 校验拒绝 API Key、Authorization、raw response、base64/data URL 和完整本地用户路径。

### 删除资源验收

状态：通过。

依据：
- Rust 单测覆盖被组合引用、被任务输入引用、被任务结果引用的 asset 禁止删除。
- 未引用 asset 删除会删除数据库记录和工作区文件。
- 文件删除失败会进入 GC 队列。

### 图片去重验收

状态：通过。

依据：
- Rust 单测覆盖同类型图片按 sha256 去重。
- 不同 asset type 之间不会误判重复。

### 草稿校验验收

状态：通过。

依据：
- Rust 单测覆盖当前草稿资源、Prompt binding、模型配置、输出数量和模型限制派生。
- 前端执行入口依赖 `validate_combination` 的权威结果。

### 单任务并发验收

状态：通过。

依据：
- Rust 单测覆盖已有运行中任务时拒绝第二个任务。
- AppState CancellationToken 创建和清理有单测覆盖。
- SQLite partial unique index 和 Rust 单飞机制共同约束运行中任务。

### 启动恢复验收

状态：通过。

依据：
- Rust 单测覆盖启动时将未完成任务标记为 `APP_UNEXPECTED_SHUTDOWN`。
- 恢复后的任务可被 recent task 查询返回。

### 事件兜底验收

状态：通过。

依据：
- Rust 单测覆盖生成流程会通知任务状态变化。
- 前端监听 `task-updated` 后读取任务详情并刷新 running/recent 列表。
- 前端启动时主动拉取 running/recent 列表，避免只依赖实时事件。

### 重试文件检查验收

状态：通过。

依据：
- Rust 单测覆盖 retry 时原输入文件缺失返回 `ASSET_FILE_MISSING`。
- 错误包含 assetId、fileName 和 role，便于用户定位缺失输入。

### 路径脱敏验收

状态：通过。

依据：
- Provider summary 校验拒绝完整 macOS 用户路径。
- 任务结果 `source_url` 写库前会拒绝带 token、signature、API key、Authorization 等敏感 query 的 URL。
- 工作区文件路径由 Rust command 控制，前端不直接持久化导入源路径。

### 孤儿文件 GC 验收

状态：通过。

依据：
- Rust 单测覆盖 GC 只处理工作区内 `assets/` 相对路径。
- GC 拒绝绝对路径、父级跳转路径和非 assets 路径。

### 取消任务验收

状态：通过。

依据：
- Rust 单测覆盖执行中取消、Provider 支持远端取消和不支持远端取消两种记录。
- 取消后可再次创建新任务。
- UI 侧保留本地取消和可能继续计费的提示。

## 未执行项与风险

### 剩余人工验收顺序

按依赖关系，剩余 3 项应按以下顺序执行：

1. 先验收 macOS Keychain 凭据保存。
   - 在模型设置中保存真实 Provider API Key。
   - 重启 app 后确认设置页只展示已配置状态和脱敏尾号。
   - 确认 SQLite、前端持久化状态和任务摘要中没有明文 API Key。

2. 再验收固定真实 Provider 成功调用。
   - 保持网络可访问。
   - 使用一组可公开测试的人物图和服装图执行生成。
   - 确认 Provider 返回成功，失败时错误码和失败原因可读且不含敏感请求信息。

3. 最后验收 MVP 主流程真实生成保存。
   - 确认结果图片保存到工作区。
   - 确认结果出现在资源库结果图、画布结果节点和任务历史详情中。
   - 确认任务历史能展示输入快照、最终 Prompt、模型参数、执行摘要和结果图。

只有以上 3 项都通过，或产品侧明确接受对应剩余风险后，T20、T21、T26 和 T30 的退出条件才能勾选。

### 本机验收记录模板

运行本地 app：

```bash
make dev
```

Keychain 条目检查只确认条目存在，禁止使用会打印明文的 `-w` 参数：

```bash
security find-generic-password \
  -s commerce-shoot-studio.provider-api-key \
  -a openai
```

SQLite 脱敏检查以当前工作区底部显示的路径为准，把 `<workspace>` 替换成实际工作区目录：

```bash
sqlite3 "<workspace>/workspace.db" \
  "SELECT provider, model_id, params_json FROM model_configs;"
```

验收结果记录：

- Keychain 条目存在：未执行。
- 重启后设置页只显示脱敏尾号：未执行。
- SQLite 中未出现明文 API Key：未执行。
- 真实 Provider 调用成功：未执行。
- 结果图进入资源库、画布结果节点和任务历史：未执行。
- 任务历史展示输入快照、最终 Prompt、模型参数和结果图：未执行。

### 固定真实 Provider 成功调用

状态：未执行。

原因：
- 当前环境没有可用于真实调用的 Provider API Key。
- 网络访问受限，不适合在此环境执行真实第三方 API 请求。

风险：
- OpenAI Provider 的真实成功响应格式、图片返回字段和速率限制行为仍需在真实 API 环境复核。

后续验收：
- 在本地 app 中配置真实 API Key。
- 用一组人物图和服装图执行生成。
- 确认结果图片保存到工作区，并在任务历史中可查看结果和执行摘要。

### MVP 主流程真实生成保存

状态：未执行。

原因：
- 依赖固定真实 Provider 成功调用。

风险：
- Provider 成功调用链路未做真实端到端验收前，MVP 不能声明已完成真实生图闭环。

后续验收：
- 完成固定真实 Provider 成功调用后，复查生成结果 asset、`generation_task_results` 和任务历史详情。

### macOS Keychain UI 级凭据保存/读取

状态：未执行。

原因：
- 自动化单测已覆盖凭据状态和脱敏展示，但未在运行中的 macOS app 中人工确认 Keychain 项。

风险：
- 系统 Keychain 权限弹窗、用户拒绝授权或本机 Keychain 状态异常仍需人工验收。

后续验收：
- 在模型设置中保存 API Key。
- 重启 app 后确认只显示脱敏尾号。
- 通过 Keychain Access 或系统命令确认明文未进入 SQLite 或前端持久化状态。

## 交付物验收

- 桌面端 Tauri + React 应用：通过。
- 固定工作流画布：通过。
- 本地 SQLite migration 与工作区 assets 文件目录：通过。
- 图片导入、组合保存、Prompt 预览、模型配置：通过。
- 固定 Provider Adapter：部分通过，真实成功调用未执行。
- 本地任务状态机、事件推送、主动拉取兜底：通过。
- 取消、重试、重跑、历史和结果展示：通过。
- 日志脱敏、Tauri 安全配置：通过。
- MVP 验收报告：通过。

## 强制不做清单

- 不做任意节点编排：通过。
- 不做自定义脚本节点：通过。
- 不做云端业务数据同步：通过。
- 不做多用户权限：通过。
- 本期不做授权、License Server、设备激活、套餐功能开关和支付 webhook：通过。
- 不做批量队列：通过。
- 不做自建模型：通过。
- 不开放通用 custom Provider：通过。
- 不做复杂图片编辑器：通过。
- 不把 API Key 写入日志或 SQLite：通过。

## 退出判断

自动化和本地可验证项已通过。

MVP 仍不能标记为完全验收完成，除非产品侧接受以下剩余风险：

- 真实 Provider 成功调用未执行。
- 真实生图保存闭环未执行。
- macOS Keychain UI 级保存/读取未执行。
