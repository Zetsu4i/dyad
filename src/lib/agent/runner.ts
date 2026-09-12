// Agent runner — executes an agent turn with the AI SDK streaming loop and
// forwards thinking / text / tool events to the client over SSE. Persists
// messages, chat titles, and sandbox snapshots.

import { streamText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { resolveModel } from "./provider";
import { constructSystemPrompt } from "./prompts";
import { buildAgentTools, type ToolEvent, type AgentToolContext } from "./tools";
import {
  ensureSandbox,
  snapshotSandbox,
  installAppSkills,
  touchApp,
} from "@/lib/e2b/sandbox";
import { startMcpBridges, listBridges } from "@/lib/mcp/manager";

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

const MAX_STEPS = 60;
const HISTORY_LIMIT = 24;

export async function runAgentTurn(opts: {
  appId: string;
  userId: string;
  chatId: string;
  userMessage: string;
  modelConfigId?: string;
  emit: (evt: StreamEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { appId, userId, chatId, userMessage, emit } = opts;

  // 1) Load app + ensure sandbox is alive
  const app = await db.app.findFirst({ where: { id: appId, userId } });
  if (!app) throw new Error("App not found");
  const entry = await ensureSandbox(appId, userId);
  await touchApp(appId);

  // 2) Keep skills + MCP bridges fresh. MCP bridges can take a while to boot —
  // don't block the turn: race with a timeout and use whatever is connected.
  
  await installAppSkills(entry).catch((e) => console.warn("[agent] skills install:", e));
  await Promise.race([
    startMcpBridges(entry).catch((e) => console.warn("[agent] mcp bridges:", e)),
    new Promise((r) => setTimeout(r, 40_000)),
  ]);
  const bridges = listBridges(entry);
  console.log("[agent] step2 done. bridges:", bridges.map((b) => `${b.serverName}:${b.status}`).join(","));

  // 3) Resolve model

  const resolved = await resolveModel(userId, opts.modelConfigId);

  const isAnthropic = resolved.providerFormat === "anthropic";
  const enableThinking = isAnthropic && /claude/i.test(resolved.modelId);

  // 4) Build system prompt
  const appSkills = await db.appSkill.findMany({
    where: { appId, enabled: true, skill: { enabled: true } },
    include: { skill: true },
  });
  const mcpTools = bridges
    .filter((b) => b.status === "connected")
    .flatMap((b) =>
      b.tools.map((t) => ({ server: b.serverName, tool: t.name, description: t.description }))
    );

  const system = constructSystemPrompt({
    templateId: app.templateId,
    skills: appSkills.map(({ skill }) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
    })),
    mcpTools,
  });

  // 5) Message history (text-ified tool traces for cross-provider robustness)
  const priorMessages = await db.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
  const history: ModelMessage[] = priorMessages
    .slice(-HISTORY_LIMIT)
    .map((m) => historyFromRow(m));


  await db.message.create({
    data: { chatId, role: "user", content: userMessage },
  });

  history.push({ role: "user", content: userMessage });

  // 6) Tool events → SSE
  const toolTrace: ToolEvent[] = [];
  const changedFiles = new Set<string>();
  const onEvent = (evt: ToolEvent) => {
    toolTrace.push(evt);
    emit({ ...evt });
  };

  const toolCtx: AgentToolContext = {
    appId,
    userId,
    entry,
    chatId,
    mcpBridges: bridges,
    changedFiles,
    onEvent,
  };
  const tools = buildAgentTools(toolCtx);

  // 7) Run the streaming loop
  let fullText = "";
  let fullThinking = "";

  const stream = streamText({
    model: resolved.model,
    system,
    messages: history,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxRetries: 1,
    abortSignal: opts.signal,
    ...(enableThinking
      ? {
          providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens: 6000 } },
          },
        }
      : {}),
  });

  emit({ type: "start", model: resolved.displayName, modelId: resolved.modelId });

  try {
    for await (const part of stream.fullStream) {
      entry.lastActive = Date.now();
      if (opts.signal.aborted) break;
      const p = part as { type: string; [k: string]: unknown };
      switch (p.type) {
        case "text-delta": {
          const text = String(p.text ?? "");
          fullText += text;
          emit({ type: "text-delta", text });
          break;
        }
        case "reasoning-delta": {
          const text = String(p.text ?? "");
          fullThinking += text;
          emit({ type: "thinking-delta", text });
          break;
        }
        case "error": {
          const err = (p as { error?: unknown }).error;
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          emit({ type: "stream-warning", message: msg.slice(0, 300) });
          console.warn("[agent] stream part error:", msg);
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!opts.signal.aborted) {
      emit({ type: "error", message: msg });
    }
  }

  // 8) Persist results
  const finishReason = "stop";
  const assistantContent = fullText.trim() || "(no text output)";
  try {
    await db.message.create({
      data: {
        chatId,
        role: "assistant",
        content: assistantContent,
        thinking: fullThinking.trim() || null,
        toolTrace: toolTrace.length > 0 ? JSON.stringify(toolTrace) : null,
        modelId: resolved.modelId,
      },
    });
    if (toolCtx.title) {
      await db.chat.update({ where: { id: chatId }, data: { title: toolCtx.title } });
      emit({ type: "title", title: toolCtx.title });
    }
    await db.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    await db.app.update({
      where: { id: appId },
      data: { updatedAt: new Date(), lastActiveAt: new Date() },
    });
  } catch (err) {
    console.error("[agent] persistence failed:", err);
  }

  // 9) Snapshot the sandbox in the background (data safety on pause/timeout)
  if (changedFiles.size > 0) {
    emit({ type: "files-changed", paths: [...changedFiles] });
  }
  emit({ type: "done", messageId: null, finishReason, content: assistantContent, thinking: fullThinking.trim() });
  snapshotSandbox(appId).catch(() => {});
}

function historyFromRow(m: { role: string; content: string; toolTrace: string | null }): ModelMessage {
  if (m.role === "user") return { role: "user", content: m.content };
  let content = m.content;
  if (m.toolTrace) {
    try {
      const trace = JSON.parse(m.toolTrace) as ToolEvent[];
      const results = trace.filter((t) => t.type === "tool-result").slice(-12);
      if (results.length > 0) {
        const lines = results.map((r) => {
          const d = r.detail ? ` — ${String(r.detail).slice(0, 400)}` : "";
          return `- ${r.tool}: ${r.summary ?? ""}${d}`;
        });
        content += `\n\n[Actions taken this turn]\n${lines.join("\n")}`;
      }
    } catch {}
  }
  return { role: "assistant", content };
}
