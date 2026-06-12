import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FLOW_ARROW_EDGE_GAP,
  FLOW_ARROW_HEAD_LENGTH,
  FLOW_NODE_WIDTH,
  buildFlowConnectorPath,
} from "../src/features/workflow/components/flowConnectorPath.ts";

test("buildFlowConnectorPath keeps adjacent nodes connected with a straight line", () => {
  const path = buildFlowConnectorPath(
    { x: 0, y: 260 },
    { x: 198, y: 40 },
  );

  assert.match(path, /^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? L -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?$/);
});

test("buildFlowConnectorPath leaves room for the arrow head before the target node edge", () => {
  const path = buildFlowConnectorPath(
    { x: 0, y: 40 },
    { x: 198, y: 40 },
  );
  const [, endXText] = path.match(/L (-?\d+(?:\.\d+)?) -?\d+(?:\.\d+)?$/) ?? [];

  assert.equal(
    Number(endXText),
    198 - FLOW_ARROW_EDGE_GAP - FLOW_ARROW_HEAD_LENGTH,
  );
});

test("buildFlowConnectorPath starts after the source node edge", () => {
  const path = buildFlowConnectorPath(
    { x: 0, y: 40 },
    { x: 198, y: 40 },
  );
  const [, startXText] = path.match(/^M (-?\d+(?:\.\d+)?) -?\d+(?:\.\d+)?/) ?? [];

  assert.equal(Number(startXText), FLOW_NODE_WIDTH + FLOW_ARROW_EDGE_GAP);
});
