import { invoke } from "@tauri-apps/api/core";

import type {
  ModelConfig,
  ModelDefinition,
  ProviderCredentialStatus,
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

export async function setProviderApiKey(
  provider: string,
  apiKey: string,
): Promise<void> {
  return invoke<void>("set_provider_api_key", { provider, apiKey });
}

export async function getProviderCredentialStatus(
  provider: string,
): Promise<ProviderCredentialStatus> {
  return invoke<ProviderCredentialStatus>("get_provider_credential_status", {
    provider,
  });
}
