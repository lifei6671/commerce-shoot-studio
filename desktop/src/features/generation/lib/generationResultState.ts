import { defaultProductGenerationSettings } from "../components/GenerationConfigPanel";
import type {
  GeneratedDetailImage,
  GeneratedReferenceImage,
  ProductListingCopy,
} from "../components/PreviewCanvas";
import type { GenerationRecord } from "../../history/components/GenerationHistoryPopover";
import {
  createLocalePromptConstraint,
  createOriginalImageFidelityConstraint,
  createVisibleTextPromptConstraint,
} from "./productDetailPlan";
import type { GenerationTaskDetail } from "../../../runtime";

export function readOutputString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readOutputNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOutputStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

export function readReferenceImagesFromTaskDetail(
  detail: GenerationTaskDetail,
  input: Record<string, unknown>,
): GeneratedReferenceImage[] {
  const assetReferences = detail.inputAssets
    .filter((item) => item.role === "source" || item.role === "reference")
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((item): GeneratedReferenceImage => ({
      assetId: item.asset.id,
      mimeType: item.asset.mimeType,
      originalName: item.asset.originalName || item.asset.name,
      src: item.asset.url ?? item.asset.localPath,
    }));
  return assetReferences.length > 0 ? assetReferences : readReferenceImages(input);
}

export function readReferenceImages(input: Record<string, unknown>): GeneratedReferenceImage[] {
  const userImages = input.userImages;
  if (!Array.isArray(userImages)) {
    return [];
  }
  return userImages
    .map((item): GeneratedReferenceImage | null => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const dataUrl = readOutputString(value.dataUrl);
      return dataUrl
        ? {
            dataUrl,
            assetId: readOutputString(value.assetId) || undefined,
            mimeType: readOutputString(value.mimeType) || undefined,
            originalName: readOutputString(value.originalName) || undefined,
            src: readOutputString(value.src) || undefined,
          }
        : null;
    })
    .filter((item): item is GeneratedReferenceImage => item !== null);
}

export function applyGeneratedAssetOutputs(
  images: GeneratedDetailImage[],
  detail: GenerationTaskDetail,
  options: { final?: boolean } = {},
): GeneratedDetailImage[] {
  const outputAssetBySortOrder = new Map(detail.outputAssets.map((item) => [item.sortOrder, item] as const));
  let imageIndex = 0;
  const referenceImages = readReferenceImagesFromTaskDetail(
    detail,
    detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {},
  );

  return images.map((image) => {
    if (image.kind === "source-image") {
      return { ...image, status: "complete" };
    }
    if (image.kind === "listing-copy") {
      return image;
    }
    const outputAsset = outputAssetBySortOrder.get(imageIndex);
    imageIndex += 1;
    if (!outputAsset?.asset.url && !outputAsset?.asset.localPath) {
      return options.final
        ? {
            ...image,
            errorMessage: "生成结果缺少可展示图片。",
            referenceImages: referenceImages.length > 0 ? referenceImages : image.referenceImages,
            status: "failed",
          }
        : image;
    }
    return {
      ...image,
      assetId: outputAsset.asset.id,
      assetLocalPath: outputAsset.asset.localPath,
      assetRelativePath: outputAsset.asset.relativePath,
      height: outputAsset.asset.height,
      referenceImages: referenceImages.length > 0 ? referenceImages : image.referenceImages,
      src: outputAsset.asset.url ?? outputAsset.asset.localPath,
      status: "complete",
      width: outputAsset.asset.width,
    };
  });
}

export function applySceneGeneratedAssetOutputs(
  images: GeneratedDetailImage[],
  detail: GenerationTaskDetail,
  options: { final?: boolean } = {},
) {
  const outputAssetBySortOrder = new Map(detail.outputAssets.map((item) => [item.sortOrder, item] as const));
  const referenceImages = readReferenceImagesFromTaskDetail(
    detail,
    detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {},
  );
  let generatedImageIndex = 0;
  return images.map((image): GeneratedDetailImage => {
    if (image.kind === "source-image") {
      return { ...image, status: "complete" };
    }
    const sortOrder = image.imageNo ? image.imageNo - 1 : generatedImageIndex;
    generatedImageIndex += 1;
    const outputAsset = outputAssetBySortOrder.get(sortOrder);
    const src = outputAsset?.asset.url ?? outputAsset?.asset.localPath;
    if (!outputAsset || !src) {
      return options.final
        ? { ...image, errorMessage: detail.task.error?.message || "生成结果缺少可展示图片。", status: "failed" }
        : image;
    }
    return {
      ...image,
      assetId: outputAsset.asset.id,
      assetLocalPath: outputAsset.asset.localPath,
      assetRelativePath: outputAsset.asset.relativePath,
      errorMessage: undefined,
      height: outputAsset.asset.height,
      referenceImages,
      src,
      status: "complete",
      width: outputAsset.asset.width,
    };
  });
}

export function isTaskTerminal(status: GenerationTaskDetail["task"]["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
}

export function createTaskPollSignature(detail: GenerationTaskDetail) {
  return [
    detail.task.status,
    detail.task.stage,
    detail.task.updatedAt,
    detail.events.length,
    detail.outputAssets.length,
    detail.output ? "has-output" : "no-output",
  ].join("|");
}

export function delay(durationMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
}

export function normalizeAssetSrc(src: string) {
  return src.replace("asset://localhost//", "asset://localhost/");
}

export function applyListingCopyOutput(images: GeneratedDetailImage[], imageId: string, output: unknown) {
  const listingCopy = parseListingCopyOutput(output);
  return images.map((image): GeneratedDetailImage =>
    image.id === imageId
      ? listingCopy
        ? { ...image, listingCopy, status: "complete" }
        : { ...image, errorMessage: "上架文案结果缺少有效内容。", status: "failed" }
      : image,
  );
}

export function failListingCopyOutput(images: GeneratedDetailImage[], imageId: string, message: string) {
  return images.map((image): GeneratedDetailImage =>
    image.id === imageId ? { ...image, errorMessage: message, status: "failed" } : image,
  );
}

export function failProductImageOutputs(images: GeneratedDetailImage[], message: string) {
  return images.map((image): GeneratedDetailImage =>
    image.kind === "source-image" || image.kind === "listing-copy" || image.status === "complete"
      ? image
      : { ...image, errorMessage: message, status: "failed" },
  );
}

export function failGeneratedImages(images: GeneratedDetailImage[], message: string) {
  return images.map((image): GeneratedDetailImage =>
    image.kind === "source-image" || image.status === "complete"
      ? image
      : { ...image, errorMessage: message, status: "failed" },
  );
}

export function resolveGeneratedImageNo(target: GeneratedDetailImage, images: GeneratedDetailImage[]) {
  if (target.imageNo && target.imageNo > 0) {
    return target.imageNo;
  }
  const generatedImages = images.filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy");
  const index = generatedImages.findIndex((image) => image.id === target.id);
  return index >= 0 ? index + 1 : 1;
}

export function deriveProductGenerationRecordStatus(images: GeneratedDetailImage[]): GenerationRecord["status"] {
  const resultImages = images.filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy");
  if (resultImages.some((image) => image.status === "generating")) {
    return "generating";
  }
  if (
    resultImages.some((image) => image.status === "complete") &&
    resultImages.some((image) => image.status === "failed")
  ) {
    return "partial";
  }
  if (resultImages.some((image) => image.status === "failed")) {
    return "failed";
  }
  return "complete";
}

export function createProductDetailRetryPrompt(
  image: GeneratedDetailImage,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
) {
  const basePrompt = image.prompt || image.sceneDescription || `场景描述：${image.title}`;
  return [
    image.designSpec,
    image.imageType ? `场景核心卖点：${image.imageType}` : "",
    basePrompt,
    image.sceneDescription ? `用户可修改文案要求：${image.sceneDescription}` : "",
    "单图重新生成要求：必须与参考图保持一致，严格保持商品主体、颜色、版型、图案、材质观感和关键外观特征一致，不得替换商品，不得改变已提供事实。",
    `平台与语言：${settings.platform}，${settings.market}，${settings.language}`,
    createLocalePromptConstraint(settings),
    `商品卖点事实边界：${productPrompt.trim() || "需补充商品卖点信息"}`,
    createOriginalImageFidelityConstraint(),
    createVisibleTextPromptConstraint(),
    "禁止项：禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标、未提供的材质或功效。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseListingCopyOutput(output: unknown): ProductListingCopy | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const value = output as Record<string, unknown>;
  const title = readOutputString(value.title);
  const sellingPoints = [...readOutputStringArray(value.sellingPoints), ...readOutputStringArray(value.promotionBenefits)];
  const detailCopy = readOutputString(value.detailCopy);
  const searchKeywords = readOutputStringArray(value.searchKeywords);
  const attributeWords = readOutputStringArray(value.attributeWords);
  if (!title || sellingPoints.length === 0 || !detailCopy) {
    return null;
  }
  return {
    detailCopy,
    keywords: [...searchKeywords, ...attributeWords].join(" "),
    sellingPoints,
    shootingPlan: readOutputStringArray(value.mainImageGuidance),
    sourcePrompt: readOutputString(value.platform) || "listing-copy",
    title,
  };
}
