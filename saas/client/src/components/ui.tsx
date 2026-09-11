import React from "react";
import { Loader2 } from "lucide-react";

// Enterprise neutral (zinc) primitives. No gradients, no glow.

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
  const sizes = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-8 px-3.5 text-[13px]",
    lg: "h-10 px-5 text-sm",
    icon: "h-8 w-8 text-sm",
  };
  const variants = {
    primary: "bg-zinc-100 text-zinc-950 hover:bg-white",
    secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700",
    outline: "bg-transparent text-zinc-200 hover:bg-zinc-800 border border-zinc-700",
    ghost: "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
    danger: "bg-red-600/90 text-white hover:bg-red-600",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[13px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500 font-mono ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500 ${props.className ?? ""}`}
    />
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-zinc-800 bg-zinc-900 ${className}`}>{children}</div>;
}

export function CardHead({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
      <div>
        <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-zinc-500">{desc}</div>}
      </div>
      {right}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "green" | "red" | "amber" | "blue" }) {
  const tones: Record<string, string> = {
    zinc: "bg-zinc-800 text-zinc-300 border-zinc-700",
    green: "bg-green-950/60 text-green-400 border-green-900",
    red: "bg-red-950/60 text-red-400 border-red-900",
    amber: "bg-amber-950/60 text-amber-400 border-amber-900",
    blue: "bg-sky-950/60 text-sky-400 border-sky-900",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "green" | "red" | "amber" | "zinc" }) {
  const c = { green: "bg-green-500", red: "bg-red-500", amber: "bg-amber-500", zinc: "bg-zinc-600" }[tone];
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-zinc-100" : "bg-zinc-700"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${checked ? "left-[18px] bg-zinc-950" : "left-0.5 bg-zinc-300"}`}
      />
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-zinc-400" />;
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 px-6 py-12 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      {desc && <div className="max-w-sm text-xs text-zinc-500">{desc}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <button onClick={onClose} className="rounded px-1.5 py-0.5 text-lg leading-none text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            ×
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${
            value === t.id ? "border-zinc-100 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {t.label}
          {t.count != null && <span className="rounded bg-zinc-800 px-1.5 text-[11px] text-zinc-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded border border-zinc-700 bg-zinc-800 px-1 py-px font-mono text-[11px] text-zinc-200">{children}</code>;
}
