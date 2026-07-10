# 模型 Provider 切换后恢复 API Key 状态设计

## 目标

模型配置页中，一个 Provider 已经保存 API Key 后，用户切换到其他 Provider 再切回来，页面应恢复该 Provider 的“已配置”遮罩状态。切换过程不得删除密钥，也不得自动读取或展示明文。

## 当前根因

Rust 已按 `provider_profile_id + capability_id` 将不同 Provider 的密钥独立保存在 `model_secrets`。前端 Provider 下拉切换时却无条件把 `apiKeyConfigured` 重置为 `false`，并且没有调用现有 `SecretPort.getSecretStatus`，导致已保存密钥被错误显示为未配置。

## 交互与数据流

1. 用户选择新的 Provider 后，卡片立即切换 Provider、默认模型和 Base URL。
2. 页面立即清除 React 状态中可能已经 reveal 的旧 Provider 明文，并将连接状态设为不可用。
3. 对需要密钥的 Provider，使用该模型类别的首个 capability 调用 `SecretPort.getSecretStatus`。
4. 返回 `configured: true` 时显示“已配置”遮罩；返回 `false` 时展开空输入框供用户填写。
5. 只有用户点击眼睛按钮时才调用 `SecretPort.revealSecret`，Provider 切换本身不读取明文。
6. 每个模型类别分别维护 Provider status 与 reveal 请求序号；只有各自最新的响应可以回写，避免快速切换时旧响应覆盖新状态，同时避免“隐藏明文”误取消仍有效的 status 查询。
7. 取消、恢复默认或 runtime 全量重载会统一失效所有在途 status/reveal；用户开始输入新 Key 时也会失效当前类别的旧查询，避免晚到响应覆盖新输入。

## 修改范围

- 修改 `ModelConfigPage.tsx` 的 Provider 切换和 reveal 异步状态保护。
- 在 `ModelConfigPage.test.tsx` 增加 Provider 往返切换和过期响应回归测试。
- 不修改 Rust、SQLite schema、Runtime Port、Tauri command、依赖或视觉样式。
- 不保留未保存的 Provider 专属明文草稿；切换离开后丢弃该临时明文。

## 错误处理

- `getSecretStatus` 失败时保持新 Provider 的未配置可编辑状态，并用全局 error toast 提示密钥状态加载失败。
- reveal 失败时保持输入框可编辑，但不写入任何旧值或伪造遮罩状态。
- 过期异步响应静默丢弃，不展示错误 toast。

## 测试与验收

- RED：DeepSeek 已配置，切换 OpenAI 后再切回 DeepSeek，当前代码仍显示空输入框。
- GREEN：切回 DeepSeek 后显示“已配置”遮罩，并调用正确的 `getSecretStatus` scope。
- 断言 Provider 切换不会调用 `revealSecret`、`saveSecret` 或 `deleteSecret`。
- 覆盖快速切换、隐藏、取消、恢复默认和输入新 Key 时，旧 status/reveal 响应不会污染当前 Provider。
- 运行模型配置页定向 Vitest、`make check` 和 `git diff --check`。
