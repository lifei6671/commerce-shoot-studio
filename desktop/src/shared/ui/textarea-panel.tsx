import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type TextAreaPanelProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  placeholder: string;
};

export function TextAreaPanel({ placeholder, className, ...props }: TextAreaPanelProps) {
  return (
    <textarea
      className={cn(
        "h-28 w-full resize-none rounded-control border border-white/70 bg-white/80 p-3 text-[12px] leading-6 text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)] outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100",
        className,
      )}
      placeholder={placeholder}
      {...props}
    />
  );
}
