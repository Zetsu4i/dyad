"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  MessageSquarePlus,
  FolderSync,
  RotateCw,
  RefreshCw,
  History,
  Cpu,
} from "lucide-react";
import { MessageBlocks } from "./message-blocks";
import { useChatStream } from "@/lib/use-chat-stream";
import { api, type ActiveModel, type ChatSummary, type MessageRow } from "@/lib/types";
import { Spinner } from "@/components/ui";

/**
 * Builder chat panel — Dyad's conversation model (build/ask modes, action
 * buttons suggested via <dyad-command>, model picker) rebuilt for the web.
 */

export function ChatPanel({
  appId,
  chats,
  activeChatId,
  onChatChange,
  models,
  defaultModelKey,
  onChangesApplied,
}: {
  appId: number;
  chats: ChatSummary[];
  activeChatId: number | null;
  onChatChange: (chatId: number | null) => void;
  models: ActiveModel[];
  defaultModelKey: string | null;
  onChangesApplied: () => void;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [input, setInput] = useState("");
  const [chatMode, setChatMode] = useState<"build" | "ask">("build");
  const [modelKey, setModelKey] = useState<string | null>(defaultModelKey);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const reloadMessages = (chatId: number | null) => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    api<{ messages: MessageRow[] }>(`/api/apps/${appId}/chats?chatId=${chatId}`)
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]));
  };
  useEffect(() => {
    reloadMessages(activeChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  useEffect(() => {
    if (models.length > 0 && !models.some((m) => `${m.providerId}:${m.modelId}` === modelKey)) {
      setModelKey(`${models[0].providerId}:${models[0].modelId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const { send, stop, streaming, text, phase } = useChatStream({
    onDone: (e) => {
      if (e.chatId !== activeChatId) onChatChange(e.chatId);
      reloadMessages(e.chatId);
      setInput("");
      if (e.annotations.writes.length || e.annotations.renames.length || e.annotations.deletes.length) {
        onChangesApplied();
      }
    },
    onError: (message) => setError(message),
  });

  const submit = () => {
    const message = input.trim();
    if (!message || streaming) return;
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: -Date.now(),
        chatId: activeChatId ?? 0,
        role: "user",
        content: message,
        annotations: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    void send({ appId, chatId: activeChatId, message, chatMode, modelKey });
  };

  // Auto-scroll while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, text]);

  // Pending commands from the latest assistant message (Dyad behavior:
  // action buttons appear above the chat input).
  const pendingCommands = useMemo(() => {
    if (streaming) return [];
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.annotations) return [];
    try {
      const annotations = JSON.parse(lastAssistant.annotations) as {
        commands?: string[];
      };
      return annotations.commands ?? [];
    } catch {
      return [];
    }
  }, [messages, streaming]);

  const runCommand = async (action: string) => {
    setError(null);
    try {
      await api(`/api/apps/${appId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      onChangesApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };


  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Chat header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800/80 px-3">
        <History className="h-3.5 w-3.5 text-zinc-600" />
        <select
          className="max-w-[180px] truncate rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-xs text-zinc-300 outline-none"
          value={activeChatId ?? ""}
          onChange={(e) => onChatChange(Number(e.target.value) || null)}
        >
          {chats.length === 0 ? <option value="">New chat</option> : null}
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || `Chat ${c.id}`}
            </option>
          ))}
        </select>
        <button
          className="btn-ghost btn-sm"
          title="New chat"
          onClick={() => onChatChange(null)}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
            {(["build", "ask"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setChatMode(mode)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  chatMode === mode
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          {/* Model picker */}
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-zinc-600" />
            <select
              className="max-w-[190px] rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-xs text-zinc-300 outline-none"
              value={modelKey ?? ""}
              onChange={(e) => setModelKey(e.target.value || null)}
            >
              {models.length === 0 ? (
                <option value="">No models — configure in Settings</option>
              ) : null}
              {models.map((m) => (
                <option key={`${m.providerId}:${m.modelId}`} value={`${m.providerId}:${m.modelId}`}>
                  {m.displayName || m.modelId}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
              <MessageSquarePlus className="h-5 w-5 text-zinc-500" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-zinc-200">Build anything</h3>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
              Describe a feature or an entire app. Files are written, dependencies installed and
              the preview updates automatically.
            </p>
          </div>
        ) : null}

        {messages.map((m, idx) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-br-sm border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5 text-sm text-zinc-100">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="animate-fade-up">
              <MessageBlocks content={m.content} />
            </div>
          ),
        )}

        {/* Live streaming message */}
        {streaming ? (
          <div className="animate-fade-up">
            <MessageBlocks content={messages[messages.length - 1]?.role === "assistant" ? text : text} />
            {phase ? (
              <div className="mt-1 flex items-center gap-2 text-2xs text-zinc-500">
                <Spinner className="h-3 w-3" /> {phase}…
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        ) : null}
      </div>

      {/* Command action row (from <dyad-command> suggestions) */}
      {pendingCommands.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/80 px-3 py-2">
          <span className="text-2xs text-zinc-600">Suggested actions:</span>
          {pendingCommands.map((cmd, i) => (
            <button
              key={i}
              onClick={() => runCommand(cmd)}
              className="btn-secondary btn-sm"
            >
              {cmd === "rebuild" ? <FolderSync className="h-3 w-3" /> : cmd === "restart" ? <RotateCw className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
              <span className="capitalize">{cmd}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Composer */}
      <div className="shrink-0 border-t border-zinc-800/80 p-3">
        <div className="relative rounded-xl border border-zinc-800 bg-zinc-900/70 focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/10">
          <textarea
            className="w-full resize-none bg-transparent px-3.5 py-3 pr-12 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
            rows={2}
            placeholder={
              chatMode === "build"
                ? "Describe a change… (⏎ to send, ⇧⏎ for newline)"
                : "Ask a question about your app…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={streaming}
          />
          <button
            onClick={streaming ? stop : submit}
            disabled={!streaming && !input.trim()}
            className={`absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              streaming
                ? "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                : "bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40"
            }`}
            title={streaming ? "Stop" : "Send"}
          >
            {streaming ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-2xs text-zinc-600">
          {chatMode === "build"
            ? "Build mode writes code and updates the sandbox automatically."
            : "Ask mode explains concepts without changing any files."}
          </p>
      </div>
    </div>
  );
}
