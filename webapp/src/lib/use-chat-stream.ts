"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatSseEvent } from "@/server/agent/chat-service";

/**
 * SSE consumer for /api/chat. Accumulates the raw model text (including
 * dyad tags) so the ported streaming parser can render blocks live.
 */
export function useChatStream(opts: {
  onDone?: (e: Extract<ChatSseEvent, { type: "done" }>) => void;
  onError?: (message: string) => void;
}) {
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [chatId, setChatId] = useState<number | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (body: {
      appId: number;
      chatId?: number | null;
      message: string;
      chatMode: "build" | "ask";
      modelKey?: string | null;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setText("");
      setPhase("thinking");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, chatId: body.chatId ?? undefined }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error || `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let event: ChatSseEvent;
            try {
              event = JSON.parse(line.slice(6)) as ChatSseEvent;
            } catch {
              continue;
            }
            switch (event.type) {
              case "start":
                setChatId(event.chatId);
                break;
              case "delta":
                setPhase("writing");
                setText((t) => t + event.text);
                break;
              case "mcp-call":
                setPhase(`using ${event.server} → ${event.tool}`);
                break;
              case "mcp-result":
                setPhase("writing");
                break;
              case "done":
                setPhase(null);
                opts.onDone?.(event);
                break;
              case "error":
                opts.onError?.(event.message);
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          opts.onError?.(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setStreaming(false);
        setPhase(null);
        abortRef.current = null;
      }
    },
    [opts],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, stop, streaming, text, chatId, phase };
}
