"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, Boxes } from "lucide-react";
import { api } from "@/lib/client/api";
import { useToast } from "@/hooks/use-toast";

export function E2BSection() {
  const { toast } = useToast();
  const [hasKey, setHasKey] = useState(false);
  const [masked, setMasked] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.e2bStatus()
      .then((r) => {
        setHasKey(r.hasKey);
        setMasked(r.apiKeyMasked);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!apiKey.trim()) {
      toast({ title: "Enter an API key first", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.saveE2bKey(apiKey.trim());
      setApiKey("");
      const r = await api.e2bStatus();
      setHasKey(r.hasKey);
      setMasked(r.apiKeyMasked);
      toast({ title: "E2B key saved" });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testE2bKey();
      setTestResult(r);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Boxes className="h-4 w-4 text-zinc-400" />
          E2B Sandbox Key
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          All code execution, file operations and app previews run inside E2B cloud
          sandboxes using your own key. Get one at{" "}
          <a
            href="https://e2b.dev/dashboard?tab=keys"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline underline-offset-2"
          >
            e2b.dev/dashboard
          </a>
          . The key is stored in your workspace database and never exposed to the agent
          or the chat.
        </p>
        {!loading && hasKey && masked && (
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-400">
            {masked}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-zinc-400">
              E2B API key {hasKey && <span className="text-zinc-600">(enter a new one to replace)</span>}
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="e2b_…"
              className="border-zinc-800 bg-zinc-950 font-mono text-xs"
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
              disabled={testing || (!hasKey && !apiKey.trim())}
              className="border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Test connection
            </Button>
            <div className="flex-1" />
            <Button
              onClick={save}
              disabled={saving || !apiKey.trim()}
              className="bg-zinc-100 text-xs font-medium text-zinc-900 hover:bg-white"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save key
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-[13px] font-medium text-zinc-300">How sandboxes are billed</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-500">
          <li>· A sandbox boots when you open an app in the builder and runs the dev server.</li>
          <li>· When you leave the builder, the sandbox pauses automatically and its state is snapshotted.</li>
          <li>· Re-opening the app resumes the same sandbox (files, installed packages and processes) from the snapshot.</li>
          <li>· Idle sandboxes auto-pause after 3 minutes of inactivity to save compute.</li>
        </ul>
      </div>
    </div>
  );
}
