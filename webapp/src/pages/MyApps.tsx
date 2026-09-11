import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "../lib/store";
import { timeAgo } from "../lib/util";
import { Spinner, StatusDot } from "../components/ui";
import { Boxes, Plus, RefreshCw, Trash2 } from "lucide-react";

interface AppRow {
  id: string;
  name: string;
  description: string;
  emoji: string;
  updatedAt: string;
  sandbox: { status: string; mode: string };
  config: { installedMcpServerIds: string[]; installedSkillIds: string[] };
}

export default function MyApps() {
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const navigate = useNavigate();

  const load = () => {
    api.get<{ apps: AppRow[] }>("/api/apps").then((r) => setApps(r.apps)).catch((e) => toast("error", e.message));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">My apps</h1>
          <p className="hint mt-1">Every app runs in its own sandbox with a live preview.</p>
        </div>
        <button className="btn-primary" onClick={() => navigate("/build")}>
          <Plus size={15} /> New app
        </button>
      </div>

      {apps === null && (
        <div className="mt-10 flex items-center justify-center gap-2 text-ink-faint">
          <Spinner size={15} /> Loading apps...
        </div>
      )}

      {apps !== null && apps.length === 0 && (
        <button
          onClick={() => navigate("/build")}
          className="mt-6 flex w-full flex-col items-center rounded-xl border border-dashed border-line-strong py-16 transition-colors hover:border-accent/50 hover:bg-accent-soft/30"
        >
          <Boxes size={26} className="text-ink-faint" />
          <div className="mt-3 text-sm font-medium text-ink">No apps yet</div>
          <div className="hint mt-1 max-w-xs text-center">
            Build your first app from a one-line prompt — the agent handles the rest.
          </div>
        </button>
      )}

      {apps !== null && apps.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((a) => (
            <AppCard
              key={a.id}
              app={a}
              onDelete={async () => {
                if (!confirm(`Delete "${a.name}"? The sandbox and chat history will be removed.`)) return;
                try {
                  await api.del(`/api/apps/${a.id}`);
                  toast("success", "App deleted");
                  load();
                } catch (e: any) {
                  toast("error", e.message);
                }
              }}
            />
          ))}
          <button
            onClick={() => navigate("/build")}
            className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-line text-ink-faint transition-colors hover:border-accent/50 hover:text-accent"
          >
            <Plus size={18} />
            <span className="mt-1.5 text-xs font-medium">New app</span>
          </button>
        </div>
      )}
    </div>
  );
}

function AppCard({ app, onDelete }: { app: AppRow; onDelete: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel group relative flex flex-col p-4 transition-colors hover:border-line-strong">
      <Link to={`/apps/${app.id}`} className="flex-1">
        <div className="flex items-start justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-3 text-lg">{app.emoji}</div>
          <div className="flex items-center gap-1.5 text-2xs text-ink-faint">
            <StatusDot status={app.sandbox.status} />
            {app.sandbox.status}
          </div>
        </div>
        <div className="mt-3 truncate text-sm font-semibold text-ink">{app.name}</div>
        <p className="hint mt-1 line-clamp-2 min-h-8">{app.description || "No description"}</p>
      </Link>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-2xs text-ink-faint">
          {app.sandbox.mode === "e2b" ? "E2B sandbox" : "local runtime"} · {timeAgo(app.updatedAt)}
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            title="Restart app"
            className="btn-ghost !h-6 !px-1.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/api/apps/${app.id}/restart`);
                toast("success", "App restarted");
              } catch (e: any) {
                toast("error", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner size={12} /> : <RefreshCw size={12} />}
          </button>
          <button title="Delete app" className="btn-ghost !h-6 !px-1.5 hover:!text-err" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
