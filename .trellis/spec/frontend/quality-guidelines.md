# Quality Guidelines

> Code quality standards for frontend development.

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

<!-- What reviewers should check -->

(To be filled by the team)

---

## Scenario: Source image cards in generated result views

### 1. Scope / Trigger

- Trigger: a product, clothing, or scene workflow displays uploaded reference images beside generated outputs, including after history restoration.

### 2. Signatures

- `GeneratedDetailImage.kind = "source-image"` identifies the read-only source card.
- Live workflows freeze displayable source images in the same input snapshot/context used to create the generation task.
- Restored workflows rebuild the source card from persisted `inputAssets` whose role is `source` or `reference`.

### 3. Contracts

- The source card is the first result-grid item and has `status = "complete"`.
- It is not a generated asset and must not contribute to generated counts, status derivation, selection, download, long preview, image viewer, delete, resize, retry, or history thumbnails.
- Generated output matching uses stable `imageNo` / `sortOrder`; inserting a source card must not shift output-asset indexing.
- A real lightbox image keeps `object-contain`, but its wrapper shrink-wraps the intrinsic image ratio using maximum viewport bounds. Fixed aspect-ratio backgrounds are only for asset-less placeholders.

### 4. Validation & Error Matrix

- No source/reference asset -> omit the source card; keep generated results usable.
- Missing generated output -> mark only that generated slot failed; never fail the source card.
- Source card inserted before generated outputs -> output sort order `0` still maps to generated image `1`, not the source card.

### 5. Good/Base/Bad Cases

- Good: live and restored scene results both show one source card followed by generated cards; history still reports only generated count.
- Base: a task with no recoverable reference asset displays generated cards only.
- Bad: prepend the source card and then map Provider outputs by raw array index, which attaches output `0` to the source item.

### 6. Tests Required

- Assert the source card is the first `article`, has no checkbox/action buttons, and generated-card count is unchanged.
- Assert restored history rebuilds the source card from `inputAssets` and history count/thumbnail still use generated outputs.
- Assert a non-square lightbox image has intrinsic-size classes, no fixed square light background, and no white radial overlay.

### 7. Wrong vs Correct

#### Wrong

```typescript
const images = [sourceImage, ...generatedImages];
return images.map((image, index) => attachOutput(image, outputs[index]));
```

#### Correct

```typescript
return images.map((image) => {
  if (image.kind === "source-image") return image;
  return attachOutput(image, outputs[image.imageNo - 1]);
});
```

## Scenario: AI-routed scene configuration

### 1. Scope / Trigger

- Trigger: the scene workspace lets the backend select a scene template from the embedded catalog.

### 2. Signatures

- `SceneConfigState` contains only `referenceImages`, `outputMode`, `ratio`, and `supplementalInfo`.
- The planning task input must not contain `selectedSceneTemplateId` or
  `selectedVisualDirectionId`.

### 3. Contracts

- The UI does not render template categories, template radios, or visual-direction radios.
- `supplementalInfo.trim()` is required before task creation and the trimmed value is submitted.
- Reference images and supplemental information together describe what the router may infer.

### 4. Validation & Error Matrix

- No reference image -> CTA is disabled and asks for a reference image.
- Blank or whitespace-only supplemental information -> CTA is disabled and asks for information.
- Both present -> create one scene planning task; runtime performs routing internally.

### 5. Good/Base/Bad Cases

- Good: a user uploads a person and enters “create a fashion magazine portrait”; no template radio
  is required.
- Base: output mode and ratio retain their defaults, but supplemental information is still required.
- Bad: hide the old controls while still submitting default `hero-image/minimal` fields.

### 6. Tests Required

- Assert no template/direction controls render.
- Assert `required` and `aria-required`, whitespace rejection, and trimmed task payload.
- Assert the request contains no removed selection fields.

### 7. Wrong vs Correct

#### Wrong

```typescript
input: { selectedSceneTemplateId: "hero-image", selectedVisualDirectionId: "minimal" }
```

#### Correct

```typescript
input: { supplementalInfo: config.supplementalInfo.trim() }
```

## Scenario: Restored non-terminal scene tasks

### 1. Scope / Trigger

- Trigger: React/WebView reload restores a scene parent task or single-image retry that the Rust
  runtime still reports as `queued` or `running`.

### 2. Contracts

- Re-register the task for cancellation and resume polling from persisted task detail.
- Do not call `runTask` again for a task already reported as `running`; a `queued` task may use the
  existing poller's start semantics.
- A completed parent refreshes generated assets and derived history status.
- A completed retry merges into its stable parent slot before hiding the child task.
- Effect cleanup or record deletion must stop the restored publisher without losing cancellation
  tracking for a still-running backend task.
- A newer scene request must not stop restored history polling. It only prevents the older record
  from replacing the current scene canvas; the older history record still reaches its real terminal
  state.
- Tasks already restored as `interrupted` are terminal and must not be restarted.

### 3. Tests Required

- Restore a running parent, return a succeeded detail on a later poll, and assert no duplicate
  `runTask` call.
- Restore a running retry, complete it, and assert replacement into the parent slot.
- Verify queued tasks use the existing start path and unmounted effects do not publish state.

## Scenario: Scene title code normalization

- Treat `code` and model-owned `title` as separate fields.
- Display exactly one leading code: prepend it only when the title does not already start with the
  same code.
- Test both `title = "Main visual"` and `title = "H1 Main visual"`.
