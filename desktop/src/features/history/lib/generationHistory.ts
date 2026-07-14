import { defaultProductGenerationSettings } from "../../generation/components/GenerationConfigPanel";
import type {
  GeneratedDetailImage,
  GeneratedReferenceImage,
} from "../../generation/components/PreviewCanvas";
import type { ProductImageAsset } from "../../generation/lib/productImagePicker";
import {
  deriveProductGenerationRecordStatus,
  isTaskTerminal,
  parseListingCopyOutput,
  readOutputNumber,
  readOutputString,
  readReferenceImagesFromTaskDetail,
} from "../../generation/lib/generationResultState";
import type { GenerationRecord } from "../components/GenerationHistoryPopover";
import type { GenerationTaskDetail } from "../../../runtime";

const restoredRunningTaskStaleMs = 10 * 60 * 1000;

export function createSceneRetryTaskInput(
  parentInput: Record<string, unknown>,
  item: Record<string, unknown>,
  retry: { imageNo: number; parentTaskId: string; retrySequence: number; targetImageId: string },
) {
  return {
    campaignStyleLock: readOutputString(parentInput.campaignStyleLock),
    conversionDriver: readOutputString(parentInput.conversionDriver),
    generationPromptVersion: readOutputString(parentInput.generationPromptVersion),
    items: [{ ...item, imageNo: retry.imageNo, sortOrder: 0 }],
    kind: "scene-image-generation",
    outputMode: readOutputString(parentInput.outputMode),
    parentTaskId: retry.parentTaskId,
    planningPromptVersion: readOutputString(parentInput.planningPromptVersion),
    ratio: readOutputString(parentInput.ratio),
    retrySequence: retry.retrySequence,
    singleImageRetry: true,
    targetImageId: retry.targetImageId,
    templateCatalogVersion: readOutputString(parentInput.templateCatalogVersion),
  };
}

export function createGenerationRecordId(prefix: "clothing" | "product") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createProductHistorySummary(settings: typeof defaultProductGenerationSettings, imageCount: number) {
  const formatLabel =
    settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;

  return `${settings.platform} · ${settings.market} · ${settings.language} · ${formatLabel} · ${imageCount} 张`;
}

export function createProductGenerationRecordFromTaskDetail(detail: GenerationTaskDetail): GenerationRecord | null {
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  if (readOutputString(input.kind) !== "product-detail-generation") {
    return null;
  }
  if (isSingleImageRetryTaskDetail(detail)) {
    return null;
  }

  const stale = isRestoredTaskStale(detail.task);
  const images = restoreGeneratedDetailImages(detail, {
    referenceImages: readReferenceImagesFromTaskDetail(detail, input),
    stale,
  });
  if (images.length === 0) {
    return null;
  }

  return {
    createdAt: dateTimeToTimestamp(detail.task.createdAt),
    id: detail.task.id,
    images,
    inputSummary: detail.task.inputSummary || createRestoredProductHistorySummary(input),
    kind: "product-detail",
    persistedTaskId: detail.task.id,
    promptPlanId: readTaskPromptPlanId(detail),
    relatedTaskIds: [detail.task.id],
    status: restoredGenerationTaskStatus(detail, images, stale),
    title: detail.task.title || "商品详情图",
    workspace: "product",
  };
}

export function createClothingGenerationRecordFromTaskDetail(detail: GenerationTaskDetail): GenerationRecord | null {
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  if (readOutputString(input.kind) !== "clothing-tryon-generation" || isSingleImageRetryTaskDetail(detail)) {
    return null;
  }

  const stale = isRestoredTaskStale(detail.task);
  const referenceImages = readReferenceImagesFromTaskDetail(detail, input);
  const outputAssetBySortOrder = new Map(detail.outputAssets.map((item) => [item.sortOrder, item] as const));
  const deletedSortOrders = deletedResultSortOrders(detail);
  const inputItems = readClothingGenerationInputItems(input);
  const itemCount = Math.max(
    inputItems.length,
    ...detail.outputAssets.map((item) => item.sortOrder + 1),
  );
  const shouldFailMissingOutput = stale || isTaskTerminal(detail.task.status);
  const restoredImages = Array.from({ length: itemCount }, (_, index): GeneratedDetailImage | null => {
    if (deletedSortOrders.has(index)) {
      return null;
    }
    const inputItem = inputItems[index];
    const outputAsset = outputAssetBySortOrder.get(index);
    const title = inputItem?.scene || `服饰场景 ${index + 1}`;
    const imageId = inputItem?.imageId || createRestoredDetailImageId(detail.task.id, inputItem?.id, index);
    if (outputAsset?.asset.url || outputAsset?.asset.localPath) {
      return {
        assetId: outputAsset.asset.id,
        assetLocalPath: outputAsset.asset.localPath,
        assetRelativePath: outputAsset.asset.relativePath,
        height: outputAsset.asset.height,
        id: imageId,
        imageNo: index + 1,
        prompt: inputItem?.poseAction,
        ratio: readOutputString(input.ratio) || inputItem?.ratio,
        referenceImages,
        sceneDescription: inputItem?.poseAction || inputItem?.sceneVisualAnchor,
        src: outputAsset.asset.url ?? outputAsset.asset.localPath,
        status: "complete",
        title,
        width: outputAsset.asset.width,
      };
    }

    return {
      errorMessage: stale ? "生成中断" : detail.task.error?.message || "生成结果缺少可展示图片。",
      id: imageId,
      imageNo: index + 1,
      prompt: inputItem?.poseAction,
      ratio: readOutputString(input.ratio) || inputItem?.ratio,
      referenceImages,
      sceneDescription: inputItem?.poseAction || inputItem?.sceneVisualAnchor,
      status: shouldFailMissingOutput ? "failed" : "generating",
      title,
    };
  }).filter((image): image is GeneratedDetailImage => image !== null);
  if (restoredImages.length === 0) {
    return null;
  }
  const images = prependRestoredSourceImageCards(detail.task.id, restoredImages, referenceImages);

  return {
    createdAt: dateTimeToTimestamp(detail.task.createdAt),
    id: detail.task.id,
    images,
    inputSummary: detail.task.inputSummary || createRestoredClothingHistorySummary(input, images),
    kind: "clothing-scene",
    persistedTaskId: detail.task.id,
    relatedTaskIds: [detail.task.id],
    status: restoredGenerationTaskStatus(detail, images, stale),
    title: detail.task.title || "服饰场景图",
    workspace: "clothing",
  };
}

export function createSceneGenerationRecordFromTaskDetail(detail: GenerationTaskDetail): GenerationRecord | null {
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  if (readOutputString(input.kind) !== "scene-image-generation" || isSingleImageRetryTaskDetail(detail)) {
    return null;
  }
  const items = readSceneGenerationInputItems(input);
  if (items.length === 0) {
    return null;
  }
  const stale = isRestoredTaskStale(detail.task);
  const terminal = isTaskTerminal(detail.task.status);
  const deletedSortOrders = deletedResultSortOrders(detail);
  const outputAssetBySortOrder = new Map(detail.outputAssets.map((asset) => [asset.sortOrder, asset] as const));
  const referenceImages = readReferenceImagesFromTaskDetail(detail, input);
  const restoredImages = items.flatMap((item): GeneratedDetailImage[] => {
    if (deletedSortOrders.has(item.sortOrder)) {
      return [];
    }
    const outputAsset = outputAssetBySortOrder.get(item.sortOrder);
    const src = outputAsset?.asset.url ?? outputAsset?.asset.localPath;
    return [{
      assetId: outputAsset?.asset.id,
      assetLocalPath: outputAsset?.asset.localPath,
      assetRelativePath: outputAsset?.asset.relativePath,
      errorMessage: src ? undefined : stale ? "生成中断" : terminal ? detail.task.error?.message || "生成结果缺少可展示图片。" : undefined,
      height: outputAsset?.asset.height,
      id: item.imageId,
      imageNo: item.imageNo,
      prompt: item.prompt,
      ratio: item.ratio,
      referenceImages,
      sceneDescription: item.purpose,
      src,
      status: src ? "complete" : stale || terminal ? "failed" : "generating",
      title: `${item.code} ${item.title}`,
      width: outputAsset?.asset.width,
    }];
  });
  if (restoredImages.length === 0) {
    return null;
  }
  const images = prependRestoredSourceImageCards(detail.task.id, restoredImages, referenceImages);
  const promptPlanId = readTaskPromptPlanId(detail);
  return {
    createdAt: dateTimeToTimestamp(detail.task.createdAt),
    id: detail.task.id,
    images,
    inputSummary: detail.task.inputSummary || `${readOutputString(input.ratio)} · ${restoredImages.length} 张`,
    kind: "scene-generation",
    persistedTaskId: detail.task.id,
    promptPlanId,
    relatedTaskIds: [detail.task.id, promptPlanId].filter((taskId): taskId is string => Boolean(taskId)),
    status: restoredGenerationTaskStatus(detail, images, stale),
    title: detail.task.title || "场景图片",
    workspace: "scene",
  };
}

type RestoredSceneGenerationInputItem = {
  code: string;
  imageId: string;
  imageNo: number;
  prompt: string;
  purpose: string;
  ratio: string;
  sortOrder: number;
  title: string;
};

function readSceneGenerationInputItems(input: Record<string, unknown>): RestoredSceneGenerationInputItem[] {
  const items = Array.isArray(input.items) ? input.items : [];
  return items.flatMap((item, index): RestoredSceneGenerationInputItem[] => {
    const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const imageId = readOutputString(value.imageId);
    if (!imageId) {
      return [];
    }
    return [{
      code: readOutputString(value.code) || `S${index + 1}`,
      imageId,
      imageNo: readOutputNumber(value.imageNo) || index + 1,
      prompt: readOutputString(value.prompt),
      purpose: readOutputString(value.purpose),
      ratio: readOutputString(value.ratio) || readOutputString(input.ratio),
      sortOrder: readOutputNumber(value.sortOrder),
      title: readOutputString(value.title) || `场景图片 ${index + 1}`,
    }];
  });
}

export type RestoredListingCopyImage = {
  image: GeneratedDetailImage;
  promptPlanId: string;
  taskId: string;
  updatedAt: number;
};

export type RestoredSingleImageRetryPatch = {
  image: GeneratedDetailImage;
  imageNo: number;
  parentTaskId?: string;
  preserveCompletedTargetOnFailure: boolean;
  retrySequence?: number;
  taskId: string;
  targetImageId: string;
  updatedAt: number;
};

export function createRestoredSingleImageRetryPatchFromTaskDetail(
  detail: GenerationTaskDetail,
  options: { includeIncomplete?: boolean } = {},
): RestoredSingleImageRetryPatch | null {
  const includeIncomplete = options.includeIncomplete ?? false;
  if (!isSingleImageRetryTaskDetail(detail) || (!includeIncomplete && detail.task.status !== "succeeded")) {
    return null;
  }
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  const items = Array.isArray(input.items) ? input.items : [];
  const item = items[0] && typeof items[0] === "object" ? (items[0] as Record<string, unknown>) : {};
  const targetImageId = readOutputString(item.imageId);
  const imageNo = readOutputNumber(item.imageNo);
  const parentTaskId = readOutputString(input.parentTaskId) || detail.task.retryOfTaskId;
  const retrySequence = readOutputNumber(input.retrySequence);
  const isSceneRetry = readOutputString(input.kind) === "scene-image-generation";
  const sceneCode = readOutputString(item.code);
  const itemTitle = readOutputString(item.title);
  const title = isSceneRetry && sceneCode && itemTitle
    ? `${sceneCode} ${itemTitle}`
    : itemTitle || detail.task.title.replace(/^重新生成\s*/, "") || "详情图";
  const outputAsset = [...detail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0];
  const src = outputAsset?.asset.url ?? outputAsset?.asset.localPath;
  if (!targetImageId || (!includeIncomplete && !src)) {
    return null;
  }
  const stale = isRestoredTaskStale(detail.task);
  const status =
    !includeIncomplete || (detail.task.status === "succeeded" && src)
      ? "complete"
      : stale || isTaskTerminal(detail.task.status)
        ? "failed"
        : "generating";

  return {
    targetImageId,
    imageNo,
    parentTaskId,
    preserveCompletedTargetOnFailure: isSceneRetry,
    retrySequence: retrySequence > 0 ? retrySequence : undefined,
    taskId: detail.task.id,
    updatedAt: dateTimeToTimestamp(detail.task.completedAt || detail.task.updatedAt || detail.task.createdAt),
    image: {
      id: targetImageId,
      assetId: outputAsset?.asset.id,
      assetLocalPath: outputAsset?.asset.localPath,
      assetRelativePath: outputAsset?.asset.relativePath,
      errorMessage: status === "failed"
        ? detail.task.error?.message || (isSceneRetry ? "场景图片重新生成失败。" : "服饰场景图重新生成失败。")
        : undefined,
      imageNo: imageNo || undefined,
      prompt: readOutputString(isSceneRetry ? item.prompt : item.imagePrompt) || undefined,
      referenceImages: readReferenceImagesFromTaskDetail(detail, input),
      sceneDescription: readOutputString(isSceneRetry ? item.purpose : item.sceneDescription) || undefined,
      src,
      status,
      title,
    },
  };
}

export function createRestoredListingCopyImageFromTaskDetail(detail: GenerationTaskDetail): RestoredListingCopyImage | null {
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  if (readOutputString(input.kind) !== "product-listing-copy") {
    return null;
  }
  const promptPlanId = readTaskPromptPlanId(detail);
  if (!promptPlanId) {
    return null;
  }
  const listingCopy = parseListingCopyOutput(detail.output);
  const status = listingCopy ? "complete" : isTaskTerminal(detail.task.status) ? "failed" : "generating";
  return {
    promptPlanId,
    taskId: detail.task.id,
    updatedAt: dateTimeToTimestamp(detail.task.updatedAt || detail.task.createdAt),
    image: {
      id: detail.task.id,
      kind: "listing-copy",
      groupId: readOutputString(input.groupId) || undefined,
      groupTitle: readOutputString(input.groupTitle) || undefined,
      listingCopy: listingCopy ?? undefined,
      errorMessage: listingCopy ? undefined : "上架文案结果缺少有效内容。",
      status,
      title: detail.task.title || "商品上架文案",
    },
  };
}

export function mergeRestoredSingleImageRetryPatches(
  records: GenerationRecord[],
  retryPatches: RestoredSingleImageRetryPatch[],
): GenerationRecord[] {
  if (retryPatches.length === 0) {
    return records;
  }

  return records.map((record) => {
    const relatedRetryTaskIds = retryPatches
      .filter((patch) => isRestoredRetryPatchScopedToRecord(record, patch))
      .map((patch) => patch.taskId);
    let images = record.images;
    const orderedRetryPatches = [...retryPatches].sort((left, right) => {
      if (left.retrySequence !== undefined && right.retrySequence !== undefined) {
        const retrySequenceDifference = left.retrySequence - right.retrySequence;
        if (retrySequenceDifference !== 0) {
          return retrySequenceDifference;
        }
      } else if (left.retrySequence !== undefined) {
        return 1;
      } else if (right.retrySequence !== undefined) {
        return -1;
      }
      return left.updatedAt - right.updatedAt;
    });
    for (const patch of orderedRetryPatches) {
      const relatedByParentTask = isRestoredRetryPatchScopedToRecord(record, patch);
      const exactMatchIndex = images.findIndex((image) => restoredImageMatchesRetryTarget(image, patch));
      const imageNoMatchIndex =
        exactMatchIndex >= 0 || patch.imageNo <= 0 || !relatedByParentTask
          ? -1
          : images.findIndex((image) => image.kind !== "source-image" && image.kind !== "listing-copy" && image.imageNo === patch.imageNo);
      const targetIndex = exactMatchIndex >= 0 ? exactMatchIndex : imageNoMatchIndex;
      if (targetIndex < 0) {
        continue;
      }
      images = images.map((image, index) =>
        index === targetIndex
          ? patch.image.status === "complete"
            ? {
                ...image,
                assetId: patch.image.assetId ?? image.assetId,
                assetLocalPath: patch.image.assetLocalPath ?? image.assetLocalPath,
                assetRelativePath: patch.image.assetRelativePath ?? image.assetRelativePath,
                errorMessage: undefined,
                prompt: patch.image.prompt || image.prompt,
                referenceImages: patch.image.referenceImages?.length ? patch.image.referenceImages : image.referenceImages,
                sceneDescription: patch.image.sceneDescription || image.sceneDescription,
                src: patch.image.src,
                status: "complete",
                title: patch.image.title || image.title,
              }
            : patch.image.status === "failed" &&
                patch.preserveCompletedTargetOnFailure &&
                image.status === "complete" &&
                image.src
              ? image
              : {
                  ...image,
                  assetId: undefined,
                  assetLocalPath: undefined,
                  assetRelativePath: undefined,
                  errorMessage: patch.image.errorMessage,
                  prompt: patch.image.prompt || image.prompt,
                  referenceImages: patch.image.referenceImages?.length ? patch.image.referenceImages : image.referenceImages,
                  sceneDescription: patch.image.sceneDescription || image.sceneDescription,
                  src: undefined,
                  status: patch.image.status,
                  title: patch.image.title || image.title,
                }
          : image,
      );
    }

    return images === record.images && relatedRetryTaskIds.length === 0
      ? record
      : {
          ...record,
          images,
          relatedTaskIds: Array.from(
            new Set([
              ...(record.relatedTaskIds ?? []),
              ...relatedRetryTaskIds,
            ]),
          ),
          status: images === record.images ? record.status : deriveProductGenerationRecordStatus(images),
        };
  });
}

export function restoredImageMatchesRetryTarget(image: GeneratedDetailImage, patch: RestoredSingleImageRetryPatch) {
  return image.id === patch.targetImageId || image.id.endsWith(`:${patch.targetImageId}`);
}

function isRestoredRetryPatchScopedToRecord(record: GenerationRecord, patch: RestoredSingleImageRetryPatch) {
  if (patch.parentTaskId) {
    return record.persistedTaskId === patch.parentTaskId;
  }
  if (!record.persistedTaskId) {
    return false;
  }
  return (
    patch.targetImageId.startsWith(`${record.persistedTaskId}-`) ||
    patch.targetImageId.startsWith(`${record.persistedTaskId}:`)
  );
}

export function mergeRestoredListingCopyImages(
  records: GenerationRecord[],
  listingCopyImages: RestoredListingCopyImage[],
): GenerationRecord[] {
  if (listingCopyImages.length === 0) {
    return records;
  }

  return records.map((record) => {
    const listingCopiesForRecord = listingCopyImages.filter((item) => item.promptPlanId === record.promptPlanId);
    const latestListingCopyByGroup = listingCopiesForRecord.reduce((latestByGroup, item) => {
        const groupKey = `${item.image.groupId ?? "__ungrouped"}:${item.image.groupTitle ?? ""}`;
        const existing = latestByGroup.get(groupKey);
        if (!existing || item.updatedAt >= existing.updatedAt) {
          latestByGroup.set(groupKey, item);
        }
        return latestByGroup;
      }, new Map<string, RestoredListingCopyImage>());
    const relatedListingCopies = Array.from(latestListingCopyByGroup.values()).map((item) => item.image);
    const relatedListingCopyTaskIds = listingCopiesForRecord.map((item) => item.taskId);
    if (relatedListingCopies.length === 0) {
      return record;
    }
    const images = [...record.images, ...relatedListingCopies];
    return {
      ...record,
      images,
      relatedTaskIds: Array.from(new Set([...(record.relatedTaskIds ?? []), ...relatedListingCopyTaskIds])),
      status: deriveProductGenerationRecordStatus(images),
    };
  });
}

export function isSingleImageRetryTaskDetail(detail: GenerationTaskDetail) {
  return detail.task.title.startsWith("重新生成 ") || readTaskPromptPlanId(detail).startsWith("retry-");
}

function readTaskPromptPlanId(detail: GenerationTaskDetail) {
  return detail.task.promptPlanId || readPromptPlanSnapshotId(detail.promptPlanSnapshot);
}

function deletedResultSortOrders(detail: GenerationTaskDetail) {
  return new Set(
    detail.events.flatMap((event) => {
      if (event.eventType !== "task.result-image-deleted" || !event.detail || typeof event.detail !== "object") {
        return [];
      }
      const sortOrder = (event.detail as Record<string, unknown>).sortOrder;
      return typeof sortOrder === "number" && Number.isInteger(sortOrder) && sortOrder >= 0 ? [sortOrder] : [];
    }),
  );
}

function restoreGeneratedDetailImages(
  detail: GenerationTaskDetail,
  options: { referenceImages?: GeneratedReferenceImage[]; stale?: boolean } = {},
): GeneratedDetailImage[] {
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  const inputItems = Array.isArray(input.items) ? input.items : [];
  const planItems = readPromptPlanSnapshotItems(detail.promptPlanSnapshot);
  const outputAssetBySortOrder = new Map(detail.outputAssets.map((item) => [item.sortOrder, item] as const));
  const deletedSortOrders = deletedResultSortOrders(detail);
  const itemCount = Math.max(planItems.length, ...detail.outputAssets.map((item) => item.sortOrder + 1));
  const shouldFailMissingOutput = options.stale || isTaskTerminal(detail.task.status);

  const restoredImages = Array.from({ length: itemCount }, (_, index): GeneratedDetailImage | null => {
    if (deletedSortOrders.has(index)) {
      return null;
    }
    const planItem = planItems[index];
    const inputItem = inputItems[index] && typeof inputItems[index] === "object"
      ? (inputItems[index] as Record<string, unknown>)
      : {};
    const outputAsset = outputAssetBySortOrder.get(index);
    const displayTitle = planItem?.title || `详情图 ${index + 1}`;
    const imageId =
      readOutputString(inputItem.imageId) || createRestoredDetailImageId(detail.task.id, planItem?.id, index);
    if (outputAsset?.asset.url || outputAsset?.asset.localPath) {
      return {
        assetId: outputAsset.asset.id,
        assetLocalPath: outputAsset.asset.localPath,
        assetRelativePath: outputAsset.asset.relativePath,
        id: imageId,
        groupId: planItem?.groupId,
        groupTitle: planItem?.groupTitle,
        height: outputAsset.asset.height,
        prompt: planItem?.imagePrompt,
        ratio: planItem?.ratio,
        imageNo: planItem?.imageNo ?? index + 1,
        referenceImages: options.referenceImages,
        sceneDescription: planItem?.sceneDescription,
        src: outputAsset.asset.url ?? outputAsset.asset.localPath,
        status: "complete" as const,
        title: displayTitle,
        width: outputAsset.asset.width,
      };
    }

    return {
      errorMessage: options.stale ? "生成中断" : detail.task.error?.message || "生成结果缺少可展示图片。",
      id: imageId,
      groupId: planItem?.groupId,
      groupTitle: planItem?.groupTitle,
      imageNo: planItem?.imageNo ?? index + 1,
      prompt: planItem?.imagePrompt,
      ratio: planItem?.ratio,
      referenceImages: options.referenceImages,
      sceneDescription: planItem?.sceneDescription,
      status: shouldFailMissingOutput ? ("failed" as const) : ("generating" as const),
      title: displayTitle,
    };
  }).filter((image): image is GeneratedDetailImage => image !== null);

  return prependRestoredSourceImageCards(detail.task.id, restoredImages, options.referenceImages ?? []);
}

function readPromptPlanSnapshotItems(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }
  const items = (snapshot as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => {
    const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const intent = value.intent && typeof value.intent === "object" ? (value.intent as Record<string, unknown>) : {};
    return {
      groupId: readOutputString(intent.groupId) || readOutputString(value.groupId),
      id: readOutputString(value.id),
      groupTitle: readOutputString(intent.groupTitle) || readOutputString(value.groupTitle),
      imageNo: readOutputNumber(intent.imageNo) || readOutputNumber(value.imageNo) || index + 1,
      imagePrompt: readOutputString(intent.imagePrompt),
      ratio: readOutputString(intent.ratio) || readOutputString(value.ratio),
      sceneDescription: readOutputString(intent.sceneDescription) || readOutputString(value.displaySummary),
      title: readOutputString(value.title) || `详情图 ${index + 1}`,
    };
  });
}

function createRestoredDetailImageId(taskId: string, planItemId: string | undefined, index: number) {
  const itemId = planItemId || `${index}`;
  if (itemId.startsWith(`${taskId}:`) || itemId.startsWith(`${taskId}-`)) {
    return itemId;
  }
  return `${taskId}:${itemId}`;
}

function readPromptPlanSnapshotId(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") {
    return "";
  }
  return readOutputString((snapshot as Record<string, unknown>).planId);
}

function prependRestoredSourceImageCards(
  taskId: string,
  images: GeneratedDetailImage[],
  referenceImages: GeneratedReferenceImage[],
) {
  const sourceImages = createRestoredSourceImages(referenceImages);
  if (sourceImages.length === 0 || images.length === 0) {
    return images;
  }

  const groupIds = images
    .map((image) => image.groupId)
    .filter((groupId): groupId is string => Boolean(groupId));
  if (groupIds.length === 0) {
    return [
      {
        id: `${taskId}-source`,
        kind: "source-image" as const,
        sourceImages,
        status: "complete" as const,
        title: "原图",
      },
      ...images,
    ];
  }

  const insertedGroupIds = new Set<string>();
  const nextImages: GeneratedDetailImage[] = [];
  for (const image of images) {
    const groupId = image.groupId;
    if (groupId && !insertedGroupIds.has(groupId)) {
      nextImages.push({
        id: `${taskId}-${groupId}-source`,
        kind: "source-image" as const,
        groupId,
        groupTitle: image.groupTitle,
        sourceImages,
        status: "complete" as const,
        title: "原图",
      });
      insertedGroupIds.add(groupId);
    }
    nextImages.push(image);
  }

  return nextImages;
}

function createRestoredSourceImages(referenceImages: GeneratedReferenceImage[]): ProductImageAsset[] {
  return referenceImages.map((image, index) => {
    const name = image.originalName || `原图 ${index + 1}`;
    return {
      assetId: image.assetId,
      id: `restored-source-${index}-${name}`,
      name,
      path: name,
      src: image.dataUrl ?? image.src ?? "",
      aiAssistDataUrl: image.dataUrl,
      aiAssistMimeType: image.mimeType,
    };
  });
}

function createRestoredProductHistorySummary(input: Record<string, unknown>) {
  const platform = readOutputString(input.platform) || "商品";
  const market = readOutputString(input.market);
  const language = readOutputString(input.language);
  const productSellingPoints = readOutputString(input.productSellingPoints);
  return [platform, market, language, productSellingPoints].filter(Boolean).join(" · ");
}

type RestoredClothingGenerationInputItem = {
  id: string;
  imageId: string;
  poseAction: string;
  ratio: string;
  scene: string;
  sceneVisualAnchor: string;
};

function readClothingGenerationInputItems(input: Record<string, unknown>): RestoredClothingGenerationInputItem[] {
  const items = Array.isArray(input.items) ? input.items : [];
  return items.map((item, index) => {
    const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: readOutputString(value.id) || `clothing-scene-${index + 1}`,
      imageId: readOutputString(value.imageId),
      poseAction: readOutputString(value.poseAction),
      ratio: readOutputString(value.ratio),
      scene: readOutputString(value.scene),
      sceneVisualAnchor: readOutputString(value.sceneVisualAnchor),
    };
  });
}

function createRestoredClothingHistorySummary(input: Record<string, unknown>, images: GeneratedDetailImage[]) {
  const scenes = Array.from(
    new Set(readClothingGenerationInputItems(input).map((item) => item.scene).filter(Boolean)),
  );
  const sceneSummary = scenes.length > 0 ? scenes.slice(0, 2).join("、") : "服饰场景";
  const ratio = readOutputString(input.ratio);
  const imageCount = images.filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy").length;
  return [sceneSummary, ratio, `${imageCount} 张`].filter(Boolean).join(" · ");
}

function generationTaskStatusToRecordStatus(status: GenerationTaskDetail["task"]["status"]): GenerationRecord["status"] {
  if (status === "succeeded") {
    return "complete";
  }
  if (status === "failed" || status === "cancelled" || status === "interrupted") {
    return "failed";
  }
  return "generating";
}

function restoredGenerationTaskStatus(
  detail: GenerationTaskDetail,
  images: GeneratedDetailImage[],
  stale: boolean,
): GenerationRecord["status"] {
  const resultImages = images.filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy");
  if (!stale && !isTaskTerminal(detail.task.status)) {
    return generationTaskStatusToRecordStatus(detail.task.status);
  }
  if (resultImages.length > 0) {
    return deriveProductGenerationRecordStatus(resultImages);
  }
  if (stale) {
    return "failed";
  }
  return generationTaskStatusToRecordStatus(detail.task.status);
}

export function isRestoredTaskStale(task: GenerationTaskDetail["task"]) {
  if (isTaskTerminal(task.status)) {
    return false;
  }
  const updatedAt = dateTimeToTimestamp(task.updatedAt || task.createdAt);
  return Date.now() - updatedAt > restoredRunningTaskStaleMs;
}

function dateTimeToTimestamp(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function mergeGenerationRecords(currentRecords: GenerationRecord[], restoredRecords: GenerationRecord[]) {
  const currentIds = new Set(currentRecords.map((record) => record.id));
  const mergedRecords = [
    ...currentRecords,
    ...restoredRecords.filter((record) => !currentIds.has(record.id)),
  ];
  return mergedRecords.sort((left, right) => right.createdAt - left.createdAt);
}
