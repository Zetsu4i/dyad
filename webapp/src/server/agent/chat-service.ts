import { asc, eq } from "drizzle-orm";
import { streamText, dynamicTool, jsonSchema, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { escapeXmlAttr } from "@/dyad-core/shared/xml-escape";
import { db } from "../db";
import { bootstrap } from "../db/bootstrap";
import {
  apps,
  chats,
  messages,
  type App,
  type Chat,
  type Message,
} from "../db/schema";
import { getDefaultModelKey } from "../db/settings";
import {
  languageModelFor,
  parseModelKey,
  resolveProvider,
} from "../llm/providers";
import { demoLanguageModel } from "../llm/demo-provider";
import { assembleSystemPrompt } from "./prompt-context";
import { extractAnnotations, stripSummaryTag } from "./apply-response";
import { getManager } from "../sandbox/manager";
import { getEnabledSkillsForApp } from "../skills/manager";
import {
  callTool,
  listTools,
  serversForApp,
  cachedTools,
  type McpToolInfo,
} from "../mcp/manager";

/**
 * The agent pipeline — cloud equivalent of Dyad's chat stream handler.
 *
 * 1. Assembles the verbatim Dyad system prompt + codebase/skills/MCP context.
 * 2. Streams the model response (OpenAI-compatible, Anthropic-compatible or
 *    the offline demo model).
 * 3. Emits SSE events, including Dyad-protocol `<dyad-mcp-tool-call>` /
 *    `<dyad-mcp-tool-result>` segments for MCP tool use (same wire format as
 *    upstream Dyad's chat_stream_handlers).
 * 4. On completion, persists the message + annotations and hands the file
 *    changes to the sandbox manager.
 */

export type ChatSseEvent =
  | { type: "start"; chatId: number }
  | { type: "delta"; text: string }
  | {
      type: "mcp-call";
      server: string;
      tool: string;
      callId: string;
      args: unknown;
    }
  | {
      type: "mcp-result";
      server: string;
      tool: string;
      callId: string;
      content: string;
      isError: boolean;
    }
  | {
      type: "done";
      chatId: number;
      messageId: number;
      annotations: ReturnType<typeof extractAnnotations>;
      title: string | null;
      appliedNote: string;
    }
  | { type: "error"; message: string };

export interface ChatRequest {
  appId: number;
  chatId?: number;
  message: string;
  chatMode: "build" | "ask";
  modelKey?: string | null;
}

function loadHistory(chatId: number): Message[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.id))
    .all() as Message[];
}

export async function* runChat(
  req: ChatRequest,
): AsyncGenerator<ChatSseEvent> {
  bootstrap();
  yield* streamChat(req, getManager());
}

async function buildMcpTools(
  appId: number,
): Promise<{
  tools: Record<string, ReturnType<typeof dynamicTool>>;
  serverSummaries: { name: string; tools: McpToolInfo[] }[];
  errors: string[];
}> {
  const servers = serversForApp(appId);
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {};
  const summaries: { name: string; tools: McpToolInfo[] }[] = [];
  const errors: string[] = [];
  for (const server of servers) {
    try {
      const toolInfos = await listTools(server);
      summaries.push({ name: server.name, tools: toolInfos });
      for (const t of toolInfos) {
        const serverName = server.name;
        tools[t.name] = dynamicTool({
          description: `[MCP:${serverName}] ${t.description ?? t.name}`,
          inputSchema: jsonSchema(
            (t.inputSchema as Parameters<typeof jsonSchema>[0]) ?? {
              type: "object",
              properties: {},
            },
          ),
          execute: async (input) => {
            const res = await callTool(
              server,
              t.name,
              (input as Record<string, unknown>) ?? {},
            );
            const text =
              typeof res.content === "string"
                ? res.content
                : JSON.stringify(res.content, null, 2);
            return text.slice(0, 24_000);
          },
        });
      }
    } catch (err) {
      errors.push(
        `MCP server "${server.name}" unavailable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      summaries.push({ name: server.name, tools: cachedTools(server) });
    }
  }
  return { tools, serverSummaries: summaries, errors };
}

async function resolveModel(
  modelKey: string | null | undefined,
): Promise<{ model: LanguageModel; label: string }> {
  const key = modelKey || getDefaultModelKey();
  const parsed = parseModelKey(key);
  if (!parsed) {
    throw new Error(
      "No model selected. Configure a provider and activate models in Settings → Models.",
    );
  }
  const provider = resolveProvider(parsed.providerId);
  if (provider.type === "demo") {
    return { model: demoLanguageModel(parsed.modelId), label: `demo ${parsed.modelId}` };
  }
  return {
    model: languageModelFor(provider, parsed.modelId),
    label: `${provider.name} / ${parsed.modelId}`,
  };
}

async function* streamChat(
  req: ChatRequest,
  manager: ReturnType<typeof getManager>,
): AsyncGenerator<ChatSseEvent> {
  const app = db.select().from(apps).where(eq(apps.id, req.appId)).get() as
    | App
    | undefined;
  if (!app) {
    yield { type: "error", message: `App ${req.appId} not found` };
    return;
  }

  // Resolve chat (create on first message).
  let chat: Chat;
  if (req.chatId) {
    const found = db
      .select()
      .from(chats)
      .where(eq(chats.id, req.chatId))
      .get() as Chat | undefined;
    if (!found || found.appId !== req.appId) {
      yield { type: "error", message: "Chat not found for this app" };
      return;
    }
    chat = found;
  } else {
    chat = db
      .insert(chats)
      .values({ appId: req.appId, chatMode: req.chatMode })
      .returning()
      .get() as Chat;
  }
  yield { type: "start", chatId: chat.id };

  // Persist the user message.
  db.insert(messages)
    .values({ chatId: chat.id, role: "user", content: req.message })
    .run();
  if (chat.chatMode !== req.chatMode) {
    db.update(chats)
      .set({ chatMode: req.chatMode })
      .where(eq(chats.id, chat.id))
      .run();
  }

  // Resolve model + context.
  let model: LanguageModel;
  try {
    ({ model } = await resolveModel(req.modelKey));
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }
  const files = manager.filesMap(req.appId);
  const skills = getEnabledSkillsForApp(req.appId);
  const { tools, serverSummaries, errors } = await buildMcpTools(req.appId);

  const system = assembleSystemPrompt({
    chatMode: req.chatMode,
    files,
    appName: app.name,
    skills,
    mcpServers: serverSummaries,
  });

  // History → core messages (full previous responses, Dyad-style).
  const history = loadHistory(chat.id);
  const historyMessages = history
    .filter((m) => m.id !== history[history.length - 1]?.id || m.role === "user")
    .slice(0, -1)
    .map((m) =>
      m.role === "user"
        ? ({ role: "user" as const, content: m.content })
        : ({ role: "assistant" as const, content: m.content }),
    );
  const coreMessages = [
    ...historyMessages,
    { role: "user" as const, content: req.message },
  ];

  // Stream.
  let fullResponse = "";
  const segments: ChatSseEvent[] = [];
  let streamErrored: string | null = null;

  try {
    const result = streamText({
      model,
      system,
      messages: coreMessages,
      tools,
      stopWhen: stepCountIs(8),
      onError: ({ error }) => {
        streamErrored =
          error instanceof Error ? error.message : String(error);
      },
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          const delta = (part as unknown as { text?: string; delta?: string }).text
            ?? (part as unknown as { delta?: string }).delta
            ?? "";
          fullResponse += delta;
          yield { type: "delta", text: delta };
          break;
        }
        case "tool-call": {
          const toolName = part.toolName;
          const serverName = toolName.startsWith("[MCP:")
            ? toolName.slice(5, toolName.indexOf("]"))
            : "mcp";
          const segment = `\n<dyad-mcp-tool-call server="${escapeXmlAttr(
            serverName,
          )}" tool="${escapeXmlAttr(toolName)}" call-id="${escapeXmlAttr(
            part.toolCallId,
          )}">\n${JSON.stringify(part.input ?? {})}\n</dyad-mcp-tool-call>\n`;
          fullResponse += segment;
          segments.push({
            type: "mcp-call",
            server: serverName,
            tool: toolName,
            callId: part.toolCallId,
            args: part.input,
          });
          yield { type: "delta", text: segment };
          yield {
            type: "mcp-call",
            server: serverName,
            tool: toolName,
            callId: part.toolCallId,
            args: part.input,
          };
          break;
        }
        case "tool-result": {
          const toolName = part.toolName;
          const serverName = toolName.startsWith("[MCP:")
            ? toolName.slice(5, toolName.indexOf("]"))
            : "mcp";
          const output =
            typeof part.output === "string"
              ? part.output
              : JSON.stringify(part.output ?? "", null, 2);
          const segment = `\n<dyad-mcp-tool-result server="${escapeXmlAttr(
            serverName,
          )}" tool="${escapeXmlAttr(toolName)}" call-id="${escapeXmlAttr(
            (part as { toolCallId?: string }).toolCallId ?? "",
          )}">\n${output.slice(0, 4000)}\n</dyad-mcp-tool-result>\n`;
          fullResponse += segment;
          yield { type: "delta", text: segment };
          yield {
            type: "mcp-result",
            server: serverName,
            tool: toolName,
            callId: (part as { toolCallId?: string }).toolCallId ?? "",
            content: output.slice(0, 4000),
            isError: Boolean((part as { isError?: boolean }).isError),
          };
          break;
        }
        case "error": {
          streamErrored =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    streamErrored = err instanceof Error ? err.message : String(err);
  }

  if (streamErrored && fullResponse.length === 0) {
    yield { type: "error", message: streamErrored };
    return;
  }

  // Persist assistant message + annotations.
  const annotations = extractAnnotations(fullResponse);
  const inserted = db
    .insert(messages)
    .values({
      chatId: chat.id,
      role: "assistant",
      content: fullResponse,
      annotations: JSON.stringify(annotations),
      segments: JSON.stringify(segments),
    })
    .returning()
    .get() as Message;

  if (annotations.summary) {
    db.update(chats)
      .set({ title: annotations.summary })
      .where(eq(chats.id, chat.id))
      .run();
  }

  // Apply changes to the app (files in DB + sandbox sync/rebuild) in the
  // background; the builder UI polls /api/apps/:id/status for progress.
  let appliedNote = "";
  const hasChanges =
    annotations.writes.length > 0 ||
    annotations.renames.length > 0 ||
    annotations.deletes.length > 0 ||
    annotations.addDependency.length > 0;
  if (hasChanges && req.chatMode === "build") {
    void manager
      .applyChatChanges(req.appId, {
        writes: annotations.writes,
        renames: annotations.renames,
        deletes: annotations.deletes,
        addDependency: annotations.addDependency,
      })
      .then(() => undefined)
      .catch(() => undefined);
    appliedNote = "applying";
  }

  yield {
    type: "done",
    chatId: chat.id,
    messageId: inserted.id,
    annotations,
    title: annotations.summary,
    appliedNote,
  };
  if (streamErrored) {
    // Stream failed mid-way but we keep the partial content (Dyad does the same).
    yield { type: "error", message: streamErrored };
  }
  void stripSummaryTag; // referenced to keep import tree-shake-stable
  void errors;
}
