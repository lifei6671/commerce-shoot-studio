import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

export type SelectPillOption = {
  detail?: string;
  label: string;
  nested?: boolean;
  tone?: "group";
  value: string;
};

type SelectPillProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  options?: SelectPillOption[];
  value: string;
  onChange?: (value: string) => void;
};

export function SelectPill({ ariaLabel, className, disabled = false, options = [], value, onChange }: SelectPillProps) {
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const label = selectedOption?.label ?? value;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updateDropdownRect() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        setDropdownRect(null);
        return;
      }
      setDropdownRect({
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width,
      });
    }

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    // 下拉层通过 Portal 挂到 body，避免被设置卡片的 overflow 裁剪。
    updateDropdownRect();
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("resize", updateDropdownRect);
    window.addEventListener("scroll", updateDropdownRect, true);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("resize", updateDropdownRect);
      window.removeEventListener("scroll", updateDropdownRect, true);
    };
  }, [open]);

  function handleSelect(optionValue: string) {
    setOpen(false);
    onChange?.(optionValue);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel ? `${ariaLabel} ${label}` : undefined}
        className={cn(
          "inline-flex h-8 w-full items-center justify-between gap-2 rounded-control border border-white/60 bg-slate-100/70 px-3 text-[12px] font-medium text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-all duration-200 ease-out hover:border-white hover:bg-white/90 hover:shadow-control active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/25",
          open && "border-blue-200 bg-white shadow-control ring-2 ring-blue-100/70",
        )}
        disabled={disabled}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        type="button"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-app-muted transition-transform duration-200",
            open && "rotate-180 text-slate-800",
          )}
        />
      </button>

      {open && dropdownRect
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[1000] rounded-panel border border-white/80 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
              role="listbox"
              style={{ left: dropdownRect.left, top: dropdownRect.top, width: dropdownRect.width }}
            >
              {options.map((option) => {
                const selected = option.value === value;

                return (
                  <button
                    key={option.value}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[12px] font-semibold text-slate-800 transition-all duration-150 ease-out hover:bg-slate-100 active:scale-[0.99]",
                      option.nested && "pl-6",
                      option.tone === "group" && "bg-slate-100/80",
                      selected && "text-slate-950",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelect(option.value);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleSelect(option.value);
                    }}
                    type="button"
                  >
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full border border-slate-300 bg-white transition-all duration-150",
                        option.nested && "rounded-[5px]",
                        selected && "border-app-blue bg-app-blue text-white shadow-[0_2px_6px_rgba(59,130,246,0.22)]",
                      )}
                    >
                      {selected ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.detail ? (
                      <span className="shrink-0 text-[12px] font-medium text-slate-400">{option.detail}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
