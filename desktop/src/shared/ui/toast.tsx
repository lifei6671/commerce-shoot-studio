import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "../lib/cn";

type ToastVariant = "error" | "success" | "warning";

type ToastItem = {
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
    icon: "text-red-500",
    panel: "border-red-100 bg-white text-slate-950",
    ring: "bg-red-50",
  },
  success: {
    icon: "text-emerald-500",
    panel: "border-emerald-100 bg-white text-slate-950",
    ring: "bg-emerald-50",
  },
  warning: {
    icon: "text-amber-500",
    panel: "border-amber-100 bg-white text-slate-950",
    ring: "bg-amber-50",
  },
} satisfies Record<ToastVariant, { icon: string; panel: string; ring: string }>;

const toastIcons = {
  error: XCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
} satisfies Record<ToastVariant, typeof CheckCircle2>;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((toastId: string) => {
    const timer = timersRef.current.get(toastId);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(toastId);
    }

    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback(
    ({ durationMs = defaultToastDurationMs, message, variant }: ToastInput) => {
      const id = createToastId();
      setToasts((currentToasts) => [...currentToasts, { id, message, variant }]);
      const timer = window.setTimeout(() => removeToast(id), durationMs);
      timersRef.current.set(id, timer);
      return id;
    },
    [removeToast],
  );

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} />
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

function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-[72px] z-[160] flex w-[min(380px,calc(100vw-48px))] -translate-x-1/2 flex-col gap-2"
      role="region"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const Icon = toastIcons[toast.variant];
  const tone = toastToneClasses[toast.variant];

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-h-11 items-center gap-3 rounded-[12px] border px-3.5 py-2.5 text-[13px] font-medium shadow-[0_16px_36px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.88)] backdrop-blur-xl transition-all duration-200 ease-out",
        tone.panel,
      )}
      role="status"
    >
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", tone.ring)}>
        <Icon className={cn("size-4", tone.icon)} />
      </span>
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>
    </div>
  );
}

function createToastId() {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
