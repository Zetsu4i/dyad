"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Plug,
  ExternalLink,
  RefreshCw,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { useToast } from "@/hooks/use-toast";
import type { AppIntegrations } from "@/app/builder/[appId]/page";
import { cn } from "@/lib/utils";

interface Props {
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrations: AppIntegrations;
  onChange: () => Promise<void>;
}

export function IntegrationsDialog({ appId, open, onOpenChange, integrations, onChange }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(false);

  async function toggle(type: "skill" | "mcp", id: string, enabled: boolean) {
    setBusy(`${type}:${id}`);
    try {
      await api.setAppIntegration(appId, { type, id, enabled });
      await onChange();
      toast({ title: enabled ? "Enabled for this app" : "Disabled for this app" });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  const hasAny = integrations.skills.length > 0 || integrations.mcpServers.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            Agent capabilities
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Skills and MCP servers available to the agent in this app&apos;s sandbox.
            Install new ones in{" "}
            <Link href="/settings?tab=skills" className="text-zinc-300 underline underline-offset-2">
              Settings → Skills &amp; MCP
            </Link>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {!hasAny && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center text-sm text-zinc-500">
              Nothing installed yet. Add skills and MCP servers in Settings to extend
              the agent&apos;s capabilities.
            </div>
          )}

          {integrations.skills.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
                <Sparkles className="h-3.5 w-3.5" />
                Skills
              </h3>
              <div className="space-y-1.5">
                {integrations.skills.map((s) => (
                  <div
                    key={s.skillId}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-zinc-200">{s.name}</span>
                        {!s.globallyEnabled && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-amber-400">
                            globally off
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {s.description ?? s.slug}
                      </div>
                    </div>
                    <Switch
                      checked={s.enabled && s.globallyEnabled}
                      disabled={busy === `skill:${s.skillId}` || !s.globallyEnabled}
                      onCheckedChange={(v) => toggle("skill", s.skillId, v)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {integrations.mcpServers.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
                <Plug className="h-3.5 w-3.5" />
                MCP Servers
              </h3>
              <div className="space-y-1.5">
                {integrations.mcpServers.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-zinc-200">{m.name}</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            m.status === "connected"
                              ? "bg-emerald-950/60 text-emerald-400"
                              : m.status === "error"
                                ? "bg-red-950/60 text-red-400"
                                : "bg-zinc-800 text-zinc-400"
                          )}
                        >
                          {m.status}
                        </span>
                        {!m.globallyEnabled && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-amber-400">
                            globally off
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {m.toolCount} tool{m.toolCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Switch
                      checked={m.enabled && m.globallyEnabled}
                      disabled={busy === `mcp:${m.id}` || !m.globallyEnabled}
                      onCheckedChange={(v) => toggle("mcp", m.id, v)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReload((r) => !r)}
            className="border-zinc-800 bg-transparent text-xs text-zinc-400 hover:bg-zinc-800"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Refresh
          </Button>
          <Link href="/settings?tab=skills">
            <Button
              size="sm"
              className="bg-zinc-100 text-xs font-medium text-zinc-900 hover:bg-white"
            >
              Manage in Settings
              <ExternalLink className="ml-1.5 h-3 w-3" />
            </Button>
          </Link>
        </div>
        {reload && <span className="hidden">{busy}</span>}
      </DialogContent>
    </Dialog>
  );
}
