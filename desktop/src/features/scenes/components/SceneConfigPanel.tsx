import { useState } from "react";
import { ImageUp } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { ControlGroup } from "../../../shared/ui/control-group";
import { ImageUploadGrid } from "../../../shared/ui/image-upload-grid";
import { TextAreaPanel } from "../../../shared/ui/textarea-panel";
import { UploadDropzone } from "../../../shared/ui/upload-dropzone";
import { cn } from "../../../shared/lib/cn";
import { useToast } from "../../../shared/ui/toast";
import { selectProductImages, type ProductImageAsset } from "../../generation/lib/productImagePicker";
import {
  type SceneConfigState,
  sceneOutputModes,
  sceneRatios,
  sceneTemplates,
  visualDirections,
} from "../lib/sceneImagePlan";

const maxReferenceImageCount = 3;
const sceneTemplateGroups = ["基础商品图", "场景氛围图", "内容营销图", "信息说明图", "特殊创意"] as const;
const sceneTemplateGroupLabels: Record<(typeof sceneTemplateGroups)[number], string> = {
  内容营销图: "内容营销",
  场景氛围图: "场景氛围",
  基础商品图: "基础商品",
  特殊创意: "特殊创意",
  信息说明图: "信息说明",
};

type SceneConfigPanelProps = {
  config: SceneConfigState;
  onChange: (config: SceneConfigState) => void;
  onGeneratePlan: () => void;
};

export function SceneConfigPanel({ config, onChange, onGeneratePlan }: SceneConfigPanelProps) {
  const { showToast } = useToast();
  const [activeSceneTemplateGroup, setActiveSceneTemplateGroup] =
    useState<(typeof sceneTemplateGroups)[number]>("基础商品图");
  const hasReferenceImages = config.referenceImages.length > 0;
  const usesSceneTemplate = config.outputMode === "single";
  const visibleSceneTemplates = sceneTemplates.filter((template) => template.group === activeSceneTemplateGroup);
  const hasTarget = usesSceneTemplate
    ? Boolean(config.selectedSceneTemplateId)
    : Boolean(config.selectedVisualDirectionId);
  const canGenerate = hasReferenceImages && hasTarget;
  const ctaLabel = !hasReferenceImages
    ? "请上传参考图"
    : !hasTarget
      ? "请选择场景"
      : "生成图片方案";

  function updateConfig(patch: Partial<SceneConfigState>) {
    onChange({ ...config, ...patch });
  }

  async function handleSelectReferenceImages() {
    const remainingCount = maxReferenceImageCount - config.referenceImages.length;
    let selectedImages: ProductImageAsset[];
    try {
      selectedImages = await selectProductImages(remainingCount);
    } catch (error) {
      showToast({ message: imageSelectionErrorMessage(error), variant: "error" });
      return;
    }
    const knownPaths = new Set(config.referenceImages.map((image) => image.path));
    const nextImages = selectedImages.filter((image) => !knownPaths.has(image.path));

    updateConfig({
      referenceImages: [...config.referenceImages, ...nextImages].slice(0, maxReferenceImageCount),
    });
  }

  function handleRemoveReferenceImage(imageId: string) {
    updateConfig({
      referenceImages: config.referenceImages.filter((image) => image.id !== imageId),
    });
  }

  return (
    <aside
      aria-label="场景配置"
      className="relative z-40 flex min-h-0 flex-col bg-white/50 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
    >
      <div
        className="min-h-0 flex-1 overscroll-none overflow-y-auto px-4 py-5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]"
        data-testid="scene-config-scroll"
      >
        <ControlGroup title="参考图" hint="最多 3 张">
          {hasReferenceImages ? (
            <ImageUploadGrid
              addLabel="添加参考图"
              images={config.referenceImages}
              maxCount={maxReferenceImageCount}
              onAdd={handleSelectReferenceImages}
              onRemove={handleRemoveReferenceImage}
            />
          ) : (
            <UploadDropzone
              actionLabel="上传参考图"
              description="同一主体多角度参考图，可提升场景生成稳定性。"
              icon={<ImageUp className="size-4" />}
              onClick={handleSelectReferenceImages}
            />
          )}
        </ControlGroup>

        <ControlGroup title="输出内容">
          <div className="grid grid-cols-2 gap-2">
            {sceneOutputModes.map((mode) => (
              <button
                aria-pressed={config.outputMode === mode.value}
                className={cn(
                  "h-8 rounded-control border px-2 text-[12px] font-medium transition-all duration-200",
                  config.outputMode === mode.value
                    ? "border-blue-100 bg-white text-app-blue shadow-control"
                    : "border-white/70 bg-slate-100/70 text-slate-700 hover:bg-white",
                )}
                key={mode.value}
                onClick={() => updateConfig({ outputMode: mode.value })}
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup title="输出尺寸">
          <div className="grid grid-cols-3 rounded-control bg-slate-100/70 p-1 shadow-[inset_0_1px_1px_rgba(15,23,42,0.05)]">
            {sceneRatios.map((ratio) => (
              <button
                aria-pressed={config.ratio === ratio}
                className={cn(
                  "h-7 rounded-[10px] text-[12px] font-medium transition-all",
                  config.ratio === ratio
                    ? "bg-white text-slate-900 shadow-control"
                    : "text-app-muted hover:text-slate-900",
                )}
                key={ratio}
                onClick={() => updateConfig({ ratio })}
                type="button"
              >
                {ratio}
              </button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup title="补充信息" hint="可选">
          <TextAreaPanel
            onChange={(event) => updateConfig({ supplementalInfo: event.target.value })}
            placeholder={"建议补充产品名称、核心卖点、目标人群、使用场景、风格偏好或禁用元素。"}
            value={config.supplementalInfo}
          />
        </ControlGroup>

        <ControlGroup title={usesSceneTemplate ? "场景类型" : "视觉方向"} hint="单选">
          {usesSceneTemplate ? (
            <div className="space-y-3">
              <div
                aria-label="场景分类"
                className="grid grid-cols-5 gap-0.5 rounded-control bg-slate-100/70 p-1 shadow-[inset_0_1px_1px_rgba(15,23,42,0.05)]"
                role="tablist"
              >
                {sceneTemplateGroups.map((group) => {
                  const selected = activeSceneTemplateGroup === group;

                  return (
                    <button
                      aria-controls={`scene-template-panel-${group}`}
                      aria-selected={selected}
                      className={cn(
                        "h-7 min-w-0 truncate rounded-[9px] px-0.5 text-[11px] font-semibold transition-all",
                        selected ? "bg-white text-slate-950 shadow-control" : "text-slate-500 hover:text-slate-900",
                      )}
                      id={`scene-template-tab-${group}`}
                      key={group}
                      onClick={() => setActiveSceneTemplateGroup(group)}
                      role="tab"
                      type="button"
                    >
                      {sceneTemplateGroupLabels[group]}
                    </button>
                  );
                })}
              </div>

              <div
                aria-labelledby={`scene-template-tab-${activeSceneTemplateGroup}`}
                className="grid grid-cols-2 gap-2"
                id={`scene-template-panel-${activeSceneTemplateGroup}`}
                role="tabpanel"
              >
                {visibleSceneTemplates.map((template) => (
                  <SceneRadioTile
                    checked={config.selectedSceneTemplateId === template.id}
                    description={template.description}
                    key={template.id}
                    label={template.title}
                    onSelect={() => updateConfig({ selectedSceneTemplateId: template.id })}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {visualDirections.map((direction) => (
                <SceneRadioTile
                  checked={config.selectedVisualDirectionId === direction.id}
                  description={direction.description}
                  key={direction.id}
                  label={direction.title}
                  onSelect={() => updateConfig({ selectedVisualDirectionId: direction.id })}
                />
              ))}
            </div>
          )}
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
          onClick={onGeneratePlan}
          type="button"
        >
          {ctaLabel}
        </Button>
      </div>
    </aside>
  );
}

function SceneRadioTile({
  checked,
  description,
  label,
  onSelect,
}: {
  checked: boolean;
  description: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "group min-h-[74px] rounded-[14px] border p-3 text-left transition-all duration-200 active:scale-[0.99]",
        checked
          ? "border-blue-100 bg-white text-slate-950 shadow-control"
          : "border-white/70 bg-slate-100/70 text-slate-700 hover:bg-white",
      )}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span className="flex items-center gap-2 text-[12px] font-semibold">
        <span
          className={cn(
            "grid size-4 place-items-center rounded-full border",
            checked ? "border-app-blue bg-app-blue" : "border-slate-300 bg-white",
          )}
        >
          {checked ? <span className="size-1.5 rounded-full bg-white" /> : null}
        </span>
        {label}
      </span>
      <span className="mt-1.5 block text-[11px] leading-4 text-slate-500">{description}</span>
    </button>
  );
}

function imageSelectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "图片处理失败，请使用 png、jpg、jpeg 或 webp 图片。";
}
