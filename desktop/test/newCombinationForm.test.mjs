import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
    garmentAssetIds: [],
  });
});

test("new combination form accepts explicit draft overrides only", () => {
  const form = buildNewCombinationForm({
    name: "夏季上新",
    personAssetId: "person-1",
    garmentAssetIds: ["garment-1"],
  });

  assert.deepEqual(form, {
    name: "夏季上新",
    code: "",
    description: "",
    personAssetId: "person-1",
    garmentAssetIds: ["garment-1"],
  });
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
