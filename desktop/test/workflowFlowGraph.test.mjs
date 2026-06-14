import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WORKFLOW_EDGE_PAIRS,
  WORKFLOW_NODE_ORDER,
  applyWorkflowNodeSizeChanges,
  buildWorkflowEdges,
  applyWorkflowNodePositionChanges,
  cloneInitialWorkflowNodePositions,
  cloneInitialWorkflowNodeSizes,
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
    assert.equal(edge.type, "default");
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

test("initial node sizes are cloned before React Flow mutates layout state", () => {
  const first = cloneInitialWorkflowNodeSizes();
  const second = cloneInitialWorkflowNodeSizes();

  first.person.width = 999;

  assert.equal(second.person.width, 124);
});

test("position changes keep all fixed workflow nodes on the canvas", () => {
  const initialPositions = cloneInitialWorkflowNodePositions();

  const nextPositions = applyWorkflowNodePositionChanges(initialPositions, [
    { type: "position", id: "garments", position: { x: 260, y: 88 } },
    { type: "remove", id: "prompt" },
    { type: "select", id: "result", selected: true },
    { type: "position", id: "unknown", position: { x: -999, y: -999 } },
  ]);

  assert.deepEqual(Object.keys(nextPositions), WORKFLOW_NODE_ORDER);
  assert.deepEqual(nextPositions.garments, { x: 260, y: 88 });
  assert.deepEqual(nextPositions.prompt, initialPositions.prompt);
  assert.deepEqual(nextPositions.result, initialPositions.result);
});

test("non-position React Flow changes do not rewrite fixed node positions", () => {
  const initialPositions = cloneInitialWorkflowNodePositions();

  const nextPositions = applyWorkflowNodePositionChanges(initialPositions, [
    { type: "dimensions", id: "person", dimensions: { width: 124, height: 210 } },
    { type: "remove", id: "prompt" },
    { type: "select", id: "result", selected: true },
  ]);

  assert.equal(nextPositions, initialPositions);
});

test("position changes can be disabled independently from size changes", () => {
  const initialPositions = cloneInitialWorkflowNodePositions();

  const nextPositions = applyWorkflowNodePositionChanges(
    initialPositions,
    [{ type: "position", id: "garments", position: { x: 260, y: 88 } }],
    { allowPositionChange: false },
  );

  assert.equal(nextPositions, initialPositions);
});

test("dimension changes keep resizable fixed workflow nodes sized", () => {
  const initialSizes = cloneInitialWorkflowNodeSizes();

  const nextSizes = applyWorkflowNodeSizeChanges(initialSizes, [
    { type: "dimensions", id: "person", dimensions: { width: 156, height: 236 } },
    { type: "remove", id: "prompt" },
    { type: "dimensions", id: "unknown", dimensions: { width: 999, height: 999 } },
  ]);

  assert.deepEqual(Object.keys(nextSizes), WORKFLOW_NODE_ORDER);
  assert.deepEqual(nextSizes.person, { width: 156, height: 236 });
  assert.deepEqual(nextSizes.prompt, initialSizes.prompt);
});

test("invalid dimension changes do not rewrite fixed node sizes", () => {
  const initialSizes = cloneInitialWorkflowNodeSizes();

  const nextSizes = applyWorkflowNodeSizeChanges(initialSizes, [
    { type: "dimensions", id: "person", dimensions: { width: 20, height: 236 } },
    { type: "dimensions", id: "garments", dimensions: { width: 156, height: 20 } },
    { type: "position", id: "result", position: { x: 1, y: 2 } },
  ]);

  assert.equal(nextSizes, initialSizes);
});

test("dimension changes can be disabled independently from position changes", () => {
  const initialSizes = cloneInitialWorkflowNodeSizes();

  const nextSizes = applyWorkflowNodeSizeChanges(
    initialSizes,
    [{ type: "dimensions", id: "person", dimensions: { width: 156, height: 236 } }],
    { allowSizeChange: false },
  );

  assert.equal(nextSizes, initialSizes);
});
