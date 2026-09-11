"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, X, Loader2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

type Toast = { id: number; title: string; description?: string; variant?: "ok" | "error" };
const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({
  push: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-fade-up rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-pop flex items-start gap-2.5"
          >
            {t.variant === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-100">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                  {t.description}
                </p>
              ) : null}
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh] backdrop-blur-sm">
      <div
        className={`animate-fade-up w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl border border-zinc-800 bg-[var(--surface-2)] shadow-pop`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function Badge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "ok" | "warn" | "error" | "accent" | "outline";
}) {
  const styles: Record<string, string> = {
    default: "bg-zinc-800 text-zinc-300 border-zinc-700/60",
    ok: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    error: "bg-red-500/10 text-red-300 border-red-500/25",
    accent: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    outline: "bg-transparent text-zinc-400 border-zinc-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    running: ["bg-sky-400", "Running"],
    building: ["bg-amber-400", "Building"],
    installing: ["bg-amber-400", "Installing"],
    creating: ["bg-amber-400", "Creating"],
    error: ["bg-red-400", "Error"],
    stopped: ["bg-zinc-600", "Stopped"],
    idle: ["bg-zinc-600", "Idle"],
  };
  const [color, label] = map[status] ?? map.idle;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`h-1.5 w-1.5 rounded-full ${color} ${["running","building","installing","creating"].includes(status) ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-indigo-500" : "bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : ""
        }`}
      />
    </button>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            active === t.id
              ? "bg-zinc-800 text-zinc-100 shadow-insetline"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-6 py-14 text-center">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-zinc-400">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-200">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`btn-ghost btn-sm ${className}`}
      title="Copy"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
