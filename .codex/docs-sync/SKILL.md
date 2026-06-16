---
name: docs-sync
description: Use when commerce-shoot-studio changes affect docs, implementation checklist progress, desktop behavior, Tauri/Rust commands, SQLite migrations, Prompt/output-plan contracts, model/provider behavior, system settings, macOS desktop behavior, or long-lived project rules.
---

# Docs Sync for Commerce Shoot Studio

## Goal

Keep this repository's Chinese docs, implementation checklist, design decisions, and long-lived agent rules aligned with real code changes.

This skill only handles documentation/rule synchronization. It does not replace implementation, testing, or code review.

## Project Shape

```text
commerce-shoot-studio/
├── desktop/          # Phase 1: Tauri 2 + React + TypeScript desktop app
├── license-server/   # Phase 2: future Go + Gin + PostgreSQL license backend
└── docs/             # Design docs, implementation checklist, decisions
```

Phase 1 work is in `desktop/`. Do not document `license-server/` as implemented unless code and validation actually exist.

## Document Map

Update only the documents whose ownership matches the change.

- `docs/2026-06-11-commerce-tryon-v3.5-implementation-checklist.md`
  - Task progress, validation results, Review Gates, blockers, residual risks.
  - Only change `[ ]` to `[x]` after implementation and required verification are complete.

- `docs/2026-06-11-commerce-tryon-v3.5-license-reviewed.md`
  - Current authoritative phase boundary for the desktop MVP and second-phase licensing.
  - Update when MVP scope, storage/security rules, provider/model behavior, task lifecycle, or second-phase license boundary changes.

- `docs/2026-06-11-commerce-tryon-v3-reviewed.md`
  - Older reviewed technical design retained for context.
  - Update only if the user explicitly wants the older reviewed doc kept in sync, or if a referenced rule there would otherwise contradict current implementation.

- `docs/implementation-decisions.md`
  - Durable MVP decisions and engineering constraints.
  - Update when a long-lived decision changes, such as fixed workflow scope, local-only storage, custom provider policy, API key safety, or license-server phase boundary.

- `README.md`
  - Repository entry point and high-level structure.
  - Update when startup commands, project layout, phase boundaries, or user-visible product description changes.

- `AGENTS.md` / `AGENTS.override.md`
  - Project-level agent rules and verification requirements.
  - Update only for reusable rules that should guide future agents. Do not record one-off task notes.

## Trigger Conditions

Use this skill when any current change affects:

- `desktop/src-tauri/migrations/`, SQLite schema, database migrations, local storage, backups, or workspace paths.
- `desktop/src-tauri/src/commands/`, `domain/`, `services/`, `providers/`, `storage/`, or `state.rs`.
- Tauri events, app menus, tray/status item behavior, close/hide behavior, native dialogs, or desktop configuration.
- `desktop/src/features/workflow/`, especially asset library, combination switching, autosave, Prompt/output-plan binding, model settings, task start, task history, or result handling.
- `desktop/src/features/prompt/`, Prompt templates, output plans, preset scenarios, variables, preview/copy text, or final Prompt contracts.
- `desktop/src/features/model-config/`, provider/model definitions, API key status, credential handling, provider runtime behavior, or custom provider policy.
- `desktop/src/features/system-settings/`, proxy settings, cache/workspace settings, notifications, startup behavior, or save/test flows.
- `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `Makefile`, build/test commands, dependency policy, or verification matrix.
- Any completed checklist task or Review Gate.
- A reusable project rule that should be preserved in `AGENTS.md`.

## Non-Triggers

Usually skip docs when the change is:

- Pure refactor with no behavior, API, database, workflow, verification, or long-lived rule change.
- Test-only restructuring that does not change the validation matrix or documented behavior.
- Formatting, typo, naming, or CSS-only polish that does not affect user-facing workflows or docs.
- Temporary debugging, failed experiments, local logs, or generated artifacts.
- Incomplete work. Record a risk/blocker if useful, but do not mark checklist items complete.

## Change-to-Docs Mapping

- `desktop/src-tauri/migrations/`, `storage/`, SQLite query/service changes
  - Sync database/storage sections in the technical design or decisions.
  - Sync checklist tasks for local persistence, migrations, prompt presets, assets, task history, or settings.

- Tauri commands and services
  - Sync command/API contract, error behavior, local task lifecycle, provider execution, or system settings descriptions.
  - Include validation evidence for Rust changes.

- Provider/model/runtime generation behavior
  - Sync fixed-provider policy, model input limits, output count rules, API key handling, and custom provider boundary.
  - If custom provider remains unsupported, docs must not imply it is available.

- Prompt templates, output plans, preset scenarios, variables, preview/final output
  - Sync Prompt/output-plan contract and checklist items.
  - Keep terminology aligned: user-facing docs say "输出方案 / 方案中心 / Prompt 模板配置"; avoid exposing `System/User/Negative Prompt` as normal-user workflow unless describing internal storage.

- Workflow canvas, asset library, combination switching, autosave
  - Sync implementation checklist and any user-facing workflow descriptions.
  - Preserve the rule that combination assets, selected state, generated results, and output-plan binding are isolated per current combination.

- Task runner, cancellation, retry, task history, execution logs
  - Sync task lifecycle, event/recovery behavior, snapshots, history filters, retry limits, and validation evidence.

- System settings and desktop behavior
  - Sync settings behavior for launch-at-login, close/hide behavior, notifications, workspace/cache management, proxy detection/testing, and macOS menu/status item behavior.

- `license-server/`
  - Treat as second phase unless implementation exists.
  - Do not mark license, activation, payment webhook, or entitlement tasks complete from desktop-only changes.

## Workflow

1. Inspect the current change set:

   ```bash
   git status --short
   git diff --stat
   git diff -- <path>
   git ls-files --others --exclude-standard
   ```

2. Classify the impact:

   - Desktop UI/workflow
   - Tauri command/service
   - SQLite/migration/storage
   - Prompt/output-plan contract
   - Provider/model/API key/runtime
   - Task lifecycle/history
   - System settings/desktop OS behavior
   - Build/test/dependency/config
   - Long-lived agent rule
   - Docs-only/no docs needed

3. Locate candidate checklist items:

   ```bash
   rg -n "T[0-9]+|Review|Prompt|Provider|SQLite|任务|历史|设置|授权|验证|macOS|代理|方案|组合" docs/2026-06-11-commerce-tryon-v3.5-implementation-checklist.md
   ```

4. Decide whether technical docs need updates. Update them only when one of these changes:

   - Product/MVP boundary or second-phase boundary
   - Business workflow or user-visible desktop behavior
   - Tauri command contract, event contract, or error behavior
   - Database schema, migration, transaction, or query strategy
   - Provider/model/runtime generation behavior
   - Prompt/output-plan variable/final-output contract
   - Security, credential, logging, privacy, or local path policy
   - Build/test/deployment commands or dependency assumptions
   - Long-lived project rules

5. Edit docs/rules:

   - Use Simplified Chinese for project docs.
   - Keep checklist syntax as `[ ]` and `[x]`.
   - Only mark complete items that are implemented and verified.
   - Link statements to code paths or exact validation evidence where helpful.
   - Record incomplete work as "待办 / 风险 / 阻塞"; do not present it as done.
   - Keep edits narrow. Do not rewrite whole design docs for a small change.

6. Validate documentation changes:

   ```bash
   git diff --check
   ```

   If docs mention paths, commands, migrations, task IDs, or file names, verify those targets exist.

## Verification Commands

Do not invent commands. Prefer repository-defined commands.

- Frontend/Desktop TypeScript changes:

  ```bash
  npm --prefix desktop run test
  npm --prefix desktop run build
  ```

- Tauri/Rust changes:

  ```bash
  make cargo-check
  ```

  For touched Rust modules, run focused unit tests when available, for example:

  ```bash
  cargo test -p commerce-shoot-studio --lib prompt_presets -- --nocapture
  cargo test -p commerce-shoot-studio --lib task_runner -- --nocapture
  cargo test -p commerce-shoot-studio --lib system_settings -- --nocapture
  ```

  Run from `desktop/src-tauri` for direct `cargo` commands.

- Full local check:

  ```bash
  make check
  ```

- Docs-only or skill-only changes:

  ```bash
  git diff --check
  ```

  Explain that code tests were not run because only docs/skill instructions changed.

## Commerce Shoot Studio Rules to Preserve

- Phase 1 is local desktop only; business state lives in local workspace SQLite/assets.
- `license-server/` is second phase unless explicitly implemented and verified.
- Workflow is fixed, not a user-editable general DAG.
- API keys stay in Rust/system credential storage; they must not enter frontend persistence, SQLite, logs, task summaries, or docs examples.
- User-facing Prompt language is "输出方案 / 方案中心 / Prompt 模板配置"; normal users should not manage internal `System/User/Negative` sections directly.
- Built-in Prompt/output plans are read-only; custom plans must persist and reload.
- Output-plan variables, defaults, settings UI, workbench controls, final preview, and provider payload must share one contract.
- Combination data is isolated: assets, selected state, generated results, output-plan binding, and autosave all belong to the current combination.
- New combinations do not auto-fill images; only explicit user selection/import counts.
- All user-visible operation results should be toast-based, not persistent in-page banners.
- macOS desktop behavior should follow native expectations: close hides the window; menus expose workbench/settings/model/output-plan/quit entries.
- Unsupported provider/runtime capabilities must be disabled or hidden; do not expose configurable UI that cannot execute.

## Final Response Requirements

When this skill is used, the final reply must include:

- Which docs or skill files were updated.
- Which candidate docs were checked and intentionally not updated, with reasons.
- Which checklist items were marked complete; if none, say none.
- Validation commands run and results.
- Remaining risks or unverified items.

## Prohibitions

- Do not mark checklist work complete without implementation and verification evidence.
- Do not document TODO/planned work as completed behavior.
- Do not broaden a small documentation sync into a full design rewrite.
- Do not commit secrets, tokens, passwords, private config, local logs, generated build outputs, or unrelated files.
- Do not add dependency lockfile churn unless dependencies actually changed and the user approved the dependency change.
