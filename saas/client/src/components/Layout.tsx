import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutGrid, Settings, Plug2, Hammer, Plus, Box } from "lucide-react";
import { useData, useToast } from "../state/store";
import { api, AppItem } from "../lib/api";
import { StatusDot } from "./ui";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function Sidebar() {
  const { apps, refreshApps } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");

  const create = async () => {
    try {
      const app = await api.post<AppItem>("/api/apps", { name: name.trim() || undefined });
      setName("");
      setCreating(false);
      await refreshApps();
      navigate(`/apps/${app.id}`);
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
      isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
    }`;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3.5 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-sm font-bold text-zinc-950">D</div>
        <span className="text-sm font-semibold tracking-tight">Dyad</span>
        <span className="rounded border border-zinc-700 px-1 text-[10px] font-medium text-zinc-500">SaaS</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 py-2">
        <NavLink to="/" className={link} end>
          <LayoutGrid size={15} /> Apps
        </NavLink>
        <NavLink to="/integrations" className={link}>
          <Plug2 size={15} /> Integrations
        </NavLink>
        <NavLink to="/skills" className={link}>
          <Hammer size={15} /> Skills
        </NavLink>
        <NavLink to="/settings" className={link}>
          <Settings size={15} /> Settings
        </NavLink>
      </nav>

      <div className="flex items-center justify-between px-3.5 pb-1 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Projects</span>
        <button onClick={() => setCreating((v) => !v)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="New app">
          <Plus size={14} />
        </button>
      </div>
      {creating && (
        <div className="px-2 pb-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="App name…"
            className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[13px] outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {apps.map((a) => (
          <NavLink
            key={a.id}
            to={`/apps/${a.id}`}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`
            }
          >
            <StatusDot tone={a.status === "ready" ? "green" : a.status === "error" ? "red" : "amber"} />
            <span className="truncate">{a.name}</span>
          </NavLink>
        ))}
        {apps.length === 0 && <div className="px-2.5 py-2 text-xs text-zinc-600">No projects yet.</div>}
      </div>

      <div className="border-t border-zinc-800 px-3.5 py-2.5 text-[11px] text-zinc-600">
        <div className="flex items-center gap-1.5">
          <Box size={12} /> Sandboxes: E2B Cloud
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const { settings, mcps, skills } = useData();
  const mcpCount = mcps?.servers.filter((s) => s.enabled).length ?? 0;
  const skillCount = skills?.filter((s) => s.installed).length ?? 0;
  const modelCount = settings?.activeModels.filter((m) => m.enabled).length ?? 0;
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="text-[13px] text-zinc-500">AI App Builder — cloud workspace</div>
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <StatusDot tone={settings?.e2bKeySet ? "green" : "red"} /> E2B {settings?.e2bKeySet ? "connected" : "no key"}
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot tone={modelCount > 0 ? "green" : "amber"} /> {modelCount} model{modelCount === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot tone={mcpCount > 0 ? "green" : "zinc"} /> {mcpCount} MCP
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot tone={skillCount > 0 ? "green" : "zinc"} /> {skillCount} skill{skillCount === 1 ? "" : "s"}
        </span>
      </div>
    </header>
  );
}
