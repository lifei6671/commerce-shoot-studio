import type { Asset, AssetPage, AssetQuery, ImportImagesInput } from "../types";

export interface AssetPort {
  listAssets(query?: AssetQuery): Promise<AssetPage>;
  getAsset(assetId: string): Promise<Asset>;
  importImages(input: ImportImagesInput): Promise<Asset[]>;
  revealAsset(assetId: string): Promise<void>;
  deleteAsset(assetId: string): Promise<void>;
}
