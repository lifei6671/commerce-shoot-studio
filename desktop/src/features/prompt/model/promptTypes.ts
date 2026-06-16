export type PromptMode = "default" | "append" | "override";
export type PromptTemplateType = "system" | "user" | "negative";
export type PromptTemplateSource = "built_in" | "custom";
export type PromptVariableControlType = "input" | "select" | "combobox";

export type PromptTemplateVariable = {
  name: string;
  displayName?: string;
  description: string;
  exampleValue: string;
  required: boolean;
  defaultValue?: string | null;
  controlType?: PromptVariableControlType;
  options?: string[];
};

export type SavePromptTemplateRequest = {
  id?: string | null;
  name: string;
  templateType: PromptTemplateType;
  body: string;
  variables: PromptTemplateVariable[];
  description: string;
  tags: string[];
  isDefault: boolean;
  locked: boolean;
};

export type PromptTemplate = SavePromptTemplateRequest & {
  id: string;
  source: PromptTemplateSource;
  createdAt: string;
  updatedAt: string;
};

export type PromptBindingSection = {
  mode: PromptMode;
  baseTemplateId?: string | null;
  appendText: string;
  overrideText: string;
};

export type PromptVariableValues = Record<string, unknown>;

export type SavePromptBindingRequest = {
  id?: string | null;
  combinationId: string;
  system: PromptBindingSection;
  user: PromptBindingSection;
  negative?: PromptBindingSection | null;
  variablesJson: PromptVariableValues;
};

export type SavePromptPresetRequest = {
  id?: string | null;
  name: string;
  scenario: string;
  description: string;
  system: PromptBindingSection;
  user: PromptBindingSection;
  negative?: PromptBindingSection | null;
  variables: PromptTemplateVariable[];
  isDefault: boolean;
  locked: boolean;
};

export type PromptPreset = SavePromptPresetRequest & {
  id: string;
  source: PromptTemplateSource;
  createdAt: string;
  updatedAt: string;
};

export type SavePromptPresetScenarioRequest = {
  id?: string | null;
  name: string;
};

export type PromptPresetScenario = SavePromptPresetScenarioRequest & {
  id: string;
  source: PromptTemplateSource;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PromptBinding = SavePromptBindingRequest & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedPrompt = {
  revision?: number;
  system?: string | null;
  user: string;
  negative?: string | null;
  warnings: string[];
  resolverVersion: string;
};

export type PreviewResolvedPromptRequest = {
  combinationId: string;
  draftPromptBinding?: SavePromptBindingRequest;
  revision?: number;
};
