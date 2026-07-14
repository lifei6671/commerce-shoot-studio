import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
};

export function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "grid size-8 place-items-center rounded-full border border-white/70 bg-white/80 text-app-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-200 ease-out hover:bg-white hover:text-app-text hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.1)] active:scale-95",
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
