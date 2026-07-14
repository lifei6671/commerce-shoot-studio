import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type UploadDropzoneProps = {
  actionLabel: string;
  className?: string;
  description: string;
  icon: ReactNode;
  onClick?: () => void;
};

export function UploadDropzone({
  actionLabel,
  className,
  description,
  icon,
  onClick,
}: UploadDropzoneProps) {
  const containerClassName = cn(
    "relative grid h-20 w-full place-items-center overflow-hidden rounded-panel border-2 border-dashed border-slate-200/90 bg-white/60 p-3 text-center shadow-[inset_0_1px_4px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.86)] transition-colors duration-200 hover:border-blue-200 hover:bg-white/75",
    onClick &&
      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/35",
    className,
  );
  const content = (
    <>
      <div className="absolute inset-x-8 top-0 h-px bg-white/90" />
      <div className="relative">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-control border border-white/70 bg-white/80 px-2 text-[13px] font-medium text-app-text shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-200 ease-out">
          {icon}
          {actionLabel}
        </span>
        <p className="mt-2 text-[12px] text-app-muted">{description}</p>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        aria-label={actionLabel}
        className={containerClassName}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className={containerClassName}>{content}</div>
  );
}
