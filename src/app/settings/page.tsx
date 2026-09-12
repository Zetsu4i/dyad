"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/forge/app-shell";
import { ProvidersSection } from "@/components/forge/settings/providers-section";
import { ModelsSection } from "@/components/forge/settings/models-section";
import { E2BSection } from "@/components/forge/settings/e2b-section";
import { SkillsSection } from "@/components/forge/settings/skills-section";
import { McpSection } from "@/components/forge/settings/mcp-section";
import { cn } from "@/lib/utils";
import { Plug, Server, Boxes, Sparkles, Cpu } from "lucide-react";

const TABS = [
  { id: "providers", label: "Providers", icon: Server, description: "API base URLs and keys" },
  { id: "models", label: "Models", icon: Cpu, description: "Pull and activate models" },
  { id: "e2b", label: "E2B Sandboxes", icon: Boxes, description: "Sandbox API key" },
  { id: "skills", label: "Skills", icon: Sparkles, description: "Agent skill bundles" },
  { id: "mcp", label: "MCP Servers", icon: Plug, description: "Third-party tool servers" },
];

function SettingsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = searchParams.get("tab") ?? "providers";
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && t !== tab) setTab(t);
  }, [searchParams]);

  function selectTab(id: string) {
    setTab(id);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="flex h-full min-h-0">
      {/* Settings nav */}
      <div className="flex w-60 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950 py-4">
        <div className="px-4 pb-4">
          <h1 className="text-sm font-medium text-zinc-200">Settings</h1>
          <p className="mt-1 text-xs text-zinc-600">Configure connections and capabilities</p>
        </div>
        <nav className="space-y-0.5 px-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
                  tab === t.id
                    ? "bg-zinc-800/70 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{t.label}</div>
                  <div className="truncate text-[11px] text-zinc-600">{t.description}</div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Settings content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-zinc-800/80 px-6">
          <h2 className="text-sm font-medium text-zinc-200">{active.label}</h2>
          <span className="ml-3 text-xs text-zinc-600">{active.description}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-6">
            {tab === "providers" && <ProvidersSection />}
            {tab === "models" && <ModelsSection />}
            {tab === "e2b" && <E2BSection />}
            {tab === "skills" && <SkillsSection />}
            {tab === "mcp" && <McpSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <SettingsInner />
      </Suspense>
    </AppShell>
  );
}
