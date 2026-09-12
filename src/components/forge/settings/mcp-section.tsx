"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plug, Plus, Trash2, Zap, Wrench } from "lucide-react";
import { api, type McpServerSummary } from "@/lib/client/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MCP_PRESETS: { name: string; command: string; args: string; env?: string; description: string }[] = [
  {
    name: "filesystem",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem /app",
    description: "Read/write project files through the MCP filesystem server",
  },
  {
    name: "memory",
    command: "npx",
    args: "-y @modelcontextprotocol/server-memory",
    description: "Persistent knowledge graph memory for the agent",
  },
  {
    name: "sequential-thinking",
    command: "npx",
    args: "-y @modelcontextprotocol/server-sequentialthinking",
    description: "Dynamic problem-solving via structured thought chains",
  },
  {
    name: "sqlite",
    command: "npx",
    args: "-y @modelcontextprotocol/server-sqlite --db-path /app/data.db",
    description: "SQLite database access with schema inspection",
  },
  {
    name: "everything",
    command: "npx",
    args: "-y @modelcontextprotocol/server-everything",
    description: "Reference server exercising all MCP features (testing)",
  },
];

export function McpSection() {
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  // form state
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  async function load() {
    try {
      const r = await api.mcpServers();
      setServers(r.servers);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function applyPreset(p: (typeof MCP_PRESETS)[number]) {
    setName(p.name);
    setCommand(p.command);
    setArgs(p.args);
    setEnv("");
  }

  async function add() {
    if (!name.trim() || !command.trim()) {
      toast({ title: "Name and command are required", variant: "destructive" });
      return;
    }
    try {
      const argsList = args.trim() ? args.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(a => a.replace(/^"|"$/g, "")) : [];
      let envRecord: Record<string, string> = {};
      if (env.trim()) {
        envRecord = JSON.parse(env.trim());
      }
      await api.addMcpServer({ name: name.trim(), command: command.trim(), args: argsList, env: envRecord });
      toast({ title: "MCP server added", description: "Test the connection to list its tools." });
      setAddOpen(false);
      setName(""); setCommand(""); setArgs(""); setEnv("");
      await load();
    } catch (err) {
      toast({
        title: "Failed to add",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  }

  async function test(id: string) {
    setTesting(id);
    try {
      const r = await api.testMcpServer({ id });
      if (r.ok) {
        toast({ title: "Connected", description: `${r.tools.length} tools available` });
      } else {
        toast({ title: "Connection failed", description: r.error?.slice(0, 200), variant: "destructive" });
      }
      await load();
    } catch (err) {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setTesting(null);
    }
  }

  async function toggle(s: McpServerSummary) {
    await api.setMcpEnabled(s.id, !s.enabled);
    await load();
  }

  async function remove(s: McpServerSummary) {
    if (!confirm(`Remove MCP server "${s.name}"?`)) return;
    await api.deleteMcpServer(s.id);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Plug className="h-4 w-4 text-zinc-400" />
          MCP Servers
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Connect real MCP (Model Context Protocol) servers. They run inside your app&apos;s
          E2B sandbox and their tools are exposed live to the agent. Test a connection
          to discover and cache its tool list.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {servers.map((s) => (
            <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5">
              <div className="flex items-center gap-3">
                <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-200">{s.name}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        s.status === "connected"
                          ? "bg-emerald-950/60 text-emerald-400"
                          : s.status === "error"
                            ? "bg-red-950/60 text-red-400"
                            : "bg-zinc-800 text-zinc-400"
                      )}
                    >
                      {s.status}
                    </span>
                    <span className="text-[11px] text-zinc-600">
                      {s.tools.length} tool{s.tools.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-zinc-500">
                    {s.command} {s.args.join(" ")}
                  </div>
                  {s.statusMessage && (
                    <div className="truncate text-[11px] text-red-400/80">{s.statusMessage}</div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => test(s.id)}
                  disabled={testing === s.id}
                  className="h-7 gap-1 border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  {testing === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(s)}
                  className="h-7 w-7 text-zinc-600 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {s.tools.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1 border-t border-zinc-800/60 pt-2.5">
                  {s.tools.slice(0, 8).map((t) => (
                    <span
                      key={t.name}
                      title={t.description}
                      className="flex items-center gap-1 rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                    >
                      <Wrench className="h-2.5 w-2.5" />
                      {t.name}
                    </span>
                  ))}
                  {s.tools.length > 8 && (
                    <span className="text-[10px] text-zinc-600">+{s.tools.length - 8} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => setAddOpen(true)}
            className="w-full border-dashed border-zinc-700 bg-transparent text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add MCP server
          </Button>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md border-zinc-800 bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Add MCP server</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Stdio MCP servers run inside your app sandbox via a gateway. Start from a
              preset or enter a custom command.
            </DialogDescription>
          </DialogHeader>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {MCP_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                title={p.description}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              >
                + {p.name}
              </button>
            ))}
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="filesystem"
                className="border-zinc-800 bg-zinc-950"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Command</Label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                className="border-zinc-800 bg-zinc-950 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Arguments (space separated, quote if needed)</Label>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /app"
                className="border-zinc-800 bg-zinc-950 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Environment variables (JSON, optional)</Label>
              <Textarea
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                placeholder='{ "API_KEY": "…" }'
                className="min-h-[56px] border-zinc-800 bg-zinc-950 font-mono text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setAddOpen(false)}
                className="text-xs text-zinc-400"
              >
                Cancel
              </Button>
              <Button onClick={add} className="bg-zinc-100 text-xs font-medium text-zinc-900 hover:bg-white">
                Add server
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
