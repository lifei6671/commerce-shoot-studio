import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCombinationPersonAssetIdsAfterImport,
  buildCurrentCombinationAssetView,
  pickCurrentPersonAssetIdAfterImport,
} from "../src/features/workflow/components/currentCombinationAssets.ts";

function asset(id, assetType = "person") {
  return {
    asset: {
      id,
      assetType,
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

function assetIds(items) {
  return items.map((item) => item.asset.id);
}

test("current combination asset view filters people and garments to the combination", () => {
  const people = [asset("person-a"), asset("person-b")];
  const garments = [
    asset("garment-a", "garment"),
    asset("garment-b", "garment"),
    asset("garment-c", "garment"),
  ];
  const results = [{ assetId: "result-a" }];

  const view = buildCurrentCombinationAssetView({
    people,
    garments,
    results,
    personAssetId: "person-b",
    garmentAssetIds: ["garment-c", "garment-a"],
  });

  assert.deepEqual(assetIds(view.people), ["person-b"]);
  assert.deepEqual(assetIds(view.garments), ["garment-c", "garment-a"]);
  assert.equal(view.results, results);
});

test("current combination asset view keeps multiple people for the combination library", () => {
  const people = [asset("person-a"), asset("person-b"), asset("person-c")];

  const view = buildCurrentCombinationAssetView({
    people,
    garments: [],
    results: [],
    personAssetId: "person-a",
    personAssetIds: ["person-b", "person-a"],
    garmentAssetIds: [],
  });

  assert.deepEqual(assetIds(view.people), ["person-b", "person-a"]);
});

test("current combination asset view is recalculated when switching combinations", () => {
  const people = [asset("person-a"), asset("person-b")];
  const garments = [
    asset("garment-a", "garment"),
    asset("garment-b", "garment"),
    asset("garment-c", "garment"),
  ];

  const firstView = buildCurrentCombinationAssetView({
    people,
    garments,
    results: [{ assetId: "result-a" }],
    personAssetId: "person-a",
    garmentAssetIds: ["garment-a", "garment-b"],
  });
  const secondView = buildCurrentCombinationAssetView({
    people,
    garments,
    results: [{ assetId: "result-b" }],
    personAssetId: "person-b",
    garmentAssetIds: ["garment-c"],
  });

  assert.deepEqual(assetIds(firstView.people), ["person-a"]);
  assert.deepEqual(assetIds(firstView.garments), ["garment-a", "garment-b"]);
  assert.deepEqual(firstView.results.map((result) => result.assetId), ["result-a"]);
  assert.deepEqual(assetIds(secondView.people), ["person-b"]);
  assert.deepEqual(assetIds(secondView.garments), ["garment-c"]);
  assert.deepEqual(secondView.results.map((result) => result.assetId), ["result-b"]);
});

test("imported person becomes the current combination person", () => {
  assert.equal(
    pickCurrentPersonAssetIdAfterImport({
      currentPersonAssetId: "person-a",
      importedPeople: [asset("person-b")],
    }),
    "person-b",
  );
  assert.equal(
    pickCurrentPersonAssetIdAfterImport({
      currentPersonAssetId: "person-a",
      importedPeople: [],
    }),
    "person-a",
  );
});

test("imported people are appended to the current combination person library", () => {
  assert.deepEqual(
    buildCombinationPersonAssetIdsAfterImport({
      currentPersonAssetId: "person-a",
      currentPersonAssetIds: ["person-a"],
      importedPeople: [asset("person-b"), asset("person-c")],
    }),
    ["person-b", "person-c", "person-a"],
  );
  assert.deepEqual(
    buildCombinationPersonAssetIdsAfterImport({
      currentPersonAssetId: "person-a",
      currentPersonAssetIds: [],
      importedPeople: [],
    }),
    ["person-a"],
  );
});
