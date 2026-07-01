import { invoke } from "@tauri-apps/api/core";
import type { Asset, AssetPort, AssetQuery, ImportImagesInput } from "../index";

export const localAssetPort: AssetPort = {
  listAssets(query?: AssetQuery) {
    return invoke("asset_list", { query });
  },
  getAsset(assetId: string) {
    return invoke<Asset>("asset_get", { assetId });
  },
  importImages(input: ImportImagesInput) {
    return invoke<Asset[]>("asset_import_images", { input });
  },
  revealAsset(assetId: string) {
    return invoke("asset_reveal", { assetId });
  },
  deleteAsset(assetId: string) {
    return invoke("asset_delete", { assetId });
  },
};
