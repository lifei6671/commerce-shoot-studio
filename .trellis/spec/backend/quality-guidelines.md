# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

## Scenario: Windows DWM border suppression

### 1. Scope / Trigger

- Trigger: the borderless Windows Tauri main window keeps `shadow: true` for DWM shadow and rounded corners but must not draw the focused blue/accent border.

### 2. Signatures

- Startup hook: `configure_windows_dwm_border(app: &tauri::App) -> Result<(), &'static str>`.
- Native calls: `DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE)` and `DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, 0x00FFFFFF)`.
- Direct dependency: target-specific `windows 0.61` with only `Win32_Foundation` and `Win32_Graphics_Dwm`.

### 3. Contracts

- All dependency imports, native code, and setup calls are compiled only for `target_os = "windows"`.
- The HWND comes from the already-created Tauri `main` window during setup.
- Keep `decorations: false` and `shadow: true`; suppress the DWM border color and paint Tao's retained top non-client strip with the app's white titlebar color.
- Do not subclass `WM_NCCALCSIZE`, disable `WS_THICKFRAME`, or turn off the system shadow for this cosmetic fix.
- The `unsafe` block covers only `DwmSetWindowAttribute`, with a safety comment describing the live HWND, pointer lifetime, and COLORREF size.
- No Runtime Port, command, DTO, capability, or frontend API exposes this startup-only host configuration.

### 4. Validation & Error Matrix

- Missing main window or unavailable HWND -> return a fixed internal error.
- Unsupported DWM attribute or native call failure -> emit one fixed warning and continue startup.
- Supported Windows 11 calls succeed -> no warning, no system accent border, and no blue top non-client strip.
- Non-Windows build -> no Windows dependency import or DWM call is compiled.

### 5. Good/Base/Bad Cases

- Good: Windows 11 retains system shadow and rounded corners without a blue focused border or top line.
- Base: an older Windows version retains its default border and the application still opens.
- Bad: set `shadow: false` and unintentionally remove the shadow, or fail application startup for a cosmetic DWM error.

### 6. Tests Required

- Run Rust formatting, compile checks, and library tests on Windows.
- Build a Windows Release executable through Tauri so the platform config and setup hook compile together.
- Manually verify focus/unfocus, shadow, corners, maximize/restore, tray restore, and multiple DPI values on Windows 11.
- Keep macOS regression verification because the Windows dependency and setup call must remain cfg-gated.

### 7. Wrong vs Correct

#### Wrong

```rust
window.set_shadow(false)?;
```

#### Correct

```rust
#[cfg(target_os = "windows")]
if configure_windows_dwm_border(app).is_err() {
    eprintln!("警告：无法完整配置 Windows 系统窗口边框，将继续启动。");
}
```

## Scenario: Structured AI Prompt Plan Validation

### 1. Scope / Trigger

- Trigger: Rust validates structured planning output produced by an external model, especially
  `scene-prompt-planning` items containing both `prompt` and `negativeConstraints`.

### 2. Signatures

- Owner: `LocalTaskExecutor::normalize_scene_prompt_plan_output` and its item validators.
- No command, database schema, or public Runtime Port changes are required for this rule.

### 3. Contracts

- `prompt`: non-empty executable image instruction with no unresolved `{{...}}` placeholder.
- `negativeConstraints`: non-empty summary of negative constraints with no unresolved placeholder.
- The planning Prompt requires the executable `prompt` to include the negative semantics.
- Rust must not require `negativeConstraints` to be a byte-for-byte substring of `prompt`.

### 4. Validation & Error Matrix

- Missing or blank `prompt` -> reject the plan.
- Missing or blank `negativeConstraints` -> reject the plan.
- Unresolved placeholder in either field -> reject the plan.
- Equivalent constraints with different punctuation, order, or wording -> accept the plan.

### 5. Good/Base/Bad Cases

- Good: `prompt` says "do not invent certifications" while `negativeConstraints` says
  "do not fabricate certifications; keep the subject unchanged".
- Base: the same negative sentence appears verbatim in both fields.
- Bad: either field is blank or contains an unresolved template placeholder.

### 6. Tests Required

- Unit test normalization with semantically equivalent, non-verbatim negative text and assert success.
- Keep separate rejection coverage for blank fields and unresolved placeholders.
- Assert normalized output preserves the model-owned `prompt` instead of appending text in Rust.

### 7. Wrong vs Correct

#### Wrong

```rust
if !prompt.contains(negative_constraints) {
    return Err(invalid_plan());
}
```

#### Correct

```rust
for field in ["prompt", "negativeConstraints"] {
    let value = required_string(item, field, &format!("item missing {field}"))?;
    ensure_no_prompt_placeholder(value)?;
}
```

## Scenario: Two-pass scene template routing and prompt planning

### 1. Scope / Trigger

- Trigger: `scene-prompt-planning` must choose from the embedded 25-template catalog without
  sending all full template rules in one model call.

### 2. Signatures

- One `workspace=scene`, `kind=prompt-plan` task performs two sequential calls to the existing
  `scene-prompt-planning` capability.
- Routing uses `SceneTemplateRouting`; final planning uses `ScenePromptPlanning`.
- No new Runtime Port, capability, task, database schema, or migration.

### 3. Contracts

- Task input requires 1-3 reference assets, `outputMode`, `ratio`, and trimmed non-empty
  `supplementalInfo`.
- Routing v3 receives a compact 25-template index and returns
  `catalogVersion/conversionDriver/visualDirectionId/selections[{code,templateId}]`.
- H/D `code`, `purpose`, count, and order are fixed. `recommendedTemplateIds` are ranking hints,
  never an allowlist; every catalog template remains reachable when subject compatibility and required
  evidence are satisfied.
- Planning v10 receives only `code`/`purpose` plus selected full template sections. It must not receive
  routing `recommendedTemplateIds`. It preserves the routed driver,
  direction, and template IDs, then choose one variant override inside each frozen template or use the
  stable `base` variant semantics when no override applies.
- A full pack may reuse a template when the repeated use has a distinct purpose, composition, or
  campaign role. Never force uniqueness at the expense of user intent, subject fit, or evidence safety.
- The template's native visual language, executor identity, text policy, and evidence policy take
  precedence over the cross-image visual direction. The direction supplies only palette, lighting,
  and layout baselines.
- Detail-screen information responsibilities must be expressed through the selected template's own
  composition; do not force every D item into one generic infographic skeleton.
- Camera, framing, background, clothing preservation, and typography are conditional on whether the
  subject is a product, person, space, interface, or mixed subject.
- Planning system rules own only model-behavior guidance: fact/evidence boundaries, template priority,
  the compact Style Lock, variant/base selection, self-contained prompts, summaries, and injection
  safety. Deterministic count/order/IDs/versions/field types belong to Rust and `output_format`.
- The normalized routing value is memory-only. Only the final normalized planning output is saved.

### 4. Validation & Error Matrix

- Blank supplemental information -> reject before the first Provider call.
- Invalid routing count/order/catalog membership -> fail the task; do not call planning.
- Evidence sufficiency is a routing-model semantic contract, not a Rust keyword heuristic. The routing
  Prompt must reject unsupported templates; verify that behavior with real-provider semantic fixtures.
- Cancellation after routing -> do not call planning.
- Planning changes routed driver/template, selects an invalid variant, or emits `base` where a
  specific override was explicitly required -> reject; save no output.

### 5. Good/Base/Bad Cases

- Good: routing selects `magazine-editorial`; planning receives only that full section and selects
  `fashion-cover`.
- Base: single mode has no strong match; routing selects catalog default `hero-image`.
- Bad: routing writes a final image prompt or planning receives all 25 full template sections.

### 6. Tests Required

- Assert router prompt contains 25 compact entries and excludes structure, variants, and Anti-AI.
- Assert each of the 25 templates is reachable under a subject/evidence fixture and blocked when its
  required evidence is absent.
- Assert two calls occur in order and the second prompt contains only routed templates.
- Assert the planning prompt contains `code`/`purpose` but no `recommendedTemplateIds`, and does not
  duplicate deterministic schema rules already enforced by Rust/output format.
- Assert recommended template IDs are not treated as an allowlist, full-pack template reuse is accepted,
  and `base` is used only when no variant override applies.
- Assert template-native visual language wins over the shared direction baseline, and product/person/
  space/interface fixtures receive different camera, background, clothing, and type treatment.
- Assert routing analysis/candidates do not enter output JSON, events, diagnostics, or frontend DTOs.
- Assert failure and cancellation after routing prevent the second call.

### 7. Wrong vs Correct

#### Wrong

```rust
let prompt = render_all_full_templates_and_ask_for_a_plan();
```

#### Correct

```rust
let route = validate_route(invoke(compact_routing_index)?)?;
let plan = invoke(render_selected_full_templates(&route)?)?;
persist(normalize_plan_against_route(plan, route)?)?;
```

## Scenario: Visibility-aware task output persistence

### 1. Scope / Trigger

- Trigger: a Provider result is written after a task has entered `running`, especially after a
  long scene planning or image-generation call.

### 2. Contracts

- The final `status = running` and `hidden_at IS NULL` check, the output update, and the matching
  `task.output-saved` event must share one SQLite transaction.
- A task cancelled or hidden after an earlier stage update must accept no late output and no
  output-saved event.
- An affected-row count of zero is a normal cancellation outcome, not a persistence failure.

### 3. Tests Required

- Insert a deterministic hook or barrier after the stage update and cancel the task before the
  output write.
- Assert `output_json IS NULL` and zero `task.output-saved` events.
- Keep equivalent coverage for hidden tasks when the same writer is reused by derived tasks.

## Scenario: Provider probe size versus real generation size

### 1. Scope / Trigger

- Trigger: one model exposes multiple resolutions for the same ratio and connection probes use a
  cheaper resolution than real generation.

### 2. Contracts

- Connection probes may explicitly use Seedream 5 Pro 1K to control cost.
- A real `scene-image-generation` request without an explicit size uses the registered 2K option
  for its frozen ratio.
- Never infer the production default from whichever option happens to appear first in the UI size
  list when probe and production policies differ.

### 3. Tests Required

- Assert the Seedream 5 Pro connection probe remains 1K.
- Assert an implicit 3:4 real scene request resolves to `1776x2368`.
- Preserve explicit-size validation and unknown-model rejection coverage.

## Scenario: Persisted result-image rewrite versus in-memory Provider Prompt

### 1. Scope / Trigger

- Trigger: a generated product, clothing, or scene image is rewritten through `kind = "image-edit"`.

### 2. Signatures

- Persisted input kind: `result-image-rewrite` (legacy `product-detail-image-rewrite` remains readable).
- Required persisted fields: `parentTaskId`, `targetImageId`, `imageNo`, `sourceAssetId`, and `rewriteInstruction`.
- The current image is linked once through `generation_task_input_assets(role = "reference")`.

### 3. Contracts

- `generation_tasks.input_json` must not contain `prompt.messages`, `rolelessPrompt`, Base64, or the prior full generation Prompt.
- `LocalTaskExecutor` trims `rewriteInstruction` and builds the generic fidelity-preserving system/user/roleless Prompt only after input assets have been loaded in memory.
- `image-edit` requires a real Provider; `mock-local` must fail or resolve an available real same-category config, never return a mergeable transparent placeholder.
- A successful Provider result is merged only through `replace_result_image`; failures preserve the parent slot.
- Every persisted result-image edit internal kind must pair with outer `GenerationTaskKind::ImageEdit`.
  Reject mismatches before create or retry inserts a new task. Retry applies only this pairing check;
  do not retroactively reject a correctly typed legacy task for fields that newer create requests may
  no longer persist.

### 4. Validation & Error Matrix

- Blank `rewriteInstruction` -> validation failure before Provider invocation.
- Missing current reference asset -> input validation failure.
- No available real image-to-image config -> `MODEL_CAPABILITY_UNAVAILABLE`; no replacement.
- Lineage mismatch or changed displayed asset -> replacement rejected and derived task cleaned up.
- Deleting an unmerged `result-image-text-rewrite` keeps task/event audit rows but transactionally removes
  its input/output relations, hides or cancels the child, and soft-deletes unreferenced replacement assets.
  Ordinary task deletion remains hide-only.
- Do not unconditionally soft-delete the child input source during direct cleanup: it is still the parent
  task's current output. A later parent-slot replacement or deletion owns old-source cleanup after it removes
  superseded child relations in the same transaction.

### 5. Good/Base/Bad Cases

- Good: persist one business instruction, construct the full Prompt in memory, call a real Provider, then atomically replace the matching slot.
- Base: read a legacy rewrite kind but still construct its Prompt in memory.
- Bad: persist `prompt.rolelessPrompt` or let deterministic `image-edit` replace a real result with a 1x1 image.

### 6. Tests Required

- Assert the executor builds generic fidelity language and preserves the in-memory `userImages` array.
- Assert persisted frontend task input contains no messages, roleless Prompt, Base64, or prior full Prompt.
- Assert `image-edit` is classified as requiring a real Provider.
- Keep `replace_result_image` lineage and rollback tests for the new and legacy input kinds.
- Assert unmerged text-rewrite cleanup leaves the parent source active, and keep a regression proving
  ordinary delete retains its relations. Keep parent replacement/deletion coverage proving the old source is
  reclaimed only after superseded child input relations are removed. Assert create/retry reject internal/outer
  kind mismatches before insert.

### 7. Wrong vs Correct

#### Wrong

```json
{"kind":"result-image-rewrite","prompt":{"rolelessPrompt":"raw full prompt"}}
```

#### Correct

```json
{"kind":"result-image-rewrite","rewriteInstruction":"把背景改成浅灰色","sourceAssetId":"asset-current"}
```

## Scenario: Asset-only image text recognition and positioned text rewrite

### 1. Scope / Trigger

- Trigger: a generated result image is inspected by an image-to-text model and selected text lines are
  replaced or deleted by an image-edit model.

### 2. Signatures

- Tauri command: `ai_assist_recognize_image_text({ assetId })`.
- Recognition result: `items[{ id, text, box{x,y,width,height} }]`.
- Persisted edit input kind: `result-image-text-rewrite` with `changes` plus the existing result lineage.

### 3. Contracts

- The frontend sends only an active generated `assetId`; Rust reads the workspace file and constructs
  the image data and Prompt in memory.
- Recognition uses the execution-time real `image-text-recognition` config. Rewrite uses the
  execution-time real `image-edit` config. Neither capability may produce a mergeable mock result.
- Recognition explicitly requests 12,000 output tokens so the declared 100-line JSON contract does
  not silently inherit the gateway's smaller default budget.
- Rust ignores model-supplied IDs and assigns ordered `line-001...line-100` IDs.
- The approximate target box is only a spatial hint. A replace/delete runs only after `originalText`
  uniquely identifies the visual line in or immediately near that region. A delete erases only the
  matched glyphs and original occupancy, fills from neighboring background, and never treats the
  whole box as a mask or changes any other subject, logo, pattern, layout, or text.
- Prompt messages, roleless Prompt, Base64, and raw Provider responses are never persisted.

### 4. Validation & Error Matrix

- Non-active/non-generated/missing asset -> a safe non-retryable asset error before Provider invocation.
- Missing/unavailable model configuration -> non-retryable `MODEL_CAPABILITY_UNAVAILABLE`. Provider
  response read, parse, or response-shape failures -> safe retryable
  `IMAGE_TEXT_RECOGNITION_PROVIDER_UNAVAILABLE`; never collapse both categories into one validation error.
- Invalid recognition JSON/top-level/items structure, more than 100 raw lines, or blank/overlong text ->
  `IMAGE_TEXT_RECOGNITION_OUTPUT_INVALID` without raw output. A valid text item with a missing, mistyped,
  non-finite, out-of-range, reversed-edge, or ambiguous legacy bbox is skipped individually; other items
  remain ordered and receive new continuous runtime line IDs. If every bbox is skipped, return empty items.
- Prefer an unambiguous OCR Provider schema using normalized `left/top/right/bottom`, validate edge
  order, and deterministically convert it to the public canonical `x/y/width/height` contract. If a
  model still returns legacy xywh, require every member to remain finite and individually normalized.
  Interpret the last two members as right/bottom only when an overflowing legacy batch consistently
  satisfies edge ordering for every legacy item; otherwise keep canonical xywh items and skip only
  ambiguous overflowing items. Never expand an unreliable box to the image edge, guess pixel/percentage
  coordinates, or move the anchor. Every invalid persisted text-rewrite bbox remains a strict failure.
- An OCR bbox is an approximate spatial hint, not an edit mask. The image-edit Prompt must use
  `originalText` as the primary visual anchor, edit only a unique reliable match, leave ambiguous or
  missing matches unchanged, and never erase or redraw the whole approximate box. Fidelity boundaries
  must protect everything outside the matched glyphs and original occupancy, not treat the approximate
  box edge as an absolute boundary that conflicts with nearby matching.
- Pure JSON and one complete `json` Markdown fence are accepted; prose-wrapped or partially fenced JSON
  remains invalid. Both whole-output failures and per-item skips may include only a fixed reason, item index,
  field name, output length, and fence presence, never recognized text, coordinate values, or raw Provider
  output.
- Empty recognition `items` -> successful empty result.
- Empty/duplicate/overlong rewrite changes, invalid bbox, conflicting replace/delete fields, or unchanged
  replace -> `IMAGE_TEXT_REWRITE_INPUT_INVALID` before Provider invocation.

### 5. Good/Base/Bad Cases

- Good: recognize one active asset, submit only changed lines, then atomically replace its stable slot.
- Base: recognition returns an empty list and no generation task is created.
- Bad: accept a frontend Data URL, trust the previous OCR bbox, or persist the complete edit Prompt.

### 6. Tests Required

- Assert the command input contains only `assetId` and the gateway request is constructed in Rust memory.
- Assert the OCR gateway input carries the explicit 12,000-token output budget and that Provider response
  failures remain retryable without exposing their raw message.
- Assert empty OCR output, normalization, stable IDs, bounds, over-limit text, and safe typed errors.
- Assert every invalid rewrite form fails before Provider invocation and creates no output asset.
- Assert delete Prompt boundaries and persisted task JSON exclusions.

### 7. Wrong vs Correct

#### Wrong

```json
{"assetDataUrl":"data:image/png;base64,...","recognizedBoxes":[{"x":2,"width":-1}]}
```

#### Correct

```json
{"assetId":"asset-current"}
```
