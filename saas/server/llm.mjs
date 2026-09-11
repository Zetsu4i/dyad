// LLM client for OpenAI-compatible and Anthropic-compatible providers.
// Uses raw fetch (no SDK) so any base URL works, e.g. the default gateway
// https://agaam2-7dba6cfc4d0a.herokuapp.com/ which serves both formats.
import { getProvider, getSettings } from "./store.mjs";

function joinUrl(base, p) {
  const b = (base || "").replace(/\/+$/, "");
  if (/\/v1$/.test(b)) return `${b}${p}`;
  return `${b}/v1${p}`;
}

function authHeaders(provider) {
  const h = { "Content-Type": "application/json" };
  if (provider.apiKey) {
    if (provider.type === "anthropic-compatible") {
      h["x-api-key"] = provider.apiKey;
      h["anthropic-version"] = "2023-06-01";
      h["anthropic-dangerous-direct-browser-access"] = "true";
    } else {
      h["Authorization"] = `Bearer ${provider.apiKey}`;
    }
  }
  return h;
}

export function resolveModelRef(ref) {
  const settings = getSettings();
  const r = ref || settings.defaultModel || {};
  if (r.providerId === "mock") {
    return {
      provider: { id: "mock", name: "Mock (offline test)", type: "mock", apiBase: "" },
      modelId: r.modelId || "mock-agent",
    };
  }
  const provider = getProvider(r.providerId) || settings.providers[0];
  if (!provider) throw new Error("No provider configured. Add one in Settings → Providers.");
  const modelId = r.modelId || settings.defaultModel?.modelId || "openai/gpt-4.1";
  return { provider, modelId };
}

// ---- model catalog ----
export async function fetchModels(providerId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Provider not found");
  // try a few common endpoints
  const candidates =
    provider.type === "anthropic-compatible"
      ? [joinUrl(provider.apiBase, "/models"), `${provider.apiBase.replace(/\/+$/, "")}/models`]
      : [joinUrl(provider.apiBase, "/models"), `${provider.apiBase.replace(/\/+$/, "")}/models`];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: authHeaders(provider) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return list
        .map((m) => (typeof m === "string" ? { id: m } : { id: m.id || m.name, ...m }))
        .filter((m) => m.id)
        .map((m) => ({ id: m.id }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Could not fetch models");
}

export async function testProvider(providerId, modelId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Provider not found");
  const model = modelId || "openai/gpt-4.1";
  if (provider.type === "anthropic-compatible") {
    const res = await fetch(joinUrl(provider.apiBase, "/messages"), {
      method: "POST",
      headers: authHeaders(provider),
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word: ok" }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const text = (data.content || []).map((b) => b.text || "").join("");
    return { ok: true, text: text.slice(0, 200) };
  }
  const res = await fetch(joinUrl(provider.apiBase, "/chat/completions"), {
    method: "POST",
    headers: authHeaders(provider),
    body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word: ok" }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return { ok: true, text: (data.choices?.[0]?.message?.content || "").slice(0, 200) };
}

// ---- tool format conversion ----
export function toAnthropicTools(openAiTools) {
  return (openAiTools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description || "",
    input_schema: t.function.parameters || { type: "object", properties: {} },
  }));
}

// ---- streaming chat with tool-call accumulation ----
// onToken(textDelta) called for user-visible text deltas.
// Returns { text, toolCalls: [{id, name, args}], stopReason }
export async function streamChat({ provider, modelId, system, messages, tools, maxTokens = 8192, temperature = 0.2, signal, onToken }) {
  if (provider.type === "anthropic-compatible") {
    return streamAnthropic({ provider, modelId, system, messages, tools, maxTokens, temperature, signal, onToken });
  }
  return streamOpenAI({ provider, modelId, system, messages, tools, maxTokens, temperature, signal, onToken });
}

async function streamOpenAI({ provider, modelId, system, messages, tools, maxTokens, temperature, signal, onToken }) {
  const body = {
    model: modelId,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    stream: true,
    max_tokens: maxTokens,
    temperature,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const res = await fetch(joinUrl(provider.apiBase, "/chat/completions"), {
    method: "POST",
    headers: authHeaders(provider),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM error HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls = new Map(); // index -> {id, name, args}
  const readChunk = async () => {
    const { done, value } = await reader.read();
    if (done) return false;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        onToken && onToken(delta.content);
      }
      for (const tc of delta.tool_calls || []) {
        const idx = tc.index ?? 0;
        const cur = toolCalls.get(idx) || { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolCalls.set(idx, cur);
      }
    }
    return true;
  };
  while (await readChunk()) {}
  const calls = [...toolCalls.values()]
    .filter((c) => c.name)
    .map((c) => ({ id: c.id || `call_${Math.random().toString(36).slice(2)}`, name: c.name, args: safeParseArgs(c.args) }));
  return { text, toolCalls: calls, stopReason: calls.length ? "tool_calls" : "stop" };
}

async function streamAnthropic({ provider, modelId, system, messages, tools, maxTokens, temperature, signal, onToken }) {
  // convert openai-style messages (incl. tool results) to anthropic blocks
  const blocks = toAnthropicMessages(messages);
  const body = {
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    system: system || undefined,
    messages: blocks,
  };
  const at = toAnthropicTools(tools);
  if (at.length > 0) body.tools = at;
  const res = await fetch(joinUrl(provider.apiBase, "/messages"), {
    method: "POST",
    headers: authHeaders(provider),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM error HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolBlocks = new Map(); // index -> {id, name, inputJson}
  const readChunk = async () => {
    const { done, value } = await reader.read();
    if (done) return false;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    let eventName = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("event:")) {
        eventName = trimmed.slice(6).trim();
        continue;
      }
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      if (eventName === "content_block_start") {
        const b = json.content_block;
        if (b?.type === "tool_use") {
          toolBlocks.set(json.index, { id: b.id, name: b.name, inputJson: "" });
        }
      } else if (eventName === "content_block_delta") {
        const d = json.delta;
        if (d?.type === "text_delta" && d.text) {
          text += d.text;
          onToken && onToken(d.text);
        } else if (d?.type === "input_json_delta" && d.partial_json) {
          const cur = toolBlocks.get(json.index);
          if (cur) cur.inputJson += d.partial_json;
        }
      }
    }
    return true;
  };
  while (await readChunk()) {}
  const calls = [...toolBlocks.values()].map((c) => ({ id: c.id, name: c.name, args: safeParseArgs(c.inputJson) }));
  return { text, toolCalls: calls, stopReason: calls.length ? "tool_calls" : "stop" };
}

function safeParseArgs(s) {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

// messages are kept in OpenAI shape internally:
// {role, content} | {role:'assistant', tool_calls:[...]} | {role:'tool', tool_call_id, name, content}
function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const last = out[out.length - 1];
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content ?? "") };
      if (last && last.role === "user" && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || {} });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") });
  }
  // anthropic requires alternating roles; merge consecutive same-role
  const merged = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = [].concat(last.content, m.content);
    } else merged.push({ ...m });
  }
  return merged;
}
