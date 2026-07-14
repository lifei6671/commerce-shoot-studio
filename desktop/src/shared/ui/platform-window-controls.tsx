import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";

type PlatformWindowControlsProps = {
  variant?: "macos" | "windows";
  className?: string;
};

const macOSControls = [
  {
    label: "关闭窗口",
    mark: "×",
    className:
      "bg-[#ff5f57] text-[#7c1f1a] hover:bg-[#ff6b63] active:bg-[#e84c45]",
    action: () => getCurrentWindow().close(),
  },
  {
    label: "最小化窗口",
    mark: "−",
    className:
      "bg-[#ffbd2e] text-[#805500] hover:bg-[#ffc947] active:bg-[#e6a820]",
    action: () => getCurrentWindow().minimize(),
  },
  {
    label: "最大化窗口",
    mark: "+",
    className:
      "bg-[#28c840] text-[#0b5d18] hover:bg-[#34d851] active:bg-[#22b737]",
    action: () => getCurrentWindow().toggleMaximize(),
  },
];

function WindowsWindowControls({ className }: Pick<PlatformWindowControlsProps, "className">) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let latestRequest = 0;
    let unlisten: (() => void) | undefined;

    const syncMaximizedState = async () => {
      const request = ++latestRequest;

      try {
        const nextIsMaximized = await appWindow.isMaximized();
        if (!disposed && request === latestRequest) {
          setIsMaximized(nextIsMaximized);
        }
      } catch {
        if (!disposed && request === latestRequest) {
          console.warn("无法读取 Windows 窗口最大化状态。");
        }
      }
    };

    void syncMaximizedState();
    void appWindow
      .onResized(() => {
        void syncMaximizedState();
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
          void syncMaximizedState();
        }
      })
      .catch(() => {
        if (!disposed) {
          console.warn("无法监听 Windows 窗口尺寸变化。");
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const windowsControls = [
    {
      id: "minimize",
      label: "Windows 最小化窗口",
      icon: Minus,
      className: "hover:bg-slate-200/80 active:bg-slate-300/70",
      action: () => getCurrentWindow().minimize(),
    },
    {
      id: "toggle-maximize",
      label: isMaximized ? "Windows 还原窗口" : "Windows 最大化窗口",
      icon: isMaximized ? Copy : Square,
      className: "hover:bg-slate-200/80 active:bg-slate-300/70",
      action: () => getCurrentWindow().toggleMaximize(),
    },
    {
      id: "close",
      label: "Windows 关闭窗口",
      icon: X,
      className: "hover:bg-red-500 hover:text-white active:bg-red-600",
      action: () => getCurrentWindow().close(),
    },
  ];

  return (
    <div
      aria-label="Windows 窗口控制"
      className={cn("flex h-full items-stretch", className)}
    >
      {windowsControls.map((control) => {
        const Icon = control.icon;

        return (
          <button
            key={control.id}
            aria-label={control.label}
            className={cn(
              "grid w-11 place-items-center text-slate-600 transition-colors duration-150 ease-out",
              control.className,
            )}
            onClick={(event) => {
              event.stopPropagation();
              void control.action();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            type="button"
          >
            <Icon className="size-3.5" strokeWidth={1.8} />
          </button>
        );
      })}
    </div>
  );
}

export function PlatformWindowControls({ variant = "macos", className }: PlatformWindowControlsProps) {
  if (variant === "windows") {
    return <WindowsWindowControls className={className} />;
  }

  return (
    <div
      aria-label="macOS 窗口控制"
      className={cn("group/window-controls flex items-center gap-2 pr-1", className)}
    >
      {macOSControls.map((control) => (
        <button
          key={control.label}
          aria-label={control.label}
          className={cn(
            "grid size-3.5 place-items-center rounded-full border border-black/10 text-[10px] font-bold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_2px_rgba(15,23,42,0.16)] transition-all duration-200 ease-out hover:scale-110 active:scale-95",
            control.className,
          )}
          onClick={(event) => {
            event.stopPropagation();
            void control.action();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          type="button"
        >
          <span className="translate-y-[-0.5px] opacity-0 transition-opacity duration-150 group-hover/window-controls:opacity-70">
            {control.mark}
          </span>
        </button>
      ))}
    </div>
  );
}
