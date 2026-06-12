export type SaveImageCombinationRequest = {
  id?: string;
  name: string;
  personAssetId: string;
  garmentAssetIds: string[];
};

export type ImageCombination = {
  id: string;
  name: string;
  personAssetId: string;
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
