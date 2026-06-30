import { Clock3, FolderPlus, History, Settings } from "lucide-react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "../../shared/ui/button";
import { IconButton } from "../../shared/ui/icon-button";
import { PlatformWindowControls } from "../../shared/ui/platform-window-controls";

const interactiveSelector =
  "button, a, input, textarea, select, [role='button'], [data-window-interactive]";

type StudioToolbarProps = {
  historyCount?: number;
  historyOpen?: boolean;
  historyPopover?: ReactNode;
  onToggleHistory?: () => void;
};

export function StudioToolbar({
  historyCount = 0,
  historyOpen = false,
  historyPopover = null,
  onToggleHistory,
}: StudioToolbarProps) {
  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element && target.closest(interactiveSelector);
  }

  function handleToolbarPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }

    void getCurrentWindow().startDragging();
  }

  function handleToolbarDoubleClick(event: MouseEvent<HTMLElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    void getCurrentWindow().toggleMaximize();
  }

  return (
    <header
      aria-label="应用工具栏"
      className="desktop-hairline relative z-10 grid h-[52px] shrink-0 grid-cols-[var(--studio-side-width)_minmax(0,1fr)] items-center border-b border-white/70 bg-white/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-white/60 [@media(platform:windows)]:h-11 [@media(platform:windows)]:bg-white/82"
      data-tauri-drag-region
      onDoubleClick={handleToolbarDoubleClick}
      onPointerDown={handleToolbarPointerDown}
    >
      <div
        aria-label="品牌区"
        className="flex min-w-0 items-center pl-[92px] pr-4 [@media(platform:windows)]:pl-3"
      >
        <div className="-translate-y-[3px] truncate text-[13px] font-semibold leading-none tracking-normal [@media(platform:windows)]:text-[12px]">
          商拍工坊
        </div>
      </div>

      <div
        aria-label="任务操作区"
        className="flex h-full min-w-0 items-center justify-between gap-3 pl-4 pr-3 [@media(platform:windows)]:gap-2 [@media(platform:windows)]:pr-0"
      >
        <Button data-window-interactive size="sm" variant="soft">
          <FolderPlus className="size-3.5" />
          新建任务
        </Button>
        <div className="flex items-center gap-2 [@media(platform:windows)]:h-full [@media(platform:windows)]:gap-1">
          <Button data-window-interactive size="sm" variant="ghost">
            <Clock3 className="size-3.5 text-amber-500" />
            160
          </Button>
          <div className="relative" data-generation-history-root data-window-interactive>
            <Button
              aria-expanded={historyOpen}
              aria-haspopup="dialog"
              className="relative"
              data-window-interactive
              onClick={onToggleHistory}
              size="sm"
              variant={historyOpen ? "softBlue" : "soft"}
            >
              <History className="size-3.5" />
              生成记录
              {historyCount > 0 ? (
                <span className="ml-0.5 rounded-full bg-slate-900 px-1.5 py-px text-[10px] leading-none text-white">
                  {historyCount}
                </span>
              ) : null}
            </Button>
            {historyPopover}
          </div>
          <IconButton data-window-interactive label="设置">
            <Settings className="size-4" />
          </IconButton>
          <div className="size-7 rounded-full border border-white bg-[linear-gradient(135deg,#111827,#64748b)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_10px_rgba(15,23,42,0.16)]" />
          <PlatformWindowControls
            className="ml-1 hidden [@media(platform:windows)]:flex"
            variant="windows"
          />
        </div>
      </div>
    </header>
  );
}
