// ============================================================================
// Agent loop — a faithful port of Dyad's agentic execution model:
// system prompt (ported blocks) + tool-calling loop + streaming deltas +
// per-tool activity events + chat summary + todo tracking + MCP consent.
// ============================================================================
import { getStore, save, uid } from "../db.js";
import { resolveModel, streamChat, type ChatTurn } from "./providers.js";
import { constructAgentPrompt, COMPACTION_SYSTEM_PROMPT, type PromptMcpServer, type PromptSkill } from "./prompts.js";
import { executeTool, getToolDefs, type ToolContext } from "./tools.js";
import { runtimeManager } from "../runtime/manager.js";
import type { AgentEvent, App, Chat, ChatMessage, Settings, User } from "../types.js";

const MAX_STEPS_DEFAULT = 25;
const COMPACTION_THRESHOLD_CHARS = 110_000;

export interface RunTurnOptions {
  user: User;
  app: App;
  chat: Chat;
  userMessage: string;
  modelRef?: string | null;
  mode: "agent" | "ask";
  emit: (event: AgentEvent) => void;
  /** Registers a consent request and resolves when the user responds. */
  requestConsent: (req: {
    messageId: string;
    activityId: string;
    toolName: string;
    args: Record<string, unknown>;
    reason: string;
  }) => Promise<boolean>;
  signal?: AbortSignal;
}

export async function runAgentTurn(opts: RunTurnOptions): Promise<ChatMessage> {
  const store = getStore();
  const settings: Settings = store.settings[opts.user.id];
  const resolved = resolveModel(opts.user.id, opts.modelRef);
  const maxSteps = settings?.agentMaxSteps ?? MAX_STEPS_DEFAULT;

  const assistantMessage: ChatMessage = {
    id: uid("msg_"),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    model: resolved.modelRef,
    activity: [],
    filesChanged: [],
  };
  opts.emit({ type: "start", messageId: assistantMessage.id });

  // ---- System prompt (ported blocks + sandbox-installed skills/MCP) --------
  const skills: PromptSkill[] = store.skills
    .filter((s) => opts.app.config.installedSkillIds.includes(s.id))
    .map((s) => ({ slug: s.slug, name: s.name, description: s.description }));
  const mcpTools = await runtimeManager.listMcpTools(opts.app.id);
  const mcpServers: PromptMcpServer[] = [];
  for (const serverId of opts.app.config.installedMcpServerIds) {
    const serverCfg = store.mcps.find((m) => m.id === serverId);
    if (!serverCfg) continue;
    mcpServers.push({
      id: serverCfg.id,
      name: serverCfg.name,
      description: serverCfg.description,
      tools: mcpTools.filter((t) => t.server === serverId).map((t) => ({ name: t.name, description: t.description })),
    });
  }

  let aiRules: string | undefined;
  try {
    aiRules = await runtimeManager.readFile(opts.app.id, "AI_RULES.md");
  } catch {
    aiRules = undefined;
  }

  const systemPrompt = constructAgentPrompt({
    aiRules,
    mode: opts.mode,
    skills,
    mcpServers: mcpServers.filter((m) => m.tools.length > 0),
  });

  // ---- Conversation turns (with compaction for long chats) -----------------
  const history = buildHistoryTurns(opts.chat);
  const turns: ChatTurn[] = [{ role: "system", content: systemPrompt }, ...history];
  turns.push({ role: "user", content: opts.userMessage });

  const tools = getToolDefs({
    mode: opts.mode,
    hasMcpServers: mcpServers.some((m) => m.tools.length > 0),
    hasSkills: skills.length > 0,
  });

  const filesChanged: { path: string; action: "write" | "delete" | "rename" }[] = [];

  const toolCtx: ToolContext = {
    appId: opts.app.id,
    emit: opts.emit,
    filesChanged,
    addTurn: (t) => turns.push(t),
    requestMcpConsent: async ({ toolName, server, args, reason }) => {
      // The route layer emits the consent_request event with a real
      // activityId and resolves once the user answers.
      return opts.requestConsent({
        messageId: assistantMessage.id,
        activityId: "",
        toolName,
        args: { server, tool: toolName, ...args },
        reason,
      });
    },
    mcpConsentMode: settings?.mcpConsentMode ?? "auto",
  };

  // ---- The loop ---------------------------------------------------------------
  let step = 0;
  try {
    for (step = 1; step <= maxSteps; step++) {
      const result = await streamChat({
        baseUrl: resolved.provider.baseUrl,
        apiKey: resolved.provider.apiKey,
        format: resolved.provider.format,
        model: resolved.model.apiName,
        turns,
        tools,
        temperature: resolved.model.temperature ?? settings?.agentTemperature ?? 0,
        signal: opts.signal,
        onTextDelta: (delta) => {
          assistantMessage.content += delta;
          opts.emit({ type: "text_delta", delta });
        },
      });

      if (result.toolCalls.length === 0) {
        break;
      }

      // Record the assistant's tool-call turn
      turns.push({
        role: "assistant",
        content: result.text,
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        if (opts.signal?.aborted) break;
        const { activity, turn } = await executeTool(call.name, call.arguments, toolCtx, call.id);
        assistantMessage.activity!.push(activity);
        const summaryTool = call.name === "set_chat_summary";
        if (summaryTool) {
          try {
            const parsed = JSON.parse(call.arguments || "{}");
            if (parsed.summary) {
              assistantMessage.summary = String(parsed.summary);
              opts.emit({ type: "summary", summary: String(parsed.summary) });
            }
          } catch { /* ignore */ }
        }
        if (call.name === "update_todos") {
          try {
            const parsed = JSON.parse(call.arguments || "{}");
            if (Array.isArray(parsed.todos)) {
              assistantMessage.todos = parsed.todos.map((t: any, i: number) => ({
                id: String(t.id ?? `todo-${i + 1}`),
                content: String(t.content ?? ""),
                status: t.status === "completed" ? "completed" : t.status === "in_progress" ? "in_progress" : "pending",
              }));
              opts.emit({ type: "todos", todos: assistantMessage.todos });
            }
          } catch { /* ignore */ }
        }
        turns.push(turn);
      }
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    assistantMessage.error = msg;
    opts.emit({ type: "error", error: msg });
  }

  // ---- Finalize: commit the turn in the sandbox git repo --------------------
  try {
    await runtimeManager.runInApp(opts.app.id, "git add -A && git commit -qm \"agent turn\" 2>/dev/null; true", 30_000);
  } catch { /* sandbox may be down; not fatal */ }

  opts.emit({ type: "files_changed", files: filesChanged });
  opts.emit({ type: "message_done", message: assistantMessage });
  return assistantMessage;
}

/**
 * Build provider turns from stored chat history. Prior assistant turns keep
 * only their text (their tool activity lives on in the codebase), which
 * mirrors Dyad's message compaction behavior for prior turns.
 */
function buildHistoryTurns(chat: Chat): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let totalChars = 0;
  const recent: ChatTurn[] = [];
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.role === "system") continue;
    const content = m.content?.trim() || (m.role === "assistant" ? "(worked on the request)" : "");
    if (!content) continue;
    totalChars += content.length;
    recent.unshift(
      m.role === "user"
        ? { role: "user" as const, content }
        : { role: "assistant" as const, content },
    );
    if (totalChars > COMPACTION_THRESHOLD_CHARS) break;
  }
  turns.push(...recent);
  return turns;
}

/** Compaction summary used when history grows very long (ported prompt). */
export async function compactHistory(model: { baseUrl: string; apiKey: string; format: any; model: string }, transcript: string): Promise<string> {
  const result = await streamChat({
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    format: model.format,
    model: model.model,
    maxTokens: 2000,
    turns: [
      { role: "system", content: COMPACTION_SYSTEM_PROMPT },
      { role: "user", content: `Summarize this coding conversation:\n\n${transcript.slice(-90_000)}` },
    ],
    tools: [],
  });
  return result.text;
}
