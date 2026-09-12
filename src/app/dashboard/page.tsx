"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, StatusDot, templateLabel } from "@/components/forge/app-shell";
import { api, timeAgo, type AppSummary } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { TEMPLATES_META, TEMPLATE_ICONS } from "@/components/forge/templates-meta";
import { Plus, Loader2, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("react-vite");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.listApps()
      .then((r) => setApps(r.apps))
      .catch((e) => toast({ title: "Failed to load apps", description: String(e.message ?? e), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("new") === "1") setDialogOpen(true);
  }, [searchParams]);

  const sorted = useMemo(() => [...apps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [apps]);

  async function createApp() {
    if (!name.trim()) {
      toast({ title: "Name your app first", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const { app } = await api.createApp(name.trim(), templateId, description.trim() || undefined);
      toast({ title: "App created", description: `Spinning up a ${templateLabel(templateId)} sandbox…` });
      router.push(`/builder/${app.id}`);
    } catch (err) {
      toast({
        title: "Failed to create app",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800/80 px-6">
        <h1 className="text-sm font-medium text-zinc-200">Dashboard</h1>
        <Button
          size="sm"
          onClick={() => {
            setName("");
            setDescription("");
            setTemplateId("react-vite");
            setDialogOpen(true);
          }}
          className="bg-zinc-100 font-medium text-zinc-900 hover:bg-white"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New app
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-zinc-600">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            <span className="text-sm">Loading apps…</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900">
              <Boxes className="h-6 w-6 text-zinc-500" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-zinc-200">Create your first app</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
              Pick a template, describe what you want to build, and an AI agent will
              build it live inside an E2B cloud sandbox — with a real code editor,
              live preview and command execution.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              className="mt-6 bg-zinc-100 font-medium text-zinc-900 hover:bg-white"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New app
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sorted.map((app) => {
              const Icon = TEMPLATE_ICONS[app.templateId] ?? Boxes;
              return (
                <button
                  key={app.id}
                  onClick={() => router.push(`/builder/${app.id}`)}
                  className="group flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-left transition-all hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                      <Icon className="h-4 w-4 text-zinc-400" />
                    </div>
                    <StatusDot status={app.sandboxStatus} />
                  </div>
                  <div className="mt-3 truncate text-[15px] font-medium text-zinc-100">
                    {app.name}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {app.description ?? templateLabel(app.templateId)}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-600">
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5">
                      {templateLabel(app.templateId)}
                    </span>
                    <span>{timeAgo(app.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* New app dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg border-zinc-800 bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Create a new app</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Choose a starter template. You can change everything later by chatting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-zinc-400">App name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My SaaS dashboard"
                className="border-zinc-800 bg-zinc-950"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this app do?"
                className="min-h-[60px] border-zinc-800 bg-zinc-950"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">Template</Label>
              <div className="grid grid-cols-1 gap-2">
                {TEMPLATES_META.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.id] ?? Boxes;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                        templateId === t.id
                          ? "border-zinc-500 bg-zinc-800/60"
                          : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900">
                        <Icon className="h-4 w-4 text-zinc-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200">{t.title}</span>
                          {t.badge && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                              {t.badge}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-zinc-500">{t.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                onClick={createApp}
                disabled={creating}
                className="bg-zinc-100 font-medium text-zinc-900 hover:bg-white"
              >
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create app
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <DashboardInner />
      </Suspense>
    </AppShell>
  );
}
