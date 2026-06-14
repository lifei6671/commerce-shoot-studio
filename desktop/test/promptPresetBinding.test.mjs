import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPromptBindingSaveRequest,
  buildOutputPlanPreviewClipboardText,
  buildPromptBindingFromWorkbench,
  buildPromptPresetOptions,
  buildPromptWorkbenchFromBinding,
} from "../src/features/workflow/components/promptPresetBinding.ts";

const templates = [
  {
    id: "builtin_system_commerce_display",
    name: "电商服装展示系统规则",
    templateType: "system",
    source: "built_in",
    body: "system {{style}}",
    variables: [],
    description: "",
    tags: [],
    isDefault: true,
    locked: true,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
  {
    id: "builtin_user_tryon_general",
    name: "通用试穿细节描述",
    templateType: "user",
    source: "built_in",
    body: "user {{background}}",
    variables: [],
    description: "",
    tags: [],
    isDefault: true,
    locked: true,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
  {
    id: "builtin_negative_clean_background",
    name: "纯色背景避坑描述",
    templateType: "negative",
    source: "built_in",
    body: "negative",
    variables: [],
    description: "",
    tags: [],
    isDefault: true,
    locked: true,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
  {
    id: "prompt_template_custom_user",
    name: "我的自定义主图",
    templateType: "user",
    source: "custom",
    body: "custom user",
    variables: [],
    description: "",
    tags: [],
    isDefault: false,
    locked: false,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
];

const presets = [
  {
    id: "builtin_ecommerce_white_background",
    name: "电商白底主图",
    scenario: "白底主图",
    description: "用于电商白底图",
    source: "built_in",
    system: {
      mode: "default",
      baseTemplateId: "builtin_system_commerce_display",
      appendText: "",
      overrideText: "",
    },
    user: {
      mode: "default",
      baseTemplateId: "builtin_user_tryon_general",
      appendText: "",
      overrideText: "",
    },
    negative: {
      mode: "default",
      baseTemplateId: "builtin_negative_clean_background",
      appendText: "",
      overrideText: "",
    },
    variables: [
      {
        name: "style",
        description: "风格",
        exampleValue: "休闲、商务、复古",
        required: true,
        defaultValue: "写实电商展示",
      },
      {
        name: "background",
        description: "背景",
        exampleValue: "纯白背景",
        required: true,
        defaultValue: "纯白背景",
      },
      {
        name: "aspectRatio",
        description: "画面比例",
        exampleValue: "3:4",
        required: true,
        defaultValue: "3:4",
      },
      {
        name: "garmentCategory",
        description: "服装类别",
        exampleValue: "连衣裙",
        required: true,
        defaultValue: "连衣裙",
      },
      {
        name: "outputCount",
        description: "生成数量",
        exampleValue: "1",
        required: true,
        defaultValue: "1",
      },
    ],
    isDefault: true,
    locked: true,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
  {
    id: "prompt_preset_custom",
    name: "我的自定义主图",
    scenario: "白底主图",
    description: "",
    source: "custom",
    system: {
      mode: "default",
      baseTemplateId: "builtin_system_commerce_display",
      appendText: "",
      overrideText: "",
    },
    user: {
      mode: "default",
      baseTemplateId: "prompt_template_custom_user",
      appendText: "",
      overrideText: "",
    },
    negative: {
      mode: "default",
      baseTemplateId: "builtin_negative_clean_background",
      appendText: "",
      overrideText: "",
    },
    variables: [],
    isDefault: false,
    locked: false,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
];

test("buildPromptPresetOptions exposes database presets as workbench presets", () => {
  const options = buildPromptPresetOptions(presets);

  assert.equal(options[0].name, "电商白底主图");
  assert.ok(options.some((option) => option.id === "prompt_preset_custom"));
  assert.equal(options[0].variables.style, "写实电商展示");
  assert.equal(options[0].variableDefinitions[0].name, "style");
});

test("buildPromptPresetOptions preserves custom prompt variable defaults", () => {
  const options = buildPromptPresetOptions([
    {
      ...presets[0],
      variables: [
        ...presets[0].variables,
        {
          name: "detail",
          description: "细节",
          exampleValue: "突出袖口",
          required: true,
          defaultValue: "突出袖口",
          controlType: "input",
          options: [],
        },
      ],
    },
  ]);

  assert.equal(options[0].variables.detail, "突出袖口");
});

test("buildPromptBindingFromWorkbench binds preset templates, variables, and additional user instructions", () => {
  const customPreset = buildPromptPresetOptions(presets).find(
    (option) => option.id === "prompt_preset_custom",
  );

  const binding = buildPromptBindingFromWorkbench({
    combinationId: "combo-1",
    preset: customPreset,
    variables: {
      style: "写实电商展示",
      background: "纯白背景",
      aspectRatio: "3:4",
      garmentCategory: "连衣裙",
      outputCount: "3",
    },
    additionalInstructions: "保持自然站姿",
  });

  assert.equal(binding.combinationId, "combo-1");
  assert.equal(binding.system.baseTemplateId, "builtin_system_commerce_display");
  assert.equal(binding.system.mode, "default");
  assert.equal(binding.user.baseTemplateId, "prompt_template_custom_user");
  assert.equal(binding.user.mode, "append");
  assert.equal(binding.user.appendText, "追加描述：保持自然站姿");
  assert.equal(binding.negative?.baseTemplateId, "builtin_negative_clean_background");
  assert.deepEqual(binding.variablesJson, {
    style: "写实电商展示",
    background: "纯白背景",
    aspectRatio: "3:4",
    garmentCategory: "连衣裙",
    outputCount: "3",
  });
});

test("buildPromptBindingFromWorkbench keeps append and override text for final output", () => {
  const preset = buildPromptPresetOptions(presets)[0];

  const binding = buildPromptBindingFromWorkbench({
    combinationId: "combo-2",
    preset,
    variables: {
      style: "写实电商展示",
      background: "纯白背景",
      aspectRatio: "3:4",
      garmentCategory: "连衣裙",
      outputCount: "1",
    },
    additionalInstructions: "",
    advanced: {
      system: preset.system,
      user: {
        ...preset.user,
        mode: "append",
        appendText: "突出衣服纹理",
        overrideText: "",
      },
      negative: {
        ...preset.negative,
        mode: "override",
        appendText: "",
        overrideText: "避免畸变和过曝",
      },
    },
  });

  assert.equal(binding.user.mode, "append");
  assert.equal(binding.user.appendText, "突出衣服纹理");
  assert.equal(binding.negative?.mode, "override");
  assert.equal(binding.negative?.overrideText, "避免畸变和过曝");
});

test("buildPromptWorkbenchFromBinding restores saved combination output plan without using previous state", () => {
  const presetOptions = buildPromptPresetOptions(presets);

  const workbench = buildPromptWorkbenchFromBinding(
    {
      id: "binding-1",
      combinationId: "combo-2",
      system: presets[1].system,
      user: {
        mode: "append",
        baseTemplateId: "prompt_template_custom_user",
        appendText: "突出领口细节",
        overrideText: "",
      },
      negative: null,
      variablesJson: {
        style: "高级质感",
        background: "室内场景",
        aspectRatio: "4:5",
        garmentCategory: "外套",
        outputCount: "2",
      },
      createdAt: "2026-06-13T00:00:00Z",
      updatedAt: "2026-06-13T00:00:00Z",
    },
    presetOptions,
  );

  assert.equal(workbench.presetId, "prompt_preset_custom");
  assert.deepEqual(workbench.variables, {
    style: "高级质感",
    background: "室内场景",
    aspectRatio: "4:5",
    garmentCategory: "外套",
    outputCount: "2",
  });
  assert.equal(workbench.additionalInstructions, "");
  assert.equal(workbench.advanced?.user.appendText, "突出领口细节");
  assert.equal(workbench.advanced?.negative, null);
});

test("buildPromptWorkbenchFromBinding preserves custom prompt variables from binding", () => {
  const state = buildPromptWorkbenchFromBinding(
    {
      id: "binding-2",
      combinationId: "combo-2",
      system: {
        mode: "default",
        baseTemplateId: "builtin_system_commerce_display",
        appendText: "",
        overrideText: "",
      },
      user: {
        mode: "default",
        baseTemplateId: "builtin_user_tryon_general",
        appendText: "",
        overrideText: "",
      },
      negative: null,
      variablesJson: {
        style: "写实电商展示",
        detail: "突出袖口",
      },
      createdAt: "2026-06-13T00:00:00Z",
      updatedAt: "2026-06-13T00:00:00Z",
    },
    buildPromptPresetOptions(presets),
  );

  assert.equal(state.variables.detail, "突出袖口");
});

test("buildPromptBindingSaveRequest strips read-only database fields before autosave signatures", () => {
  const request = buildPromptBindingSaveRequest({
    id: "binding-1",
    combinationId: "combo-2",
    system: presets[1].system,
    user: presets[1].user,
    negative: presets[1].negative,
    variablesJson: {
      style: "高级质感",
    },
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:01:00Z",
  });

  assert.deepEqual(Object.keys(request).sort(), [
    "combinationId",
    "id",
    "negative",
    "system",
    "user",
    "variablesJson",
  ]);
  assert.equal(request.id, "binding-1");
  assert.equal(request.combinationId, "combo-2");
});

test("buildOutputPlanPreviewClipboardText uses output-plan labels instead of prompt labels", () => {
  const text = buildOutputPlanPreviewClipboardText({
    system: "系统规则内容",
    user: "细节描述内容",
    negative: "避坑描述内容",
  });

  assert.match(text, /系统规则/);
  assert.match(text, /系统规则内容/);
  assert.match(text, /细节描述/);
  assert.match(text, /避坑描述/);
  assert.doesNotMatch(text, /Prompt/);
  assert.doesNotMatch(text, /System/);
  assert.doesNotMatch(text, /User/);
  assert.doesNotMatch(text, /Negative/);
});
