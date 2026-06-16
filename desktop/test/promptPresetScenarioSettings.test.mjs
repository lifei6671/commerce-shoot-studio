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
const promptServiceSource = readFileSync(
  new URL("../src/features/prompt/services/promptService.ts", import.meta.url),
  "utf8",
);
const promptTypesSource = readFileSync(
  new URL("../src/features/prompt/model/promptTypes.ts", import.meta.url),
  "utf8",
);

test("prompt preset center exposes scenario settings backed by prompt service", () => {
  assert.match(workflowCanvasSource, /场景设置/);
  assert.match(workflowCanvasSource, /isPromptPresetScenarioModalOpen/);
  assert.match(workflowCanvasSource, /promptPresetScenarios\.map/);
  assert.match(promptServiceSource, /listPromptPresetScenarios/);
  assert.match(promptServiceSource, /savePromptPresetScenario/);
  assert.match(promptTypesSource, /PromptPresetScenario/);
});

test("prompt preset scenario selects are rendered from managed scenarios", () => {
  const hardcodedScenarioItems = workflowCanvasSource.match(
    /<SelectItem value="(?:白底主图|模特展示|细节展示|社媒风格)">/g,
  );

  assert.equal(hardcodedScenarioItems, null);
});

test("built-in prompt preset scenarios are read-only in the scenario dialog", () => {
  assert.match(workflowCanvasSource, /const isBuiltInScenario = scenario\.source === "built_in";/);
  assert.match(workflowCanvasSource, /disabled=\{isBuiltInScenario\}/);
  assert.match(workflowCanvasSource, /disabled=\{isSaving \|\| isBuiltInScenario \|\| !isDirty\}/);
});

test("prompt preset center keeps an explicit apply action for the current combination", () => {
  assert.match(workflowCanvasSource, /onApply=\{\(\) => applyPromptPresetToWorkbench\(\)\}/);
  assert.match(workflowCanvasSource, /应用到当前组合/);
  assert.doesNotMatch(workflowCanvasSource, /prompt-preset-preview-actions/);
  assert.doesNotMatch(globalCssSource, /prompt-preset-preview-actions/);
});

test("prompt preset search input uses compact typography", () => {
  assert.match(
    globalCssSource,
    /\.prompt-preset-search input\s*\{[^}]*font-size:\s*13px;/,
  );
  assert.match(
    globalCssSource,
    /\.prompt-preset-search input::placeholder\s*\{[^}]*font-size:\s*13px;/,
  );
});

test("prompt preset variable defaults render a value control for every variable row", () => {
  assert.match(workflowCanvasSource, /prompt-preset-center-variable-value/);
  assert.match(globalCssSource, /\.prompt-preset-center-variable-value\b/);
  assert.doesNotMatch(globalCssSource, /\.prompt-preset-center-variable-row\s*>\s*span\s*\{[\s\S]*?display:\s*none/);
});
