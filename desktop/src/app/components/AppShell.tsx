import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../shared/lib/cn";
import {
  detectDesktopPlatform,
  type DesktopPlatform,
} from "../../shared/lib/desktop-platform";

type AppShellProps = {
  toolbar: ReactNode;
  navigation: ReactNode;
  configPanel: ReactNode;
  canvas: ReactNode;
  hideConfigPanel?: boolean;
  platform?: DesktopPlatform;
  workspaceContent?: ReactNode;
};

const studioLayoutVars = {
  "--studio-nav-width": "52px",
  "--studio-panel-width": "384px",
  "--studio-side-width": "calc(var(--studio-nav-width) + var(--studio-panel-width))",
} as CSSProperties;

export function AppShell({
  toolbar,
  navigation,
  configPanel,
  canvas,
  hideConfigPanel = false,
  platform = detectDesktopPlatform(),
  workspaceContent,
}: AppShellProps) {
  const hasWorkspaceContent = Boolean(workspaceContent);
  const sidePanelHidden = hasWorkspaceContent || hideConfigPanel;

  return (
    <div className="h-screen overflow-hidden bg-transparent text-app-text">
      <div
        className={cn(
          "relative flex h-screen flex-col overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#eef2f7_46%,#f9fbff_100%)] shadow-[0_24px_70px_rgba(15,23,42,0.18)]",
          platform === "windows"
            ? "rounded-none border-0"
            : "rounded-[22px] border border-white/70",
        )}
        data-testid="studio-window-frame"
        style={studioLayoutVars}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.96),transparent_62%)]" />
        <div
          aria-hidden="true"
          className={
            sidePanelHidden
              ? cn(
                  "pointer-events-none absolute bottom-0 left-[var(--studio-nav-width)] z-30 w-px bg-slate-200/70 shadow-[1px_0_0_rgba(255,255,255,0.72)]",
                  platform === "windows" ? "top-11" : "top-[52px]",
                )
              : "pointer-events-none absolute inset-y-0 left-[var(--studio-side-width)] z-30 w-px bg-slate-200/70 shadow-[1px_0_0_rgba(255,255,255,0.72)]"
          }
          data-testid="studio-side-divider"
        />
        {toolbar}
        <div
          className={
            sidePanelHidden
              ? "grid min-h-0 flex-1 grid-cols-[var(--studio-nav-width)_minmax(0,1fr)]"
              : "grid min-h-0 flex-1 grid-cols-[var(--studio-nav-width)_var(--studio-panel-width)_minmax(0,1fr)]"
          }
        >
          {navigation}
          {sidePanelHidden ? null : (
            <div className="contents">
              {configPanel}
              {canvas}
            </div>
          )}
          {!hasWorkspaceContent && hideConfigPanel ? canvas : null}
          {hasWorkspaceContent ? workspaceContent : null}
        </div>
      </div>
    </div>
  );
}
