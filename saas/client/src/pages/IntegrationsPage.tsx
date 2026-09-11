import React from "react";
import { Plus, Trash2, Plug2, RefreshCw, Wrench, ChevronDown, ChevronRight, Play } from "lucide-react";
import { api } from "../lib/api";
import { useData, useToast } from "../state/store";
import { Button, Card, CardHead, Field, Input, Select, Badge, Modal, Tabs, Textarea, Switch, EmptyState, Spinner, StatusDot } from "../components/ui";

export function IntegrationsPage() {
  const [tab, setTab] = React.useState<"installed" | "catalog">("installed");
  const { mcps } = useData();
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight">MCP Integrations</h1>
      <p className="mb-4 mt-0.5 text-[13px] text-zinc-500">
        Connect Model Context Protocol servers. Their tools become available to the agent in every sandbox.
      </p>
      <Tabs
        tabs={[
          { id: "installed", label: "Installed", count: mcps?.servers.length ?? 0 },
          { id: "catalog", label: "Catalog" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="mt-4">{tab === "installed" ? <InstalledTab /> : <CatalogTab />}</div>
    </div>
  );
}

function statusTone(s: string): "green" | "red" | "amber" | "zinc" {
  if (s === "connected") return "green";
  if (s === "error") return "red";
  if (s === "connecting") return "amber";
  return "zinc";
}

function InstalledTab() {
  const { mcps, refreshMcps } = useData();
  const toast = useToast();
  const [showNew, setShowNew] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [toolsFor, setToolsFor] = React.useState<string | null>(null);
  const [tools, setTools] = React.useState<any[]>([]);
  const [toolsLoading, setToolsLoading] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [callArgs, setCallArgs] = React.useState("{}");
  const [callResult, setCallResult] = React.useState("");

  const servers = mcps?.servers || [];

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await api.put(`/api/mcps/${id}`, { enabled });
      await refreshMcps();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove MCP server "${name}"?`)) return;
    try {
      await api.del(`/api/mcps/${id}`);
      await refreshMcps();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const connect = async (id: string) => {
    setTesting(id);
    try {
      const d = await api.post<{ tools: any[] }>(`/api/mcps/${id}/connect`, {});
      toast(`Connected — ${d.tools.length} tools`);
      await refreshMcps();
    } catch (e: any) {
      toast(e.message, "err");
      await refreshMcps();
    } finally {
      setTesting(null);
    }
  };

  const loadTools = async (id: string) => {
    if (toolsFor === id) { setToolsFor(null); return; }
    setToolsFor(id);
    setToolsLoading(true);
    setCallResult("");
    try {
      const d = await api.get<{ tools: any[] }>(`/api/mcps/${id}/tools`);
      setTools(d.tools);
      await refreshMcps();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setToolsLoading(false);
    }
  };

  const call = async (serverId: string, tool: string) => {
    try {
      const args = JSON.parse(callArgs || "{}");
      const d = await api.post<{ result: any }>(`/api/mcps/${serverId}/call`, { tool, args });
      setCallResult(JSON.stringify(d.result, null, 2).slice(0, 4000));
    } catch (e: any) {
      setCallResult(`ERROR: ${e.message}`);
    }
  };

  if (!mcps) return <Spinner />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> Add server</Button>
      </div>
      {servers.length === 0 && (
        <EmptyState
          title="No MCP servers connected"
          desc="Install one from the Catalog, or add a custom server (stdio command, SSE, or streamable HTTP)."
        />
      )}
      {servers.map((s) => {
        const st = mcps.statuses[s.id] || { status: "disconnected" };
        const open = toolsFor === s.id;
        return (
          <Card key={s.id}>
            <div className="flex items-center gap-3 px-4 py-3">
              <Switch checked={s.enabled} onChange={(v) => toggle(s.id, v)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <Badge>{s.transport}</Badge>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                    <StatusDot tone={statusTone(st.status)} /> {st.status}
                    {st.toolCount != null && st.status === "connected" ? ` · ${st.toolCount} tools` : ""}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                  {s.transport === "stdio" ? `${s.command} ${(s.args || []).join(" ")}` : s.url}
                </div>
                {st.error && <div className="mt-0.5 truncate text-[11px] text-red-400">{st.error}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" loading={testing === s.id} onClick={() => connect(s.id)}>
                  <Plug2 size={13} /> {st.status === "connected" ? "Reconnect" : "Connect"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => loadTools(s.id)}>
                  <Wrench size={13} /> Tools {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(s.id)}>Configure</Button>
                <button onClick={() => remove(s.id, s.name)} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {open && (
              <div className="border-t border-zinc-800 px-4 py-3">
                {toolsLoading ? <Spinner /> : tools.length === 0 ? (
                  <div className="text-xs text-zinc-500">No tools exposed.</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {tools.map((t) => (
                      <div key={t.name} className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs text-zinc-100">{t.originTool}</code>
                          <button onClick={() => call(s.id, t.originTool)} className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200" title="Test-call this tool">
                            <Play size={11} /> test
                          </button>
                        </div>
                        {t.description && <div className="mt-0.5 text-[11px] text-zinc-500">{t.description}</div>}
                      </div>
                    ))}
                    <div className="mt-1">
                      <div className="mb-1 text-[11px] text-zinc-500">Test-call arguments (JSON, applies to the tool you press “test” on):</div>
                      <Textarea value={callArgs} onChange={(e) => setCallArgs(e.target.value)} rows={2} />
                      {callResult && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-black p-2 font-mono text-[11px] text-zinc-300">{callResult}</pre>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
      {(showNew || editingId) && (
        <ServerModal
          initial={servers.find((s) => s.id === editingId) || null}
          onClose={() => { setShowNew(false); setEditingId(null); }}
          onSaved={refreshMcps}
        />
      )}
    </div>
  );
}

function ServerModal({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = React.useState(initial?.name || "");
  const [transport, setTransport] = React.useState(initial?.transport || "stdio");
  const [command, setCommand] = React.useState(initial?.command || "npx");
  const [args, setArgs] = React.useState((initial?.args || []).join(" "));
  const [envText, setEnvText] = React.useState(
    initial?.env ? Object.entries(initial.env).map(([k, v]) => `${k}=${v}`).join("\n") : "",
  );
  const [url, setUrl] = React.useState(initial?.url || "");
  const [headersText, setHeadersText] = React.useState(
    initial?.headers ? Object.entries(initial.headers).map(([k, v]) => `${k}: ${v}`).join("\n") : "",
  );
  const [saving, setSaving] = React.useState(false);

  const parseEnv = () => {
    const env: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return env;
  };
  const parseHeaders = () => {
    const h: Record<string, string> = {};
    for (const line of headersText.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return h;
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: name || "Custom MCP",
        transport,
        command,
        args: args.split(/\s+/).filter(Boolean),
        env: parseEnv(),
        url,
        headers: parseHeaders(),
      };
      if (initial) await api.put(`/api/mcps/${initial.id}`, payload);
      else await api.post("/api/mcps", payload);
      await onSaved();
      onClose();
      toast("MCP server saved");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Configure MCP server" : "Add MCP server"} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub" /></Field>
          <Field label="Transport">
            <Select value={transport} onChange={(e) => setTransport(e.target.value)}>
              <option value="stdio">stdio (local command)</option>
              <option value="sse">SSE (remote URL)</option>
              <option value="http">Streamable HTTP (remote URL)</option>
            </Select>
          </Field>
        </div>
        {transport === "stdio" ? (
          <>
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <Field label="Command"><Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" /></Field>
              <Field label="Arguments (space separated)"><Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-github" /></Field>
            </div>
            <Field label="Environment variables (KEY=value per line)" hint="Secrets for the server process, e.g. GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…">
              <Textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={3} placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=…" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Server URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
            <Field label="Headers (Key: value per line)" hint="e.g. Authorization: Bearer …">
              <Textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} rows={3} placeholder="Authorization: Bearer …" />
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save server</Button>
        </div>
      </div>
    </Modal>
  );
}

function CatalogTab() {
  const { mcps, refreshMcps } = useData();
  const toast = useToast();
  const [installing, setInstalling] = React.useState<string | null>(null);
  const templates = mcps?.templates || [];

  const install = async (templateId: string, name: string) => {
    setInstalling(templateId);
    try {
      await api.post("/api/mcps/install-template", { templateId });
      await refreshMcps();
      toast(`Installed ${name} — open Installed → Configure to add credentials.`);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {templates.map((t: any) => (
        <Card key={t.templateId} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{t.description}</div>
            </div>
            <Badge>{t.transport}</Badge>
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-zinc-600">
            {t.transport === "stdio" ? `${t.command} ${(t.args || []).join(" ")}` : t.url}
          </div>
          {(t.envKeys || []).length > 0 && (
            <div className="mt-1 text-[11px] text-zinc-500">Needs: {t.envKeys.join(", ")}</div>
          )}
          <div className="mt-3">
            <Button size="sm" variant="secondary" loading={installing === t.templateId} onClick={() => install(t.templateId, t.name)}>
              <RefreshCw size={13} /> Install
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
