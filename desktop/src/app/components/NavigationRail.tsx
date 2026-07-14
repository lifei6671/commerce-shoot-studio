import type { LucideIcon } from "lucide-react";
import { cn } from "../../shared/lib/cn";

export type NavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type NavigationRailProps = {
  items: NavigationItem[];
  activeItemId: string;
  onSelect?: (itemId: string) => void;
};

export function NavigationRail({ items, activeItemId, onSelect }: NavigationRailProps) {
  return (
    <nav
      aria-label="主导航"
      className="relative z-10 flex flex-col items-center gap-3 border-r border-white/70 bg-white/60 px-2 py-4 shadow-[inset_-1px_0_0_rgba(15,23,42,0.05),inset_1px_0_0_rgba(255,255,255,0.7)] backdrop-blur-2xl"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeItemId;

        return (
          <button
            key={item.id}
            aria-pressed={active}
            className={cn(
              "group flex w-10 flex-col items-center gap-1 rounded-control px-1 py-2 text-[11px] font-medium text-app-muted transition-all duration-200 ease-out active:scale-[0.98]",
              active &&
                "bg-blue-50/90 text-app-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(37,99,235,0.08)]",
              !active && "hover:bg-white/80 hover:text-app-text hover:shadow-control",
            )}
            onClick={() => onSelect?.(item.id)}
            type="button"
          >
            <Icon className="size-4" />
            <span className="leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
