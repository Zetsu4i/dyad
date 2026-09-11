import React from "react";
import { RefreshCw, Plus, Trash2, Check, FlaskConical, KeyRound, Server, Cpu } from "lucide-react";
import { api, Provider } from "../lib/api";
import { useData, useToast } from "../state/store";
import { Button, Card, CardHead, Field, Input, Select, Badge, Modal, Tabs, Spinner, Switch, EmptyState } from "../components/ui";

export function SettingsPage() {
  const [tab, setTab] = React.useState<"providers" | "models" | "runtime">("providers");
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      <p className="mb-4 mt-0.5 text-[13px] text-zinc-500">Providers, models, and sandbox runtime.</p>
      <Tabs tabs={[
        { id: "providers", label: "Providers" },
        { id: "models", label: "Models" },
        { id: "runtime", label: "E2B & Runtime" },
      ]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === "providers" && <ProvidersTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "runtime" && <RuntimeTab />}
      </div>
    </div>
  );
}

function ProvidersTab() {
  const { settings, refreshSettings } = useData();
  const toast = useToast();
  const [editing, setEditing] = React.useState<Provider | null>(null);
  const [showNew, setShowNew] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [pulling, setPulling] = React.useState<string | null>(null);

  const providers = settings?.providers || [];

  const test = async (p: Provider) => {
    setTesting(p.id);
    try {
      const d = await api.post<{ text: string }>(`/api/providers/${p.id}/test`, {});
      toast(`OK — model replied: ${d.text || "(empty)"}`);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setTesting(null);
    }
  };

  const pull = async (p: Provider) => {
    setPulling(p.id);
    try {
      const d = await api.post<{ models: { id: string }[]; count: number }>(`/api/providers/${p.id}/models`, {});
      toast(`Pulled ${d.count} models from ${p.name}`);
      await refreshSettings();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setPulling(null);
    }
  };

  const remove = async (p: Provider) => {
    if (!confirm(`Delete provider "${p.name}"?`)) return;
    try {
      await api.del(`/api/providers/${p.id}`);
      await refreshSettings();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> Add provider</Button>
      </div>
      {providers.length === 0 && <EmptyState title="No providers" desc="Add an OpenAI-compatible or Anthropic-compatible provider to start building." />}
      {providers.map((p) => (
        <Card key={p.id}>
          <CardHead
            title={p.name}
            desc={`${p.type} · ${p.apiBase}`}
            right={
              <div className="flex items-center gap-1.5">
                <Badge tone={p.apiKeySet ? "green" : "zinc"}>{p.apiKeySet ? "key set" : "no key"}</Badge>
                <Button size="sm" variant="ghost" loading={pulling === p.id} onClick={() => pull(p)} title="Pull models list">
                  <RefreshCw size={13} /> Models
                </Button>
                <Button size="sm" variant="ghost" loading={testing === p.id} onClick={() => test(p)} title="Send a test prompt">
                  <FlaskConical size={13} /> Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                <button onClick={() => remove(p)} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            }
          />
        </Card>
      ))}
      {(showNew || editing) && (
        <ProviderModal
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={refreshSettings}
        />
      )}
      <Card className="p-4 text-xs leading-relaxed text-zinc-500">
        <span className="font-semibold text-zinc-300">How it works.</span> A provider is any OpenAI-compatible
        (<Code2>/v1/chat/completions</Code2> + <Code2>/v1/models</Code2>) or Anthropic-compatible
        (<Code2>/v1/messages</Code2>) endpoint. After adding one, pull its models list, activate the models you want
        in the Models tab, then pick them in the builder.
      </Card>
    </div>
  );
}

function Code2({ children }: { children: React.ReactNode }) {
  return <code className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[11px] text-zinc-200">{children}</code>;
}

function ProviderModal({ initial, onClose, onSaved }: { initial: Provider | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = React.useState(initial?.name || "");
  const [type, setType] = React.useState(initial?.type || "openai-compatible");
  const [apiBase, setApiBase] = React.useState(initial?.apiBase || "https://agaam2-7dba6cfc4d0a.herokuapp.com/");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/api/providers/${initial.id}`, { name, type, apiBase, ...(apiKey ? { apiKey } : {}) });
      } else {
        await api.post("/api/providers", { name: name || undefined, type, apiBase, apiKey });
      }
      await onSaved();
      onClose();
      toast("Provider saved");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Edit provider" : "Add provider"} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Default Gateway" /></Field>
        <Field label="API format">
          <Select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="openai-compatible">OpenAI-compatible (/v1/chat/completions)</option>
            <option value="anthropic-compatible">Anthropic-compatible (/v1/messages)</option>
          </Select>
        </Field>
        <Field label="API base URL" hint="Trailing /v1 optional — both work."><Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://…" /></Field>
        <Field label={initial ? "API key (leave blank to keep)" : "API key (optional for open gateways)"}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save provider</Button>
        </div>
      </div>
    </Modal>
  );
}

function ModelsTab() {
  const { settings, refreshSettings } = useData();
  const toast = useToast();
  const [pulling, setPulling] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");

  if (!settings) return <Spinner />;

  const pull = async (providerId: string) => {
    setPulling(providerId);
    try {
      const d = await api.post<{ count: number }>(`/api/providers/${providerId}/models`, {});
      toast(`Pulled ${d.count} models`);
      await refreshSettings();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setPulling(null);
    }
  };

  const toggleActive = async (providerId: string, modelId: string, enabled: boolean) => {
    const cur = settings.activeModels || [];
    let next: typeof cur;
    if (enabled) {
      next = cur.some((m) => m.providerId === providerId && m.modelId === modelId)
        ? cur.map((m) => (m.providerId === providerId && m.modelId === modelId ? { ...m, enabled: true } : m))
        : [...cur, { providerId, modelId, enabled: true }];
    } else {
      next = cur.map((m) => (m.providerId === providerId && m.modelId === modelId ? { ...m, enabled: false } : m));
    }
    await api.put("/api/models/active", { activeModels: next });
    await refreshSettings();
  };

  const setDefault = async (providerId: string, modelId: string) => {
    await api.put("/api/models/active", { defaultModel: { providerId, modelId } });
    await refreshSettings();
    toast(`Default model: ${modelId}`);
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        <div className="text-[13px] font-semibold">Activated models</div>
        <p className="mb-3 mt-0.5 text-xs text-zinc-500">Only activated models appear in the builder's model picker.</p>
        {settings.activeModels.filter((m) => m.enabled).length === 0 && (
          <div className="text-xs text-zinc-500">None yet — pull a models list below and activate what you need.</div>
        )}
        <div className="flex flex-col gap-1.5">
          {settings.activeModels.filter((m) => m.enabled).map((m) => {
            const p = settings.providers.find((x) => x.id === m.providerId);
            const isDefault = settings.defaultModel?.providerId === m.providerId && settings.defaultModel?.modelId === m.modelId;
            return (
              <div key={`${m.providerId}::${m.modelId}`} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                <Cpu size={13} className="text-zinc-500" />
                <code className="font-mono text-xs text-zinc-100">{m.modelId}</code>
                <span className="text-[11px] text-zinc-500">via {p?.name || m.providerId}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {isDefault ? <Badge tone="green"><Check size={11} /> default</Badge> : (
                    <button onClick={() => setDefault(m.providerId, m.modelId)} className="text-[11px] text-zinc-500 hover:text-zinc-200">make default</button>
                  )}
                  <button onClick={() => toggleActive(m.providerId, m.modelId, false)} className="text-[11px] text-zinc-500 hover:text-red-400">deactivate</button>
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {settings.providers.map((p) => {
        const cat = settings.modelCatalog[p.id];
        const models = (cat?.models || []).filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()));
        return (
          <Card key={p.id}>
            <CardHead
              title={`${p.name} — model catalog`}
              desc={cat ? `${cat.models.length} models · pulled ${new Date(cat.fetchedAt).toLocaleString()}` : "Not pulled yet"}
              right={<Button size="sm" variant="secondary" loading={pulling === p.id} onClick={() => pull(p.id)}><RefreshCw size={13} /> Pull models list</Button>}
            />
            {cat && (
              <div className="p-3">
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models…" className="mb-2" />
                <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-800">
                  {models.slice(0, 200).map((m) => {
                    const active = settings.activeModels.find((a) => a.providerId === p.id && a.modelId === m.id)?.enabled;
                    return (
                      <div key={m.id} className="flex items-center gap-2 border-b border-zinc-900 px-2.5 py-1.5 last:border-0">
                        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{m.id}</code>
                        <Button size="sm" variant={active ? "ghost" : "secondary"} onClick={() => toggleActive(p.id, m.id, !active)}>
                          {active ? "Activated ✓" : "Activate"}
                        </Button>
                      </div>
                    );
                  })}
                  {models.length === 0 && <div className="p-3 text-xs text-zinc-600">No models match.</div>}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function RuntimeTab() {
  const { settings, refreshSettings } = useData();
  const toast = useToast();
  const [key, setKey] = React.useState("");
  const [template, setTemplate] = React.useState("");
  const [timeoutHrs, setTimeoutHrs] = React.useState("1");
  const [fallback, setFallback] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setTemplate(settings.e2bTemplate || "base");
      setTimeoutHrs(String((settings.sandboxTimeoutMs || 3600000) / 3600000));
      setFallback(settings.allowLocalFallback !== false);
    }
  }, [settings]);

  if (!settings) return <Spinner />;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/settings", {
        ...(key ? { e2bKey: key } : {}),
        e2bTemplate: template,
        sandboxTimeoutMs: Math.max(5, Math.min(24 * 7, Number(timeoutHrs) || 1)) * 3600000,
        allowLocalFallback: fallback,
      });
      setKey("");
      await refreshSettings();
      toast("Runtime settings saved");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    setValidating(true);
    try {
      await api.post("/api/e2b/test", key ? { key } : {});
      toast("E2B key is valid — test sandbox created and removed.");
      setKey("");
      await refreshSettings();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHead
          title="E2B Cloud Sandboxes"
          desc="All app code and commands run inside E2B sandboxes."
          right={settings.e2bValidated
            ? <Badge tone="green"><Check size={11} /> validated</Badge>
            : <Badge tone="amber">not validated</Badge>}
        />
        <div className="flex flex-col gap-3 p-4">
          <Field label="E2B API key" hint={settings.e2bKeySet ? `Current: ${settings.e2bKey} — paste a new key to replace it.` : "Get one at e2b.dev. Required for cloud sandboxes."}>
            <div className="flex gap-2">
              <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e2b_…" />
              <Button variant="secondary" onClick={validate} loading={validating}><KeyRound size={14} /> Validate</Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sandbox template" hint="E2B template name. Leave 'base' unless you built a custom template with Node preinstalled.">
              <Input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="base" />
            </Field>
            <Field label="Sandbox lifetime (hours)" hint="Sandboxes auto-pause after this long idle.">
              <Input value={timeoutHrs} onChange={(e) => setTimeoutHrs(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium">Allow local emulation fallback</div>
              <div className="text-xs text-zinc-500">If E2B is unreachable, run sandboxes on this server instead (for testing). Previews are served as static builds.</div>
            </div>
            <Switch checked={fallback} onChange={setFallback} />
          </div>
          <div className="flex items-center gap-2 text-zinc-500">
            <Server size={13} />
            <span className="text-xs">How it works: new app → E2B sandbox → Node ensured → starter installed → enabled skills synced to <code className="font-mono">.skills/</code> → dev server on :5173 → public preview URL.</span>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} loading={saving}>Save runtime settings</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
