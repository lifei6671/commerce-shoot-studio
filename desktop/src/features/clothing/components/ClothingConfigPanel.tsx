import { useEffect, useRef, useState } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import { Check, ChevronDown, HelpCircle, ImageUp, Minus, Sparkles, UserRound } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { ControlGroup } from "../../../shared/ui/control-group";
import { ImageUploadGrid } from "../../../shared/ui/image-upload-grid";
import { TextAreaPanel } from "../../../shared/ui/textarea-panel";
import { UploadDropzone } from "../../../shared/ui/upload-dropzone";
import { cn } from "../../../shared/lib/cn";
import { useToast } from "../../../shared/ui/toast";
import { selectProductImages, type ProductImageAsset } from "../../generation/lib/productImagePicker";

const modelPresets = [
  { id: "upload", label: "上传新模特", tone: "upload" },
  { id: "aurora", label: "柔光女模", tone: "warm" },
  { id: "urban", label: "都市男模", tone: "cool" },
  { id: "editorial", label: "杂志女模", tone: "dark" },
  { id: "asian", label: "亚洲女模", tone: "soft" },
  { id: "young", label: "清新女模", tone: "peach" },
  { id: "street", label: "短发女模", tone: "rose" },
  { id: "sports", label: "运动男模", tone: "sand" },
];

const sceneOptions = ["纯色棚拍", "都市街头", "街角咖啡", "自然草坪", "度假海滩", "温馨居家", "艺术展馆"];

const aiModelGenderOptions = ["男", "女"];
const aiModelAgeOptions = ["婴儿", "儿童", "青少年", "青年", "中年", "老年"];
const aiModelEthnicityOptions = ["欧美白人", "中国人", "东亚人", "东南亚人", "非裔", "中东人", "拉丁裔"];
const aiModelBodyOptions = ["纤细", "标准", "肌肉", "微胖", "大码"];

const ratios = ["3:4", "1:1", "9:16"];
const sceneFramingOptions = ["全身", "四分之三", "半身", "特写"];
const sceneAngleOptions = ["正面", "侧面", "3/4 侧", "背面"];
const maxClothingImageCount = 5;
const sceneDraftDelayMs = 2500;
const clothingSceneDrafts = [
  {
    id: "urban-stand",
    scene: "都市街头",
    checked: true,
    description: "自然站立，双手插裤兜，肩膀微抬，直视镜头，清晰展示背心正面印花",
    framing: "全身",
    angle: "正面",
  },
  {
    id: "urban-step",
    scene: "都市街头",
    checked: true,
    description: "侧身迈步向前走，一只手自然搭在裤边，转头看向前方，展示背心侧部剪裁",
    framing: "四分之三",
    angle: "3/4 侧",
  },
  {
    id: "urban-road",
    scene: "都市街头",
    checked: true,
    description: "侧身靠在路牌上，一只手随意抬至脑后，展示背心肩线与手臂线条",
    framing: "半身",
    angle: "侧面",
  },
  {
    id: "urban-front",
    scene: "都市街头",
    checked: false,
    description: "身体微向前倾，双手自然垂在身侧，下颌微抬，展示背心整体版型",
    framing: "全身",
    angle: "正面",
  },
  {
    id: "cafe-sit",
    scene: "街角咖啡",
    checked: true,
    description: "坐在户外木椅上，身体放松靠向椅背，双手搭在桌沿，清晰展示背心正面",
    framing: "全身",
    angle: "正面",
  },
  {
    id: "cafe-turn",
    scene: "街角咖啡",
    checked: true,
    description: "站在咖啡店旁，一只手拿着冰咖啡，转头看向侧边，展示背心胸部轮廓",
    framing: "四分之三",
    angle: "3/4 侧",
  },
  {
    id: "cafe-lean",
    scene: "街角咖啡",
    checked: true,
    description: "侧身倚靠在咖啡店门框远方，展示背心肩线，姿态放松自然",
    framing: "半身",
    angle: "侧面",
  },
];

export type ClothingConfigState = {
  aiRecommended: boolean;
  aiModelAge: string;
  aiModelBody: string;
  aiModelEthnicity: string;
  aiModelGender: string;
  aiModelAppearance: string;
  clothingImages: ProductImageAsset[];
  customScene: string;
  modelMode: "library" | "ai";
  modelImages: ProductImageAsset[];
  ratio: string;
  sceneIds: string[];
  selectedModelId: string | null;
};

type ClothingConfigPanelProps = {
  config: ClothingConfigState;
  onChange: (config: ClothingConfigState) => void;
  onGenerateScenes: () => void;
};

export const defaultClothingConfig: ClothingConfigState = {
  aiRecommended: false,
  aiModelAge: "青年",
  aiModelBody: "标准",
  aiModelEthnicity: "中国人",
  aiModelGender: "男",
  aiModelAppearance: "",
  clothingImages: [],
  customScene: "",
  modelMode: "library",
  modelImages: [],
  ratio: "3:4",
  sceneIds: sceneOptions.slice(0, 2),
  selectedModelId: null,
};

export function ClothingConfigPanel({ config, onChange, onGenerateScenes }: ClothingConfigPanelProps) {
  const { showToast } = useToast();
  const hasClothingImages = config.clothingImages.length > 0;
  const hasSelectedModel = Boolean(config.selectedModelId);
  const hasSceneChoice = config.aiRecommended || config.sceneIds.length > 0;
  const canGenerate = hasClothingImages && hasSelectedModel && hasSceneChoice;
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

  function toggleScene(scene: string) {
    const sceneIds = config.sceneIds.includes(scene)
      ? config.sceneIds.filter((sceneId) => sceneId !== scene)
      : [...config.sceneIds, scene];

    updateConfig({ sceneIds });
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

    const knownImage = config.modelImages.find((image) => image.path === selectedImage.path);
    const modelImages = knownImage ? config.modelImages : [...config.modelImages, selectedImage];

    updateConfig({
      modelImages,
      selectedModelId: knownImage?.id ?? selectedImage.id,
    });
  }

  function handleRemoveClothingImage(imageId: string) {
    updateConfig({
      clothingImages: config.clothingImages.filter((image) => image.id !== imageId),
    });
  }

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
            <AiModelGenerationControls config={config} onChange={updateConfig} />
          ) : (
            <div className="grid grid-cols-4 gap-2">
              <ModelUploadTile onClick={handleSelectModelImage} />
              {config.modelImages.map((image) => (
                <ModelImageTile
                  image={image}
                  key={image.id}
                  onSelect={() => updateConfig({ selectedModelId: image.id })}
                  selected={config.selectedModelId === image.id}
                />
              ))}
              {modelPresets.slice(1).map((model) => (
                <ModelPreset
                  key={model.id}
                  label={model.label}
                  onSelect={() => updateConfig({ selectedModelId: `preset:${model.id}` })}
                  selected={config.selectedModelId === `preset:${model.id}`}
                  tone={model.tone}
                />
              ))}
            </div>
          )}
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
            canGenerate
              ? "border-slate-950/10 bg-[linear-gradient(180deg,#111827,#071022)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_24px_rgba(15,23,42,0.22)] hover:bg-[linear-gradient(180deg,#172033,#0b1220)]"
              : "cursor-not-allowed border-slate-300 bg-slate-300 text-slate-700 shadow-none hover:bg-slate-300 hover:shadow-none",
          )}
          disabled={!canGenerate}
          onClick={onGenerateScenes}
          type="button"
        >
          {generateLabel}
        </Button>
      </div>
    </aside>
  );
}

export function ClothingSceneSelectionPanel({
  onBack,
  onGenerateSceneImages,
  sceneGenerating,
}: {
  onBack: () => void;
  onGenerateSceneImages: (drafts: ClothingSceneDraft[]) => void;
  sceneGenerating: boolean;
}) {
  const [draftReady, setDraftReady] = useState(false);
  const [sceneDrafts, setSceneDrafts] = useState<ClothingSceneDraft[]>(() =>
    clothingSceneDrafts.map((draft) => ({ ...draft })),
  );
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const sceneGroups = Array.from(new Set(sceneDrafts.map((draft) => draft.scene)));
  const selectedDrafts = sceneDrafts.filter((draft) => draft.checked);

  function updateSceneDraft(draftId: string, patch: Partial<ClothingSceneDraft>) {
    setSceneDrafts((currentDrafts) =>
      currentDrafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft)),
    );
  }

  function toggleSceneDraft(draftId: string) {
    setSceneDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.id === draftId ? { ...draft, checked: !draft.checked } : draft,
      ),
    );
    setOpenSelect(null);
  }

  function toggleSceneGroup(scene: string) {
    const groupDrafts = sceneDrafts.filter((draft) => draft.scene === scene);
    const groupAllSelected = groupDrafts.every((draft) => draft.checked);
    setSceneDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.scene === scene ? { ...draft, checked: !groupAllSelected } : draft,
      ),
    );
    setOpenSelect(null);
  }

  function getSceneGroupCheckedState(scene: string): boolean | "indeterminate" {
    const groupDrafts = sceneDrafts.filter((draft) => draft.scene === scene);
    const selectedDraftCount = groupDrafts.filter((draft) => draft.checked).length;

    if (selectedDraftCount === 0) {
      return false;
    }

    if (selectedDraftCount === groupDrafts.length) {
      return true;
    }

    return "indeterminate";
  }

  useEffect(() => {
    const readyTimer = window.setTimeout(() => setDraftReady(true), sceneDraftDelayMs);

    return () => window.clearTimeout(readyTimer);
  }, []);

  if (!draftReady) {
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
            className="h-10 justify-center border-slate-200 bg-slate-200 font-semibold text-white shadow-none"
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
                {sceneDrafts
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
            selectedDrafts.length > 0
              ? "border-slate-950/10 bg-[#1f1f21] text-white shadow-none hover:bg-black"
              : "cursor-not-allowed border-slate-200 bg-slate-200 text-white shadow-none hover:bg-slate-200",
          )}
          disabled={selectedDrafts.length === 0 || sceneGenerating}
          onClick={() => onGenerateSceneImages(selectedDrafts)}
          type="button"
        >
          {selectedDrafts.length > 0 ? `生成场景图片（${selectedDrafts.length}张）` : "请先选择场景"}
        </Button>
      </div>
    </aside>
  );
}

export type ClothingSceneDraft = (typeof clothingSceneDrafts)[number];

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
  onChange,
}: {
  config: ClothingConfigState;
  onChange: (patch: Partial<ClothingConfigState>) => void;
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
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-slate-100 bg-slate-100 text-[14px] font-medium text-slate-900 shadow-none transition-colors hover:bg-slate-200/80"
        type="button"
      >
        <Sparkles className="size-4 text-app-blue" />
        生成基准模特
      </button>
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
  onSelect,
  selected,
}: {
  image: ProductImageAsset;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-label={`选择模特 ${image.name}`}
      aria-pressed={selected}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-control border bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-control",
        selected ? "border-app-blue ring-2 ring-blue-100" : "border-white/70",
      )}
      onClick={onSelect}
      type="button"
    >
      <img alt={image.name} className="h-full w-full object-cover" draggable={false} src={image.src} />
      <ModelSelectionIndicator label={image.name} selected={selected} />
    </button>
  );
}

function ModelPreset({
  label,
  onSelect,
  selected,
  tone,
}: {
  label: string;
  onSelect: () => void;
  selected: boolean;
  tone: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-control border bg-slate-100/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-control",
        selected ? "border-app-blue ring-2 ring-blue-100" : "border-white/70",
      )}
      onClick={onSelect}
      type="button"
    >
      <div className={cn("absolute inset-0", modelToneClass(tone))}>
        <div className="absolute inset-x-3 top-3 h-8 rounded-full bg-white/55 blur-xl" />
        <div className="absolute left-1/2 top-[18%] size-6 -translate-x-1/2 rounded-full bg-[linear-gradient(145deg,#fff7ed,#d6b08d)] shadow-[0_4px_10px_rgba(15,23,42,0.12)]" />
        <div className="absolute bottom-0 left-1/2 h-[58%] w-[72%] -translate-x-1/2 rounded-t-full bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(226,232,240,0.72))] shadow-[0_-8px_18px_rgba(255,255,255,0.5)]" />
      </div>
      <ModelSelectionIndicator label={label} selected={selected} />
    </button>
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

function modelToneClass(tone: string) {
  switch (tone) {
    case "warm":
      return "bg-[linear-gradient(145deg,#fff7ed,#fde68a_44%,#dbeafe)]";
    case "cool":
      return "bg-[linear-gradient(145deg,#e0f2fe,#bfdbfe_48%,#e2e8f0)]";
    case "dark":
      return "bg-[linear-gradient(145deg,#f8fafc,#cbd5e1_42%,#0f172a)]";
    case "soft":
      return "bg-[linear-gradient(145deg,#fdf2f8,#e0f2fe_52%,#f8fafc)]";
    case "peach":
      return "bg-[linear-gradient(145deg,#fff1f2,#fed7aa_48%,#f8fafc)]";
    case "rose":
      return "bg-[linear-gradient(145deg,#ffe4e6,#fecdd3_48%,#dbeafe)]";
    case "sand":
      return "bg-[linear-gradient(145deg,#fef3c7,#d6d3d1_48%,#e2e8f0)]";
    default:
      return "bg-slate-100";
  }
}

function imageSelectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "图片处理失败，请使用 png、jpg、jpeg 或 webp 图片。";
}
