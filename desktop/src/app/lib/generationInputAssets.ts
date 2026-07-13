import type { ClothingConfigState } from "../../features/clothing/types";
import type { GeneratedReferenceImage } from "../../features/generation/components/PreviewCanvas";
import type { ProductImageAsset } from "../../features/generation/lib/productImagePicker";
import type { GenerationTaskInputAssetInput } from "../../runtime";
import { localAssetPort } from "../../runtime/local/assets";

export function mimeTypeFromImageName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  return "image/png";
}

export function createProductReferenceAssetViews(productImages: ProductImageAsset[]): GeneratedReferenceImage[] {
  return productImages
    .filter((image) => image.assetId)
    .map((image) => ({
      assetId: image.assetId,
      mimeType: image.aiAssistMimeType ?? mimeTypeFromImageName(image.name),
      originalName: image.name,
      src: image.src,
    }));
}

export function referenceImagesToInputAssets(
  referenceImages: GeneratedReferenceImage[],
  role: GenerationTaskInputAssetInput["role"],
): GenerationTaskInputAssetInput[] {
  const seenAssetIds = new Set<string>();
  return referenceImages
    .map((image) => image.assetId)
    .filter((assetId): assetId is string => Boolean(assetId))
    .filter((assetId) => {
      if (seenAssetIds.has(assetId)) {
        return false;
      }
      seenAssetIds.add(assetId);
      return true;
    })
    .map((assetId, index) => ({ assetId, role, sortOrder: index }));
}

export async function importProductInputAssets(
  productImages: ProductImageAsset[],
  role: GenerationTaskInputAssetInput["role"],
): Promise<GenerationTaskInputAssetInput[]> {
  const importTargets = productImages
    .map((image, index) => ({ image, index }))
    .filter((item) => !item.image.assetId && item.image.path);
  const importedAssets =
    importTargets.length > 0
      ? await localAssetPort.importImages({
          kind: role === "model" ? "model" : role === "source" ? "source" : "reference",
          paths: importTargets.map((item) => item.image.path),
        })
      : [];
  const importedByIndex = new Map(
    importTargets.map((item, importIndex) => [item.index, importedAssets[importIndex]] as const),
  );

  const inputAssets: GenerationTaskInputAssetInput[] = [];
  productImages.forEach((image, index) => {
    const assetId = image.assetId ?? importedByIndex.get(index)?.id;
    if (assetId) {
      inputAssets.push({ assetId, role, sortOrder: index });
    }
  });
  return inputAssets;
}

export async function createClothingInputAssets(config: ClothingConfigState): Promise<GenerationTaskInputAssetInput[]> {
  const clothingAssets = await importProductInputAssets(config.clothingImages, "source");
  const selectedModel = findSelectedClothingModelImage(config);
  if (!selectedModel) {
    throw new Error("请选择可用的模特全身图。");
  }
  const modelAssets = await importProductInputAssets([selectedModel], "model");
  return [
    ...modelAssets.map((asset, index) => ({ ...asset, sortOrder: index })),
    ...clothingAssets.map((asset, index) => ({ ...asset, sortOrder: modelAssets.length + index })),
  ];
}

function findSelectedClothingModelImage(config: ClothingConfigState): ProductImageAsset | null {
  if (!config.selectedModelId) {
    return null;
  }
  return (
    config.modelImages.find((image) => image.id === config.selectedModelId) ??
    config.generatedBaseModelImages.find((image) => image.id === config.selectedModelId) ??
    null
  );
}
