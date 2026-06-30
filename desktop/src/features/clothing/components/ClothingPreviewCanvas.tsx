import { ArrowRight, Image, Sparkles } from "lucide-react";
import { cn } from "../../../shared/lib/cn";

const sceneCards = [
  { id: "fairway", title: "草地日光", tone: "green" },
  { id: "walk", title: "户外漫步", tone: "gold" },
  { id: "portrait", title: "近景头像", tone: "deep" },
];

export function ClothingPreviewCanvas() {
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

        <div className="desktop-raised relative w-[540px] rounded-[24px] border border-white/90 bg-white/72 p-5 backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white" />
          <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.72),transparent_52%)]" />
          <p className="relative mb-3 text-[12px] font-semibold text-slate-700">
            同场景多姿势，一键解锁整套实拍图。
          </p>

          <div className="relative flex items-center gap-4">
            <ClothingSourceCard />
            <ArrowRight className="size-6 shrink-0 text-slate-300 drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]" />
            <div className="grid flex-1 grid-cols-3 gap-2">
              {sceneCards.map((scene) => (
                <SceneResultCard key={scene.id} title={scene.title} tone={scene.tone} />
              ))}
            </div>
          </div>
        </div>

        <div aria-label="服饰预览分页" className="mt-3 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-slate-950" />
          <span className="size-1.5 rounded-full bg-slate-300" />
          <span className="size-1.5 rounded-full bg-slate-300" />
          <span className="size-1.5 rounded-full bg-slate-300" />
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

function ClothingSourceCard() {
  return (
    <div className="relative h-[138px] w-[92px] overflow-hidden rounded-[15px] border border-white/70 bg-[linear-gradient(145deg,#f8fafc,#edf4f8)] shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_8px_18px_rgba(15,23,42,0.08)]">
      <div className="absolute inset-x-3 top-3 h-px bg-white/90" />
      <div className="absolute left-1/2 top-11 h-[74px] w-[54px] -translate-x-1/2 rounded-t-[16px] bg-[linear-gradient(180deg,#ffffff,#edf2f7)] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_20px_rgba(148,163,184,0.16)]" />
      <div className="absolute left-[17px] top-12 h-8 w-5 rotate-[-18deg] rounded-full bg-white shadow-[0_4px_8px_rgba(148,163,184,0.12)]" />
      <div className="absolute right-[17px] top-12 h-8 w-5 rotate-[18deg] rounded-full bg-white shadow-[0_4px_8px_rgba(148,163,184,0.12)]" />
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/88 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-control">
        <Image className="size-3 text-app-blue" />
        服装
      </div>
    </div>
  );
}

function SceneResultCard({ title, tone }: { title: string; tone: string }) {
  return (
    <div
      className={cn(
        "relative h-[138px] overflow-hidden rounded-[15px] border border-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_8px_18px_rgba(15,23,42,0.08)]",
        sceneToneClass(tone),
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.68),transparent_30%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.18))]" />
      <div className="absolute left-1/2 top-5 size-6 -translate-x-1/2 rounded-full bg-[linear-gradient(145deg,#fff7ed,#d7a982)] shadow-[0_4px_10px_rgba(15,23,42,0.16)]" />
      <div className="absolute bottom-4 left-1/2 h-[78px] w-[54px] -translate-x-1/2 rounded-t-[28px] bg-white/92 shadow-[0_-10px_20px_rgba(255,255,255,0.24)]" />
      <div className="absolute bottom-3 left-1/2 h-[34px] w-[66px] -translate-x-1/2 rounded-t-full bg-[linear-gradient(180deg,rgba(226,232,240,0.88),rgba(148,163,184,0.18))]" />
      <div className="absolute left-2 top-2 grid size-5 place-items-center rounded-[7px] bg-white/22 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]">
        <Sparkles className="size-3" />
      </div>
      <span className="absolute bottom-2 left-2 right-2 truncate rounded-full bg-white/22 px-2 py-1 text-[10px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]">
        {title}
      </span>
    </div>
  );
}

function sceneToneClass(tone: string) {
  switch (tone) {
    case "green":
      return "bg-[linear-gradient(145deg,#d9f99d,#65a30d_48%,#1e3a1f)]";
    case "gold":
      return "bg-[linear-gradient(145deg,#fde68a,#f59e0b_46%,#334155)]";
    case "deep":
      return "bg-[linear-gradient(145deg,#bfdbfe,#2563eb_48%,#0f172a)]";
    default:
      return "bg-[linear-gradient(145deg,#dbeafe,#2563eb)]";
  }
}
