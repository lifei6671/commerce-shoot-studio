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
