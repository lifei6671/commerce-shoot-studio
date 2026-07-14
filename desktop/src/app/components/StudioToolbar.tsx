import { FolderPlus, History, Settings } from "lucide-react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../../shared/lib/cn";
import {
  detectDesktopPlatform,
  type DesktopPlatform,
} from "../../shared/lib/desktop-platform";
import { Button } from "../../shared/ui/button";
import { IconButton } from "../../shared/ui/icon-button";
import { PlatformWindowControls } from "../../shared/ui/platform-window-controls";

const interactiveSelector =
  "button, a, input, textarea, select, [role='button'], [data-window-interactive]";

type StudioToolbarProps = {
  hidePrimaryAction?: boolean;
  historyCount?: number;
  historyOpen?: boolean;
  historyPopover?: ReactNode;
  onNewTask?: () => void;
  onOpenSettings?: () => void;
  onToggleHistory?: () => void;
  platform?: DesktopPlatform;
};

export function StudioToolbar({
  hidePrimaryAction = false,
  historyCount = 0,
  historyOpen = false,
  historyPopover = null,
  onNewTask,
  onOpenSettings,
  onToggleHistory,
  platform = detectDesktopPlatform(),
}: StudioToolbarProps) {
  const isWindows = platform === "windows";

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
      className={cn(
        "desktop-hairline relative z-10 grid shrink-0 grid-cols-[var(--studio-side-width)_minmax(0,1fr)] items-center border-b border-white/70 backdrop-blur-2xl",
        isWindows
          ? "h-11 bg-white/[0.82]"
          : "h-[52px] bg-white/70 supports-[backdrop-filter]:bg-white/60",
      )}
      data-tauri-drag-region
      onDoubleClick={handleToolbarDoubleClick}
      onPointerDown={handleToolbarPointerDown}
    >
      <div
        aria-label="品牌区"
        className={cn(
          "flex min-w-0 items-center pr-4",
          isWindows ? "pl-3" : "pl-[92px]",
        )}
      >
        <div
          className={cn(
            "-translate-y-[3px] truncate font-semibold leading-none tracking-normal",
            isWindows ? "text-[12px]" : "text-[13px]",
          )}
        >
          商拍工坊
        </div>
      </div>

      <div
        aria-label="任务操作区"
        className={cn(
          "flex h-full min-w-0 items-center justify-end pl-4",
          isWindows ? "gap-2 pr-0" : "gap-3 pr-3",
        )}
      >
        <div className={cn("flex items-center", isWindows ? "h-full gap-1" : "gap-2")}>
          {hidePrimaryAction ? null : (
            <Button data-window-interactive onClick={onNewTask} size="sm" variant="soft">
              <FolderPlus className="size-3.5" />
              新建任务
            </Button>
          )}
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
          <IconButton data-window-interactive label="设置" onClick={onOpenSettings}>
            <Settings className="size-4" />
          </IconButton>
          <div className="size-7 rounded-full border border-white bg-[linear-gradient(135deg,#111827,#64748b)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_10px_rgba(15,23,42,0.16)]" />
          {isWindows ? <PlatformWindowControls className="ml-1" variant="windows" /> : null}
        </div>
      </div>
    </header>
  );
}
