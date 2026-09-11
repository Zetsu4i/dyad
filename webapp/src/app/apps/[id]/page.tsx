"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Cloud,
  ExternalLink,
  Eye,
  FileCode2,
  FolderSync,
  RotateCw,
  RefreshCw,
  ScrollText,
  Wrench,
  Play,
  Square,
  Monitor,
} from "lucide-react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { AgentToolsDialog } from "@/components/builder/agent-tools-dialog";
import { Badge, Spinner, StatusDot, Tabs, ToastProvider, useToast } from "@/components/ui";
import {
  api,
  type ActiveModel,
  type AppStatus,
  type AppSummary,
  type ChatSummary,
} from "@/lib/types";

type FileEntry = { path: string; updatedAt: string };

function FilesTab({
  appId,
  files,
  onRefresh,
}: {
  appId: number;
  files: FileEntry[];
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const openFile = (path: string) => {
    setSelected(path);
    setLoading(true);
    api<{ content: string }>(`/api/apps/${appId}`, {
      method: "POST",
      body: JSON.stringify({ file: path }),
    })
      .then((r) => setContent(r.content))
      .catch(() => setContent("// failed to load"))
      .finally(() => setLoading(false));
  };

  const visible = files.filter((f) => f.path.includes(filter));
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80">
        <div className="p-2">
          <input
            className="input h-8 text-xs"
            placeholder="Filter files…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {visible.map((f) => (
            <button
              key={f.path}
              onClick={() => openFile(f.path)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-2xs transition-colors ${
                selected === f.path
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              }`}
            >
              <FileCode2 className="h-3 w-3 shrink-0 text-zinc-600" />
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-zinc-800/80 p-2">
          <button className="btn-ghost btn-sm w-full" onClick={onRefresh}>
            <RefreshCw className="h-3 w-3" /> Reload file list
          </button>
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto bg-zinc-950/50">
        {selected ? (
          loading ? (
            <div className="flex h-32 items-center justify-center text-zinc-600"><Spinner /></div>
          ) : (
            <pre className="p-4 font-mono text-xs leading-relaxed text-zinc-300">{content}</pre>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            Select a file to view its contents
          </div>
        )}
      </div>
    </div>
  );
}

function LogsTab({ logs }: { logs: string[] }) {
  return (
    <div className="h-full overflow-auto bg-zinc-950/70 p-3">
      {logs.length === 0 ? (
        <p className="p-4 text-xs text-zinc-600">No sandbox logs yet.</p>
      ) : (
        <pre className="whitespace-pre-wrap font-mono text-2xs leading-relaxed text-zinc-400">
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
}

function BuilderInner() {
  const params = useParams<{ id: string }>();
  const appId = Number(params.id);
  const { push } = useToast();

  const [app, setApp] = useState<AppSummary | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [models, setModels] = useState<ActiveModel[]>([]);
  const [defaultModelKey, setDefaultModelKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [tab, setTab] = useState("preview");
  const [iframeKey, setIframeKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const loadApp = useCallback(async () => {
    const detail = await api<{
      app: AppSummary;
      files: FileEntry[];
      chats: ChatSummary[];
    }>(`/api/apps/${appId}`);
    setApp(detail.app);
    setFiles(detail.files);
    setChats(detail.chats);
    setActiveChatId((prev) => prev ?? detail.chats[0]?.id ?? null);
  }, [appId]);

  const pollStatus = useCallback(async () => {
    try {
      const s = await api<AppStatus>(`/api/apps/${appId}/status`);
      setStatus(s);
      if (panelBusy && (s.status === "running" || s.status === "error" || s.status === "stopped")) {
        setPanelBusy(false);
        void loadApp();
      }
    } catch {
      /* app may be mid-create */
    }
  }, [appId, panelBusy, loadApp]);

  useEffect(() => {
    void loadApp();
    api<{ models: ActiveModel[] }>("/api/models").then((r) => setModels(r.models)).catch(() => {});
    api<{ defaultModelKey: string | null }>("/api/settings")
      .then((r) => setDefaultModelKey(r.defaultModelKey))
      .catch(() => {});
  }, [loadApp]);

  useEffect(() => {
    const t = setInterval(pollStatus, 2500);
    void pollStatus();
    return () => clearInterval(t);
  }, [pollStatus]);

  const doAction = async (action: string) => {
    setBusyAction(action);
    setPanelBusy(true);
    try {
      await api(`/api/apps/${appId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (action === "refresh") setIframeKey((k) => k + 1);
      await pollStatus();
      void loadApp();
    } catch (err) {
      push({
        title: `${action} failed`,
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
      setPanelBusy(false);
    } finally {
      setBusyAction(null);
    }
  };

  const previewSrc = useMemo(() => {
    if (!status?.previewUrl) return null;
    return status.previewUrl.startsWith("http")
      ? status.previewUrl
      : status.previewUrl;
  }, [status]);

  const isRunning = status?.status === "running";

  if (!app) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-600">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Builder header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-[var(--surface)] px-4">
        <Link href="/" className="btn-ghost btn-sm">
          <ArrowLeft className="h-3.5 w-3.5" /> Apps
        </Link>
        <div className="h-4 w-px bg-zinc-800" />
        <h1 className="truncate text-sm font-semibold text-zinc-100">{app.name}</h1>
        <StatusDot status={status?.status ?? app.status} />
        <Badge variant={app.runner === "e2b" ? "accent" : "outline"}>
          <Cloud className="h-3 w-3" /> {app.runner}
        </Badge>
        {status?.sandboxId ? (
          <span className="hidden font-mono text-2xs text-zinc-600 lg:inline">
            sandbox {status.sandboxId.slice(0, 12)}…
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn-ghost btn-sm" title="Skills & MCP tools for this app" onClick={() => setToolsOpen(true)}>
            <Wrench className="h-3 w-3" /> Tools
          </button>
          {isRunning ? (
            <button className="btn-secondary btn-sm" onClick={() => doAction("stop")} disabled={busyAction !== null}>
              {busyAction === "stop" ? <Spinner className="h-3 w-3" /> : <Square className="h-3 w-3" />} Stop
            </button>
          ) : (
            <button className="btn-primary btn-sm" onClick={() => doAction("start")} disabled={busyAction !== null}>
              {busyAction === "start" ? <Spinner className="h-3 w-3" /> : <Play className="h-3 w-3" />} Run
            </button>
          )}
          <button className="btn-ghost btn-sm" title="Rebuild (rm node_modules, install, restart)" onClick={() => doAction("rebuild")} disabled={busyAction !== null}>
            {busyAction === "rebuild" ? <Spinner className="h-3 w-3" /> : <FolderSync className="h-3 w-3" />} Rebuild
          </button>
          <button className="btn-ghost btn-sm" title="Restart dev server" onClick={() => doAction("restart")} disabled={busyAction !== null}>
            {busyAction === "restart" ? <Spinner className="h-3 w-3" /> : <RotateCw className="h-3 w-3" />} Restart
          </button>
          <button className="btn-ghost btn-sm" title="Refresh preview" onClick={() => { setIframeKey((k) => k + 1); void doAction("refresh"); }}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </header>

      {/* Split */}
      <div className="flex min-h-0 flex-1">
        <section className="flex w-[42%] min-w-[380px] flex-col border-r border-zinc-800/80 bg-[var(--surface)]">
          <ChatPanel
            appId={appId}
            chats={chats}
            activeChatId={activeChatId}
            onChatChange={(id) => {
              setActiveChatId(id);
              void loadApp();
            }}
            models={models}
            defaultModelKey={defaultModelKey}
            onChangesApplied={() => {
              setPanelBusy(true);
              void loadApp();
            }}
          />
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800/80 px-3">
            <Tabs
              tabs={[
                { id: "preview", label: "Preview", icon: <Eye className="h-3.5 w-3.5" /> },
                { id: "files", label: `Files (${files.length})`, icon: <FileCode2 className="h-3.5 w-3.5" /> },
                { id: "logs", label: "Logs", icon: <ScrollText className="h-3.5 w-3.5" /> },
              ]}
              active={tab}
              onChange={setTab}
            />
            {tab === "preview" && previewSrc ? (
              <a
                href={previewSrc}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost btn-sm"
              >
                <ExternalLink className="h-3 w-3" /> Open
              </a>
            ) : null}
          </div>
          <div className="min-h-0 flex-1">
            {tab === "preview" ? (
              previewSrc ? (
                <iframe
                  key={iframeKey}
                  src={previewSrc}
                  className="h-full w-full border-0 bg-white"
                  title="App preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Monitor className="h-6 w-6 text-zinc-700" />
                  <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                    Preview is offline. Press <span className="text-zinc-300">Run</span> to boot the
                    sandbox, or send a chat message — the agent keeps it running.
                  </p>
                  {panelBusy ? (
                    <span className="inline-flex items-center gap-2 text-2xs text-zinc-500">
                      <Spinner className="h-3 w-3" /> working in sandbox…
                    </span>
                  ) : null}
                </div>
              )
            ) : tab === "files" ? (
              <FilesTab appId={appId} files={files} onRefresh={() => void loadApp()} />
            ) : (
              <LogsTab logs={status?.logs ?? []} />
            )}
          </div>
          {status?.lastError ? (
            <div className="shrink-0 border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
              {status.lastError}
            </div>
          ) : null}
        </section>
      </div>
      <AgentToolsDialog
        appId={appId}
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        onSaved={() => {
          setPanelBusy(true);
          void loadApp();
        }}
      />
    </div>
  );
}

export default function BuilderPage() {
  return (
    <ToastProvider>
      <BuilderInner />
    </ToastProvider>
  );
}
