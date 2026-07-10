# 服饰基准模特属性 Prompt 映射实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让服饰菜单的体型和年龄短标签在生成基准模特时映射为完整人体描述，而不是把单一标签发送给模型。

**Architecture:** 前端只负责显示和持久化短标签；任务 `input_json` 仍只保存标签。Rust `LocalTaskExecutor` 在渲染 `clothing-base-model-generation` Prompt 的 `{{body}}` 和 `{{age}}` 变量前，将标签转换为完整描述。该映射仅存在于运行时，不改变 Runtime DTO、Tauri command、SQLite schema 或 Prompt 模板变量。

**Tech Stack:** React + TypeScript、Rust、Vitest、Rust 内置单元测试、TOML Prompt Registry。

## Global Constraints

- UI 选项为：纤细、苗条、精瘦、匀称、健美、运动型、肌肉型、壮硕、结实、丰满、微胖、大码；不显示肥胖。
- 默认体型为 `匀称`。
- `大码` 在 Prompt 中使用 `丰满` 的完整描述。
- 旧任务值 `标准` 映射为 `匀称`，`肌肉` 映射为 `肌肉型`。
- 所有体型 Prompt 保持用户提供的中文完整描述；模型不会只收到体型标签。
- 年龄 UI 标签保持婴儿、儿童、青少年、青年、中年、老年；运行时使用用户提供的完整年龄描述，模型不会只收到年龄标签。
- 不新增依赖、公共 Runtime DTO、Tauri command、数据库 schema 或 migration。

---

### Task 1: 固化前端体型标签与默认项

**Files:**
- Modify: `desktop/src/features/clothing/components/ClothingConfigPanel.tsx:20-24,173-180`
- Test: `desktop/src/features/clothing/components/ClothingConfigPanel.test.tsx:385-435`
- Test: `desktop/src/app/App.test.tsx:2818-2879`

**Interfaces:**
- Produces: `BaseModelGenerationInput.body`，其值为一个短标签，例如 `大码`。
- Consumes: Rust 运行时把该短标签转换为完整 Prompt 描述。

- [x] **Step 1: 写失败的前端用例**

断言体型下拉可选项为：

```ts
[
  "纤细", "苗条", "精瘦", "匀称", "健美", "运动型",
  "肌肉型", "壮硕", "结实", "丰满", "微胖", "大码",
]
```

并断言默认展示 `体型 匀称`，点击 `大码` 后传给 `onGenerateBaseModel` 的 `body` 仍为 `大码`。

- [x] **Step 2: 运行前端用例确认 RED**

Run: `npm --prefix desktop run test -- src/features/clothing/components/ClothingConfigPanel.test.tsx src/app/App.test.tsx`

Expected: FAIL，因为现有选项仍是 `标准`、`肌肉`，默认值为 `标准`。

- [x] **Step 3: 最小前端实现**

将 `aiModelBodyOptions` 改为 12 个确认的短标签，并把 `defaultClothingConfig.aiModelBody` 设为 `匀称`。不要在前端保存或展示完整 Prompt 描述。

- [x] **Step 4: 运行前端用例确认 GREEN**

Run: `npm --prefix desktop run test -- src/features/clothing/components/ClothingConfigPanel.test.tsx src/app/App.test.tsx`

Expected: PASS，体型标签和任务输入均为短标签。

### Task 2: 在 Rust Prompt 渲染时展开完整体型描述

**Files:**
- Modify: `desktop/src-tauri/src/services/local_task_executor.rs:936-978,2357-2396`

**Interfaces:**
- Consumes: `task_input["body"]` 的短标签。
- Produces: 替换 `{{body}}` 的完整描述；未知历史标签保留原值。

- [x] **Step 1: 写失败的 Rust 表驱动测试**

给 `clothing_base_model_gateway_input` 添加表驱动测试，至少验证全部 12 个当前标签和 2 个旧标签：

```rust
for (label, expected_description) in [
    ("纤细", "小至中等骨架，身体横向宽度较窄"),
    ("大码", "中等至较大骨架，体脂中等偏高"),
    ("标准", "中等骨架，体脂和肌肉量适中"),
    ("肌肉", "中等至较大骨架，体脂较低至适中"),
] {
    // task input body 为 label；断言 system/user/roleless prompt 包含 expected_description。
}
```

额外断言 `大码` 的最终 Prompt 不包含肥胖描述（例如 `腹部明显突出`）。

- [x] **Step 2: 运行 Rust 测试确认 RED**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml clothing_base_model_generation_ -- --nocapture`

Expected: FAIL，因为现有实现只替换原始标签。

- [x] **Step 3: 最小 Rust 实现**

在 `local_task_executor.rs` 增加私有函数：

```rust
fn clothing_body_prompt_description(label: &str) -> &str
```

使用 `match` 覆盖 12 个 UI 标签；`大码` 返回 `丰满` 描述；兼容 `标准 -> 匀称`、`肌肉 -> 肌肉型`。未知历史值保留原始标签，避免任务渲染失败。将其结果作为 `{{body}}` 的替换值。

- [x] **Step 4: 运行 Rust 测试确认 GREEN**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml clothing_base_model_generation_ -- --nocapture`

Expected: PASS，完整描述同时进入角色化 Prompt 与 `rolelessPrompt`。

### Task 3: 同步长期行为说明并验证

**Files:**
- Modify: `docs/2026-06-30-local-first-saas-ready-implementation-plan.md:544`
- Modify: `docs/2026-07-01-local-first-implementation-task-checklist.md:751`

**Interfaces:**
- Consumes: 已验证的运行时映射行为。
- Produces: 不复制长描述的稳定文档边界：短标签持久化，运行时完整描述注入 Prompt。

- [x] **Step 1: 更新文档**

在服饰基准模特流程说明中声明：体型 UI 标签存入任务输入；运行时映射为完整人体描述后才进入 Prompt。记录 `大码 -> 丰满描述`、不提供 `肥胖` UI 选项与旧值兼容规则。不要在文档复制全部描述词，以 Rust 映射函数为唯一内容真相源。

- [x] **Step 2: 验证完整切片**

Run: `make check`

Expected: 前端测试、TypeScript/Vite 构建、Cargo check、npm audit 全部通过。

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml -- --nocapture`

Expected: Rust 单元与集成测试全部通过。

Run: `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check`

Expected: 无格式差异。

Run: `git diff --check && git diff --cached --check`

Expected: 无空白错误。

验证结果：`make check` 通过（Vitest 173 项、TypeScript/Vite 构建、Cargo check、npm audit）；全量 Rust 测试 52 个库内测试和全部集成测试通过；格式与 diff 检查通过。

### Task 4: 在 Rust Prompt 渲染时展开完整年龄描述

**Files:**

- Modify: `desktop/src-tauri/src/services/local_task_executor.rs:936-985,2375-2475`
- Modify: `docs/2026-06-30-local-first-saas-ready-implementation-plan.md:545`
- Modify: `docs/2026-07-01-local-first-implementation-task-checklist.md:752`

**Interfaces:**

- Consumes: `task_input["age"]` 的短标签。
- Produces: 替换 `{{age}}` 的完整年龄描述；未知历史标签保留原值。

- [ ] **Step 1: 写失败的 Rust 表驱动测试**

在基准模特 Prompt 测试中断言下列六个标签在 user Prompt 和 `rolelessPrompt` 中均被展开为完整描述：

```rust
[
    ("婴儿", "约1岁的婴儿，处于婴儿期"),
    ("儿童", "约8岁的儿童，处于学龄儿童阶段"),
    ("青少年", "约16岁的青少年，处于青春期后期"),
    ("青年", "约25岁的年轻成年人，面部发育完全"),
    ("中年", "约45岁的中年成年人，面部轮廓成熟"),
    ("老年", "约70岁的老年人，具有明确而自然的衰老特征"),
]
```

同时断言不再出现单独的 `年龄阶段：<短标签>` 行；未知年龄值保持原样以兼容历史异常数据。

- [ ] **Step 2: 运行 Rust 测试确认 RED**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml clothing_base_model_generation_ -- --nocapture`

Expected: FAIL，因为现有实现只替换原始年龄标签。

- [ ] **Step 3: 最小 Rust 实现**

在 `local_task_executor.rs` 增加私有函数：

```rust
fn clothing_age_prompt_description(label: &str) -> &str
```

使用 `match` 覆盖婴儿、儿童、青少年、青年、中年、老年六项，返回用户提供的完整中文描述；未知值返回原标签。将结果替换 `{{age}}`，不要改变任务输入、TOML 变量名或前端年龄下拉。

- [ ] **Step 4: 运行 Rust 测试确认 GREEN**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml clothing_base_model_generation_ -- --nocapture`

Expected: PASS，完整年龄描述同时进入角色化 Prompt 与 `rolelessPrompt`。

- [ ] **Step 5: 同步文档并验证完整切片**

在两份服饰流程文档中补充年龄标签同样只存短值、runtime 注入完整描述的规则；不要复制六段完整文案，也不要声称真实 Provider 已手验。完成后运行：

```bash
make check
cargo test --manifest-path desktop/src-tauri/Cargo.toml -- --nocapture
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
git diff --check && git diff --cached --check
```

Expected: 所有命令通过；不暂存、不提交。
