import type {
  SaveImageCombinationRequest,
} from "../../assets/model/combinationTypes";
import type { SaveModelConfigRequest } from "../../model-config/model/modelTypes";
import type { SavePromptBindingRequest } from "../../prompt/model/promptTypes";

export type WorkbenchAutoSaveInput = {
  combinationId: string | null | undefined;
  combinationName: string;
  personAssetId: string | null;
  personAssetIds: string[];
  garmentAssetIds: string[];
  promptBinding: SavePromptBindingRequest | null;
  modelConfig: SaveModelConfigRequest;
};

export type WorkbenchAutoSavePlan = {
  combination: SaveImageCombinationRequest;
  promptBinding: SavePromptBindingRequest;
  modelConfig: SaveModelConfigRequest;
};

export function buildWorkbenchAutoSavePlan(
  input: WorkbenchAutoSaveInput,
): WorkbenchAutoSavePlan | null {
  if (
    !input.combinationId ||
    !input.personAssetId ||
    !input.garmentAssetIds.length ||
    !input.promptBinding
  ) {
    return null;
  }

  return {
    combination: {
      id: input.combinationId,
      name: input.combinationName,
      personAssetId: input.personAssetId,
      personAssetIds: input.personAssetIds,
      garmentAssetIds: input.garmentAssetIds,
    },
    promptBinding: input.promptBinding,
    modelConfig: input.modelConfig,
  };
}

export function buildWorkbenchAutoSaveSignature(input: WorkbenchAutoSaveInput) {
  return JSON.stringify({
    combinationId: input.combinationId ?? null,
    combinationName: input.combinationName,
    personAssetId: input.personAssetId,
    personAssetIds: input.personAssetIds,
    garmentAssetIds: input.garmentAssetIds,
    promptBinding: input.promptBinding,
    modelConfig: input.modelConfig,
  });
}
