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

## Scenario: Result image rewrite across workspaces and history

### 1. Scope / Trigger

- Trigger: a product, clothing, or scene generated image is edited from the live result canvas or from an opened history record.

### 2. Signatures

- `PreviewCanvas.onImageRewrite(image, instruction)` owns the shared UI handoff.
- The created task has `kind = "image-edit"`, one `inputAssets(role = "reference")` entry, and lineage fields `parentTaskId`, `targetImageId`, `imageNo`, and `sourceAssetId`.

### 3. Contracts

- The reference asset is the asset currently displayed on the card, including a replacement restored from history; never reuse the original parent output blindly.
- The frontend persists only the trimmed `rewriteInstruction`; Rust constructs `prompt.messages` and
  `prompt.rolelessPrompt` in memory after loading the current reference asset. Prompt, Base64, and raw
  image URLs must not enter the task snapshot.
- Model config is resolved by the Rust executor for `image-edit` when the task runs, so the current default real config is used; `mock-local` must not produce a mergeable rewrite.
- Success replaces the stable parent slot; Provider or merge failure preserves the displayed image.
- Record lookup and UI write-back require the exact record currently displayed by the operation's workspace.
  A history record ID is eligible only when that record belongs to the same workspace; otherwise use that
  workspace's own displayed/active record. Do not fall back to a workspace-wide image-ID search. Stable image
  IDs may repeat across history records.
- History-viewing identity is workspace-scoped. The read-only result layout and history-popover active row must
  both derive from the current workspace's exact displayed record, not the last globally opened record.

### 4. Validation & Error Matrix

- Missing displayed `assetId` -> reject before task creation.
- Missing persisted parent task or stable image number -> reject before Provider invocation.
- Replacement lineage mismatch or changed parent slot -> clean up the unmerged derived task and keep the displayed image.
- Missing rewrite handler in production wiring -> do not treat a local loading timer as a successful rewrite.

### 5. Good/Base/Bad Cases

- Good: open an older scene record, edit its current replacement asset, and update only that record after the replacement transaction succeeds.
- Base: edit a live product result using its current generated asset.
- Bad: find every clothing record with the same `imageId` and overwrite them all after one history edit.

### 6. Tests Required

- Assert product, clothing, and scene task creation uses the correct workspace, current asset, stable lineage fields, and trimmed instruction.
- Assert at least one restored history path uses the restored current asset and updates only the opened record.
- Open history A, then history B in another workspace, navigate back to A, and assert A keeps the read-only
  layout and is the only active row in the history popover.
- Assert success calls `replaceResultImage`; Provider or replacement failure leaves the original `src` intact.
- Assert the rewrite submit button has the exact accessible name and text `重新生成`, without a credit icon or number.

### 7. Wrong vs Correct

#### Wrong

```typescript
const record = records.find((item) => item.workspace === workspace && item.images.some(({ id }) => id === imageId));
updateEveryRecordWithImageId(imageId, replacement);
```

#### Correct

```typescript
const historyRecord = records.find(
  (item) => item.id === historyViewingRecordId && item.workspace === workspace,
);
const displayedRecordId = historyRecord?.id ?? activeRecordIdForWorkspace(workspace);
const record = records.find((item) => item.id === displayedRecordId && item.workspace === workspace);
updateGeneratedImageForRecord(record.id, workspace, imageId, replacement);
```

## Scenario: Generated result downloads

### 1. Scope / Trigger

- Product, clothing, scene, and restored-history result pages share the download behavior owned by
  `PreviewCanvas`.
- Download inputs contain only completed generated assets. Source/reference cards, listing copy, generating
  cards, and failed cards never enter long previews or archives.

### 2. Contracts

- A long-image download must fetch each workspace asset into a `Blob` before decoding it for Canvas. Never
  draw an `asset://` image element directly onto Canvas, because the resulting canvas may be origin-tainted.
- Decode through `createImageBitmap` or a temporary object URL, and release the bitmap/object URL after each
  section is drawn.
- The saved `.png` must contain PNG bytes produced by Canvas. Do not use SVG markup, gradients, or other
  placeholder content as a fallback for a PNG filename.
- Bound long-image allocation by both maximum Canvas dimension and maximum pixel count, applying one uniform
  scale to every section so image order and aspect ratios remain stable.
- ZIP downloads contain the original generated asset bytes and preserve supported file extensions. Set the
  ZIP UTF-8 filename flag for Chinese titles. Read archive sources sequentially and reject more than 32 MiB
  of source bytes with an actionable split-download toast; the current JSON IPC is not a streaming transport.
- Before converting any single image, long PNG, or ZIP to a JavaScript number array, reject a final payload
  larger than 32 MiB. This final-payload check is mandatory even when an earlier source-size check exists.
- Every async download entry has a loading/disabled state, blocks duplicate submission, and reports fetch,
  decode, Canvas, encoding, and native-save failures through a visible toast. Cancelling the native save
  dialog is not an error.
- Single-image, long-image, and ZIP downloads share one synchronous operation mutex. While any download is
  reading assets, encoding bytes, or waiting for the native save flow, every other download entry is disabled;
  separate per-button loading states are not sufficient because they allow multiple 32 MiB operations to run
  concurrently.

### 3. Tests Required

- Exercise the real Canvas path with fetched asset bytes and assert a PNG signature is sent to the native
  save command; a jsdom-only SVG fallback is not valid coverage.
- Assert Canvas security/encoding failure restores the button and displays an error.
- Assert repeated clicks while the save dialog is pending produce one save request.
- Start one download type with an unresolved save request and assert the other download types are disabled and
  cannot open a second save request until the first operation releases its mutex.
- Assert ZIP output contains the original generated image byte sequence.

## Scenario: Generated-image text editing dialog

### 1. Scope / Trigger

- Trigger: product, clothing, or scene result cards, including restored history records, expose
  `编辑文字`.

### 2. Signatures

- `PreviewCanvas.onRecognizeImageText(image): Promise<ImageTextRecognitionResult>`.
- `PreviewCanvas.onImageTextRewrite(image, changes): Promise<void>`.
- `ResultImageTextChange` is an explicit `replace` or `delete` discriminated union with a normalized box.

### 3. Contracts

- Opening is synchronous and enters `recognizing` with an accessible skeleton; never show static sample
  text while waiting.
- Recognition and submission are bound to history-record scope, dialog session, target image, and source
  asset identities.
- Only changed trimmed rows are submitted. Empty replacement means explicit `delete`; non-empty means
  `replace`. No effective change keeps `确认改字` disabled.
- After the request/session/asset identity check still passes, empty recognition is closed by the
  component and reported once through the App global warning toast. A stale empty response is ignored.
- Submission failure is reported once through the App global error toast and preserves the edited rows.
- Reconcile `detailImages` updates against the active target image and its captured source asset. An
  unrelated card update must not close the dialog.
- App supplies the global rewrite-error notifier, but the dialog invokes it only after the submitting
  session, target, and source asset still match. A stale A failure must neither toast nor mutate B.
- Submission markers are scoped by record, image, and operation token. Switching scope closes the dialog but
  does not release an in-flight marker; returning A after A -> B -> A remains locked until A's own `finally`
  removes only its token.
- Submission markers must outlive a `PreviewCanvas` / `GeneratedDetailCanvas` component instance. Keep them
  in a subscribed store outside component-local state so conditional workspace rendering cannot unlock a paid
  request. Component unmount invalidates dialog/request identities, but never clears the in-flight marker.

### 4. Validation & Error Matrix

- `retryable=true` recognition error -> keep dialog open and show retry.
- `retryable=false` -> keep safe error and close controls, with no retry.
- Source asset changes before submit -> reject and require a new recognition.
- Submission in progress -> disable inputs, X, cancel, confirm, and backdrop close.
- Component unmount/remount during submission -> the same scope/image remains generating until the original
  operation token is removed.
- Late result from an old request/session/asset -> ignore it.

### 5. Good/Base/Bad Cases

- Good: clear one recognized line, submit one delete change, and keep every other row unchanged.
- Base: edit nothing; the confirm button remains disabled and contains no credit icon or count.
- Bad: reuse OCR rows after resize, close a newer dialog when an older submit resolves, or emit duplicate
  local and global toasts.

### 6. Tests Required

- Cover skeleton/ready/typed error/retry, no-change disabled, changed-only replace, explicit delete, and
  submission locking.
- Cover closed/retargeted/stale-asset late recognition and old-submit/new-dialog isolation.
- Cover unrelated list rerenders while B is open, stale A failure without a toast, and a source asset
  change during submit followed by failure without restoring stale ready state.
- Cover opening history in workspace A and then switching to workspace B; B recognition/submission must use
  B's own displayed record rather than A's retained history ID.
- Cover concurrent A/B submits and A -> B -> A; both markers remain independent and each `finally` releases
  only its own operation token.
- Cover a real unmount and remount of the same scope/image while submission is unresolved; rerender-only
  coverage is insufficient because it preserves component-local state.
- Cover App task payload, current record/current asset lineage, empty-result global toast, and success/failure
  stable-slot behavior across live and restored workspaces.

### 7. Wrong vs Correct

#### Wrong

```typescript
setRows(["Size Guide", "Length (CM)"]);
onRewrite(image, rows);
```

#### Correct

```typescript
const result = await onRecognizeImageText(image);
await onImageTextRewrite(image, createChangedRows(result.items, editedValues));
```

For submission locks, component-local state is insufficient:

```typescript
// Wrong: conditional workspace rendering releases the lock on unmount.
const [pendingOperations, setPendingOperations] = useState([]);

// Correct: subscribe to a record-scoped store whose lifetime outlives the canvas instance.
const pendingOperations = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
```
