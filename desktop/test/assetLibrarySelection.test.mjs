import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);
const globalCssSource = readFileSync(
  new URL("../src/shared/styles/global.css", import.meta.url),
  "utf8",
);

test("asset library selection is separate from removing an asset from the combination", () => {
  assert.match(workflowCanvasSource, /currentGarmentAssetIds/);
  assert.match(workflowCanvasSource, /deselectedAssetLibraryPersonIds/);
  assert.match(workflowCanvasSource, /deselectedAssetLibraryGarmentIds/);
  assert.match(workflowCanvasSource, /COMBINATION_SELECTION_STATE_STORAGE_KEY/);
  assert.match(workflowCanvasSource, /function applyCombinationAssetSelection\(combination: ImageCombination\)/);
  assert.match(workflowCanvasSource, /function toggleGarmentAssetSelection\(assetId: string\)/);
  assert.match(
    workflowCanvasSource,
    /function togglePersonAssetSelection\(assetId: string\)[\s\S]*?setSelectedPersonId\(assetId\)/,
  );
  assert.match(
    workflowCanvasSource,
    /function togglePersonAssetSelection\(assetId: string\)[\s\S]*?setSelectedPersonId\(null\)/,
  );
  assert.match(
    workflowCanvasSource,
    /function toggleGarmentAssetSelection\(assetId: string\)[\s\S]*?buildDeselectedAssetIdsFromActiveIds/,
  );
  assert.match(
    workflowCanvasSource,
    /function toggleGarmentAssetSelection\(assetId: string\)[\s\S]*?storeCombinationSelectionState/,
  );
  assert.match(workflowCanvasSource, /currentPersonAssetIds={currentPersonAssetIds}/);
  assert.match(workflowCanvasSource, /currentGarmentAssetIds={currentGarmentAssetIds}/);
  assert.match(workflowCanvasSource, /deselectedPersonAssetIds={deselectedAssetLibraryPersonIds}/);
  assert.match(workflowCanvasSource, /currentPersonAssetIds: string\[\];/);
  assert.match(workflowCanvasSource, /currentGarmentAssetIds: string\[\];/);
  assert.match(workflowCanvasSource, /deselectedPersonAssetIds: string\[\];/);
  assert.match(workflowCanvasSource, /deselectedGarmentAssetIds: string\[\];/);
  assert.match(
    workflowCanvasSource,
    /asset\.asset\.id === selectedPersonId &&\s*currentPersonAssetIds\.includes\(asset\.asset\.id\) &&\s*!deselectedPersonAssetIds\.includes\(asset\.asset\.id\)/,
  );
  assert.match(
    workflowCanvasSource,
    /currentGarmentAssetIds\.includes\(asset\.asset\.id\) &&\s*selectedGarmentIds\.includes\(asset\.asset\.id\)/,
  );
  assert.match(
    workflowCanvasSource,
    /buildCurrentCombinationAssetView\(\{[\s\S]*?garmentAssetIds: currentGarmentAssetIds/,
  );
  assert.match(
    workflowCanvasSource,
    /workbenchAutoSaveInput = useMemo<WorkbenchAutoSaveInput>\([\s\S]*?garmentAssetIds: currentGarmentAssetIds/,
  );
  assert.match(
    workflowCanvasSource,
    /async function persistCurrentCombination\(\)[\s\S]*?garmentAssetIds: currentGarmentAssetIds/,
  );
  assert.match(
    workflowCanvasSource,
    /startGeneration\(\{[\s\S]*?draftGarmentAssetIds: selectedGarmentIds/,
  );
  assert.match(workflowCanvasSource, /function removeGarmentFromCurrentCombination\(assetId: string\)/);
  assert.match(workflowCanvasSource, /function removePersonFromCurrentCombination\(assetId: string\)/);
  assert.match(workflowCanvasSource, /onRemovePerson={removePersonFromCurrentCombination}/);
  assert.match(workflowCanvasSource, /onRemoveGarment={removeGarmentFromCurrentCombination}/);
  assert.match(workflowCanvasSource, /onRemove={onRemovePerson}/);
  assert.match(workflowCanvasSource, /onRemove={onRemoveGarment}/);
  assert.match(workflowCanvasSource, /className="asset-thumb__remove"/);
  assert.match(globalCssSource, /\.asset-thumb__remove\b/);
  assert.doesNotMatch(workflowCanvasSource, /function selectGarment\(assetId: string\)/);
});

test("asset thumb selection and remove controls stay compact and centered", () => {
  assert.match(globalCssSource, /\.asset-thumb\s*\{[\s\S]*?border:\s*2px solid #e1e7f0/);
  assert.match(globalCssSource, /\.asset-thumb\.is-selected\s*\{[\s\S]*?border-color:\s*#2563eb/);
  assert.doesNotMatch(globalCssSource, /\.asset-thumb\.is-selected\s*\{[\s\S]*?border:\s*2px solid #2563eb/);
  assert.match(globalCssSource, /\.asset-thumb__check\s*\{[\s\S]*?width:\s*10px/);
  assert.match(globalCssSource, /\.asset-thumb__check\s*\{[\s\S]*?height:\s*10px/);
  assert.match(globalCssSource, /\.asset-thumb__check\s*\{[\s\S]*?background:\s*#ffffff/);
  assert.doesNotMatch(globalCssSource, /\.asset-thumb__check::after/);
  assert.doesNotMatch(globalCssSource, /\.asset-thumb__check\s*\{[\s\S]*?border:\s*2px solid #ffffff/);
  assert.match(globalCssSource, /\.asset-thumb__check-dot\s*\{[\s\S]*?width:\s*6px/);
  assert.match(globalCssSource, /\.asset-thumb__check-dot\s*\{[\s\S]*?height:\s*6px/);
  assert.match(globalCssSource, /\.asset-thumb__check-dot\s*\{[\s\S]*?background:\s*#2563eb/);
  assert.match(globalCssSource, /\.asset-thumb__remove\s*\{[\s\S]*?width:\s*18px/);
  assert.match(globalCssSource, /\.asset-thumb__remove\s*\{[\s\S]*?height:\s*18px/);
  assert.match(globalCssSource, /\.asset-thumb__remove\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(
    globalCssSource,
    /\.asset-thumb:hover \.asset-thumb__remove,\s*\.asset-thumb:focus-within \.asset-thumb__remove\s*\{[\s\S]*?pointer-events:\s*auto/,
  );
  assert.match(globalCssSource, /\.asset-thumb__remove svg\s*\{[\s\S]*?width:\s*12px/);
  assert.match(globalCssSource, /\.asset-thumb__remove svg\s*\{[\s\S]*?height:\s*12px/);
});

test("new combination asset picker keeps selected thumbnail sizing stable", () => {
  const modalThumbRule = globalCssSource.match(/^\.modal-resource-grid button\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
  const modalSelectedRule =
    globalCssSource.match(/^\.modal-resource-grid button\.is-selected\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
  assert.notEqual(modalThumbRule, "");
  assert.notEqual(modalSelectedRule, "");

  assert.match(modalThumbRule, /border:\s*2px solid #e1e7f0/);
  assert.match(modalSelectedRule, /border-color:\s*#2563eb/);
  assert.doesNotMatch(modalSelectedRule, /border:\s*2px solid #2563eb/);
});

test("asset library scrolls within the floating side panel", () => {
  const assetLibraryRule = globalCssSource.match(/^\.asset-library\s*\{(?<body>[^}]*)\}/m)?.groups?.body ?? "";
  assert.notEqual(assetLibraryRule, "");

  assert.match(globalCssSource, /\.floating-panel-slot\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(globalCssSource, /\.floating-panel-slot > \.asset-library[\s\S]*?height:\s*100%/);
  assert.match(assetLibraryRule, /overflow-x:\s*hidden/);
  assert.match(assetLibraryRule, /overflow-y:\s*auto/);
  assert.match(assetLibraryRule, /overscroll-behavior:\s*contain/);
  assert.match(assetLibraryRule, /scrollbar-gutter:\s*stable/);
  assert.match(globalCssSource, /\.asset-library::-webkit-scrollbar\s*\{[\s\S]*?width:\s*8px/);
  assert.doesNotMatch(workflowCanvasSource, /className="all-assets"/);
  assert.doesNotMatch(workflowCanvasSource, /刷新全部资源/);
  assert.doesNotMatch(globalCssSource, /\.all-assets\b/);
});

test("asset library import does not replace active selections", () => {
  assert.doesNotMatch(workflowCanvasSource, /pickCurrentPersonAssetIdAfterImport/);
  assert.doesNotMatch(workflowCanvasSource, /buildSelectedGarmentAssetIdsAfterImport/);
  assert.match(
    workflowCanvasSource,
    /async function handleImport\(assetType:[\s\S]*?setPeople\(\(items\) => saveOrderedAssets\("person", upsertAssets\(items, views\)\)\);[\s\S]*?setCurrentPersonAssetIds\(nextCurrentPersonAssetIds\);/,
  );
  assert.match(
    workflowCanvasSource,
    /async function handleImport\(assetType:[\s\S]*?setGarments\(\(items\) => saveOrderedAssets\("garment", upsertAssets\(items, views\)\)\);[\s\S]*?setCurrentGarmentAssetIds\(nextCurrentGarmentAssetIds\);/,
  );
});

test("canvas and image context menus are custom Chinese menus", () => {
  assert.match(workflowCanvasSource, /type WorkbenchContextMenuState/);
  assert.match(workflowCanvasSource, /function WorkbenchContextMenu/);
  assert.match(workflowCanvasSource, /import \{ createPortal \} from "react-dom";/);
  assert.match(workflowCanvasSource, /createPortal\([\s\S]*?document\.body/);
  assert.match(workflowCanvasSource, /label:\s*"适配画布"/);
  assert.match(workflowCanvasSource, /label:\s*"重置视图"/);
  assert.match(workflowCanvasSource, /label:\s*isGridVisible \? "隐藏网格" : "显示网格"/);
  assert.match(workflowCanvasSource, /label:\s*asset\.selected \? "取消选中图片" : "选中图片"/);
  assert.match(workflowCanvasSource, /label:\s*"从当前组合移除"/);
  assert.match(workflowCanvasSource, /onContextMenu=\{openAssetContextMenu\}/);
  assert.match(workflowCanvasSource, /onContextMenu=\{openCanvasContextMenu\}/);
  assert.match(workflowCanvasSource, /event\.preventDefault\(\)/);
  assert.match(
    workflowCanvasSource,
    /function WorkbenchContextMenu[\s\S]*?onClick=\{\(event\) => \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?item\.onSelect\(\);/,
  );
  assert.match(workflowCanvasSource, /role="menu"/);
  assert.match(workflowCanvasSource, /role="menuitem"/);
  assert.match(globalCssSource, /\.workbench-context-menu\s*\{/);
});
