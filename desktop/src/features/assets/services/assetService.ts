import { invoke } from "@tauri-apps/api/core";

import type { AssetType, ImportImageResponse } from "../model/assetTypes";

export async function importImage(
  sourcePath: string,
  assetType: AssetType,
): Promise<ImportImageResponse> {
  return invoke<ImportImageResponse>("import_image", {
    sourcePath,
    assetType,
  });
}

export async function deleteAsset(assetId: string): Promise<void> {
  return invoke<void>("delete_asset", { assetId });
}

export async function runAssetGarbageCollection(): Promise<number> {
  return invoke<number>("run_asset_garbage_collection");
}
