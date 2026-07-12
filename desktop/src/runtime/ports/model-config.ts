import type {
  LocalModelConfigView,
  ModelCapability,
  ModelImageSizeOptions,
  ProviderProfileView,
  ProviderTestResult,
  SaveLocalModelConfigInput,
  SetDefaultModelConfigInput,
} from "../types";

export interface ModelConfigPort {
  listConfigs(): Promise<LocalModelConfigView[]>;
  listImageSizeOptions(capabilityId: ModelCapability["id"]): Promise<ModelImageSizeOptions>;
  getConfig(configId: string): Promise<LocalModelConfigView>;
  saveConfig(input: SaveLocalModelConfigInput): Promise<LocalModelConfigView>;
  setDefaultConfig(input: SetDefaultModelConfigInput): Promise<LocalModelConfigView>;
  deleteConfig(configId: string): Promise<void>;
  listProviderProfiles(): Promise<ProviderProfileView[]>;
  testConfig(configId: string): Promise<ProviderTestResult>;
}
