# Implementation Plan

## Ordered Checklist

1. 为 Rust 模型配置构建策略补失败测试：Debug 保留 Mock、Release 策略过滤 profiles、清理历史配置且保留真实默认项。
2. 实现 build-aware provider profile 与配置 reconcile，并让列表、查询、保存、默认解析共享该门禁。
3. 为 deterministic gateway 补 Release fail-closed 测试并实现最小门禁。
4. 为模型配置页补仅真实 profiles、空 profiles 和恢复默认行为测试。
5. 修改模型配置页，移除静态 Mock 回退并按 runtime profiles 生成草稿/默认值。
6. 升级 workflow 中 checkout/setup-node 的完整 SHA 与版本注释，不改变项目 Node 版本。
7. 同步 `AGENTS.md`、长期实施计划、任务清单和必要的打包说明。
8. 自 review Windows、历史工作区、错误传播、审计保留和敏感信息边界。

## Validation

按仓库 Makefile 与相关测试边界执行：

```bash
npm --prefix desktop test -- --run ModelConfigPage.test.tsx
cargo test --manifest-path desktop/src-tauri/Cargo.toml --test model_config_service -- --nocapture
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib model_gateway -- --nocapture
cargo check --manifest-path desktop/src-tauri/Cargo.toml --release
make check
git diff --check
```

若本机存在 `actionlint`，额外校验 workflow；否则使用 YAML 解析并在最终说明在线 Actions 才能验证的剩余项。

## Risky Files and Rollback Points

- `desktop/src-tauri/src/services/model_config.rs`：默认路由与历史配置 reconcile，必须先测试后实现。
- `desktop/src-tauri/src/services/model_gateway.rs`：只增加 Release Mock 拒绝，不改变真实 provider 调用。
- `desktop/src/features/model-config/components/ModelConfigPage.tsx`：保持现有视觉，仅修改选项来源和草稿行为。
- `.github/workflows/*`：只升级两个 Action 固定 SHA。

## Pre-start Checks

- 用户已确认推荐方案和任务创建。
- 不需要公共接口、依赖、锁文件、schema、配置项或权限变更。
- 当前工作区仅新增本任务目录，未发现需合并的用户代码改动。

## Validation Results

- `npm --prefix desktop test -- --run ModelConfigPage.test.tsx`：27/27 通过。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --test model_config_service -- --nocapture`：30/30 通过。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --test model_gateway_service -- --nocapture`：12/12 通过。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --release --test model_config_release -- --nocapture`：2/2 通过。
- `cargo check --manifest-path desktop/src-tauri/Cargo.toml --release`：通过。
- `make check`：312 个前端测试、生产前端构建、Rust check 与 npm high audit 全部通过。
- `make build`：实际 Tauri Release 可执行文件构建通过。
- workflow YAML 解析、旧 Action SHA 扫描和 `git diff --check`：通过；本机未安装 `actionlint`。
