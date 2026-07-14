import { CircleHelp, ImageUp } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { ControlGroup } from "../../../shared/ui/control-group";
import { ImageUploadGrid } from "../../../shared/ui/image-upload-grid";
import { TextAreaPanel } from "../../../shared/ui/textarea-panel";
import { UploadDropzone } from "../../../shared/ui/upload-dropzone";
import { cn } from "../../../shared/lib/cn";
import { useToast } from "../../../shared/ui/toast";
import { Tooltip } from "../../../shared/ui/tooltip";
import { selectProductImages, type ProductImageAsset } from "../../generation/lib/productImagePicker";
import {
  type SceneConfigState,
  sceneOutputModes,
  sceneRatios,
} from "../lib/sceneImagePlan";

const maxReferenceImageCount = 3;

type SceneConfigPanelProps = {
  config: SceneConfigState;
  onChange: (config: SceneConfigState) => void;
  onGeneratePlan: () => void;
};

export function SceneConfigPanel({ config, onChange, onGeneratePlan }: SceneConfigPanelProps) {
  const { showToast } = useToast();
  const hasReferenceImages = config.referenceImages.length > 0;
  const hasSupplementalInfo = config.supplementalInfo.trim().length > 0;
  const canGenerate = hasReferenceImages && hasSupplementalInfo;
  const ctaLabel = !hasReferenceImages
    ? "请上传参考图"
    : !hasSupplementalInfo
      ? "请填写补充信息"
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
              <div
                className={cn(
                  "relative flex h-8 items-center justify-center gap-1 rounded-control border transition-all duration-200",
                  config.outputMode === mode.value
                    ? "border-blue-100 bg-white text-app-blue shadow-control"
                    : "border-white/70 bg-slate-100/70 text-slate-700 hover:bg-white",
                )}
                key={mode.value}
              >
                <button
                  aria-label={mode.label}
                  aria-pressed={config.outputMode === mode.value}
                  className="absolute inset-0 rounded-control text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/35"
                  onClick={() => updateConfig({ outputMode: mode.value })}
                  type="button"
                />
                <span className="pointer-events-none relative truncate text-[12px] font-medium">{mode.label}</span>
                <Tooltip ariaLabel={`查看${mode.label}输出说明`} content={mode.tooltip}>
                  <CircleHelp aria-hidden="true" className="size-3.5" />
                </Tooltip>
              </div>
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

        <ControlGroup title="补充信息" hint="必填">
          <TextAreaPanel
            aria-describedby="scene-supplemental-info-help"
            aria-label="补充信息"
            aria-required="true"
            onChange={(event) => updateConfig({ supplementalInfo: event.target.value })}
            placeholder="请描述希望生成的场景、用途、主体保留要求、风格偏好或禁用元素。"
            required
            value={config.supplementalInfo}
          />
          <div
            aria-label="补充信息填写示例"
            className="mt-2 px-1 text-[11px] leading-[18px] text-slate-500"
            id="scene-supplemental-info-help"
          >
            <p>推荐写法：用途 + 场景环境 + 主体保留 + 风格光线 + 禁用元素</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>小红书首图；暖调咖啡馆窗边、自然晨光；商品外观和 Logo 不变；画面简洁，不要文字。</li>
              <li>电商详情页；雨后城市夜景、霓虹倒影；人物五官与服装不变；高级电影感，不要路人。</li>
            </ul>
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
          onClick={onGeneratePlan}
          type="button"
        >
          {ctaLabel}
        </Button>
      </div>
    </aside>
  );
}

function imageSelectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "图片处理失败，请使用 png、jpg、jpeg 或 webp 图片。";
}
