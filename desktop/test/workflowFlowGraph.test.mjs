import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WORKFLOW_EDGE_PAIRS,
  WORKFLOW_NODE_ORDER,
  buildWorkflowEdges,
  cloneInitialWorkflowNodePositions,
} from "../src/features/workflow/components/workflowFlowGraph.ts";

test("workflow graph keeps the six fixed MVP nodes in order", () => {
  assert.deepEqual(WORKFLOW_NODE_ORDER, [
    "person",
    "garments",
    "prompt",
    "model",
    "execute",
    "result",
  ]);
});

test("workflow graph exposes only the fixed React Flow edges", () => {
  assert.deepEqual(WORKFLOW_EDGE_PAIRS, [
    { source: "person", target: "garments" },
    { source: "garments", target: "prompt" },
    { source: "prompt", target: "model" },
    { source: "model", target: "execute" },
    { source: "execute", target: "result" },
  ]);
});

test("workflow edges are visual-only and cannot be edited into a free DAG", () => {
  const edges = buildWorkflowEdges();

  assert.equal(edges.length, 5);
  for (const edge of edges) {
    assert.equal(edge.type, "straight");
    assert.equal(edge.selectable, false);
    assert.equal(edge.deletable, false);
    assert.equal(edge.reconnectable, false);
    assert.equal(edge.sourceHandle, "source");
    assert.equal(edge.targetHandle, "target");
  }
});

test("initial node positions are cloned before React Flow mutates layout state", () => {
  const first = cloneInitialWorkflowNodePositions();
  const second = cloneInitialWorkflowNodePositions();

  first.person.x = 999;

  assert.equal(second.person.x, 0);
});
