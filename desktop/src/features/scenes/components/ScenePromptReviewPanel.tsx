import { Button } from "../../../shared/ui/button";
import { cn } from "../../../shared/lib/cn";
import type { SceneConfigState, SceneImagePlan } from "../lib/sceneImagePlan";

type ScenePromptReviewPanelProps = {
  campaignStyleLock: string;
  config: SceneConfigState;
  imageGenerating: boolean;
  onBack: () => void;
  onGenerateImages: (plans: SceneImagePlan[]) => void;
  planGenerating: boolean;
  plans: SceneImagePlan[];
};

export function ScenePromptReviewPanel({
  campaignStyleLock,
  config,
  imageGenerating,
  onBack,
  onGenerateImages,
  planGenerating,
  plans,
}: ScenePromptReviewPanelProps) {
  const hasEmptyPrompt = plans.some((plan) => !plan.prompt.trim());
  const canGenerate = plans.length > 0 && !hasEmptyPrompt && !planGenerating && !imageGenerating;
  return (
    <aside
      aria-label="场景方案"
      className="relative z-40 flex min-h-0 flex-col bg-white/70 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
        <h2 className="text-[14px] font-semibold text-slate-950">场景方案</h2>

        {planGenerating ? (
          <div className="mt-4 flex h-[330px] items-center justify-center rounded-[14px] bg-slate-100/80">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="flex items-center gap-2" aria-hidden="true">
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70" />
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70 [animation-delay:120ms]" />
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70 [animation-delay:240ms]" />
              </div>
              <p className="text-[13px] font-medium">方案生成中...</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-[14px] border border-slate-200/80 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <h3 className="text-[13px] font-medium text-slate-950">参考图与补充信息</h3>
              <p className="mt-2 whitespace-pre-line text-[12px] leading-6 text-slate-700">
                参考图：{config.referenceImages.length} 张
                {"\n"}输出尺寸：{config.ratio}
                {"\n"}补充信息：{config.supplementalInfo || "未填写，按参考图主体和场景模板生成。"}
              </p>
            </div>

            {campaignStyleLock ? (
              <div className="mt-3 rounded-[14px] border border-blue-100/80 bg-blue-50/70 p-4">
                <h3 className="text-[13px] font-semibold text-slate-950">统一风格锁定</h3>
                <p className="mt-2 text-[12px] leading-5 text-slate-600">
                  {campaignStyleLock}
                </p>
              </div>
            ) : null}

            <h3 className="mt-5 text-[14px] font-semibold text-slate-950">场景摘要</h3>
            <div className="mt-3 space-y-3">
              {plans.map((plan) => (
                <article
                  className={cn(
                    "rounded-[14px] bg-slate-100/80 p-4 transition-all duration-300 ease-out hover:bg-slate-100",
                    imageGenerating && "opacity-80",
                  )}
                  data-testid="scene-prompt-card"
                  key={plan.id}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-[13px] font-medium text-slate-950">{plan.title}</h4>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">
                        {plan.ratio}
                      </p>
                    </div>
                  </div>
                  <p className="text-[12px] leading-5 text-slate-600">{plan.promptSummary}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-[1fr_2.25fr] gap-3 border-t border-slate-200/70 bg-white/80 p-4 shadow-[0_-10px_24px_rgba(248,250,252,0.78)] backdrop-blur-2xl">
        <Button
          className="h-10 justify-center border-slate-100 bg-slate-100 text-slate-800 shadow-none hover:bg-slate-200/80"
          disabled={imageGenerating}
          onClick={onBack}
          type="button"
        >
          上一步
        </Button>
        <Button
          className={cn(
            "h-10 justify-center font-semibold",
            canGenerate
              ? "border-slate-950/10 bg-[#1f1f21] text-white shadow-none hover:bg-black"
              : "border-slate-200 bg-slate-200 text-white shadow-none",
          )}
          disabled={!canGenerate}
          onClick={() => onGenerateImages(plans)}
          type="button"
        >
          {imageGenerating
            ? "图片生成中"
            : plans.length === 0
              ? "请至少保留一张图片"
              : hasEmptyPrompt
                ? "场景方案不完整，请重新规划"
                : "开始生成图片"}
        </Button>
      </div>
    </aside>
  );
}
