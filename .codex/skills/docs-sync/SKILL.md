---
name: docs-sync
description: Use when commerce-shoot-studio changes affect docs, README, Makefile commands, desktop Tauri workflows, product/clothing/scene generation behavior, model/settings/history UI, ecom-details-image integration, validation evidence, acceptance notes, or long-lived project rules.
---

# Docs Sync for Commerce Shoot Studio

## Goal

Keep this repository's docs, README, project rules, and validation notes aligned with real code and verified desktop behavior.

This skill is only for documentation and rule synchronization. It does not replace implementation, testing, UI review, code review, or security review.

## Project Shape

Current repository shape:

```text
commerce-shoot-studio/
├── desktop/                 # Tauri v2 + React + TypeScript desktop app
│   ├── src/app/              # app shell, workspace state, toolbar, tests
│   ├── src/features/         # product, clothing, scene, model, settings, history
│   ├── src/shared/           # shared UI primitives and helpers
│   └── src-tauri/            # Rust commands, capabilities, Tauri config
├── docs/                     # current planning and technical docs
├── .codex/skills/docs-sync/  # this project docs-sync skill
├── Makefile                  # repository-defined validation and dev commands
└── README.md                 # repository entry point
```

Treat `desktop/` as the active first-phase product surface. Do not infer server, license, payment, or external provider behavior unless current files and verification prove it.

## Authoritative Documents

Update only documents whose ownership matches the change.

- `README.md`
  - Repository entry point.
  - Update when product scope, project layout, setup commands, dev workflow, or user/developer entry points change.

- `Makefile`
  - Source of truth for current validation and local dev commands.
  - Do not document commands that conflict with it.

- `docs/2026-06-30-scene-module-ecom-details-image-technical-plan.md`
  - Current scene-module integration plan.
  - Update when `场景` module scope, ecom-details-image mapping, scene templates, prompt flow, output sizes, or main/detail image behavior changes.

- `.codex/skills/docs-sync/SKILL.md`
  - Long-lived docs synchronization rules for this repository.
  - Update when this project gains new authoritative docs, validation commands, or reusable docs-sync boundaries.

- Future docs if they exist in the working tree:
  - `docs/implementation-decisions.md`: stage boundaries and durable technical decisions.
  - `docs/*implementation-checklist*.md`: task status, blockers, validation evidence, and acceptance gates.
  - `docs/acceptance-report.md`: manual desktop verification, passed/failed items, residual risks, and release evidence.
  - `AGENTS.md`: repository-wide agent rules. Do not invent this file's content unless the task asks for it.

If a document named above is absent, do not treat it as authoritative. Mention that it was absent if it would otherwise be expected.

## Trigger Conditions

Use this skill when a change affects any of these areas:

- Product scope, first-phase desktop boundary, or non-goals.
- `docs/`, `README.md`, `.codex/skills/docs-sync/SKILL.md`, `AGENTS.md`, or long-lived project rules.
- `desktop/src/app/` app state, workspace routing, toolbar, navigation rail, generation history, or shared shell behavior.
- 商品 workflow: native image picker, generation settings, A+ / detail page formats, viral style analysis, listing copy generation, strategy draft step, result grouping, source image handling, failed-card behavior, download, long preview, or history restore.
- 服饰 workflow: AI generation panel, model attributes, size controls, scene draft step, result generation, or clothing-specific UI state.
- 场景 workflow: reference images, output content, output size, 25 scene templates, category tabs, prompt review step, image generation step, or ecom-details-image template mapping.
- 模型配置: provider/model catalog, API key visibility, dropdown behavior, default config summaries, or provider capability boundaries.
- 设置页面: startup/minimize/history/storage/notification/cache behavior, Web Audio sound preview, or settings persistence assumptions.
- Shared UI primitives: `SelectPill`, toggles, cards, upload grid, module tiles, modals, popovers, or controls whose behavior is documented by screenshots/tests.
- Tauri/Rust behavior: native file dialogs, capabilities, local filesystem access, app packaging, tray/autostart/notification assumptions, or command bindings.
- Build, test, package, audit, dependency, or verification commands.
- Acceptance evidence, manual desktop QA, platform-specific notes, or known residual risks.

## Non-Triggers

Usually skip docs when the change is:

- CSS-only polish with no documented workflow, entry point, or acceptance impact.
- Test-only refactoring that does not change coverage expectations or validation commands.
- Internal renaming with no external behavior, doc reference, or reusable rule impact.
- Temporary debugging, screenshots, generated build output, local logs, `.DS_Store`, or machine-local files.
- Incomplete implementation that is not being recorded as a blocker, risk, or planned follow-up.

## Scope Rules

- Keep docs in Simplified Chinese unless editing YAML frontmatter, paths, code identifiers, or command output.
- Keep edits narrow and traceable to the actual change.
- Do not document planned or mocked behavior as completed behavior.
- Do not mark checklist items complete without implementation and required verification evidence.
- Do not mix future authorization, payment, license-server, or backend-provider work into first-phase `desktop/` completion unless current repository files show that scope.
- Do not claim real Provider calls, API key storage, native filesystem persistence, packaging, or platform features are complete without direct verification.
- If docs conflict with code, prefer verified code for current behavior and record the doc drift.
- If docs conflict with a checklist, prefer the more specific checklist for task status.

## Change-to-Docs Mapping

- Product or MVP scope changes:
  - Update `README.md`.
  - Update implementation decisions/checklist/acceptance docs if present.
  - Update this skill only if the rule should persist.

- Scene module or ecom-details-image integration changes:
  - Update `docs/2026-06-30-scene-module-ecom-details-image-technical-plan.md`.
  - Record changes to scene template count, template IDs, category tabs, output content, prompt review, output sizes, or generated result behavior.

- Product/服饰 generation workflow changes:
  - Update checklist or acceptance docs if present.
  - Update README only if user-facing scope or workflow entry points changed.
  - Do not update scene technical plan unless the change also affects `场景`.

- Model/settings/history/shared UI changes:
  - Update acceptance docs if present when behavior is part of manual QA.
  - Update README only for new user/developer entry points.
  - Update this skill only for durable docs-sync rules.

- Tauri/Rust capability or native desktop behavior changes:
  - Update README or technical docs when dev commands, permissions, native dialogs, packaging, or platform behavior change.
  - Record platform-specific verification evidence before calling it complete.

- Validation command changes:
  - Update `Makefile` first if the repository command changes.
  - Update README and any checklist validation section afterward.

## Workflow

1. Inspect current state:

   ```bash
   git status --short
   git diff --stat
   git diff -- <path>
   git ls-files --others --exclude-standard
   ```

2. Classify impact:

   - Docs-only / skill-only
   - README / dev workflow
   - Product generation workflow
   - Clothing generation workflow
   - Scene / ecom-details-image integration
   - Model config / settings / history
   - Shared UI primitive
   - Tauri/Rust/native desktop behavior
   - Packaging/build/test/audit command
   - Acceptance/manual QA evidence
   - Long-lived agent rule

3. Locate candidate docs:

   ```bash
   find docs -maxdepth 2 -type f | sort
   rg -n "场景|商品|服饰|模型|设置|生成记录|ecom-details-image|验收|checklist|acceptance|MVP|desktop|Tauri|Makefile|Provider|API Key" docs README.md .codex/skills/docs-sync/SKILL.md
   ```

4. Decide updates:

   - Update docs when the intended contract or verified behavior changed.
   - Update README when the entry point, setup, command, or scope summary changed.
   - Update checklist/acceptance docs when status, evidence, blockers, or residual risks changed.
   - Update `.codex/skills/docs-sync/SKILL.md` only for reusable docs-sync rules.

5. Edit docs/rules:

   - Use concise Simplified Chinese.
   - Preserve exact paths, commands, task IDs, template IDs, and UI labels.
   - Include observed validation commands/results when marking progress.
   - Record unverified work as `未验证` / `风险` / `阻塞`, not as done.

6. Validate docs/rules:

   ```bash
   git diff --check
   ```

   Also verify referenced paths, commands, docs, and IDs exist when feasible.

## Verification Commands

Do not invent commands. Prefer repository-defined commands in this order:

1. `AGENTS.md` / nearer `AGENTS.override.md` if present.
2. `Makefile`.
3. `desktop/package.json`.
4. `desktop/src-tauri/Cargo.toml`.
5. `README.md` or current docs.

Current repository commands from `Makefile`:

```bash
make test
make frontend-build
make cargo-check
make audit
make check
make build
make package
```

For docs-only or skill-only changes, run at minimum:

```bash
git diff --check
```

For code changes, run the narrow relevant test first, then the broader repository command when practical. If a command cannot be run, document the reason, impact, and remaining risk.

## Project Rules to Preserve

- First active surface is the local desktop app under `desktop/`.
- Use repository-defined commands; do not infer root-level `npm test` when the package lives under `desktop/`.
- Keep `场景` separate from `商品` and `服饰` unless a request explicitly merges workflows.
- `场景` uses the ecom-details-image mapping and currently tracks 25 templates grouped by business tabs.
- Product generation state must survive workspace switching unless the user explicitly resets or starts a new task.
- 商品、服饰和场景 result source image is not a generated asset: it should appear first in the result grid with an `原图` badge, but it should not participate in selection, batch/all-image download, long preview / long-image download, or image viewer behavior.
- Failed generated cards can be selected for deletion but must not participate in download, long preview, image viewing, or album preview.
- API key/provider behavior must not be documented as production-ready storage or real network integration unless verified.
- Native image selection should use Tauri/native picker paths; do not document browser `<input type="file">` as the desktop UX.
- `.DS_Store`, local logs, generated `dist/`, Tauri `target/`, screenshots, and machine-local paths should not be committed unless explicitly required.

## Final Response Requirements

When this skill is used, the final reply must include:

- Which docs or skill files were updated.
- Which candidate docs were checked and intentionally not updated, with reasons.
- Whether any checklist items were marked complete; if none, say none.
- Validation commands run and results.
- Remaining risks or unverified items.

## Prohibitions

- Do not mark future work as complete.
- Do not broaden a narrow docs sync into a full design rewrite.
- Do not weaken desktop-native UX, native picker, secret-handling, provider-boundary, or validation requirements.
- Do not add dependency or lockfile churn for docs-only changes.
- Do not commit secrets, tokens, passwords, private config, `.DS_Store`, generated build outputs, or unrelated files.
