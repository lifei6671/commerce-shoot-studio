import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-600 disabled:opacity-70",
        className,
      )}
      type={type}
      {...props}
    />
  );
}
