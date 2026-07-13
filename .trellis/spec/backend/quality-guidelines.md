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
