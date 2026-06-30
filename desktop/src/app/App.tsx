import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { StudioToolbar } from "./components/StudioToolbar";
import { NavigationRail } from "./components/NavigationRail";
import {
  defaultProductGenerationSettings,
  GenerationConfigPanel,
} from "../features/generation/components/GenerationConfigPanel";
import type { StrategyModuleDraft, ViralStyleAnalysisResult } from "../features/generation/components/GenerationConfigPanel";
import {
  PreviewCanvas,
  type GeneratedDetailImage,
  type ProductListingCopy,
} from "../features/generation/components/PreviewCanvas";
import {
  ClothingConfigPanel,
  ClothingSceneSelectionPanel,
  defaultClothingConfig,
} from "../features/clothing/components/ClothingConfigPanel";
import type { ClothingSceneDraft } from "../features/clothing/components/ClothingConfigPanel";
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
  type SceneImagePlan,
} from "../features/scenes/lib/sceneImagePlan";
import { ModelConfigPage } from "../features/model-config/components/ModelConfigPage";
import { SettingsPage } from "../features/settings/components/SettingsPage";
import { moduleOptions, navItems, previewBoards } from "./studioData";
import type { ProductImageAsset } from "../features/generation/lib/productImagePicker";

const generationCompleteDelayMs = 3000;
const scenePlanDraftDelayMs = 2500;

export function App() {
  const [activeWorkspace, setActiveWorkspace] = useState("product");
  const [productImages, setProductImages] = useState<ProductImageAsset[]>([]);
  const [productGenerationSettings, setProductGenerationSettings] = useState(defaultProductGenerationSettings);
  const [productGenerationSettingsTouched, setProductGenerationSettingsTouched] = useState(false);
  const [productModules, setProductModules] = useState(() => moduleOptions);
  const [productPrompt, setProductPrompt] = useState("");
  const [selectedProductViralStyles, setSelectedProductViralStyles] = useState<ViralStyleAnalysisResult[]>([]);
  const [productStrategyDrafting, setProductStrategyDrafting] = useState(false);
  const [productDetailImages, setProductDetailImages] = useState<GeneratedDetailImage[]>([]);
  const [productDetailGenerating, setProductDetailGenerating] = useState(false);
  const [clothingConfig, setClothingConfig] = useState(defaultClothingConfig);
  const [clothingSceneDrafting, setClothingSceneDrafting] = useState(false);
  const [clothingSceneImages, setClothingSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [clothingSceneGenerating, setClothingSceneGenerating] = useState(false);
  const [sceneConfig, setSceneConfig] = useState(defaultSceneConfig);
  const [scenePromptReviewing, setScenePromptReviewing] = useState(false);
  const [scenePlanGenerating, setScenePlanGenerating] = useState(false);
  const [sceneImagePlans, setSceneImagePlans] = useState<SceneImagePlan[]>([]);
  const [sceneImages, setSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [sceneImageGenerating, setSceneImageGenerating] = useState(false);
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const [activeGenerationRecordId, setActiveGenerationRecordId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [productGeneratingRecordId, setProductGeneratingRecordId] = useState<string | null>(null);
  const [clothingGeneratingRecordId, setClothingGeneratingRecordId] = useState<string | null>(null);
  const isClothingWorkspace = activeWorkspace === "clothing";
  const isModelWorkspace = activeWorkspace === "model";
  const isSceneWorkspace = activeWorkspace === "scene";
  const isSettingsWorkspace = activeWorkspace === "settings";
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  function handleProductGenerationSettingsChange(settings: typeof productGenerationSettings) {
    setProductGenerationSettings(settings);
    setProductGenerationSettingsTouched(true);
  }

  function handleModuleCheckedChange(moduleId: string, checked: boolean) {
    setProductModules((currentModules) =>
      currentModules.map((module) => (module.id === moduleId ? { ...module, checked } : module)),
    );
  }

  function handleGenerateDetails(drafts: StrategyModuleDraft[]) {
    const recordId = createGenerationRecordId("product");
    const activeViralStyles = productGenerationSettings.viralStyleAnalysisEnabled ? selectedProductViralStyles : [];
    const resultItems =
      activeViralStyles.length > 0
        ? activeViralStyles.flatMap((style) => {
            const groupId = `${recordId}-${createResultGroupSlug(style.title)}`;
            const images: GeneratedDetailImage[] = drafts.map((draft) => ({
              groupId,
              groupTitle: style.title,
              id: `${groupId}-${draft.id}`,
              status: "generating" as const,
              title: draft.title,
            }));
            const sourceImage: GeneratedDetailImage = {
              groupId,
              groupTitle: style.title,
              id: `${groupId}-source`,
              kind: "source-image" as const,
              sourceImages: productImages,
              status: "complete" as const,
              title: "原图",
            };
            const listingCopy: GeneratedDetailImage[] = productGenerationSettings.listingCopyGenerationEnabled
              ? [
                  {
                    groupId,
                    groupTitle: style.title,
                    id: `${groupId}-listing-copy`,
                    kind: "listing-copy" as const,
                    listingCopy: createProductListingCopy(`${style.title} ${productPrompt}`),
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
            productGenerationSettings.listingCopyGenerationEnabled,
            productPrompt,
            productImages,
          );
    const record: GenerationRecord = {
      createdAt: Date.now(),
      id: recordId,
      images: resultItems,
      inputSummary: createProductHistorySummary(
        productGenerationSettings,
        resultItems.filter((image) => image.kind !== "source-image").length,
      ),
      kind: "product-detail",
      status: "generating",
      title: "商品详情图",
      workspace: "product",
    };

    setGenerationRecords((currentRecords) => [record, ...currentRecords]);
    setActiveGenerationRecordId(recordId);
    setProductGeneratingRecordId(recordId);
    setProductDetailImages(resultItems);
    setProductDetailGenerating(true);
    setHistoryOpen(false);
  }

  function handleOpenGenerationRecord(record: GenerationRecord) {
    setActiveWorkspace(record.workspace);
    setActiveGenerationRecordId(record.id);
    if (record.workspace === "product") {
      setProductDetailImages(record.images);
    } else {
      setClothingSceneImages(record.images);
    }
    setHistoryOpen(false);
  }

  function handleDeleteGenerationRecord(recordId: string) {
    const deletedRecord = generationRecords.find((record) => record.id === recordId);
    setGenerationRecords((currentRecords) => currentRecords.filter((record) => record.id !== recordId));
    if (activeGenerationRecordId !== recordId || !deletedRecord) {
      return;
    }

    setActiveGenerationRecordId(null);
    if (deletedRecord.workspace === "product") {
      setProductDetailImages([]);
    } else {
      setClothingSceneImages([]);
    }
  }

  function handleClearGenerationRecords() {
    setGenerationRecords([]);
    setActiveGenerationRecordId(null);
    setProductDetailImages([]);
    setClothingSceneImages([]);
    setHistoryOpen(false);
  }

  function handleBackToProductInputs() {
    setProductStrategyDrafting(false);
    setProductDetailGenerating(false);
    setProductDetailImages([]);
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
    if (!productDetailGenerating) {
      return;
    }

    const generationTimer = window.setTimeout(() => {
      setProductDetailImages((currentImages) => {
        const failedImageId = pickRandomFailedImageId(currentImages);
        const completedImages = completeGeneratedImages(currentImages, failedImageId);
        if (productGeneratingRecordId) {
          setGenerationRecords((currentRecords) =>
            currentRecords.map((record) =>
              record.id === productGeneratingRecordId
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
      setProductDetailGenerating(false);
      setProductGeneratingRecordId(null);
    }, generationCompleteDelayMs);

    return () => window.clearTimeout(generationTimer);
  }, [productDetailGenerating, productGeneratingRecordId]);

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
        isSceneWorkspace ? (
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
        ) : (
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
        )
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
          <PreviewCanvas boards={previewBoards} detailImages={productDetailImages} />
        )
      }
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

function createFlatProductResultItems(
  recordId: string,
  drafts: StrategyModuleDraft[],
  listingCopyGenerationEnabled: boolean,
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
  const images: GeneratedDetailImage[] = drafts.map((draft) => ({
    id: `${recordId}-${draft.id}`,
    status: "generating" as const,
    title: draft.title,
  }));

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
