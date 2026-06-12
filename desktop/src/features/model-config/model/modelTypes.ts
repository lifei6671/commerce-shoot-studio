export type ModelInputLimits = {
  minGarments: number;
  maxGarments: number;
};

export type ModelParamKind = "integer" | "select" | "text";

export type ModelParamSchema = {
  key: string;
  label: string;
  kind: ModelParamKind;
  required: boolean;
  defaultValue: unknown;
  min?: number | null;
  max?: number | null;
  options: unknown[];
};

export type ModelOutputSchema = {
  countParamKey: string;
  minCount: number;
  maxCount: number;
};

export type ModelDefinition = {
  provider: string;
  modelId: string;
  displayName: string;
  advanced: boolean;
  inputLimits: ModelInputLimits;
  paramsSchema: ModelParamSchema[];
  output: ModelOutputSchema;
  providerBaseUrl?: string | null;
};

export type SaveModelConfigRequest = {
  id?: string | null;
  provider: string;
  modelId: string;
  paramsJson: Record<string, unknown>;
};

export type ModelConfig = {
  id: string;
  provider: string;
  modelId: string;
  paramsJson: Record<string, unknown>;
  inputLimits: ModelInputLimits;
  normalizedOutputCount: number;
  createdAt: string;
  updatedAt: string;
};
