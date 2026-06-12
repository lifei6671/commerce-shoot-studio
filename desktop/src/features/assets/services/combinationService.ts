import { invoke } from "@tauri-apps/api/core";

import type {
  ImageCombination,
  ImageCombinationSummary,
  SaveImageCombinationRequest,
} from "../model/combinationTypes";

export async function saveImageCombination(
  request: SaveImageCombinationRequest,
): Promise<ImageCombination> {
  return invoke<ImageCombination>("save_image_combination", { request });
}

export async function getImageCombination(
  id: string,
): Promise<ImageCombination | null> {
  return invoke<ImageCombination | null>("get_image_combination", { id });
}

export async function listImageCombinations(): Promise<ImageCombinationSummary[]> {
  return invoke<ImageCombinationSummary[]>("list_image_combinations");
}
