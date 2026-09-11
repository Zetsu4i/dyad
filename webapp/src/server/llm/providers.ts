import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { models, providers, type Provider } from "../db/schema";

/**
 * LLM provider layer.
 *
 * Supports the two de-facto standards:
 *  - OpenAI-compatible  (POST {base}/v1/chat/completions, GET {base}/v1/models)
 *  - Anthropic-compatible (POST {base}/v1/messages,       GET {base}/v1/models)
 *
 * Users register a provider with any base URL (the default gateway supports
 * BOTH dialects) plus an API key, pull the model list, and activate models.
 */

export type ProviderType = "openai-compatible" | "anthropic-compatible" | "demo";

export function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) base = "https://" + base;
  return base;
}

/** The base URL the AI SDK should use (SDKs expect the /v1 suffix). */
export function sdkBaseUrl(raw: string): string {
  const base = normalizeBaseUrl(raw);
  return /\/v\d+$/.test(base) ? base : base + "/v1";
}

export function resolveProvider(providerId: number): Provider {
  const row = db
    .select()
    .from(providers)
    .where(eq(providers.id, providerId))
    .get() as Provider | undefined;
  if (!row) throw new Error(`Provider ${providerId} not found`);
  return row;
}

/** Builds the AI SDK language model for a provider/model pair. */
export function languageModelFor(
  provider: Provider,
  modelId: string,
): LanguageModel {
  switch (provider.type) {
    case "openai-compatible": {
      const p = createOpenAICompatible({
        name: `provider-${provider.id}`,
        baseURL: sdkBaseUrl(provider.baseUrl),
        apiKey: provider.apiKey || "not-required",
      });
      return p.chatModel(modelId);
    }
    case "anthropic-compatible": {
      const p = createAnthropic({
        baseURL: sdkBaseUrl(provider.baseUrl),
        apiKey: provider.apiKey || "not-required",
      });
      return p(modelId);
    }
    case "demo":
      throw new Error("Demo provider does not produce language models");
    default:
      throw new Error(`Unknown provider type: ${provider.type}`);
  }
}

export interface RemoteModel {
  id: string;
  displayName?: string;
}

/** Pull the model list from a provider (used by Settings → Providers). */
export async function fetchProviderModels(
  type: Exclude<ProviderType, "demo">,
  baseUrl: string,
  apiKey: string | null,
): Promise<RemoteModel[]> {
  const base = sdkBaseUrl(baseUrl);
  const url = `${base}/models`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (type === "anthropic-compatible") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Model list request failed (${res.status} ${res.statusText}) ${body.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    data?: { id?: string; display_name?: string; name?: string }[];
    models?: { id?: string; display_name?: string; name?: string }[];
  };
  const list = json.data ?? json.models ?? [];
  const out: RemoteModel[] = [];
  for (const m of list) {
    if (!m?.id) continue;
    out.push({ id: m.id, displayName: m.display_name || m.name || m.id });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Parsed "providerId:modelId" model key. */
export function parseModelKey(
  key: string | null | undefined,
): { providerId: number; modelId: string } | null {
  if (!key) return null;
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const providerId = Number(key.slice(0, idx));
  const modelId = key.slice(idx + 1);
  if (!Number.isFinite(providerId) || !modelId) return null;
  return { providerId, modelId };
}
