import { invoke } from "@tauri-apps/api/core";

import type {
  ModelConfig,
  ModelDefinition,
  SaveModelConfigRequest,
} from "../model/modelTypes";

export async function listModelDefinitions(
  advancedModels = false,
): Promise<ModelDefinition[]> {
  return invoke<ModelDefinition[]>("list_model_definitions", { advancedModels });
}

export async function saveModelConfig(
  request: SaveModelConfigRequest,
  advancedModels = false,
): Promise<ModelConfig> {
  return invoke<ModelConfig>("save_model_config", { request, advancedModels });
}

export async function getModelConfig(id: string): Promise<ModelConfig | null> {
  return invoke<ModelConfig | null>("get_model_config", { id });
}
