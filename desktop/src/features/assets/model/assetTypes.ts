export type AssetType = "person" | "garment" | "result";

export type ImportedAsset = {
  id: string;
  assetType: AssetType;
  originalName: string;
  relativePath: string;
  thumbRelativePath: string;
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
};

export type ImportImageResponse = {
  asset: ImportedAsset;
  duplicate: boolean;
  thumbFilePath: string;
};

export type AssetFileView = {
  asset: ImportedAsset;
  filePath: string;
  thumbFilePath: string;
};
