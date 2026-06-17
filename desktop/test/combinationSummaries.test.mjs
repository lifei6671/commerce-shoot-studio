import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  getDefaultCombinationSummary,
  sortCombinationSummaries,
  upsertCombinationSummary,
} from "../src/features/workflow/components/combinationSummaries.ts";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);

function summary(id, createdAt, updatedAt = createdAt) {
  return {
    id,
    name: id,
    personAssetId: `${id}-person`,
    garmentCount: 1,
    createdAt,
    updatedAt,
  };
}

function combination(id, createdAt, updatedAt = createdAt) {
  return {
    id,
    name: id,
    personAssetId: `${id}-person`,
    personAssetIds: [`${id}-person`],
    garmentAssetIds: [`${id}-garment`],
    createdAt,
    updatedAt,
  };
}

test("combination dropdown summaries use stable creation order", () => {
  assert.deepEqual(
    sortCombinationSummaries([
      summary("older-updated", "2026-06-12T10:00:00Z", "2026-06-17T10:00:00Z"),
      summary("newer", "2026-06-13T10:00:00Z", "2026-06-13T10:00:00Z"),
      summary("oldest", "2026-06-11T10:00:00Z", "2026-06-18T10:00:00Z"),
    ]).map((item) => item.id),
    ["newer", "older-updated", "oldest"],
  );
});

test("saving an existing combination does not move it to the top of the dropdown", () => {
  const existing = [
    summary("newer", "2026-06-13T10:00:00Z"),
    summary("older", "2026-06-12T10:00:00Z"),
    summary("oldest", "2026-06-11T10:00:00Z"),
  ];

  const next = upsertCombinationSummary(
    existing,
    combination("older", "2026-06-12T10:00:00Z", "2026-06-18T10:00:00Z"),
  );

  assert.deepEqual(next.map((item) => item.id), ["newer", "older", "oldest"]);
  assert.equal(next[1].updatedAt, "2026-06-18T10:00:00Z");
});

test("default combination follows the visible stable summary order", () => {
  const backendOrder = [
    summary("older-updated", "2026-06-12T10:00:00Z", "2026-06-17T10:00:00Z"),
    summary("newer", "2026-06-13T10:00:00Z", "2026-06-13T10:00:00Z"),
  ];

  assert.equal(getDefaultCombinationSummary(backendOrder)?.id, "newer");
});

test("workbench uses the stable combination summary helpers", () => {
  assert.match(
    workflowCanvasSource,
    /from "\.\/combinationSummaries"/,
  );
  assert.doesNotMatch(
    workflowCanvasSource,
    /function upsertCombinationSummary\(/,
  );
  assert.match(
    workflowCanvasSource,
    /setCombinationSummaries\(sortCombinationSummaries\(combinations\)\)/,
  );
  assert.doesNotMatch(workflowCanvasSource, /const latest = combinations\[0\]/);
});
