import React from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, ArrowRight, Cloud, Monitor } from "lucide-react";
import { useData, useToast } from "../state/store";
import { api, AppItem } from "../lib/api";
import { Button, Card, Badge, StatusDot, EmptyState, Spinner } from "../components/ui";

export function AppsPage() {
  const { apps, refreshApps, loading } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    // poll while any app is provisioning
    if (!apps.some((a) => a.status === "provisioning")) return;
    const t = setInterval(refreshApps, 4000);
    return () => clearInterval(t);
  }, [apps, refreshApps]);

  const create = async () => {
    setBusy(true);
    try {
      const app = await api.post<AppItem>("/api/apps", { name: name.trim() || undefined });
      setName("");
      await refreshApps();
      navigate(`/apps/${app.id}`);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this app and its sandbox?")) return;
    try {
      await api.del(`/api/apps/${id}`);
      await refreshApps();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Apps</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">Each app runs in its own E2B cloud sandbox with your skills & MCP tools.</p>
        </div>
      </div>

      <Card className="mb-5 p-4">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Name your app — e.g. Customer dashboard, Booking site…"
            className="h-9 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          />
          <Button onClick={create} loading={busy}>
            <Plus size={15} /> New app
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Creates a sandbox, installs the React + Tailwind starter, and syncs your enabled skills.</p>
      </Card>

      {apps.length === 0 ? (
        <EmptyState title="No apps yet" desc="Create your first app above, then describe what to build in the chat — the agent writes code directly into its cloud sandbox." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {apps.map((a) => (
            <Card key={a.id} className="p-4 transition-colors hover:border-zinc-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={a.status === "ready" ? "green" : a.status === "error" ? "red" : "amber"} />
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {a.status === "provisioning" && <Badge tone="amber">Provisioning sandbox…</Badge>}
                    {a.status === "error" && <Badge tone="red">Error</Badge>}
                    {a.sandboxDriver === "e2b" && <Badge><Cloud size={11} /> E2B Cloud</Badge>}
                    {a.sandboxDriver === "local" && <Badge tone="amber"><Monitor size={11} /> Local emulation</Badge>}
                    <span className="text-[11px] text-zinc-600">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                  {a.error && <div className="mt-2 text-xs text-red-400">{a.error}</div>}
                </div>
                <button onClick={() => remove(a.id)} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400" title="Delete app">
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/apps/${a.id}`)}>
                  Open builder <ArrowRight size={13} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
