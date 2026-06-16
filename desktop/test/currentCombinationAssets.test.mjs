import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildActiveGarmentAssetIdsForCombination,
  buildActivePersonAssetIdForCombination,
  buildCombinationGarmentAssetIdsAfterImport,
  buildCombinationAssetIdsAfterReorder,
  buildCombinationPersonAssetIdsAfterImport,
  buildCurrentCombinationAssetView,
  buildDeselectedAssetIdsFromActiveIds,
  buildPersonAssetSelectionAfterRemove,
  buildSelectedAssetIdsAfterCombinationReorder,
  toggleDeselectedAssetId,
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

test("imported garments are added to the current combination garment library without duplicates", () => {
  assert.deepEqual(
    buildCombinationGarmentAssetIdsAfterImport({
      currentGarmentAssetIds: ["garment-a", "garment-b", "garment-c", "garment-d"],
      importedGarments: [
        asset("garment-e", "garment"),
        asset("garment-b", "garment"),
        asset("garment-f", "garment"),
      ],
    }),
    ["garment-e", "garment-f", "garment-a", "garment-b", "garment-c", "garment-d"],
  );
});

test("imported garments stay inactive until explicitly selected", () => {
  const nextCurrentGarmentIds = buildCombinationGarmentAssetIdsAfterImport({
    currentGarmentAssetIds: ["garment-a", "garment-b", "garment-c", "garment-d"],
    importedGarments: [
      asset("garment-e", "garment"),
      asset("garment-b", "garment"),
      asset("garment-f", "garment"),
    ],
  });

  assert.deepEqual(
    buildDeselectedAssetIdsFromActiveIds({
      currentAssetIds: nextCurrentGarmentIds,
      activeAssetIds: ["garment-a", "garment-b", "garment-c", "garment-d"],
    }),
    ["garment-e", "garment-f"],
  );
});

test("current combination asset order follows asset library drag reorder", () => {
  assert.deepEqual(
    buildCombinationAssetIdsAfterReorder({
      currentAssetIds: ["garment-a", "garment-b", "garment-c", "garment-d"],
      activeId: "garment-d",
      overId: "garment-b",
    }),
    ["garment-a", "garment-d", "garment-b", "garment-c"],
  );

  const unchanged = ["garment-a", "garment-b"];
  assert.equal(
    buildCombinationAssetIdsAfterReorder({
      currentAssetIds: unchanged,
      activeId: "garment-a",
      overId: "missing",
    }),
    unchanged,
  );
});

test("selected garment order follows reordered current combination order", () => {
  assert.deepEqual(
    buildSelectedAssetIdsAfterCombinationReorder({
      currentAssetIds: ["garment-a", "garment-d", "garment-b", "garment-c"],
      selectedAssetIds: ["garment-b", "garment-d"],
    }),
    ["garment-d", "garment-b"],
  );
});

test("deselected current combination assets stay inactive when the combination is loaded again", () => {
  assert.deepEqual(
    buildActiveGarmentAssetIdsForCombination({
      currentGarmentAssetIds: ["garment-a", "garment-b", "garment-c"],
      deselectedGarmentAssetIds: ["garment-b"],
    }),
    ["garment-a", "garment-c"],
  );
  assert.equal(
    buildActivePersonAssetIdForCombination({
      currentPersonAssetId: "person-a",
      currentPersonAssetIds: ["person-a", "person-b"],
      deselectedPersonAssetIds: ["person-a"],
    }),
    null,
  );
});

test("asset deselection toggles without removing the asset from the current combination library", () => {
  assert.deepEqual(
    toggleDeselectedAssetId({
      assetId: "garment-a",
      isSelected: true,
      deselectedAssetIds: [],
    }),
    ["garment-a"],
  );
  assert.deepEqual(
    toggleDeselectedAssetId({
      assetId: "garment-a",
      isSelected: false,
      deselectedAssetIds: ["garment-a", "garment-b"],
    }),
    ["garment-b"],
  );
});

test("removing the active person does not select a deselected person", () => {
  assert.deepEqual(
    buildPersonAssetSelectionAfterRemove({
      removedAssetId: "person-a",
      selectedPersonAssetId: "person-a",
      currentPersonAssetIds: ["person-a", "person-b", "person-c"],
      deselectedPersonAssetIds: ["person-b"],
    }),
    {
      personAssetIds: ["person-b", "person-c"],
      selectedPersonAssetId: "person-c",
      deselectedPersonAssetIds: ["person-b"],
    },
  );

  assert.deepEqual(
    buildPersonAssetSelectionAfterRemove({
      removedAssetId: "person-a",
      selectedPersonAssetId: "person-a",
      currentPersonAssetIds: ["person-a", "person-b"],
      deselectedPersonAssetIds: ["person-b"],
    }),
    {
      personAssetIds: ["person-b"],
      selectedPersonAssetId: null,
      deselectedPersonAssetIds: ["person-b"],
    },
  );
});
