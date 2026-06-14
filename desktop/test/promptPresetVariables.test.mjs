import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPromptPresetVariablesForSections } from "../src/features/workflow/components/promptPresetVariables.ts";

function template(id, templateType, variables) {
  return {
    id,
    name: id,
    templateType,
    source: "built_in",
    body: "",
    variables,
    description: "",
    tags: [],
    isDefault: true,
    locked: true,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  };
}

function variable(name, description, defaultValue) {
  return {
    name,
    description,
    exampleValue: defaultValue,
    required: true,
    defaultValue,
    controlType: "input",
    options: [],
  };
}

test("prompt preset variables follow the selected templates and preserve default overrides", () => {
  const variables = buildPromptPresetVariablesForSections({
    sections: [
      { mode: "default", baseTemplateId: "system-template", appendText: "", overrideText: "" },
      { mode: "default", baseTemplateId: "user-template", appendText: "", overrideText: "" },
      { mode: "default", baseTemplateId: "negative-template", appendText: "", overrideText: "" },
    ],
    templates: [
      template("system-template", "system", [variable("style", "风格", "写实")]),
      template("user-template", "user", [
        variable("background", "背景", "纯白背景"),
        variable("style", "风格", "自然"),
      ]),
      template("negative-template", "negative", [variable("avoid", "避坑", "畸变")]),
    ],
    existingVariables: [
      variable("style", "旧风格", "高级质感"),
      variable("unused", "已移除", "旧值"),
    ],
  });

  assert.deepEqual(
    variables.map((item) => [item.name, item.description, item.defaultValue, item.controlType]),
    [
      ["style", "风格", "高级质感", "input"],
      ["background", "背景", "纯白背景", "input"],
      ["avoid", "避坑", "畸变", "input"],
    ],
  );
});

test("prompt preset variables keep template control type when applying saved default values", () => {
  const variables = buildPromptPresetVariablesForSections({
    sections: [
      { mode: "default", baseTemplateId: "user-template", appendText: "", overrideText: "" },
    ],
    templates: [
      template("user-template", "user", [
        {
          ...variable("style", "风格", "写实"),
          controlType: "select",
          options: ["写实", "极简"],
        },
        variable("detail", "细节描述", "自然站姿"),
      ]),
    ],
    existingVariables: [
      variable("style", "旧风格", "极简"),
      variable("detail", "旧细节", "突出袖口"),
    ],
  });

  assert.deepEqual(
    variables.map((item) => [item.name, item.defaultValue, item.controlType, item.options]),
    [
      ["style", "极简", "select", ["写实", "极简"]],
      ["detail", "突出袖口", "input", []],
    ],
  );
});

test("prompt preset variables fall back to preset definitions when templates are unavailable", () => {
  const variables = buildPromptPresetVariablesForSections({
    fallbackVariables: [
      {
        ...variable("detail", "细节描述", "自然站姿"),
        controlType: "select",
        options: ["自然站姿", "突出袖口"],
      },
    ],
    sections: [
      { mode: "default", baseTemplateId: "missing-template", appendText: "", overrideText: "" },
    ],
    templates: [],
    existingVariables: [variable("detail", "旧细节", "突出袖口")],
  });

  assert.deepEqual(
    variables.map((item) => [item.name, item.defaultValue, item.controlType, item.options]),
    [["detail", "突出袖口", "select", ["自然站姿", "突出袖口"]]],
  );
});
