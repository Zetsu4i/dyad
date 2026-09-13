import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, TerminalSquare, CircleAlert } from "lucide-react";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/toast";
import { useSettings } from "@/hooks/useSettings";

type ConsoleEntry = {
  kind: "command" | "stdout" | "stderr" | "error" | "info";
  text: string;
};

const SANDBOX_STATE_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  starting: {
    label: "Starting",
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30",
  },
  running: {
    label: "Running",
    className:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  },
  restoring: {
    label: "Restoring",
    className:
      "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30",
  },
  saving: {
    label: "Saving",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
  },
  stopping: {
    label: "Stopping",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
  },
  stopped: {
    label: "Stopped",
    className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
  },
  paused: {
    label: "Paused",
    className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30",
  },
};

/**
 * Interactive console into the project's remote E2B sandbox: shows the sandbox
 * lifecycle state and runs one-shot commands via `sandbox.commands.run`.
 * Also the default preview surface for General-mode projects.
 */
export function E2bConsole({ appId }: { appId: number | null }) {
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const isE2bMode = settings?.runtimeMode2 === "e2b";

  const { data: sandboxState } = useQuery({
    queryKey: ["e2bSandboxState", appId],
    queryFn: () => ipc.e2b.getSandboxState({ appId: appId! }),
    enabled: appId != null,
    refetchInterval: 5000,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  }, [entries]);

  useEffect(() => {
    if (appId == null) {
      return;
    }
    setEntries([
      {
        kind: "info",
        text: "E2B console — commands execute inside the project's remote sandbox at /home/user/app. Start the app preview (Run) first to attach a sandbox.",
      },
    ]);
  }, [appId]);

  const submitCommand = async () => {
    const trimmed = command.trim();
    if (!trimmed || isRunning || appId == null) {
      return;
    }
    setHistory((current) => [...current, trimmed]);
    setHistoryIndex(-1);
    setEntries((current) => [...current, { kind: "command", text: trimmed }]);
    setCommand("");
    setIsRunning(true);
    try {
      const result = await ipc.e2b.runCommand({
        appId,
        command: trimmed,
      });
      if (result.stdout.trim()) {
        setEntries((current) => [
          ...current,
          { kind: "stdout", text: result.stdout.trim() },
        ]);
      }
      if (result.stderr.trim()) {
        setEntries((current) => [
          ...current,
          { kind: "stderr", text: result.stderr.trim() },
        ]);
      }
      if (!result.stdout.trim() && !result.stderr.trim()) {
        setEntries((current) => [
          ...current,
          { kind: "info", text: "(no output)" },
        ]);
      }
    } catch (error) {
      showError(error as Error);
      setEntries((current) => [
        ...current,
        {
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const stateStyle =
    SANDBOX_STATE_STYLES[sandboxState?.state ?? "stopped"] ??
    SANDBOX_STATE_STYLES.stopped;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <TerminalSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">E2B Console</span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            stateStyle.className,
          )}
          title={
            sandboxState?.sandboxId
              ? `Sandbox ${sandboxState.sandboxId}`
              : "No sandbox attached"
          }
        >
          {isE2bMode ? stateStyle.label : "E2B mode off"}
        </span>
        {sandboxState?.sandboxId && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground truncate max-w-40">
            {sandboxState.sandboxId}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed"
      >
        {entries.map((entry, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre-wrap break-words",
              entry.kind === "command" && "text-foreground font-semibold",
              entry.kind === "stdout" && "text-muted-foreground",
              entry.kind === "stderr" && "text-amber-600 dark:text-amber-400",
              entry.kind === "error" && "text-red-500",
              entry.kind === "info" && "text-muted-foreground/80 italic",
            )}
          >
            {entry.kind === "command" ? `$ ${entry.text}` : entry.text}
          </div>
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> running...
          </div>
        )}
      </div>

      {!isE2bMode && (
        <div className="flex items-center gap-2 border-t border-border/60 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          <CircleAlert className="size-3.5 shrink-0" />
          Switch the runtime mode to E2B (Settings → General → Runtime Mode) to
          run commands in a remote sandbox.
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
        <span className="font-mono text-sm text-muted-foreground">$</span>
        <Input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submitCommand();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              const nextIndex =
                historyIndex === -1
                  ? history.length - 1
                  : Math.max(0, historyIndex - 1);
              if (history[nextIndex] !== undefined) {
                setHistoryIndex(nextIndex);
                setCommand(history[nextIndex]);
              }
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              if (historyIndex === -1) {
                return;
              }
              const nextIndex = historyIndex + 1;
              if (nextIndex >= history.length) {
                setHistoryIndex(-1);
                setCommand("");
              } else {
                setHistoryIndex(nextIndex);
                setCommand(history[nextIndex]);
              }
            }
          }}
          placeholder="Run a command in the sandbox (e.g. ls -la, node -v, pnpm build)"
          className="flex-1 font-mono text-[13px]"
          disabled={isRunning || !isE2bMode}
          spellCheck={false}
        />
        <Button
          size="sm"
          onClick={() => void submitCommand()}
          disabled={isRunning || !command.trim() || !isE2bMode}
        >
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          Run
        </Button>
      </div>
    </div>
  );
}
