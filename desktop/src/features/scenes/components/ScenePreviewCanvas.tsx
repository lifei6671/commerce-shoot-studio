import { Images, Sparkles } from "lucide-react";

export function ScenePreviewCanvas() {
  return (
    <main
      aria-label="场景预览画布"
      className="desktop-grain relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_50%_26%,rgba(255,255,255,0.98),rgba(244,247,251,0.93)_42%,rgba(232,237,244,0.86))]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.78),transparent_24%,transparent_76%,rgba(255,255,255,0.78))]" />
      <section className="relative flex h-full flex-col items-center justify-center px-10">
        <div className="mb-10 text-center">
          <div className="text-[34px] font-bold tracking-normal text-slate-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            场景图片
          </div>
          <p className="mt-3 text-[14px] text-app-muted drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            上传参考图，选择场景与尺寸，生成适配电商投放的视觉素材。
          </p>
        </div>

        <div className="desktop-raised relative grid grid-cols-[120px_160px_120px] gap-3 rounded-[24px] border border-white/90 bg-white/70 p-5 backdrop-blur-2xl">
          <PreviewBlock label="参考图" tone="light" />
          <PreviewBlock label="Prompt 方案" tone="blue" />
          <PreviewBlock label="生成结果" tone="dark" />
        </div>
      </section>
    </main>
  );
}

function PreviewBlock({ label, tone }: { label: string; tone: "light" | "blue" | "dark" }) {
  const iconClassName =
    tone === "dark" ? "bg-slate-950 text-white" : tone === "blue" ? "bg-blue-50 text-app-blue" : "bg-white text-slate-500";

  return (
    <div className="grid h-32 place-items-center rounded-[18px] border border-white/80 bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
      <div className="flex flex-col items-center gap-2 text-[12px] font-medium text-slate-600">
        <span className={`grid size-9 place-items-center rounded-full ${iconClassName}`}>
          {tone === "blue" ? <Sparkles className="size-4" /> : <Images className="size-4" />}
        </span>
        {label}
      </div>
    </div>
  );
}
