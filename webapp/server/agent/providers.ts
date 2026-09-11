// ============================================================================
// LLM provider layer — OpenAI-compatible + Anthropic-compatible adapters.
//
// Both adapters stream over SSE using fetch and normalize to a common event
// shape (text deltas, reasoning deltas, complete tool calls, usage).
// ============================================================================
import { getStore } from "../db.js";
import type { ModelConfig, Provider, ProviderFormat } from "../types.js";

export interface ResolvedModel {
  provider: Provider;
  model: ModelConfig;
  modelRef: string;
}

export function normalizeBase(baseUrl: string, format: ProviderFormat): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (!/\/v\d+$/.test(base)) base = `${base}/v1`;
  return base;
}

export function resolveModel(userId: string, modelRef?: string | null): ResolvedModel {
  const store = getStore();
  const ref = modelRef || store.settings[userId]?.defaultModel || null;
  if (!ref || !ref.includes(":")) {
    throw new Error(
      "No model selected. Go to Settings → Models, pull the model list from your provider and activate a model.",
    );
  }
  const [providerId, ...rest] = ref.split(":");
  const apiName = rest.join(":");
  const provider = store.providers.find((p) => p.id === providerId && (p.userId === userId || p.userId === "__seed__"));
  if (!provider) throw new Error(`Provider not found: ${providerId}`);
  const model =
    store.models.find((m) => m.userId === userId && m.providerId === providerId && m.apiName === apiName) ??
    ({ userId, providerId, apiName, displayName: apiName, enabled: true } as ModelConfig);
  return { provider, model, modelRef: ref };
}

export async function listProviderModels(provider: Provider): Promise<{ id: string; displayName?: string }[]> {
  const base = normalizeBase(provider.baseUrl, provider.format);
  const res = await fetch(`${base}/models`, {
    headers: provider.format === "anthropic"
      ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01", authorization: `Bearer ${provider.apiKey}` }
      : { authorization: `Bearer ${provider.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to list models (${res.status}): ${text.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const models = data.data ?? data.models ?? [];
  return models
    .map((m: any) => ({ id: m.id ?? m.name, displayName: m.display_name ?? m.displayName }))
    .filter((m: any) => !!m.id);
}

// ---- Streaming -------------------------------------------------------------

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string; // raw JSON string (may need accumulation)
}

export interface AgentToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export type ChatTurn =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string; isError?: boolean };

export interface StreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

export interface StreamResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCallRequest[];
  stopReason: string | null;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface StreamOptions extends StreamCallbacks {
  baseUrl: string;
  apiKey: string;
  format: ProviderFormat;
  model: string;
  turns: ChatTurn[];
  tools: AgentToolDef[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  return opts.format === "anthropic" ? streamAnthropic(opts) : streamOpenAI(opts);
}

// ---- OpenAI-compatible ------------------------------------------------------

async function streamOpenAI(opts: StreamOptions): Promise<StreamResult> {
  const base = normalizeBase(opts.baseUrl, "openai");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.turns.map((t) => {
      if (t.role === "system") return { role: "system", content: t.content };
      if (t.role === "user") return { role: "user", content: t.content };
      if (t.role === "assistant") {
        const msg: Record<string, unknown> = { role: "assistant", content: t.content || null };
        if (t.toolCalls?.length) {
          msg.tool_calls = t.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          }));
        }
        return msg;
      }
      return { role: "tool", tool_call_id: t.toolCallId, content: t.content };
    }),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: opts.maxTokens ?? 32_000,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Provider error (${res.status}): ${text.slice(0, 500)}`);
  }

  const result: StreamResult = { text: "", reasoning: "", toolCalls: [], stopReason: null };
  const toolAcc = new Map<number, { id?: string; name?: string; args: string }>();

  for await (const evt of sseStream(res.body)) {
    if (evt === "[DONE]") break;
    let parsed: any;
    try {
      parsed = JSON.parse(evt);
    } catch {
      continue;
    }
    if (parsed.usage) {
      result.usage = {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
      };
    }
    const choice = parsed.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) result.stopReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      result.text += delta.content;
      opts.onTextDelta?.(delta.content);
    }
    if (delta.reasoning_content) {
      result.reasoning += delta.reasoning_content;
      opts.onReasoningDelta?.(delta.reasoning_content);
    }
    if (delta.reasoning && typeof delta.reasoning === "string") {
      result.reasoning += delta.reasoning;
      opts.onReasoningDelta?.(delta.reasoning);
    }
    for (const tc of delta.tool_calls ?? []) {
      const acc = toolAcc.get(tc.index) ?? { args: "" };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (tc.function?.arguments) acc.args += tc.function.arguments;
      toolAcc.set(tc.index, acc);
    }
  }

  result.toolCalls = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, acc]) => ({ id: acc.id ?? `call_${Math.random().toString(36).slice(2)}`, name: acc.name ?? "", arguments: acc.args || "{}" }))
    .filter((tc) => !!tc.name);
  return result;
}

// ---- Anthropic-compatible ----------------------------------------------------

async function streamAnthropic(opts: StreamOptions): Promise<StreamResult> {
  const base = normalizeBase(opts.baseUrl, "anthropic");
  const systemParts: string[] = [];
  const messages: Record<string, unknown>[] = [];
  for (const t of opts.turns) {
    if (t.role === "system") {
      systemParts.push(t.content);
    } else if (t.role === "user") {
      messages.push({ role: "user", content: t.content });
    } else if (t.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (t.content) content.push({ type: "text", text: t.content });
      for (const tc of t.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.arguments || "{}");
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
      }
      messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] });
    } else {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: t.toolCallId,
            content: t.content,
            ...(t.isError ? { is_error: true } : {}),
          },
        ],
      });
    }
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    system: systemParts.join("\n\n"),
    messages,
    max_tokens: opts.maxTokens ?? 16_000,
    stream: true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      authorization: `Bearer ${opts.apiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Provider error (${res.status}): ${text.slice(0, 500)}`);
  }

  const result: StreamResult = { text: "", reasoning: "", toolCalls: [], stopReason: null };
  const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();

  for await (const evt of sseStream(res.body)) {
    let parsed: any;
    try {
      parsed = JSON.parse(evt);
    } catch {
      continue;
    }
    switch (parsed.type) {
      case "message_start":
        result.usage = {
          promptTokens: parsed.message?.usage?.input_tokens,
          completionTokens: parsed.message?.usage?.output_tokens,
        };
        break;
      case "content_block_start": {
        const b = parsed.content_block;
        blocks.set(parsed.index, { type: b.type, id: b.id, name: b.name, json: "" });
        break;
      }
      case "content_block_delta": {
        const block = blocks.get(parsed.index);
        const d = parsed.delta;
        if (d.type === "text_delta" && d.text) {
          result.text += d.text;
          opts.onTextDelta?.(d.text);
        } else if (d.type === "thinking_delta" && d.thinking) {
          result.reasoning += d.thinking;
          opts.onReasoningDelta?.(d.thinking);
        } else if (d.type === "input_json_delta" && block) {
          block.json += d.partial_json ?? "";
        }
        break;
      }
      case "message_delta":
        if (parsed.delta?.stop_reason) result.stopReason = parsed.delta.stop_reason;
        if (parsed.usage?.output_tokens) {
          result.usage = { ...result.usage, completionTokens: parsed.usage.output_tokens };
        }
        break;
      case "error":
        throw new Error(parsed.error?.message ?? "Anthropic stream error");
    }
  }

  for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (block.type === "tool_use") {
      result.toolCalls.push({ id: block.id ?? `call_${Math.random().toString(36).slice(2)}`, name: block.name ?? "", arguments: block.json || "{}" });
    }
  }
  return result;
}

// ---- SSE line parser ---------------------------------------------------------

async function* sseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
