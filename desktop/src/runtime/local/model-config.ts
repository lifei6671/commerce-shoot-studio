import { invoke } from "@tauri-apps/api/core";
import type {
  LocalModelConfigView,
  ModelConfigPort,
  ProviderProfileView,
  ProviderTestResult,
  SaveLocalModelConfigInput,
  SetDefaultModelConfigInput,
} from "../index";

export const localModelConfigPort: ModelConfigPort = {
  listConfigs() {
    return invoke<LocalModelConfigView[]>("model_config_list_configs");
  },
  getConfig(configId: string) {
    return invoke<LocalModelConfigView>("model_config_get_config", { configId });
  },
  saveConfig(input: SaveLocalModelConfigInput) {
    return invoke<LocalModelConfigView>("model_config_save_config", { input });
  },
  setDefaultConfig(input: SetDefaultModelConfigInput) {
    return invoke<LocalModelConfigView>("model_config_set_default_config", { input });
  },
  deleteConfig(configId: string) {
    return invoke("model_config_delete_config", { configId });
  },
  listProviderProfiles() {
    return invoke<ProviderProfileView[]>("model_config_list_provider_profiles");
  },
  testConfig(configId: string) {
    return invoke<ProviderTestResult>("model_config_test_config", { configId });
  },
};
