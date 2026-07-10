# 未提交代码审查问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本轮审查发现的 OpenAI 能力误声明、Provider 错误归一化、服饰规划多图角色、OpenAI 比例语义和内置模特 DTO 空字段问题。

**Architecture:** 在 Provider allowlist 边界阻止未实现的 OpenAI 参考图/任意比例能力进入运行时；在 ModelGateway 到 LocalTaskExecutor 之间保留可归一化的 typed Provider 错误；服饰规划复用试穿阶段的真实图片角色映射；Tauri DTO 在 serde 边界省略缺失缩略图。所有改动沿用现有 Runtime Port、SQLite schema 和依赖，不新增公共协议、migration 或第三方依赖。

**Tech Stack:** Rust、Tauri v2、React 18、TypeScript、Vitest、Cargo test。

## Global Constraints

- 只修改完成 5 个审查 finding 所必需的代码、测试和文档。
- 不新增或升级依赖，不修改数据库 schema、migration、Tauri capability 或权限。
- API Key、raw prompt、raw request 和 raw response 不进入 SQLite、task events、前端 DTO 或导出包。
- 模特库使用 `thumbnailPath`，任务输入和全身预览继续使用原图。
- 先写失败测试并确认 RED，再写最小实现并确认 GREEN。
- 保留当前 staged、unstaged、untracked 用户改动，不提交、不重置、不覆盖无关文件。

---

### Task 1: 收紧 OpenAI 文生图能力与模型配置保存

**Files:**
- Modify: `desktop/src-tauri/src/services/model_config.rs`
- Modify: `desktop/src-tauri/src/infrastructure/providers/http_model_gateway.rs`
- Modify: `desktop/src-tauri/tests/model_config_service.rs`
- Modify: `desktop/src-tauri/tests/provider_adapter.rs`
- Modify: `desktop/src/features/model-config/components/ModelConfigPage.tsx`
- Modify: `desktop/src/features/model-config/components/ModelConfigPage.test.tsx`
- Modify: `docs/2026-06-30-local-first-saas-ready-implementation-plan.md`
- Modify: `docs/2026-07-01-local-first-implementation-task-checklist.md`

**Interfaces:**
- Consumes: `ProviderProfile.supported_capabilities`、`categoryCapabilityIds`、`build_model_gateway_request_body`。
- Produces: OpenAI 只声明当前可正确执行的纯文生图 capability；模型配置页只保存当前 Provider 支持的 capability。

- [ ] **Step 1: 写失败测试**
  - Rust 断言 OpenAI 不支持必须携带商品参考图或任意用户比例的 capability，同时仍支持 `clothing-base-model-generation`。
  - Vitest 断言保存 OpenAI 文生图分类时只调用受支持 capability，不尝试保存被 allowlist 排除的能力。
- [ ] **Step 2: 运行定向测试确认 RED**
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml --test model_config_service openai -- --nocapture`
  - `npm --prefix desktop run test -- ModelConfigPage.test.tsx`
- [ ] **Step 3: 写最小实现**
  - 收紧 `OPENAI_CAPABILITY_IDS`；模型配置页依据当前 profile 的 `supportedCapabilities` 过滤保存集合。
  - OpenAI `/images/generations` 对传入参考图快速失败；删除会把任意比例静默折算成横竖方向的逻辑，仅保留基准模特 2:3 请求。
  - 同步两份实施文档中的 OpenAI capability 边界和未实现项。
- [ ] **Step 4: 运行定向测试确认 GREEN**
  - 重跑本任务 Rust/Vitest 测试，并运行 `make frontend-build`、`make cargo-check`。

### Task 2: 保留 Provider 错误类型并补服饰规划图片角色

**Files:**
- Modify: `desktop/src-tauri/src/services/model_gateway.rs`
- Modify: `desktop/src-tauri/src/services/local_task_executor.rs`
- Modify: `desktop/src-tauri/src/services/prompts/clothing_scene_planning.toml`
- Modify: `desktop/src-tauri/tests/model_gateway_service.rs`
- Modify: `desktop/src-tauri/tests/local_task_executor.rs`

**Interfaces:**
- Consumes: `ModelGatewayError`、`normalize_provider_http_error`、`normalize_provider_transport_error`、`clothing_reference_prompt_values`。
- Produces: 可区分配置缺失、HTTP 429/5xx、timeout/network 的任务错误；规划 Prompt 中按 `userImages` 顺序生成 A-F 角色说明。

- [ ] **Step 1: 写失败测试**
  - 断言 429、timeout、network 保留对应 code/status/retryable，配置缺失仍为 `MODEL_CAPABILITY_UNAVAILABLE`。
  - 断言 2–5 张服装图加一张模特图时，规划 Prompt 明确列出 A-F 并正确标记唯一 model。
- [ ] **Step 2: 运行定向测试确认 RED**
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml services::local_task_executor -- --nocapture`
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml --test local_task_executor -- --nocapture`
- [ ] **Step 3: 写最小实现**
  - 在 gateway/executor 内部错误边界保留 typed Provider failure，落库前调用现有 domain 归一化函数。
  - planning gateway 复用图片角色 helper，把 `{{referenceImageRoles}}` 注入 system/user/roleless prompt，并校验至少一张服装图和恰好一张模特图。
- [ ] **Step 4: 运行定向测试确认 GREEN**
  - 重跑本任务 Rust 测试，确认错误详情不包含 raw response 或 secret。

### Task 3: 省略缺失的内置模特缩略图字段

**Files:**
- Modify: `desktop/src-tauri/src/commands/assets.rs`

**Interfaces:**
- Consumes: `BuiltinModelDto.thumbnail_path: Option<String>`。
- Produces: 缺失缩略图时 JSON 不包含 `thumbnailPath`，存在时仍返回字符串。

- [x] **Step 1: 写失败测试**
  - 在 command 模块内构造 `thumbnail_path: None` 的 DTO，断言序列化 JSON 不含 `thumbnailPath`。
- [x] **Step 2: 运行定向测试确认 RED**
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml commands::assets -- --nocapture`
- [x] **Step 3: 写最小实现**
  - 为字段添加 `#[serde(skip_serializing_if = "Option::is_none")]`。
- [x] **Step 4: 运行定向测试确认 GREEN**
  - 重跑 command 测试与 `builtin_model_service` 集成测试。

### Task 4: 集成验证与复审

**Files:**
- Verify: all files modified by Tasks 1–3

**Interfaces:**
- Consumes: Tasks 1–3 的完整 working tree。
- Produces: 可交付的未提交修复结果和验证证据。

- [ ] **Step 1: 运行格式与差异检查**
  - `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check`
  - `git diff HEAD --check`
- [ ] **Step 2: 运行仓库 gate**
  - `make check`
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml -- --nocapture`
- [ ] **Step 3: 独立复审**
  - 复核 5 个原始 findings 均被覆盖，且没有新增 secret、Windows 路径、状态机或 DTO 回归。
