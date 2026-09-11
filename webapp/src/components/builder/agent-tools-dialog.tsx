"use client";

import { useEffect, useState } from "react";
import { Plug, GraduationCap, Wrench } from "lucide-react";
import { Dialog, Badge, Spinner, Switch } from "@/components/ui";
import { api, type McpServerRow, type SkillRow } from "@/lib/types";

/**
 * Builder dialog: pick which skills and MCP servers the agent can access in
 * THIS app. Global (scope=global) servers apply everywhere; app-attached ones
 * only here. Enabled skills are injected into the prompt and materialized in
 * the sandbox at /home/user/skills/.
 */
export function AgentToolsDialog({
  appId,
  open,
  onClose,
  onSaved,
}: {
  appId: number;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [attachedSkillIds, setAttachedSkillIds] = useState<Set<number>>(new Set());
  const [attachedMcpIds, setAttachedMcpIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [skillsRes, mcpRes, attachRes] = await Promise.all([
      api<{ skills: SkillRow[] }>("/api/skills"),
      api<{ servers: McpServerRow[] }>("/api/mcp"),
      api<{ skillIds: number[]; mcpIds: number[] }>(`/api/apps/${appId}/attachments`),
    ]);
    setSkills(skillsRes.skills.filter((s) => s.enabled));
    setServers(mcpRes.servers);
    setAttachedSkillIds(new Set(attachRes.skillIds));
    setAttachedMcpIds(new Set(attachRes.mcpIds));
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appId]);

  const toggleSkill = async (id: number, attached: boolean) => {
    setAttachedSkillIds((prev) => {
      const next = new Set(prev);
      if (attached) next.add(id);
      else next.delete(id);
      return next;
    });
    await api(`/api/apps/${appId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ kind: "skill", id, attached }),
    });
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onSaved();
    }, 400);
  };

  const toggleMcp = async (id: number, attached: boolean) => {
    setAttachedMcpIds((prev) => {
      const next = new Set(prev);
      if (attached) next.add(id);
      else next.delete(id);
      return next;
    });
    await api(`/api/apps/${appId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ kind: "mcp", id, attached }),
    });
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onSaved();
    }, 400);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Agent tools for this app" wide>
      {skills === null || servers === null ? (
        <div className="flex h-32 items-center justify-center text-zinc-600">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          {busy ? (
            <p className="flex items-center gap-2 text-2xs text-zinc-500">
              <Spinner className="h-3 w-3" /> syncing skills into the sandbox…
            </p>
          ) : null}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <GraduationCap className="h-3.5 w-3.5 text-indigo-400" /> Skills
              <span className="font-normal text-zinc-600">
                — attached skills are injected into the prompt and written into the sandbox
              </span>
            </h3>
            <div className="space-y-1.5">
              {skills.length === 0 ? (
                <p className="text-xs text-zinc-600">No enabled skills (see Settings → Skills).</p>
              ) : null}
              {skills.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-200">{s.name}</p>
                    <p className="truncate text-2xs text-zinc-600">{s.description}</p>
                  </div>
                  <Switch
                    checked={attachedSkillIds.has(s.id)}
                    onChange={(v) => void toggleSkill(s.id, v)}
                  />
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Plug className="h-3.5 w-3.5 text-indigo-400" /> MCP servers
              <span className="font-normal text-zinc-600">
                — global servers are already active everywhere; attach app-scoped ones here
              </span>
            </h3>
            <div className="space-y-1.5">
              {servers.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  No MCP servers configured (see Settings → MCP).
                </p>
              ) : null}
              {servers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs font-medium text-zinc-200">{s.name}</p>
                      <Badge variant="outline">{s.transport}</Badge>
                      {s.scope === "global" ? (
                        <Badge variant="accent">global</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-2xs text-zinc-600">
                      {s.tools.length > 0
                        ? `${s.tools.length} tools`
                        : s.lastStatus === "error"
                          ? s.lastError
                          : s.description}
                    </p>
                  </div>
                  <Switch
                    checked={s.scope === "global" ? true : attachedMcpIds.has(s.id)}
                    disabled={s.scope === "global" || !s.enabled}
                    onChange={(v) => void toggleMcp(s.id, v)}
                  />
                </div>
              ))}
            </div>
          </section>
          <p className="flex items-center gap-1.5 text-2xs text-zinc-600">
            <Wrench className="h-3 w-3" />
            Changes apply on the next agent turn. Skills are re-synced into the sandbox on the next
            build/restart.
          </p>
        </div>
      )}
    </Dialog>
  );
}
