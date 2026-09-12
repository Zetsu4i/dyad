"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useToast } from "@/hooks/use-toast";

interface ProviderRow {
  id: string;
  name: string;
  format: string;
  baseUrl: string;
  apiKeyMasked: string | null;
  hasKey: boolean;
  isActive: boolean;
}

export function ProvidersSection() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const r = await api.providers();
      setProviders(r.providers);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(p: ProviderRow) {
    setEditing(p);
    setName(p.name);
    setFormat(p.format);
    setBaseUrl(p.baseUrl);
    setApiKey("");
    setShowForm(true);
    setTestResult(null);
  }

  function startCreate() {
    setEditing(null);
    setName("");
    setFormat("openai");
    setBaseUrl("");
    setApiKey("");
    setShowForm(true);
    setTestResult(null);
  }

  async function test() {
    if (!baseUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testProvider({ baseUrl: baseUrl.trim(), apiKey: apiKey || undefined, format });
      setTestResult(r);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!baseUrl.trim()) {
      toast({ title: "Base URL is required", variant: "destructive" });
      return;
    }
    try {
      await api.saveProvider({
        providerId: editing?.id,
        name: name.trim() || undefined,
        format,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey || undefined,
      });
      toast({ title: editing ? "Provider updated" : "Provider added" });
      setShowForm(false);
      await load();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this provider? Models using it will stop working.")) return;
    await fetch(`/api/settings/providers?id=${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-200">LLM Providers</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Connect OpenAI-compatible or Anthropic-compatible endpoints. Provide the API
          base URL and key — both chat-completions and messages endpoints are supported.
          Keys are stored in your workspace database and never rendered back to the UI.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{p.name}</span>
                  <span className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                    {p.format}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">{p.baseUrl}</div>
                <div className="mt-0.5 text-[11px] text-zinc-600">
                  {p.hasKey ? `key: ${p.apiKeyMasked}` : "no key set"}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startEdit(p)}
                className="border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(p.id)}
                className="h-7 w-7 text-zinc-600 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={startCreate}
            className="w-full border-dashed border-zinc-700 bg-transparent text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add provider
          </Button>
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="mb-4 text-sm font-medium text-zinc-200">
            {editing ? `Edit: ${editing.name}` : "New provider"}
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Display name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Gateway"
                  className="border-zinc-800 bg-zinc-950"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Format</Label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger className="border-zinc-800 bg-zinc-950">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-900">
                    <SelectItem value="openai">OpenAI-compatible (/v1/chat/completions)</SelectItem>
                    <SelectItem value="anthropic">Anthropic-compatible (/v1/messages)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">API base URL</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-gateway.example.com"
                className="border-zinc-800 bg-zinc-950 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">
                API key {editing?.hasKey && <span className="text-zinc-600">(leave blank to keep current)</span>}
              </Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                className="border-zinc-800 bg-zinc-950"
                autoComplete="off"
              />
            </div>

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-400"
                    : "border-red-900/50 bg-red-950/30 text-red-400"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={test}
                disabled={testing || !baseUrl.trim()}
                className="border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
              >
                {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Test connection
              </Button>
              <div className="flex-1" />
              <Button
                variant="ghost"
                onClick={() => setShowForm(false)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </Button>
              <Button onClick={save} className="bg-zinc-100 text-xs font-medium text-zinc-900 hover:bg-white">
                {editing ? "Save changes" : "Add provider"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
