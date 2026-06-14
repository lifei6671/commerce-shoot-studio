import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFlowNodeRenderQualityStyle,
  getFlowNodeRenderScale,
} from "../src/features/workflow/components/flowNodeRenderQuality.ts";

test("flow node render scale supersamples content above 100 percent zoom", () => {
  assert.equal(getFlowNodeRenderScale(75), 1);
  assert.equal(getFlowNodeRenderScale(100), 1);
  assert.equal(getFlowNodeRenderScale(200), 2);
  assert.equal(getFlowNodeRenderScale(300), 3);
});

test("flow node render quality style exposes scale and inverse scale variables", () => {
  assert.deepEqual(buildFlowNodeRenderQualityStyle(300), {
    "--flow-node-render-scale": "3",
    "--flow-node-render-scale-inverse": "0.333333",
  });
});
