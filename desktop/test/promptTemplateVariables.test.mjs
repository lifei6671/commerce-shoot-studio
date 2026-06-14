import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPromptVariablePreviewValue,
  parsePromptVariableOptions,
  syncPromptTemplateVariablesFromBody,
} from "../src/features/workflow/components/promptTemplateVariables.ts";

function variable(name, metadata = {}) {
  return {
    name,
    displayName: metadata.displayName ?? metadata.description ?? name,
    description: metadata.description ?? name,
    exampleValue: metadata.exampleValue ?? "",
    required: true,
    defaultValue: metadata.defaultValue ?? "",
    controlType: metadata.controlType ?? "input",
    options: metadata.options ?? [],
  };
}

test("prompt template variables are detected from body and preserve existing metadata", () => {
  const variables = syncPromptTemplateVariablesFromBody({
    body: "生成 {{style}}，背景 {{ background }}，再次 {{style}}。",
    variables: [
      variable("style", {
        displayName: "展示风格",
        description: "风格",
        defaultValue: "写实",
        controlType: "select",
        options: ["写实", "极简"],
      }),
      variable("unused", {
        description: "已移除",
        defaultValue: "旧值",
      }),
    ],
  });

  assert.deepEqual(
    variables.map((item) => [
      item.name,
      item.displayName,
      item.description,
      item.defaultValue,
      item.controlType,
      item.options,
    ]),
    [
      ["style", "展示风格", "风格", "写实", "select", ["写实", "极简"]],
      ["background", "background", "background", "", "input", []],
    ],
  );
});

test("select variables normalize duplicate options and keep a valid default", () => {
  const variables = syncPromptTemplateVariablesFromBody({
    body: "{{style}}",
    variables: [
      variable("style", {
        defaultValue: "不存在",
        controlType: "select",
        options: ["写实", "写实", "极简", ""],
      }),
    ],
  });

  assert.deepEqual(variables[0].options, ["写实", "极简"]);
  assert.equal(variables[0].defaultValue, "写实");
  assert.equal(buildPromptVariablePreviewValue(variables[0]), "写实");
});

test("prompt template variable display name falls back when cleared", () => {
  const variables = syncPromptTemplateVariablesFromBody({
    body: "{{outputCount}}",
    variables: [
      variable("outputCount", {
        displayName: "   ",
        description: "生成数量",
        defaultValue: "1",
      }),
    ],
  });

  assert.equal(variables[0].displayName, "生成数量");
  assert.equal(variables[0].description, "生成数量");
});

test("combobox variables keep custom defaults outside option presets", () => {
  const variables = syncPromptTemplateVariablesFromBody({
    body: "{{style}}",
    variables: [
      variable("style", {
        defaultValue: "未来科技风",
        controlType: "combobox",
        options: ["写实", "极简", "复古"],
      }),
    ],
  });

  assert.equal(variables[0].controlType, "combobox");
  assert.deepEqual(variables[0].options, ["写实", "极简", "复古"]);
  assert.equal(variables[0].defaultValue, "未来科技风");
  assert.equal(buildPromptVariablePreviewValue(variables[0]), "未来科技风");
});

test("option text accepts commas and line breaks", () => {
  assert.deepEqual(parsePromptVariableOptions("写实，极简\n复古,写实"), [
    "写实",
    "极简",
    "复古",
  ]);
});
