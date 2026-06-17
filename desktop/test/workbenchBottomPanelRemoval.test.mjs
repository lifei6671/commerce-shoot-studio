import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);
const globalCssSource = readFileSync(
  new URL("../src/shared/styles/global.css", import.meta.url),
  "utf8",
);

test("workbench implementation does not keep the removed bottom task area", () => {
  for (const removedToken of [
    "BottomDashboard",
    "bottomDashboard",
    "bottom-panel-slot",
    "bottom-panel-resize-toggle",
    "ResultPreview",
    "taskProgressStages",
    "buildTaskProgressSteps",
    "getCancellationNotice",
  ]) {
    assert.doesNotMatch(workflowCanvasSource, new RegExp(removedToken));
  }

  for (const removedSelectorPattern of [
    String.raw`\.bottom-dashboard\b`,
    String.raw`\.bottom-panel-slot\b`,
    String.raw`\.result-preview(?!-)`,
    String.raw`\.task-info\b`,
    String.raw`\.task-actions\b`,
    String.raw`\.task-cancel-notice\b`,
  ]) {
    assert.doesNotMatch(globalCssSource, new RegExp(removedSelectorPattern));
  }
});

test("workbench side panels are floating overlays instead of resizable columns", () => {
  assert.match(workflowCanvasSource, /workbench-floating-stage/);
  assert.match(workflowCanvasSource, /floating-panel-slot floating-panel-slot--left/);
  assert.match(workflowCanvasSource, /floating-panel-slot floating-panel-slot--right/);
  assert.doesNotMatch(workflowCanvasSource, /react-resizable-panels/);
  assert.doesNotMatch(workflowCanvasSource, /<Group\b|<Panel\b|<Separator\b/);
  assert.doesNotMatch(workflowCanvasSource, /side-panel-slot|layout-resize-handle/);

  assert.match(globalCssSource, /\.workbench-floating-stage\b/);
  assert.match(globalCssSource, /\.floating-panel-slot\b/);
  assert.match(globalCssSource, /--floating-panel-toolbar-offset:\s*48px/);
  assert.match(globalCssSource, /--canvas-control-safe-right:\s*calc\(var\(--inspector-column-width\) \+ var\(--floating-panel-gap\) \* 2\)/);
  assert.match(globalCssSource, /--canvas-control-safe-bottom:\s*calc\(var\(--floating-panel-gap\) \+ 44px\)/);
  assert.match(
    globalCssSource,
    /top:\s*calc\(var\(--floating-panel-gap\) \+ var\(--floating-panel-toolbar-offset\)\)/,
  );
  assert.match(
    globalCssSource,
    /\.flow-minimap\.react-flow__panel\.right\s*\{[\s\S]*?right:\s*var\(--canvas-control-safe-right\)/,
  );
  assert.match(
    globalCssSource,
    /\.flow-minimap\.react-flow__panel\.right\s*\{[\s\S]*?bottom:\s*var\(--canvas-control-safe-bottom\)/,
  );
  assert.match(globalCssSource, /\.flow-context\s*\{[\s\S]*?margin-left:\s*auto/);
  assert.match(globalCssSource, /\.canvas-toolbar\s*\{[\s\S]*?z-index:\s*20/);
  assert.match(globalCssSource, /\.flow-help-wrap\s*\{[\s\S]*?z-index:\s*24/);
  assert.doesNotMatch(globalCssSource, /\.side-panel-slot\b|\.layout-resize-handle\b/);
});

test("workbench flow status appears before the flow help control", () => {
  const toolbarStart = workflowCanvasSource.indexOf('className="canvas-toolbar"');
  const flowContext = workflowCanvasSource.indexOf('className="flow-context"', toolbarStart);
  const flowHelp = workflowCanvasSource.indexOf('className="flow-help-wrap"', toolbarStart);

  assert.notEqual(toolbarStart, -1);
  assert.notEqual(flowContext, -1);
  assert.notEqual(flowHelp, -1);
  assert.ok(flowContext > toolbarStart);
  assert.ok(flowHelp > flowContext);
});
