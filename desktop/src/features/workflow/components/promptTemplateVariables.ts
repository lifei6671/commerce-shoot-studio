import type {
  PromptTemplateVariable,
  PromptVariableControlType,
} from "../../prompt/model/promptTypes";

const PROMPT_PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;
const OPTION_SPLIT_PATTERN = /[\n,，、]+/g;

export function extractPromptVariableNames(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(PROMPT_PLACEHOLDER_PATTERN)) {
    const name = match[1]?.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

export function parsePromptVariableOptions(value: string): string[] {
  return uniqueOptions(value.split(OPTION_SPLIT_PATTERN));
}

export function formatPromptVariableOptions(options: string[] | undefined): string {
  return uniqueOptions(options ?? []).join("\n");
}

export function buildPromptVariablePreviewValue(variable: PromptTemplateVariable): string {
  const normalized = normalizePromptTemplateVariable(variable);
  if (normalized.controlType === "select") {
    return normalized.defaultValue || normalized.options?.[0] || "";
  }
  return normalized.defaultValue ?? normalized.exampleValue ?? "";
}

export function syncPromptTemplateVariablesFromBody({
  body,
  variables,
}: {
  body: string;
  variables: PromptTemplateVariable[];
}): PromptTemplateVariable[] {
  const existingByName = new Map(
    variables.map((variable) => [variable.name.trim(), normalizePromptTemplateVariable(variable)]),
  );

  return extractPromptVariableNames(body).map((name) => {
    const existing = existingByName.get(name);
    if (existing) {
      return existing;
    }
    return normalizePromptTemplateVariable({
      name,
      displayName: name,
      description: name,
      exampleValue: "",
      required: true,
      defaultValue: "",
      controlType: "input",
      options: [],
    });
  });
}

export function normalizePromptTemplateVariable(
  variable: PromptTemplateVariable,
): PromptTemplateVariable {
  const controlType = normalizeControlType(variable.controlType);
  const options = controlType === "input" ? [] : uniqueOptions(variable.options ?? []);
  const rawDefaultValue = variable.defaultValue ?? variable.exampleValue ?? "";
  const defaultValue =
    controlType === "select" && options.length > 0 && !options.includes(rawDefaultValue)
      ? options[0]
      : rawDefaultValue;
  const fallbackDisplayName = variable.description || variable.name.trim();
  const displayName =
    variable.displayName === undefined ||
    variable.displayName === null ||
    !variable.displayName.trim()
      ? fallbackDisplayName
      : variable.displayName;

  return {
    ...variable,
    name: variable.name.trim(),
    displayName,
    description: variable.description || variable.name.trim(),
    exampleValue: variable.exampleValue ?? defaultValue,
    required: variable.required ?? true,
    defaultValue,
    controlType,
    options,
  };
}

function normalizeControlType(
  controlType: PromptVariableControlType | undefined,
): PromptVariableControlType {
  if (controlType === "select" || controlType === "combobox") {
    return controlType;
  }
  return "input";
}

function uniqueOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const option of options) {
    const value = option.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}
