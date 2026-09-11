import React from "react";
import { useParams } from "react-router-dom";
import {
  Send, RefreshCw, RotateCcw, Plus, MessageSquare, FolderTree, TerminalSquare,
  Eye, Wrench, ChevronDown, ChevronRight, Loader2, Cloud, Monitor, StopCircle, FileText,
} from "lucide-react";
import { api, AppItem, Chat, ChatMsg } from "../lib/api";
import { useData, useToast } from "../state/store";
import { Button, Badge, StatusDot, Spinner, Select, EmptyState } from "../components/ui";

type Mode = "build" | "agent" | "ask";

interface ToolEvent {
  id: string;
  name: string;
  args?: string;
  ok?: boolean;
  output?: string;
  open?: boolean;
}

export function BuilderPage() {
  const { appId } = useParams();
  const toast = useToast();
  const { settings, refreshApps } = useData();
  const [app, setApp] = React.useState<AppItem | null>(null);
  const [chats, setChats] = React.useState<Chat[]>([]);
  const [chat, setChat] = React.useState<Chat | null>(null);
  const [input, setInput] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("build");
  const [model, setModel] = React.useState<{ providerId: string; modelId: string } | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [liveText, setLiveText] = React.useState("");
  const [tools, setTools] = React.useState<ToolEvent[]>([]);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [rightTab, setRightTab] = React.useState<"preview" | "files" | "logs">("preview");
  const [tree, setTree] = React.useState<string[]>([]);
  const [openFile, setOpenFile] = React.useState<string | null>(null);
  const [fileContent, setFileContent] = React.useState("");
  const [previewKey, setPreviewKey] = React.useState(0);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const activeModels = (settings?.activeModels || []).filter((m) => m.enabled);

  const loadApp = React.useCallback(async () => {
    if (!appId) return;
    const a = await api.get<AppItem>(`/api/apps/${appId}`);
    setApp(a);
    if (a.status === "ready" && !previewUrl) {
      try {
        const p = await api.get<{ url: string }>(`/api/apps/${appId}/preview`);
        setPreviewUrl(p.url);
      } catch {}
    }
  }, [appId]);

  const loadChats = React.useCallback(async () => {
    if (!appId) return;
    const d = await api.get<{ chats: Chat[] }>(`/api/apps/${appId}/chats`);
    setChats(d.chats);
    if (!chat && d.chats.length > 0) setChat(d.chats[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const loadTree = React.useCallback(async () => {
    if (!appId) return;
    try {
      const d = await api.get<{ tree: string[] }>(`/api/apps/${appId}/tree`);
      setTree(d.tree);
    } catch {}
  }, [appId]);

  React.useEffect(() => {
    setChat(null); setChats([]); setPreviewUrl(null); setPreviewKey(0);
    loadApp(); loadChats();
  }, [appId, loadApp, loadChats]);

  React.useEffect(() => {
    if (app?.status === "provisioning") {
      const t = setInterval(loadApp, 4000);
      return () => clearInterval(t);
    }
    if (app?.status === "ready") loadTree();
  }, [app?.status, loadApp, loadTree]);

  React.useEffect(() => {
    if (settings && !model) {
      const d = settings.defaultModel;
      const ok = activeModels.some((m) => m.providerId === d?.providerId && m.modelId === d?.modelId);
      setModel(ok ? d : activeModels[0] || { providerId: "mock", modelId: "mock-agent" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, liveText]);

  const newChat = async () => {
    try {
      const c = await api.post<Chat>(`/api/apps/${appId}/chats`, {});
      setChats((cs) => [c, ...cs]);
      setChat(c);
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const selectChat = async (id: string) => {
    try {
      setChat(await api.get<Chat>(`/api/chats/${id}`));
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const openFileView = async (p: string) => {
    try {
      setOpenFile(p);
      const d = await api.get<{ content: string }>(`/api/apps/${appId}/file?path=${encodeURIComponent(p)}`);
      setFileContent(d.content);
      setRightTab("files");
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !chat || !model) return;
    setInput("");
    setStreaming(true);
    setLiveText("");
    setTools([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // optimistic user message
    setChat((c) => (c ? { ...c, messages: [...c.messages, { id: `tmp-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() }] } : c));

    try {
      const res = await fetch(`/api/chats/${chat.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, mode, model }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      const handle = (ev: any) => {
        switch (ev.type) {
          case "user":
            // replace optimistic
            setChat((c) => {
              if (!c) return c;
              const msgs = c.messages.filter((m) => !String(m.id).startsWith("tmp-"));
              return { ...c, messages: [...msgs, ev.message] };
            });
            break;
          case "token":
            acc += ev.text;
            setLiveText(acc);
            break;
          case "tool_start":
            setTools((t) => [...t, { id: ev.id, name: ev.name, args: ev.args }]);
            break;
          case "tool_end":
            setTools((t) => t.map((x) => (x.id === ev.id ? { ...x, ok: ev.ok, output: ev.output } : x)));
            loadTree();
            break;
          case "file":
            setLogs((l) => [...l.slice(-200), `📄 ${ev.action}: ${ev.path}`]);
            loadTree();
            break;
          case "todos":
            setLogs((l) => [...l.slice(-200), `☑ ${(ev.todos || []).map((t: any) => `[${t.status}] ${t.text}`).join(" · ")}`]);
            break;
          case "log":
            setLogs((l) => [...l.slice(-300), typeof ev.text === "string" ? ev.text.slice(0, 2000) : ""]);
            break;
          case "command":
            if (ev.command === "refresh") setPreviewKey((k) => k + 1);
            break;
          case "done":
            setChat((c) => (c ? { ...c, messages: [...c.messages, ev.message], title: ev.title || c.title } : c));
            setChats((cs) => cs.map((x) => (x.id === chat.id ? { ...x, title: ev.title || x.title } : x)));
            setLiveText("");
            loadTree();
            break;
          case "error":
            toast(ev.error, "err");
            setLiveText(acc ? acc + `\n\n⚠️ ${ev.error}` : `⚠️ ${ev.error}`);
            break;
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const p of parts) {
          const line = p.trim();
          if (!line.startsWith("data:")) continue;
          try {
            handle(JSON.parse(line.slice(5).trim()));
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") toast(e.message, "err");
    } finally {
      setStreaming(false);
      abortRef.current = null;
      refreshApps();
    }
  };

  const stop = () => abortRef.current?.abort();

  const restart = async () => {
    try {
      await api.post(`/api/apps/${appId}/restart`, {});
      toast("Dev server restarted");
      setTimeout(() => setPreviewKey((k) => k + 1), 4000);
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const rebuild = async () => {
    if (!confirm("Rebuild the sandbox (reinstall dependencies)?")) return;
    try {
      await api.post(`/api/apps/${appId}/rebuild`, {});
      toast("Rebuild started");
      loadApp();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  if (!app) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  if (app.status !== "ready") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-semibold">{app.name}</h1>
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          {app.status === "provisioning" ? (
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <Spinner /> Provisioning cloud sandbox — installing the starter template…
            </div>
          ) : (
            <div className="text-sm text-red-400">Provisioning failed: {app.error}</div>
          )}
          <div className="mt-4 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-400">
            {(app.log || []).map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">{l.text}</div>
            ))}
            {(app.log || []).length === 0 && <div className="text-zinc-600">Waiting for logs…</div>}
          </div>
          {app.status === "error" && (
            <div className="mt-3"><Button variant="secondary" onClick={rebuild}>Retry provisioning</Button></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* chats column */}
      <div className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="truncate text-[13px] font-semibold">{app.name}</span>
          <button onClick={newChat} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="New chat">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 px-3 pb-2">
          {app.sandboxDriver === "e2b" ? <Badge><Cloud size={11} /> E2B</Badge> : <Badge tone="amber"><Monitor size={11} /> Local</Badge>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => selectChat(c.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
                chat?.id === c.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <MessageSquare size={13} className="shrink-0" />
              <span className="truncate">{c.title}</span>
            </button>
          ))}
          {chats.length === 0 && (
            <button onClick={newChat} className="w-full rounded-md border border-dashed border-zinc-800 px-2 py-3 text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-300">
              Start the first chat
            </button>
          )}
        </div>
      </div>

      {/* chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!chat && <EmptyState title="No chat selected" desc="Start a chat to begin building." action={<Button onClick={newChat}>New chat</Button>} />}
            {chat?.messages.map((m) => <Msg key={m.id} m={m} />)}
            {streaming && (
              <div className="mb-4">
                {liveText && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                    <Markdown text={liveText} />
                  </div>
                )}
                {tools.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {tools.map((t) => <ToolCard key={t.id} t={t} />)}
                  </div>
                )}
                {!liveText && tools.length === 0 && (
                  <div className="flex items-center gap-2 text-[13px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> Thinking…</div>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* composer */}
          <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 focus-within:border-zinc-500">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder={chat ? `Ask ${mode === "ask" ? "about the code" : "to build something"}…  (Enter to send, Shift+Enter for newline)` : "Select or create a chat first"}
                disabled={!chat}
                rows={3}
                className="w-full resize-none bg-transparent px-3.5 pt-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <ModeButton cur={mode} set={setMode} id="build" label="Build" />
                  <ModeButton cur={mode} set={setMode} id="agent" label="Agent" />
                  <ModeButton cur={mode} set={setMode} id="ask" label="Ask" />
                  <span className="mx-1 h-4 w-px bg-zinc-800" />
                  <Select value={model ? `${model.providerId}::${model.modelId}` : ""} onChange={(e) => {
                    const [providerId, modelId] = e.target.value.split("::");
                    setModel({ providerId, modelId });
                  }} title="Model">
                    {activeModels.length === 0 && <option value="mock::mock-agent">mock-agent (offline test)</option>}
                    {activeModels.map((m) => (
                      <option key={`${m.providerId}::${m.modelId}`} value={`${m.providerId}::${m.modelId}`}>
                        {m.modelId}
                      </option>
                    ))}
                    <option value="mock::mock-agent">mock-agent (offline test)</option>
                  </Select>
                </div>
                {streaming ? (
                  <Button variant="danger" size="sm" onClick={stop}><StopCircle size={14} /> Stop</Button>
                ) : (
                  <Button size="sm" onClick={send} disabled={!chat || !input.trim()}>
                    <Send size={13} /> Send
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-1.5 text-[11px] text-zinc-600">
              {mode === "build" ? "Build: fast file edits from your prompt." : mode === "agent" ? "Agent: plans, uses tools, verifies with type checks." : "Ask: read-only answers about the codebase."}
            </div>
          </div>
        </div>
      </div>

      {/* right panel */}
      <div className="flex w-[46%] min-w-[380px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-800 px-2">
          <div className="flex">
            <RTab id="preview" cur={rightTab} set={setRightTab} icon={<Eye size={13} />} label="Preview" />
            <RTab id="files" cur={rightTab} set={setRightTab} icon={<FolderTree size={13} />} label="Files" />
            <RTab id="logs" cur={rightTab} set={setRightTab} icon={<TerminalSquare size={13} />} label={`Logs${logs.length ? ` (${logs.length})` : ""}`} />
          </div>
          <div className="flex items-center gap-1 pr-1">
            <button onClick={() => setPreviewKey((k) => k + 1)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Refresh preview">
              <RefreshCw size={14} />
            </button>
            <button onClick={restart} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Restart dev server">
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {rightTab === "preview" && (
            previewUrl ? (
              <iframe key={previewKey} src={previewUrl} title="preview" className="h-full w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-zinc-500"><Spinner /> <span className="ml-2">Loading preview…</span></div>
            )
          )}
          {rightTab === "files" && (
            <div className="flex h-full">
              <div className="w-48 shrink-0 overflow-y-auto border-r border-zinc-800 p-1.5">
                {tree.map((t) => (
                  <button
                    key={t}
                    onClick={() => { const p = t.replace(/^\.\//, ""); if (!p.endsWith("/")) openFileView(p); }}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] ${
                      openFile === t.replace(/^\.\//, "") ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
                    }`}
                  >
                    <FileText size={11} className="shrink-0" />
                    <span className="truncate">{t.replace(/^\.\//, "")}</span>
                  </button>
                ))}
                {tree.length === 0 && <div className="p-2 text-xs text-zinc-600">No files listed.</div>}
              </div>
              <div className="min-w-0 flex-1 overflow-auto bg-[#0c0c0e] p-3">
                {openFile ? (
                  <>
                    <div className="mb-2 font-mono text-[11px] text-zinc-500">{openFile}</div>
                    <pre className="font-mono text-[11.5px] leading-relaxed text-zinc-300">{fileContent}</pre>
                  </>
                ) : (
                  <div className="text-xs text-zinc-600">Select a file to view its content.</div>
                )}
              </div>
            </div>
          )}
          {rightTab === "logs" && (
            <div className="h-full overflow-y-auto bg-[#0c0c0e] p-3 font-mono text-[11.5px] leading-relaxed text-zinc-400">
              {logs.map((l, i) => <div key={i} className="whitespace-pre-wrap border-b border-zinc-900/60 py-0.5">{l}</div>)}
              {logs.length === 0 && <div className="text-zinc-600">Tool calls and sandbox output will appear here.</div>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-600">
          <StatusDot tone="green" />
          <span className="truncate">{app.sandboxDriver === "e2b" ? `E2B sandbox ${app.sandboxId}` : `Local emulation ${app.sandboxId}`}</span>
          {previewUrl && app.sandboxDriver === "e2b" && (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-300">Open in tab ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({ cur, set, id, label }: { cur: Mode; set: (m: Mode) => void; id: Mode; label: string }) {
  return (
    <button
      onClick={() => set(id)}
      className={`rounded px-2 py-1 text-xs font-medium ${cur === id ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
    >
      {label}
    </button>
  );
}

function RTab({ id, cur, set, icon, label }: { id: "preview" | "files" | "logs"; cur: string; set: (v: any) => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={() => set(id)}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium ${cur === id ? "border-zinc-100 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
    >
      {icon} {label}
    </button>
  );
}

function Msg({ m }: { m: ChatMsg }) {
  if (m.role === "user") {
    return (
      <div className="mb-4 flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-zinc-700 bg-zinc-800/70 px-3.5 py-2.5 text-sm text-zinc-100">
          <div className="whitespace-pre-wrap">{m.content}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <Markdown text={m.display || m.content} />
      {m.model && <div className="mt-2 text-[11px] text-zinc-600">{m.model}{m.mode ? ` · ${m.mode}` : ""}</div>}
    </div>
  );
}

function ToolCard({ t }: { t: ToolEvent }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/70">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        {t.ok == null ? <Loader2 size={13} className="animate-spin text-zinc-500" /> : <Wrench size={13} className={t.ok ? "text-green-500" : "text-red-500"} />}
        <code className="font-mono text-xs text-zinc-200">{t.name}</code>
        <span className="ml-auto text-zinc-600">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 px-2.5 py-1.5 font-mono text-[11px] text-zinc-400">
          {t.args && <div className="mb-1 break-all text-zinc-500">{t.args}</div>}
          {t.output && <div className="whitespace-pre-wrap break-all">{t.output.slice(0, 3000)}</div>}
        </div>
      )}
    </div>
  );
}

// Minimal markdown renderer (no dependency): code blocks, inline code, bold, headers, lists, links.
export function Markdown({ text }: { text: string }) {
  const html = React.useMemo(() => renderMd(text), [text]);
  return <div className="chatmd text-sm leading-relaxed text-zinc-200" dangerouslySetInnerHTML={{ __html: html }} />;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMd(src: string): string {
  const blocks: string[] = [];
  // fenced code
  let s = esc(src).replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const lines = s.split("\n");
  const out: string[] = [];
  let inList: string | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (inList) { out.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }
  };
  for (const line of lines) {
    if (/^\u0000\d+\u0000$/.test(line.trim())) {
      flushPara(); flushList();
      out.push(blocks[Number(line.trim().replace(/\u0000/g, ""))]);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = /^(\s*)[-*]\s+(.*)/.exec(line);
    const oli = /^(\s*)\d+\.\s+(.*)/.exec(line);
    if (li || oli) {
      flushPara();
      const kind = li ? "ul" : "ol";
      const content = (li ? li[2] : (oli as RegExpExecArray)[2]);
      if (inList !== kind) { flushList(); out.push(`<${kind}>`); inList = kind; }
      out.push(`<li>${inline(content)}</li>`);
      continue;
    }
    if (/^\s*&gt;\s?/.test(line)) {
      flushPara(); flushList();
      out.push(`<blockquote>${inline(line.replace(/^\s*&gt;\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^\s*$/.test(line)) { flushPara(); flushList(); continue; }
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}
