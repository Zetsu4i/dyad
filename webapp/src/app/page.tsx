"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Plus,
  Sparkles,
  KeyRound,
  Cloud,
  Cpu,
  ArrowUpRight,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Shell, PageHeader } from "@/components/shell";
import {
  Badge,
  Dialog,
  EmptyState,
  Spinner,
  StatusDot,
  ToastProvider,
  useToast,
} from "@/components/ui";
import { api, type AppSummary } from "@/lib/types";

function OnboardingChecklist() {
  const [e2bOk, setE2bOk] = useState<boolean | null>(null);
  const [modelOk, setModelOk] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ e2bConfigured: boolean }>("/api/settings").then((s) => setE2bOk(s.e2bConfigured));
    api<{ models: unknown[] }>("/api/models").then((m) => setModelOk(m.models.length > 0));
  }, []);

  const items = [
    {
      done: modelOk,
      label: "Connect a model provider",
      description: "Add an OpenAI- or Anthropic-compatible endpoint and activate models.",
      href: "/settings?tab=providers",
    },
    {
      done: e2bOk,
      label: "Add your E2B API key",
      description: "Apps build and run inside your own E2B cloud sandboxes.",
      href: "/settings?tab=sandbox",
    },
  ];

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Get started</h2>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                item.done
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500"
              }`}
            >
              {item.done ? "✓" : "·"}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${item.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                {item.label}
              </p>
              <p className="truncate text-xs text-zinc-500">{item.description}</p>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-600" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function NewAppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<{ app: AppSummary; chatId: number | null; prompt: string | null }>(
        "/api/apps",
        { method: "POST", body: JSON.stringify({ name: name || undefined, prompt: prompt || undefined }) },
      );
      // Kick off the first agent turn when a prompt was provided.
      if (res.prompt && res.chatId) {
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appId: res.app.id,
            chatId: res.chatId,
            message: res.prompt,
            chatMode: "build",
          }),
        }).catch(() => {});
      }
      onClose();
      router.push(`/apps/${res.app.id}`);
    } catch (err) {
      push({ title: "Failed to create app", description: String(err), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Create a new app">
      <div className="space-y-4">
        <div>
          <label className="label">Describe what you want to build</label>
          <textarea
            className="textarea min-h-[110px]"
            placeholder="e.g. A kanban board with drag-and-drop cards, filters and a dark theme…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">App name (optional)</label>
          <input
            className="input"
            placeholder="Auto-generated from your prompt"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-2xs text-zinc-600">
            The agent builds the first version right away — chat continues on the next screen.
          </p>
          <button className="btn-primary btn-md" onClick={create} disabled={busy || !prompt.trim()}>
            {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            Build it
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Dashboard() {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { push } = useToast();

  const load = () => {
    api<{ apps: AppSummary[] }>("/api/apps")
      .then((r) => setApps(r.apps))
      .catch(() => setApps([]));
  };
  useEffect(load, []);

  const removeApp = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}" and its sandbox? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await api(`/api/apps?id=${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      push({ title: "Delete failed", description: String(err), variant: "error" });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Shell>
      <PageHeader
        title="Apps"
        description="Every app runs in an isolated cloud sandbox with your selected tools."
        actions={
          <button className="btn-primary btn-md" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> New app
          </button>
        }
      />
      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            {apps === null ? (
              <div className="flex h-40 items-center justify-center text-zinc-600">
                <Spinner />
              </div>
            ) : apps.length === 0 ? (
              <EmptyState
                icon={<Boxes className="h-6 w-6" />}
                title="No apps yet"
                description="Describe your idea and the agent will build a working first version in a cloud sandbox."
                action={
                  <button className="btn-primary btn-md" onClick={() => setDialogOpen(true)}>
                    <Sparkles className="h-4 w-4" /> Create your first app
                  </button>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {apps.map((app) => (
                  <div
                    key={app.id}
                    className="card group relative transition-colors hover:border-zinc-700"
                  >
                    <Link href={`/apps/${app.id}`} className="block p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-zinc-100">
                            {app.name}
                          </h3>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {app.description || app.slug}
                          </p>
                        </div>
                        <Badge variant={app.runner === "e2b" ? "accent" : "outline"}>
                          <Cloud className="h-3 w-3" />
                          {app.runner}
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <StatusDot status={app.status} />
                        <span className="text-2xs text-zinc-600">
                          {new Date(app.updatedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {app.lastError ? (
                        <p className="mt-2 line-clamp-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-2xs text-red-300">
                          {app.lastError}
                        </p>
                      ) : null}
                    </Link>
                    <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          removeApp(app.id, app.name);
                        }}
                        className="rounded-md border border-zinc-800 bg-zinc-900/90 p-1.5 text-zinc-500 hover:border-red-500/40 hover:text-red-300"
                        title="Delete app"
                      >
                        {deleting === app.id ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-4">
            <OnboardingChecklist />
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-zinc-100">How it works</h3>
              <ol className="space-y-2.5 text-xs leading-relaxed text-zinc-400">
                <li className="flex gap-2">
                  <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  Chat with the agent — it writes real code using Dyad&apos;s proven build protocol.
                </li>
                <li className="flex gap-2">
                  <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  Files sync into <span className="text-zinc-200">your E2B sandbox</span>, where npm install &amp; the dev server run.
                </li>
                <li className="flex gap-2">
                  <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  Connect MCP servers and skills from Settings — the agent can use them in every app.
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
      <NewAppDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Shell>
  );
}

export default function DashboardPage() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
