import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, Settings, McpServer, Skill, AppItem } from "../lib/api";

interface McpData {
  servers: McpServer[];
  statuses: Record<string, { status: string; error: string | null; toolCount?: number }>;
  templates: any[];
}

interface Ctx {
  settings: Settings | null;
  mcps: McpData | null;
  skills: Skill[] | null;
  apps: AppItem[];
  loading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
  refreshMcps: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshApps: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const AppCtx = createContext<Ctx>(null as any);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mcps, setMcps] = useState<McpData | null>(null);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    setSettings(await api.get<Settings>("/api/settings"));
  }, []);
  const refreshMcps = useCallback(async () => {
    setMcps(await api.get<McpData>("/api/mcps"));
  }, []);
  const refreshSkills = useCallback(async () => {
    const d = await api.get<{ skills: Skill[] }>("/api/skills");
    setSkills(d.skills);
  }, []);
  const refreshApps = useCallback(async () => {
    const d = await api.get<{ apps: AppItem[] }>("/api/apps");
    setApps(d.apps);
  }, []);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshSettings(), refreshMcps(), refreshSkills(), refreshApps()]);
  }, [refreshSettings, refreshMcps, refreshSkills, refreshApps]);

  useEffect(() => {
    refreshAll()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refreshAll]);

  return (
    <AppCtx.Provider
      value={{ settings, mcps, skills, apps, loading, error, refreshSettings, refreshMcps, refreshSkills, refreshApps, refreshAll }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export const useData = () => useContext(AppCtx);

// toast (minimal)
const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-sm rounded-md border px-3 py-2 text-[13px] shadow-lg ${
              t.kind === "err" ? "border-red-900 bg-red-950 text-red-200" : "border-zinc-700 bg-zinc-900 text-zinc-100"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
