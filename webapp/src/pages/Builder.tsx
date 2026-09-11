import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, streamPost } from "../lib/api";
import { toast, useAppStore } from "../lib/store";
import { Dialog, Spinner, StatusDot, Tabs, useClickOutside } from "../components/ui";
import { timeAgo } from "./Dashboard";
import {
  ArrowLeft, Bot, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDot,
  Code2, ExternalLink, FileDiff, FilePlus2, FileX2, Hammer, Infinity as Refresh, ListChecks,
  Lock, MessageCircleQuestion, Paperclip, Pencil, Play, Plug, Redo2, RotateCw, Send,
  ShieldAlert, Sparkles, Square, Terminal, Trash2, Unlock, Wrench, Zap,
} from "lucide-react";

interface ToolActivity {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  status: "running" | "completed" | "error" | "awaiting_consent";
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  model?: string;
  activity?: ToolActivity[];
  todos?: { id: string; content: string; status: string }[];
  error?: string;
  filesChanged?: { path: string; action: string }[];
}

interface Chat {
  id: string;
  appId: string;
  title: string;
  messages: Message[];
  status: string;
}

interface AppRow {
  id: string;
  name: string;
  description: string;
  emoji: string;
  sandbox: {
    status: string;
    mode: "e2b" | "local";
    previewUrl?: string;
    lastError?: string;
  };
  config: { installedMcpServerIds: string[]; installedSkillIds: string[] };
}

interface ModelRow {
  providerId: string;
  apiName: string;
  displayName: string;
  enabled: boolean;
  providerName: string;
}

export default function Builder() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { settings } = useAppStore();

  const [app, setApp] = useState<AppRow | null>(null);
  const [chats, setChats] = useState<{ id: string; title: string; messageCount: number }[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<{ content: string; activity: ToolActivity[] } | null>(null);
  const [pendingConsent, setPendingConsent] = useState<{ activityId: string; toolName: string; args: Record<string, unknown>; reason: string } | null>(null);
  const [model, setModel] = useState<string>(settings?.defaultModel ?? "");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [mode, setMode] = useState<"agent" | "ask">("agent");
  const [input, setInput] = useState("");
  const [rightTab, setRightTab] = useState("preview");
  const [previewKey, setPreviewKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Data loading ---------------------------------------------------------
  const loadApp = useCallback(async () => {
    if (!appId) return;
    try {
      const { app } = await api.get<{ app: AppRow }>(`/api/apps/${appId}`);
      setApp(app);
    } catch (e: any) {
      toast("error", e.message);
      navigate("/");
    }
  }, [appId, navigate]);

  const loadChats = useCallback(async () => {
    if (!appId) return;
    const { chats } = await api.get<{ chats: any[] }>(`/api/apps/${appId}/chats`);
    setChats(chats);
    return chats;
  }, [appId]);

  useEffect(() => {
    loadApp();
    const t = setInterval(loadApp, 5000);
    return () => clearInterval(t);
  }, [loadApp]);

  useEffect(() => {
    loadChats()
      .then(async (list) => {
        if (list && list.length > 0) {
          const { chat } = await api.get<{ chat: Chat }>(`/api/chats/${list[0].id}`);
          setChat(chat);
          setMessages(chat.messages ?? []);
        }
      })
      .catch((e) => toast("error", e.message));
  }, [loadChats]);

  useEffect(() => {
    api
      .get<{ models: ModelRow[] }>("/api/models")
      .then((r) => {
        setModels(r.models.filter((m) => m.enabled));
        if (!model && r.models.length > 0) {
          const def = r.models.find((m) => `${m.providerId}:${m.apiName}` === (settings?.defaultModel ?? "")) ?? r.models.find((m) => m.enabled);
          if (def) setModel(`${def.providerId}:${def.apiName}`);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Sending ---------------------------------------------------------------
  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    if (!chat) {
      toast("error", "Chat is not ready yet — try again in a moment");
      return;
    }
    if (!model) {
      toast("error", "No model selected. Activate one in Settings → Models.");
      return;
    }
    setInput("");
    setMessages((m) => [...m, { id: `tmp_${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() }]);
    setStreaming(true);
    setDraft({ content: "", activity: [] });
    const controller = new AbortController();
    abortRef.current = controller;

    await streamPost(
      `/api/chats/${chat.id}/messages`,
      { content, model, mode },
      {
        onEvent: (event) => {
          switch (event.type) {
            case "text_delta":
              setDraft((d) => (d ? { ...d, content: d.content + event.delta } : d));
              break;
            case "tool_start":
              setDraft((d) => (d ? { ...d, activity: [...d.activity, event.activity] } : d));
              break;
            case "tool_result":
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      activity: d.activity.map((a) => (a.id === event.activity.id ? event.activity : a)),
                    }
                  : d,
              )
              break;
            case "summary":
              setChat((c) => (c ? { ...c, title: event.summary } : c));
              break;
            case "todos":
              setDraft((d) => {
                if (!d) return d;
                return { ...d, ...({ todos: event.todos } as any) };
              });
              break;
            case "consent_request":
              setPendingConsent(event);
              break;
            case "message_done": {
              const msg: Message = {
                ...event.message,
                todos: (draftRef.current as any)?.todos,
              };
              setMessages((m) => [...m, msg]);
              setDraft(null);
              break;
            }
            case "error":
              toast("error", event.error);
              break;
            case "done":
              break;
          }
        },
        onError: (err) => toast("error", err),
      },
      controller.signal,
    ).catch(() => {});

    setStreaming(false);
    setDraft(null);
    setPendingConsent(null);
    abortRef.current = null;
    loadChats().catch(() => {});
    loadApp().catch(() => {});
  };

  // keep latest draft for message_done todo capture
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const stop = () => {
    abortRef.current?.abort();
    if (chat) api.post(`/api/chats/${chat.id}/stop`).catch(() => {});
  };

  const answerConsent = async (allow: boolean) => {
    if (!chat || !pendingConsent) return;
    try {
      await api.post(`/api/chats/${chat.id}/consent`, { activityId: pendingConsent.activityId, decision: allow ? "allow" : "deny" });
      setPendingConsent(null);
    } catch (e: any) {
      toast("error", e.message);
    }
  };

  const newChat = async () => {
    if (!app) return;
    const { chat } = await api.post<{ chat: Chat }>(`/api/apps/${app.id}/chats`);
    setChat(chat);
    setMessages([]);
    setChats((c) => [{ id: chat.id, title: chat.title, messageCount: 0 }, ...c]);
  };

  const previewSrc = useMemo(() => {
    if (!app) return null;
    if (app.sandbox.mode === "local") return `/preview/${app.id}/`;
    return app.sandbox.previewUrl ?? null;
  }, [app]);

  if (!app) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <Spinner className="mr-2" /> Loading workspace...
      </div>
    );
  }

  const status = app.sandbox.status;

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/" className="btn-ghost !h-8 !px-2" title="All apps">
            <ArrowLeft size={15} />
          </Link>
          <span className="text-base">{app.emoji}</span>
          <span className="truncate text-sm font-semibold">{app.name}</span>
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-2xs text-ink-mute">
            <StatusDot status={status} />
            {status === "provisioning" ? "setting up sandbox" : status}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ModelPicker models={models} value={model} onChange={setModel} />
          <CommandButtons app={app} onRefreshPreview={() => setPreviewKey((k) => k + 1)} onChanged={loadApp} />
        </div>
      </header>

      {/* ---- Body ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <section className="flex w-[42%] min-w-[380px] max-w-[560px] flex-col border-r border-line bg-surface-1">
          <ChatHistoryBar
            chats={chats}
            activeChatId={chat?.id}
            onSelect={async (id) => {
              const { chat } = await api.get<{ chat: Chat }>(`/api/chats/${id}`);
              setChat(chat);
              setMessages(chat.messages ?? []);
            }}
            onNew={newChat}
          />
          <MessageList messages={messages} draft={draft} streaming={streaming} consent={pendingConsent} onConsent={answerConsent} />
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stop}
            streaming={streaming}
            mode={mode}
            onModeChange={setMode}
            modelLabel={models.find((m) => `${m.providerId}:${m.apiName}` === model)?.displayName}
          />
        </section>

        {/* Right panel */}
        <section className="flex min-w-0 flex-1 flex-col bg-surface-0">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-2">
            <Tabs
              active={rightTab}
              onChange={setRightTab}
              tabs={[
                { id: "preview", label: <><Play size={13} /> Preview</> },
                { id: "code", label: <><Code2 size={13} /> Code</> },
                { id: "logs", label: <><Terminal size={13} /> Logs</> },
                { id: "integrations", label: <><Plug size={13} /> Integrations</> },
              ]}
            />
            {rightTab === "preview" && previewSrc && status === "running" && (
              <div className="flex items-center gap-1">
                <button className="btn-ghost !h-7 !px-2 text-xs" title="Reload preview" onClick={() => setPreviewKey((k) => k + 1)}>
                  <RotateCw size={13} />
                </button>
                <a className="btn-ghost !h-7 !px-2 text-xs" title="Open in new tab" href={previewSrc} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} />
                </a>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {rightTab === "preview" && (
              <PreviewArea status={status} src={previewSrc} previewKey={previewKey} error={app.sandbox.lastError} />
            )}
            {rightTab === "code" && <CodePanel appId={app.id} onRefresh={previewKey} />}
            {rightTab === "logs" && <LogsPanel appId={app.id} />}
            {rightTab === "integrations" && <IntegrationsPanel app={app} onChanged={loadApp} />}
          </div>
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// Header pieces
// ============================================================================

function ModelPicker({ models, value, onChange }: { models: ModelRow[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const current = models.find((m) => `${m.providerId}:${m.apiName}` === value);
  return (
    <div className="relative" ref={ref}>
      <button className="btn-secondary btn-sm max-w-56" onClick={() => setOpen((o) => !o)}>
        <Sparkles size={12} className="text-accent" />
        <span className="truncate">{current ? current.displayName : value || "Select model"}</span>
        <ChevronDown size={12} className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-72 rounded-lg border border-line bg-surface-2 p-1.5 shadow-pop animate-slide-up">
          <div className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wide text-ink-faint">Active models</div>
          {models.length === 0 && (
            <div className="px-2 py-3 text-xs text-ink-mute">
              No models activated.{" "}
              <Link to="/settings?tab=models" className="text-accent hover:underline">
                Open Settings → Models
              </Link>{" "}
              to pull your provider's model list.
            </div>
          )}
          {models.map((m) => {
            const id = `${m.providerId}:${m.apiName}`;
            return (
              <button
                key={id}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-3 ${value === id ? "text-accent" : "text-ink-dim"}`}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <span className="truncate">
                  {m.displayName}
                  <span className="ml-1.5 text-2xs text-ink-faint">{m.providerName}</span>
                </span>
                {value === id && <Check size={12} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommandButtons({ app, onRefreshPreview, onChanged }: { app: AppRow; onRefreshPreview: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRecreate, setConfirmRecreate] = useState(false);
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
      toast("success", `${name} done`);
      onChanged();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  };
  const status = app.sandbox.status;
  return (
    <>
      {status === "running" && (
        <>
          <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => run("Refresh", async () => onRefreshPreview())} title="Refresh preview">
            <RotateCw size={12} className={busy === "Refresh" ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            className="btn-secondary btn-sm"
            disabled={!!busy}
            onClick={() => run("Restart", () => api.post(`/api/apps/${app.id}/restart`))}
            title="Restart the dev server"
          >
            {busy === "Restart" ? <Spinner size={12} /> : <Play size={12} />} Restart
          </button>
          <button
            className="btn-secondary btn-sm"
            disabled={!!busy}
            onClick={() => run("Rebuild", () => api.post(`/api/apps/${app.id}/rebuild`))}
            title="Reinstall dependencies and restart"
          >
            {busy === "Rebuild" ? <Spinner size={12} /> : <Hammer size={12} />} Rebuild
          </button>
        </>
      )}
      {status !== "running" && status !== "provisioning" && (
        <button
          className="btn-primary btn-sm"
          disabled={!!busy}
          onClick={() => run("Start", () => api.post(`/api/apps/${app.id}/start`))}
        >
          {busy === "Start" ? <Spinner size={12} /> : <Zap size={12} />} Start app
        </button>
      )}
      {(status === "error" || status === "stopped") && app.sandbox.mode === "e2b" && (
        <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirmRecreate(true)} title="Recreate sandbox from latest snapshot">
          <Refresh size={12} /> Recreate sandbox
        </button>
      )}
      <Dialog
        open={confirmRecreate}
        onClose={() => setConfirmRecreate(false)}
        title="Recreate sandbox?"
        description="E2B sandboxes expire. Your latest files were snapshotted and will be restored into a fresh sandbox, then dependencies reinstalled. This takes a few minutes."
      >
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirmRecreate(false)}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => {
              setConfirmRecreate(false);
              run("Recreate sandbox", () => api.post(`/api/apps/${app.id}/recreate`));
            }}
          >
            Recreate
          </button>
        </div>
      </Dialog>
    </>
  );
}

// ============================================================================
// Chat
// ============================================================================

function ChatHistoryBar({
  chats,
  activeChatId,
  onSelect,
  onNew,
}: {
  chats: { id: string; title: string; messageCount: number }[];
  activeChatId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div className="relative flex h-9 shrink-0 items-center justify-between border-b border-line px-2" ref={ref}>
      <button className="btn-ghost !h-7 max-w-64 text-xs" onClick={() => setOpen((o) => !o)}>
        <MessageCircleQuestion size={12} className="text-ink-faint" />
        <span className="truncate">{chats.find((c) => c.id === activeChatId)?.title ?? "New chat"}</span>
        <ChevronDown size={11} className="text-ink-faint" />
      </button>
      <button className="btn-ghost !h-7 text-xs" onClick={onNew}>
        <Pencil size={12} /> New chat
      </button>
      {open && (
        <div className="absolute left-2 top-9 z-40 w-80 rounded-lg border border-line bg-surface-2 p-1.5 shadow-pop animate-slide-up">
          {chats.map((c) => (
            <button
              key={c.id}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-3 ${c.id === activeChatId ? "text-accent" : "text-ink-dim"}`}
              onClick={() => {
                onSelect(c.id);
                setOpen(false);
              }}
            >
              <span className="truncate">{c.title}</span>
              <span className="text-2xs text-ink-faint">{c.messageCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageList({
  messages,
  draft,
  streaming,
  consent,
  onConsent,
}: {
  messages: Message[];
  draft: { content: string; activity: ToolActivity[] } | null;
  streaming: boolean;
  consent: { activityId: string; toolName: string; args: Record<string, unknown>; reason: string } | null;
  onConsent: (allow: boolean) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, draft?.content, draft?.activity.length, consent]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {messages.length === 0 && !draft && <EmptyChat />}
      <div className="space-y-5">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-br-sm border border-line bg-surface-3 px-3.5 py-2.5 text-sm text-ink whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantMessage key={m.id} message={m} />
          ),
        )}
        {draft && (
          <AssistantMessage
            message={{
              id: "draft",
              role: "assistant",
              content: draft.content,
              createdAt: "",
              activity: draft.activity,
              todos: (draft as any).todos,
            }}
            streaming
          />
        )}
        {streaming && !draft?.content && (draft?.activity.length ?? 0) === 0 && (
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <Spinner size={12} /> Thinking...
          </div>
        )}
      </div>
      {consent && (
        <div className="sticky bottom-0 mt-4">
          <ConsentCard consent={consent} onConsent={onConsent} />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center pt-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2">
        <Bot size={20} className="text-accent" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">Build with the agent</h3>
      <p className="hint mt-1 max-w-64">
        Describe what you want. The agent reads and edits real files in the sandbox, installs packages, and verifies in the live preview.
      </p>
      <div className="mt-5 grid w-full max-w-72 grid-cols-1 gap-1.5 text-left">
        {[
          "Add a settings page with profile fields and a dark mode toggle",
          "Create a dashboard with stat cards and a bar chart",
          "Build a todo list with filters and localStorage persistence",
        ].map((s) => (
          <div key={s} className="rounded-md border border-line bg-surface-2 px-2.5 py-2 text-2xs text-ink-mute">
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  write_file: <FilePlus2 size={11} />,
  search_replace: <Pencil size={11} />,
  read_file: <FileDiff size={11} />,
  list_files: <Code2 size={11} />,
  grep: <Code2 size={11} />,
  delete_file: <FileX2 size={11} />,
  rename_file: <FileDiff size={11} />,
  run_command: <Terminal size={11} />,
  add_dependency: <Zap size={11} />,
  restart_app: <Play size={11} />,
  reinstall_and_restart_app: <Hammer size={11} />,
  read_logs: <Terminal size={11} />,
  read_skill: <Sparkles size={11} />,
  mcp_tool_call: <Plug size={11} />,
  set_chat_summary: <MessageCircleQuestion size={11} />,
  update_todos: <ListChecks size={11} />,
};

function toolSummary(name: string, args?: Record<string, unknown>): string {
  switch (name) {
    case "write_file":
    case "read_file":
    case "delete_file":
      return String(args?.path ?? "");
    case "search_replace":
      return String(args?.file_path ?? "");
    case "rename_file":
      return `${args?.old_path ?? ""} → ${args?.new_path ?? ""}`;
    case "run_command":
      return String(args?.command ?? "").slice(0, 80);
    case "add_dependency":
      return String(args?.packages ?? "");
    case "mcp_tool_call":
      return `${args?.server ?? ""}/${args?.tool ?? ""}`;
    case "list_files":
      return String(args?.directory ?? "app files");
    case "grep":
      return String(args?.query ?? "");
    case "read_skill":
      return String(args?.slug ?? "");
    case "set_chat_summary":
      return String(args?.summary ?? "");
    case "update_todos":
      return `${Array.isArray(args?.todos) ? args.todos.length : 0} item(s)`;
    default:
      return "";
  }
}

function AssistantMessage({ message, streaming }: { message: Message; streaming?: boolean }) {
  const [showActivity, setShowActivity] = useState(false);
  const hasActivity = !!message.activity?.length;
  const runningTool = message.activity?.find((a) => a.status === "running");
  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="flex h-4.5 w-4.5 items-center justify-center rounded bg-accent-soft text-accent" style={{ height: 18, width: 18 }}>
          <Bot size={11} />
        </span>
        <span className="text-2xs font-medium text-ink-faint">{streaming ? "Agent" : "Dyad Agent"}</span>
      </div>

      {hasActivity && (
        <div className="mb-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-2xs text-ink-mute hover:text-ink"
            onClick={() => setShowActivity((s) => !s)}
          >
            <Wrench size={11} />
            {message.activity!.length} tool {message.activity!.length === 1 ? "call" : "calls"}
            {runningTool && <Spinner size={10} />}
            {showActivity ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {!showActivity && message.activity!.slice(-3).map((a) => (
            <ToolRow key={a.id} activity={a} compact />
          ))}
          {showActivity && (
            <div className="mt-1.5 space-y-1">
              {message.activity!.map((a) => (
                <ToolRow key={a.id} activity={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {message.todos && message.todos.length > 0 && <TodoList todos={message.todos} />}

      {message.content && (
        <div className="md">
          <MarkdownWithCommands content={message.content} />
          {streaming && <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse-soft bg-accent align-middle" />}
        </div>
      )}

      {message.filesChanged && message.filesChanged.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {message.filesChanged.map((f, i) => (
            <span key={i} className="badge border-line bg-surface-2 text-ink-mute">
              {f.action === "delete" ? <FileX2 size={10} /> : f.action === "rename" ? <FileDiff size={10} /> : <FilePlus2 size={10} />}
              {f.path}
            </span>
          ))}
        </div>
      )}

      {message.error && (
        <div className="mt-2 rounded-md border border-err/30 bg-err/5 px-3 py-2 text-xs text-err">{message.error}</div>
      )}
    </div>
  );
}

/** Renders markdown, extracting <dyad-command> tags into action chips. */
function MarkdownWithCommands({ content }: { content: string }) {
  const parts = useMemo(() => {
    const out: { type: "md" | "cmd"; value: string }[] = [];
    const regex = /<dyad-command type="(refresh|restart|rebuild)"><\/dyad-command>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      if (m.index > last) out.push({ type: "md", value: content.slice(last, m.index) });
      out.push({ type: "cmd", value: m[1] });
      last = m.index + m[0].length;
    }
    if (last < content.length) out.push({ type: "md", value: content.slice(last) });
    return out;
  }, [content]);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "md" ? (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {p.value}
          </ReactMarkdown>
        ) : (
          <span key={i} className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-2xs text-accent">
            <Zap size={11} /> Suggested action: {p.value} — use the button above the chat input
          </span>
        ),
      )}
    </>
  );
}

function ToolRow({ activity, compact }: { activity: ToolActivity; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICONS[activity.toolName] ?? <CircleDot size={11} />;
  const summary = toolSummary(activity.toolName, activity.args);
  const statusIcon =
    activity.status === "running" ? (
      <Spinner size={11} />
    ) : activity.status === "error" ? (
      <CircleAlert size={11} className="text-err" />
    ) : (
      <CircleCheck size={11} className="text-ok" />
    );
  return (
    <div className={compact ? "" : "rounded-md border border-line bg-surface-2"}>
      <button
        className={`flex w-full items-center gap-1.5 text-left text-2xs text-ink-mute ${compact ? "py-0.5" : "px-2.5 py-1.5 hover:text-ink"}`}
        onClick={() => !compact && setOpen((o) => !o)}
      >
        <span className="text-ink-faint">{icon}</span>
        <span className="font-mono">{activity.toolName}</span>
        {summary && <span className="truncate text-ink-faint">{summary}</span>}
        <span className="ml-auto">{statusIcon}</span>
      </button>
      {open && (
        <div className="border-t border-line px-2.5 py-2 font-mono text-2xs text-ink-faint">
          {activity.args && <pre className="whitespace-pre-wrap">{JSON.stringify(activity.args, null, 1).slice(0, 1200)}</pre>}
          {activity.result && <pre className="mt-1.5 whitespace-pre-wrap text-ink-dim">{activity.result.slice(0, 2000)}</pre>}
        </div>
      )}
    </div>
  );
}

function TodoList({ todos }: { todos: { id: string; content: string; status: string }[] }) {
  return (
    <div className="mb-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-ink-faint">
        <ListChecks size={11} /> Todos
      </div>
      <div className="space-y-1">
        {todos.map((t) => (
          <div key={t.id} className="flex items-start gap-2 text-xs">
            {t.status === "completed" ? (
              <Check size={12} className="mt-0.5 shrink-0 text-ok" />
            ) : t.status === "in_progress" ? (
              <Spinner size={12} className="mt-0.5 shrink-0 text-accent" />
            ) : (
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-line-strong" />
            )}
            <span className={t.status === "completed" ? "text-ink-faint line-through" : "text-ink-dim"}>{t.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsentCard({
  consent,
  onConsent,
}: {
  consent: { activityId: string; toolName: string; args: Record<string, unknown>; reason: string };
  onConsent: (allow: boolean) => void;
}) {
  return (
    <div className="panel border-warn/40 p-3.5 shadow-pop animate-slide-up">
      <div className="flex items-start gap-2.5">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Consent required</div>
          <p className="mt-0.5 text-xs text-ink-mute">{consent.reason}</p>
          <div className="mt-2 rounded-md bg-surface-1 px-2.5 py-2 font-mono text-2xs text-ink-faint">
            {consent.toolName}
            <br />
            {JSON.stringify(consent.args).slice(0, 300)}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => onConsent(false)}>Deny</button>
            <button className="btn-primary btn-sm" onClick={() => onConsent(true)}>
              <Unlock size={12} /> Allow once
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  mode,
  onModeChange,
  modelLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  mode: "agent" | "ask";
  onModeChange: (m: "agent" | "ask") => void;
  modelLabel?: string;
}) {
  return (
    <div className="shrink-0 border-t border-line bg-surface-1 p-3">
      <div className="rounded-lg border border-line bg-surface-2 focus-within:border-line-strong transition-colors">
        <textarea
          className="max-h-40 min-h-20 w-full resize-none bg-transparent px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          placeholder={mode === "agent" ? "Describe what to build or change..." : "Ask a question about the codebase..."}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className="flex items-center justify-between border-t border-line px-2.5 py-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-line bg-surface-1 p-0.5">
              {(["agent", "ask"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className={`rounded px-2 py-1 text-2xs font-medium capitalize transition-colors ${
                    mode === m ? "bg-surface-4 text-ink" : "text-ink-faint hover:text-ink-mute"
                  }`}
                  title={m === "agent" ? "Full agent: reads and edits files" : "Read-only Q&A about the app"}
                >
                  {m === "agent" ? "Build" : "Ask"}
                </button>
              ))}
            </div>
            {modelLabel && <span className="hidden text-2xs text-ink-faint sm:inline">{modelLabel}</span>}
          </div>
          {streaming ? (
            <button className="btn-secondary btn-sm" onClick={onStop}>
              <Square size={11} /> Stop
            </button>
          ) : (
            <button className="btn-primary btn-sm !px-3" onClick={onSend} disabled={!value.trim()}>
              <Send size={12} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Right panel tabs
// ============================================================================

function PreviewArea({
  status,
  src,
  previewKey,
  error,
}: {
  status: string;
  src: string | null;
  previewKey: number;
  error?: string;
}) {
  if (status === "provisioning") {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Spinner size={20} className="text-accent" />
        <div className="mt-4 text-sm font-medium">Setting up your sandbox</div>
        <div className="hint mt-1.5 max-w-64 text-center">
          Creating the cloud sandbox, uploading the project scaffold and installing dependencies. This usually takes one to three minutes.
        </div>
        <SetupSteps />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <CircleAlert size={24} className="text-err" />
        <div className="mt-3 text-sm font-medium">Sandbox error</div>
        <p className="hint mt-1 max-w-md text-center">{error ?? "Something went wrong while starting the sandbox."}</p>
        <p className="hint mt-2 max-w-md text-center">Check Settings → Sandbox for your E2B key configuration, or use Start / Recreate above.</p>
      </div>
    );
  }
  if (!src) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Play size={24} className="text-ink-faint" />
        <div className="mt-3 text-sm font-medium">Preview not ready</div>
        <div className="hint mt-1">Start the app to launch its dev server.</div>
      </div>
    );
  }
  return (
    <iframe
      key={previewKey}
      src={src}
      className="h-full w-full border-0 bg-white"
      title="App preview"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      allow="clipboard-write"
    />
  );
}

function SetupSteps() {
  const steps = ["Creating sandbox", "Uploading scaffold", "Installing dependencies", "Starting dev server"];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 25_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="mt-6 w-56 space-y-2">
      {steps.map((s, i) => (
        <div key={s} className={`flex items-center gap-2 text-xs ${i < step ? "text-ink-mute" : i === step ? "text-ink" : "text-ink-faint"}`}>
          {i < step ? <Check size={12} className="text-ok" /> : i === step ? <Spinner size={12} /> : <CircleDot size={12} />}
          {s}
        </div>
      ))}
    </div>
  );
}

// ---- Code panel ---------------------------------------------------------------

function CodePanel({ appId, onRefresh }: { appId: string; onRefresh: number }) {
  const [files, setFiles] = useState<{ path: string; isDirectory: boolean }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadFiles = () => api.get<{ files: { path: string; isDirectory: boolean }[] }>(`/api/apps/${appId}/files`).then((r) => setFiles(r.files));
  useEffect(() => {
    loadFiles().catch((e) => toast("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, onRefresh]);
  useEffect(() => {
    if (!selected) return;
    setEditing(false);
    api
      .get<{ content: string }>(`/api/apps/${appId}/file?path=${encodeURIComponent(selected)}`)
      .then((r) => setContent(r.content))
      .catch(() => setContent("// unable to load file"));
  }, [selected, appId, files]);

  const visible = files.filter((f) => !f.isDirectory && !filter && !isNoise(f.path) || (!f.isDirectory && filter && f.path.toLowerCase().includes(filter.toLowerCase())));
  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-line bg-surface-1 p-2">
        <input className="input mb-2 !h-7 text-xs" placeholder="Filter files..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        <FileTree
          files={files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()))}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3">
              <span className="truncate font-mono text-xs text-ink-mute">{selected}</span>
              <div className="flex items-center gap-1.5">
                {editing ? (
                  <>
                    <button
                      className="btn-primary btn-sm"
                      disabled={saving}
                      onClick={async () => {
                        setSaving(true);
                        try {
                          await api.put(`/api/apps/${appId}/file`, { path: selected, content });
                          toast("success", "File saved");
                          setEditing(false);
                          loadFiles();
                        } catch (e: any) {
                          toast("error", e.message);
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      {saving && <Spinner size={11} />} Save
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                  </>
                ) : (
                  <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                    <Pencil size={11} /> Edit
                  </button>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                className="min-h-0 flex-1 resize-none bg-surface-0 p-4 font-mono text-xs leading-relaxed text-ink-dim focus:outline-none"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-ink-dim">{content}</pre>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">Select a file to view it</div>
        )}
      </div>
    </div>
  );
}

function isNoise(path: string): boolean {
  return false;
}

function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: { path: string; isDirectory: boolean }[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="space-y-px">
      {files.map((f) => {
        const depth = f.path.split("/").length - 1;
        return (
          <button
            key={f.path}
            className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-3 ${
              selected === f.path ? "bg-surface-3 text-ink" : "text-ink-mute"
            }`}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => !f.isDirectory && onSelect(f.path)}
          >
            {f.isDirectory ? (
              <ChevronRight size={11} className="shrink-0 text-ink-faint" />
            ) : (
              <Code2 size={11} className="shrink-0 text-ink-faint" />
            )}
            <span className="truncate font-mono">{f.path.split("/").pop()}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Logs panel ------------------------------------------------------------

function LogsPanel({ appId }: { appId: string }) {
  const [logs, setLogs] = useState("");
  const [auto, setAuto] = useState(true);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const load = () => api.get<{ logs: string }>(`/api/apps/${appId}/logs`).then((r) => {
      setLogs(r.logs || "No logs yet.");
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    });
    load();
    if (!auto) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [appId, auto]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center justify-between border-b border-line bg-surface-1 px-3">
        <span className="text-xs text-ink-faint">Sandbox logs — dev server, commands, provisioning</span>
        <button className={`btn-ghost !h-6 !px-2 text-2xs ${auto ? "text-ok" : ""}`} onClick={() => setAuto((a) => !a)}>
          {auto ? "Live" : "Paused"}
        </button>
      </div>
      <pre ref={ref} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-2xs leading-relaxed text-ink-mute">
        {logs}
      </pre>
    </div>
  );
}

// ---- Integrations panel -------------------------------------------------------

interface McpRow {
  id: string;
  name: string;
  description: string;
}
interface SkillRow {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
}

function IntegrationsPanel({ app, onChanged }: { app: AppRow; onChanged: () => void }) {
  const [mcps, setMcps] = useState<McpRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.get<{ servers: McpRow[] }>("/api/mcp").then((r) => setMcps(r.servers)).catch(() => {});
    api.get<{ skills: SkillRow[] }>("/api/skills").then((r) => setSkills(r.skills)).catch(() => {});
  };
  useEffect(load, []);

  const toggleMcp = async (id: string, install: boolean) => {
    setBusy(id);
    try {
      if (install) {
        const res = await api.post<{ tools: number }>(`/api/apps/${app.id}/mcp/${id}`);
        toast("success", install ? `MCP server connected${res.tools ? ` — ${res.tools} tools available` : ""}` : "MCP server removed");
      } else {
        await api.del(`/api/apps/${app.id}/mcp/${id}`);
        toast("success", "MCP server removed");
      }
      onChanged();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleSkill = async (id: string, install: boolean) => {
    setBusy(id);
    try {
      if (install) await api.post(`/api/apps/${app.id}/skills/${id}`);
      else await api.del(`/api/apps/${app.id}/skills/${id}`);
      toast("success", install ? "Skill installed into sandbox" : "Skill removed");
      onChanged();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <p className="hint max-w-lg">
        Everything you enable here is provisioned into this app's sandbox: skills are written to{" "}
        <code className="font-mono text-[11px] text-ink-mute">/home/user/skills/</code> and MCP servers run behind the
        sandbox MCP bridge, available to the agent as tools.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="card-title">MCP servers</h3>
            <Link to="/settings?tab=mcp" className="text-2xs text-accent hover:underline">Manage catalog</Link>
          </div>
          <div className="mt-2 space-y-2">
            {mcps.length === 0 && (
              <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
                No MCP servers yet.{" "}
                <Link to="/settings?tab=mcp" className="text-accent hover:underline">Add one from the catalog</Link>.
              </div>
            )}
            {mcps.map((m) => {
              const installed = app.config.installedMcpServerIds.includes(m.id);
              return (
                <div key={m.id} className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-ink">
                      <Plug size={12} className="text-accent" /> {m.name}
                      {installed && <span className="badge border-ok/30 bg-ok/10 text-ok">connected</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-2xs text-ink-faint">{m.description}</p>
                  </div>
                  <button
                    className={installed ? "btn-danger btn-sm" : "btn-secondary btn-sm"}
                    disabled={busy === m.id}
                    onClick={() => toggleMcp(m.id, !installed)}
                  >
                    {busy === m.id ? <Spinner size={11} /> : installed ? "Disconnect" : "Connect"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className="card-title">Skills</h3>
            <Link to="/settings?tab=skills" className="text-2xs text-accent hover:underline">Manage skills</Link>
          </div>
          <div className="mt-2 space-y-2">
            {skills.map((s) => {
              const installed = app.config.installedSkillIds.includes(s.id);
              return (
                <div key={s.id} className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-ink">
                      <Sparkles size={12} className="text-accent" /> {s.name}
                      {s.builtin && <span className="badge border-line bg-surface-3 text-ink-faint">built-in</span>}
                      {installed && <span className="badge border-ok/30 bg-ok/10 text-ok">installed</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-2xs text-ink-faint">{s.description}</p>
                  </div>
                  <button
                    className={installed ? "btn-danger btn-sm" : "btn-secondary btn-sm"}
                    disabled={busy === s.id}
                    onClick={() => toggleSkill(s.id, !installed)}
                  >
                    {busy === s.id ? <Spinner size={11} /> : installed ? "Remove" : "Install"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
