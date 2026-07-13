import type { DateTimeString } from "./common";

export type ModelCapability = {
  id:
    | "listing-copy"
    | "prompt-plan"
    | "product-selling-points"
    | "clothing-scene-planning"
    | "scene-prompt-planning"
    | "viral-style-analysis"
    | "scene-image-generation"
    | "product-detail-generation"
    | "clothing-base-model-generation"
    | "clothing-tryon-generation"
    | "image-edit";
  category: "text-to-text" | "text-to-image" | "image-to-image" | "image-to-text";
  available: boolean;
  unavailableReason?: string;
  displayName?: string;
  maxInputAssets?: number;
  supportedAspectRatios?: Array<"1:1" | "2:3" | "3:4" | "9:16" | "16:9">;
  maxImageCount?: number;
  estimatedCreditCost?: number;
};

export type SecretStorageKind = "sqlite-local" | "remote-managed";

export type SecretStatus = {
  configured: boolean;
  storage: SecretStorageKind;
  lastUpdatedAt?: DateTimeString;
};

export type ProviderProfileView = {
  id: string;
  displayName: string;
  providerLabel: string;
  protocol: "openai" | "openai-compatible";
  baseUrl: string;
  defaultEndpointPath?: string;
  supportedCategories: ModelCapability["category"][];
  supportedCapabilities: ModelCapability["id"][];
  customEnabled: boolean;
};

export type LocalModelConfigView = {
  id: string;
  capabilityId: ModelCapability["id"];
  providerProfileId: string;
  displayName: string;
  providerLabel: string;
  protocol: "openai" | "openai-compatible";
  executionMode: "sync" | "stream" | "async-task" | "auto";
  model: string;
  baseUrl: string;
  endpointPath?: string;
  secretStatus: SecretStatus;
  connectionStatus: "untested" | "available" | "unavailable";
  connectionMessage?: string;
  connectionTestedAt?: DateTimeString;
  enabled: boolean;
  isDefault: boolean;
};

export type ImageSizeOption = {
  id: string;
  label: string;
  ratio: string;
  width: number;
  height: number;
  providerValue: string;
};

export type ModelImageSizeOptions = {
  capabilityId: ModelCapability["id"];
  configId: string;
  providerProfileId: string;
  model: string;
  options: ImageSizeOption[];
};

export type SaveLocalModelConfigInput = {
  id?: string;
  capabilityId: ModelCapability["id"];
  providerProfileId: string;
  displayName: string;
  executionMode: "sync" | "stream" | "async-task" | "auto";
  model: string;
  baseUrl?: string;
  endpointPath?: string;
  enabled: boolean;
};

export type SetDefaultModelConfigInput = {
  capabilityId: ModelCapability["id"];
  configId: string;
};

export type SecretScope = {
  providerProfileId: string;
  capabilityId?: ModelCapability["id"];
};

export type ProviderTestResult = {
  ok: boolean;
  message?: string;
  elapsedMs?: number;
};
