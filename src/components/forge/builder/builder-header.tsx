"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Pencil, RefreshCw, RotateCw, Sparkles, Plug, Power, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusDot, templateLabel } from "@/components/forge/app-shell";
import { Input } from "@/components/ui/input";
import type { AppSummary, ModelSummary } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface Props {
  app: AppSummary & { sandboxId: string | null; previewPort: number };
  sandboxState: string;
  models: ModelSummary[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  onSandboxAction: (action: "restart" | "reinstall" | "pause" | "start") => void;
  onOpenIntegrations: () => void;
  onRename: (name: string) => Promise<void>;
  skillsCount: number;
  mcpCount: number;
}

export function BuilderHeader({
  app,
  sandboxState,
  models,
  selectedModelId,
  onSelectModel,
  onSandboxAction,
  onOpenIntegrations,
  onRename,
  skillsCount,
  mcpCount,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(app.name);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/80 px-4">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onRename(name.trim());
            setEditing(false);
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="h-7 w-56 border-zinc-800 bg-zinc-950 text-sm"
          />
          <Button type="submit" size="sm" className="h-7 bg-zinc-100 text-zinc-900 hover:bg-white">
            <Check className="h-3.5 w-3.5" />
          </Button>
        </form>
      ) : (
        <button
          className="group flex items-center gap-2 text-sm font-medium text-zinc-100"
          onClick={() => {
            setName(app.name);
            setEditing(true);
          }}
        >
          {app.name}
          <Pencil className="h-3 w-3 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}

      <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-500">
        {templateLabel(app.templateId)}
      </span>

      <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1">
        <StatusDot status={sandboxState} />
        <span className="text-[11px] font-medium text-zinc-400">
          {sandboxState === "running"
            ? "Sandbox running"
            : sandboxState === "starting"
              ? "Starting sandbox…"
              : sandboxState === "paused"
                ? "Sandbox paused"
                : sandboxState === "error"
                  ? "Sandbox error"
                  : "Sandbox idle"}
        </span>
      </div>

      <div className="flex-1" />

      <div className="hidden items-center gap-1.5 md:flex">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenIntegrations}
          className="h-7 gap-1.5 border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
          title="Configure skills and MCP servers for this app"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {skillsCount}
          <Plug className="ml-1 h-3.5 w-3.5" />
          {mcpCount}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onSandboxAction(sandboxState === "running" ? "pause" : "start")}
          className="h-7 gap-1.5 border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
          title={sandboxState === "running" ? "Pause sandbox (saves compute)" : "Resume sandbox"}
        >
          <Power className="h-3.5 w-3.5" />
          {sandboxState === "running" ? "Pause" : "Resume"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onSandboxAction("restart")}
          className="h-7 gap-1.5 border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
          title="Restart the dev server"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Restart
        </Button>
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <Select value={selectedModelId ?? ""} onValueChange={onSelectModel}>
          <SelectTrigger className="h-7 w-56 border-zinc-800 bg-zinc-900 text-xs">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent className="max-h-72 border-zinc-800 bg-zinc-900">
            {models.length === 0 && (
              <div className="px-3 py-2 text-xs text-zinc-500">
                No active models — add one in Settings
              </div>
            )}
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <ChevronsUpDown className="hidden" />
                  <span className="truncate">{m.displayName}</span>
                  {m.isDefault && (
                    <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">default</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
