import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { toast, useAppStore, useLogout } from "../lib/store";
import { Dialog, Select, Spinner, Switch, Tabs } from "../components/ui";
import { Logo } from "./Login";
import {
  Check, ChevronDown, Cloud, CreditCard, Cpu, KeyRound, LogOut, Plug, Plus, RefreshCw, Save,
  Server, Sparkles, Star, Trash2, TriangleAlert, Wrench,
} from "lucide-react";

interface Provider {
  id: string;
  name: string;
  format: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
}
interface ModelRow {
  providerId: string;
  apiName: string;
  displayName: string;
  enabled: boolean;
  providerName: string;
  providerFormat?: string;
}
interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  catalogId?: string;
  requiredEnvKeys?: string[];
}
interface CatalogEntry {
  catalogId: string;
  name: string;
  description: string;
  transport: string;
  category: string;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnvKeys?: { key: string; label: string; optional?: boolean }[];
}
interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  builtin: boolean;
  slug: string;
}

const TABS = [
  { id: "general", label: "General", icon: <Cpu size={13} /> },
  { id: "providers", label: "Providers", icon: <Server size={13} /> },
  { id: "models", label: "Models", icon: <Cpu size={13} /> },
  { id: "sandbox", label: "Sandbox (E2B)", icon: <Cloud size={13} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={13} /> },
];

export default function SettingsPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "general");
  const signOut = useLogout();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line bg-surface-0/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="text-sm font-semibold tracking-tight">Dyad Cloud</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/" className="btn-secondary btn-sm">Back to apps</Link>
            <button className="btn-ghost !h-7 !px-1.5" title="Sign out" onClick={signOut}>
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="hint mt-1">Workspace-wide configuration. MCP servers and skills live under Integrations in the sidebar.</p>

        <div className="mt-6 flex flex-col gap-8 lg:flex-row">
          <nav className="flex w-full shrink-0 flex-row flex-wrap gap-1 lg:w-52 lg:flex-col">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`tab w-full justify-start ${tab === t.id ? "tab-active" : ""}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 pb-16">
            {tab === "general" && <GeneralTab />}
            {tab === "providers" && <ProvidersTab />}
            {tab === "models" && <ModelsTab />}
            {tab === "sandbox" && <SandboxTab />}
            {tab === "billing" && <BillingTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// General
// ============================================================================

function GeneralTab() {
  const { settings, loadSettings } = useAppStore();
  const [form, setForm] = useState<{
    runtimeMode: "e2b" | "local";
    agentMaxSteps: number;
    agentTemperature: number;
    mcpConsentMode: "auto" | "always_allow" | "always_ask";
    defaultModel: string | null;
  } | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        runtimeMode: settings.runtimeMode,
        agentMaxSteps: settings.agentMaxSteps,
        agentTemperature: settings.agentTemperature,
        mcpConsentMode: settings.mcpConsentMode,
        defaultModel: settings.defaultModel,
      });
    }
  }, [settings, form]);

  useEffect(() => {
    api.get<{ models: ModelRow[] }>("/api/models").then((r) => setModels(r.models.filter((m) => m.enabled))).catch(() => {});
  }, []);

  if (!form) return <Spinner className="mt-8 text-ink-faint" />;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/settings", form);
      await loadSettings();
      toast("success", "Settings saved");
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <h2 className="card-title">Execution</h2>
        <p className="hint mt-1">Where app sandboxes run. E2B is the production runtime; local runs processes on this server (development).</p>
        <div className="mt-4 grid grid-cols-2 gap-3 max-w-md">
          {(["e2b", "local"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setForm({ ...form, runtimeMode: mode })}
              className={`rounded-lg border p-3.5 text-left transition-colors ${
                form.runtimeMode === mode ? "border-accent/60 bg-accent-soft" : "border-line bg-surface-1 hover:border-line-strong"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cloud size={14} className={form.runtimeMode === mode ? "text-accent" : "text-ink-faint"} />
                {mode === "e2b" ? "E2B cloud sandboxes" : "Local runtime (dev)"}
                {mode === "e2b" && <span className="badge border-accent/40 text-accent">recommended</span>}
              </div>
              <p className="hint mt-1.5">
                {mode === "e2b"
                  ? "Isolated cloud microVMs per app with public preview URLs. Requires an E2B API key."
                  : "Runs the sandbox workload on this server. No E2B key needed — good for offline development."}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="card-title">Agent</h2>
        <p className="hint mt-1">Defaults for the build agent loop.</p>
        <div className="mt-4 grid max-w-md gap-4">
          <div>
            <label className="label">Default model</label>
            <Select
              value={form.defaultModel ?? ""}
              onChange={(v) => setForm({ ...form, defaultModel: v || null })}
              placeholder="Choose a model..."
              options={models.map((m) => ({ value: `${m.providerId}:${m.apiName}`, label: `${m.displayName} · ${m.providerName}` }))}
            />
            {models.length === 0 && (
              <p className="hint mt-1.5">
                No active models. <Link className="text-accent hover:underline" to="/settings?tab=models">Pull your provider's models →</Link>
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Max agent steps per turn: {form.agentMaxSteps}</label>
              <input
                type="range"
                min={5}
                max={50}
                value={form.agentMaxSteps}
                onChange={(e) => setForm({ ...form, agentMaxSteps: Number(e.target.value) })}
                className="w-full accent-indigo-400"
              />
            </div>
            <div>
              <label className="label">Temperature: {form.agentTemperature}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={form.agentTemperature}
                onChange={(e) => setForm({ ...form, agentTemperature: Number(e.target.value) })}
                className="w-full accent-indigo-400"
              />
            </div>
          </div>
          <div>
            <label className="label">MCP tool consent</label>
            <Select
              value={form.mcpConsentMode}
              onChange={(v) => setForm({ ...form, mcpConsentMode: v as any })}
              options={[
                { value: "auto", label: "Auto — read-only tools run freely, others ask (recommended)" },
                { value: "always_ask", label: "Strict — always ask before MCP tool calls" },
                { value: "always_allow", label: "Permissive — never ask (not recommended)" },
              ]}
            />
            <p className="hint mt-1.5">Implements the Dyad consent policy: reads and sandbox-scoped actions auto-approve; anything that sends data, mutates external state, or deletes asks first.</p>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <Spinner size={14} /> : <Save size={14} />} Save changes
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Providers
// ============================================================================

function ProvidersTab() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = () => api.get<{ providers: Provider[] }>("/api/providers").then((r) => setProviders(r.providers));
  useEffect(() => {
    load().catch((e) => toast("error", e.message));
  }, []);

  const test = async (p: Provider) => {
    setTesting(p.id);
    try {
      const res = await api.post<{ ok: boolean; modelCount?: number; error?: string }>(`/api/providers/${p.id}/test`);
      if (res.ok) toast("success", `Connection OK — ${res.modelCount} models visible`);
      else toast("error", res.error ?? "Connection failed");
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="card-title">Model providers</h2>
          <p className="hint mt-1">Connect any OpenAI-compatible or Anthropic-compatible API. Bring the base URL and key; we pull the model list for you.</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add provider
        </button>
      </div>

      {!providers && <Spinner className="mt-6 text-ink-faint" />}
      {providers?.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong p-8 text-center">
          <Server size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 text-sm font-medium">No providers yet</p>
          <p className="hint mt-1">Add an OpenAI-compatible or Anthropic-compatible endpoint to get started.</p>
        </div>
      )}
      {providers?.map((p) => (
        <div key={p.id} className="panel p-4">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="badge border-line bg-surface-3 text-ink-mute">{p.format}</span>
                {p.hasKey ? (
                  <span className="badge border-ok/30 bg-ok/10 text-ok"><Check size={10} /> key set</span>
                ) : (
                  <span className="badge border-warn/40 bg-warn/10 text-warn"><TriangleAlert size={10} /> no key</span>
                )}
              </div>
              <div className="mt-1 font-mono text-xs text-ink-mute">{p.baseUrl}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="btn-secondary btn-sm" disabled={testing === p.id} onClick={() => test(p)}>
                {testing === p.id ? <Spinner size={11} /> : <RefreshCw size={11} />} Test
              </button>
              <EditProviderButton provider={p} onSaved={load} />
              <button
                className="btn-danger btn-sm"
                onClick={async () => {
                  if (!confirm(`Delete provider "${p.name}" and its models?`)) return;
                  await api.del(`/api/providers/${p.id}`);
                  toast("success", "Provider deleted");
                  load();
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        </div>
      ))}

      <AddProviderDialog open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />
    </div>
  );
}

function AddProviderDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"openai" | "anthropic">("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/api/providers", { name, format, baseUrl, apiKey });
      toast("success", "Provider added");
      setName(""); setBaseUrl(""); setApiKey("");
      onCreated();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add model provider" description="OpenAI-compatible (chat/completions) or Anthropic-compatible (messages) endpoint.">
      <div className="space-y-4">
        <div>
          <label className="label">Display name</label>
          <input className="input" placeholder="My gateway" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">API format</label>
          <Select
            value={format}
            onChange={(v) => setFormat(v as any)}
            options={[
              { value: "openai", label: "OpenAI-compatible (/v1/chat/completions)" },
              { value: "anthropic", label: "Anthropic-compatible (/v1/messages)" },
            ]}
          />
        </div>
        <div>
          <label className="label">API base URL</label>
          <input className="input font-mono text-xs" placeholder="https://your-gateway.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <p className="hint mt-1">/v1 is appended automatically if missing.</p>
        </div>
        <div>
          <label className="label">API key</label>
          <input className="input font-mono text-xs" type="password" placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={!name || !baseUrl || busy}>
            {busy && <Spinner size={13} />} Add provider
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function EditProviderButton({ provider, onSaved }: { provider: Provider; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button className="btn-secondary btn-sm" onClick={() => setOpen(true)}>Edit</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Edit ${provider.name}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Display name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">API base URL</label>
            <input className="input font-mono text-xs" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div>
            <label className="label">API key</label>
            <input className="input font-mono text-xs" type="password" placeholder={provider.hasKey ? "(unchanged)" : "sk-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.put(`/api/providers/${provider.id}`, { name, baseUrl, apiKey: apiKey || undefined });
                  toast("success", "Provider updated");
                  setOpen(false);
                  onSaved();
                } catch (e: any) {
                  toast("error", e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner size={13} />} Save
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

// ============================================================================
// Models
// ============================================================================

function ModelsTab() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api.get<{ providers: Provider[] }>("/api/providers"),
      api.get<{ models: ModelRow[]; defaultModel: string | null }>("/api/models"),
    ]).then(([p, m]) => {
      setProviders(p.providers);
      setModels(m.models);
      setDefaultModel(m.defaultModel);
    });

  useEffect(() => {
    load().catch((e) => toast("error", e.message));
  }, []);

  const pull = async (p: Provider) => {
    setPulling(p.id);
    try {
      const res = await api.post<{ count: number }>(`/api/providers/${p.id}/pull-models`);
      toast("success", `${res.count} models pulled from ${p.name}`);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setPulling(null);
    }
  };

  const setEnabled = async (m: ModelRow, enabled: boolean) => {
    setModels((list) => list.map((x) => (x.providerId === m.providerId && x.apiName === m.apiName ? { ...x, enabled } : x)));
    try {
      await api.put(`/api/models/${m.providerId}/${encodeURIComponent(m.apiName)}/enabled`, { enabled });
    } catch (e: any) {
      toast("error", e.message);
      load();
    }
  };

  const setDefault = async (ref: string) => {
    setDefaultModel(ref);
    await api.put("/api/models/default", { defaultModel: ref }).catch((e) => toast("error", e.message));
    toast("success", "Default model updated");
  };

  const byProvider = useMemo(() => {
    const map = new Map<string, ModelRow[]>();
    for (const m of models) {
      if (!map.has(m.providerId)) map.set(m.providerId, []);
      map.get(m.providerId)!.push(m);
    }
    return map;
  }, [models]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="card-title">Models</h2>
        <p className="hint mt-1">
          Pull each provider's model list, activate the ones the agent may use, then pick them in the builder. Only activated models appear in the model picker.
        </p>
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong p-8 text-center">
          <Cpu size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 text-sm font-medium">Add a provider first</p>
          <Link to="/settings?tab=providers" className="btn-primary btn-sm mt-3 inline-flex">Go to Providers</Link>
        </div>
      )}

      {providers.map((p) => {
        const list = (byProvider.get(p.id) ?? []).sort((a, b) => a.apiName.localeCompare(b.apiName));
        return (
          <div key={p.id} className="panel p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="badge border-line bg-surface-3 text-ink-mute">{p.format}</span>
                <span className="text-2xs text-ink-faint">{list.length} models</span>
              </div>
              <button className="btn-secondary btn-sm" disabled={pulling === p.id || !p.hasKey} onClick={() => pull(p)} title={p.hasKey ? "Fetch model list from the API" : "Set an API key first"}>
                {pulling === p.id ? <Spinner size={11} /> : <RefreshCw size={11} />} Pull models
              </button>
            </div>
            {list.length === 0 ? (
              <p className="hint mt-3">No models pulled yet — click "Pull models" to fetch the list from the provider.</p>
            ) : (
              <div className="mt-3 max-h-72 space-y-0.5 overflow-y-auto pr-1">
                {list.map((m) => {
                  const ref = `${m.providerId}:${m.apiName}`;
                  return (
                    <div key={ref} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-3">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <Switch checked={m.enabled} onChange={(v) => setEnabled(m, v)} />
                        <span className="truncate text-xs text-ink-dim">{m.displayName}</span>
                        <span className="hidden font-mono text-2xs text-ink-faint sm:inline">{m.apiName}</span>
                      </label>
                      {defaultModel === ref ? (
                        <span className="badge border-accent/40 bg-accent-soft text-accent"><Star size={10} /> default</span>
                      ) : (
                        m.enabled && (
                          <button className="text-2xs text-ink-faint hover:text-accent" onClick={() => setDefault(ref)}>
                            set default
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Sandbox (E2B)
// ============================================================================

function SandboxTab() {
  const { settings, loadSettings } = useAppStore();
  const [apiKey, setApiKey] = useState("");
  const [domain, setDomain] = useState("");
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings) {
      setDomain(settings.e2bDomain ?? "");
      setTimeoutMinutes(settings.e2bTimeoutMinutes ?? 30);
    }
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { e2bDomain: domain, e2bTimeoutMinutes: timeoutMinutes };
      if (apiKey.trim()) body.e2bApiKey = apiKey.trim();
      await api.put("/api/settings", body);
      await loadSettings();
      setApiKey("");
      toast("success", "Sandbox settings saved");
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const testKey = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>("/api/e2b/test");
      if (res.ok) toast("success", "E2B connection OK");
      else toast("error", res.error ?? "E2B connection failed");
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setTesting(false);
    }
  };

  if (!settings) return <Spinner className="mt-8 text-ink-faint" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="card-title">E2B cloud sandboxes</h2>
        <p className="hint mt-1">
          Every app runs in an isolated E2B microVM: npm, dev server, preview URL, agent commands. Use your own E2B API key (get one free at e2b.dev).
        </p>
      </div>

      <section className="panel p-5">
        <div className="grid max-w-lg gap-4">
          <div>
            <label className="label">E2B API key</label>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type="password"
                placeholder={settings.hasE2BKey ? `Saved: ${settings.e2bApiKey}` : "e2b_..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button className="btn-secondary shrink-0" disabled={testing || (!settings.hasE2BKey && !apiKey)} onClick={testKey}>
                {testing ? <Spinner size={13} /> : <KeyRound size={13} />} Test
              </button>
            </div>
            <p className="hint mt-1.5">Stored server-side, scoped to your workspace, and used to provision sandboxes for your apps.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Sandbox timeout (minutes)</label>
              <input className="input" type="number" min={5} max={60} value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(Number(e.target.value))} />
              <p className="hint mt-1">Idle sandboxes are kept alive while you work, then expire.</p>
            </div>
            <div>
              <label className="label">E2B domain (optional)</label>
              <input className="input font-mono text-xs" placeholder="e2b.app" value={domain} onChange={(e) => setDomain(e.target.value)} />
              <p className="hint mt-1">For self-hosted E2B deployments.</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner size={14} /> : <Save size={14} />} Save sandbox settings
          </button>
        </div>
      </section>

      <section className="panel p-5">
        <h3 className="card-title">How sandboxing works</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs text-ink-mute leading-relaxed">
          <li>Creating an app provisions a fresh sandbox with the React + shadcn/ui scaffold.</li>
          <li>Your selected skills are written to <code className="font-mono">/home/user/skills/</code> and MCP servers start behind the in-sandbox MCP bridge.</li>
          <li>The agent edits files, runs commands and installs packages inside the sandbox only.</li>
          <li>The dev server is exposed on a public sandbox URL and embedded as the live preview.</li>
          <li>Every file change is snapshotted so a sandbox can be recreated after expiry.</li>
        </ol>
      </section>
    </div>
  );
}

// ============================================================================
// Billing
// ============================================================================

function BillingTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="card-title">Billing</h2>
        <p className="hint mt-1">This MVP runs on bring-your-own keys: you pay your model provider and E2B directly. Managed plans are on the roadmap.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          {
            name: "Free",
            price: "$0",
            tag: "Current plan",
            features: ["Unlimited workspaces", "Bring your own model keys", "E2B sandboxes on your key", "MCP + skills catalog"],
            highlight: false,
          },
          {
            name: "Pro",
            price: "$20/mo",
            tag: "Roadmap",
            features: ["Everything in Free", "Hosted model credits", "Longer sandbox retention", "Priority support"],
            highlight: true,
          },
          {
            name: "Team",
            price: "$49/user/mo",
            tag: "Roadmap",
            features: ["Everything in Pro", "Shared skills library", "Team MCP registry", "SSO & audit log"],
            highlight: false,
          },
        ].map((p) => (
          <div key={p.name} className={`panel p-5 ${p.highlight ? "border-accent/50" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{p.name}</span>
              <span className={`badge ${p.highlight ? "border-accent/40 text-accent" : "border-line bg-surface-3 text-ink-faint"}`}>{p.tag}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{p.price}</div>
            <ul className="mt-3 space-y-1.5">
              {p.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-ink-mute">
                  <Check size={12} className="text-ok" /> {f}
                </li>
              ))}
            </ul>
            <button className={`mt-4 w-full ${p.highlight ? "btn-primary" : "btn-secondary"}`} disabled>
              {p.tag === "Current plan" ? "Active" : "Coming soon"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
