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
  ViralStyleAnalysisResult,
} from "../features/generation/components/GenerationConfigPanel";
import {
  PreviewCanvas,
  type GeneratedDetailImage,
} from "../features/generation/components/PreviewCanvas";
import {
  ClothingBaseModelGenerationCancelledError,
  createDefaultClothingSceneDrafts,
  defaultClothingConfig,
} from "../features/clothing/lib/clothingConfig";
import type {
  BaseModelGenerationInput,
  ClothingConfigState,
  ClothingSceneDraft,
  GeneratedBaseModelImage,
} from "../features/clothing/types";
import type { GenerationRecord } from "../features/history/components/GenerationHistoryPopover";
import {
  decodeScenePlanningOutput,
  defaultSceneConfig,
  sceneImageGenerationPromptVersion,
  scenePlanningPromptVersion,
  sceneTemplateCatalogVersion,
  type SceneConfigState,
  type SceneImagePlan,
  type ScenePlanningSnapshot,
} from "../features/scenes/lib/sceneImagePlan";
import { moduleOptions, navItems, previewBoards } from "./studioData";
import type { ProductImageAsset } from "../features/generation/lib/productImagePicker";
import {
  createFlatProductResultItems,
  createListingCopyDesignSpec,
  createProductDetailImagePlan,
  createProductListingCopy,
  createResultGroupSlug,
} from "../features/generation/lib/productDetailPlan";
import { localAiAssistPort } from "../runtime/local/ai-assist";
import { localGenerationPort } from "../runtime/local/generation";
import { localModelConfigPort } from "../runtime/local/model-config";
import {
  ImageTextRecognitionError,
  type GenerationTaskDetail,
  type GenerationTaskInputAssetInput,
  type ImageSizeOption,
  type ImageTextRecognitionResult,
  type ResultImageTextChange,
} from "../runtime";
import { useToast } from "../shared/ui/toast";
import {
  DeferredClothingPreviewCanvas,
  DeferredClothingWorkspacePanel,
  DeferredGenerationHistoryPopover,
  DeferredModelConfigPage,
  DeferredScenePreviewCanvas,
  DeferredSceneWorkspacePanel,
  DeferredSettingsPage,
  DeferredStudioContent,
} from "./components/deferredStudioComponents";
import {
  createClothingGenerationRecordFromTaskDetail,
  createGenerationRecordId,
  createProductGenerationRecordFromTaskDetail,
  createProductHistorySummary,
  createRestoredListingCopyImageFromTaskDetail,
  createRestoredSingleImageRetryPatchFromTaskDetail,
  createSceneGenerationRecordFromTaskDetail,
  createSceneRetryTaskInput,
  isRestoredTaskStale,
  isSingleImageRetryTaskDetail,
  mergeGenerationRecords,
  mergeRestoredListingCopyImages,
  mergeRestoredSingleImageRetryPatches,
  restoredImageMatchesRetryTarget,
} from "../features/history/lib/generationHistory";
import {
  createClothingHistorySummary,
  createClothingSceneDraftsFromTaskDetail,
  readClothingModelFeaturesFromTaskDetail,
} from "../features/clothing/lib/clothingGeneration";
import {
  applyGeneratedAssetOutputs,
  applyListingCopyOutput,
  applySceneGeneratedAssetOutputs,
  createProductDetailRetryPrompt,
  createTaskPollSignature,
  delay,
  deriveProductGenerationRecordStatus,
  failGeneratedImages,
  failListingCopyOutput,
  failProductImageOutputs,
  isTaskTerminal,
  normalizeAssetSrc,
  readOutputNumber,
  readOutputString,
  resolveGeneratedImageNo,
} from "../features/generation/lib/generationResultState";
import {
  createClothingInputAssets,
  createProductReferenceAssetViews,
  importProductInputAssets,
  mimeTypeFromImageName,
  referenceImagesToInputAssets,
} from "./lib/generationInputAssets";
import {
  deletePersistedGenerationRecord,
  deletePersistedGenerationTasks,
} from "./lib/generationTaskPersistence";
import type {
  RestoredListingCopyImage,
  RestoredSingleImageRetryPatch,
} from "../features/history/lib/generationHistory";

const productGenerationPollIntervalMs = 800;
const productGenerationMaxQueuedPollCount = 15;
export const productGenerationMaxUnchangedDurationMs = 360_000;
const productGenerationMaxUnchangedPollCount =
  productGenerationMaxUnchangedDurationMs / productGenerationPollIntervalMs;
const historyRestoreDetailConcurrency = 4;

async function cleanupUnmergedRetryTask(taskId: string, message: string) {
  try {
    await localGenerationPort.deleteTask(taskId);
    return message;
  } catch {
    return `${message}；未归并重试任务清理失败，请从生成记录中手动删除。`;
  }
}

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

type ClothingScenePlanningContext = {
  inputAssets: GenerationTaskInputAssetInput[];
  modelFeatures: unknown;
};

type ScenePlanningContext = {
  inputAssets: GenerationTaskInputAssetInput[];
  planningTaskId: string;
  referenceImages: ProductImageAsset[];
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
    generatedBaseModelImages: [],
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
  const [clothingScenePlanning, setClothingScenePlanning] = useState(false);
  const [clothingSceneDrafts, setClothingSceneDrafts] = useState(createDefaultClothingSceneDrafts);
  const [clothingSceneImages, setClothingSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [clothingSceneGenerating, setClothingSceneGenerating] = useState(false);
  const [clothingBaseModelGenerationSessionId, setClothingBaseModelGenerationSessionId] = useState(0);
  const [sceneConfig, setSceneConfig] = useState(createDefaultSceneConfig);
  const [scenePromptReviewing, setScenePromptReviewing] = useState(false);
  const [scenePlanGenerating, setScenePlanGenerating] = useState(false);
  const [scenePlanningSnapshot, setScenePlanningSnapshot] = useState<ScenePlanningSnapshot | null>(null);
  const [sceneImagePlans, setSceneImagePlans] = useState<SceneImagePlan[]>([]);
  const [sceneImages, setSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [sceneImageGenerating, setSceneImageGenerating] = useState(false);
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const [activeGenerationRecordId, setActiveGenerationRecordId] = useState<string | null>(null);
  const [historyViewingRecordIds, setHistoryViewingRecordIds] = useState<
    Record<GenerationRecord["workspace"], string | null>
  >({ clothing: null, product: null, scene: null });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMounted, setHistoryMounted] = useState(false);
  const [productGeneratingRecordId, setProductGeneratingRecordId] = useState<string | null>(null);
  const [clothingGeneratingRecordId, setClothingGeneratingRecordId] = useState<string | null>(null);
  const activeGenerationRecordIdRef = useRef<string | null>(null);
  const historyViewingRecordIdsRef = useRef<Record<GenerationRecord["workspace"], string | null>>({
    clothing: null,
    product: null,
    scene: null,
  });
  const displayedGenerationRecordIdsRef = useRef<Record<GenerationRecord["workspace"], string | null>>({
    clothing: null,
    product: null,
    scene: null,
  });
  const deletedGenerationRecordIdsRef = useRef(new Set<string>());
  const clothingRetrySequenceRef = useRef(0);
  const sceneRetrySequenceRef = useRef(0);
  const clothingGeneratingRecordIdRef = useRef<string | null>(null);
  const clothingScenePlanningRequestIdRef = useRef(0);
  const clothingScenePlanningTaskIdsRef = useRef(new Set<string>());
  const clothingScenePlanningCancellationsRef = useRef(new Map<string, Promise<boolean>>());
  const clothingScenePlanningContextRef = useRef<ClothingScenePlanningContext | null>(null);
  const scenePlanningRequestIdRef = useRef(0);
  const sceneGenerationRequestIdRef = useRef(0);
  const sceneTaskIdsRef = useRef(new Set<string>());
  const scenePlanningContextRef = useRef<ScenePlanningContext | null>(null);
  const clothingBaseModelGenerationRequestIdRef = useRef(0);
  const clothingBaseModelGenerationTaskIdRef = useRef<string | null>(null);
  const clothingBaseModelCancellationRef = useRef<{ promise: Promise<boolean>; taskId: string } | null>(null);
  const isClothingWorkspace = activeWorkspace === "clothing";
  const isModelWorkspace = activeWorkspace === "model";
  const isSceneWorkspace = activeWorkspace === "scene";
  const isSettingsWorkspace = activeWorkspace === "settings";
  const historyViewingRecordId =
    activeWorkspace === "product" || activeWorkspace === "clothing" || activeWorkspace === "scene"
      ? historyViewingRecordIds[activeWorkspace]
      : null;
  const activeHistoryRecordId =
    activeWorkspace === "product" || activeWorkspace === "clothing" || activeWorkspace === "scene"
      ? displayedGenerationRecordIdsRef.current[activeWorkspace]
      : activeGenerationRecordId;
  const historyViewingRecord = historyViewingRecordId
    ? generationRecords.find((record) => record.id === historyViewingRecordId)
    : null;
  const isGenerationResultViewing =
    historyViewingRecordId !== null &&
    historyViewingRecord !== null &&
    historyViewingRecord !== undefined &&
    displayedGenerationRecordIdsRef.current[historyViewingRecord.workspace] === historyViewingRecordId &&
    historyViewingRecord.workspace === activeWorkspace &&
    historyViewingRecord.status !== "generating" &&
    ((activeWorkspace === "product" && productDetailImages.length > 0) ||
      (activeWorkspace === "clothing" && clothingSceneImages.length > 0) ||
      (activeWorkspace === "scene" && sceneImages.length > 0));
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const { showToast } = useToast();

  useEffect(() => {
    activeGenerationRecordIdRef.current = activeGenerationRecordId;
  }, [activeGenerationRecordId]);

  function handleProductGenerationSettingsChange(settings: typeof productGenerationSettings) {
    setProductGenerationSettings(settings);
    setProductGenerationSettingsTouched(true);
  }

  function setDisplayedGenerationRecordId(workspace: GenerationRecord["workspace"], recordId: string | null) {
    displayedGenerationRecordIdsRef.current[workspace] = recordId;
  }

  function setHistoryViewingRecordId(workspace: GenerationRecord["workspace"], recordId: string | null) {
    historyViewingRecordIdsRef.current[workspace] = recordId;
    setHistoryViewingRecordIds((currentIds) =>
      currentIds[workspace] === recordId ? currentIds : { ...currentIds, [workspace]: recordId },
    );
  }

  function isDisplayedGenerationRecord(recordId: string, workspace: GenerationRecord["workspace"]) {
    return displayedGenerationRecordIdsRef.current[workspace] === recordId;
  }

  function clearActiveGenerationRecordForWorkspace(workspace: "clothing" | "product" | "scene") {
    setDisplayedGenerationRecordId(workspace, null);
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
    setHistoryViewingRecordId("product", null);
    clearActiveGenerationRecordForWorkspace("product");
  }

  function invalidateClothingScenePlanning() {
    clothingScenePlanningRequestIdRef.current += 1;
    clothingScenePlanningContextRef.current = null;
    void cancelTrackedClothingPlanningTasks();
  }

  function invalidateClothingBaseModelGeneration() {
    clothingBaseModelGenerationRequestIdRef.current += 1;
    const taskId = clothingBaseModelGenerationTaskIdRef.current;
    if (taskId) {
      void cancelClothingBaseModelTask(taskId);
    }
  }

  function invalidateSceneTasks() {
    scenePlanningRequestIdRef.current += 1;
    sceneGenerationRequestIdRef.current += 1;
    scenePlanningContextRef.current = null;
    const taskIds = [...sceneTaskIdsRef.current];
    sceneTaskIdsRef.current.clear();
    const taskIdSet = new Set(taskIds);
    setGenerationRecords((records) =>
      records.map((record) => {
        const tracksCancelledTask =
          (record.persistedTaskId ? taskIdSet.has(record.persistedTaskId) : false) ||
          (record.relatedTaskIds ?? []).some((taskId) => taskIdSet.has(taskId));
        if (record.workspace !== "scene" || !tracksCancelledTask) {
          return record;
        }
        const images = failGeneratedImages(record.images, "任务已取消");
        return { ...record, images, status: deriveProductGenerationRecordStatus(images) };
      }),
    );
    taskIds.forEach((taskId) => {
      void localGenerationPort.cancelTask(taskId).catch((error) => {
        console.warn("cancel scene task failed", { error, taskId });
      });
    });
  }

  function resetClothingWorkspace() {
    invalidateClothingBaseModelGeneration();
    invalidateClothingScenePlanning();
    setClothingBaseModelGenerationSessionId((currentSessionId) => currentSessionId + 1);
    setClothingConfig(createDefaultClothingConfig());
    setClothingSceneDrafting(false);
    setClothingScenePlanning(false);
    setClothingSceneDrafts(createDefaultClothingSceneDrafts());
    setClothingSceneImages([]);
    setClothingSceneGenerating(false);
    setClothingGeneratingRecordId(null);
    clothingGeneratingRecordIdRef.current = null;
    setHistoryOpen(false);
    setHistoryViewingRecordId("clothing", null);
    clearActiveGenerationRecordForWorkspace("clothing");
  }

  function resetSceneWorkspace() {
    invalidateSceneTasks();
    setSceneConfig(createDefaultSceneConfig());
    setScenePromptReviewing(false);
    setScenePlanGenerating(false);
    setSceneImagePlans([]);
    setScenePlanningSnapshot(null);
    setSceneImages([]);
    setSceneImageGenerating(false);
    setHistoryOpen(false);
    setHistoryViewingRecordId("scene", null);
    clearActiveGenerationRecordForWorkspace("scene");
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

  function handleToggleHistory() {
    if (!historyOpen) {
      setHistoryMounted(true);
    }
    setHistoryOpen((open) => !open);
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
    setDisplayedGenerationRecordId("product", recordId);
    setActiveGenerationRecordId(recordId);
    setHistoryViewingRecordId("product", null);
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

  async function handleGenerateBaseModel(input: BaseModelGenerationInput): Promise<GeneratedBaseModelImage> {
    const requestId = clothingBaseModelGenerationRequestIdRef.current + 1;
    clothingBaseModelGenerationRequestIdRef.current = requestId;
    const previousTaskId = clothingBaseModelGenerationTaskIdRef.current;
    let taskId: string | null = null;
    let taskReachedTerminal = false;

    try {
      if (previousTaskId) {
        const cancelled = await cancelClothingBaseModelTask(previousTaskId);
        if (clothingBaseModelGenerationRequestIdRef.current !== requestId) {
          throw new ClothingBaseModelGenerationCancelledError();
        }
        if (!cancelled) {
          throw new ClothingBaseModelGenerationCancelledError();
        }
      }
      const task = await localGenerationPort.createTask({
        idempotencyKey: `clothing-base-model:${Date.now()}`,
        input: {
          age: input.age,
          appearance: input.appearance,
          body: input.body,
          ethnicity: input.ethnicity,
          gender: input.gender,
          kind: "clothing-base-model-generation",
          mockImageCount: 1,
          promptTemplateId: "clothing-base-model-generation",
        },
        kind: "image-generation",
        title: "生成基准模特",
        workspace: "clothing",
      });
      taskId = task.id;
      if (clothingBaseModelGenerationRequestIdRef.current !== requestId) {
        void cancelClothingBaseModelTask(task.id);
        throw new ClothingBaseModelGenerationCancelledError();
      }
      clothingBaseModelGenerationTaskIdRef.current = task.id;

      await requestGenerationTaskStart(task.id, "基准模特任务未能按当前记录启动，请稍后重试。");
      if (clothingBaseModelGenerationRequestIdRef.current !== requestId) {
        throw new ClothingBaseModelGenerationCancelledError();
      }
      const detail = await pollClothingBaseModelTask(task.id, requestId);
      taskReachedTerminal = true;
      if (clothingBaseModelGenerationRequestIdRef.current !== requestId) {
        throw new ClothingBaseModelGenerationCancelledError();
      }
      if (detail.task.status === "failed" && detail.outputAssets.length === 0) {
        throw new Error(detail.task.error?.message ?? "基准模特生成失败。");
      }
      const outputAsset = [...detail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0]?.asset;
      const imagePath = outputAsset?.localPath ?? outputAsset?.relativePath;
      const imageSrc = outputAsset?.url ?? outputAsset?.localPath ?? outputAsset?.relativePath;
      if (!outputAsset || !imagePath || !imageSrc) {
        throw new Error("基准模特生成结果缺少本地图片。");
      }

      return {
        assetId: outputAsset.id,
        id: outputAsset.id,
        name: "基准模特图",
        path: imagePath,
        src: normalizeAssetSrc(imageSrc),
        status: "ready",
      };
    } finally {
      if (
        taskId &&
        taskReachedTerminal &&
        clothingBaseModelGenerationRequestIdRef.current === requestId &&
        clothingBaseModelGenerationTaskIdRef.current === taskId
      ) {
        clothingBaseModelGenerationTaskIdRef.current = null;
      }
    }
  }

  function cancelClothingBaseModelTask(taskId: string): Promise<boolean> {
    const pendingCancellation = clothingBaseModelCancellationRef.current;
    if (pendingCancellation?.taskId === taskId) {
      return pendingCancellation.promise;
    }

    const promise = localGenerationPort
      .cancelTask(taskId)
      .then(() => {
        if (clothingBaseModelGenerationTaskIdRef.current === taskId) {
          clothingBaseModelGenerationTaskIdRef.current = null;
        }
        return true;
      })
      .catch(async () => {
        try {
          const taskDetail = await localGenerationPort.getTaskDetail(taskId);
          if (isTaskTerminal(taskDetail.task.status)) {
            if (clothingBaseModelGenerationTaskIdRef.current === taskId) {
              clothingBaseModelGenerationTaskIdRef.current = null;
            }
            return true;
          }
        } catch {
          // 详情读取失败时仍按取消失败处理，保留任务引用供后续重试。
        }
        showToast({
          message: "基准模特任务取消失败：后台任务可能仍在继续，请稍后在生成记录中检查。",
          variant: "warning",
        });
        return false;
      })
      .finally(() => {
        if (clothingBaseModelCancellationRef.current?.promise === promise) {
          clothingBaseModelCancellationRef.current = null;
        }
      });
    clothingBaseModelCancellationRef.current = { promise, taskId };
    return promise;
  }

  async function pollClothingBaseModelTask(taskId: string, requestId: number): Promise<GenerationTaskDetail> {
    let lastPollSignature = "";
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    for (;;) {
      if (clothingBaseModelGenerationRequestIdRef.current !== requestId) {
        throw new ClothingBaseModelGenerationCancelledError();
      }
      const taskDetail = await localGenerationPort.getTaskDetail(taskId);
      if (clothingBaseModelGenerationRequestIdRef.current !== requestId) {
        throw new ClothingBaseModelGenerationCancelledError();
      }
      const pollSignature = createTaskPollSignature(taskDetail);
      if (pollSignature !== lastPollSignature) {
        console.info("clothing base model task poll", {
          outputAssetCount: taskDetail.outputAssets.length,
          stage: taskDetail.task.stage,
          status: taskDetail.task.status,
          taskId,
        });
        lastPollSignature = pollSignature;
        unchangedPollCount = 0;
      } else {
        unchangedPollCount += 1;
      }

      queuedPollCount = taskDetail.task.status === "queued" ? queuedPollCount + 1 : 0;
      if (taskDetail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "基准模特任务未能按当前记录启动，请稍后重试。");
      }
      if (isTaskTerminal(taskDetail.task.status)) {
        return taskDetail;
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        throw new Error("基准模特任务长时间未启动，请检查后台任务执行状态。");
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        throw new Error("基准模特生成长时间无进展，请检查模型配置或后台任务日志。");
      }
      await delay(productGenerationPollIntervalMs);
    }
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
    if (isDisplayedGenerationRecord(recordId, "product")) {
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

  function updateClothingSceneImageById(
    imageId: string,
    updater: (image: GeneratedDetailImage) => GeneratedDetailImage,
  ) {
    setClothingSceneImages((currentImages) => currentImages.map((image) => (image.id === imageId ? updater(image) : image)));
    setGenerationRecords((currentRecords) =>
      currentRecords.map((record) => {
        if (record.workspace !== "clothing" || !record.images.some((recordImage) => recordImage.id === imageId)) {
          return record;
        }
        const images = record.images.map((recordImage) => (recordImage.id === imageId ? updater(recordImage) : recordImage));
        return {
          ...record,
          images,
          status: deriveProductGenerationRecordStatus(images),
        };
      }),
    );
  }

  function updateSceneImageById(
    recordId: string,
    imageId: string,
    updater: (image: GeneratedDetailImage) => GeneratedDetailImage,
  ) {
    if (isDisplayedGenerationRecord(recordId, "scene")) {
      setSceneImages((currentImages) => currentImages.map((image) => (image.id === imageId ? updater(image) : image)));
    }
    setGenerationRecords((currentRecords) =>
      currentRecords.map((record) => {
        if (record.id !== recordId || record.workspace !== "scene") {
          return record;
        }
        const images = record.images.map((image) => (image.id === imageId ? updater(image) : image));
        return { ...record, images, status: deriveProductGenerationRecordStatus(images) };
      }),
    );
  }

  function updateGeneratedImageForRecord(
    recordId: string,
    workspace: GenerationRecord["workspace"],
    imageId: string,
    updater: (image: GeneratedDetailImage) => GeneratedDetailImage,
  ) {
    if (isDisplayedGenerationRecord(recordId, workspace)) {
      const updateImages = (currentImages: GeneratedDetailImage[]) =>
        currentImages.map((image) => (image.id === imageId ? updater(image) : image));
      if (workspace === "product") {
        setProductDetailImages(updateImages);
      } else if (workspace === "clothing") {
        setClothingSceneImages(updateImages);
      } else {
        setSceneImages(updateImages);
      }
    }
    setGenerationRecords((currentRecords) =>
      currentRecords.map((record) => {
        if (record.id !== recordId || record.workspace !== workspace) {
          return record;
        }
        const images = record.images.map((image) => (image.id === imageId ? updater(image) : image));
        return { ...record, images, status: deriveProductGenerationRecordStatus(images) };
      }),
    );
  }

  function removeGeneratedImageById(
    imageId: string,
    workspace: "clothing" | "product" | "scene",
    recordId: string,
  ) {
    if (isDisplayedGenerationRecord(recordId, workspace)) {
      const removeImage = (currentImages: GeneratedDetailImage[]) =>
        currentImages.filter((image) => image.id !== imageId);
      if (workspace === "product") {
        setProductDetailImages(removeImage);
      } else if (workspace === "clothing") {
        setClothingSceneImages(removeImage);
      } else {
        setSceneImages(removeImage);
      }
    }
    setGenerationRecords((currentRecords) =>
      currentRecords.map((record) => {
        if (record.id !== recordId || record.workspace !== workspace) {
          return record;
        }
        const images = record.images.filter((image) => image.id !== imageId);
        return {
          ...record,
          images,
          status: deriveProductGenerationRecordStatus(images),
        };
      }),
    );
  }

  function findGeneratedImageRecord(imageId: string, workspace: GenerationRecord["workspace"]) {
    const displayedRecordId = displayedGenerationRecordIdsRef.current[workspace];
    return generationRecords.find(
      (record) =>
        record.id === displayedRecordId &&
        record.workspace === workspace &&
        record.images.some((image) => image.id === imageId),
    );
  }

  async function loadGeneratedImageSizeOptions() {
    return localModelConfigPort.listImageSizeOptions("image-edit");
  }

  async function findPersistedResultAsset(parentTaskId: string, imageNo: number) {
    const detail = await localGenerationPort.getTaskDetail(parentTaskId);
    return detail.outputAssets.find((item) => item.sortOrder === imageNo - 1)?.asset;
  }

  async function resolvePersistedResultAsset(parentTaskId: string, imageNo: number) {
    const result = await findPersistedResultAsset(parentTaskId, imageNo);
    if (!result) {
      throw new Error("当前图片在原生成任务中缺少可操作的结果资产。");
    }
    return result;
  }

  async function resizeGeneratedImage(image: GeneratedDetailImage, option: ImageSizeOption) {
    const workspace = activeWorkspace === "scene" || activeWorkspace === "clothing" ? activeWorkspace : "product";
    const parentRecord = findGeneratedImageRecord(image.id, workspace);
    if (!parentRecord?.persistedTaskId || !image.assetId) {
      const message = "当前图片缺少可替换的任务或资产信息。";
      throw new Error(message);
    }

    const imageNo =
      image.imageNo ??
      parentRecord.images
        .filter((recordImage) => recordImage.kind !== "source-image" && recordImage.kind !== "listing-copy")
        .findIndex((recordImage) => recordImage.id === image.id) +
        1;
    if (imageNo <= 0) {
      const message = "当前图片缺少稳定的结果序号。";
      throw new Error(message);
    }

    const persistedAsset = await resolvePersistedResultAsset(parentRecord.persistedTaskId, imageNo);

    const basePrompt = image.prompt?.trim() || image.sceneDescription?.trim() || `保持“${image.title}”的现有内容一致。`;
    const resolvedPrompt = `${basePrompt}\n\n尺寸修改要求：保持当前图片的人物、商品、服饰、场景、动作、构图信息和文字内容一致，仅将画布调整为 ${option.ratio}（${option.width}×${option.height}）。不得替换主体或重新设计画面。`;
    const task = await localGenerationPort.createTask({
      idempotencyKey: `${image.id}:resize:${option.providerValue}:${Date.now()}`,
      workspace: parentRecord.workspace,
      kind: "image-edit",
      title: `修改尺寸 ${image.title}`,
      input: {
        kind: "result-image-resize",
        parentTaskId: parentRecord.persistedTaskId,
        targetImageId: image.id,
        imageNo,
        sourceAssetId: image.assetId,
        basePrompt,
        ratio: option.ratio,
        size: option.providerValue,
        prompt: {
          messages: [
            {
              role: "system",
              content: "你是专业商拍图片尺寸调整助手。必须严格保持参考图主体、身份、服饰、商品、场景、动作、构图和文字信息一致，只调整画布比例与尺寸。",
            },
            {
              role: "user",
              content: resolvedPrompt,
            },
          ],
          rolelessPrompt: resolvedPrompt,
        },
      },
      inputAssets: [{ assetId: image.assetId, role: "reference", sortOrder: 0 }],
    });

    let unmergedSucceededTaskId: string | null = null;
    try {
      await requestGenerationTaskStart(task.id, "图片尺寸修改任务未能启动。");
      const replacement = await pollGeneratedImageReplacement(task.id);
      unmergedSucceededTaskId = task.id;
      await localGenerationPort.replaceResultImage({
        taskId: parentRecord.persistedTaskId,
        currentAssetId: persistedAsset.id,
        displayedAssetId: image.assetId,
        replacementTaskId: task.id,
        replacementAssetId: replacement.asset.id,
      });
      unmergedSucceededTaskId = null;
      const updateImage = (currentImage: GeneratedDetailImage): GeneratedDetailImage => ({
        ...currentImage,
        assetId: replacement.asset.id,
        assetLocalPath: replacement.asset.localPath,
        assetRelativePath: replacement.asset.relativePath,
        errorMessage: undefined,
        height: replacement.asset.height ?? option.height,
        ratio: option.ratio,
        src: replacement.asset.url ?? replacement.asset.localPath,
        status: "complete",
        width: replacement.asset.width ?? option.width,
      });
      updateGeneratedImageForRecord(parentRecord.id, parentRecord.workspace, image.id, updateImage);
      showToast({ message: "图片尺寸已修改", variant: "success" });
    } catch (error) {
      let message = error instanceof Error ? error.message : "图片尺寸修改失败。";
      if (unmergedSucceededTaskId) {
        message = await cleanupUnmergedRetryTask(unmergedSucceededTaskId, message);
      }
      throw new Error(message);
    }
  }

  async function deleteGeneratedImage(image: GeneratedDetailImage) {
    const workspace = activeWorkspace === "scene" || activeWorkspace === "clothing" ? activeWorkspace : "product";
    const parentRecord = findGeneratedImageRecord(image.id, workspace);
    if (!parentRecord?.persistedTaskId) {
      const message = "当前图片缺少可删除的任务信息。";
      showToast({ message, variant: "error" });
      throw new Error(message);
    }
    const imageNo =
      image.imageNo ??
      parentRecord.images
        .filter((recordImage) => recordImage.kind !== "source-image" && recordImage.kind !== "listing-copy")
        .findIndex((recordImage) => recordImage.id === image.id) +
        1;
    if (imageNo <= 0) {
      const message = "当前图片缺少稳定的结果序号。";
      showToast({ message, variant: "error" });
      throw new Error(message);
    }
    try {
      const persistedAsset = await findPersistedResultAsset(parentRecord.persistedTaskId, imageNo);
      await localGenerationPort.deleteResultImage({
        taskId: parentRecord.persistedTaskId,
        imageId: image.id,
        imageNo,
        ...(persistedAsset ? { assetId: persistedAsset.id } : {}),
        ...(image.assetId ? { displayedAssetId: image.assetId } : {}),
      });
      removeGeneratedImageById(image.id, parentRecord.workspace, parentRecord.id);
      showToast({ message: "图片已删除", variant: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片删除失败。";
      showToast({ message, variant: "error" });
      throw error;
    }
  }

  async function pollGeneratedImageReplacement(taskId: string, operationName = "图片尺寸修改") {
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    let lastPollSignature = "";
    for (;;) {
      const detail = await localGenerationPort.getTaskDetail(taskId);
      const outputAsset = [...detail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0];
      if (detail.task.status === "succeeded" && outputAsset) {
        return outputAsset;
      }
      if (detail.task.status === "failed" || detail.task.status === "cancelled" || detail.task.status === "interrupted") {
        throw new Error(detail.task.error?.message ?? `${operationName}失败。`);
      }
      if (isTaskTerminal(detail.task.status)) {
        throw new Error(`${operationName}结果缺少可用图片。`);
      }

      const signature = createTaskPollSignature(detail);
      if (signature === lastPollSignature) {
        unchangedPollCount += 1;
      } else {
        lastPollSignature = signature;
        unchangedPollCount = 0;
      }
      queuedPollCount = detail.task.status === "queued" ? queuedPollCount + 1 : 0;
      if (detail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, `${operationName}任务未能启动。`);
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        throw new Error(`${operationName}任务长时间未启动，请检查后台任务状态。`);
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        throw new Error(`${operationName}任务长时间无进展，请检查模型配置或后台日志。`);
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  async function retryClothingSceneImage(image: GeneratedDetailImage) {
    const imageBeforeRetry = { ...image };
    let unmergedSucceededTaskId: string | null = null;
    try {
      const parentRecord = generationRecords.find(
        (record) => record.workspace === "clothing" && record.images.some((recordImage) => recordImage.id === image.id),
      );
      if (!parentRecord?.persistedTaskId) {
        throw new Error("找不到服饰场景图所属任务，无法重新生成。");
      }

      const originalDetail = await localGenerationPort.getTaskDetail(parentRecord.persistedTaskId);
      const originalInput = originalDetail.input && typeof originalDetail.input === "object" ? (originalDetail.input as Record<string, unknown>) : null;
      const originalItems = Array.isArray(originalInput?.items) ? originalInput.items : [];
      const imageNo = resolveGeneratedImageNo(image, parentRecord.images);
      const retryItem = originalItems[imageNo - 1];
      if (!retryItem || typeof retryItem !== "object") {
        throw new Error("服饰场景图缺少可复用的生成参数，无法重新生成。");
      }
      const inputAssets: GenerationTaskInputAssetInput[] = originalDetail.inputAssets.flatMap((item) => {
        if (item.role !== "source" && item.role !== "reference" && item.role !== "model") {
          return [];
        }
        return [
          {
            assetId: item.asset.id,
            role: item.role as GenerationTaskInputAssetInput["role"],
            sortOrder: item.sortOrder,
          },
        ];
      });
      if (inputAssets.length === 0) {
        throw new Error("服饰场景图缺少可复用的参考图资产，无法重新生成。");
      }

      const retryInput = {
        ...originalInput,
        items: [
          {
            ...(retryItem as Record<string, unknown>),
            imageId: image.id,
            imageNo,
            title: image.title,
          },
        ],
        parentTaskId: parentRecord.persistedTaskId,
        retrySequence: Math.max(Date.now(), clothingRetrySequenceRef.current + 1),
      };
      clothingRetrySequenceRef.current = retryInput.retrySequence;
      updateClothingSceneImageById(image.id, (currentImage) => ({
        ...currentImage,
        errorMessage: undefined,
        status: "generating",
      }));

      const task = await localGenerationPort.createTask({
        idempotencyKey: `${image.id}:retry:${Date.now()}`,
        input: retryInput,
        inputAssets,
        kind: "image-generation",
        title: `重新生成 ${image.title}`,
        workspace: "clothing",
      });
      if (!task?.id) {
        throw new Error("服饰场景图重新生成任务创建失败。");
      }
      if (deletedGenerationRecordIdsRef.current.has(parentRecord.id)) {
        deletePersistedGenerationTasks([task.id]);
        return;
      }
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === parentRecord.id
            ? { ...record, relatedTaskIds: Array.from(new Set([...(record.relatedTaskIds ?? []), task.id])) }
            : record,
        ),
      );

      let retryImages: GeneratedDetailImage[] = [{ ...image, errorMessage: undefined, status: "generating" }];
      await requestGenerationTaskStart(task.id, "服饰场景图重新生成任务未能启动。");
      const retryDetail = await pollClothingImageTask(
        task.id,
        () => retryImages,
        (nextImages) => {
          retryImages = nextImages;
        },
      );
      const retryOutput = [...retryDetail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0];
      if (!retryOutput) {
        throw new Error("服饰场景图重新生成结果缺少可用图片。");
      }
      unmergedSucceededTaskId = task.id;
      const currentAsset = await findPersistedResultAsset(parentRecord.persistedTaskId, imageNo);
      await localGenerationPort.replaceResultImage({
        taskId: parentRecord.persistedTaskId,
        ...(currentAsset ? { currentAssetId: currentAsset.id } : {}),
        ...(image.assetId ? { displayedAssetId: image.assetId } : {}),
        replacementTaskId: task.id,
        replacementAssetId: retryOutput.asset.id,
      });
      unmergedSucceededTaskId = null;
      const retriedImage = retryImages[0];
      if (!retriedImage) {
        throw new Error("服饰场景图重新生成结果缺少可展示图片。");
      }
      updateClothingSceneImageById(image.id, () => retriedImage);
    } catch (error) {
      let message = error instanceof Error ? error.message : "服饰场景图重新生成失败。";
      if (unmergedSucceededTaskId) {
        message = await cleanupUnmergedRetryTask(unmergedSucceededTaskId, message);
      }
      updateClothingSceneImageById(image.id, () => ({
        ...imageBeforeRetry,
        errorMessage: message,
        status: "failed",
      }));
      showToast({ message: `服饰场景图重新生成失败：${message}`, variant: "error" });
    }
  }

  async function retryProductDetailImage(image: GeneratedDetailImage) {
    const imageBeforeRetry = { ...image };
    const parentRecord = generationRecords.find(
      (record) => record.workspace === "product" && record.images.some((recordImage) => recordImage.id === image.id),
    );
    const parentTaskId = parentRecord?.persistedTaskId;
    if (!parentTaskId) {
      throw new Error("找不到商品详情图所属任务，无法重新生成。");
    }
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

    let unmergedSucceededTaskId: string | null = null;
    try {
      const task = await localGenerationPort.createTask({
        idempotencyKey: `${image.id}:retry:${Date.now()}`,
        workspace: "product",
        kind: "image-generation",
        title: `重新生成 ${image.title}`,
        promptPlanId: promptPlanSnapshot.planId,
        input: {
          kind: "product-detail-generation",
          parentTaskId,
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
      const retryOutput = await pollProductSingleImageTask(task.id, image.id);
      unmergedSucceededTaskId = task.id;
      const currentAsset = await findPersistedResultAsset(parentTaskId, imageNo);
      await localGenerationPort.replaceResultImage({
        taskId: parentTaskId,
        ...(currentAsset ? { currentAssetId: currentAsset.id } : {}),
        ...(image.assetId ? { displayedAssetId: image.assetId } : {}),
        replacementTaskId: task.id,
        replacementAssetId: retryOutput.asset.id,
      });
      unmergedSucceededTaskId = null;
      updateProductDetailImageById(image.id, () => ({
        ...imageBeforeRetry,
        assetId: retryOutput.asset.id,
        assetLocalPath: retryOutput.asset.localPath,
        assetRelativePath: retryOutput.asset.relativePath,
        errorMessage: undefined,
        height: retryOutput.asset.height,
        referenceImages,
        src: retryOutput.asset.url ?? retryOutput.asset.localPath,
        status: "complete",
        width: retryOutput.asset.width,
      }));
    } catch (error) {
      let message = error instanceof Error ? error.message : "单图重新生成失败。";
      if (unmergedSucceededTaskId) {
        message = await cleanupUnmergedRetryTask(unmergedSucceededTaskId, message);
      }
      updateProductDetailImageById(image.id, () => ({
        ...imageBeforeRetry,
        errorMessage: message,
        referenceImages,
        status: "failed",
      }));
      showToast({ message: `单图重新生成失败：${message}`, variant: "error" });
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
      if (isDisplayedGenerationRecord(parentRecord.id, "product")) {
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
      if (
        imageTaskDetail.task.status === "succeeded" &&
        (firstOutputAsset?.asset.url || firstOutputAsset?.asset.localPath)
      ) {
        return firstOutputAsset;
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

  async function persistGeneratedImageRewriteTask(image: GeneratedDetailImage, instruction: string) {
    const rewriteInstruction = instruction.trim() || "按当前图片 prompt 重新生成，保持主体和信息区一致。";
    return persistGeneratedImageEditTask(image, {
      idempotencyScope: "rewrite",
      inputKind: "result-image-rewrite",
      input: { rewriteInstruction },
      taskTitle: `微调 ${image.title}`,
    });
  }

  async function recognizeGeneratedImageText(image: GeneratedDetailImage): Promise<ImageTextRecognitionResult> {
    const workspace = activeWorkspace === "scene" || activeWorkspace === "clothing" ? activeWorkspace : "product";
    const parentRecord = findGeneratedImageRecord(image.id, workspace);
    const currentImage = parentRecord?.images.find((recordImage) => recordImage.id === image.id);
    if (!image.assetId || currentImage?.assetId !== image.assetId) {
      throw new ImageTextRecognitionError({
        code: "ASSET_NOT_FOUND",
        message: "当前图片已变化，请重新打开文字编辑。",
        retryable: false,
      });
    }
    return localAiAssistPort.recognizeImageText({ assetId: image.assetId });
  }

  function notifyImageTextRecognitionEmpty() {
    showToast({ message: "未识别到文字", variant: "warning" });
  }

  function notifyImageTextRewriteError(message: string) {
    showToast({ message, variant: "error" });
  }

  async function persistGeneratedImageTextRewriteTask(
    image: GeneratedDetailImage,
    changes: ResultImageTextChange[],
  ) {
    const workspace = activeWorkspace === "scene" || activeWorkspace === "clothing" ? activeWorkspace : "product";
    const parentRecord = findGeneratedImageRecord(image.id, workspace);
    const currentImage = parentRecord?.images.find((recordImage) => recordImage.id === image.id);
    if (!image.assetId || currentImage?.assetId !== image.assetId) {
      throw new Error("当前图片已变化，请重新识别文字。");
    }
    await persistGeneratedImageEditTask(image, {
      idempotencyScope: "text-rewrite",
      inputKind: "result-image-text-rewrite",
      input: { changes },
      taskTitle: `修改文字 ${image.title}`,
    });
  }

  async function persistGeneratedImageEditTask(
    image: GeneratedDetailImage,
    edit: {
      idempotencyScope: string;
      input: Record<string, unknown>;
      inputKind: string;
      taskTitle: string;
    },
  ) {
    const workspace = activeWorkspace === "scene" || activeWorkspace === "clothing" ? activeWorkspace : "product";
    const parentRecord = findGeneratedImageRecord(image.id, workspace);
    if (!parentRecord?.persistedTaskId || !image.assetId) {
      throw new Error("AI 改图缺少原生成任务或结果资产，无法建立可追踪的替换关系。");
    }
    const imageNo = resolveGeneratedImageNo(image, parentRecord.images);
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
      idempotencyKey: `${image.id}:${edit.idempotencyScope}:${Date.now()}`,
      workspace: parentRecord.workspace,
      kind: "image-edit",
      title: edit.taskTitle,
      input: {
        kind: edit.inputKind,
        parentTaskId: parentRecord.persistedTaskId,
        targetImageId: image.id,
        imageNo,
        sourceAssetId: image.assetId,
        sourceImageId: image.id,
        sourceImageNo: imageNo,
        sourceImageTitle: image.title,
        ...edit.input,
      },
      inputAssets,
    });
    if (!task?.id) {
      throw new Error("AI 改图任务创建失败。");
    }
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
    let unmergedSucceededTaskId: string | null = null;
    try {
      await requestGenerationTaskStart(task.id, "AI 改图任务未能启动。");
      const replacement = await pollGeneratedImageReplacement(task.id, "AI 改图");
      unmergedSucceededTaskId = task.id;
      const persistedAsset = await resolvePersistedResultAsset(parentRecord.persistedTaskId, imageNo);
      await localGenerationPort.replaceResultImage({
        taskId: parentRecord.persistedTaskId,
        currentAssetId: persistedAsset.id,
        displayedAssetId: image.assetId,
        replacementTaskId: task.id,
        replacementAssetId: replacement.asset.id,
      });
      unmergedSucceededTaskId = null;
      updateGeneratedImageForRecord(parentRecord.id, parentRecord.workspace, image.id, (currentImage) => ({
        ...currentImage,
        assetId: replacement.asset.id,
        assetLocalPath: replacement.asset.localPath,
        assetRelativePath: replacement.asset.relativePath,
        errorMessage: undefined,
        height: replacement.asset.height,
        referenceImages,
        src: normalizeAssetSrc(
          replacement.asset.url ?? replacement.asset.localPath ?? replacement.asset.relativePath,
        ),
        status: "complete",
        width: replacement.asset.width,
      }));
    } catch (error) {
      let message = error instanceof Error ? error.message : "AI 改图失败。";
      if (unmergedSucceededTaskId) {
        message = await cleanupUnmergedRetryTask(unmergedSucceededTaskId, message);
      }
      throw new Error(message);
    }
  }

  function handleOpenGenerationRecord(record: GenerationRecord) {
    setActiveWorkspace(record.workspace);
    setDisplayedGenerationRecordId(record.workspace, record.id);
    setActiveGenerationRecordId(record.id);
    setHistoryViewingRecordId(record.workspace, record.id);
    if (record.workspace === "product") {
      setProductDetailImages(record.images);
    } else if (record.workspace === "clothing") {
      setClothingSceneImages(record.images);
    } else {
      setSceneImages(record.images);
      setScenePromptReviewing(true);
      setScenePlanGenerating(false);
      setSceneImageGenerating(record.status === "generating");
    }
    setHistoryOpen(false);
  }

  function handleDeleteGenerationRecord(recordId: string) {
    const deletedRecord = generationRecords.find((record) => record.id === recordId);
    deletedGenerationRecordIdsRef.current.add(recordId);
    setGenerationRecords((currentRecords) => currentRecords.filter((record) => record.id !== recordId));
    deletePersistedGenerationRecord(deletedRecord);
    if (!deletedRecord) {
      return;
    }

    if (isDisplayedGenerationRecord(recordId, deletedRecord.workspace)) {
      setDisplayedGenerationRecordId(deletedRecord.workspace, null);
      if (deletedRecord.workspace === "product") {
        setProductDetailImages([]);
      } else if (deletedRecord.workspace === "clothing") {
        setClothingSceneImages([]);
      } else {
        setSceneImages([]);
      }
    }
    if (historyViewingRecordIdsRef.current[deletedRecord.workspace] === recordId) {
      setHistoryViewingRecordId(deletedRecord.workspace, null);
    }
    if (activeGenerationRecordId !== recordId) {
      return;
    }

    setActiveGenerationRecordId(null);
  }

  function handleClearGenerationRecords() {
    generationRecords.forEach((record) => {
      deletedGenerationRecordIdsRef.current.add(record.id);
      deletePersistedGenerationRecord(record);
    });
    setGenerationRecords([]);
    setDisplayedGenerationRecordId("product", null);
    setDisplayedGenerationRecordId("clothing", null);
    setDisplayedGenerationRecordId("scene", null);
    const clearedHistoryRecordIds = { clothing: null, product: null, scene: null };
    historyViewingRecordIdsRef.current = clearedHistoryRecordIds;
    setHistoryViewingRecordIds(clearedHistoryRecordIds);
    setActiveGenerationRecordId(null);
    setProductDetailImages([]);
    setClothingSceneImages([]);
    setSceneImages([]);
    setHistoryOpen(false);
  }

  function handleBackToProductInputs() {
    setProductStrategyDrafting(false);
    setProductDetailGenerating(false);
    setProductDetailImages([]);
    setHistoryViewingRecordId("product", null);
  }

  async function handleGenerateClothingScenePlan(config: ClothingConfigState) {
    const requestId = clothingScenePlanningRequestIdRef.current + 1;
    clothingScenePlanningRequestIdRef.current = requestId;
    clothingScenePlanningContextRef.current = null;
    setClothingSceneDrafting(true);
    setClothingScenePlanning(true);
    setClothingSceneDrafts([]);
    setClothingSceneImages([]);
    setHistoryOpen(false);

    try {
      const previousTasksCancelled = await cancelTrackedClothingPlanningTasks();
      if (clothingScenePlanningRequestIdRef.current !== requestId) {
        return;
      }
      if (!previousTasksCancelled) {
        setClothingSceneDrafting(false);
        return;
      }
      const inputAssets = await createClothingInputAssets(config);
      const task = await localGenerationPort.createTask({
        idempotencyKey: `clothing-scene-planning:${Date.now()}`,
        input: {
          aiRecommended: config.aiRecommended,
          customScene: config.customScene,
          kind: "clothing-scene-planning",
          ratio: config.ratio,
          selectedScenes: config.aiRecommended ? [] : config.sceneIds,
        },
        inputAssets,
        kind: "image-generation",
        title: "服饰场景动作规划",
        workspace: "clothing",
      });
      clothingScenePlanningTaskIdsRef.current.add(task.id);
      if (clothingScenePlanningRequestIdRef.current !== requestId) {
        void cancelClothingPlanningTask(task.id);
        return;
      }
      await requestGenerationTaskStart(task.id, "服饰场景规划任务未能启动，请稍后重试。");
      const detail = await pollClothingPlanningTask(task.id, requestId);
      clothingScenePlanningTaskIdsRef.current.delete(task.id);
      if (clothingScenePlanningRequestIdRef.current !== requestId) {
        return;
      }
      if (detail.task.status === "failed") {
        throw new Error(detail.task.error?.message ?? "服饰场景规划失败。");
      }
      const drafts = createClothingSceneDraftsFromTaskDetail(detail);
      clothingScenePlanningContextRef.current = {
        inputAssets: inputAssets.map((asset) => ({ ...asset })),
        modelFeatures: readClothingModelFeaturesFromTaskDetail(detail),
      };
      setClothingSceneDrafts(drafts);
    } catch (error) {
      if (clothingScenePlanningRequestIdRef.current !== requestId) {
        return;
      }
      clothingScenePlanningContextRef.current = null;
      setClothingSceneDrafting(false);
      setClothingSceneDrafts([]);
      showToast({ message: `服饰场景规划失败：${error instanceof Error ? error.message : String(error)}`, variant: "error" });
    } finally {
      if (clothingScenePlanningRequestIdRef.current === requestId) {
        setClothingScenePlanning(false);
      }
    }
  }

  function handleBackFromClothingScenePlan() {
    invalidateClothingScenePlanning();
    setClothingSceneDrafting(false);
    setClothingScenePlanning(false);
  }

  async function cancelTrackedClothingPlanningTasks() {
    const taskIds = [...clothingScenePlanningTaskIdsRef.current];
    if (taskIds.length === 0) {
      return true;
    }
    const results = await Promise.all(taskIds.map(cancelClothingPlanningTask));
    return results.every(Boolean);
  }

  function cancelClothingPlanningTask(taskId: string): Promise<boolean> {
    const pendingCancellation = clothingScenePlanningCancellationsRef.current.get(taskId);
    if (pendingCancellation) {
      return pendingCancellation;
    }

    const promise = localGenerationPort
      .cancelTask(taskId)
      .then(() => {
        clothingScenePlanningTaskIdsRef.current.delete(taskId);
        return true;
      })
      .catch(async () => {
        try {
          const taskDetail = await localGenerationPort.getTaskDetail(taskId);
          if (isTaskTerminal(taskDetail.task.status)) {
            clothingScenePlanningTaskIdsRef.current.delete(taskId);
            return true;
          }
        } catch {
          // 详情读取失败时仍按取消失败处理，保留任务引用供后续重试。
        }
        showToast({
          message: "服饰场景规划取消失败：后台任务可能仍在继续，请稍后在生成记录中检查。",
          variant: "warning",
        });
        return false;
      })
      .finally(() => {
        if (clothingScenePlanningCancellationsRef.current.get(taskId) === promise) {
          clothingScenePlanningCancellationsRef.current.delete(taskId);
        }
      });
    clothingScenePlanningCancellationsRef.current.set(taskId, promise);
    return promise;
  }

  async function pollClothingPlanningTask(taskId: string, requestId: number): Promise<GenerationTaskDetail> {
    let lastPollSignature = "";
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    for (;;) {
      if (clothingScenePlanningRequestIdRef.current !== requestId) {
        throw new Error("服饰场景规划已取消。");
      }
      const taskDetail = await localGenerationPort.getTaskDetail(taskId);
      if (clothingScenePlanningRequestIdRef.current !== requestId) {
        throw new Error("服饰场景规划已取消。");
      }
      const pollSignature = createTaskPollSignature(taskDetail);
      if (pollSignature !== lastPollSignature) {
        lastPollSignature = pollSignature;
        unchangedPollCount = 0;
      } else {
        unchangedPollCount += 1;
      }

      queuedPollCount = taskDetail.task.status === "queued" ? queuedPollCount + 1 : 0;
      if (taskDetail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "服饰场景规划任务未能启动，请稍后重试。");
      }
      if (isTaskTerminal(taskDetail.task.status)) {
        return taskDetail;
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        throw new Error("服饰场景规划任务长时间未启动，请检查后台任务执行状态。");
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        throw new Error("服饰场景规划长时间无进展，请检查模型配置或后台任务日志。");
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  function handleGenerateClothingScenes(drafts: ClothingSceneDraft[]) {
    const planningContext = clothingScenePlanningContextRef.current;
    if (!planningContext) {
      setClothingSceneDrafting(false);
      showToast({ message: "服饰场景规划输入已失效，请重新规划。", variant: "error" });
      return;
    }
    const inputAssets = planningContext.inputAssets.map((asset) => ({ ...asset }));
    const recordId = createGenerationRecordId("clothing");
    const sourceImage: GeneratedDetailImage = {
      id: `${recordId}-source`,
      kind: "source-image" as const,
      sourceImages: clothingConfig.clothingImages.map((image) => ({ ...image })),
      status: "complete" as const,
      title: "原图",
    };
    const generatedImages = drafts.map((draft, index) => ({
      id: `${recordId}-${draft.id}`,
      imageNo: index + 1,
      prompt: draft.description,
      ratio: clothingConfig.ratio,
      sceneDescription: draft.description,
      status: "generating" as const,
      title: draft.scene,
    }));
    const images: GeneratedDetailImage[] = [sourceImage, ...generatedImages];
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

    deletedGenerationRecordIdsRef.current.delete(recordId);
    setGenerationRecords((currentRecords) => [record, ...currentRecords]);
    setDisplayedGenerationRecordId("clothing", recordId);
    setActiveGenerationRecordId(recordId);
    setHistoryViewingRecordId("clothing", null);
    setClothingGeneratingRecordId(recordId);
    clothingGeneratingRecordIdRef.current = recordId;
    setClothingSceneImages(images);
    setClothingSceneGenerating(true);
    setHistoryOpen(false);
    void runClothingSceneGeneration(recordId, drafts, images, inputAssets, planningContext.modelFeatures);
  }

  async function runClothingSceneGeneration(
    recordId: string,
    drafts: ClothingSceneDraft[],
    resultItems: GeneratedDetailImage[],
    inputAssets: GenerationTaskInputAssetInput[],
    modelFeatures: unknown,
  ) {
    let latestImages = resultItems;
    const publishImages = (nextImages: GeneratedDetailImage[], status: GenerationRecord["status"] = "generating") => {
      latestImages = nextImages;
      if (isDisplayedGenerationRecord(recordId, "clothing")) {
        setClothingSceneImages(nextImages);
      }
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === recordId
            ? {
                ...record,
                images: nextImages,
                status,
              }
            : record,
        ),
      );
    };

    try {
      const task = await localGenerationPort.createTask({
        idempotencyKey: `${recordId}:clothing-tryon-generation`,
        input: {
          kind: "clothing-tryon-generation",
          modelFeatures,
          ratio: clothingConfig.ratio,
          items: drafts.map((draft, index) => ({
            cameraSetup: {
              framing: draft.framing,
              perspective: draft.angle,
              shootingPosition: draft.shootingPosition,
            },
            id: draft.id,
            imageId: resultItems[index + 1].id,
            imageNo: index + 1,
            poseAction: draft.description,
            ratio: clothingConfig.ratio,
            scene: draft.scene,
            scenePromptSegment: draft.scenePromptSegment,
            sceneVisualAnchor: draft.sceneVisualAnchor,
            sortOrder: index,
          })),
        },
        inputAssets,
        kind: "image-generation",
        title: "服饰场景图",
        workspace: "clothing",
      });
      if (deletedGenerationRecordIdsRef.current.has(recordId)) {
        deletePersistedGenerationTasks([task.id]);
        return;
      }
      setGenerationRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.id === recordId
            ? {
                ...record,
                persistedTaskId: task.id,
                relatedTaskIds: [task.id],
              }
            : record,
        ),
      );
      await requestGenerationTaskStart(task.id, "服饰场景图任务未能启动，请稍后重试。");
      await pollClothingImageTask(task.id, () => latestImages, publishImages);
      publishImages(latestImages, deriveProductGenerationRecordStatus(latestImages));
    } catch (error) {
      const message = error instanceof Error ? error.message : "服饰场景图生成失败。";
      publishImages(failGeneratedImages(latestImages, message), "failed");
      showToast({ message, variant: "error" });
    } finally {
      if (clothingGeneratingRecordIdRef.current === recordId) {
        setClothingSceneGenerating(false);
        setClothingGeneratingRecordId(null);
        clothingGeneratingRecordIdRef.current = null;
      }
    }
  }

  async function pollClothingImageTask(
    taskId: string,
    getLatestImages: () => GeneratedDetailImage[],
    publishImages: (images: GeneratedDetailImage[], status?: GenerationRecord["status"]) => void,
  ) {
    let lastPollSignature = "";
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    for (;;) {
      const taskDetail = await localGenerationPort.getTaskDetail(taskId);
      const final = isTaskTerminal(taskDetail.task.status);
      const nextImages = applyGeneratedAssetOutputs(getLatestImages(), taskDetail, { final });
      const pollSignature = createTaskPollSignature(taskDetail);
      if (pollSignature !== lastPollSignature) {
        lastPollSignature = pollSignature;
        unchangedPollCount = 0;
      } else {
        unchangedPollCount += 1;
      }
      queuedPollCount = taskDetail.task.status === "queued" ? queuedPollCount + 1 : 0;
      publishImages(nextImages);
      if (taskDetail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "服饰场景图任务未能启动，请稍后重试。");
      }
      if (taskDetail.task.status === "failed" && taskDetail.outputAssets.length === 0) {
        throw new Error(taskDetail.task.error?.message ?? "服饰场景图生成失败。");
      }
      if (final) {
        return taskDetail;
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        throw new Error("服饰场景图任务长时间未启动，请检查后台任务执行状态。");
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        throw new Error("服饰场景图生成长时间无进展，请检查模型配置或后台任务日志。");
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  async function handleGenerateScenePlan() {
    const requestId = scenePlanningRequestIdRef.current + 1;
    scenePlanningRequestIdRef.current = requestId;
    sceneGenerationRequestIdRef.current += 1;
    scenePlanningContextRef.current = null;
    setScenePromptReviewing(true);
    setScenePlanGenerating(true);
    setScenePlanningSnapshot(null);
    setSceneImagePlans([]);
    setSceneImages([]);
    try {
      const config = {
        ...sceneConfig,
        referenceImages: sceneConfig.referenceImages.map((image) => ({ ...image })),
      };
      const inputAssets = await importProductInputAssets(config.referenceImages, "reference");
      if (scenePlanningRequestIdRef.current !== requestId) {
        return;
      }
      if (inputAssets.length !== config.referenceImages.length || inputAssets.length === 0) {
        throw new Error("参考图导入失败，请重新选择图片后重试。");
      }
      const task = await localGenerationPort.createTask({
        idempotencyKey: `scene-prompt-planning:${Date.now()}`,
        input: {
          kind: "scene-prompt-planning",
          outputMode: config.outputMode,
          planningPromptVersion: scenePlanningPromptVersion,
          ratio: config.ratio,
          referenceImageRoles: inputAssets.map((asset) => asset.role),
          supplementalInfo: config.supplementalInfo.trim(),
          templateCatalogVersion: sceneTemplateCatalogVersion,
        },
        inputAssets,
        kind: "prompt-plan",
        title: "场景图片方案",
        workspace: "scene",
      });
      sceneTaskIdsRef.current.add(task.id);
      if (scenePlanningRequestIdRef.current !== requestId) {
        void localGenerationPort.cancelTask(task.id).catch(() => undefined);
        return;
      }
      await requestGenerationTaskStart(task.id, "场景方案任务未能启动，请稍后重试。");
      const detail = await pollSceneTask(task.id, requestId, "planning");
      const snapshot = decodeScenePlanningOutput(detail.output, config.outputMode);
      if (scenePlanningRequestIdRef.current !== requestId) {
        return;
      }
      scenePlanningContextRef.current = {
        inputAssets,
        planningTaskId: task.id,
        referenceImages: config.referenceImages.map((image) => ({ ...image })),
      };
      setScenePlanningSnapshot(snapshot);
      setSceneImagePlans(snapshot.items);
    } catch (error) {
      if (scenePlanningRequestIdRef.current === requestId) {
        scenePlanningContextRef.current = null;
        setScenePromptReviewing(false);
        setScenePlanningSnapshot(null);
        setSceneImagePlans([]);
        showToast({
          message: `场景方案生成失败：${error instanceof Error ? error.message : String(error)}`,
          variant: "error",
        });
      }
    } finally {
      if (scenePlanningRequestIdRef.current === requestId) {
        setScenePlanGenerating(false);
      }
    }
  }

  function handleBackToSceneConfig() {
    invalidateSceneTasks();
    setScenePromptReviewing(false);
    setScenePlanGenerating(false);
    setSceneImageGenerating(false);
    setScenePlanningSnapshot(null);
    setSceneImagePlans([]);
    setSceneImages([]);
  }

  async function handleGenerateSceneImages(plans: SceneImagePlan[]) {
    const planningSnapshot = scenePlanningSnapshot;
    const planningContext = scenePlanningContextRef.current;
    if (!planningSnapshot || !planningContext) {
      showToast({ message: "场景方案输入已失效，请重新生成方案。", variant: "error" });
      return;
    }
    const requestId = sceneGenerationRequestIdRef.current + 1;
    sceneGenerationRequestIdRef.current = requestId;
    const frozenPlans = plans.map((plan) => ({ ...plan }));
    const sourceImage: GeneratedDetailImage = {
      id: `${planningContext.planningTaskId}-source`,
      kind: "source-image",
      sourceImages: planningContext.referenceImages.map((image) => ({ ...image })),
      status: "complete",
      title: "原图",
    };
    const generatedImages: GeneratedDetailImage[] = frozenPlans.map((plan) => ({
      id: plan.id,
      imageNo: plan.imageNo,
      prompt: plan.prompt,
      ratio: plan.ratio,
      sceneDescription: plan.purpose,
      status: "generating",
      title: plan.title,
    }));
    let images: GeneratedDetailImage[] = [sourceImage, ...generatedImages];
    setSceneImages(images);
    setSceneImageGenerating(true);
    let generationTaskId: string | null = null;
    try {
      const task = await localGenerationPort.createTask({
        idempotencyKey: `scene-image-generation:${Date.now()}`,
        input: {
          campaignStyleLock: planningSnapshot.campaignStyleLock,
          conversionDriver: planningSnapshot.conversionDriver,
          generationPromptVersion: sceneImageGenerationPromptVersion,
          items: frozenPlans.map((plan) => ({
            code: plan.code,
            imageId: plan.id,
            imageNo: plan.imageNo,
            negativeConstraints: plan.negativeConstraints,
            prompt: plan.prompt,
            promptSummary: plan.promptSummary,
            purpose: plan.purpose,
            ratio: plan.ratio,
            sortOrder: plan.sortOrder,
            templateId: plan.templateId,
            title: plan.title.replace(`${plan.code} `, ""),
            variantId: plan.variantId,
          })),
          kind: "scene-image-generation",
          outputMode: sceneConfig.outputMode,
          planningPromptVersion: scenePlanningPromptVersion,
          ratio: sceneConfig.ratio,
          templateCatalogVersion: planningSnapshot.templateCatalogVersion,
        },
        inputAssets: planningContext.inputAssets,
        kind: "image-generation",
        promptPlanId: planningContext.planningTaskId,
        title: "场景图片生成",
        workspace: "scene",
      });
      generationTaskId = task.id;
      if (sceneGenerationRequestIdRef.current !== requestId) {
        await localGenerationPort.cancelTask(task.id).catch((error) => {
          console.warn("cancel invalidated scene generation task failed", { error, taskId: task.id });
        });
        return;
      }
      sceneTaskIdsRef.current.add(task.id);
      const record: GenerationRecord = {
        createdAt: Date.now(),
        id: task.id,
        images,
        inputSummary: `${sceneConfig.outputMode} · ${sceneConfig.ratio} · ${frozenPlans.length} 张`,
        kind: "scene-generation",
        persistedTaskId: task.id,
        promptPlanId: planningContext.planningTaskId,
        relatedTaskIds: [task.id, planningContext.planningTaskId],
        status: "generating",
        title: "场景图片",
        workspace: "scene",
      };
      setGenerationRecords((records) => mergeGenerationRecords(records, [record]));
      setDisplayedGenerationRecordId("scene", task.id);
      activeGenerationRecordIdRef.current = task.id;
      setHistoryViewingRecordId("scene", null);
      setActiveGenerationRecordId(task.id);
      await requestGenerationTaskStart(task.id, "场景图片任务未能启动，请稍后重试。");
      const detail = await pollSceneTask(task.id, requestId, "generation", (nextDetail) => {
        images = applySceneGeneratedAssetOutputs(images, nextDetail);
        publishSceneGeneration(task.id, images, "generating", requestId);
      });
      images = applySceneGeneratedAssetOutputs(images, detail, { final: true });
      const status = deriveProductGenerationRecordStatus(images);
      publishSceneGeneration(task.id, images, status, requestId);
    } catch (error) {
      if (sceneGenerationRequestIdRef.current === requestId) {
        const message = error instanceof Error ? error.message : "场景图片生成失败。";
        images = failGeneratedImages(images, message);
        if (generationTaskId) {
          publishSceneGeneration(generationTaskId, images, "failed", requestId);
        } else {
          setSceneImages(images);
        }
        showToast({ message: `场景图片生成失败：${message}`, variant: "error" });
      }
    } finally {
      if (sceneGenerationRequestIdRef.current === requestId) {
        setSceneImageGenerating(false);
      }
    }
  }

  function publishSceneGeneration(
    recordId: string,
    images: GeneratedDetailImage[],
    status: GenerationRecord["status"],
    requestId: number,
  ) {
    if (sceneGenerationRequestIdRef.current !== requestId || deletedGenerationRecordIdsRef.current.has(recordId)) {
      return;
    }
    if (isDisplayedGenerationRecord(recordId, "scene")) {
      setSceneImages(images);
    }
    setGenerationRecords((records) =>
      records.map((record) => (record.id === recordId ? { ...record, images, status } : record)),
    );
  }

  async function pollSceneTask(
    taskId: string,
    requestId: number,
    kind: "planning" | "generation",
    onProgress?: (detail: GenerationTaskDetail) => void,
    options: { enforceRequestId?: boolean; isCancelled?: () => boolean; keepTrackedAfterSuccess?: boolean } = {},
  ) {
    let queuedPollCount = 0;
    let unchangedPollCount = 0;
    let lastPollSignature = "";
    for (;;) {
      if (options.isCancelled?.()) {
        throw new Error("场景任务轮询已停止。");
      }
      const activeRequestId =
        kind === "planning" ? scenePlanningRequestIdRef.current : sceneGenerationRequestIdRef.current;
      if (options.enforceRequestId !== false && activeRequestId !== requestId) {
        throw new Error("场景任务已取消。");
      }
      const detail = await localGenerationPort.getTaskDetail(taskId);
      const latestRequestId =
        kind === "planning" ? scenePlanningRequestIdRef.current : sceneGenerationRequestIdRef.current;
      if ((options.enforceRequestId !== false && latestRequestId !== requestId) || options.isCancelled?.()) {
        throw new Error("场景任务已取消。");
      }
      onProgress?.(detail);
      const signature = createTaskPollSignature(detail);
      unchangedPollCount = signature === lastPollSignature ? unchangedPollCount + 1 : 0;
      lastPollSignature = signature;
      queuedPollCount = detail.task.status === "queued" ? queuedPollCount + 1 : 0;
      if (detail.task.status === "queued") {
        await requestGenerationTaskStart(taskId, "场景任务未能启动，请稍后重试。");
      }
      if (isTaskTerminal(detail.task.status)) {
        if (detail.task.status !== "succeeded") {
          sceneTaskIdsRef.current.delete(taskId);
          throw new Error(detail.task.error?.message ?? "场景任务未成功完成。");
        }
        if (!options.keepTrackedAfterSuccess) {
          sceneTaskIdsRef.current.delete(taskId);
        }
        return detail;
      }
      if (queuedPollCount >= productGenerationMaxQueuedPollCount) {
        throw new Error("场景任务长时间未启动，请检查后台任务执行状态。");
      }
      if (unchangedPollCount >= productGenerationMaxUnchangedPollCount) {
        throw new Error("场景任务长时间无进展，请检查模型配置或后台任务日志。");
      }
      await delay(productGenerationPollIntervalMs);
    }
  }

  async function retrySceneImage(image: GeneratedDetailImage) {
    const requestId = sceneGenerationRequestIdRef.current;
    const parentRecord = findGeneratedImageRecord(image.id, "scene");
    if (!parentRecord?.persistedTaskId || parentRecord.workspace !== "scene") {
      showToast({ message: "场景图片缺少可重试的父任务。", variant: "error" });
      return;
    }
    const originalImage = { ...image };
    let completedRetryTaskId: string | undefined;
    try {
      const parentDetail = await localGenerationPort.getTaskDetail(parentRecord.persistedTaskId);
      if (
        sceneGenerationRequestIdRef.current !== requestId ||
        deletedGenerationRecordIdsRef.current.has(parentRecord.id)
      ) {
        return;
      }
      const input = parentDetail.input && typeof parentDetail.input === "object"
        ? (parentDetail.input as Record<string, unknown>)
        : {};
      if (
        readOutputString(input.planningPromptVersion) !== scenePlanningPromptVersion ||
        readOutputString(input.generationPromptVersion) !== sceneImageGenerationPromptVersion ||
        readOutputString(input.templateCatalogVersion) !== sceneTemplateCatalogVersion
      ) {
        throw new Error("该任务使用的 Prompt 或模板版本已过期，请重新规划后生成。");
      }
      const item = (Array.isArray(input.items) ? input.items : [])
        .map((value) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {}))
        .find((value) => readOutputString(value.imageId) === image.id);
      if (!item) {
        throw new Error("场景图片缺少冻结的生成参数，请重新规划后生成。");
      }
      const inputAssets = parentDetail.inputAssets
        .filter((asset) => asset.role === "reference")
        .map((asset, index): GenerationTaskInputAssetInput => ({
          assetId: asset.asset.id,
          role: "reference",
          sortOrder: index,
        }));
      if (inputAssets.length === 0) {
        throw new Error("场景图片缺少参考图资产，无法重新生成。");
      }
      const imageNo = readOutputNumber(item.imageNo) || image.imageNo;
      if (!imageNo) {
        throw new Error("场景图片缺少稳定序号，无法重新生成。");
      }
      updateSceneImageById(parentRecord.id, image.id, (current) => ({
        ...current,
        errorMessage: undefined,
        status: "generating",
      }));
      const retrySequence = Math.max(Date.now(), sceneRetrySequenceRef.current + 1);
      sceneRetrySequenceRef.current = retrySequence;
      const task = await localGenerationPort.createTask({
        idempotencyKey: `${parentRecord.persistedTaskId}:${image.id}:scene-retry:${retrySequence}`,
        input: createSceneRetryTaskInput(input, item, {
          imageNo,
          parentTaskId: parentRecord.persistedTaskId,
          retrySequence,
          targetImageId: image.id,
        }),
        inputAssets,
        kind: "image-generation",
        promptPlanId: parentRecord.promptPlanId,
        title: `重新生成 ${image.title}`,
        workspace: "scene",
      });
      if (
        sceneGenerationRequestIdRef.current !== requestId ||
        deletedGenerationRecordIdsRef.current.has(parentRecord.id)
      ) {
        await localGenerationPort.cancelTask(task.id).catch((error) => {
          console.warn("cancel invalidated scene retry task failed", { error, taskId: task.id });
        });
        return;
      }
      sceneTaskIdsRef.current.add(task.id);
      setGenerationRecords((records) =>
        records.map((record) =>
          record.id === parentRecord.id
            ? { ...record, relatedTaskIds: Array.from(new Set([...(record.relatedTaskIds ?? []), task.id])) }
            : record,
        ),
      );
      await requestGenerationTaskStart(task.id, "场景图片重新生成任务未能启动。");
      if (sceneGenerationRequestIdRef.current !== requestId) {
        return;
      }
      const retryDetail = await pollSceneTask(task.id, requestId, "generation", undefined, {
        keepTrackedAfterSuccess: true,
      });
      completedRetryTaskId = task.id;
      const replacement = [...retryDetail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0];
      if (!replacement) {
        throw new Error("场景图片重新生成结果缺少可用图片。");
      }
      if (
        sceneGenerationRequestIdRef.current !== requestId ||
        deletedGenerationRecordIdsRef.current.has(parentRecord.id)
      ) {
        return;
      }
      const persistedAsset = await findPersistedResultAsset(parentRecord.persistedTaskId, imageNo);
      if (
        sceneGenerationRequestIdRef.current !== requestId ||
        deletedGenerationRecordIdsRef.current.has(parentRecord.id)
      ) {
        return;
      }
      await localGenerationPort.replaceResultImage({
        currentAssetId: persistedAsset?.id,
        displayedAssetId: image.assetId,
        replacementAssetId: replacement.asset.id,
        replacementTaskId: task.id,
        taskId: parentRecord.persistedTaskId,
      });
      if (sceneGenerationRequestIdRef.current !== requestId) {
        return;
      }
      updateSceneImageById(parentRecord.id, image.id, (current) => ({
        ...current,
        assetId: replacement.asset.id,
        assetLocalPath: replacement.asset.localPath,
        assetRelativePath: replacement.asset.relativePath,
        errorMessage: undefined,
        height: replacement.asset.height,
        src: replacement.asset.url ?? replacement.asset.localPath,
        status: "complete",
        width: replacement.asset.width,
      }));
      showToast({ message: "场景图片已重新生成", variant: "success" });
    } catch (error) {
      if (
        sceneGenerationRequestIdRef.current !== requestId ||
        deletedGenerationRecordIdsRef.current.has(parentRecord.id)
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : "场景图片重新生成失败。";
      updateSceneImageById(parentRecord.id, image.id, () => ({
        ...originalImage,
        errorMessage: originalImage.src ? undefined : message,
        status: originalImage.src ? "complete" : "failed",
      }));
      showToast({ message, variant: "error" });
    } finally {
      if (completedRetryTaskId) {
        sceneTaskIdsRef.current.delete(completedRetryTaskId);
      }
    }
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

    async function listGenerationTasksForWorkspace(workspace: "clothing" | "product" | "scene") {
      const pageSize = 20;
      const tasks = [];
      let page = 1;

      for (;;) {
        const result = await localGenerationPort.listTasks({ workspace, page, pageSize });
        tasks.push(...result.items);
        if (tasks.length >= result.total || result.items.length < pageSize) {
          return tasks;
        }
        page += 1;
      }
    }

    async function getTaskDetailsWithConcurrency(tasks: { id: string }[]) {
      const taskDetails: GenerationTaskDetail[] = [];
      for (let startIndex = 0; startIndex < tasks.length; startIndex += historyRestoreDetailConcurrency) {
        const taskGroup = tasks.slice(startIndex, startIndex + historyRestoreDetailConcurrency);
        const results = await Promise.allSettled(
          taskGroup.map((task) => localGenerationPort.getTaskDetail(task.id)),
        );
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            taskDetails.push(result.value);
            return;
          }
          console.warn(`restore generation task detail failed: ${taskGroup[index].id}`, result.reason);
        });
      }
      return taskDetails;
    }

    function updateRestoredSceneRecord(
      recordId: string,
      images: GeneratedDetailImage[],
      status: GenerationRecord["status"],
    ) {
      if (cancelled || deletedGenerationRecordIdsRef.current.has(recordId)) {
        return;
      }
      const viewingRestoredRecord =
        isDisplayedGenerationRecord(recordId, "scene") && historyViewingRecordIdsRef.current.scene === recordId;
      if (viewingRestoredRecord) {
        setSceneImages(images);
        if (status !== "generating") {
          setSceneImageGenerating(false);
        }
      }
      setGenerationRecords((records) =>
        records.map((record) => (record.id === recordId ? { ...record, images, status } : record)),
      );
    }

    async function resumeRestoredSceneParentTask(detail: GenerationTaskDetail, requestId: number) {
      const initialRecord = createSceneGenerationRecordFromTaskDetail(detail);
      if (!initialRecord) {
        return;
      }
      let images = initialRecord.images;
      const stopped = () =>
        cancelled ||
        deletedGenerationRecordIdsRef.current.has(initialRecord.id);
      sceneTaskIdsRef.current.add(detail.task.id);
      try {
        const finalDetail = await pollSceneTask(
          detail.task.id,
          requestId,
          "generation",
          (nextDetail) => {
            images = applySceneGeneratedAssetOutputs(images, nextDetail);
            updateRestoredSceneRecord(initialRecord.id, images, "generating");
          },
          { enforceRequestId: false, isCancelled: stopped },
        );
        if (stopped()) {
          return;
        }
        images = applySceneGeneratedAssetOutputs(images, finalDetail, { final: true });
        updateRestoredSceneRecord(
          initialRecord.id,
          images,
          deriveProductGenerationRecordStatus(images),
        );
      } catch (error) {
        if (stopped()) {
          return;
        }
        const message = error instanceof Error ? error.message : "场景图片生成失败。";
        images = failGeneratedImages(images, message);
        updateRestoredSceneRecord(initialRecord.id, images, "failed");
      }
    }

    async function resumeRestoredSceneRetryTask(
      detail: GenerationTaskDetail,
      parentRecord: GenerationRecord,
      requestId: number,
    ) {
      const retryPatch = createRestoredSingleImageRetryPatchFromTaskDetail(detail, { includeIncomplete: true });
      if (!retryPatch?.parentTaskId) {
        return;
      }
      const parentImage = parentRecord.images.find((image) => restoredImageMatchesRetryTarget(image, retryPatch));
      const stopped = () =>
        cancelled ||
        deletedGenerationRecordIdsRef.current.has(parentRecord.id);
      let latestRetryStatus = detail.task.status;
      sceneTaskIdsRef.current.add(detail.task.id);
      try {
        const finalDetail = await pollSceneTask(
          detail.task.id,
          requestId,
          "generation",
          (nextDetail) => {
            latestRetryStatus = nextDetail.task.status;
          },
          {
            enforceRequestId: false,
            isCancelled: stopped,
            keepTrackedAfterSuccess: true,
          },
        );
        const replacement = [...finalDetail.outputAssets].sort((left, right) => left.sortOrder - right.sortOrder)[0];
        if (!replacement) {
          throw new Error("场景图片重新生成结果缺少可用图片。");
        }
        if (stopped()) {
          return;
        }
        await localGenerationPort.replaceResultImage({
          currentAssetId: parentImage?.assetId,
          displayedAssetId: parentImage?.assetId,
          replacementAssetId: replacement.asset.id,
          replacementTaskId: detail.task.id,
          taskId: retryPatch.parentTaskId,
        });
        if (stopped()) {
          return;
        }
        const parentDetail = await localGenerationPort.getTaskDetail(retryPatch.parentTaskId);
        const refreshedRecord = createSceneGenerationRecordFromTaskDetail(parentDetail);
        if (!refreshedRecord || stopped()) {
          return;
        }
        updateRestoredSceneRecord(
          parentRecord.id,
          refreshedRecord.images,
          refreshedRecord.status,
        );
      } catch (error) {
        if (stopped()) {
          return;
        }
        try {
          const parentDetail = await localGenerationPort.getTaskDetail(retryPatch.parentTaskId);
          const refreshedRecord = createSceneGenerationRecordFromTaskDetail(parentDetail);
          if (refreshedRecord && !stopped()) {
            updateRestoredSceneRecord(
              parentRecord.id,
              refreshedRecord.images,
              refreshedRecord.status,
            );
          }
        } catch (refreshError) {
          console.warn("refresh restored scene retry parent failed", refreshError);
        }
      } finally {
        if (isTaskTerminal(latestRetryStatus)) {
          sceneTaskIdsRef.current.delete(detail.task.id);
        }
      }
    }

    async function restoreGenerationHistory() {
      try {
        const [productTasks, clothingTasks, sceneTasks] = await Promise.all([
          listGenerationTasksForWorkspace("product").catch((error) => {
            console.warn("restore product generation task list failed", error);
            return [];
          }),
          listGenerationTasksForWorkspace("clothing").catch((error) => {
            console.warn("restore clothing generation task list failed", error);
            return [];
          }),
          listGenerationTasksForWorkspace("scene").catch((error) => {
            console.warn("restore scene generation task list failed", error);
            return [];
          }),
        ]);
        const taskById = new Map(
          [...productTasks, ...clothingTasks, ...sceneTasks]
            .filter((task) => task.kind === "image-generation" || task.kind === "listing-copy")
            .map((task) => [task.id, task] as const),
        );
        const taskDetails = await getTaskDetailsWithConcurrency([...taskById.values()]);
        const productTaskDetails = taskDetails.filter((detail) => detail.task.workspace === "product");
        const clothingTaskDetails = taskDetails.filter((detail) => detail.task.workspace === "clothing");
        const sceneTaskDetails = taskDetails.filter((detail) => detail.task.workspace === "scene");
        const restoredRecords = productTaskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map(createProductGenerationRecordFromTaskDetail)
          .filter((record): record is GenerationRecord => record !== null);
        const retryPatches = productTaskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map((detail) => createRestoredSingleImageRetryPatchFromTaskDetail(detail))
          .filter((patch): patch is RestoredSingleImageRetryPatch => patch !== null);
        const listingCopyImages = productTaskDetails
          .filter((detail) => detail.task.kind === "listing-copy")
          .map(createRestoredListingCopyImageFromTaskDetail)
          .filter((item): item is RestoredListingCopyImage => item !== null);
        const restoredRecordsWithRetries = mergeRestoredSingleImageRetryPatches(restoredRecords, retryPatches);
        const restoredRecordsWithListingCopy = mergeRestoredListingCopyImages(restoredRecordsWithRetries, listingCopyImages);
        const clothingRetryPatches = clothingTaskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map((detail) => createRestoredSingleImageRetryPatchFromTaskDetail(detail, { includeIncomplete: true }))
          .filter((patch): patch is RestoredSingleImageRetryPatch => patch !== null);
        const restoredClothingRecords = clothingTaskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map(createClothingGenerationRecordFromTaskDetail)
          .filter((record): record is GenerationRecord => record !== null);
        const restoredClothingRecordsWithRetries = mergeRestoredSingleImageRetryPatches(
          restoredClothingRecords,
          clothingRetryPatches,
        );
        const sceneRetryPatches = sceneTaskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map((detail) => createRestoredSingleImageRetryPatchFromTaskDetail(detail, { includeIncomplete: true }))
          .filter((patch): patch is RestoredSingleImageRetryPatch => patch !== null);
        const restoredSceneRecords = sceneTaskDetails
          .filter((detail) => detail.task.kind === "image-generation")
          .map(createSceneGenerationRecordFromTaskDetail)
          .filter((record): record is GenerationRecord => record !== null);
        const restoredSceneRecordsWithRetries = mergeRestoredSingleImageRetryPatches(
          restoredSceneRecords,
          sceneRetryPatches,
        );
        const restoredGenerationRecords = [
          ...restoredRecordsWithListingCopy,
          ...restoredClothingRecordsWithRetries,
          ...restoredSceneRecordsWithRetries,
        ];

        if (!cancelled && restoredGenerationRecords.length > 0) {
          setGenerationRecords((currentRecords) => mergeGenerationRecords(currentRecords, restoredGenerationRecords));
        }
        if (!cancelled) {
          const requestId = sceneGenerationRequestIdRef.current;
          const restoredSceneRecordByTaskId = new Map(
            restoredSceneRecords.map((record) => [record.persistedTaskId, record] as const),
          );
          sceneTaskDetails
            .filter((detail) => !isTaskTerminal(detail.task.status) && !isRestoredTaskStale(detail.task))
            .forEach((detail) => {
              if (isSingleImageRetryTaskDetail(detail)) {
                const input = detail.input && typeof detail.input === "object"
                  ? (detail.input as Record<string, unknown>)
                  : {};
                const parentTaskId = readOutputString(input.parentTaskId) || detail.task.retryOfTaskId;
                const parentRecord = parentTaskId ? restoredSceneRecordByTaskId.get(parentTaskId) : undefined;
                if (parentRecord) {
                  void resumeRestoredSceneRetryTask(detail, parentRecord, requestId);
                }
                return;
              }
              void resumeRestoredSceneParentTask(detail, requestId);
            });
        }
      } catch (error) {
        console.warn("restore generation history failed", error);
      }
    }

    void restoreGenerationHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      toolbar={
        <StudioToolbar
          hidePrimaryAction={isModelWorkspace || isSettingsWorkspace}
          historyCount={generationRecords.length}
          historyOpen={historyOpen}
          historyPopover={
            historyMounted ? (
              <DeferredStudioContent>
                <DeferredGenerationHistoryPopover
                  activeRecordId={activeHistoryRecordId}
                  onClearRecords={handleClearGenerationRecords}
                  onClose={closeHistory}
                  onDeleteRecord={handleDeleteGenerationRecord}
                  onOpenRecord={handleOpenGenerationRecord}
                  open={historyOpen}
                  records={generationRecords}
                />
              </DeferredStudioContent>
            ) : null
          }
          onOpenSettings={() => {
            setActiveWorkspace("settings");
            setHistoryOpen(false);
          }}
          onNewTask={handleNewTask}
          onToggleHistory={handleToggleHistory}
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
        <DeferredStudioContent>
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
            <DeferredSceneWorkspacePanel
              campaignStyleLock={scenePlanningSnapshot?.campaignStyleLock ?? ""}
              config={sceneConfig}
              imageGenerating={sceneImageGenerating}
              onBack={handleBackToSceneConfig}
              onChange={setSceneConfig}
              onGenerateImages={handleGenerateSceneImages}
              onGeneratePlan={handleGenerateScenePlan}
              planGenerating={scenePlanGenerating}
              plans={sceneImagePlans}
              promptReviewing={scenePromptReviewing}
            />
          ) : isClothingWorkspace ? (
            <DeferredClothingWorkspacePanel
              baseModelGenerationSessionId={clothingBaseModelGenerationSessionId}
              config={clothingConfig}
              drafts={clothingSceneDrafts}
              onBackFromScenePlan={handleBackFromClothingScenePlan}
              onConfigChange={setClothingConfig}
              onDraftsChange={setClothingSceneDrafts}
              onGenerateBaseModel={handleGenerateBaseModel}
              onGenerateSceneImages={handleGenerateClothingScenes}
              onGenerateScenePlan={handleGenerateClothingScenePlan}
              planning={clothingScenePlanning}
              sceneDrafting={clothingSceneDrafting}
              sceneGenerating={clothingSceneGenerating}
            />
          ) : null}
        </DeferredStudioContent>
      }
      canvas={
        isSceneWorkspace ? (
          sceneImages.length > 0 ? (
            <PreviewCanvas
              boards={previewBoards}
              detailImages={sceneImages}
              textEditScopeId={displayedGenerationRecordIdsRef.current.scene ?? "scene-live"}
              onImageDelete={deleteGeneratedImage}
              onImageResize={resizeGeneratedImage}
              onImageRewrite={persistGeneratedImageRewriteTask}
              onImageTextRecognitionEmpty={notifyImageTextRecognitionEmpty}
              onImageTextRewrite={persistGeneratedImageTextRewriteTask}
              onImageTextRewriteError={notifyImageTextRewriteError}
              onImageRetry={retrySceneImage}
              onLoadImageSizeOptions={loadGeneratedImageSizeOptions}
              onRecognizeImageText={recognizeGeneratedImageText}
            />
          ) : (
            <DeferredStudioContent>
              <DeferredScenePreviewCanvas />
            </DeferredStudioContent>
          )
        ) : isClothingWorkspace ? (
          clothingSceneImages.length > 0 ? (
            <PreviewCanvas
              boards={previewBoards}
              detailImages={clothingSceneImages}
              textEditScopeId={displayedGenerationRecordIdsRef.current.clothing ?? "clothing-live"}
              onImageDelete={deleteGeneratedImage}
              onImageResize={resizeGeneratedImage}
              onImageRewrite={persistGeneratedImageRewriteTask}
              onImageTextRecognitionEmpty={notifyImageTextRecognitionEmpty}
              onImageTextRewrite={persistGeneratedImageTextRewriteTask}
              onImageTextRewriteError={notifyImageTextRewriteError}
              onImageRetry={retryClothingSceneImage}
              onLoadImageSizeOptions={loadGeneratedImageSizeOptions}
              onRecognizeImageText={recognizeGeneratedImageText}
            />
          ) : (
            <DeferredStudioContent>
              <DeferredClothingPreviewCanvas />
            </DeferredStudioContent>
          )
        ) : (
          <PreviewCanvas
            boards={previewBoards}
            detailImages={productDetailImages}
            textEditScopeId={displayedGenerationRecordIdsRef.current.product ?? "product-live"}
            onImageDelete={deleteGeneratedImage}
            onImageResize={resizeGeneratedImage}
            onImageRewrite={persistGeneratedImageRewriteTask}
            onImageTextRecognitionEmpty={notifyImageTextRecognitionEmpty}
            onImageTextRewrite={persistGeneratedImageTextRewriteTask}
            onImageTextRewriteError={notifyImageTextRewriteError}
            onImageRetry={retryProductDetailImage}
            onLoadImageSizeOptions={loadGeneratedImageSizeOptions}
            onListingCopyRetry={retryProductListingCopy}
            onRecognizeImageText={recognizeGeneratedImageText}
          />
        )
      }
      hideConfigPanel={isGenerationResultViewing}
      workspaceContent={
        isModelWorkspace ? (
          <DeferredStudioContent>
            <DeferredModelConfigPage />
          </DeferredStudioContent>
        ) : isSettingsWorkspace ? (
          <DeferredStudioContent>
            <DeferredSettingsPage />
          </DeferredStudioContent>
        ) : null
      }
    />
  );
}
