import * as Checkbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

type ModuleTileProps = {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function ModuleTile({ title, description, checked, onCheckedChange }: ModuleTileProps) {
  return (
    <div
      className={cn(
        "group flex min-h-[58px] cursor-pointer gap-2 rounded-control border p-3 transition-all duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.985]",
        checked
          ? "border-blue-200/70 bg-[linear-gradient(180deg,rgba(239,246,255,0.96),rgba(219,234,254,0.66))] shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_8px_18px_rgba(37,99,235,0.1)]"
          : "border-white/50 bg-slate-100/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] hover:border-white hover:bg-white/75 hover:shadow-control",
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <Checkbox.Root
        aria-label={title}
        checked={checked}
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border transition-all duration-300 group-active:scale-95",
          checked
            ? "scale-105 border-app-blue bg-app-blue text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_4px_10px_rgba(59,130,246,0.24)]"
            : "border-slate-300 bg-white/90 shadow-inset",
        )}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox.Indicator
          className={cn(
            "grid place-items-center transition-all duration-200 ease-out",
            checked ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
          forceMount
        >
          <Check className="size-3 transition-transform duration-200" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block truncate text-[11px] text-app-muted">{description}</span>
      </span>
    </div>
  );
}
