"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface LogEntry {
  ts: number;
  stream: string;
  line: string;
}

export function TerminalPanel({ appId }: { appId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<{ command: string; exitCode: number; out: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.logs(appId)
        .then((r) => {
          if (alive && r.logs.length > 0) {
            setLogs(r.logs);
          }
        })
        .catch(() => {});
    load();
    const interval = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [appId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [logs, output]);

  async function runCommand(e: React.FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || running) return;
    setCommand("");
    setRunning(true);
    setOutput((prev) => [...prev, { command: cmd, exitCode: 0, out: "" }]);
    try {
      const res = await api.runCommand(appId, cmd, 120000);
      setOutput((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          command: cmd,
          exitCode: res.exitCode,
          out: [res.stdout, res.stderr].filter(Boolean).join("\n").trim(),
        };
        return next;
      });
    } catch (err) {
      setOutput((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          command: cmd,
          exitCode: 1,
          out: err instanceof Error ? err.message : String(err),
        };
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 font-mono">
      <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed">
        <div className="mb-3 text-zinc-600">— dev server logs —</div>
        {logs.length === 0 && (
          <div className="text-zinc-700">No logs yet. The dev server outputs will appear here.</div>
        )}
        {logs.map((l, i) => (
          <div key={i} className={cn("whitespace-pre-wrap", l.stream === "stderr" ? "text-red-400/90" : "text-zinc-400")}>
            {l.line}
          </div>
        ))}

        {output.length > 0 && (
          <div className="mt-4 border-t border-zinc-800/60 pt-3 text-zinc-600">— command output —</div>
        )}
        {output.map((o, i) => (
          <div key={i} className="mt-2">
            <div className="text-zinc-500">
              <span className="text-emerald-500">$</span> {o.command}
              {o.exitCode !== 0 && <span className="ml-2 text-red-400">(exit {o.exitCode})</span>}
            </div>
            {o.out && <div className="whitespace-pre-wrap text-zinc-400">{o.out}</div>}
          </div>
        ))}
        {running && (
          <div className="mt-2 flex items-center gap-2 text-zinc-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[11px]">running…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={runCommand} className="flex shrink-0 items-center gap-2 border-t border-zinc-800/60 px-4 py-2.5">
        <span className="font-mono text-sm text-emerald-500">$</span>
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Run a command in the sandbox (e.g. npm run build)"
          className="h-8 border-0 bg-transparent font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-0"
          disabled={running}
        />
        <Button
          type="submit"
          size="icon"
          disabled={running || !command.trim()}
          className="h-7 w-7 shrink-0 bg-zinc-100 text-zinc-900 hover:bg-white"
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
