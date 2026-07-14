import { type FocusEvent, useEffect, useState } from "react";
import { cn } from "../../../shared/lib/cn";

const apparelSlides = [
  {
    alt: "同场景多姿势服饰示例",
    id: "apparel-1",
    src: new URL("../../../../src-tauri/resources/assets/apparel-1.png", import.meta.url).href,
  },
  {
    alt: "多品类童装搭配示例",
    id: "apparel-2",
    src: new URL("../../../../src-tauri/resources/assets/apparel-2.png", import.meta.url).href,
  },
  {
    alt: "多场景女装拍摄示例",
    id: "apparel-3",
    src: new URL("../../../../src-tauri/resources/assets/apparel-3.png", import.meta.url).href,
  },
  {
    alt: "男装配饰定制示例",
    id: "apparel-4",
    src: new URL("../../../../src-tauri/resources/assets/apparel-4.png", import.meta.url).href,
  },
];
const carouselIntervalMs = 4_000;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function ClothingPreviewCanvas() {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [autoplayCycle, setAutoplayCycle] = useState(0);
  const [focusPaused, setFocusPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(reducedMotionQuery).matches,
  );
  const autoplayPaused = focusPaused || hoverPaused;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(reducedMotionQuery);
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (autoplayPaused || reducedMotion) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActiveSlideIndex((currentIndex) => (currentIndex + 1) % apparelSlides.length);
    }, carouselIntervalMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeSlideIndex, autoplayCycle, autoplayPaused, reducedMotion]);

  function selectSlide(index: number) {
    setActiveSlideIndex(index);
    // 即使用户点击当前页，也重新建立完整的自动播放周期。
    setAutoplayCycle((currentCycle) => currentCycle + 1);
  }

  function handleCarouselBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setFocusPaused(false);
  }

  return (
    <main
      aria-label="服饰穿戴预览"
      className="desktop-grain relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_50%_26%,rgba(255,255,255,0.98),rgba(244,247,251,0.93)_42%,rgba(232,237,244,0.86))]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.78),transparent_24%,transparent_76%,rgba(255,255,255,0.78))]" />
      <div className="absolute left-1/2 top-[38%] h-[430px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-100/30 blur-3xl" />

      <section className="relative flex h-full flex-col items-center justify-center px-10">
        <div className="mb-9 text-center">
          <div className="text-[30px] font-bold tracking-normal text-slate-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            AI服饰穿戴
          </div>
          <p className="mt-3 text-[13px] text-app-muted drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            上传服装，选定模特，同场景多姿势套图即刻生成。
          </p>
        </div>

        <div
          aria-label="服饰穿戴示例"
          aria-roledescription="轮播图"
          className="w-full max-w-[820px]"
          onBlurCapture={handleCarouselBlur}
          onFocusCapture={() => setFocusPaused(true)}
          onMouseEnter={() => setHoverPaused(true)}
          onMouseLeave={() => setHoverPaused(false)}
          role="region"
        >
          <div className="desktop-raised relative aspect-[1983/793] overflow-hidden rounded-[24px] border border-white/90 bg-white/88 backdrop-blur-2xl">
            <div className="pointer-events-none absolute inset-x-5 top-0 z-10 h-px bg-white" />
            <div
              className={cn(
                "flex h-full will-change-transform",
                reducedMotion
                  ? "transition-none"
                  : "transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
              )}
              data-testid="clothing-preview-track"
              style={{ transform: `translateX(${activeSlideIndex === 0 ? 0 : -activeSlideIndex * 100}%)` }}
            >
              {apparelSlides.map((slide, index) => (
                <div
                  aria-hidden={index !== activeSlideIndex}
                  className="grid h-full min-w-full place-items-center bg-white"
                  key={slide.id}
                >
                  <img
                    alt={slide.alt}
                    className="h-full w-full select-none object-contain"
                    decoding="async"
                    draggable={false}
                    loading={index === 0 ? "eager" : "lazy"}
                    src={slide.src}
                  />
                </div>
              ))}
            </div>
          </div>

          <div aria-label="服饰预览分页" className="mt-3 flex items-center justify-center gap-0.5">
            {apparelSlides.map((slide, index) => {
              const active = index === activeSlideIndex;
              return (
                <button
                  aria-current={active ? "true" : undefined}
                  aria-label={`查看第 ${index + 1} 张服饰示例`}
                  className="group grid size-7 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-app-blue/35"
                  key={slide.id}
                  onClick={() => selectSlide(index)}
                  type="button"
                >
                  <span
                    className={cn(
                      "h-1.5 rounded-full transition-[width,background-color] duration-200",
                      active ? "w-5 bg-slate-950" : "w-1.5 bg-slate-300 group-hover:bg-slate-400",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <button
        className="absolute bottom-5 right-5 grid size-9 place-items-center rounded-full border border-white/80 bg-white/80 text-[13px] font-semibold text-app-text shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_6px_16px_rgba(15,23,42,0.1)] backdrop-blur-xl transition-all duration-200 hover:bg-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.12)] active:scale-95"
        type="button"
      >
        ?
      </button>
    </main>
  );
}
