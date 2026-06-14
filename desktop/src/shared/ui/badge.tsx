import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

type BadgeVariant = "default" | "secondary" | "success" | "outline";

const badgeVariantClass: Record<BadgeVariant, string> = {
  default: "bg-blue-50 text-blue-700 ring-blue-200",
  secondary: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  outline: "bg-white text-slate-700 ring-slate-200",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
        badgeVariantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
