import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNewCombinationPersonAssetIdsAfterImport,
  buildNewCombinationForm,
  filterNewCombinationPickerAssets,
} from "../src/features/workflow/components/newCombinationForm.ts";

test("new combination form starts with no prefilled information", () => {
  const form = buildNewCombinationForm();

  assert.deepEqual(form, {
    name: "",
    code: "",
    description: "",
    personAssetId: null,
    personAssetIds: [],
    garmentAssetIds: [],
  });
});

test("new combination form accepts explicit draft overrides only", () => {
  const form = buildNewCombinationForm({
    name: "夏季上新",
    personAssetId: "person-1",
    personAssetIds: ["person-1", "person-2"],
    garmentAssetIds: ["garment-1"],
  });

  assert.deepEqual(form, {
    name: "夏季上新",
    code: "",
    description: "",
    personAssetId: "person-1",
    personAssetIds: ["person-1", "person-2"],
    garmentAssetIds: ["garment-1"],
  });
});

test("new combination person import keeps multiple selected people", () => {
  assert.deepEqual(
    buildNewCombinationPersonAssetIdsAfterImport({
      currentPersonAssetId: "person-a",
      currentPersonAssetIds: ["person-a"],
      importedPersonAssetIds: ["person-b", "person-c"],
    }),
    ["person-b", "person-c", "person-a"],
  );
  assert.deepEqual(
    buildNewCombinationPersonAssetIdsAfterImport({
      currentPersonAssetId: "person-a",
      currentPersonAssetIds: ["person-b", "person-a"],
      importedPersonAssetIds: ["person-b", "person-c"],
    }),
    ["person-c", "person-b", "person-a"],
  );
});

test("new combination picker does not show library assets before explicit selection", () => {
  const assets = [
    { id: "person-1", label: "人物 1" },
    { id: "person-2", label: "人物 2" },
  ];

  assert.deepEqual(
    filterNewCombinationPickerAssets(assets, [], (asset) => asset.id),
    [],
  );
  assert.deepEqual(
    filterNewCombinationPickerAssets(assets, ["person-2"], (asset) => asset.id),
    [{ id: "person-2", label: "人物 2" }],
  );
});
