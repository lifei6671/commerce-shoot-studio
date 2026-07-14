const scenePreviewImageSrc = new URL(
  "../../../../src-tauri/resources/assets/scenes.png",
  import.meta.url,
).href;

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

        <div className="desktop-raised relative aspect-[3/1] w-full max-w-[820px] overflow-hidden rounded-[24px] border border-white/90 bg-white/88 backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-x-5 top-0 z-10 h-px bg-white" />
          <img
            alt="AI 场景图片生成流程示例"
            className="h-full w-full select-none object-contain"
            decoding="async"
            draggable={false}
            loading="eager"
            src={scenePreviewImageSrc}
          />
        </div>
      </section>
    </main>
  );
}
