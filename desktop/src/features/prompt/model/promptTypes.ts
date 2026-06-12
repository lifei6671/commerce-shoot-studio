export type PromptMode = "default" | "append" | "override";

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
