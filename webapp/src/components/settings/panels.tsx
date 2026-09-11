"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Plug,
  KeyRound,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  Download,
  GraduationCap,
  Pencil,
} from "lucide-react";
import {
  Badge,
  Dialog,
  Spinner,
  Switch,
  ToastProvider,
  useToast,
} from "@/components/ui";
import {
  api,
  type ActiveModel,
  type McpCatalogEntry,
  type McpServerRow,
  type ProviderRow,
  type SkillRow,
} from "@/lib/types";

/* ================================================================== */
/* Providers                                                           */
/* ================================================================== */

export function ProvidersPanel() {
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const [form, setForm] = useState({
    name: "",
    type: "openai-compatible" as "openai-compatible" | "anthropic-compatible" | "demo",
    baseUrl: "",
    apiKey: "",
  });

  const load = useCallback(() => {
    api<{ providers: ProviderRow[] }>("/api/providers").then((r) => setProviders(r.providers));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await api("/api/providers", { method: "POST", body: JSON.stringify(form) });
      setAddOpen(false);
      setForm({ name: "", type: "openai-compatible", baseUrl: "", apiKey: "" });
      load();
      push({ title: "Provider added" });
    } catch (err) {
      push({ title: "Failed", description: String(err), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, name: string) => {
    if (!confirm(`Remove provider "${name}"? Its models will be removed too.`)) return;
    await api(`/api/providers?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">LLM Providers</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Connect any OpenAI-compatible or Anthropic-compatible endpoint. Keys stay in your
            workspace database.
          </p>
        </div>
        <button className="btn-primary btn-md" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add provider
        </button>
      </div>

      {providers === null ? (
        <div className="flex h-24 items-center justify-center text-zinc-600"><Spinner /></div>
      ) : providers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
          No providers yet — add one to start building.
        </p>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onChanged={load} onDelete={() => remove(p.id, p.name)} />
          ))}
        </div>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add provider">
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              placeholder="My gateway"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">API format</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
            >
              <option value="openai-compatible">OpenAI-compatible (/v1/chat/completions)</option>
              <option value="anthropic-compatible">Anthropic-compatible (/v1/messages)</option>
              <option value="demo">Offline demo (no network)</option>
            </select>
          </div>
          {form.type !== "demo" ? (
            <>
              <div>
                <label className="label">API base URL</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="https://your-endpoint.example.com"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
                <p className="mt-1 text-2xs text-zinc-600">
                  Both dialects are supported on the same base URL. A /v1 suffix is added
                  automatically when missing.
                </p>
              </div>
              <div>
                <label className="label">API key</label>
                <input
                  className="input font-mono text-xs"
                  type="password"
                  placeholder="(leave empty if the endpoint needs none)"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>
            </>
          ) : null}
          <div className="flex justify-end pt-1">
            <button className="btn-primary btn-md" onClick={create} disabled={busy || !form.name || (form.type !== "demo" && !form.baseUrl)}>
              {busy ? <Spinner /> : <Plus className="h-4 w-4" />} Add provider
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ProviderCard({
  provider,
  onChanged,
  onDelete,
}: {
  provider: ProviderRow;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [pulling, setPulling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(provider.models.filter((m) => m.active).map((m) => m.modelId)),
  );
  const { push } = useToast();

  const pullModels = async () => {
    setPulling(true);
    try {
      const res = await api<{ fetched: number }>(`/api/providers?id=${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "pull-models" }),
      });
      push({ title: `Pulled ${res.fetched} models`, description: "Select the ones to activate below." });
      onChanged();
    } catch (err) {
      push({ title: "Model pull failed", description: String(err), variant: "error" });
    } finally {
      setPulling(false);
    }
  };

  const saveActivation = async () => {
    setSaving(true);
    try {
      await api(`/api/providers?id=${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "set-models", modelIds: [...selected] }),
      });
      push({ title: "Model selection saved" });
      onChanged();
    } catch (err) {
      push({ title: "Failed", description: String(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (modelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-100">{provider.name}</h3>
            <Badge variant={provider.type === "demo" ? "warn" : "accent"}>
              {provider.type === "demo" ? "offline demo" : provider.type.replace("-compatible", "")}
            </Badge>
            {provider.isDefault ? <Badge variant="ok">default</Badge> : null}
          </div>
          <p className="mt-1 truncate font-mono text-2xs text-zinc-500">{provider.baseUrl}</p>
          <p className="mt-0.5 flex items-center gap-1 text-2xs text-zinc-600">
            <KeyRound className="h-3 w-3" />
            {provider.hasApiKey ? `key ${provider.apiKeyMasked}` : "no key"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button className="btn-secondary btn-sm" onClick={pullModels} disabled={pulling}>
            {pulling ? <Spinner className="h-3 w-3" /> : <Download className="h-3 w-3" />} Pull models
          </button>
          <button className="btn-ghost btn-sm" onClick={onDelete} title="Remove provider">
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </button>
        </div>
      </div>

      {provider.models.length > 0 ? (
        <div className="mt-3 border-t border-zinc-800/70 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-2xs text-zinc-500">
              {provider.models.length} models discovered · {selected.size} selected for the builder
            </p>
            <button className="btn-secondary btn-sm" onClick={saveActivation} disabled={saving}>
              {saving ? <Spinner className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />} Save selection
            </button>
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {provider.models.map((m) => (
              <label
                key={m.modelId}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5 hover:border-zinc-700"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-500"
                  checked={selected.has(m.modelId)}
                  onChange={() => toggle(m.modelId)}
                />
                <span className="truncate font-mono text-2xs text-zinc-300">{m.modelId}</span>
                {m.displayName && m.displayName !== m.modelId ? (
                  <span className="ml-auto truncate text-2xs text-zinc-600">{m.displayName}</span>
                ) : null}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-zinc-800/70 pt-3 text-2xs text-zinc-600">
          No models pulled yet — click <span className="text-zinc-400">Pull models</span> to fetch the
          model list from this endpoint, then activate the ones you want in the builder.
        </p>
      )}
    </div>
  );
}

/* ================================================================== */
/* Sandbox (E2B)                                                       */
/* ================================================================== */

export function SandboxPanel() {
  const [e2bKey, setE2bKey] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [template, setTemplate] = useState("");
  const [runner, setRunner] = useState<"e2b" | "local">("e2b");
  const [showKey, setShowKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saveKey, setSaveKey] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    api<{
      e2bApiKeyMasked: string | null;
      e2bConfigured: boolean;
      e2bTemplate: string;
      runner: "e2b" | "local";
    }>("/api/settings").then((s) => {
      setMasked(s.e2bApiKeyMasked);
      setConfigured(s.e2bConfigured);
      setTemplate(s.e2bTemplate);
      setRunner(s.runner);
    });
  }, []);

  const save = async (verify: boolean) => {
    setVerifying(true);
    try {
      const res = await api<{ ok: boolean; error?: string; message?: string }>(
        "/api/settings/e2b/verify",
        { method: "POST", body: JSON.stringify({ apiKey: e2bKey || undefined }) },
      );
      if (!res.ok) throw new Error(res.error || "Verification failed");
      setE2bKey("");
      setSaveKey(false);
      push({ title: verify ? "E2B key verified" : "Saved", description: res.message });
      const s = await api<{ e2bApiKeyMasked: string | null; e2bConfigured: boolean }>("/api/settings");
      setMasked(s.e2bApiKeyMasked);
      setConfigured(s.e2bConfigured);
    } catch (err) {
      push({
        title: "E2B verification failed",
        description:
          err instanceof Error ? err.message : String(err) +
          (String(err).includes("fetch") ? " — if this sandbox blocks outbound HTTPS, verify from your deployment." : ""),
        variant: "error",
      });
    } finally {
      setVerifying(false);
    }
  };

  const updateSetting = async (patch: Record<string, unknown>) => {
    await api("/api/settings", { method: "POST", body: JSON.stringify(patch) });
    push({ title: "Setting saved" });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Cloud Sandbox (E2B)</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Apps build and run inside your own E2B sandboxes. Get a key at
          <a className="ml-1 text-indigo-300 underline" href="https://e2b.dev/dashboard" target="_blank" rel="noreferrer">
            e2b.dev/dashboard
          </a>
          .
        </p>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-medium text-zinc-100">E2B API key</h3>
          </div>
          <Badge variant={configured ? "ok" : "warn"}>{configured ? "configured" : "not set"}</Badge>
        </div>
        {masked ? (
          <p className="mt-2 font-mono text-xs text-zinc-500">{masked}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <input
              className="input pr-16 font-mono text-xs"
              type={showKey ? "text" : "password"}
              placeholder={masked ? "Replace stored key…" : "e2b_…"}
              value={e2bKey}
              onChange={(e) => {
                setE2bKey(e.target.value);
                setSaveKey(true);
              }}
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-300"
              onClick={() => setShowKey((v) => !v)}
              type="button"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button className="btn-primary btn-md" onClick={() => save(true)} disabled={verifying || (!e2bKey && !configured)}>
            {verifying ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Verify & save
          </button>
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-zinc-600">
          Verification lists your sandboxes through the E2B API. If your network blocks outbound
          HTTPS to api.e2b.app you can still paste and save the key — it is used when sandboxes are
          created.
        </p>
      </div>

      <div className="card space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-medium text-zinc-100">Runner</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { id: "e2b", title: "E2B Cloud", desc: "Isolated cloud microVMs. Recommended." },
              { id: "local", title: "Local processes", desc: "Self-hosted fallback; runs apps as child processes." },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setRunner(r.id);
                void updateSetting({ runner: r.id });
              }}
              className={`rounded-xl border p-3 text-left transition-colors ${
                runner === r.id
                  ? "border-indigo-500/60 bg-indigo-500/10"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
              }`}
            >
              <p className="text-sm font-medium text-zinc-100">{r.title}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-zinc-500">{r.desc}</p>
            </button>
          ))}
        </div>
        <div>
          <label className="label">E2B template (optional)</label>
          <input
            className="input font-mono text-xs"
            placeholder="(default E2B image)"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            onBlur={() => void updateSetting({ e2bTemplate: template })}
          />
          <p className="mt-1 text-2xs text-zinc-600">
            Advanced: use a custom E2B template with preinstalled tooling.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Models (active set)                                                 */
/* ================================================================== */

export function ModelsPanel() {
  const [models, setModels] = useState<ActiveModel[] | null>(null);
  const [defaultKey, setDefaultKey] = useState<string | null>(null);
  const { push } = useToast();

  const load = useCallback(() => {
    api<{ models: ActiveModel[] }>("/api/models").then((r) => setModels(r.models));
    api<{ defaultModelKey: string | null }>("/api/settings").then((r) => setDefaultKey(r.defaultModelKey));
  }, []);
  useEffect(load, [load]);

  const makeDefault = async (m: ActiveModel) => {
    const key = `${m.providerId}:${m.modelId}`;
    await api("/api/models", {
      method: "POST",
      body: JSON.stringify({ providerId: m.providerId, modelId: m.modelId, active: true, makeDefault: true }),
    });
    setDefaultKey(key);
    push({ title: "Default model updated", description: key });
  };

  const deactivate = async (m: ActiveModel) => {
    await api("/api/models", {
      method: "POST",
      body: JSON.stringify({ providerId: m.providerId, modelId: m.modelId, active: false }),
    });
    load();
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Active models</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Models activated across your providers appear in the builder&apos;s model picker. Activate
          models from Settings → Providers → Pull models.
        </p>
      </div>
      {models === null ? (
        <div className="flex h-24 items-center justify-center text-zinc-600"><Spinner /></div>
      ) : models.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
          No active models. Pull a provider&apos;s model list and activate some.
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((m) => {
            const key = `${m.providerId}:${m.modelId}`;
            return (
              <div key={key} className="card flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-zinc-200">{m.modelId}</p>
                  <p className="text-2xs text-zinc-500">{m.providerName}</p>
                </div>
                {defaultKey === key ? (
                  <Badge variant="ok">default</Badge>
                ) : (
                  <button className="btn-ghost btn-sm" onClick={() => makeDefault(m)}>
                    Set default
                  </button>
                )}
                <button className="btn-ghost btn-sm" onClick={() => deactivate(m)} title="Deactivate">
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* MCP servers                                                         */
/* ================================================================== */

export function McpPanel() {
  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { push } = useToast();

  const [form, setForm] = useState({
    name: "",
    description: "",
    transport: "http" as "http" | "sse" | "stdio",
    url: "",
    command: "",
    args: "",
    env: "",
    headers: "",
  });

  const load = useCallback(() => {
    api<{ servers: McpServerRow[]; catalog: McpCatalogEntry[] }>("/api/mcp").then((r) => {
      setServers(r.servers);
      setCatalog(r.catalog);
    });
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    const parseJson = (v: string) => {
      if (!v.trim()) return undefined;
      return JSON.parse(v);
    };
    try {
      await api("/api/mcp", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          transport: form.transport,
          url: form.transport !== "stdio" ? form.url : undefined,
          command: form.transport === "stdio" ? form.command : undefined,
          args: form.transport === "stdio" ? form.args.split(/\s+/).filter(Boolean) : undefined,
          env: parseJson(form.env),
          headers: parseJson(form.headers),
          test: true,
        }),
      });
      setAddOpen(false);
      setForm({ name: "", description: "", transport: "http", url: "", command: "", args: "", env: "", headers: "" });
      load();
      push({ title: "MCP server added" });
    } catch (err) {
      push({ title: "Failed to add server", description: String(err), variant: "error" });
    }
  };

  const installFromCatalog = async (name: string) => {
    setInstalling(name);
    try {
      await api("/api/mcp", {
        method: "POST",
        body: JSON.stringify({ installFromCatalog: name }),
      });
      push({ title: `${name} installed`, description: "Test the connection to list its tools." });
      load();
    } catch (err) {
      push({ title: `Could not install ${name}`, description: String(err), variant: "error" });
    } finally {
      setInstalling(null);
    }
  };

  const test = async (id: number, name: string) => {
    setTesting(id);
    try {
      const res = await api<{ ok: boolean; error?: string; tools: { name: string }[] }>(
        `/api/mcp?id=${id}&op=test`,
        { method: "PUT" },
      );
      if (res.ok) {
        push({
          title: `${name} connected`,
          description: `${res.tools.length} tools available`,
        });
      } else {
        throw new Error(res.error || "connection failed");
      }
      load();
    } catch (err) {
      push({ title: `${name} connection failed`, description: String(err), variant: "error" });
    } finally {
      setTesting(null);
    }
  };

  const toggle = async (s: McpServerRow) => {
    await api(`/api/mcp?id=${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) });
    load();
  };

  const remove = async (s: McpServerRow) => {
    if (!confirm(`Remove MCP server "${s.name}"?`)) return;
    await api(`/api/mcp?id=${s.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">MCP servers</h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-zinc-500">
            Model Context Protocol servers expose tools the agent can call in every app. Install
            from the catalog or add any HTTP/SSE endpoint.
          </p>
        </div>
        <button className="btn-primary btn-md" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add server
        </button>
      </div>

      {servers !== null && servers.length > 0 ? (
        <div className="space-y-2">
          {servers.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      s.lastStatus === "connected"
                        ? "bg-emerald-400"
                        : s.lastStatus === "error"
                          ? "bg-red-400"
                          : "bg-zinc-600"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-100">{s.name}</h3>
                      <Badge>{s.transport}</Badge>
                      <Badge variant="outline">{s.scope}</Badge>
                      {s.tools.length > 0 ? (
                        <Badge variant="accent">{s.tools.length} tools</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-zinc-500">
                      {s.description}
                    </p>
                    {s.lastError ? (
                      <p className="mt-1 line-clamp-1 text-2xs text-red-400">{s.lastError}</p>
                    ) : null}
                    {s.tools.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.tools.slice(0, 8).map((t) => (
                          <span
                            key={t.name}
                            className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                          >
                            {t.name}
                          </span>
                        ))}
                        {s.tools.length > 8 ? (
                          <span className="text-[10px] text-zinc-600">+{s.tools.length - 8} more</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch checked={s.enabled} onChange={() => toggle(s)} />
                  <button className="btn-secondary btn-sm" onClick={() => test(s.id, s.name)} disabled={testing === s.id}>
                    {testing === s.id ? <Spinner className="h-3 w-3" /> : <Plug className="h-3 w-3" />} Test
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => remove(s)} title="Remove">
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-100">Catalog</h3>
        <p className="mb-3 text-2xs text-zinc-600">
          One-click install presets. Remote (HTTP/SSE) servers work everywhere; stdio presets run as
          local processes on the Dyad Cloud server (self-hosted setups).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalog.map((c) => {
            const installed = servers?.some((s) => s.name === c.name);
            return (
              <div key={c.name} className="card flex items-start gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-100">{c.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-zinc-500">
                    {c.description}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge variant="outline">{c.transport}</Badge>
                    {c.docsUrl ? (
                      <a href={c.docsUrl} target="_blank" rel="noreferrer" className="text-2xs text-indigo-300 hover:underline">
                        docs
                      </a>
                    ) : null}
                  </div>
                </div>
                {installed ? (
                  <Badge variant="ok">
                    <CheckCircle2 className="h-3 w-3" /> installed
                  </Badge>
                ) : (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => installFromCatalog(c.name)}
                    disabled={installing === c.name}
                  >
                    {installing === c.name ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    Install
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add MCP server" wide>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-server" />
            </div>
            <div>
              <label className="label">Transport</label>
              <select className="input" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as typeof form.transport })}>
                <option value="http">HTTP (streamable)</option>
                <option value="sse">SSE</option>
                <option value="stdio">stdio (local process)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What tools does it provide?" />
          </div>
          {form.transport !== "stdio" ? (
            <div>
              <label className="label">Server URL</label>
              <input className="input font-mono text-xs" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Command</label>
                <input className="input font-mono text-xs" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx" />
              </div>
              <div>
                <label className="label">Arguments (space separated)</label>
                <input className="input font-mono text-xs" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="-y @modelcontextprotocol/server-memory" />
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Headers (JSON, optional)</label>
              <textarea className="textarea min-h-[64px] font-mono text-xs" value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} placeholder='{"Authorization": "Bearer …"}' />
            </div>
            <div>
              <label className="label">Env (JSON, optional)</label>
              <textarea className="textarea min-h-[64px] font-mono text-xs" value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} placeholder='{"DATABASE_URL": "…"}' />
            </div>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary btn-md" onClick={create} disabled={!form.name}>
              <Plus className="h-4 w-4" /> Add & test
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/* ================================================================== */
/* Skills                                                              */
/* ================================================================== */

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<SkillRow | null>(null);
  const [form, setForm] = useState({ name: "", description: "", instructions: "" });
  const { push } = useToast();

  const load = useCallback(() => {
    api<{ skills: SkillRow[] }>("/api/skills").then((r) => setSkills(r.skills));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    try {
      await api("/api/skills", { method: "POST", body: JSON.stringify(form) });
      setCreateOpen(false);
      setForm({ name: "", description: "", instructions: "" });
      load();
      push({ title: "Skill created", description: "It is now available to every app sandbox." });
    } catch (err) {
      push({ title: "Failed", description: String(err), variant: "error" });
    }
  };

  const toggle = async (s: SkillRow) => {
    await api(`/api/skills?id=${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) });
    load();
  };

  const remove = async (s: SkillRow) => {
    if (!confirm(`Delete skill "${s.name}"?`)) return;
    try {
      await api(`/api/skills?id=${s.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      push({ title: "Cannot delete", description: String(err), variant: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Skills</h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-zinc-500">
            Skills are reusable instruction modules (SKILL.md). Enabled skills are injected into the
            agent&apos;s context and materialized inside every sandbox at
            <span className="mx-1 font-mono text-zinc-400">/home/user/skills/</span>
            so both the agent and the app code can use them.
          </p>
        </div>
        <button className="btn-primary btn-md" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New skill
        </button>
      </div>

      {skills === null ? (
        <div className="flex h-24 items-center justify-center text-zinc-600"><Spinner /></div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {skills.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-zinc-100">{s.name}</h3>
                      <Badge variant={s.source === "gallery" ? "outline" : "accent"}>{s.source}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-zinc-500">
                      {s.description}
                    </p>
                  </div>
                </div>
                <Switch checked={s.enabled} onChange={() => toggle(s)} />
              </div>
              <div className="mt-3 flex items-center gap-1 border-t border-zinc-800/70 pt-2.5">
                <button className="btn-ghost btn-sm" onClick={() => setViewing(s)}>
                  <Eye className="h-3 w-3" /> View
                </button>
                {s.source === "custom" ? (
                  <button className="btn-ghost btn-sm" onClick={() => remove(s)}>
                    <Trash2 className="h-3 w-3 text-red-400" /> Delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create skill" wide>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Description (when should the agent use it?)</label>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Instructions (markdown, SKILL.md body)</label>
            <textarea
              className="textarea min-h-[220px] font-mono text-xs"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              placeholder="# My Skill

When the user asks for X, follow these principles: …"
            />
          </div>
          <div className="flex justify-end">
            <button className="btn-primary btn-md" onClick={create} disabled={!form.name || !form.description || !form.instructions}>
              <CheckCircle2 className="h-4 w-4" /> Create skill
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.name ?? ""} wide>
        <p className="mb-3 text-xs text-zinc-400">{viewing?.description}</p>
        <pre className="max-h-[420px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-2xs leading-relaxed text-zinc-300">
          {viewing?.instructions}
        </pre>
      </Dialog>
    </div>
  );
}

/* ================================================================== */
/* General                                                             */
/* ================================================================== */

export function GeneralPanel() {
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [stats, setStats] = useState<{ apps: number; runner: string } | null>(null);
  useEffect(() => {
    api<{ passwordProtected: boolean }>("/api/settings").then((s) => setPasswordProtected(s.passwordProtected));
    api<{ apps: unknown[]; runner: string }>("/api/apps").then((r) => setStats({ apps: r.apps.length, runner: r.runner }));
  }, []);
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">General</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Workspace overview and security.</p>
      </div>
      <div className="card p-4">
        <h3 className="text-sm font-medium text-zinc-100">Workspace</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
            <dt className="text-zinc-500">Apps</dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-100">{stats?.apps ?? "—"}</dd>
          </div>
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
            <dt className="text-zinc-500">Default runner</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-lg font-semibold capitalize text-zinc-100">
              <Cloud className="h-4 w-4 text-indigo-400" /> {stats?.runner ?? "—"}
            </dd>
          </div>
        </dl>
      </div>
      <div className="card p-4">
        <h3 className="text-sm font-medium text-zinc-100">Security</h3>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          {passwordProtected
            ? "This workspace is protected by a workspace password (WORKSPACE_PASSWORD env var)."
            : "No workspace password is set. For cloud deployments, set the WORKSPACE_PASSWORD environment variable to require sign-in."}
        </p>
      </div>
      <div className="card p-4">
        <h3 className="text-sm font-medium text-zinc-100">About</h3>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Dyad Cloud is a web-based SaaS distribution of the open-source
          <a className="mx-1 text-indigo-300 underline" href="https://github.com/dyad-sh/dyad" target="_blank" rel="noreferrer">Dyad</a>
          AI app builder. The agent prompts and the dyad-tag build protocol are ported verbatim from
          the upstream project; execution has moved from Electron/local processes to E2B cloud
          sandboxes.
        </p>
      </div>
    </div>
  );
}
