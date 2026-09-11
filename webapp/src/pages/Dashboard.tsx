import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast, useAppStore, useLogout } from "../lib/store";
import { Dialog, Select, Spinner, StatusDot } from "../components/ui";
import { Logo } from "./Login";
import { Boxes, LogOut, Plus, Settings, Sparkles, Trash2, RefreshCw, Zap } from "lucide-react";

interface AppRow {
  id: string;
  name: string;
  description: string;
  emoji: string;
  updatedAt: string;
  sandbox: { status: string; mode: string; previewUrl?: string; lastError?: string };
  fileCount?: number;
  config: { installedMcpServerIds: string[]; installedSkillIds: string[] };
}

export default function Dashboard() {
  const { user, settings, loadSettings } = useAppStore();
  const signOut = useLogout();
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    api.get<{ apps: AppRow[] }>("/api/apps").then((r) => setApps(r.apps)).catch((e) => toast("error", e.message));
  };
  useEffect(() => {
    load();
    loadSettings().catch(() => {});
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = apps !== null;
  const modelsReady = !!settings?.defaultModel;

  return (
    <div className="min-h-full">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface-0/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="text-sm font-semibold tracking-tight">Dyad Cloud</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/settings" className="btn-secondary btn-sm">
              <Settings size={13} /> Settings
            </Link>
            <button className="btn-ghost !h-7 !px-1.5" title="Sign out" onClick={signOut}>
              <LogOut size={13} />
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent ring-1 ring-accent/30" title={user?.email}>
              {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Apps</h1>
            <p className="hint mt-1">Every app runs in its own cloud sandbox with a live preview.</p>
          </div>
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={15} /> New app
          </button>
        </div>

        {!modelsReady && ready && (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-warn/25 bg-warn/5 px-4 py-3">
            <Sparkles size={15} className="mt-0.5 text-warn" />
            <div className="text-sm">
              <span className="font-medium text-ink">Finish setup:</span>{" "}
              <span className="text-ink-mute">
                connect a model provider and activate a model so the agent can build.{" "}
              </span>
              <Link to="/settings" className="text-accent hover:underline">
                Open Settings → Models
              </Link>
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!ready && (
            <div className="col-span-full flex items-center justify-center py-20 text-ink-faint">
              <Spinner size={16} className="mr-2" /> Loading apps...
            </div>
          )}
          {ready && apps!.length === 0 && (
            <button
              onClick={() => setShowNew(true)}
              className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong py-20 text-center transition-colors hover:border-accent/50 hover:bg-accent-soft"
            >
              <Boxes size={28} className="text-ink-faint" />
              <div className="mt-3 text-sm font-medium text-ink">Create your first app</div>
              <div className="hint mt-1 max-w-xs">
                The agent scaffolds a React + shadcn/ui project in an E2B sandbox and builds from your description.
              </div>
            </button>
          )}
          {ready &&
            apps!.map((a) => (
              <AppCard key={a.id} app={a} onDelete={async () => {
                if (!confirm(`Delete "${a.name}"? The sandbox and chat history will be removed.`)) return;
                try {
                  await api.del(`/api/apps/${a.id}`);
                  toast("success", "App deleted");
                  load();
                } catch (e: any) {
                  toast("error", e.message);
                }
              }} />
            ))}
          {ready && apps!.length > 0 && (
            <button
              onClick={() => setShowNew(true)}
              className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-line text-ink-faint transition-colors hover:border-accent/50 hover:text-accent"
            >
              <Plus size={18} />
              <span className="mt-1.5 text-xs font-medium">New app</span>
            </button>
          )}
        </div>
      </main>

      <NewAppDialog open={showNew} onClose={() => setShowNew(false)} onCreated={(id) => navigate(`/apps/${id}`)} />
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
        <div className="mt-3 flex items-center gap-2">
          <div className="truncate text-sm font-semibold text-ink">{app.name}</div>
        </div>
        <p className="hint mt-1 line-clamp-2 min-h-8">{app.description || "No description"}</p>
      </Link>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-2xs text-ink-faint">
          {app.sandbox.mode === "e2b" ? "E2B sandbox" : "local runtime"} · updated {timeAgo(app.updatedAt)}
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

function NewAppDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideaIndex, setIdeaIndex] = useState(0);

  const IDEAS = [
    "A team retrospective board with sticky notes, voting and an action items list",
    "A personal finance tracker with budgets, categories and monthly charts",
    "A recipe manager with search, tags, and a weekly meal planner",
    "A habit tracker with streaks, heatmap and daily check-ins",
    "A Kanban board with drag-and-drop columns, labels and due dates",
  ];

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { app } = await api.post<{ app: AppRow }>("/api/apps", { name, description });
      onCreated(app.id);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a new app"
      description="The agent will scaffold a React + TypeScript + shadcn/ui project in a fresh sandbox."
    >
      <div className="space-y-4">
        <div>
          <label className="label">App name</label>
          <input
            className="input"
            placeholder="Task Tracker"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label">What should it do? (optional)</label>
            <button
              className="text-2xs text-accent hover:underline inline-flex items-center gap-1 mb-1.5"
              onClick={() => {
                setIdeaIndex((i) => (i + 1) % IDEAS.length);
                setDescription(IDEAS[ideaIndex]);
              }}
            >
              <Zap size={11} /> Surprise me
            </button>
          </div>
          <textarea
            className="input h-24 resize-none py-2"
            placeholder="A habit tracker with streaks, a heatmap and daily check-ins..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="hint mt-1.5">You can also describe it in your first chat message — the agent will take it from there.</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={!name.trim() || busy}>
            {busy && <Spinner size={14} />} Create app
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
