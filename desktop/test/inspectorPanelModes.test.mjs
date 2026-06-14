import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getInspectorPanelModes,
  normalizeInspectorPanelMode,
} from "../src/features/workflow/components/inspectorPanelModes.ts";

test("person node inspector only exposes details", () => {
  assert.deepEqual(getInspectorPanelModes("person"), ["details"]);
  assert.equal(normalizeInspectorPanelMode("person", "edit"), "details");
});

test("non-person node inspector exposes details and edit only", () => {
  assert.deepEqual(getInspectorPanelModes("garments"), ["details", "edit"]);
  assert.deepEqual(getInspectorPanelModes("prompt"), ["details", "edit"]);
  assert.deepEqual(getInspectorPanelModes("result"), ["details", "edit"]);
});
