import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

type ToastVariant = "error" | "success" | "warning";

type ToastItem = {
  durationMs: number;
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastInput = {
  durationMs?: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (input: ToastInput) => string;
};

const defaultToastDurationMs = 3000;
const ToastContext = createContext<ToastContextValue | null>(null);

const toastToneClasses = {
  error: {
    close: "text-red-100/70 hover:bg-white/12 hover:text-white focus:ring-red-200/50",
    panel:
      "bg-[linear-gradient(135deg,rgba(139,24,34,0.94),rgba(75,18,30,0.94))] text-red-50 shadow-[0_16px_34px_rgba(127,29,29,0.20),0_6px_14px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.16)]",
    title: "text-red-50",
  },
  success: {
    close: "text-emerald-100/70 hover:bg-white/12 hover:text-white focus:ring-emerald-200/50",
    panel:
      "bg-[linear-gradient(135deg,rgba(20,111,80,0.94),rgba(7,63,48,0.94))] text-emerald-50 shadow-[0_16px_34px_rgba(6,95,70,0.20),0_6px_14px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.18)]",
    title: "text-emerald-50",
  },
  warning: {
    close: "text-amber-100/70 hover:bg-white/12 hover:text-white focus:ring-amber-200/50",
    panel:
      "bg-[linear-gradient(135deg,rgba(150,83,14,0.94),rgba(83,49,16,0.94))] text-amber-50 shadow-[0_16px_34px_rgba(146,64,14,0.18),0_6px_14px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.16)]",
    title: "text-amber-50",
  },
} satisfies Record<ToastVariant, { close: string; panel: string; title: string }>;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback(
    ({ durationMs = defaultToastDurationMs, message, variant }: ToastInput) => {
      const id = createToastId();
      setToasts((currentToasts) => {
        const nextToasts = currentToasts.filter(
          (toast) => toast.message !== message || toast.variant !== variant,
        );
        return [...nextToasts, { durationMs, id, message, variant }];
      });
      return id;
    },
    [],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="up">
        {children}
        {toasts.map((toast) => (
          <ToastCard key={toast.id} onDismiss={removeToast} toast={toast} />
        ))}
        <ToastViewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}

function ToastViewport() {
  return (
    <ToastPrimitive.Viewport
      aria-label="全局提示"
      className="pointer-events-none fixed left-1/2 top-[72px] z-[160] flex w-fit max-w-[min(320px,calc(100vw-48px))] -translate-x-1/2 flex-col gap-2"
    />
  );
}

function ToastCard({
  onDismiss,
  toast,
}: {
  onDismiss: (toastId: string) => void;
  toast: ToastItem;
}) {
  const tone = toastToneClasses[toast.variant];

  return (
    <ToastPrimitive.Root
      className={cn(
        "group pointer-events-auto relative flex min-h-10 w-fit min-w-[180px] max-w-full items-center overflow-hidden rounded-full px-4 py-2 pr-9 text-sm transition-all",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2",
        "data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=cancel]:translate-y-0 data-[swipe=end]:animate-out data-[swipe=end]:slide-out-to-top-2 data-[swipe=cancel]:transition-transform",
        "before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-white/24 after:pointer-events-none after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.12),transparent_32%)]",
        tone.panel,
      )}
      duration={toast.durationMs}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss(toast.id);
        }
      }}
      role="status"
    >
      <div className="relative z-10 min-w-0 flex-1">
        <ToastPrimitive.Title className={cn("truncate text-[14px] font-semibold leading-5 tracking-[0.01em]", tone.title)}>
          {toast.message}
        </ToastPrimitive.Title>
      </div>
      <ToastPrimitive.Close
        aria-label="关闭提示"
        className={cn(
          "absolute right-3 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full opacity-72 transition hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2",
          tone.close,
        )}
      >
        <X className="size-3.5" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

function createToastId() {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
