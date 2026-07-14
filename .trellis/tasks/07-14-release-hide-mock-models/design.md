# Technical Design

## Architecture and Boundaries

### Build policy

复用仓库已有的 `debug_assertions` 构建区分，不新增运行时开关：

- Debug/Test：Mock provider 可用，继续 lazy seed。
- Release：Mock provider 不可用，配置 reconcile 删除 `model_configs.provider_profile_id = 'mock-local'` 的当前配置行。

将构建策略集中在模型配置服务内，并让 provider 查找、配置 reconcile、列表与默认解析共享同一策略，避免各调用点各自判断。

### Rust source of truth

`ModelConfigService` 负责返回当前构建允许的 profiles/configs。Release 中：

1. `list_provider_profiles` 过滤 Mock。
2. 配置 reconcile 删除旧 Mock 配置而不是补种。
3. provider allowlist 查找拒绝 Mock，因此保存、测试连接和设置默认值无法重新写入 Mock。
4. 默认配置 resolver 无真实默认项时返回明确不可用错误。
5. `ModelGatewayService::invoke` 对 deterministic Mock 增加 Release fail-closed，防止未来调用绕过 resolver。

删除只作用于当前 `model_configs`，不触碰 `model_invocations` 审计历史；Debug 重新打开同一工作区时会按原合同重新补种 Mock。

### Frontend behavior

模型配置页不自行判断 Tauri 构建类型，以 runtime profiles 是否包含 `mock-local` 决定 Mock UI：

- 移除 profiles 为空时的静态 Mock 选项回退。
- 合并配置时忽略 runtime profiles 不允许的陈旧配置。
- 无配置时使用该类别首个 runtime profile 构建未保存草稿；没有 profile 时显示不可配置状态。
- 恢复默认值根据当前 runtime profiles 生成草稿：Debug 可恢复 Mock，Release 只生成真实 Provider 草稿。

Mock 元数据和 deterministic 测试代码可以保留在源码中；安全边界是 Release Rust 拒绝和 UI 不可达，不要求从二进制字符串层面抹除。

## Compatibility

- 不改 Runtime Port/DTO，前端继续消费现有 `listProviderProfiles` 与 `listConfigs`。
- 不改 schema/migration；通过现有 service reconcile 历史工作区，单条删除语句保持原子性。
- Release 清理 Mock 默认行后不会自动提升真实配置，避免静默改变执行路由。
- GitHub-hosted runner 已满足 Node.js 24 Action runtime 最低版本；自托管 runner 如存在需至少 `v2.327.1`。

## Test Strategy

- 将构建策略核心拆成可注入/可纯测的 helper，普通 Debug 测试也能覆盖 Release 分支。
- Rust 测试覆盖 profile 过滤、历史 Mock 清理、无真实默认配置失败、真实配置保留以及 gateway fail-closed。
- 前端测试用“仅真实 profiles”和“profiles 为空”夹具验证 Mock 不可见且不回退。
- 保留现有 Debug Mock 测试，证明开发与自动化能力未退化。

## Rollback

- Actions 变更可独立回退到原完整 SHA。
- Mock 门禁无 schema 变更；回退后 Debug/Release 原逻辑会重新 lazy seed Mock。
- 被 Release 删除的 Mock 当前配置是可再生测试配置，不影响历史审计。
