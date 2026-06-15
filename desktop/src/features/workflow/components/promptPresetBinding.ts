import type {
  PromptBinding,
  PromptBindingSection,
  PromptPreset,
  PromptTemplateVariable,
  SavePromptBindingRequest,
} from "../../prompt/model/promptTypes";

export type PromptWorkbenchVariables = Record<string, string> & {
  style: string;
  background: string;
  aspectRatio: string;
  garmentCategory: string;
  outputCount: string;
};

export type PromptPresetOption = {
  id: string;
  name: string;
  scenario: string;
  description: string;
  source: "built_in" | "custom";
  system: PromptBindingSection;
  user: PromptBindingSection;
  negative: PromptBindingSection | null;
  variables: PromptWorkbenchVariables;
  variableDefinitions: PromptTemplateVariable[];
  isDefault: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdvancedPromptSections = {
  system: PromptBindingSection;
  user: PromptBindingSection;
  negative: PromptBindingSection | null;
};

export type PromptWorkbenchState = {
  presetId: string;
  variables: PromptWorkbenchVariables;
  additionalInstructions: string;
  advanced: AdvancedPromptSections | null;
};

const BUILTIN_SYSTEM_TEMPLATE_ID = "builtin_system_commerce_display";
const BUILTIN_USER_TEMPLATE_ID = "builtin_user_tryon_general";
const BUILTIN_DETAIL_USER_TEMPLATE_ID = "builtin_user_luxury_detail";
const BUILTIN_NEGATIVE_TEMPLATE_ID = "builtin_negative_clean_background";

const BUILTIN_PRESET_BLUEPRINTS: Array<{
  id: string;
  name: string;
  userTemplateId: string;
}> = [
  {
    id: "ecommerce-white-background",
    name: "电商白底主图",
    userTemplateId: BUILTIN_USER_TEMPLATE_ID,
  },
  {
    id: "model-display",
    name: "模特展示图",
    userTemplateId: BUILTIN_USER_TEMPLATE_ID,
  },
  {
    id: "detail-display",
    name: "细节展示图",
    userTemplateId: BUILTIN_DETAIL_USER_TEMPLATE_ID,
  },
  {
    id: "social-style",
    name: "社媒风格图",
    userTemplateId: BUILTIN_DETAIL_USER_TEMPLATE_ID,
  },
];

export const DEFAULT_PROMPT_WORKBENCH_VARIABLES: PromptWorkbenchVariables = {
  style: "写实电商展示",
  background: "纯白背景",
  aspectRatio: "3:4",
  garmentCategory: "连衣裙",
  outputCount: "1",
};

export const DEFAULT_PROMPT_WORKBENCH_STATE: PromptWorkbenchState = {
  presetId: "builtin_ecommerce_white_background",
  variables: DEFAULT_PROMPT_WORKBENCH_VARIABLES,
  additionalInstructions: "",
  advanced: null,
};
const PROMPT_OUTPUT_COUNT_MIN = 1;
const PROMPT_OUTPUT_COUNT_MAX = 4;

export function buildPromptWorkbenchDefaultsForPreset(
  preset: PromptPresetOption | null | undefined,
): PromptWorkbenchState {
  if (!preset) {
    return {
      ...DEFAULT_PROMPT_WORKBENCH_STATE,
      variables: { ...DEFAULT_PROMPT_WORKBENCH_STATE.variables },
    };
  }
  return {
    presetId: preset.id,
    variables: { ...preset.variables },
    additionalInstructions: "",
    advanced: null,
  };
}

export function buildPromptPresetOptions(presets: PromptPreset[]): PromptPresetOption[] {
  return presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    scenario: preset.scenario,
    description: preset.description,
    source: preset.source,
    system: preset.system,
    user: preset.user,
    negative: preset.negative ?? null,
    variables: buildPresetVariables(preset),
    variableDefinitions: preset.variables.map((variable) => ({ ...variable })),
    isDefault: preset.isDefault,
    locked: preset.locked,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  }));
}

export function buildPromptBindingFromWorkbench({
  combinationId,
  preset,
  variables,
  additionalInstructions,
  advanced,
}: {
  combinationId: string;
  preset: PromptPresetOption | null | undefined;
  variables: PromptWorkbenchVariables;
  additionalInstructions: string;
  advanced?: AdvancedPromptSections | null;
}): SavePromptBindingRequest {
  const trimmedAdditionalInstructions = additionalInstructions.trim();
  const userSection = advanced?.user ?? {
    mode: trimmedAdditionalInstructions ? "append" : "default",
    baseTemplateId: preset?.user.baseTemplateId ?? null,
    appendText: trimmedAdditionalInstructions
      ? `追加描述：${trimmedAdditionalInstructions}`
      : "",
    overrideText: "",
  };

  return {
    id: null,
    combinationId,
    system: advanced?.system ?? preset?.system ?? buildDefaultSection(null),
    user: userSection,
    negative:
      advanced && "negative" in advanced
        ? advanced.negative
        : preset?.negative ?? null,
    variablesJson: { ...variables },
  };
}

export function buildPromptWorkbenchFromBinding(
  binding: PromptBinding | SavePromptBindingRequest | null | undefined,
  presets: PromptPresetOption[],
): PromptWorkbenchState {
  if (!binding) {
    return DEFAULT_PROMPT_WORKBENCH_STATE;
  }

  const preset = findPromptPresetForBinding(presets, binding);

  return {
    presetId: preset?.id ?? presets[0]?.id ?? DEFAULT_PROMPT_WORKBENCH_STATE.presetId,
    variables: normalizePromptWorkbenchVariables(binding.variablesJson),
    additionalInstructions: "",
    advanced: {
      system: binding.system,
      user: binding.user,
      negative: binding.negative ?? null,
    },
  };
}

export function buildPromptBindingSaveRequest(
  binding: PromptBinding | SavePromptBindingRequest,
): SavePromptBindingRequest {
  return {
    id: binding.id ?? null,
    combinationId: binding.combinationId,
    system: binding.system,
    user: binding.user,
    negative: binding.negative ?? null,
    variablesJson: binding.variablesJson,
  };
}

export function buildOutputPlanPreviewClipboardText({
  system,
  user,
  negative,
}: {
  system?: string | null;
  user: string;
  negative?: string | null;
}): string {
  return [
    system ? `系统规则:\n${system}` : null,
    `细节描述:\n${user}`,
    negative ? `避坑描述:\n${negative}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderPromptTemplatePreview(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name: string) => {
    const key = name.trim();
    return values[key] ?? `{{${key}}}`;
  });
}

export function renderPromptSectionPreview(
  section: PromptBindingSection,
  templates: Array<{ id: string; body: string }>,
  values: Record<string, string>,
): string {
  const templateBody =
    templates.find((template) => template.id === section.baseTemplateId)?.body ?? "";
  const renderedTemplate = renderPromptTemplatePreview(templateBody, values);
  if (section.mode === "override") {
    return renderPromptTemplatePreview(section.overrideText, values) || "未配置";
  }
  if (section.mode === "append") {
    const base = renderedTemplate.trim();
    const appendText = renderPromptTemplatePreview(section.appendText.trim(), values);
    if (!base) {
      return appendText || "未配置";
    }
    if (!appendText) {
      return renderedTemplate || "未配置";
    }
    return `${base}\n\n${appendText}`;
  }
  return renderedTemplate || "未配置";
}

export function getOutputCountFromPromptWorkbench(
  variables: PromptWorkbenchVariables,
  fallback: number,
): number {
  const parsed = Number.parseInt(variables.outputCount, 10);
  if (!Number.isInteger(parsed)) {
    return clampPromptOutputCount(fallback);
  }
  return clampPromptOutputCount(parsed);
}

export function normalizePromptWorkbenchOutputCount(
  workbench: PromptWorkbenchState,
  fallback: number,
): { workbench: PromptWorkbenchState; outputCount: number } {
  const outputCount = getOutputCountFromPromptWorkbench(workbench.variables, fallback);
  return {
    workbench: {
      ...workbench,
      variables: {
        ...workbench.variables,
        outputCount: String(outputCount),
      } as PromptWorkbenchVariables,
    },
    outputCount,
  };
}

function clampPromptOutputCount(value: number): number {
  if (!Number.isInteger(value)) {
    return PROMPT_OUTPUT_COUNT_MIN;
  }
  return Math.min(Math.max(value, PROMPT_OUTPUT_COUNT_MIN), PROMPT_OUTPUT_COUNT_MAX);
}

export function findPromptPresetOption(
  options: PromptPresetOption[],
  presetId: string,
): PromptPresetOption | null {
  return options.find((option) => option.id === presetId) ?? options[0] ?? null;
}

function buildDefaultSection(templateId: string | null): PromptBindingSection {
  return {
    mode: "default",
    baseTemplateId: templateId,
    appendText: "",
    overrideText: "",
  };
}

function findPromptPresetForBinding(
  presets: PromptPresetOption[],
  binding: PromptBinding | SavePromptBindingRequest,
): PromptPresetOption | null {
  let bestPreset: PromptPresetOption | null = null;
  let bestScore = 0;

  for (const preset of presets) {
    let score = 0;
    if (preset.system.baseTemplateId === binding.system.baseTemplateId) {
      score += 1;
    }
    if (preset.user.baseTemplateId === binding.user.baseTemplateId) {
      score += 2;
    }
    if (
      binding.negative &&
      preset.negative?.baseTemplateId === binding.negative.baseTemplateId
    ) {
      score += 1;
    }
    if (score > bestScore) {
      bestPreset = preset;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? bestPreset : null;
}

function normalizePromptWorkbenchVariables(
  variablesJson: SavePromptBindingRequest["variablesJson"],
): PromptWorkbenchVariables {
  const source =
    variablesJson && typeof variablesJson === "object" && !Array.isArray(variablesJson)
      ? variablesJson
      : {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalizedValue = normalizeVariableValue(value, "");
    if (normalizedValue) {
      normalized[key] = normalizedValue;
    }
  }
  return {
    ...normalized,
    style: normalizeVariableValue(source.style, DEFAULT_PROMPT_WORKBENCH_VARIABLES.style),
    background: normalizeVariableValue(
      source.background,
      DEFAULT_PROMPT_WORKBENCH_VARIABLES.background,
    ),
    aspectRatio: normalizeVariableValue(
      source.aspectRatio,
      DEFAULT_PROMPT_WORKBENCH_VARIABLES.aspectRatio,
    ),
    garmentCategory: normalizeVariableValue(
      source.garmentCategory,
      DEFAULT_PROMPT_WORKBENCH_VARIABLES.garmentCategory,
    ),
    outputCount: normalizeVariableValue(
      source.outputCount,
      DEFAULT_PROMPT_WORKBENCH_VARIABLES.outputCount,
    ),
  };
}

function normalizeVariableValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function buildPresetVariables(preset: PromptPreset): PromptWorkbenchVariables {
  return preset.variables.reduce<PromptWorkbenchVariables>(
    (variables, variable) => {
      if (variable.defaultValue) {
        return {
          ...variables,
          [variable.name]: variable.defaultValue,
        };
      }
      return variables;
    },
    { ...DEFAULT_PROMPT_WORKBENCH_VARIABLES },
  );
}
