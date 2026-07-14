import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

type TooltipProps = {
  ariaLabel: string;
  children: ReactNode;
  content: ReactNode;
  contentClassName?: string;
};

type TooltipPosition = {
  left: number;
  top: number;
};

const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 8;

export function Tooltip({ ariaLabel, children, content, contentClassName }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const contentId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING);
      const left = Math.min(Math.max(triggerRect.right - tooltipRect.width, VIEWPORT_PADDING), maxLeft);
      const fitsAbove = triggerRect.top - tooltipRect.height - TOOLTIP_GAP >= VIEWPORT_PADDING;
      const top = fitsAbove
        ? triggerRect.top - tooltipRect.height - TOOLTIP_GAP
        : Math.min(triggerRect.bottom + TOOLTIP_GAP, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING);

      setPosition({ left, top: Math.max(VIEWPORT_PADDING, top) });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      ref={containerRef}
    >
      <button
        ref={triggerRef}
        aria-describedby={open ? contentId : undefined}
        aria-label={ariaLabel}
        className="grid size-5 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/80 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/35"
        onBlur={(event) => {
          if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
        onFocus={() => setOpen(true)}
        type="button"
      >
        {children}
      </button>
      {open
        ? createPortal(
            <span
              className={cn(
                "pointer-events-none fixed z-[1000] w-56 rounded-[10px] border border-slate-200 bg-slate-950 px-3 py-2 text-left text-[11px] font-normal leading-5 text-white shadow-xl",
                contentClassName,
              )}
              id={contentId}
              ref={tooltipRef}
              role="tooltip"
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                visibility: position ? "visible" : "hidden",
              }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
