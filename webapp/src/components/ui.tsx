import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, Copy } from "lucide-react";
import { useToasts } from "../lib/store";

// ---- Dialog -----------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 animate-fade-in" onClick={onClose} />
      <div className={`relative ${width} w-full panel shadow-pop animate-slide-up max-h-[85vh] overflow-y-auto`}>
        <div className="flex items-start justify-between px-5 pt-4 pb-1">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="hint mt-1">{description}</p>}
          </div>
          <button className="btn-ghost !h-7 !px-1.5 mt-0.5" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Select -------------------------------------------------------------------

export function Select({
  value,
  onChange,
  options,
  className = "",
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input appearance-none pr-8 cursor-pointer disabled:opacity-50"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-surface-2">
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---- Switch --------------------------------------------------------------------

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 ${
        checked ? "bg-accent-strong" : "bg-surface-4"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
          checked ? "translate-x-4.5 left-0.5" : "left-0.5"
        }`}
        style={{ transform: checked ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

// ---- Tabs -----------------------------------------------------------------------

export function Tabs({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: { id: string; label: React.ReactNode; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? "tab-active" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="ml-1 rounded-full bg-surface-4 px-1.5 text-2xs text-ink-mute">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---- Misc -----------------------------------------------------------------------

export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function StatusDot({ status }: { status: string }) {
  let color = "bg-zinc-500";
  let pulse = false;
  if (status === "running") {
    color = "bg-ok";
    pulse = true;
  } else if (status === "provisioning") {
    color = "bg-warn";
    pulse = true;
  } else if (status === "error") {
    color = "bg-err";
  } else if (status === "paused" || status === "stopped") {
    color = "bg-zinc-600";
  }
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-60 animate-ping`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`btn-ghost !h-6 !px-1.5 ${className}`}
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* ignore */ }
      }}
    >
      {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`panel px-3.5 py-2.5 text-sm animate-slide-up cursor-pointer flex items-start gap-2 ${
            t.kind === "error" ? "border-err/40" : t.kind === "success" ? "border-ok/40" : ""
          }`}
          onClick={() => dismiss(t.id)}
        >
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              t.kind === "error" ? "bg-err" : t.kind === "success" ? "bg-ok" : "bg-accent"
            }`}
          />
          <span className="text-ink-dim">{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Click-outside helper */
export function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}
