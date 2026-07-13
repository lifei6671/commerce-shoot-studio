import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import * as Checkbox from "@radix-ui/react-checkbox";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Check, ChevronDown, HelpCircle, ImageUp, Minus, Sparkles, Trash2, UserRound } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { ControlGroup } from "../../../shared/ui/control-group";
import { ImageUploadGrid } from "../../../shared/ui/image-upload-grid";
import { TextAreaPanel } from "../../../shared/ui/textarea-panel";
import { UploadDropzone } from "../../../shared/ui/upload-dropzone";
import { cn } from "../../../shared/lib/cn";
import { useToast } from "../../../shared/ui/toast";
import { localAssetPort } from "../../../runtime/local/assets";
import type { Asset, BuiltinModelAsset } from "../../../runtime";
import { selectProductImages, type ProductImageAsset } from "../../generation/lib/productImagePicker";
import {
  defaultClothingConfig,
  isClothingBaseModelGenerationCancelledError,
} from "../lib/clothingConfig";
import type {
  BaseModelGenerationInput,
  ClothingConfigState,
  ClothingSceneDraft,
  GeneratedBaseModelImage,
} from "../types";

export {
  ClothingBaseModelGenerationCancelledError,
  createDefaultClothingSceneDrafts,
  defaultClothingConfig,
  isClothingBaseModelGenerationCancelledError,
} from "../lib/clothingConfig";
export type {
  BaseModelGenerationInput,
  ClothingConfigState,
  ClothingSceneDraft,
  GeneratedBaseModelImage,
} from "../types";

const sceneOptions = ["纯色棚拍", "都市街头", "街角咖啡", "自然草坪", "度假海滩", "温馨居家", "艺术展馆"];

const aiModelGenderOptions = ["男", "女"];
const aiModelAgeOptions = ["婴儿", "儿童", "青少年", "青年", "中年", "老年"];
const aiModelEthnicityOptions = ["欧美白人", "中国人", "东亚人", "东南亚人", "非裔", "中东人", "拉丁裔"];
const aiModelBodyOptions = [
  "纤细",
  "苗条",
  "精瘦",
  "匀称",
  "健美",
  "运动型",
  "肌肉型",
  "壮硕",
  "结实",
  "丰满",
  "微胖",
  "大码",
];

const ratios = ["3:4", "1:1", "9:16"];
const sceneFramingOptions = ["全身", "四分之三", "半身", "特写"];
const sceneAngleOptions = ["正面", "侧面", "3/4 侧", "背面"];
const maxClothingImageCount = 5;
const sceneDraftDelayMs = 2500;
const modelPreviewDelayMs = 450;
const baseModelGenerationTransitionMs = 180;
type ClothingConfigPanelProps = {
  baseModelGenerationSessionId: number;
  config: ClothingConfigState;
  onChange: (config: ClothingConfigState) => void;
  onGenerateBaseModel: (input: BaseModelGenerationInput) => Promise<GeneratedBaseModelImage>;
  onGenerateScenes: (config: ClothingConfigState) => void;
};

type BuiltinModelView = BuiltinModelAsset & {
  fullBodySrc: string;
  src: string;
};

type ModelPreview = {
  fullBodySrc: string;
  label: string;
  left: number;
  top: number;
};

function modelAssetToProductImage(asset: Asset): ProductImageAsset | null {
  if (!asset.localPath) {
    return null;
  }

  const name = asset.originalName || asset.name;
  const src = asset.url ?? convertFileSrc(asset.localPath);
  return {
    assetId: asset.id,
    id: asset.id,
    name,
    path: asset.localPath,
    src,
    thumbnailSrc: asset.thumbnailPath ? convertFileSrc(asset.thumbnailPath) : undefined,
  };
}

function isDeletableModelImage(image: ProductImageAsset) {
  return !image.id.startsWith("builtin:") && !image.id.startsWith("preset:");
}

function modelImagesMatch(left: ProductImageAsset, right: ProductImageAsset) {
  if (left.id === right.id) {
    return true;
  }
  if (left.assetId && right.assetId && left.assetId === right.assetId) {
    return true;
  }
  return left.path === right.path;
}

function modelImageKeys(image: ProductImageAsset) {
  return [image.assetId, image.path].filter((key): key is string => Boolean(key));
}

export function ClothingConfigPanel({
  baseModelGenerationSessionId,
  config,
  onChange,
  onGenerateBaseModel,
  onGenerateScenes,
}: ClothingConfigPanelProps) {
  const { showToast } = useToast();
  const [builtinModels, setBuiltinModels] = useState<BuiltinModelView[]>([]);
  const [builtinModelsLoading, setBuiltinModelsLoading] = useState(true);
  const [baseModelGenerating, setBaseModelGenerating] = useState(false);
  const [generatedModelFavoriteInFlightIds, setGeneratedModelFavoriteInFlightIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hoveredGeneratedModelId, setHoveredGeneratedModelId] = useState<string | null>(null);
  const [modelPreview, setModelPreview] = useState<ModelPreview | null>(null);
  const modelPreviewTimerRef = useRef<number | null>(null);
  const builtinModelLibraryScrollRef = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);
  const baseModelGenerationRequestIdRef = useRef(0);
  const baseModelGenerationSessionIdRef = useRef(baseModelGenerationSessionId);
  const deletedModelImageKeysRef = useRef(new Set<string>());
  const generatedModelFavoriteInFlightIdsRef = useRef(new Set<string>());
  const hasClothingImages = config.clothingImages.length > 0;
  const hasSelectedModel = Boolean(
    config.selectedModelId &&
      [...config.modelImages, ...config.generatedBaseModelImages].some(
        (image) => image.id === config.selectedModelId,
      ),
  );
  const hasSceneChoice = config.aiRecommended || config.sceneIds.length > 0;
  const canGenerate = hasClothingImages && hasSelectedModel && hasSceneChoice;
  const canStartScenePlanning = canGenerate && !baseModelGenerating;
  const generateLabel = !hasClothingImages
    ? "请上传服饰图片"
    : !hasSelectedModel
      ? "请选择模特"
      : !hasSceneChoice
        ? "请选择拍摄场景"
        : "开始生成";

  function updateConfig(patch: Partial<ClothingConfigState>) {
    onChange({ ...config, ...patch });
  }

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (baseModelGenerationSessionIdRef.current === baseModelGenerationSessionId) {
      return;
    }
    baseModelGenerationSessionIdRef.current = baseModelGenerationSessionId;
    baseModelGenerationRequestIdRef.current += 1;
    setBaseModelGenerating(false);
  }, [baseModelGenerationSessionId]);

  useEffect(() => {
    let cancelled = false;

    localAssetPort
      .listBuiltinModels()
      .then((models) => {
        if (cancelled) {
          return;
        }
        setBuiltinModels(
          models.map((model) => ({
            ...model,
            fullBodySrc: convertFileSrc(model.path),
            src: convertFileSrc(model.thumbnailPath ?? model.path),
          })),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          showToast({ message: `内置模特加载失败：${errorMessage(error)}`, variant: "error" });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBuiltinModelsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;

    async function listAllModelAssets() {
      const pageSize = 100;
      const assets: Asset[] = [];
      let page = 1;

      for (;;) {
        if (cancelled) {
          return assets;
        }
        const result = await localAssetPort.listAssets({ kind: "model", page, pageSize });
        if (cancelled) {
          return assets;
        }
        assets.push(...result.items);
        if (assets.length >= result.total || result.items.length === 0) {
          return assets;
        }
        page += 1;
      }
    }

    listAllModelAssets()
      .then((assets) => {
        if (cancelled) {
          return;
        }
        const restoredImages = assets
          .map(modelAssetToProductImage)
          .filter((image): image is ProductImageAsset => image !== null);
        if (restoredImages.length === 0) {
          return;
        }

        const currentConfig = configRef.current;
        const knownKeys = new Set(
          currentConfig.modelImages.map((image) => image.assetId ?? image.path),
        );
        const nextImages = restoredImages.filter(
          (image) =>
            !knownKeys.has(image.assetId ?? image.path) &&
            modelImageKeys(image).every((key) => !deletedModelImageKeysRef.current.has(key)),
        );
        if (nextImages.length === 0) {
          return;
        }

        onChange({
          ...currentConfig,
          modelImages: [...currentConfig.modelImages, ...nextImages],
        });
      })
      .catch((error) => {
        if (!cancelled) {
          showToast({ message: `上传模特加载失败：${errorMessage(error)}`, variant: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onChange, showToast]);

  function toggleScene(scene: string) {
    const sceneIds = config.sceneIds.includes(scene)
      ? config.sceneIds.filter((sceneId) => sceneId !== scene)
      : [...config.sceneIds, scene];

    updateConfig({ sceneIds });
  }

  function selectBuiltinModel(model: BuiltinModelView) {
    const modelImage: ProductImageAsset = {
      id: `builtin:${model.id}`,
      name: model.label,
      path: model.path,
      src: model.fullBodySrc,
    };
    const knownImages = config.modelImages.filter((image) => image.id !== modelImage.id);
    updateConfig({
      modelImages: [...knownImages, modelImage],
      selectedModelId: modelImage.id,
    });
  }

  async function handleSelectClothingImages() {
    const remainingCount = maxClothingImageCount - config.clothingImages.length;
    let selectedImages: ProductImageAsset[];
    try {
      selectedImages = await selectProductImages(remainingCount);
    } catch (error) {
      showToast({ message: imageSelectionErrorMessage(error), variant: "error" });
      return;
    }
    const knownPaths = new Set(config.clothingImages.map((image) => image.path));
    const nextImages = selectedImages.filter((image) => !knownPaths.has(image.path));

    updateConfig({
      clothingImages: [...config.clothingImages, ...nextImages].slice(0, maxClothingImageCount),
    });
  }

  async function handleSelectModelImage() {
    const selectedModelIdAtStart = config.selectedModelId;
    let selectedImages: ProductImageAsset[];
    try {
      selectedImages = await selectProductImages(1);
    } catch (error) {
      showToast({ message: imageSelectionErrorMessage(error), variant: "error" });
      return;
    }
    const selectedImage = selectedImages[0];
    if (!selectedImage) {
      return;
    }

    const currentConfig = configRef.current;
    const knownImage = currentConfig.modelImages.find((image) => image.path === selectedImage.path);
    if (knownImage) {
      onChange({
        ...currentConfig,
        selectedModelId:
          currentConfig.selectedModelId === selectedModelIdAtStart
            ? knownImage.id
            : currentConfig.selectedModelId,
      });
      return;
    }

    let importedAsset: Asset | undefined;
    try {
      [importedAsset] = await localAssetPort.importImages({
        kind: "model",
        paths: [selectedImage.path],
      });
    } catch (error) {
      showToast({ message: `模特图片导入失败：${errorMessage(error)}`, variant: "error" });
      return;
    }

    const importedImage = importedAsset ? modelAssetToProductImage(importedAsset) : null;
    if (!importedImage) {
      showToast({ message: "模特图片导入失败：未返回本地文件路径。", variant: "error" });
      return;
    }

    const latestConfig = configRef.current;
    const existingImage = latestConfig.modelImages.find((image) =>
      modelImagesMatch(image, importedImage),
    );
    onChange({
      ...latestConfig,
      modelImages: existingImage ? latestConfig.modelImages : [...latestConfig.modelImages, importedImage],
      selectedModelId:
        latestConfig.selectedModelId === selectedModelIdAtStart
          ? (existingImage?.id ?? importedImage.id)
          : latestConfig.selectedModelId,
    });
  }

  async function handleGenerateBaseModel() {
    const requestId = baseModelGenerationRequestIdRef.current + 1;
    baseModelGenerationRequestIdRef.current = requestId;
    const selectedModelIdAtStart = config.selectedModelId;
    setBaseModelGenerating(true);
    try {
      const generationPromise = onGenerateBaseModel({
        age: config.aiModelAge,
        appearance: config.aiModelAppearance.trim(),
        body: config.aiModelBody,
        ethnicity: config.aiModelEthnicity,
        gender: config.aiModelGender,
      });
      const [generatedModel] = await Promise.all([
        generationPromise,
        waitForTransition(baseModelGenerationTransitionMs),
      ]);
      if (baseModelGenerationRequestIdRef.current !== requestId) {
        return;
      }
      const currentConfig = configRef.current;
      const knownKeys = new Set(
        currentConfig.generatedBaseModelImages.map((image) => image.assetId ?? image.path),
      );
      const generatedBaseModelImages = knownKeys.has(generatedModel.assetId ?? generatedModel.path)
        ? currentConfig.generatedBaseModelImages
        : [generatedModel, ...currentConfig.generatedBaseModelImages];
      onChange({
        ...currentConfig,
        generatedBaseModelImages,
        selectedModelId:
          currentConfig.selectedModelId === selectedModelIdAtStart
            ? generatedModel.id
            : currentConfig.selectedModelId,
      });
    } catch (error) {
      if (
        baseModelGenerationRequestIdRef.current !== requestId ||
        isClothingBaseModelGenerationCancelledError(error)
      ) {
        return;
      }
      showToast({ message: `基准模特生成失败：${errorMessage(error)}`, variant: "error" });
    } finally {
      if (baseModelGenerationRequestIdRef.current === requestId) {
        setBaseModelGenerating(false);
      }
    }
  }

  async function handleToggleGeneratedModelFavorite(image: GeneratedBaseModelImage) {
    if (generatedModelFavoriteInFlightIdsRef.current.has(image.id)) {
      return;
    }
    generatedModelFavoriteInFlightIdsRef.current.add(image.id);
    setGeneratedModelFavoriteInFlightIds((currentIds) => new Set(currentIds).add(image.id));

    try {
      if (image.favoritedModelImage) {
        const favoritedImage = image.favoritedModelImage;
        const deletedKeys = modelImageKeys(favoritedImage);
        if (favoritedImage.assetId) {
          try {
            await localAssetPort.deleteAsset(favoritedImage.assetId);
          } catch (error) {
            showToast({ message: `取消收藏失败：${errorMessage(error)}`, variant: "error" });
            return;
          }
        }
        deletedKeys.forEach((key) => deletedModelImageKeysRef.current.add(key));

        const currentConfig = configRef.current;
        onChange({
          ...currentConfig,
          generatedBaseModelImages: currentConfig.generatedBaseModelImages.map((currentImage) =>
            currentImage.id === image.id
              ? {
                  ...currentImage,
                  favoritedModelImage: undefined,
                }
              : currentImage,
          ),
          modelImages: currentConfig.modelImages.filter(
            (modelImage) =>
              modelImage.assetId !== favoritedImage.assetId &&
              modelImage.path !== favoritedImage.path,
          ),
          selectedModelId:
            currentConfig.selectedModelId === favoritedImage.id ? image.id : currentConfig.selectedModelId,
        });
        return;
      }

      let importedAsset: Asset | undefined;
      try {
        [importedAsset] = await localAssetPort.importImages({
          kind: "model",
          paths: [image.path],
        });
      } catch (error) {
        showToast({ message: `基准模特收藏失败：${errorMessage(error)}`, variant: "error" });
        return;
      }

      const importedImage = importedAsset ? modelAssetToProductImage(importedAsset) : null;
      if (!importedImage) {
        showToast({ message: "基准模特收藏失败：未返回本地文件路径。", variant: "error" });
        return;
      }

      const currentConfig = configRef.current;
      const knownKeys = new Set(currentConfig.modelImages.map((modelImage) => modelImage.assetId ?? modelImage.path));
      onChange({
        ...currentConfig,
        generatedBaseModelImages: currentConfig.generatedBaseModelImages.map((currentImage) =>
          currentImage.id === image.id
            ? {
                ...currentImage,
                favoritedModelImage: importedImage,
              }
            : currentImage,
        ),
        modelImages: knownKeys.has(importedImage.assetId ?? importedImage.path)
          ? currentConfig.modelImages
          : [importedImage, ...currentConfig.modelImages],
      });
    } finally {
      generatedModelFavoriteInFlightIdsRef.current.delete(image.id);
      setGeneratedModelFavoriteInFlightIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(image.id);
        return nextIds;
      });
    }
  }

  function handleRemoveClothingImage(imageId: string) {
    updateConfig({
      clothingImages: config.clothingImages.filter((image) => image.id !== imageId),
    });
  }

  async function handleDeleteModelImage(image: ProductImageAsset) {
    const deletedKeys = modelImageKeys(image);
    if (image.assetId) {
      try {
        await localAssetPort.deleteAsset(image.assetId);
      } catch (error) {
        showToast({ message: `模特删除失败：${errorMessage(error)}`, variant: "error" });
        return;
      }
    }
    deletedKeys.forEach((key) => deletedModelImageKeysRef.current.add(key));

    const currentConfig = configRef.current;
    const selectedModelDeleted = currentConfig.modelImages.some(
      (modelImage) => modelImage.id === currentConfig.selectedModelId && modelImagesMatch(modelImage, image),
    );
    onChange({
      ...currentConfig,
      generatedBaseModelImages: currentConfig.generatedBaseModelImages.map((currentImage) =>
        currentImage.favoritedModelImage && modelImagesMatch(currentImage.favoritedModelImage, image)
          ? {
              ...currentImage,
              favoritedModelImage: undefined,
            }
          : currentImage,
      ),
      modelImages: currentConfig.modelImages.filter((modelImage) => !modelImagesMatch(modelImage, image)),
      selectedModelId: selectedModelDeleted ? null : currentConfig.selectedModelId,
    });
  }

  function clearModelPreview() {
    if (modelPreviewTimerRef.current !== null) {
      window.clearTimeout(modelPreviewTimerRef.current);
      modelPreviewTimerRef.current = null;
    }
    setModelPreview(null);
  }

  function scheduleModelPreview(
    preview: Pick<ModelPreview, "fullBodySrc" | "label">,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    clearModelPreview();
    const tile = event.currentTarget;

    modelPreviewTimerRef.current = window.setTimeout(() => {
      const tileRect = tile.getBoundingClientRect();
      setModelPreview({
        fullBodySrc: preview.fullBodySrc,
        label: preview.label,
        left: tileRect.right + 12,
        top: Math.max(12, tileRect.top),
      });
      modelPreviewTimerRef.current = null;
    }, modelPreviewDelayMs);
  }

  useEffect(
    () => () => {
      if (modelPreviewTimerRef.current !== null) {
        window.clearTimeout(modelPreviewTimerRef.current);
      }
    },
    [],
  );

  return (
    <aside
      aria-label="服饰配置"
      className="relative z-10 flex min-h-0 flex-col bg-white/50 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
    >
      <div
        className="min-h-0 flex-1 overscroll-none overflow-y-auto px-4 py-5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]"
        data-testid="clothing-config-scroll"
      >
        <ControlGroup title="服饰图片">
          {hasClothingImages ? (
            <ImageUploadGrid
              addLabel="添加服装图片"
              images={config.clothingImages}
              maxCount={maxClothingImageCount}
              onAdd={handleSelectClothingImages}
              onRemove={handleRemoveClothingImage}
            />
          ) : (
            <UploadDropzone
              actionLabel="服装图片"
              description="整套搭配或同一件服装不同角度图，最多5张。"
              icon={<ImageUp className="size-4" />}
              onClick={handleSelectClothingImages}
            />
          )}
        </ControlGroup>

        <ControlGroup title="模特形象">
          <div className="mb-3 grid grid-cols-2 rounded-control bg-slate-100/70 p-1 shadow-[inset_0_1px_1px_rgba(15,23,42,0.05)]">
            <button
              aria-pressed={config.modelMode === "library"}
              className={cn(
                "h-7 rounded-[10px] text-[12px] font-medium transition-all",
                config.modelMode === "library"
                  ? "bg-white text-slate-900 shadow-control"
                  : "text-app-muted hover:text-slate-900",
              )}
              onClick={() => updateConfig({ modelMode: "library" })}
              type="button"
            >
              模特库
            </button>
            <button
              aria-pressed={config.modelMode === "ai"}
              className={cn(
                "inline-flex h-7 items-center justify-center gap-1 rounded-[10px] text-[12px] font-medium transition-all",
                config.modelMode === "ai"
                  ? "bg-white text-slate-900 shadow-control"
                  : "text-app-muted hover:text-slate-900",
              )}
              onClick={() => updateConfig({ modelMode: "ai" })}
              type="button"
            >
              AI 生成
              <HelpCircle className="size-3" />
            </button>
          </div>
          {config.modelMode === "ai" ? (
            <AiModelGenerationControls
              config={config}
              favoriteInFlightIds={generatedModelFavoriteInFlightIds}
              generating={baseModelGenerating}
              hoveredGeneratedModelId={hoveredGeneratedModelId}
              onChange={updateConfig}
              onFavoriteGeneratedModel={handleToggleGeneratedModelFavorite}
              onGenerateBaseModel={handleGenerateBaseModel}
              onGeneratedModelHoverChange={setHoveredGeneratedModelId}
              onGeneratedModelPreviewEnter={(preview, event) => scheduleModelPreview(preview, event)}
              onGeneratedModelPreviewLeave={clearModelPreview}
            />
          ) : (
            <div className="relative">
              <div
                aria-busy={builtinModelsLoading}
                ref={builtinModelLibraryScrollRef}
                className="max-h-[224px] overflow-y-auto overscroll-contain pr-4 [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.45)_transparent]"
                data-testid="builtin-model-library-scroll"
              >
                <div className="grid grid-cols-4 gap-2">
                  <ModelUploadTile onClick={handleSelectModelImage} />
                  {config.modelImages.filter((image) => !image.id.startsWith("builtin:")).map((image) => (
                    <ModelImageTile
                      image={image}
                      key={image.id}
                      onDelete={isDeletableModelImage(image) ? () => void handleDeleteModelImage(image) : undefined}
                      onPreviewEnter={(event) =>
                        scheduleModelPreview(
                          {
                            fullBodySrc: image.src,
                            label: image.name,
                          },
                          event,
                        )
                      }
                      onPreviewLeave={clearModelPreview}
                      onSelect={() => updateConfig({ selectedModelId: image.id })}
                      selected={config.selectedModelId === image.id}
                    />
                  ))}
                  {builtinModels.map((model) => (
                    <BuiltinModelTile
                      key={model.id}
                      model={model}
                      onPreviewEnter={(event) =>
                        scheduleModelPreview(
                          {
                            fullBodySrc: model.fullBodySrc,
                            label: model.label,
                          },
                          event,
                        )
                      }
                      onPreviewLeave={clearModelPreview}
                      onSelect={() => selectBuiltinModel(model)}
                      selected={config.selectedModelId === `builtin:${model.id}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          {modelPreview ? <ModelPreviewTooltip preview={modelPreview} /> : null}
        </ControlGroup>

        {config.aiRecommended ? null : (
          <>
            <ControlGroup title="拍摄场景">
              <div className="grid grid-cols-3 gap-2">
                {sceneOptions.map((scene) => (
                  <SceneOption
                    key={scene}
                    checked={config.sceneIds.includes(scene)}
                    label={scene}
                    onToggle={() => toggleScene(scene)}
                  />
                ))}
              </div>
            </ControlGroup>

            <ControlGroup title="自定义描述场景" hint="可选">
              <TextAreaPanel
                className="h-[52px] leading-5"
                onChange={(event) => updateConfig({ customScene: event.target.value })}
                placeholder="描述你想要的场景：如秋季枫叶小径、暖色调午后阳光、模特倚靠树干..."
                value={config.customScene}
              />
            </ControlGroup>
          </>
        )}

        <div className="mb-5 flex items-center justify-between rounded-control border border-white/70 bg-slate-100/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-800">
            AI推荐
            <HelpCircle className="size-3 text-app-muted" />
          </div>
          <button
            aria-label="AI推荐"
            aria-pressed={config.aiRecommended}
            className={cn(
              "relative h-5 w-9 shrink-0 overflow-hidden rounded-full shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)] transition-colors",
              config.aiRecommended ? "bg-app-blue" : "bg-slate-200",
            )}
            onClick={() => updateConfig({ aiRecommended: !config.aiRecommended })}
            type="button"
          >
            <span
              data-testid="ai-recommend-switch-thumb"
              className={cn(
                "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.14)] transition-transform",
                config.aiRecommended ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
        </div>

        <ControlGroup title="图片比例">
          <div className="grid grid-cols-3 rounded-control bg-slate-100/70 p-1 shadow-[inset_0_1px_1px_rgba(15,23,42,0.05)]">
            {ratios.map((ratio) => (
              <button
                key={ratio}
                aria-pressed={config.ratio === ratio}
                className={cn(
                  "h-7 rounded-[10px] text-[12px] font-medium transition-all",
                  config.ratio === ratio
                    ? "bg-white text-slate-900 shadow-control"
                    : "text-app-muted hover:text-slate-900",
                )}
                onClick={() => updateConfig({ ratio })}
                type="button"
              >
                {ratio}
              </button>
            ))}
          </div>
        </ControlGroup>
      </div>

      <div className="relative border-t border-white/70 bg-white/70 p-4 shadow-[0_-14px_28px_rgba(248,250,252,0.72)] backdrop-blur-2xl">
        <Button
          className={cn(
            "h-10 w-full justify-center rounded-control border font-semibold",
            canStartScenePlanning
              ? "border-slate-950/10 bg-[linear-gradient(180deg,#111827,#071022)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_24px_rgba(15,23,42,0.22)] hover:bg-[linear-gradient(180deg,#172033,#0b1220)]"
              : "cursor-not-allowed border-slate-300 bg-slate-300 text-slate-700 shadow-none hover:bg-slate-300 hover:shadow-none",
          )}
          disabled={!canStartScenePlanning}
          onClick={() => onGenerateScenes(config)}
          type="button"
        >
          {generateLabel}
        </Button>
      </div>
    </aside>
  );
}

export function ClothingSceneSelectionPanel({
  drafts,
  onChange,
  onBack,
  onGenerateSceneImages,
  planning,
  sceneGenerating,
}: {
  drafts: ClothingSceneDraft[];
  onChange: (drafts: ClothingSceneDraft[]) => void;
  onBack: () => void;
  onGenerateSceneImages: (drafts: ClothingSceneDraft[]) => void;
  planning: boolean;
  sceneGenerating: boolean;
}) {
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const sceneGroups = Array.from(new Set(drafts.map((draft) => draft.scene)));
  const selectedDrafts = drafts.filter((draft) => draft.checked);

  function updateSceneDraft(draftId: string, patch: Partial<ClothingSceneDraft>) {
    onChange(
      drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft)),
    );
  }

  function toggleSceneDraft(draftId: string) {
    onChange(
      drafts.map((draft) =>
        draft.id === draftId ? { ...draft, checked: !draft.checked } : draft,
      ),
    );
    setOpenSelect(null);
  }

  function toggleSceneGroup(scene: string) {
    const groupDrafts = drafts.filter((draft) => draft.scene === scene);
    const groupAllSelected = groupDrafts.every((draft) => draft.checked);
    onChange(
      drafts.map((draft) =>
        draft.scene === scene ? { ...draft, checked: !groupAllSelected } : draft,
      ),
    );
    setOpenSelect(null);
  }

  function getSceneGroupCheckedState(scene: string): boolean | "indeterminate" {
    const groupDrafts = drafts.filter((draft) => draft.scene === scene);
    const selectedDraftCount = groupDrafts.filter((draft) => draft.checked).length;

    if (selectedDraftCount === 0) {
      return false;
    }

    if (selectedDraftCount === groupDrafts.length) {
      return true;
    }

    return "indeterminate";
  }

  if (planning || drafts.length === 0) {
    return (
      <aside
        aria-label="选择场景"
        className="relative z-40 flex min-h-0 flex-col bg-white/70 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <h2 className="text-[14px] font-semibold text-slate-950">选择场景</h2>
          <div className="mt-4 flex h-[330px] items-center justify-center rounded-[14px] bg-slate-100/80">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="flex items-center gap-2" aria-hidden="true">
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70" />
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70 [animation-delay:120ms]" />
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70 [animation-delay:240ms]" />
              </div>
              <p className="text-[13px] font-medium">生成中...</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_2.25fr] gap-3 border-t border-slate-200/70 bg-white/80 p-4 shadow-[0_-10px_24px_rgba(248,250,252,0.78)] backdrop-blur-2xl">
          <Button
            className="h-10 justify-center border-slate-100 bg-slate-100 text-slate-800 shadow-none hover:bg-slate-200/80"
            onClick={onBack}
            type="button"
          >
            上一步
          </Button>
          <Button
            className="h-10 justify-center border-slate-300 bg-slate-300 font-semibold text-slate-700 shadow-none hover:bg-slate-300 hover:shadow-none"
            disabled
            type="button"
          >
            请先选择场景
          </Button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="选择场景"
      className="relative z-40 flex min-h-0 flex-col bg-white/70 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
        <h2 className="text-[14px] font-semibold text-slate-950">选择场景</h2>
        <div className="mt-4 space-y-4">
          {sceneGroups.map((scene) => (
            <section key={scene}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[12px] font-medium text-slate-500">{scene}</h3>
                <SelectionCheckbox
                  checked={getSceneGroupCheckedState(scene)}
                  disabled={sceneGenerating}
                  label={scene}
                  onCheckedChange={() => toggleSceneGroup(scene)}
                />
              </div>
              <div className="space-y-3">
                {drafts
                  .filter((draft) => draft.scene === scene)
                  .map((draft) => (
                    <ClothingSceneCard
                      draft={draft}
                      key={draft.id}
                      onAngleChange={(angle) => updateSceneDraft(draft.id, { angle })}
                      onFramingChange={(framing) => updateSceneDraft(draft.id, { framing })}
                      onOpenSelectChange={setOpenSelect}
                      onToggle={() => toggleSceneDraft(draft.id)}
                      openSelect={openSelect}
                      sceneGenerating={sceneGenerating}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_2.25fr] gap-3 border-t border-slate-200/70 bg-white/80 p-4 shadow-[0_-10px_24px_rgba(248,250,252,0.78)] backdrop-blur-2xl">
        <Button
          className="h-10 justify-center border-slate-100 bg-slate-100 text-slate-800 shadow-none hover:bg-slate-200/80"
          disabled={sceneGenerating}
          onClick={onBack}
          type="button"
        >
          上一步
        </Button>
        <Button
          className={cn(
            "h-10 justify-center font-semibold",
            selectedDrafts.length > 0 && !sceneGenerating
              ? "border-slate-950/10 bg-[#1f1f21] text-white shadow-none hover:bg-black"
              : "border-slate-200 bg-slate-200 text-white shadow-none",
          )}
          disabled={selectedDrafts.length === 0 || sceneGenerating}
          onClick={() => onGenerateSceneImages(selectedDrafts)}
          type="button"
        >
          {sceneGenerating
            ? "场景图生成中"
            : selectedDrafts.length > 0
              ? `生成场景图片（${selectedDrafts.length}张）`
              : "请先选择场景"}
        </Button>
      </div>
    </aside>
  );
}

function ClothingSceneCard({
  draft,
  onAngleChange,
  onFramingChange,
  onOpenSelectChange,
  onToggle,
  openSelect,
  sceneGenerating,
}: {
  draft: ClothingSceneDraft;
  onAngleChange: (angle: string) => void;
  onFramingChange: (framing: string) => void;
  onOpenSelectChange: (key: string | null) => void;
  onToggle: () => void;
  openSelect: string | null;
  sceneGenerating: boolean;
}) {
  return (
    <article
      className="rounded-[10px] bg-slate-100/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]"
      data-scene-draft-id={draft.id}
      data-testid="clothing-scene-card"
    >
      <label className="flex items-start gap-2">
        <SelectionCheckbox
          checked={draft.checked}
          disabled={sceneGenerating}
          label={draft.description}
          onCheckedChange={onToggle}
        />
        <span className="min-w-0 flex-1 text-[12px] leading-5 text-slate-600">{draft.description}</span>
      </label>
      {draft.checked ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AiModelDropdown
            label="画幅"
            onChange={onFramingChange}
            onOpenChange={onOpenSelectChange}
            open={openSelect === `${draft.id}:framing`}
            openKey={`${draft.id}:framing`}
            options={sceneFramingOptions}
            value={draft.framing}
            variant="scene"
            disabled={sceneGenerating}
          />
          <AiModelDropdown
            label="角度"
            onChange={onAngleChange}
            onOpenChange={onOpenSelectChange}
            open={openSelect === `${draft.id}:angle`}
            openKey={`${draft.id}:angle`}
            options={sceneAngleOptions}
            value={draft.angle}
            variant="scene"
            disabled={sceneGenerating}
          />
        </div>
      ) : null}
    </article>
  );
}

function SelectionCheckbox({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean | "indeterminate";
  disabled?: boolean;
  label: string;
  onCheckedChange: () => void;
}) {
  const active = checked !== false;
  const indeterminate = checked === "indeterminate";

  return (
    <Checkbox.Root
      aria-label={label}
      checked={checked}
      disabled={disabled}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-all duration-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55",
        active
          ? "scale-105 border-app-blue bg-app-blue text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_4px_10px_rgba(59,130,246,0.24)]"
          : "border-slate-300 bg-white/90 shadow-inset",
      )}
      onCheckedChange={onCheckedChange}
    >
      <Checkbox.Indicator
        className={cn(
          "grid place-items-center transition-all duration-200 ease-out",
          active ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
        forceMount
      >
        {indeterminate ? (
          <Minus className="size-3 transition-transform duration-200" />
        ) : (
          <Check className="size-3 transition-transform duration-200" />
        )}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

function AiModelGenerationControls({
  config,
  favoriteInFlightIds,
  generating,
  hoveredGeneratedModelId,
  onChange,
  onFavoriteGeneratedModel,
  onGenerateBaseModel,
  onGeneratedModelHoverChange,
  onGeneratedModelPreviewEnter,
  onGeneratedModelPreviewLeave,
}: {
  config: ClothingConfigState;
  favoriteInFlightIds: ReadonlySet<string>;
  generating: boolean;
  hoveredGeneratedModelId: string | null;
  onChange: (patch: Partial<ClothingConfigState>) => void;
  onFavoriteGeneratedModel: (image: GeneratedBaseModelImage) => void;
  onGenerateBaseModel: () => void;
  onGeneratedModelHoverChange: (id: string | null) => void;
  onGeneratedModelPreviewEnter: (
    preview: Pick<ModelPreview, "fullBodySrc" | "label">,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onGeneratedModelPreviewLeave: () => void;
}) {
  const [openSelect, setOpenSelect] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-testid="ai-model-generation-controls">
      <div className="grid grid-cols-2 gap-2">
        <AiModelDropdown
          label="性别"
          onChange={(aiModelGender) => onChange({ aiModelGender })}
          onOpenChange={setOpenSelect}
          open={openSelect === "gender"}
          openKey="gender"
          options={aiModelGenderOptions}
          value={config.aiModelGender}
        />
        <AiModelDropdown
          label="年龄"
          onChange={(aiModelAge) => onChange({ aiModelAge })}
          onOpenChange={setOpenSelect}
          open={openSelect === "age"}
          openKey="age"
          options={aiModelAgeOptions}
          value={config.aiModelAge}
        />
        <AiModelDropdown
          label="人群"
          onChange={(aiModelEthnicity) => onChange({ aiModelEthnicity })}
          onOpenChange={setOpenSelect}
          open={openSelect === "ethnicity"}
          openKey="ethnicity"
          options={aiModelEthnicityOptions}
          value={config.aiModelEthnicity}
        />
        <AiModelDropdown
          label="体型"
          onChange={(aiModelBody) => onChange({ aiModelBody })}
          onOpenChange={setOpenSelect}
          open={openSelect === "body"}
          openKey="body"
          options={aiModelBodyOptions}
          value={config.aiModelBody}
        />
      </div>
      <label className="block">
        <span className="mb-2 block text-[13px] font-medium text-slate-700">外貌细节（可选）</span>
        <textarea
          aria-label="外貌细节"
          className="h-[86px] w-full resize-none rounded-[14px] border border-slate-200 bg-white/80 px-3 py-3 text-[13px] leading-6 text-slate-800 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
          onChange={(event) => onChange({ aiModelAppearance: event.target.value })}
          placeholder="例如：小麦色皮肤、齐刘海、眼角有泪痣..."
          value={config.aiModelAppearance}
        />
      </label>
      <button
        className={cn(
          "inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-slate-100 bg-slate-100 text-[14px] font-medium text-slate-900 shadow-none transition-colors hover:bg-slate-200/80",
          generating ? "cursor-not-allowed text-app-muted hover:bg-slate-100" : "",
        )}
        disabled={generating}
        onClick={onGenerateBaseModel}
        type="button"
      >
        <Sparkles className="size-4 text-app-blue" />
        生成基准模特
      </button>
      {generating ? (
        <div className="rounded-control border border-blue-100 bg-blue-50/70 px-3 py-2 text-center text-[12px] font-medium text-blue-700">
          正在生成基准模特...
        </div>
      ) : null}
      {config.generatedBaseModelImages.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-[14px] font-semibold text-slate-950">基准模特图</h3>
          <div className="grid grid-cols-3 gap-2">
            {config.generatedBaseModelImages.map((image) => {
              const favoriteAction = image.favoritedModelImage ? "取消收藏" : "收藏";
              const favoriteInFlight = favoriteInFlightIds.has(image.id);
              return (
                <article
                  className="relative"
                  key={image.id}
                  onMouseEnter={(event) => {
                    onGeneratedModelHoverChange(image.id);
                    onGeneratedModelPreviewEnter(
                      {
                        fullBodySrc: image.src,
                        label: image.name,
                      },
                      event,
                    );
                  }}
                  onMouseLeave={() => {
                    onGeneratedModelHoverChange(null);
                    onGeneratedModelPreviewLeave();
                  }}
                >
                  <button
                    aria-label={`选择生成模特 ${image.name}`}
                    aria-pressed={config.selectedModelId === image.id}
                    className={cn(
                      "group relative aspect-square w-full overflow-hidden rounded-[12px] border border-white/80 bg-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_3px_rgba(15,23,42,0.08)] transition-all hover:scale-[1.015] hover:shadow-[0_10px_22px_rgba(15,23,42,0.12)]",
                      config.selectedModelId === image.id ? "ring-2 ring-app-blue ring-offset-1 ring-offset-white" : "",
                    )}
                    onClick={() => onChange({ selectedModelId: image.id })}
                    type="button"
                  >
                    <img alt={image.name} className="h-full w-full object-cover" src={image.src} />
                    {config.selectedModelId === image.id ? (
                      <span
                        aria-label={`已选中 ${image.name}`}
                        className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-app-blue text-white shadow-[0_4px_10px_rgba(59,130,246,0.28)]"
                      >
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </button>
                  <button
                    aria-busy={favoriteInFlight}
                    aria-label={`${favoriteInFlight ? `正在${favoriteAction}` : favoriteAction}${image.name}`}
                    className={cn(
                      "absolute inset-x-2 bottom-2 z-10 inline-flex h-8 items-center justify-center rounded-[10px] bg-white/92 text-[12px] font-medium text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur transition-opacity disabled:cursor-not-allowed disabled:text-app-muted",
                      hoveredGeneratedModelId === image.id ? "opacity-100" : "pointer-events-none opacity-0",
                    )}
                    disabled={favoriteInFlight}
                    onClick={(event) => {
                      event.stopPropagation();
                      onFavoriteGeneratedModel(image);
                    }}
                    type="button"
                  >
                    {favoriteInFlight ? `${favoriteAction}中...` : favoriteAction}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiModelDropdown({
  label,
  onChange,
  onOpenChange,
  open,
  openKey,
  options,
  value,
  variant = "default",
  disabled = false,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  onOpenChange: (key: string | null) => void;
  open: boolean;
  openKey: string;
  options: string[];
  value: string;
  variant?: "default" | "scene";
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(null);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label} ${value}`}
        className={cn(
          "inline-flex h-8 w-full items-center justify-between gap-2 rounded-control border px-3 text-[12px] font-medium text-slate-800 transition-all duration-200 ease-out active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/25 disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
          variant === "scene"
            ? "border-slate-200/80 bg-white/30 shadow-none hover:border-slate-300/80 hover:bg-white/45"
            : "border-white/60 bg-slate-100/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] hover:border-white hover:bg-white/90 hover:shadow-control",
          open &&
            (variant === "scene"
              ? "border-app-blue/60 bg-white/55 ring-2 ring-blue-100/50"
              : "border-blue-200 bg-white shadow-control ring-2 ring-blue-100/70"),
        )}
        disabled={disabled}
        onClick={() => onOpenChange(open ? null : openKey)}
        type="button"
      >
        <span className="truncate">{value}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-app-muted transition-transform duration-200",
            open && "rotate-180 text-slate-800",
          )}
        />
      </button>
      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-panel border border-white/80 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
          role="listbox"
        >
          {options.map((option) => {
            const selected = option === value;

            return (
              <button
                key={option}
                aria-selected={selected}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[12px] font-semibold text-slate-800 transition-all duration-150 ease-out hover:bg-slate-100 active:scale-[0.99]",
                  selected && "text-slate-950",
                )}
                onClick={() => {
                  onChange(option);
                  onOpenChange(null);
                }}
                role="option"
                type="button"
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border border-slate-300 bg-white transition-all duration-150",
                    selected && "border-app-blue bg-app-blue text-white shadow-[0_2px_6px_rgba(59,130,246,0.22)]",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ModelUploadTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="上传新模特"
      className="group relative aspect-square overflow-hidden rounded-control border border-white/70 bg-slate-100/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-control"
      onClick={onClick}
      type="button"
    >
      <div className="grid h-full place-items-center text-app-muted">
        <div className="text-center">
          <UserRound className="mx-auto size-5" />
          <span className="mt-1 block text-[10px] leading-none">上传新模特</span>
        </div>
      </div>
    </button>
  );
}

function ModelImageTile({
  image,
  onDelete,
  onPreviewEnter,
  onPreviewLeave,
  onSelect,
  selected,
}: {
  image: ProductImageAsset;
  onDelete?: () => void;
  onPreviewEnter: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPreviewLeave: () => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <div className="group/model relative aspect-square">
      <button
        aria-label={`选择模特 ${image.name}`}
        aria-pressed={selected}
        className={cn(
          "group absolute inset-0 overflow-hidden rounded-control border bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-control",
          selected ? "border-app-blue ring-2 ring-blue-100" : "border-white/70",
        )}
        onClick={onSelect}
        onMouseEnter={onPreviewEnter}
        onMouseLeave={onPreviewLeave}
        type="button"
      >
        <img
          alt={image.name}
          className="h-full w-full object-cover"
          draggable={false}
          src={image.thumbnailSrc ?? image.src}
        />
        <ModelSelectionIndicator label={image.name} selected={selected} />
      </button>
      {onDelete ? (
        <button
          aria-label={`删除模特 ${image.name}`}
          className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-full border border-white/80 bg-white/90 text-slate-500 opacity-0 shadow-[0_4px_12px_rgba(15,23,42,0.16)] transition-all duration-200 hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 group-hover/model:opacity-100"
          onClick={onDelete}
          type="button"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function BuiltinModelTile({
  model,
  onPreviewEnter,
  onPreviewLeave,
  onSelect,
  selected,
}: {
  model: BuiltinModelView;
  onPreviewEnter: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPreviewLeave: () => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-label={`选择内置模特 ${model.label}`}
      aria-pressed={selected}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-control border bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-control",
        selected ? "border-app-blue ring-2 ring-blue-100" : "border-white/70",
      )}
      onClick={onSelect}
      onMouseEnter={onPreviewEnter}
      onMouseLeave={onPreviewLeave}
      type="button"
    >
      <img
        alt={model.label}
        className="h-full w-full object-cover"
        draggable={false}
        src={model.src}
      />
      <ModelSelectionIndicator label={model.label} selected={selected} />
    </button>
  );
}

function ModelPreviewTooltip({ preview }: { preview: ModelPreview }) {
  return createPortal(
    <div
      aria-label={`${preview.label} 全身照预览`}
      className="pointer-events-none fixed z-[130] w-[184px] rounded-panel border border-white/80 bg-white/95 p-2 shadow-[0_18px_42px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
      role="tooltip"
      style={{ left: preview.left, top: preview.top }}
    >
      <div className="overflow-hidden rounded-[12px] bg-slate-100">
        <img
          alt={`${preview.label} 全身照`}
          className="h-[260px] w-full object-cover object-top"
          draggable={false}
          src={preview.fullBodySrc}
        />
      </div>
      <div className="mt-2 truncate px-1 text-center text-[12px] font-semibold text-slate-700">
        {preview.label}
      </div>
    </div>,
    document.body,
  );
}

function ModelSelectionIndicator({ label, selected }: { label: string; selected: boolean }) {
  if (!selected) {
    return null;
  }

  return (
    <span
      aria-label={`已选中 ${label}`}
      className="absolute left-1.5 top-1.5 grid size-4 place-items-center rounded-[5px] border border-app-blue bg-app-blue text-white shadow-[0_2px_6px_rgba(37,99,235,0.22)]"
    >
      <Check className="size-3" />
    </span>
  );
}

function SceneOption({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={checked}
      className="flex h-9 cursor-pointer items-center gap-2 rounded-control border border-white/60 bg-slate-100/60 px-2.5 text-[12px] font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors hover:bg-white/80"
      onClick={onToggle}
      type="button"
    >
      <span
        className={cn(
          "grid size-4 place-items-center rounded-[5px] border",
          checked
            ? "border-app-blue bg-app-blue text-white shadow-[0_2px_6px_rgba(59,130,246,0.18)]"
            : "border-slate-300 bg-white/90",
        )}
      >
        {checked ? <span className="size-1.5 rounded-full bg-white" /> : null}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function imageSelectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "图片处理失败，请使用 png、jpg、jpeg 或 webp 图片。";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function waitForTransition(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}
