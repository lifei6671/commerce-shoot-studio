import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import { StudioToolbar } from "./components/StudioToolbar";
import { NavigationRail } from "./components/NavigationRail";
import {
  defaultProductGenerationSettings,
  GenerationConfigPanel,
} from "../features/generation/components/GenerationConfigPanel";
import type {
  ProductGenerationSettings,
  StrategyModuleDraft,
  StrategyModulePromptPlanItem,
  ViralStyleAnalysisResult,
} from "../features/generation/components/GenerationConfigPanel";
import {
  PreviewCanvas,
  type GeneratedDetailImage,
  type GeneratedReferenceImage,
  type ProductListingCopy,
} from "../features/generation/components/PreviewCanvas";
import {
  ClothingConfigPanel,
  ClothingSceneSelectionPanel,
  defaultClothingConfig,
} from "../features/clothing/components/ClothingConfigPanel";
import type { ClothingConfigState, ClothingSceneDraft } from "../features/clothing/components/ClothingConfigPanel";
import { ClothingPreviewCanvas } from "../features/clothing/components/ClothingPreviewCanvas";
import {
  GenerationHistoryPopover,
  type GenerationRecord,
} from "../features/history/components/GenerationHistoryPopover";
import { SceneConfigPanel } from "../features/scenes/components/SceneConfigPanel";
import { ScenePreviewCanvas } from "../features/scenes/components/ScenePreviewCanvas";
import { ScenePromptReviewPanel } from "../features/scenes/components/ScenePromptReviewPanel";
import {
  createSceneImagePlans,
  defaultSceneConfig,
  type SceneConfigState,
  type SceneImagePlan,
} from "../features/scenes/lib/sceneImagePlan";
import { ModelConfigPage } from "../features/model-config/components/ModelConfigPage";
import { SettingsPage } from "../features/settings/components/SettingsPage";
import { moduleOptions, navItems, previewBoards } from "./studioData";
import type { ProductImageAsset } from "../features/generation/lib/productImagePicker";
import { localAssetPort } from "../runtime/local/assets";
import { localGenerationPort } from "../runtime/local/generation";
import type { GenerationTaskDetail, GenerationTaskInputAssetInput } from "../runtime";

const generationCompleteDelayMs = 3000;
const productGenerationPollIntervalMs = 800;
const productGenerationMaxQueuedPollCount = 15;
const productGenerationMaxUnchangedPollCount = 120;
const restoredRunningTaskStaleMs = 10 * 60 * 1000;
const scenePlanDraftDelayMs = 2500;

function createDefaultProductGenerationSettings(): ProductGenerationSettings {
  return {
    ...defaultProductGenerationSettings,
    advancedFormats: [...defaultProductGenerationSettings.advancedFormats],
  };
}

function createDefaultProductModules() {
  return moduleOptions.map((module) => ({ ...module }));
}

type ProductGenerationInputSnapshot = {
  productImages: ProductImageAsset[];
  productPrompt: string;
  settings: ProductGenerationSettings;
};

function createProductGenerationInputSnapshot(
  settings: ProductGenerationSettings,
  productPrompt: string,
  productImages: ProductImageAsset[],
): ProductGenerationInputSnapshot {
  return {
    productImages: productImages.map((image) => ({ ...image })),
    productPrompt,
    settings: {
      ...settings,
      advancedFormats: [...settings.advancedFormats],
    },
  };
}

function createProductListingCopyPrompt(input: {
  designSpec: string;
  groupTitle?: string;
  language: string;
  market: string;
  platform: string;
  productSellingPoints: string;
}) {
  const systemPrompt =
    "你是专业电商商品上架文案助手。只基于用户提供的商品卖点和设计规范写文案，不编造品牌、价格、销量、认证或未提供参数。必须只输出一个合法 JSON 对象。";
  const userPrompt = [
    `目标平台：${input.platform}`,
    `目标市场：${input.market}`,
    `目标语言：${input.language}`,
    input.groupTitle ? `风格分组：${input.groupTitle}` : "",
    `商品卖点：${input.productSellingPoints || "未提供商品卖点"}`,
    `设计规范：\n${input.designSpec || "未提供设计规范"}`,
    "输出要求：只输出一个 JSON 对象，不要输出 Markdown、代码块、解释、前后缀文本或多余字段。",
    "字段必须严格包含 title, sellingPoints, promotionBenefits, detailCopy, searchKeywords, attributeWords, mainImageGuidance。",
    "字段类型要求：title 和 detailCopy 必须是非空字符串；sellingPoints、promotionBenefits、searchKeywords、attributeWords、mainImageGuidance 必须是字符串数组。",
    "JSON 示例结构：{\"title\":\"商品标题\",\"sellingPoints\":[\"卖点1\"],\"promotionBenefits\":[\"利益点1\"],\"detailCopy\":\"详情页文案\",\"searchKeywords\":[\"搜索词\"],\"attributeWords\":[\"属性词\"],\"mainImageGuidance\":[\"主图指引\"]}",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    rolelessPrompt: `【应用规则】\n${systemPrompt}\n\n【用户任务】\n${userPrompt}`,
  };
}

function createDefaultClothingConfig(): ClothingConfigState {
  return {
    ...defaultClothingConfig,
    clothingImages: [],
    modelImages: [],
    sceneIds: [...defaultClothingConfig.sceneIds],
  };
}

function createDefaultSceneConfig(): SceneConfigState {
  return {
    ...defaultSceneConfig,
    referenceImages: [],
  };
}

export function App() {
  const [activeWorkspace, setActiveWorkspace] = useState("product");
  const [productImages, setProductImages] = useState<ProductImageAsset[]>([]);
  const [productGenerationSettings, setProductGenerationSettings] = useState(createDefaultProductGenerationSettings);
  const [productGenerationSettingsTouched, setProductGenerationSettingsTouched] = useState(false);
  const [productModules, setProductModules] = useState(createDefaultProductModules);
  const [productPrompt, setProductPrompt] = useState("");
  const [selectedProductViralStyles, setSelectedProductViralStyles] = useState<ViralStyleAnalysisResult[]>([]);
  const [productStrategyDrafting, setProductStrategyDrafting] = useState(false);
  const [productDetailImages, setProductDetailImages] = useState<GeneratedDetailImage[]>([]);
  const [productDetailGenerating, setProductDetailGenerating] = useState(false);
  const [clothingConfig, setClothingConfig] = useState(createDefaultClothingConfig);
  const [clothingSceneDrafting, setClothingSceneDrafting] = useState(false);
  const [clothingSceneImages, setClothingSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [clothingSceneGenerating, setClothingSceneGenerating] = useState(false);
  const [sceneConfig, setSceneConfig] = useState(createDefaultSceneConfig);
  const [scenePromptReviewing, setScenePromptReviewing] = useState(false);
  const [scenePlanGenerating, setScenePlanGenerating] = useState(false);
  const [sceneImagePlans, setSceneImagePlans] = useState<SceneImagePlan[]>([]);
  const [sceneImages, setSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [sceneImageGenerating, setSceneImageGenerating] = useState(false);
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const [activeGenerationRecordId, setActiveGenerationRecordId] = useState<string | null>(null);
  const [historyViewingRecordId, setHistoryViewingRecordId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [productGeneratingRecordId, setProductGeneratingRecordId] = useState<string | null>(null);
  const [clothingGeneratingRecordId, setClothingGeneratingRecordId] = useState<string | null>(null);
  const activeGenerationRecordIdRef = useRef<string | null>(null);
  const historyViewingRecordIdRef = useRef<string | null>(null);
  const deletedGenerationRecordIdsRef = useRef(new Set<string>());
  const isClothingWorkspace = activeWorkspace === "clothing";
  const isModelWorkspace = activeWorkspace === "model";
  const isSceneWorkspace = activeWorkspace === "scene";
  const isSettingsWorkspace = activeWorkspace === "settings";
  const historyViewingRecord = historyViewingRecordId
    ? generationRecords.find((record) => record.id === historyViewingRecordId)
    : null;
  const isGenerationResultViewing =
    historyViewingRecordId !== null &&
    activeGenerationRecordId === historyViewingRecordId &&
    historyViewingRecord?.status !== "generating" &&
    ((activeWorkspace === "product" && productDetailImages.length > 0) ||
      (activeWorkspace === "clothing" && clothingSceneImages.length > 0));
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  useEffect(() => {
    activeGenerationRecordIdRef.current = activeGenerationRecordId;
  }, [activeGenerationRecordId]);

  useEffect(() => {
    historyViewingRecordIdRef.current = historyViewingRecordId;
  }, [historyViewingRecordId]);

  function handleProductGenerationSettingsChange(settings: typeof productGenerationSettings) {
    setProductGenerationSettings(settings);
    setProductGenerationSettingsTouched(true);
  }

  function clearActiveGenerationRecordForWorkspace(workspace: "clothing" | "product") {
    if (!activeGenerationRecordId) {
      return;
    }

    const activeRecord = generationRecords.find((record) => record.id === activeGenerationRecordId);
    if (activeRecord?.workspace === workspace) {
      setActiveGenerationRecordId(null);
    }
  }

  function resetProductWorkspace() {
    setProductImages([]);
    setProductGenerationSettings(createDefaultProductGenerationSettings());
    setProductGenerationSettingsTouched(false);
    setProductModules(createDefaultProductModules());
    setProductPrompt("");
    setSelectedProductViralStyles([]);
    setProductStrategyDrafting(false);
    setProductDetailImages([]);
    setProductDetailGenerating(false);
    setProductGeneratingRecordId(null);
    setHistoryOpen(false);
    setHistoryViewingRecordId(null);
    clearActiveGenerationRecordForWorkspace("product");
  }

  function resetClothingWorkspace() {
    setClothingConfig(createDefaultClothingConfig());
    setClothingSceneDrafting(false);
    setClothingSceneImages([]);
    setClothingSceneGenerating(false);
    setClothingGeneratingRecordId(null);
    setHistoryOpen(false);
    setHistoryViewingRecordId(null);
    clearActiveGenerationRecordForWorkspace("clothing");
  }

  function resetSceneWorkspace() {
    setSceneConfig(createDefaultSceneConfig());
    setScenePromptReviewing(false);
    setScenePlanGenerating(false);
    setSceneImagePlans([]);
    setSceneImages([]);
    setSceneImageGenerating(false);
    setHistoryOpen(false);
    setHistoryViewingRecordId(null);
  }

  function handleNewTask() {
    if (activeWorkspace === "product") {
      resetProductWorkspace();
      return;
    }

    if (activeWorkspace === "clothing") {
      resetClothingWorkspace();
      return;
    }

    if (activeWorkspace === "scene") {
      resetSceneWorkspace();
    }
  }

  function handleModuleCheckedChange(moduleId: string, checked: boolean) {
    setProductModules((currentModules) =>
      currentModules.map((module) => (module.id === moduleId ? { ...module, checked } : module)),
    );
  }

  function handleGenerateDetails(drafts: StrategyModuleDraft[]) {
    const recordId = createGenerationRecordId("product");
    const inputSnapshot = createProductGenerationInputSnapshot(
      productGenerationSettings,
      productPrompt,
      productImages,
    );
    const activeViralStyles = inputSnapshot.settings.viralStyleAnalysisEnabled ? selectedProductViralStyles : [];
    const resultItems =
      activeViralStyles.length > 0
        ? activeViralStyles.flatMap((style, styleIndex) => {
            const groupId = `${recordId}-${createResultGroupSlug(style.title)}`;
            const images: GeneratedDetailImage[] = drafts.map((draft, draftIndex) => {
              const imagePlan = createProductDetailImagePlan(
                draft,
                inputSnapshot.settings,
                inputSnapshot.productPrompt,
                style,
              );
              return {
                copyRequirements: imagePlan.copyRequirements,
                coreImagePrompt: imagePlan.coreImagePrompt,
                designSpec: imagePlan.designSpec,
                groupId,
                groupTitle: style.title,
                id: `${groupId}-${draft.id}`,
                imageNo: styleIndex * drafts.length + draftIndex + 1,
                imageType: imagePlan.imageType,
                prompt: imagePlan.imagePrompt,
                sceneDescription: imagePlan.sceneDescription,
                status: "generating" as const,
                title: draft.title,
                visualConsistency: imagePlan.visualConsistency,
              };
            });
            const sourceImage: GeneratedDetailImage = {
              groupId,
              groupTitle: style.title,
              id: `${groupId}-source`,
              kind: "source-image" as const,
              sourceImages: inputSnapshot.productImages,
              status: "complete" as const,
              title: "原图",
            };
            const listingCopy: GeneratedDetailImage[] = inputSnapshot.settings.listingCopyGenerationEnabled
              ? [
                  {
                    groupId,
                    groupTitle: style.title,
                    id: `${groupId}-listing-copy`,
                    kind: "listing-copy" as const,
                    listingCopy: createProductListingCopy(`${style.title} ${inputSnapshot.productPrompt}`),
                    status: "generating" as const,
                    title: "商品上架文案",
                  },
                ]
              : [];

            return [sourceImage, ...images, ...listingCopy];
          })
        : createFlatProductResultItems(
            recordId,
            drafts,
            inputSnapshot.settings.listingCopyGenerationEnabled,
            inputSnapshot.settings,
            inputSnapshot.productPrompt,
            inputSnapshot.productImages,
          );
    const record: GenerationRecord = {
      createdAt: Date.now(),
      id: recordId,
      images: resultItems,
      inputSummary: createProductHistorySummary(
        inputSnapshot.settings,
        resultItems.filter((image) => image.kind !== "source-image").length,
      ),
      kind: "product-detail",
      promptPlanId: `local-${recordId}`,
      status: "generating",
      title: "商品详情图",
      workspace: "product",
    };

    deletedGenerationRecordIdsRef.current.delete(recordId);
    setGenerationRecords((currentRecords) => [record, ...currentRecords]);
    setActiveGenerationRecordId(recordId);
    setHistoryViewingRecordId(null);
    setProductGeneratingRecordId(recordId);
    setProductDetailImages(resultItems);
    setProductDetailGenerating(true);
    setHistoryOpen(false);
    void runProductDetailGeneration(recordId, drafts, resultItems, inputSnapshot);
  }

  async function runProductDetailGeneration(
    recordId: string,
    drafts: StrategyModuleDraft[],
    resultItems: GeneratedDetailImage[],
    inputSnapshot: ProductGenerationInputSnapshot,
  ) {
    let latestImages = resultItems;
    const publishImages = (nextImages: GeneratedDetailImage[], status: GenerationRecord["status"] = "generating") => {
      latestImages = nextImages;
      completeProductGenerationRecord(recordId, latestImages, status);
    };

    try {
      const taskIds = await persistProductDetailGenerationTask(recordId, drafts, resultItems, inputSnapshot);
      const createdTaskIds = [
        taskIds.imageTaskId,
        ...taskIds.listingTasks.map((task) => task.taskId),
      ];
      if (deletedGenerationRecordIdsRef.current.has(recordId)) {
        deletePersistedGenerationTasks(createdTaskIds);
        return;
      }
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === recordId
            ? {
                ...record,
                persistedTaskId: taskIds.imageTaskId,
                relatedTaskIds: createdTaskIds,
              }
            : record,
        ),
      );
      console.info("product detail generation tasks created", {
        imageTaskId: taskIds.imageTaskId,
        listingTaskIds: taskIds.listingTasks.map((task) => task.taskId),
        recordId,
      });
      const imageTask = startCreatedGenerationTask(taskIds.imageTaskId, recordId)
        .then(() => pollProductImageTask(taskIds.imageTaskId, () => latestImages, publishImages))
        .catch((error) => {
          const message = error instanceof Error ? error.message : "商品详情图生成失败。";
          publishImages(failProductImageOutputs(latestImages, message));
          console.error("product detail image task failed", error);
        });
      const listingTasks = runListingCopyTasksWithLimit(
        taskIds.listingTasks,
        recordId,
        () => latestImages,
        publishImages,
      );
      await Promise.all([imageTask, listingTasks]);

      publishImages(latestImages, deriveProductGenerationRecordStatus(latestImages));
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品详情图生成失败。";
      const failedImages = failGeneratedImages(latestImages, message);
      publishImages(failedImages, "failed");
      console.error("run product detail generation failed", error);
    } finally {
      setProductDetailGenerating(false);
      setProductGeneratingRecordId(null);
    }
  }

  async function startCreatedGenerationTask(taskId: string, recordId: string) {
    const startResult = await requestGenerationTaskStart(taskId, "任务未能按当前记录启动，请稍后重试。");
    console.info("product detail generation worker start", {
      recordId,
      startResult,
      taskId,
    });
  }

  async function requestGenerationTaskStart(taskId: string, mismatchMessage: string) {
    const startResult = await localGenerationPort.runTask(taskId);
    if (startResult && startResult.taskId !== taskId) {
      throw new Error(mismatchMessage);
    }
    return startResult;
  }

  async function runListingCopyTasksWithLimit(
    listingTasks: Array<{ imageId: string; taskId: string }>,
    recordId: string,
    getLatestImages: () => GeneratedDetailImage[],
    publishImages: (images: GeneratedDetailImage[], status?: GenerationRecord["status"]) => void,
  ) {
    const pendingTasks = [...listingTasks];
    const workerCount = Math.min(3, pendingTasks.length);
    const workers = Array.from({ length: workerCount }, async () => {
      for (;;) {
        const listingTask = pendingTasks.shift();
        if (!listingTask) {
          return;
        }
        try {
          await startCreatedGenerationTask(listingTask.taskId, recordId);
          await pollListingCopyTask(listingTask.taskId, listingTask.imageId, getLatestImages, publishImages);
        } catch (error) {
          const message = error instanceof Error ? error.message : "上架文案生成失败。";
          publishImages(failListingCopyOutput(getLatestImages(), listingTask.imageId, message));
          console.error("product listing copy task failed", error);
        }
      }
    });
    await Promise.all(workers);
  }

  async function pollProductImageTask(
    taskId: string,
    getLatestImages: () => GeneratedDetailImage[],
    publishImages: (images: GeneratedDetailImage[], status?: GenerationRecord["status"]) => void,
  ) {
    let lastPollSignature = "";
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    for (;;) {
      const imageTaskDetail = await localGenerationPort.getTaskDetail(taskId);
      const final = isTaskTerminal(imageTaskDetail.task.status);
      const nextImages = applyGeneratedAssetOutputs(getLatestImages(), imageTaskDetail, { final });
      const pollSignature = createTaskPollSignature(imageTaskDetail);
      if (pollSignature !== lastPollSignature) {
        console.info("product detail image task poll", {
          outputAssetCount: imageTaskDetail.outputAssets.length,
          stage: imageTaskDetail.task.stage,
          status: imageTaskDetail.task.status,
          taskId,
        });
        lastPollSignature = pollSignature;
        unchangedPollCount = 0;
      } else {
        unchangedPollCount += 1;
      }
      queuedPollCount = imageTaskDetail.task.status === "queued" ? queuedPollCount + 1 : 0;
      publishImages(nextImages);
      if (imageTaskDetail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "任务未能按当前记录启动，请稍后重试。");
      }
      if (imageTaskDetail.task.status === "failed" && imageTaskDetail.outputAssets.length === 0) {
        console.error("product detail image task failed without persisted assets", {
          error: imageTaskDetail.task.error,
          events: imageTaskDetail.events,
          stage: imageTaskDetail.task.stage,
          status: imageTaskDetail.task.status,
          taskId,
        });
        throw new Error(imageTaskDetail.task.error?.message ?? "商品详情图生成失败。");
      }
      if (final && imageTaskDetail.outputAssets.length === 0) {
        console.error("product detail image task completed without persisted assets", {
          error: imageTaskDetail.task.error,
          events: imageTaskDetail.events,
          stage: imageTaskDetail.task.stage,
          status: imageTaskDetail.task.status,
          taskId,
        });
      }
      if (final) {
        return;
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        console.warn("product detail image task stayed queued", {
          outputAssetCount: imageTaskDetail.outputAssets.length,
          stage: imageTaskDetail.task.stage,
          status: imageTaskDetail.task.status,
          taskId,
        });
        throw new Error("商品详情图任务长时间未启动，请检查后台任务执行状态。");
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        console.warn("product detail image task stalled", {
          outputAssetCount: imageTaskDetail.outputAssets.length,
          stage: imageTaskDetail.task.stage,
          status: imageTaskDetail.task.status,
          taskId,
        });
        throw new Error("商品详情图生成长时间无进展，请检查模型配置或后台任务日志。");
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  async function pollListingCopyTask(
    taskId: string,
    imageId: string,
    getLatestImages: () => GeneratedDetailImage[],
    publishImages: (images: GeneratedDetailImage[], status?: GenerationRecord["status"]) => void,
  ) {
    let lastPollSignature = "";
    let unchangedPollCount = 0;
    for (;;) {
      const listingTaskDetail = await localGenerationPort.getTaskDetail(taskId);
      const pollSignature = createTaskPollSignature(listingTaskDetail);
      if (pollSignature !== lastPollSignature) {
        console.info("product listing copy task poll", {
          hasOutput: Boolean(listingTaskDetail.output),
          stage: listingTaskDetail.task.stage,
          status: listingTaskDetail.task.status,
          taskId,
        });
        lastPollSignature = pollSignature;
        unchangedPollCount = 0;
      } else {
        unchangedPollCount += 1;
      }
      if (listingTaskDetail.output) {
        const nextImages = applyListingCopyOutput(getLatestImages(), imageId, listingTaskDetail.output);
        publishImages(nextImages);
      }
      if (listingTaskDetail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "上架文案任务未能按当前记录启动，请稍后重试。");
      }
      if (isTaskTerminal(listingTaskDetail.task.status)) {
        if (listingTaskDetail.task.status === "failed" && !listingTaskDetail.output) {
          const nextImages = failListingCopyOutput(
            getLatestImages(),
            imageId,
            listingTaskDetail.task.error?.message ?? "上架文案生成失败。",
          );
          publishImages(nextImages);
        }
        return;
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        console.warn("product listing copy task stalled", {
          hasOutput: Boolean(listingTaskDetail.output),
          stage: listingTaskDetail.task.stage,
          status: listingTaskDetail.task.status,
          taskId,
        });
        const nextImages = failListingCopyOutput(getLatestImages(), imageId, "上架文案生成长时间无进展。");
        publishImages(nextImages);
        return;
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  async function persistProductDetailGenerationTask(
    recordId: string,
    drafts: StrategyModuleDraft[],
    resultItems: GeneratedDetailImage[],
    inputSnapshot: ProductGenerationInputSnapshot,
  ): Promise<{ imageTaskId: string; listingTasks: Array<{ imageId: string; taskId: string }> }> {
    const imageItems = resultItems.filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy");
    const inputAssets = await importProductInputAssets(inputSnapshot.productImages, "source");
    const generationItems = imageItems.map((image, index) => {
      const draft = drafts.find((item) => image.id.endsWith(`-${item.id}`)) ?? drafts[index % Math.max(drafts.length, 1)];
      return {
        copyRequirements: image.copyRequirements ?? image.sceneDescription ?? draft?.content ?? "",
        designSpec: image.designSpec ?? "",
        imageId: image.id,
        imageNo: image.imageNo ?? index + 1,
        imageType: image.imageType ?? `${image.title}: ${draft?.description ?? image.sceneDescription ?? ""}`,
        imagePrompt: image.coreImagePrompt ?? image.prompt ?? "",
        moduleId: draft?.id ?? image.id,
        title: image.title,
        groupId: image.groupId,
        groupTitle: image.groupTitle,
        sceneDescription: image.sceneDescription ?? draft?.content ?? image.prompt ?? "",
        ratio:
          inputSnapshot.settings.advancedFormats.length > 0
            ? inputSnapshot.settings.advancedFormats.join("、")
            : inputSnapshot.settings.format,
        sortOrder: index,
        visualConsistency: image.visualConsistency ?? {},
      };
    });
    const promptPlanSnapshot = {
      planId: `local-${recordId}`,
      workspace: "product",
      userEditableSummary: inputSnapshot.productPrompt,
      resolverVersion: "product-detail-local-v1",
      templateVersion: "product-detail-scene-description-v1",
      confirmedAt: new Date().toISOString(),
      snapshotAt: new Date().toISOString(),
      items: generationItems.map((item) => ({
        id: item.imageId,
        type: "scene",
        title: item.title,
        displaySummary: item.sceneDescription,
        intent: {
          groupId: item.groupId,
          groupTitle: item.groupTitle,
          imageNo: item.imageNo,
          copyRequirements: item.copyRequirements,
          designSpec: item.designSpec,
          imageType: item.imageType,
          imagePrompt: item.imagePrompt,
          sceneDescription: item.sceneDescription,
          ratio: item.ratio,
          visualConsistency: item.visualConsistency,
        },
      })),
    };
    const imageTask = await localGenerationPort.createTask({
        idempotencyKey: `${recordId}:product-detail-generation`,
        workspace: "product",
        kind: "image-generation",
        title: "商品详情图",
        promptPlanId: promptPlanSnapshot.planId,
        input: {
          kind: "product-detail-generation",
          sourceImageNames: inputSnapshot.productImages.map((image) => image.name),
          productSellingPoints: inputSnapshot.productPrompt,
          platform: inputSnapshot.settings.platform,
          market: inputSnapshot.settings.market,
          language: inputSnapshot.settings.language,
          items: generationItems,
        },
        promptPlanSnapshot,
        inputAssets,
      });
    if (!imageTask?.id) {
      throw new Error("商品详情图任务创建失败。");
    }

    const listingCopyItems = resultItems.filter((image) => image.kind === "listing-copy");
    const listingTasks: Array<{ imageId: string; taskId: string }> = [];
    for (const listingCopyItem of listingCopyItems) {
      const relatedGenerationItems = generationItems.filter(
        (item) => !listingCopyItem.groupId || item.groupId === listingCopyItem.groupId,
      );
      const listingScenes = relatedGenerationItems.length > 0 ? relatedGenerationItems : generationItems;
      const listingDesignSpec = createListingCopyDesignSpec(listingScenes);
      const listingTask = await localGenerationPort.createTask({
          idempotencyKey: `${listingCopyItem.id}:listing-copy`,
          workspace: "product",
          kind: "listing-copy",
          title: listingCopyItem.title,
          promptPlanId: promptPlanSnapshot.planId,
          input: {
            kind: "product-listing-copy",
            platform: inputSnapshot.settings.platform,
            market: inputSnapshot.settings.market,
            language: inputSnapshot.settings.language,
            productSellingPoints: inputSnapshot.productPrompt,
            designSpec: listingDesignSpec,
            groupId: listingCopyItem.groupId,
            groupTitle: listingCopyItem.groupTitle,
            prompt: createProductListingCopyPrompt({
              designSpec: listingDesignSpec,
              groupTitle: listingCopyItem.groupTitle,
              language: inputSnapshot.settings.language,
              market: inputSnapshot.settings.market,
              platform: inputSnapshot.settings.platform,
              productSellingPoints: inputSnapshot.productPrompt,
            }),
          },
          promptPlanSnapshot,
          inputAssets: [],
        });
      if (!listingTask?.id) {
        throw new Error("上架文案任务创建失败。");
      }
      listingTasks.push({ imageId: listingCopyItem.id, taskId: listingTask.id });
    }

    return { imageTaskId: imageTask.id, listingTasks };
  }

  function completeProductGenerationRecord(
    recordId: string,
    images: GeneratedDetailImage[],
    status: GenerationRecord["status"],
  ) {
    if (
      activeGenerationRecordIdRef.current === recordId &&
      (historyViewingRecordIdRef.current === null || historyViewingRecordIdRef.current === recordId)
    ) {
      setProductDetailImages(images);
    }
    setGenerationRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.id === recordId
          ? {
              ...record,
              images,
              status,
            }
          : record,
      ),
    );
  }

  function updateProductDetailImageById(
    imageId: string,
    updater: (image: GeneratedDetailImage) => GeneratedDetailImage,
  ) {
    setProductDetailImages((currentImages) =>
      currentImages.map((image) => (image.id === imageId ? updater(image) : image)),
    );
    setGenerationRecords((currentRecords) =>
      currentRecords.map((record) => {
        if (record.workspace !== "product" || !record.images.some((image) => image.id === imageId)) {
          return record;
        }
        const images = record.images.map((image) => (image.id === imageId ? updater(image) : image));
        return {
          ...record,
          images,
          status: deriveProductGenerationRecordStatus(images),
        };
      }),
    );
  }

  async function retryProductDetailImage(image: GeneratedDetailImage) {
    const parentRecord = generationRecords.find(
      (record) => record.workspace === "product" && record.images.some((recordImage) => recordImage.id === image.id),
    );
    const parentTaskId = parentRecord?.persistedTaskId;
    const referenceImages =
      image.referenceImages && image.referenceImages.length > 0
        ? image.referenceImages
        : createProductReferenceAssetViews(productImages);
    const inputAssets = referenceImagesToInputAssets(referenceImages, "reference");
    if (inputAssets.length === 0) {
      throw new Error("单图重新生成缺少可复用的参考图资产，请重新选择商品原图后再试。");
    }
    const resolvedPrompt = createProductDetailRetryPrompt(image, productGenerationSettings, productPrompt);
    const imageNo = resolveGeneratedImageNo(image, productDetailImages);
    const retryItem = {
      imageId: image.id,
      imageNo,
      moduleId: image.id,
      title: image.title,
      groupId: image.groupId,
      groupTitle: image.groupTitle,
      sceneDescription: image.sceneDescription ?? "",
      imagePrompt: resolvedPrompt,
      ratio:
        image.ratio ??
        (productGenerationSettings.advancedFormats.length > 0
          ? productGenerationSettings.advancedFormats.join("、")
          : productGenerationSettings.format),
      sortOrder: imageNo - 1,
    };
    const promptPlanSnapshot = {
      planId: `retry-${image.id}-${Date.now()}`,
      workspace: "product",
      userEditableSummary: productPrompt,
      resolverVersion: "product-detail-local-v1",
      templateVersion: "product-detail-scene-description-v1",
      confirmedAt: new Date().toISOString(),
      snapshotAt: new Date().toISOString(),
      items: [
        {
          id: retryItem.imageId,
          type: "scene",
          title: retryItem.title,
          displaySummary: retryItem.sceneDescription,
          intent: {
            groupId: retryItem.groupId,
            groupTitle: retryItem.groupTitle,
            imageNo: retryItem.imageNo,
            sceneDescription: retryItem.sceneDescription,
            imagePrompt: retryItem.imagePrompt,
            ratio: retryItem.ratio,
          },
        },
      ],
    };

    updateProductDetailImageById(image.id, (currentImage) => ({
      ...currentImage,
      errorMessage: undefined,
      referenceImages,
      status: "generating",
    }));

    try {
      const task = await localGenerationPort.createTask({
        idempotencyKey: `${image.id}:retry:${Date.now()}`,
        workspace: "product",
        kind: "image-generation",
        title: `重新生成 ${image.title}`,
        promptPlanId: promptPlanSnapshot.planId,
        input: {
          kind: "product-detail-generation",
          ...(parentTaskId ? { parentTaskId } : {}),
          sourceImageNames: referenceImages.map((referenceImage) => referenceImage.originalName).filter(Boolean),
          productSellingPoints: productPrompt,
          platform: productGenerationSettings.platform,
          market: productGenerationSettings.market,
          language: productGenerationSettings.language,
          items: [retryItem],
        },
        promptPlanSnapshot,
        inputAssets,
      });
      if (!task?.id) {
        throw new Error("单图重新生成任务创建失败。");
      }
      if (parentRecord) {
        setGenerationRecords((currentRecords) =>
          currentRecords.map((record) =>
            record.id === parentRecord.id
              ? {
                  ...record,
                  relatedTaskIds: Array.from(new Set([...(record.relatedTaskIds ?? []), task.id])),
                }
              : record,
          ),
        );
      }

      const startResult = await requestGenerationTaskStart(task.id, "单图重新生成任务未能启动。");
      console.info("product detail image retry worker start", {
        imageNo,
        imageId: image.id,
        startResult,
        taskId: task.id,
      });
      await pollProductSingleImageTask(task.id, image.id, referenceImages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "单图重新生成失败。";
      updateProductDetailImageById(image.id, (currentImage) => ({
        ...currentImage,
        errorMessage: message,
        referenceImages,
        status: "failed",
      }));
      throw error;
    }
  }

  async function retryProductListingCopy(image: GeneratedDetailImage) {
    if (image.kind !== "listing-copy") {
      return;
    }
    const parentRecord = generationRecords.find(
      (record) => record.workspace === "product" && record.images.some((recordImage) => recordImage.id === image.id),
    );
    if (!parentRecord) {
      throw new Error("找不到上架文案所属任务。");
    }
    const relatedScenes = parentRecord.images
      .filter(
        (recordImage) =>
          recordImage.kind !== "source-image" &&
          recordImage.kind !== "listing-copy" &&
          (!image.groupId || recordImage.groupId === image.groupId),
      )
      .map((recordImage, index) => ({
        imageId: recordImage.id,
        imageNo: recordImage.imageNo ?? index + 1,
        title: recordImage.title,
        groupId: recordImage.groupId,
        groupTitle: recordImage.groupTitle,
        sceneDescription: recordImage.sceneDescription ?? "",
        imagePrompt: recordImage.prompt ?? "",
        ratio: recordImage.ratio ?? productGenerationSettings.format,
        sortOrder: index,
      }));
    let latestImages = parentRecord.images.map((recordImage) =>
      recordImage.id === image.id
        ? {
            ...recordImage,
            errorMessage: undefined,
            status: "generating" as const,
          }
        : recordImage,
    );
    const publishImages = (nextImages: GeneratedDetailImage[]) => {
      latestImages = nextImages;
      if (
        activeGenerationRecordIdRef.current === parentRecord.id &&
        (historyViewingRecordIdRef.current === null || historyViewingRecordIdRef.current === parentRecord.id)
      ) {
        setProductDetailImages(nextImages);
      }
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === parentRecord.id
            ? {
                ...record,
                images: nextImages,
                status: deriveProductGenerationRecordStatus(nextImages),
              }
            : record,
        ),
      );
    };

    publishImages(latestImages);

    try {
      const listingDesignSpec = createListingCopyDesignSpec(relatedScenes);
      const listingTask = await localGenerationPort.createTask({
        idempotencyKey: `${image.id}:listing-copy-retry:${Date.now()}`,
        workspace: "product",
        kind: "listing-copy",
        title: image.title,
        promptPlanId: parentRecord.promptPlanId,
        input: {
          kind: "product-listing-copy",
          platform: productGenerationSettings.platform,
          market: productGenerationSettings.market,
          language: productGenerationSettings.language,
          productSellingPoints: productPrompt || parentRecord.inputSummary,
          designSpec: listingDesignSpec,
          groupId: image.groupId,
          groupTitle: image.groupTitle,
          prompt: createProductListingCopyPrompt({
            designSpec: listingDesignSpec,
            groupTitle: image.groupTitle,
            language: productGenerationSettings.language,
            market: productGenerationSettings.market,
            platform: productGenerationSettings.platform,
            productSellingPoints: productPrompt || parentRecord.inputSummary,
          }),
        },
        inputAssets: [],
      });
      if (!listingTask?.id) {
        throw new Error("上架文案重新生成任务创建失败。");
      }
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === parentRecord.id
            ? {
                ...record,
                relatedTaskIds: Array.from(new Set([...(record.relatedTaskIds ?? []), listingTask.id])),
              }
            : record,
        ),
      );

      await requestGenerationTaskStart(listingTask.id, "上架文案重新生成任务未能启动。");
      await pollListingCopyTask(listingTask.id, image.id, () => latestImages, publishImages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "上架文案重新生成失败。";
      publishImages(
        latestImages.map((recordImage) =>
          recordImage.id === image.id
            ? {
                ...recordImage,
                errorMessage: message,
                status: "failed" as const,
              }
            : recordImage,
        ),
      );
      throw error;
    }
  }

  async function pollProductSingleImageTask(
    taskId: string,
    imageId: string,
    referenceImages: GeneratedReferenceImage[],
  ) {
    let lastPollSignature = "";
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    for (;;) {
      const imageTaskDetail = await localGenerationPort.getTaskDetail(taskId);
      const final = isTaskTerminal(imageTaskDetail.task.status);
      const firstOutputAsset = [...imageTaskDetail.outputAssets].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      )[0];
      const pollSignature = createTaskPollSignature(imageTaskDetail);
      if (pollSignature !== lastPollSignature) {
        console.info("product detail image retry task poll", {
          imageId,
          outputAssetCount: imageTaskDetail.outputAssets.length,
          stage: imageTaskDetail.task.stage,
          status: imageTaskDetail.task.status,
          taskId,
        });
        lastPollSignature = pollSignature;
        unchangedPollCount = 0;
      } else {
        unchangedPollCount += 1;
      }
      queuedPollCount = imageTaskDetail.task.status === "queued" ? queuedPollCount + 1 : 0;

      if (imageTaskDetail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "单图重新生成任务未能启动。");
      }
      if (firstOutputAsset?.asset.url || firstOutputAsset?.asset.localPath) {
        updateProductDetailImageById(imageId, (currentImage) => ({
          ...currentImage,
          assetId: firstOutputAsset.asset.id,
          assetLocalPath: firstOutputAsset.asset.localPath,
          assetRelativePath: firstOutputAsset.asset.relativePath,
          errorMessage: undefined,
          referenceImages,
          src: firstOutputAsset.asset.url ?? firstOutputAsset.asset.localPath,
          status: "complete",
        }));
        return;
      }
      if (imageTaskDetail.task.status === "failed") {
        throw new Error(imageTaskDetail.task.error?.message ?? "单图重新生成失败。");
      }
      if (final) {
        throw new Error("单图重新生成结果缺少可展示图片。");
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        throw new Error("单图重新生成任务长时间未启动，请检查后台任务执行状态。");
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        throw new Error("单图重新生成长时间无进展，请检查模型配置或后台任务日志。");
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  async function persistProductImageRewriteTask(image: GeneratedDetailImage, instruction: string) {
    const rewriteInstruction = instruction.trim() || "按当前图片 prompt 重新生成，保持主体和信息区一致。";
    const basePrompt = image.prompt || `场景描述：${image.title}`;
    const resolvedPrompt = `${basePrompt}\n\n单图微调要求：${rewriteInstruction}`;
    const imageNo = resolveGeneratedImageNo(image, productDetailImages);
    const referenceImages = image.assetId
      ? [
          {
            assetId: image.assetId,
            mimeType: mimeTypeFromImageName(image.title),
            originalName: `${image.title}.png`,
            src: image.src,
          },
        ]
      : [];
    const inputAssets = referenceImagesToInputAssets(referenceImages, "reference");
    if (inputAssets.length === 0) {
      throw new Error("AI 改图缺少可复用的生成图资产，请等待图片生成完成后再试。");
    }
    const task = await localGenerationPort.createTask({
      idempotencyKey: `${image.id}:rewrite:${Date.now()}`,
      workspace: "product",
      kind: "image-edit",
      title: `微调 ${image.title}`,
      input: {
        kind: "product-detail-image-rewrite",
        sourceImageId: image.id,
        sourceImageNo: imageNo,
        sourceImageTitle: image.title,
        basePrompt,
        rewriteInstruction,
        resolvedPrompt,
        prompt: {
          messages: [
            {
              role: "system",
              content: "你是专业电商商品图局部微调助手。必须保持商品主体、颜色、版型、图案和已提供事实一致。",
            },
            {
              role: "user",
              content: resolvedPrompt,
            },
          ],
          rolelessPrompt: resolvedPrompt,
        },
      },
      inputAssets,
    });
    if (!task?.id) {
      throw new Error("AI 改图任务创建失败。");
    }
    const parentRecord = generationRecords.find(
      (record) => record.workspace === "product" && record.images.some((recordImage) => recordImage.id === image.id),
    );
    if (parentRecord) {
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === parentRecord.id
            ? {
                ...record,
                relatedTaskIds: Array.from(new Set([...(record.relatedTaskIds ?? []), task.id])),
              }
            : record,
        ),
      );
    }
    await requestGenerationTaskStart(task.id, "AI 改图任务未能启动。");
    await pollProductSingleImageTask(task.id, image.id, referenceImages);
  }

  function handleOpenGenerationRecord(record: GenerationRecord) {
    setActiveWorkspace(record.workspace);
    setActiveGenerationRecordId(record.id);
    setHistoryViewingRecordId(record.id);
    if (record.workspace === "product") {
      setProductDetailImages(record.images);
    } else {
      setClothingSceneImages(record.images);
    }
    setHistoryOpen(false);
  }

  function handleDeleteGenerationRecord(recordId: string) {
    const deletedRecord = generationRecords.find((record) => record.id === recordId);
    deletedGenerationRecordIdsRef.current.add(recordId);
    setGenerationRecords((currentRecords) => currentRecords.filter((record) => record.id !== recordId));
    deletePersistedGenerationRecord(deletedRecord);
    if (activeGenerationRecordId !== recordId || !deletedRecord) {
      return;
    }

    setActiveGenerationRecordId(null);
    setHistoryViewingRecordId((currentId) => (currentId === recordId ? null : currentId));
    if (deletedRecord.workspace === "product") {
      setProductDetailImages([]);
    } else {
      setClothingSceneImages([]);
    }
  }

  function handleClearGenerationRecords() {
    generationRecords.forEach(deletePersistedGenerationRecord);
    setGenerationRecords([]);
    setActiveGenerationRecordId(null);
    setHistoryViewingRecordId(null);
    setProductDetailImages([]);
    setClothingSceneImages([]);
    setHistoryOpen(false);
  }

  function handleBackToProductInputs() {
    setProductStrategyDrafting(false);
    setProductDetailGenerating(false);
    setProductDetailImages([]);
    setHistoryViewingRecordId(null);
  }

  function handleGenerateClothingScenes(drafts: ClothingSceneDraft[]) {
    const recordId = createGenerationRecordId("clothing");
    const images = drafts.map((draft) => ({
      id: `${recordId}-${draft.id}`,
      status: "generating" as const,
      title: draft.scene,
    }));
    const record: GenerationRecord = {
      createdAt: Date.now(),
      id: recordId,
      images,
      inputSummary: createClothingHistorySummary(drafts),
      kind: "clothing-scene",
      status: "generating",
      title: "服饰场景图",
      workspace: "clothing",
    };

    setGenerationRecords((currentRecords) => [record, ...currentRecords]);
    setActiveGenerationRecordId(recordId);
    setHistoryViewingRecordId(null);
    setClothingGeneratingRecordId(recordId);
    setClothingSceneImages(images);
    setClothingSceneGenerating(true);
    setHistoryOpen(false);
  }

  function handleGenerateScenePlan() {
    setScenePromptReviewing(true);
    setScenePlanGenerating(true);
    setSceneImagePlans([]);
    setSceneImages([]);
  }

  function handleBackToSceneConfig() {
    setScenePromptReviewing(false);
    setScenePlanGenerating(false);
    setSceneImageGenerating(false);
    setSceneImagePlans([]);
    setSceneImages([]);
  }

  function handleGenerateSceneImages(plans: SceneImagePlan[]) {
    setSceneImages(
      plans.map((plan) => ({
        id: `scene-${plan.id}`,
        prompt: plan.prompt,
        ratio: plan.ratio,
        status: "generating",
        title: plan.title,
      })),
    );
    setSceneImageGenerating(true);
  }

  useEffect(() => {
    function disableContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    document.addEventListener("contextmenu", disableContextMenu);

    return () => document.removeEventListener("contextmenu", disableContextMenu);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreProductGenerationHistory() {
      try {
        const page = await localGenerationPort.listTasks({ workspace: "product", page: 1, pageSize: 20 });
        const productTasks = page.items.filter(
          (task) => task.workspace === "product" && (task.kind === "image-generation" || task.kind === "listing-copy"),
        );
        const taskDetails = await Promise.all(productTasks.map((task) => localGenerationPort.getTaskDetail(task.id)));
        const restoredRecords = taskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map(createProductGenerationRecordFromTaskDetail)
          .filter((record): record is GenerationRecord => record !== null);
        const retryPatches = taskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map(createRestoredSingleImageRetryPatchFromTaskDetail)
          .filter((patch): patch is RestoredSingleImageRetryPatch => patch !== null);
        const listingCopyImages = taskDetails
          .filter((detail) => detail.task.kind === "listing-copy")
          .map(createRestoredListingCopyImageFromTaskDetail)
          .filter((item): item is RestoredListingCopyImage => item !== null);
        const restoredRecordsWithRetries = mergeRestoredSingleImageRetryPatches(restoredRecords, retryPatches);
        const restoredRecordsWithListingCopy = mergeRestoredListingCopyImages(restoredRecordsWithRetries, listingCopyImages);

        if (!cancelled && restoredRecordsWithListingCopy.length > 0) {
          setGenerationRecords((currentRecords) => mergeGenerationRecords(currentRecords, restoredRecordsWithListingCopy));
        }
      } catch (error) {
        console.warn("restore product generation history failed", error);
      }
    }

    void restoreProductGenerationHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clothingSceneGenerating) {
      return;
    }

    const generationTimer = window.setTimeout(() => {
      setClothingSceneImages((currentImages) => {
        const failedImageId = pickRandomFailedImageId(currentImages);
        const completedImages = completeGeneratedImages(currentImages, failedImageId);
        if (clothingGeneratingRecordId) {
          setGenerationRecords((currentRecords) =>
            currentRecords.map((record) =>
              record.id === clothingGeneratingRecordId
                ? {
                    ...record,
                    images: completeGeneratedImages(record.images, failedImageId),
                    status: "complete",
                  }
                : record,
            ),
          );
        }
        return completedImages;
      });
      setClothingSceneGenerating(false);
      setClothingGeneratingRecordId(null);
    }, generationCompleteDelayMs);

    return () => window.clearTimeout(generationTimer);
  }, [clothingSceneGenerating, clothingGeneratingRecordId]);

  useEffect(() => {
    if (!scenePlanGenerating) {
      return;
    }

    const planTimer = window.setTimeout(() => {
      setSceneImagePlans(createSceneImagePlans(sceneConfig));
      setScenePlanGenerating(false);
    }, scenePlanDraftDelayMs);

    return () => window.clearTimeout(planTimer);
  }, [sceneConfig, scenePlanGenerating]);

  useEffect(() => {
    if (!sceneImageGenerating) {
      return;
    }

    const generationTimer = window.setTimeout(() => {
      setSceneImages((currentImages) => completeGeneratedImages(currentImages, pickRandomFailedImageId(currentImages)));
      setSceneImageGenerating(false);
    }, generationCompleteDelayMs);

    return () => window.clearTimeout(generationTimer);
  }, [sceneImageGenerating]);

  return (
    <AppShell
      toolbar={
        <StudioToolbar
          hidePrimaryAction={isModelWorkspace || isSettingsWorkspace}
          historyCount={generationRecords.length}
          historyOpen={historyOpen}
          historyPopover={
            <GenerationHistoryPopover
              activeRecordId={activeGenerationRecordId}
              onClearRecords={handleClearGenerationRecords}
              onClose={closeHistory}
              onDeleteRecord={handleDeleteGenerationRecord}
              onOpenRecord={handleOpenGenerationRecord}
              open={historyOpen}
              records={generationRecords}
            />
          }
          onOpenSettings={() => {
            setActiveWorkspace("settings");
            setHistoryOpen(false);
          }}
          onNewTask={handleNewTask}
          onToggleHistory={() => setHistoryOpen((open) => !open)}
        />
      }
      navigation={
        <NavigationRail
          items={navItems}
          activeItemId={activeWorkspace}
          onSelect={setActiveWorkspace}
        />
      }
      configPanel={
        <>
          <div className={activeWorkspace === "product" ? "contents" : "hidden"} hidden={activeWorkspace !== "product"}>
            <GenerationConfigPanel
              detailGenerating={productDetailGenerating}
              generationSettings={productGenerationSettings}
              generationSettingsTouched={productGenerationSettingsTouched}
              modules={productModules}
              onBackToProductInputs={handleBackToProductInputs}
              onGenerateDetails={handleGenerateDetails}
              onGenerateStrategy={() => setProductStrategyDrafting(true)}
              onGenerationSettingsChange={handleProductGenerationSettingsChange}
              onModuleCheckedChange={handleModuleCheckedChange}
              onProductImagesChange={setProductImages}
              onProductPromptChange={setProductPrompt}
              onViralStylesChange={setSelectedProductViralStyles}
              productImages={productImages}
              productPrompt={productPrompt}
              strategyDrafting={productStrategyDrafting}
            />
          </div>
          {isSceneWorkspace ? (
            scenePromptReviewing ? (
              <ScenePromptReviewPanel
                config={sceneConfig}
                imageGenerating={sceneImageGenerating}
                onBack={handleBackToSceneConfig}
                onGenerateImages={handleGenerateSceneImages}
                onPlansChange={setSceneImagePlans}
                planGenerating={scenePlanGenerating}
                plans={sceneImagePlans}
              />
            ) : (
              <SceneConfigPanel
                config={sceneConfig}
                onChange={setSceneConfig}
                onGeneratePlan={handleGenerateScenePlan}
              />
            )
          ) : isClothingWorkspace ? (
            clothingSceneDrafting ? (
              <ClothingSceneSelectionPanel
                onBack={() => setClothingSceneDrafting(false)}
                onGenerateSceneImages={handleGenerateClothingScenes}
                sceneGenerating={clothingSceneGenerating}
              />
            ) : (
              <ClothingConfigPanel
                config={clothingConfig}
                onChange={setClothingConfig}
                onGenerateScenes={() => setClothingSceneDrafting(true)}
              />
            )
          ) : null}
        </>
      }
      canvas={
        isSceneWorkspace ? (
          sceneImages.length > 0 ? (
            <PreviewCanvas boards={previewBoards} detailImages={sceneImages} />
          ) : (
            <ScenePreviewCanvas />
          )
        ) : isClothingWorkspace ? (
          clothingSceneImages.length > 0 ? (
            <PreviewCanvas boards={previewBoards} detailImages={clothingSceneImages} />
          ) : (
            <ClothingPreviewCanvas />
          )
        ) : (
          <PreviewCanvas
            boards={previewBoards}
            detailImages={productDetailImages}
            onImageRewrite={persistProductImageRewriteTask}
            onImageRetry={retryProductDetailImage}
            onListingCopyRetry={retryProductListingCopy}
          />
        )
      }
      hideConfigPanel={isGenerationResultViewing}
      workspaceContent={isModelWorkspace ? <ModelConfigPage /> : isSettingsWorkspace ? <SettingsPage /> : null}
    />
  );
}

function createGenerationRecordId(prefix: "clothing" | "product") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProductHistorySummary(settings: typeof defaultProductGenerationSettings, imageCount: number) {
  const formatLabel =
    settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;

  return `${settings.platform} · ${settings.market} · ${settings.language} · ${formatLabel} · ${imageCount} 张`;
}

function pickRandomFailedImageId(images: GeneratedDetailImage[]) {
  const failureCandidates = images.filter((image) => image.kind !== "source-image");
  if (failureCandidates.length === 0) {
    return null;
  }

  return failureCandidates[Math.floor(Math.random() * failureCandidates.length)]?.id ?? null;
}

function completeGeneratedImages(images: GeneratedDetailImage[], failedImageId: string | null): GeneratedDetailImage[] {
  return images.map((image) =>
    image.kind === "source-image"
      ? {
          ...image,
          status: "complete",
        }
      : image.id === failedImageId
        ? {
            ...image,
            errorMessage: "生成失败",
            status: "failed",
          }
        : {
            ...image,
            status: "complete",
          },
  );
}

function deletePersistedGenerationRecord(record: GenerationRecord | undefined) {
  if (!record) {
    return;
  }

  const taskIds = Array.from(
    new Set([...(record.relatedTaskIds ?? []), record.persistedTaskId].filter((taskId): taskId is string => Boolean(taskId))),
  );
  deletePersistedGenerationTasks(taskIds);
}

function deletePersistedGenerationTasks(taskIds: string[]) {
  taskIds.forEach((taskId) => {
    void localGenerationPort.deleteTask(taskId).catch((error) => {
      console.warn("delete persisted generation record failed", error);
    });
  });
}

async function restoreProductGenerationRecordFromTaskDetail(taskId: string): Promise<GenerationRecord | null> {
  const detail = await localGenerationPort.getTaskDetail(taskId);
  return createProductGenerationRecordFromTaskDetail(detail);
}

function createProductGenerationRecordFromTaskDetail(detail: GenerationTaskDetail): GenerationRecord | null {
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

type RestoredListingCopyImage = {
  image: GeneratedDetailImage;
  promptPlanId: string;
  taskId: string;
  updatedAt: number;
};

type RestoredSingleImageRetryPatch = {
  image: GeneratedDetailImage;
  imageNo: number;
  parentTaskId?: string;
  taskId: string;
  targetImageId: string;
};

function createRestoredSingleImageRetryPatchFromTaskDetail(detail: GenerationTaskDetail): RestoredSingleImageRetryPatch | null {
  if (!isSingleImageRetryTaskDetail(detail) || detail.task.status !== "succeeded") {
    return null;
  }
  const input = detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {};
  const items = Array.isArray(input.items) ? input.items : [];
  const item = items[0] && typeof items[0] === "object" ? (items[0] as Record<string, unknown>) : {};
  const targetImageId = readOutputString(item.imageId);
  const imageNo = readOutputNumber(item.imageNo);
  const parentTaskId = readOutputString(input.parentTaskId) || detail.task.retryOfTaskId;
  const outputAsset = [...detail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0];
  const src = outputAsset?.asset.url ?? outputAsset?.asset.localPath;
  if (!targetImageId || !src) {
    return null;
  }

  return {
    targetImageId,
    imageNo,
    parentTaskId,
    taskId: detail.task.id,
    image: {
      id: targetImageId,
      assetId: outputAsset.asset.id,
      assetLocalPath: outputAsset.asset.localPath,
      assetRelativePath: outputAsset.asset.relativePath,
      imageNo: imageNo || undefined,
      prompt: readOutputString(item.imagePrompt) || undefined,
      referenceImages: readReferenceImagesFromTaskDetail(detail, input),
      sceneDescription: readOutputString(item.sceneDescription) || undefined,
      src,
      status: "complete",
      title: readOutputString(item.title) || detail.task.title.replace(/^重新生成\s*/, "") || "详情图",
    },
  };
}

function createRestoredListingCopyImageFromTaskDetail(detail: GenerationTaskDetail): RestoredListingCopyImage | null {
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

function mergeRestoredSingleImageRetryPatches(
  records: GenerationRecord[],
  retryPatches: RestoredSingleImageRetryPatch[],
): GenerationRecord[] {
  if (retryPatches.length === 0) {
    return records;
  }

  return records.map((record) => {
    let images = record.images;
    for (const patch of retryPatches) {
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
            }
          : image,
      );
    }

    return images === record.images
      ? record
      : {
          ...record,
          images,
          relatedTaskIds: Array.from(
            new Set([
              ...(record.relatedTaskIds ?? []),
              ...retryPatches
                .filter((patch) => isRestoredRetryPatchScopedToRecord(record, patch))
                .map((patch) => patch.taskId),
            ]),
          ),
          status: deriveProductGenerationRecordStatus(images),
        };
  });
}

function restoredImageMatchesRetryTarget(image: GeneratedDetailImage, patch: RestoredSingleImageRetryPatch) {
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

function mergeRestoredListingCopyImages(
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

function isSingleImageRetryTaskDetail(detail: GenerationTaskDetail) {
  return detail.task.title.startsWith("重新生成 ") || readTaskPromptPlanId(detail).startsWith("retry-");
}

function readTaskPromptPlanId(detail: GenerationTaskDetail) {
  return detail.task.promptPlanId || readPromptPlanSnapshotId(detail.promptPlanSnapshot);
}

function restoreGeneratedDetailImages(
  detail: GenerationTaskDetail,
  options: { referenceImages?: GeneratedReferenceImage[]; stale?: boolean } = {},
): GeneratedDetailImage[] {
  const planItems = readPromptPlanSnapshotItems(detail.promptPlanSnapshot);
  const outputAssets = [...detail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder);
  const itemCount = Math.max(planItems.length, outputAssets.length);
  const shouldFailMissingOutput = options.stale || isTaskTerminal(detail.task.status);

  const restoredImages = Array.from({ length: itemCount }, (_, index) => {
    const planItem = planItems[index];
    const outputAsset = outputAssets[index];
    const displayTitle = planItem?.title || `详情图 ${index + 1}`;
    const imageId = createRestoredDetailImageId(detail.task.id, planItem?.id, index);
    if (outputAsset?.asset.url || outputAsset?.asset.localPath) {
      return {
        assetId: outputAsset.asset.id,
        assetLocalPath: outputAsset.asset.localPath,
        assetRelativePath: outputAsset.asset.relativePath,
        id: imageId,
        groupId: planItem?.groupId,
        groupTitle: planItem?.groupTitle,
        prompt: planItem?.imagePrompt,
        imageNo: planItem?.imageNo ?? index + 1,
        referenceImages: options.referenceImages,
        sceneDescription: planItem?.sceneDescription,
        src: outputAsset.asset.url ?? outputAsset.asset.localPath,
        status: "complete" as const,
        title: displayTitle,
      };
    }

    return {
      errorMessage: options.stale ? "生成中断" : detail.task.error?.message || "生成结果缺少可展示图片。",
      id: imageId,
      groupId: planItem?.groupId,
      groupTitle: planItem?.groupTitle,
      imageNo: planItem?.imageNo ?? index + 1,
      prompt: planItem?.imagePrompt,
      referenceImages: options.referenceImages,
      sceneDescription: planItem?.sceneDescription,
      status: shouldFailMissingOutput ? ("failed" as const) : ("generating" as const),
      title: displayTitle,
    };
  });

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
  if (detail.task.status === "succeeded" && images.every((image) => image.status === "complete")) {
    return "complete";
  }
  if (stale) {
    return images.every((image) => image.status === "complete") ? "complete" : "failed";
  }
  if (images.some((image) => image.status === "failed")) {
    return "failed";
  }
  return generationTaskStatusToRecordStatus(detail.task.status);
}

function isRestoredTaskStale(task: GenerationTaskDetail["task"]) {
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

function mergeGenerationRecords(currentRecords: GenerationRecord[], restoredRecords: GenerationRecord[]) {
  const currentIds = new Set(currentRecords.map((record) => record.id));
  const mergedRecords = [
    ...currentRecords,
    ...restoredRecords.filter((record) => !currentIds.has(record.id)),
  ];
  return mergedRecords.sort((left, right) => right.createdAt - left.createdAt);
}

function applyGeneratedAssetOutputs(
  images: GeneratedDetailImage[],
  detail: GenerationTaskDetail,
  options: { final?: boolean } = {},
): GeneratedDetailImage[] {
  const outputAssetBySortOrder = new Map(
    detail.outputAssets.map((item) => [item.sortOrder, item] as const),
  );
  let imageIndex = 0;
  const referenceImages = readReferenceImagesFromTaskDetail(
    detail,
    detail.input && typeof detail.input === "object" ? (detail.input as Record<string, unknown>) : {},
  );

  return images.map((image) => {
    if (image.kind === "source-image") {
      return {
        ...image,
        status: "complete",
      };
    }
    if (image.kind === "listing-copy") {
      return image;
    }

    const outputAsset = outputAssetBySortOrder.get(imageIndex);
    imageIndex += 1;
    if (!outputAsset?.asset.url && !outputAsset?.asset.localPath) {
      if (!options.final) {
        return image;
      }
      return {
        ...image,
        errorMessage: "生成结果缺少可展示图片。",
        referenceImages: referenceImages.length > 0 ? referenceImages : image.referenceImages,
        status: "failed",
      };
    }

    return {
      ...image,
      assetId: outputAsset.asset.id,
      assetLocalPath: outputAsset.asset.localPath,
      assetRelativePath: outputAsset.asset.relativePath,
      referenceImages: referenceImages.length > 0 ? referenceImages : image.referenceImages,
      src: outputAsset.asset.url ?? outputAsset.asset.localPath,
      status: "complete",
    };
  });
}

function isTaskTerminal(status: GenerationTaskDetail["task"]["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
}

function createTaskPollSignature(detail: GenerationTaskDetail) {
  return [
    detail.task.status,
    detail.task.stage,
    detail.task.updatedAt,
    detail.events.length,
    detail.outputAssets.length,
    detail.output ? "has-output" : "no-output",
  ].join("|");
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function applyListingCopyOutput(
  images: GeneratedDetailImage[],
  imageId: string,
  output: unknown,
): GeneratedDetailImage[] {
  const listingCopy = parseListingCopyOutput(output);
  return images.map((image) =>
    image.id === imageId
      ? listingCopy
        ? {
            ...image,
            listingCopy,
            status: "complete",
          }
        : {
            ...image,
            errorMessage: "上架文案结果缺少有效内容。",
            status: "failed",
          }
      : image,
  );
}

function failListingCopyOutput(
  images: GeneratedDetailImage[],
  imageId: string,
  message: string,
): GeneratedDetailImage[] {
  return images.map((image) =>
    image.id === imageId
      ? {
          ...image,
          errorMessage: message,
          status: "failed",
        }
      : image,
  );
}

function failProductImageOutputs(images: GeneratedDetailImage[], message: string): GeneratedDetailImage[] {
  return images.map((image) =>
    image.kind === "source-image" || image.kind === "listing-copy" || image.status === "complete"
      ? image
      : {
          ...image,
          errorMessage: message,
          status: "failed",
        },
  );
}

function failGeneratedImages(images: GeneratedDetailImage[], message: string): GeneratedDetailImage[] {
  return images.map((image) =>
    image.kind === "source-image" || image.status === "complete"
      ? image
      : {
          ...image,
          errorMessage: message,
          status: "failed",
      },
  );
}

function resolveGeneratedImageNo(target: GeneratedDetailImage, images: GeneratedDetailImage[]) {
  if (target.imageNo && target.imageNo > 0) {
    return target.imageNo;
  }

  const generatedImages = images.filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy");
  const index = generatedImages.findIndex((image) => image.id === target.id);
  return index >= 0 ? index + 1 : 1;
}

function deriveProductGenerationRecordStatus(images: GeneratedDetailImage[]): GenerationRecord["status"] {
  const resultImages = images.filter((image) => image.kind !== "source-image");
  if (resultImages.some((image) => image.status === "generating")) {
    return "generating";
  }
  if (resultImages.some((image) => image.status === "failed")) {
    return "failed";
  }
  return "complete";
}

function createProductDetailRetryPrompt(
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
  ].filter(Boolean).join("\n");
}

function parseListingCopyOutput(output: unknown): ProductListingCopy | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const value = output as Record<string, unknown>;
  const title = readOutputString(value.title);
  const sellingPoints = [...readOutputStringArray(value.sellingPoints), ...readOutputStringArray(value.promotionBenefits)];
  const detailCopy = readOutputString(value.detailCopy);
  const searchKeywords = readOutputStringArray(value.searchKeywords);
  const attributeWords = readOutputStringArray(value.attributeWords);
  const shootingPlan = readOutputStringArray(value.mainImageGuidance);

  if (!title || sellingPoints.length === 0 || !detailCopy) {
    return null;
  }

  return {
    detailCopy,
    keywords: [...searchKeywords, ...attributeWords].join(" "),
    sellingPoints,
    shootingPlan,
    sourcePrompt: readOutputString(value.platform) || "listing-copy",
    title,
  };
}

function readOutputString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOutputNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOutputStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function readReferenceImagesFromTaskDetail(
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
  if (assetReferences.length > 0) {
    return assetReferences;
  }

  return readReferenceImages(input);
}

function readReferenceImages(input: Record<string, unknown>): GeneratedReferenceImage[] {
  const userImages = input.userImages;
  if (!Array.isArray(userImages)) {
    return [];
  }

  return userImages
    .map((item): GeneratedReferenceImage | null => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const dataUrl = readOutputString(value.dataUrl);
      if (!dataUrl) {
        return null;
      }
      return {
        dataUrl,
        assetId: readOutputString(value.assetId) || undefined,
        mimeType: readOutputString(value.mimeType) || undefined,
        originalName: readOutputString(value.originalName) || undefined,
        src: readOutputString(value.src) || undefined,
      };
    })
    .filter((item): item is GeneratedReferenceImage => item !== null);
}

function createProductReferenceAssetViews(productImages: ProductImageAsset[]): GeneratedReferenceImage[] {
  return productImages
    .filter((image) => image.assetId)
    .map((image) => ({
      assetId: image.assetId,
      mimeType: image.aiAssistMimeType ?? mimeTypeFromImageName(image.name),
      originalName: image.name,
      src: image.src,
    }));
}

function referenceImagesToInputAssets(
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
    .map((assetId, index) => ({
      assetId,
      role,
      sortOrder: index,
    }));
}

async function importProductInputAssets(
  productImages: ProductImageAsset[],
  role: Extract<GenerationTaskInputAssetInput["role"], "source" | "reference">,
): Promise<GenerationTaskInputAssetInput[]> {
  const importTargets = productImages
    .map((image, index) => ({ image, index }))
    .filter((item) => !item.image.assetId && item.image.path);
  const importedAssets =
    importTargets.length > 0
      ? await localAssetPort.importImages({
          kind: role === "source" ? "source" : "reference",
          paths: importTargets.map((item) => item.image.path),
        })
      : [];
  const importedByIndex = new Map(
    importTargets.map((item, importIndex) => [item.index, importedAssets[importIndex]] as const),
  );

  const inputAssets: GenerationTaskInputAssetInput[] = [];
  productImages.forEach((image, index) => {
    const assetId = image.assetId ?? importedByIndex.get(index)?.id;
    if (!assetId) {
      return;
    }
    inputAssets.push({
      assetId,
      role,
      sortOrder: index,
    });
  });
  return inputAssets;
}

function mimeTypeFromImageName(name: string) {
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

function createFlatProductResultItems(
  recordId: string,
  drafts: StrategyModuleDraft[],
  listingCopyGenerationEnabled: boolean,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  productImages: ProductImageAsset[],
) {
  const sourceImage: GeneratedDetailImage = {
    id: `${recordId}-source`,
    kind: "source-image",
    sourceImages: productImages,
    status: "complete",
    title: "原图",
  };
  const images: GeneratedDetailImage[] = drafts.map((draft, index) => {
    const imagePlan = createProductDetailImagePlan(draft, settings, productPrompt);
    return {
      copyRequirements: imagePlan.copyRequirements,
      coreImagePrompt: imagePlan.coreImagePrompt,
      designSpec: imagePlan.designSpec,
      id: `${recordId}-${draft.id}`,
      imageNo: index + 1,
      imageType: imagePlan.imageType,
      prompt: imagePlan.imagePrompt,
      sceneDescription: imagePlan.sceneDescription,
      status: "generating" as const,
      title: draft.title,
      visualConsistency: imagePlan.visualConsistency,
    };
  });

  return listingCopyGenerationEnabled
    ? [
        sourceImage,
        ...images,
        {
          id: `${recordId}-listing-copy`,
          kind: "listing-copy" as const,
          listingCopy: createProductListingCopy(productPrompt),
          status: "generating" as const,
          title: "商品上架文案",
        },
      ]
    : [sourceImage, ...images];
}

function createProductDetailImagePlan(
  draft: StrategyModuleDraft,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  viralStyle?: ViralStyleAnalysisResult,
) {
  const promptPlanItem = findPromptPlanItemForStyle(draft, viralStyle);
  const sceneDescription = draft.contentEdited
    ? draft.content
    : promptPlanItem?.copyRequirements || promptPlanItem?.sceneDescription || draft.content;
  const coreImagePrompt = promptPlanItem?.imagePrompt;
  const imageType = promptPlanItem?.imageType || `${draft.title}: ${draft.description}`;
  const designSpec = promptPlanItem?.designSpec || createProductDetailDesignSpec(productPrompt, viralStyle, promptPlanItem);
  const imagePrompt = coreImagePrompt
    ? appendProductDetailPromptSafeguards(
        combineProductDetailImagePromptAndCopy(coreImagePrompt, sceneDescription),
        settings,
        productPrompt,
        viralStyle,
        draft,
        promptPlanItem,
        imageType,
        designSpec,
      )
    : createProductDetailImagePrompt(
        draft,
        settings,
        productPrompt,
        viralStyle,
        sceneDescription,
        promptPlanItem,
        imageType,
        designSpec,
      );

  return {
    copyRequirements: sceneDescription,
    coreImagePrompt: coreImagePrompt ?? imagePrompt,
    designSpec,
    imageType,
    imagePrompt,
    sceneDescription,
    visualConsistency: promptPlanItem?.visualConsistency,
  };
}

function combineProductDetailImagePromptAndCopy(imagePrompt: string, copyRequirements: string) {
  return [
    imagePrompt,
    copyRequirements.trim() ? `用户可修改文案要求：${copyRequirements.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function createProductDetailImagePrompt(
  draft: StrategyModuleDraft,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  viralStyle: ViralStyleAnalysisResult | undefined,
  sceneDescription: string,
  promptPlanItem: StrategyModulePromptPlanItem | undefined,
  imageType: string,
  designSpec: string,
) {
  const formatLabel =
    settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;
  const styleAnchor = viralStyle
    ? createViralStylePromptAnchor(viralStyle)
    : "爆款风格：未选择，采用中性、干净、可泛化的电商摄影棚视觉。";

  return [
    designSpec,
    `场景核心卖点：${imageType}`,
    `场景描述：${sceneDescription}`,
    `商品卖点：${productPrompt.trim() || "需补充商品卖点信息"}`,
    `模块目的：${draft.title}，${draft.description}`,
    createVisualConsistencyPromptAnchor(promptPlanItem?.visualConsistency),
    `平台与语言：${settings.platform}，${settings.market}，${settings.language}`,
    createLocalePromptConstraint(settings),
    `画面比例：适配 ${formatLabel} 比例的电商详情页画面`,
    styleAnchor,
    createOriginalImageFidelityConstraint(),
    createVisibleTextPromptConstraint(),
    "禁止项：禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标、未提供的材质或功效。",
  ].filter(Boolean).join("\n");
}

function appendProductDetailPromptSafeguards(
  imagePrompt: string,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  viralStyle?: ViralStyleAnalysisResult,
  draft?: StrategyModuleDraft,
  promptPlanItem?: StrategyModulePromptPlanItem,
  imageType?: string,
  designSpec?: string,
) {
  const formatLabel =
    settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;
  const styleLine = viralStyle ? createViralStylePromptAnchor(viralStyle) : "爆款风格：未选择";
  return [
    designSpec,
    imageType ? `场景核心卖点：${imageType}` : "",
    draft ? `当前场景：${draft.title}，${draft.description}` : "",
    imagePrompt,
    `商品卖点事实边界：${productPrompt.trim() || "需补充商品卖点信息"}`,
    createVisualConsistencyPromptAnchor(promptPlanItem?.visualConsistency),
    `平台与语言：${settings.platform}，${settings.market}，${settings.language}`,
    createLocalePromptConstraint(settings),
    `画面比例：适配 ${formatLabel} 比例的电商详情页画面`,
    styleLine,
    createOriginalImageFidelityConstraint(),
    createVisibleTextPromptConstraint(),
    "禁止项：禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标、未提供的材质或功效。",
  ].filter(Boolean).join("\n");
}

function createProductDetailDesignSpec(
  productPrompt: string,
  viralStyle: ViralStyleAnalysisResult | undefined,
  promptPlanItem: StrategyModulePromptPlanItem | undefined,
) {
  const productSentence = createProductSummarySentence(productPrompt);
  const sellingPoints = createShortTerms(productPrompt, ["需补充卖点"], 3);
  const concerns = createConcernTerms(productPrompt);

  return [
    "产品与卖点",
    `产品：${productSentence}`,
    `卖点：${sellingPoints.join(" / ")}`,
    `顾虑：${concerns.join(" / ")}`,
    `视觉重心：${createVisualFocusSentence(sellingPoints, concerns, promptPlanItem?.visualConsistency)}`,
    "",
    "视觉定调",
    `风格：${createStyleDirectionSentence(viralStyle)}`,
    `色彩：${createColorDirectionSentence(viralStyle, promptPlanItem?.visualConsistency)}`,
    `字体：${createFontDirectionSentence(viralStyle)}`,
    `色温：${createColorTemperatureSentence(viralStyle)}`,
    `光质：${createLightQualitySentence(viralStyle, promptPlanItem?.visualConsistency)}`,
  ].join("\n");
}

function createProductSummarySentence(productPrompt: string) {
  const value = productPrompt.trim();
  if (!value) {
    return "需补充产品信息。";
  }
  return /[。.!！?？]$/.test(value) ? value : `${value}。`;
}

function createShortTerms(productPrompt: string, fallback: string[], limit: number) {
  const terms = productPrompt
    .split(/[，,、；;。.!！?？\n\r]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && term.length <= 16);
  const uniqueTerms = Array.from(new Set(terms)).slice(0, limit);
  return uniqueTerms.length > 0 ? uniqueTerms : fallback;
}

function createConcernTerms(productPrompt: string) {
  const source = productPrompt.toLowerCase();
  if (/头盔|骑行|护具|安全帽|helmet/.test(source)) {
    return ["佩戴闷热", "安全感不足", "日常不百搭"];
  }
  if (/洁面|洗面奶|护肤|精华|面霜|乳液|防晒|cleanser|skincare/.test(source)) {
    return ["清洁刺激", "洗后紧绷", "成分不明"];
  }
  if (/衣|裤|裙|鞋|包|背心|夹克|外套|t恤|t-shirt|jacket|dress|shoe|bag/.test(source)) {
    return ["版型显臃肿", "闷汗不透气", "质感不稳定"];
  }
  if (/食品|零食|饮料|茶|咖啡|饼干|food|drink|coffee|tea/.test(source)) {
    return ["口味不直观", "配料不清晰", "包装无质感"];
  }
  return ["效果不直观", "质感不稳定", "信息不可信"];
}

function createVisualFocusSentence(
  sellingPoints: string[],
  concerns: string[],
  visualConsistency?: Record<string, unknown>,
) {
  const productAnchor = readVisualConsistencyText(visualConsistency, "productAnchor");
  const compositionAnchor = readVisualConsistencyText(visualConsistency, "compositionAnchor");
  const focusSubject = productAnchor || "商品主体";
  const sellingPointText = sellingPoints.slice(0, 2).join("+") || "核心卖点";
  const concernText = concerns[0] || "购买";
  const compositionText = compositionAnchor ? `，保持${compositionAnchor}` : "";
  return `${focusSubject}作为画面第一视觉中心${compositionText}，直观展示${sellingPointText}，打消用户${concernText}顾虑`;
}

function createStyleDirectionSentence(viralStyle?: ViralStyleAnalysisResult) {
  if (!viralStyle) {
    return "中性干净的电商详情页视觉，突出商品识别和转化效率";
  }
  const styleText = [viralStyle.title, viralStyle.subtitle, viralStyle.designFocus]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join(" / ");
  return styleText || "中性干净的电商详情页视觉，突出商品识别和转化效率";
}

function createColorDirectionSentence(
  viralStyle: ViralStyleAnalysisResult | undefined,
  visualConsistency?: Record<string, unknown>,
) {
  const colors = viralStyle?.colors?.filter((color) => color.trim()).join("/");
  const colorDescription = viralStyle?.colorDescription?.trim();
  const backgroundAnchor = readVisualConsistencyText(visualConsistency, "backgroundAnchor");
  if (colors && colorDescription) {
    return `${colors}作为统一配色，${colorDescription}，产品保持原色`;
  }
  if (colors) {
    return `${colors}作为统一配色，产品保持原色，重点信息使用高对比强调`;
  }
  if (backgroundAnchor) {
    return `${backgroundAnchor}作为统一背景基调，产品保持原色，重点信息使用高对比强调`;
  }
  return "中性色背景基调，产品保持原色，重点信息使用高对比强调";
}

function createFontDirectionSentence(viralStyle?: ViralStyleAnalysisResult) {
  return (
    viralStyle?.fontStyleDescription?.trim() ||
    "中等偏粗无衬线体用于标题，干净无衬线体用于正文信息"
  );
}

function createColorTemperatureSentence(viralStyle?: ViralStyleAnalysisResult) {
  const note = viralStyle?.globalStyleNote?.trim();
  if (note && /暖|warm/i.test(note)) {
    return "暖色温（全套统一）";
  }
  if (note && /冷|cold|cool/i.test(note)) {
    return "冷色温（全套统一）";
  }
  return "中性（全套统一）";
}

function createLightQualitySentence(
  viralStyle: ViralStyleAnalysisResult | undefined,
  visualConsistency?: Record<string, unknown>,
) {
  const lightingAnchor = readVisualConsistencyText(visualConsistency, "lightingAnchor");
  const globalStyleNote = viralStyle?.globalStyleNote?.trim();
  if (lightingAnchor && globalStyleNote) {
    return `${lightingAnchor} + ${globalStyleNote}`;
  }
  if (lightingAnchor) {
    return `${lightingAnchor}，突出商品轮廓、材质和关键信息`;
  }
  if (globalStyleNote) {
    return globalStyleNote;
  }
  return "自然柔光为主，局部轮廓光突出商品边缘与材质";
}

function readVisualConsistencyText(visualConsistency: Record<string, unknown> | undefined, key: string) {
  const value = visualConsistency?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function createListingCopyDesignSpec(items: Array<{ designSpec?: string; groupTitle?: string }>) {
  const specs = Array.from(
    new Set(
      items
        .map((item) => item.designSpec?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (specs.length === 0) {
    return "设计规范：未提供明确设计规范，仅根据商品卖点生成上架文案。";
  }
  return specs.join("\n\n");
}

function createOriginalImageFidelityConstraint() {
  return "原图忠实约束：用户上传原图是商品唯一视觉事实源；核心商品主体只能做光影、背景、构图、清晰度和额外画面文案层面的微调，禁止重绘、换款、换包装、改颜色、改结构、改 Logo、改图案、改比例或新增未提供配件。必须逐项保留参考图中商品主体的原始色块、渐变、纹理、缝线、轮廓、版型、比例、Logo 位置、胸前英文印花文字、包装上的原有印花文字、图案和图形；这些原有文字和图案属于商品外观事实，不是需要生成的新文案，不得翻译、重写、删除或弱化，不得遮挡、改色或替换。";
}

function createViralStylePromptAnchor(viralStyle: ViralStyleAnalysisResult) {
  return [
    `爆款风格：${viralStyle.title}`,
    viralStyle.subtitle ? `风格语气：${viralStyle.subtitle}` : "",
    viralStyle.reasoning ? `推荐理由：${viralStyle.reasoning}` : "",
    viralStyle.designFocus ? `设计重点：${viralStyle.designFocus}` : "",
    viralStyle.globalStyleNote ? `全局光影氛围：${viralStyle.globalStyleNote}` : "",
    viralStyle.fontStyleDescription ? `字体气质：${viralStyle.fontStyleDescription}` : "",
    viralStyle.colors.length > 0 ? `沿用颜色：${viralStyle.colors.join("、")}` : "颜色：沿用输入风格，不新增颜色值",
    viralStyle.colorDescription ? `配色用途：${viralStyle.colorDescription}` : "",
    viralStyle.iconStyle ? `辅助图标风格：${viralStyle.iconStyle}` : "",
  ]
    .filter(Boolean)
    .join("；");
}

function createLocalePromptConstraint(settings: typeof defaultProductGenerationSettings) {
  const market = settings.market.toLowerCase();
  const language = settings.language.toLowerCase();
  const isChinaMarket =
    settings.market.includes("中国") || market === "cn" || market === "china" || market.includes("mainland china");
  const isChineseLanguage =
    settings.language.includes("中文") || language === "zh" || language.startsWith("zh-") || language.includes("chinese");

  if (isChinaMarket && isChineseLanguage) {
    return "国家与语言约束：若画面出现人物，必须是中国人或中国电商模特气质；新增画面文案、信息区文字和标注标签必须使用中文，不得新增英文或外文。参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响，必须按原图原样保留，不得翻译、重写、删除或替换。";
  }
  if (isChineseLanguage) {
    return "语言约束：新增画面文案、信息区文字和标注标签必须使用中文，不得新增英文或外文。参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响，必须按原图原样保留，不得翻译、重写、删除或替换。";
  }
  return "国家与语言约束：人物、场景和文字语言必须匹配目标市场与目标语言。";
}

function createVisualConsistencyPromptAnchor(visualConsistency?: Record<string, unknown>) {
  if (!visualConsistency) {
    return "";
  }
  const entries = [
    ["商品主体锚点", visualConsistency.productAnchor],
    ["背景锚点", visualConsistency.backgroundAnchor],
    ["光影锚点", visualConsistency.lightingAnchor],
    ["构图锚点", visualConsistency.compositionAnchor],
    ["文字区锚点", visualConsistency.textAreaAnchor],
  ]
    .map(([label, value]) => (typeof value === "string" && value.trim() ? `${label}：${value.trim()}` : ""))
    .filter(Boolean);
  return entries.length > 0 ? `视觉一致性：${entries.join("；")}` : "";
}

function createVisibleTextPromptConstraint() {
  return "生图文字约束：必须按照用户可修改文案要求生成画面内文字、结构化信息和已启用标注；文字必须清晰可读并使用目标语言；未在文案要求中列出的文字、乱码、伪文字、价格、销量、认证标识和虚假参数一律禁止。";
}

function findPromptPlanItemForStyle(
  draft: StrategyModuleDraft,
  viralStyle?: ViralStyleAnalysisResult,
): StrategyModulePromptPlanItem | undefined {
  if (!draft.promptPlanItems?.length) {
    return undefined;
  }
  if (!viralStyle) {
    return draft.promptPlanItems[0];
  }

  return (
    draft.promptPlanItems.find((item) => item.styleId && viralStyle.id && item.styleId === viralStyle.id) ??
    draft.promptPlanItems.find((item) => item.styleTitle && item.styleTitle === viralStyle.title)
  );
}

function createResultGroupSlug(title: string) {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "")
    .toLowerCase();
}

function createProductListingCopy(productPrompt: string): ProductListingCopy {
  const productName = productPrompt.trim() || "黑色宽松落肩夹克，双面领设计，通勤防风。";

  return {
    title: "Men's Japanese Style Loose Drop Shoulder Black Reversible Collar Casual Jacket",
    sellingPoints: [
      "Micro-silhouette cut, fits neatly and hides excess body fat for a crisp look",
      "Premium matte woven fabric, windproof, durable, anti-wrinkle and non-deformable",
      "2-way wearable stand/lapel collar, matches various styling for versatile daily wear",
    ],
    detailCopy:
      "This all-black casual jacket is designed for trend-focused commuters, street fashion enthusiasts and people looking for reliable daily outerwear. It fits perfectly for multiple scenarios including city daily commuting, offline friend gatherings and casual street shooting. No more trouble of messy wrinkles after long hours of wearing, no more limited outfit collocation options, this timeless basic piece will become your go-to staple for all daily occasions.",
    keywords:
      "men black jacket japanese style loose outerwear windproof anti wrinkle reversible collar jacket streetwear casual commuter jacket drop shoulder jacket",
    shootingPlan: [
      "White background image: Full front shot of the product, no extra elements, clearly shows the full outline and loose drop shoulder silhouette",
      "Scene image 1: Model wearing the jacket walking on busy city downtown street, showing the effect for daily commuting scenario",
      "Scene image 2: Model posing for photos at the trendy street corner, demonstrating the stylish street shooting effect",
      "Selling point image 1: Close-up shot of the matte woven fabric, showing the fine material texture with mark of windproof and anti-wrinkle performance",
      "Selling point image 2: Double angle shot showing both stand collar and lapel collar wearing effect, clearly display the 2-way wearing feature",
      "Other image 1: Model full-body matching display, showing how to pair the jacket with casual pants and sneakers for full daily styling",
      "Other image 2: Size chart display, clearly mark the detailed size parameters of the jacket for customers to choose proper fit",
    ],
    sourcePrompt: productName,
  };
}

function createClothingHistorySummary(drafts: ClothingSceneDraft[]) {
  const sceneNames = Array.from(new Set(drafts.map((draft) => draft.scene))).join("、");

  return `${sceneNames || "服饰场景"} · ${drafts.length} 张`;
}
