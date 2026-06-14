import type { SaveModelConfigRequest } from "../../model-config/model/modelTypes";
import type { ResolvedPrompt, SavePromptBindingRequest } from "../../prompt/model/promptTypes";

export type SaveImageCombinationRequest = {
  id?: string;
  name: string;
  personAssetId: string;
  personAssetIds?: string[];
  garmentAssetIds: string[];
};

export type ImageCombination = {
  id: string;
  name: string;
  personAssetId: string;
  personAssetIds: string[];
  garmentAssetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ImageCombinationSummary = {
  id: string;
  name: string;
  personAssetId?: string;
  garmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftImageCombination = {
  id?: string | null;
  name?: string | null;
  personAssetId?: string | null;
  garmentAssetIds: string[];
};

export type ValidateCombinationRequest = {
  revision: number;
  draftCombination: DraftImageCombination;
  draftPromptBinding?: SavePromptBindingRequest | null;
  draftModelConfig?: SaveModelConfigRequest | null;
};

export type ValidationReasonCode =
  | "PERSON_ASSET_REQUIRED"
  | "GARMENT_COUNT_BELOW_MIN"
  | "GARMENT_COUNT_ABOVE_MAX"
  | "ASSET_NOT_FOUND"
  | "PROMPT_BINDING_REQUIRED"
  | "PROMPT_REQUIRED_VARIABLE_MISSING"
  | "PROMPT_TEMPLATE_INVALID"
  | "MODEL_CONFIG_REQUIRED"
  | "MODEL_PARAM_INVALID";

export type ValidationReason = {
  code: ValidationReasonCode;
  message: string;
  field?: string | null;
};

export type ValidationWarning = {
  code: string;
  message: string;
};

export type EffectiveValidationLimits = {
  minGarments: number;
  maxGarments: number;
  normalizedOutputCount: number;
};

export type EffectiveModel = {
  provider: string;
  modelId: string;
  advanced: boolean;
  paramsJson: Record<string, unknown>;
};

export type ValidateCombinationResponse = {
  revision: number;
  executable: boolean;
  reasons: ValidationReason[];
  warnings: ValidationWarning[];
  effectiveLimits: EffectiveValidationLimits;
  resolvedPrompt?: ResolvedPrompt | null;
  effectiveModel?: EffectiveModel | null;
};
