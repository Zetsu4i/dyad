"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Brain,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderTree,
  Search,
  Package,
  RotateCw,
  Plug,
  Terminal,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, type ChatMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { useToast } from "@/hooks/use-toast";

interface ToolEvent {
  type: "tool-start" | "tool-result";
  tool: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  detail?: string;
}

interface StreamingState {
  active: boolean;
  thinking: string;
  text: string;
  tools: ToolEvent[];
  hasThinking: boolean;
  hasText: boolean;
}

interface Props {
  appId: string;
  chats: { id: string; title: string; updatedAt: string; messageCount: number }[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => Promise<void>;
  selectedModelId: string | null;
  onRefreshPreview: () => void;
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  write_file: FilePlus2,
  search_replace: FilePlus2,
  read_file: FileText,
  list_files: FolderTree,
  grep: Search,
  add_dependency: Package,
  restart_app: RotateCw,
  reinstall_and_restart_app: Package,
  run_command: Terminal,
  read_logs: Terminal,
  read_skill: FileText,
  set_chat_title: CheckCircle2,
};

export function ChatPanel({
  appId,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  selectedModelId,
  onRefreshPreview,
}: Props) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<StreamingState | null>(null);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (!activeChatId) return;
    setLoadingHistory(true);
    api.messages(appId, activeChatId)
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false));
  }, [appId, activeChatId]);

  useEffect(() => {
    if (autoScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, stream?.text, stream?.thinking, stream?.tools.length]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || stream?.active) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: message,
        thinking: null,
        toolTrace: null,
        modelId: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    setStream({ active: true, thinking: "", text: "", tools: [], hasThinking: false, hasText: false });

    try {
      const res = await fetch(`/api/apps/${appId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ message, chatId: activeChatId, modelConfigId: selectedModelId }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Stream failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chatIdFromStream: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(payload); } catch { continue; }

          if (evt.type === "chat") {
            chatIdFromStream = evt.chatId as string;
            if (chatIdFromStream !== activeChatId) onSelectChat(chatIdFromStream);
          } else if (evt.type === "text-delta") {
            setStream((s) => (s ? { ...s, text: s.text + evt.text, hasText: true } : s));
          } else if (evt.type === "thinking-delta") {
            setStream((s) => (s ? { ...s, thinking: s.thinking + evt.text, hasThinking: true } : s));
          } else if (evt.type === "tool-start" || evt.type === "tool-result") {
            const te: ToolEvent = {
              type: evt.type as ToolEvent["type"],
              tool: evt.tool as string,
              input: evt.input,
              ok: evt.ok as boolean | undefined,
              summary: evt.summary as string | undefined,
              detail: evt.detail as string | undefined,
            };
            setStream((s) => (s ? { ...s, tools: [...s.tools, te] } : s));
          } else if (evt.type === "title") {
            // update local chat list title
          } else if (evt.type === "files-changed") {
            window.dispatchEvent(new CustomEvent("forge:files-changed"));
            setTimeout(() => onRefreshPreview(), 1500);
          } else if (evt.type === "error") {
            toast({ title: "Agent error", description: String(evt.message ?? "").slice(0, 200), variant: "destructive" });
          }
        }
      }
      window.dispatchEvent(new CustomEvent("forge:files-changed"));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast({
          title: "Chat failed",
          description: err instanceof Error ? err.message : "",
          variant: "destructive",
        });
      }
    } finally {
      abortRef.current = null;
      // Reload persisted messages (includes tool traces + thinking)
      if (activeChatId) {
        api.messages(appId, activeChatId)
          .then((r) => setMessages(r.messages))
          .catch(() => {});
      }
      setStream(null);
      onRefreshPreview();
    }
  }, [input, stream, appId, activeChatId, selectedModelId, toast, onSelectChat, onRefreshPreview]);

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {/* Chat panel header: session selector */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800/80 px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-zinc-300 hover:text-zinc-100">
              <History className="h-3.5 w-3.5 text-zinc-500" />
              <span className="truncate">{activeChat?.title ?? "New chat"}</span>
              <ChevronRight className="h-3 w-3 rotate-90 text-zinc-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60 border-zinc-800 bg-zinc-900">
            {chats.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => onSelectChat(c.id)}
                className={cn("text-xs", c.id === activeChatId && "bg-zinc-800")}
              >
                <span className="truncate">{c.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewChat}
          className="h-7 gap-1 px-2 text-xs text-zinc-400 hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4" onScroll={handleScroll}>
        {loadingHistory && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
          </div>
        )}
        {!loadingHistory && messages.length === 0 && !stream && <EmptyState />}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id} message={m} />
          ) : (
            <AssistantMessage key={m.id} message={m} />
          )
        )}
        {stream && <StreamingMessage state={stream} />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-800/80 p-3">
        <div className="relative rounded-lg border border-zinc-800 bg-zinc-900/60 focus-within:border-zinc-600">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Describe what to build or change…"
            className="min-h-[72px] resize-none border-0 bg-transparent px-3.5 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0"
            disabled={stream?.active}
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[11px] text-zinc-600">
              Enter to send · Shift+Enter for newline
            </span>
            <Button
              size="sm"
              onClick={() => (stream?.active ? abortRef.current?.abort() : send())}
              disabled={!input.trim() && !stream?.active}
              className={cn(
                "h-8 w-8 p-0",
                stream?.active
                  ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  : "bg-zinc-100 text-zinc-900 hover:bg-white"
              )}
              title={stream?.active ? "Stop" : "Send"}
            >
              {stream?.active ? (
                <span className="h-2.5 w-2.5 rounded-[2px] bg-red-400" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900">
        <Brain className="h-5 w-5 text-zinc-500" />
      </div>
      <h3 className="mt-4 text-[15px] font-medium text-zinc-200">What should we build?</h3>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-zinc-500">
        Describe your app and the agent will write files, run commands, and verify
        changes inside the sandbox.
      </p>
      <div className="mt-5 space-y-1.5 text-[13px] text-zinc-500">
        <Suggestion text="Build a pricing page with three tiers and a monthly/yearly toggle" />
        <Suggestion text="Create a dashboard with sidebar navigation and stat cards" />
        <Suggestion text="Add a REST API with CRUD endpoints for tasks" />
      </div>
    </div>
  );
}

function Suggestion({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-left text-zinc-400">
      {text}
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="message-in mb-5 flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-zinc-800/70 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-100">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const thinking = message.thinking;
  const tools: ToolEvent[] = message.toolTrace ? safeParse(message.toolTrace) : [];
  return (
    <div className="message-in mb-6">
      {thinking && <ThinkingBlock text={thinking} done />}
      {tools.filter((t) => t.type === "tool-result").map((t, i) => (
        <ToolChip key={i} event={t} />
      ))}
      <div className="prose-forge text-sm leading-relaxed text-zinc-200">
        <Markdown content={message.content} />
      </div>
    </div>
  );
}

function StreamingMessage({ state }: { state: StreamingState }) {
  const toolResults = state.tools.filter((t) => t.type === "tool-result");
  const lastTool = state.tools[state.tools.length - 1];
  return (
    <div className="message-in mb-6">
      {state.hasThinking && <ThinkingBlock text={state.thinking} done={false} />}
      {!state.hasText && !state.hasThinking && state.tools.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-400" />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-400" />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-400" />
          <span className="ml-1">Thinking…</span>
        </div>
      )}
      {state.tools.length === 0 && !state.hasText && state.hasThinking && (
        <div className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500">
          <Brain className="h-3.5 w-3.5 animate-pulse" />
          <span>Thinking…</span>
        </div>
      )}
      {toolResults.map((t, i) => (
        <ToolChip key={i} event={t} />
      ))}
      {lastTool?.type === "tool-start" && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="capitalize">{toolLabel(lastTool.tool)}…</span>
        </div>
      )}
      {state.hasText && (
        <div className="prose-forge text-sm leading-relaxed text-zinc-200">
          <Markdown content={state.text} />
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2.5 overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-300"
      >
        <Brain className={cn("h-3.5 w-3.5", !done && "animate-pulse")} />
        <span>{done ? "Thought process" : "Thinking…"}</span>
        <ChevronRight className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-zinc-800/60 px-3 py-2.5 text-xs leading-relaxed text-zinc-500">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolChip({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[event.tool] ?? Plug;
  const isMcp = event.tool.startsWith("mcp_");
  const display = isMcp ? `${event.tool.replace(/^mcp_/, "").replace(/_/g, " · ")}` : toolLabel(event.tool);
  return (
    <div className="mb-1.5 overflow-hidden rounded-md border border-zinc-800/70 bg-zinc-900/50">
      <button
        onClick={() => event.detail && setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        {event.ok === false ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="truncate text-zinc-300">
          {event.summary ?? display}
        </span>
        {event.detail && (
          <ChevronRight className={cn("ml-auto h-3 w-3 shrink-0 text-zinc-600 transition-transform", open && "rotate-90")} />
        )}
      </button>
      {open && event.detail && (
        <pre className="max-h-48 overflow-auto border-t border-zinc-800/60 bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
          {event.detail}
        </pre>
      )}
    </div>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
            {children}
          </pre>
        ),
        code: ({ children, className }) =>
          className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
              {children}
            </code>
          ),
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-zinc-300 underline underline-offset-2 hover:text-white">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold text-zinc-100">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-4 text-[15px] font-semibold text-zinc-100">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-medium text-zinc-200">{children}</h3>,
        p: ({ children }) => <p className="my-1.5">{children}</p>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function toolLabel(tool: string): string {
  switch (tool) {
    case "write_file": return "Created file";
    case "search_replace": return "Edited file";
    case "read_file": return "Read file";
    case "list_files": return "Listed files";
    case "grep": return "Searched code";
    case "add_dependency": return "Installed packages";
    case "restart_app": return "Restarted dev server";
    case "reinstall_and_restart_app": return "Reinstalled dependencies";
    case "run_command": return "Ran command";
    case "read_logs": return "Read server logs";
    case "read_skill": return "Read skill";
    case "set_chat_title": return "Set title";
    default: return tool.replace(/_/g, " ");
  }
}

function safeParse(s: string): ToolEvent[] {
  try { return JSON.parse(s) as ToolEvent[]; } catch { return []; }
}
