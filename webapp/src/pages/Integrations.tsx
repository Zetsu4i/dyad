import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "../lib/store";
import { Dialog, Select, Spinner, Tabs } from "../components/ui";
import {
  Check, Plug, Plus, Sparkles, Trash2, TriangleAlert, Wrench,
} from "lucide-react";

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

export default function Integrations() {
  const [tab, setTab] = useState("mcp");
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Integrations</h1>
          <p className="hint mt-1">
            MCP servers and skills available to your agents. Enable them per app from the builder's
            Integrations tab — everything is provisioned inside the app's sandbox.
          </p>
        </div>
        <Wrench size={18} className="text-ink-faint" />
      </div>
      <Tabs
        className="mt-5"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "mcp", label: "MCP servers" },
          { id: "skills", label: "Skills" },
        ]}
      />
      <div className="mt-5">{tab === "mcp" ? <McpSection /> : <SkillsSection />}</div>
    </div>
  );
}

// ============================================================================
// MCP
// ============================================================================

function McpSection() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const load = () =>
    api.get<{ servers: McpServer[]; catalog: CatalogEntry[] }>("/api/mcp").then((r) => {
      setServers(r.servers);
      setCatalog(r.catalog);
    });
  useEffect(() => {
    load().catch((e) => toast("error", e.message));
  }, []);

  const installFromCatalog = async (entry: CatalogEntry, env: Record<string, string>) => {
    setInstalling(entry.catalogId);
    try {
      await api.post("/api/mcp", { catalogId: entry.catalogId, env });
      toast("success", `${entry.name} added`);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setInstalling(null);
    }
  };

  const categories = useMemo(() => [...new Set(catalog.map((c) => c.category))], [catalog]);

  return (
    <div className="space-y-6">
      {servers.length > 0 && (
        <section>
          <h3 className="text-2xs font-medium uppercase tracking-wider text-ink-faint">
            Your servers · {servers.length}
          </h3>
          <div className="mt-2 space-y-2">
            {servers.map((s) => (
              <div key={s.id} className="panel flex items-center justify-between p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Plug size={14} className="text-accent" /> {s.name}
                    <span className="badge border-line bg-surface-3 text-ink-faint">{s.transport}</span>
                    {s.requiredEnvKeys && s.requiredEnvKeys.length > 0 && (!s.env || Object.keys(s.env).length === 0) && (
                      <span className="badge border-warn/40 bg-warn/10 text-warn">
                        <TriangleAlert size={10} /> needs credentials
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-mute">{s.description}</p>
                  <p className="mt-1 truncate font-mono text-2xs text-ink-faint">
                    {s.transport === "http" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <EditMcpButton server={s} onSaved={load} />
                  <button
                    className="btn-danger btn-sm"
                    onClick={async () => {
                      if (!confirm(`Remove ${s.name}? It will be disconnected from all apps.`)) return;
                      await api.del(`/api/mcp/${s.id}`);
                      toast("success", "Server removed");
                      load();
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-2xs font-medium uppercase tracking-wider text-ink-faint">Catalog</h3>
          <button className="btn-secondary btn-sm" onClick={() => setShowCustom(true)}>
            <Plus size={13} /> Custom server
          </button>
        </div>
        {categories.map((cat) => (
          <div key={cat} className="mt-4">
            <div className="mb-2 text-xs font-medium text-ink-mute">{cat}</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {catalog
                .filter((c) => c.category === cat)
                .map((entry) => {
                  const installed = servers.find((s) => s.catalogId === entry.catalogId);
                  return (
                    <CatalogCard
                      key={entry.catalogId}
                      entry={entry}
                      installed={!!installed}
                      busy={installing === entry.catalogId}
                      onInstall={(env) => installFromCatalog(entry, env)}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </section>

      <CustomMcpDialog open={showCustom} onClose={() => setShowCustom(false)} onCreated={() => { setShowCustom(false); load(); }} />
    </div>
  );
}

function CatalogCard({
  entry,
  installed,
  busy,
  onInstall,
}: {
  entry: CatalogEntry;
  installed: boolean;
  busy: boolean;
  onInstall: (env: Record<string, string>) => void;
}) {
  const [showCreds, setShowCreds] = useState(false);
  const [env, setEnv] = useState<Record<string, string>>({});
  const needsCreds = (entry.requiredEnvKeys ?? []).some((k) => !k.optional);

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            {entry.name}
            <span className="badge border-line bg-surface-3 text-2xs text-ink-faint">{entry.transport}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-faint">{entry.description}</p>
        </div>
        {installed ? (
          <span className="badge shrink-0 border-ok/30 bg-ok/10 text-ok"><Check size={10} /> added</span>
        ) : (
          <button className="btn-primary btn-sm shrink-0" disabled={busy} onClick={() => (needsCreds ? setShowCreds(true) : onInstall({}))}>
            {busy ? <Spinner size={11} /> : <Plus size={11} />} Add
          </button>
        )}
      </div>
      {showCreds && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {(entry.requiredEnvKeys ?? []).map((k) => (
            <div key={k.key}>
              <label className="label">{k.label}</label>
              <input
                className="input font-mono text-xs"
                type="password"
                placeholder={k.key}
                onChange={(e) => setEnv((prev) => ({ ...prev, [k.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary btn-sm" onClick={() => setShowCreds(false)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => { setShowCreds(false); onInstall(env); }}>
              {busy ? <Spinner size={11} /> : null} Add server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditMcpButton({ server, onSaved }: { server: McpServer; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<Record<string, string>>({});
  return (
    <>
      <button className="btn-secondary btn-sm" onClick={() => setOpen(true)}>Configure</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Configure ${server.name}`} description="Credentials are passed to the server inside the sandbox.">
        <div className="space-y-3">
          {(server.requiredEnvKeys ?? Object.keys(server.env ?? {})).length === 0 && (
            <p className="hint">This server has no credentials configured.</p>
          )}
          {(server.requiredEnvKeys ?? Object.keys(server.env ?? {})).map((key) => (
            <div key={key}>
              <label className="label font-mono">{key}</label>
              <input
                className="input font-mono text-xs"
                type="password"
                placeholder="value"
                onChange={(e) => setEnv((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  await api.put(`/api/mcp/${server.id}`, { env });
                  toast("success", "Credentials saved");
                  setOpen(false);
                  onSaved();
                } catch (e: any) {
                  toast("error", e.message);
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function CustomMcpDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envText, setEnvText] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onClose={onClose} title="Add custom MCP server" description="stdio servers run inside app sandboxes; HTTP servers are called remotely.">
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My internal tools" autoFocus />
        </div>
        <div>
          <label className="label">Description (shown to the agent)</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Internal REST API tools" />
        </div>
        <div>
          <label className="label">Transport</label>
          <Select
            value={transport}
            onChange={(v) => setTransport(v as any)}
            options={[
              { value: "stdio", label: "stdio — runs inside the app sandbox" },
              { value: "http", label: "HTTP — remote MCP endpoint" },
            ]}
          />
        </div>
        {transport === "stdio" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Command</label>
              <input className="input font-mono text-xs" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </div>
            <div>
              <label className="label">Arguments (space separated)</label>
              <input className="input font-mono text-xs" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @org/my-mcp-server" />
            </div>
          </div>
        ) : (
          <div>
            <label className="label">Endpoint URL</label>
            <input className="input font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
          </div>
        )}
        <div>
          <label className="label">Environment variables (KEY=value per line)</label>
          <textarea className="input h-20 resize-none py-2 font-mono text-xs" value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder={"API_KEY=..."} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!name || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const env: Record<string, string> = {};
                for (const line of envText.split("\n")) {
                  const idx = line.indexOf("=");
                  if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
                }
                await api.post("/api/mcp", {
                  name, description, transport,
                  command: transport === "stdio" ? command : undefined,
                  args: transport === "stdio" ? args : undefined,
                  url: transport === "http" ? url : undefined,
                  env,
                });
                toast("success", "Custom MCP server added");
                setName(""); setDescription(""); setArgs(""); setUrl(""); setEnvText("");
                onCreated();
              } catch (e: any) {
                toast("error", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={13} />} Add server
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// Skills
// ============================================================================

function SkillsSection() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [viewing, setViewing] = useState<Skill | null>(null);

  const load = () => api.get<{ skills: Skill[] }>("/api/skills").then((r) => setSkills(r.skills));
  useEffect(() => {
    load().catch((e) => toast("error", e.message));
  }, []);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <p className="hint max-w-xl">
          Skills are instruction playbooks (SKILL.md) installed into app sandboxes. When a task matches,
          the agent loads the skill and follows it. Create your own to encode team conventions.
        </p>
        <button className="btn-primary btn-sm shrink-0" onClick={() => setShowNew(true)}>
          <Plus size={13} /> New skill
        </button>
      </div>

      {!skills && <Spinner className="mt-8 text-ink-faint" />}
      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {skills?.map((s) => (
          <div key={s.id} className="rounded-lg border border-line bg-surface-2 p-4 transition-colors hover:border-line-strong">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <Sparkles size={12} className="text-accent" /> {s.name}
                  {s.builtin && <span className="badge border-line bg-surface-3 text-2xs text-ink-faint">built-in</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-faint">{s.description}</p>
              </div>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => setViewing(s)}>View</button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ""} description={viewing?.description} width="max-w-2xl">
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-1 p-3.5 font-mono text-2xs leading-relaxed text-ink-dim">
          {viewing?.instructions}
        </pre>
      </Dialog>
      <NewSkillDialog open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
    </div>
  );
}

function NewSkillDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onClose={onClose} title="Create a skill" description="Markdown instructions the agent loads when a task matches." width="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Stripe integration" />
          </div>
          <div>
            <label className="label">Description (when to load it)</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Load when adding payments" />
          </div>
        </div>
        <div>
          <label className="label">Instructions (markdown)</label>
          <textarea
            className="input h-64 resize-none py-2.5 font-mono text-xs leading-relaxed"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={"# Skill: Stripe integration\n\n## When to use\n...\n\n## Rules\n- ..."}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!name || !instructions || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/api/skills", { name, description, instructions });
                toast("success", "Skill created");
                setName(""); setDescription(""); setInstructions("");
                onCreated();
              } catch (e: any) {
                toast("error", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={13} />} Create skill
          </button>
        </div>
      </div>
    </Dialog>
  );
}
