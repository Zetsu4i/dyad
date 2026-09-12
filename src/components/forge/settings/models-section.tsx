"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, RefreshCw, Search, Star, Trash2, Plus } from "lucide-react";
import { api, type ModelSummary } from "@/lib/client/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ModelsSection() {
  const { toast } = useToast();
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [search, setSearch] = useState("");
  const [pulled, setPulled] = useState<{ id: string; name: string; description?: string }[] | null>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const [customModelId, setCustomModelId] = useState("");

  async function load() {
    try {
      const r = await api.models();
      setModels(r.models);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function pullModels() {
    setPulling(true);
    setPulled(null);
    try {
      const r = await api.pullModels();
      setPulled(r.models);
      await load();
      toast({ title: `Pulled ${r.models.length} models from ${r.provider.name}` });
    } catch (err) {
      toast({
        title: "Failed to pull models",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setPulling(false);
    }
  }

  async function toggleActive(m: ModelSummary) {
    await api.setModel(m.id, { isActive: !m.isActive });
    await load();
  }

  async function setDefault(m: ModelSummary) {
    await api.setModel(m.id, { isDefault: true });
    await load();
    toast({ title: `Default model: ${m.displayName}` });
  }

  async function remove(m: ModelSummary) {
    await api.deleteModel(m.id);
    await load();
  }

  async function addCustomModel() {
    if (!customModelId.trim()) return;
    try {
      await api.addModel(customModelId.trim());
      setCustomModelId("");
      setAddingCustom(false);
      await load();
      toast({ title: "Model added" });
    } catch (err) {
      toast({
        title: "Failed to add model",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        !q ||
        m.modelId.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q)
    );
  }, [models, search]);

  const activeCount = models.filter((m) => m.isActive).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">Models</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Pull the live model list from your provider, then activate the models you
          want available in the builder. Active models appear in the chat model picker.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={pullModels}
          disabled={pulling}
          className="bg-zinc-100 text-xs font-medium text-zinc-900 hover:bg-white"
        >
          {pulling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Pull model list
        </Button>
        <Button
          variant="outline"
          onClick={() => setAddingCustom((v) => !v)}
          className="border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add manually
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-zinc-600">
          {activeCount} active of {models.length}
        </span>
      </div>

      {addingCustom && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <Input
            value={customModelId}
            onChange={(e) => setCustomModelId(e.target.value)}
            placeholder="model id, e.g. openai/gpt-4.1"
            className="h-8 border-zinc-800 bg-zinc-950 font-mono text-xs"
          />
          <Button size="sm" onClick={addCustomModel} className="h-8 bg-zinc-100 text-xs text-zinc-900 hover:bg-white">
            Add
          </Button>
        </div>
      )}

      {pulled && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
          Pulled {pulled.length} models — they now appear below (inactive). Activate the
          ones you want to use in the builder.
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter models…"
          className="h-9 border-zinc-800 bg-zinc-950 pl-9 text-xs"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3",
                m.isActive ? "border-zinc-700 bg-zinc-900/60" : "border-zinc-800 bg-zinc-900/30"
              )}
            >
              <Switch checked={m.isActive} onCheckedChange={() => toggleActive(m)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-200">{m.displayName}</span>
                  {m.isDefault && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                      default
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-[11px] text-zinc-500">{m.modelId}</div>
              </div>
              {(!m.isDefault || true) && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDefault(m)}
                  disabled={!m.isActive}
                  className={cn("h-7 w-7", m.isDefault ? "text-amber-400" : "text-zinc-600 hover:text-amber-400")}
                  title="Set as default"
                >
                  <Star className={cn("h-3.5 w-3.5", m.isDefault && "fill-amber-400")} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(m)}
                className="h-7 w-7 text-zinc-600 hover:text-red-400"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-sm text-zinc-600">
              {models.length === 0
                ? "No models yet. Pull the list from your provider or add one manually."
                : "No models match your filter."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
