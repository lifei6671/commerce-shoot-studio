import type { ProductImageAsset } from "../generation/lib/productImagePicker";

export type ClothingConfigState = {
  aiRecommended: boolean;
  aiModelAge: string;
  aiModelBody: string;
  aiModelEthnicity: string;
  aiModelGender: string;
  aiModelAppearance: string;
  clothingImages: ProductImageAsset[];
  customScene: string;
  generatedBaseModelImages: GeneratedBaseModelImage[];
  modelMode: "library" | "ai";
  modelImages: ProductImageAsset[];
  ratio: string;
  sceneIds: string[];
  selectedModelId: string | null;
};

export type BaseModelGenerationInput = {
  age: string;
  appearance: string;
  body: string;
  ethnicity: string;
  gender: string;
};

export type GeneratedBaseModelImage = ProductImageAsset & {
  favoritedModelImage?: ProductImageAsset;
  status: "ready";
};

export type ClothingSceneDraft = {
  angle: string;
  checked: boolean;
  description: string;
  framing: string;
  id: string;
  scene: string;
  scenePromptSegment: string;
  sceneVisualAnchor: string;
  shootingPosition: string;
};
