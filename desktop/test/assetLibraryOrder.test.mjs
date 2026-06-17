import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_LIBRARY_ORDER_STORAGE_KEY,
  applyStoredAssetOrder,
  assetIds,
  isAssetDropTarget,
  moveAssetById,
  readAssetLibraryOrder,
  saveAssetLibraryOrder,
} from "../src/features/workflow/components/assetLibraryOrder.ts";

function asset(id) {
  return {
    asset: {
      id,
      assetType: "person",
      originalName: `${id}.jpg`,
      relativePath: `${id}.jpg`,
      thumbRelativePath: `${id}.thumb.jpg`,
      mimeType: "image/jpeg",
      sha256: id,
      width: 100,
      height: 100,
      createdAt: "2026-06-12T00:00:00Z",
    },
    filePath: `${id}.jpg`,
    thumbFilePath: `${id}.thumb.jpg`,
    thumbDataUrl: null,
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("stored asset order is applied after newly discovered assets", () => {
  const items = [asset("new"), asset("a"), asset("b"), asset("c")];

  assert.deepEqual(assetIds(applyStoredAssetOrder(items, ["c", "a"])), [
    "new",
    "b",
    "c",
    "a",
  ]);
});

test("asset reorder moves the dragged item to the drop target index", () => {
  const items = [asset("a"), asset("b"), asset("c"), asset("d")];

  assert.deepEqual(assetIds(moveAssetById(items, "a", "c")), ["b", "c", "a", "d"]);
  assert.deepEqual(assetIds(moveAssetById(items, "d", "b")), ["a", "d", "b", "c"]);
});

test("asset drop target is shown only for the current snap target", () => {
  assert.equal(
    isAssetDropTarget({ activeId: "a", overId: "c", assetId: "c" }),
    true,
  );
  assert.equal(
    isAssetDropTarget({ activeId: "a", overId: "c", assetId: "a" }),
    false,
  );
  assert.equal(
    isAssetDropTarget({ activeId: "a", overId: "a", assetId: "a" }),
    false,
  );
  assert.equal(
    isAssetDropTarget({ activeId: "a", overId: null, assetId: "c" }),
    false,
  );
});

test("invalid asset reorder keeps the original array reference", () => {
  const items = [asset("a"), asset("b")];

  assert.equal(moveAssetById(items, "a", "a"), items);
  assert.equal(moveAssetById(items, "missing", "a"), items);
  assert.equal(moveAssetById(items, "a", "missing"), items);
});

test("asset library order storage keeps people and garments separate", () => {
  const storage = createStorage();

  saveAssetLibraryOrder(storage, "person", ["p2", "p1"]);
  saveAssetLibraryOrder(storage, "garment", ["g1", "g3", "g2"]);

  assert.deepEqual(readAssetLibraryOrder(storage, "person"), ["p2", "p1"]);
  assert.deepEqual(readAssetLibraryOrder(storage, "garment"), ["g1", "g3", "g2"]);
});

test("asset library order storage ignores malformed saved data", () => {
  const storage = createStorage({
    [ASSET_LIBRARY_ORDER_STORAGE_KEY]: "{bad json",
  });

  assert.deepEqual(readAssetLibraryOrder(storage, "person"), []);
});
