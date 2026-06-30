import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { StudioToolbar } from "./components/StudioToolbar";
import { NavigationRail } from "./components/NavigationRail";
import {
  defaultProductGenerationSettings,
  GenerationConfigPanel,
} from "../features/generation/components/GenerationConfigPanel";
import type { StrategyModuleDraft } from "../features/generation/components/GenerationConfigPanel";
import { PreviewCanvas, type GeneratedDetailImage } from "../features/generation/components/PreviewCanvas";
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
import { moduleOptions, navItems, previewBoards } from "./studioData";
import type { ProductImageAsset } from "../features/generation/lib/productImagePicker";

const generationCompleteDelayMs = 3000;

export function App() {
  const [activeWorkspace, setActiveWorkspace] = useState("product");
  const [productImages, setProductImages] = useState<ProductImageAsset[]>([]);
  const [productGenerationSettings, setProductGenerationSettings] = useState(defaultProductGenerationSettings);
  const [productGenerationSettingsTouched, setProductGenerationSettingsTouched] = useState(false);
  const [productModules, setProductModules] = useState(() => moduleOptions);
  const [productPrompt, setProductPrompt] = useState("");
  const [productStrategyDrafting, setProductStrategyDrafting] = useState(false);
  const [productDetailImages, setProductDetailImages] = useState<GeneratedDetailImage[]>([]);
  const [productDetailGenerating, setProductDetailGenerating] = useState(false);
  const [clothingConfig, setClothingConfig] = useState(defaultClothingConfig);
  const [clothingSceneDrafting, setClothingSceneDrafting] = useState(false);
  const [clothingSceneImages, setClothingSceneImages] = useState<GeneratedDetailImage[]>([]);
  const [clothingSceneGenerating, setClothingSceneGenerating] = useState(false);
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const [activeGenerationRecordId, setActiveGenerationRecordId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [productGeneratingRecordId, setProductGeneratingRecordId] = useState<string | null>(null);
  const [clothingGeneratingRecordId, setClothingGeneratingRecordId] = useState<string | null>(null);
  const isClothingWorkspace = activeWorkspace === "clothing";
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
    const images = drafts.map((draft) => ({
      id: `${recordId}-${draft.id}`,
      status: "generating" as const,
      title: draft.title,
    }));
    const record: GenerationRecord = {
      createdAt: Date.now(),
      id: recordId,
      images,
      inputSummary: createProductHistorySummary(productGenerationSettings, drafts.length),
      kind: "product-detail",
      status: "generating",
      title: "商品详情图",
      workspace: "product",
    };

    setGenerationRecords((currentRecords) => [record, ...currentRecords]);
    setActiveGenerationRecordId(recordId);
    setProductGeneratingRecordId(recordId);
    setProductDetailImages(images);
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
      setProductDetailImages((currentImages) =>
        currentImages.map((image) => ({ ...image, status: "complete" })),
      );
      if (productGeneratingRecordId) {
        setGenerationRecords((currentRecords) =>
          currentRecords.map((record) =>
            record.id === productGeneratingRecordId
              ? {
                  ...record,
                  images: record.images.map((image) => ({ ...image, status: "complete" })),
                  status: "complete",
                }
              : record,
          ),
        );
      }
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
      setClothingSceneImages((currentImages) =>
        currentImages.map((image) => ({ ...image, status: "complete" })),
      );
      if (clothingGeneratingRecordId) {
        setGenerationRecords((currentRecords) =>
          currentRecords.map((record) =>
            record.id === clothingGeneratingRecordId
              ? {
                  ...record,
                  images: record.images.map((image) => ({ ...image, status: "complete" })),
                  status: "complete",
                }
              : record,
          ),
        );
      }
      setClothingSceneGenerating(false);
      setClothingGeneratingRecordId(null);
    }, generationCompleteDelayMs);

    return () => window.clearTimeout(generationTimer);
  }, [clothingSceneGenerating, clothingGeneratingRecordId]);

  return (
    <AppShell
      toolbar={
        <StudioToolbar
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
        isClothingWorkspace ? (
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
            productImages={productImages}
            productPrompt={productPrompt}
            strategyDrafting={productStrategyDrafting}
          />
        )
      }
      canvas={
        isClothingWorkspace ? (
          clothingSceneImages.length > 0 ? (
            <PreviewCanvas boards={previewBoards} detailImages={clothingSceneImages} />
          ) : (
            <ClothingPreviewCanvas />
          )
        ) : (
          <PreviewCanvas boards={previewBoards} detailImages={productDetailImages} />
        )
      }
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

function createClothingHistorySummary(drafts: ClothingSceneDraft[]) {
  const sceneNames = Array.from(new Set(drafts.map((draft) => draft.scene))).join("、");

  return `${sceneNames || "服饰场景"} · ${drafts.length} 张`;
}
