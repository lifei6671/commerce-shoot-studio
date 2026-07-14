import type { RuntimeMode } from "./common";

export type RuntimeFeatureFlags = {
  mode: RuntimeMode;
  supportsLocalFileReveal: boolean;
  supportsDirectoryPicker: boolean;
  supportsSystemNotification: boolean;
  supportsLocalModelConfig: boolean;
  supportsSecretManagement: boolean;
  supportsWorkspaceSwitch: boolean;
};

export type RuntimeInfo = {
  mode: RuntimeMode;
  version: string;
  features: RuntimeFeatureFlags;
};
