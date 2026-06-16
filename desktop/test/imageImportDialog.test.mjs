import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);

test("image import dialog opens from the system picture directory when available", () => {
  assert.match(workflowCanvasSource, /import \{ pictureDir \} from "@tauri-apps\/api\/path";/);
  assert.match(workflowCanvasSource, /async function getDefaultImageDialogPath\(\)/);
  assert.match(workflowCanvasSource, /const defaultPath = await getDefaultImageDialogPath\(\);/);
  assert.match(workflowCanvasSource, /defaultPath,/);
  assert.match(workflowCanvasSource, /return await pictureDir\(\);/);
});

test("image import dialog configuration is shared by workbench and new combination imports", () => {
  assert.match(workflowCanvasSource, /async function openImagePicker\(/);
  assert.match(workflowCanvasSource, /const selected = await openImagePicker\(assetType\);/);
  assert.doesNotMatch(workflowCanvasSource, /openImagePicker\(assetType, \{ multiple: assetType === "garment" \}\)/);
});

test("new combination import allows multiple people and garments", () => {
  assert.match(workflowCanvasSource, /async function openImagePicker\([\s\S]*?options: \{ multiple\?: boolean \} = \{\}/);
  assert.match(workflowCanvasSource, /multiple: options\.multiple \?\? true/);
  assert.match(
    workflowCanvasSource,
    /async function handleImportForNewCombination[\s\S]*?openImagePicker\(assetType\)/,
  );
  assert.match(workflowCanvasSource, /buildNewCombinationPersonAssetIdsAfterImport/);
  assert.doesNotMatch(
    workflowCanvasSource,
    /setNewCombinationForm\(\(form\) => \(\{[\s\S]*?personAssetId: views\[0\]\.asset\.id/,
  );
});
