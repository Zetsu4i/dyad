"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "@/components/shell";
import { ToastProvider } from "@/components/ui";
import {
  GeneralPanel,
  McpPanel,
  ModelsPanel,
  ProvidersPanel,
  SandboxPanel,
  SkillsPanel,
} from "@/components/settings/panels";

const TABS = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "sandbox", label: "Sandbox (E2B)" },
  { id: "mcp", label: "MCP Servers" },
  { id: "skills", label: "Skills" },
] as const;

function SettingsInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<string>(searchParams.get("tab") ?? "general");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t) setTab(t);
  }, [searchParams]);

  return (
    <Shell>
      <div className="border-b border-zinc-800/80 px-8 pt-5">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Settings</h1>
        <p className="mb-4 mt-0.5 text-xs text-zinc-500">
          Configure providers, sandboxes, MCP connections and skills for your workspace.
        </p>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${
                tab === t.id
                  ? "border-indigo-500 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-8 py-6">
        {tab === "general" ? <GeneralPanel /> : null}
        {tab === "providers" ? <ProvidersPanel /> : null}
        {tab === "models" ? <ModelsPanel /> : null}
        {tab === "sandbox" ? <SandboxPanel /> : null}
        {tab === "mcp" ? <McpPanel /> : null}
        {tab === "skills" ? <SkillsPanel /> : null}
      </div>
    </Shell>
  );
}

export default function SettingsPage() {
  return (
    <ToastProvider>
      <Suspense>
        <SettingsInner />
      </Suspense>
    </ToastProvider>
  );
}
