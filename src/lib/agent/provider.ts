// Model provider factory — resolves a ModelConfig into an AI SDK LanguageModel.
// Supports OpenAI-compatible and Anthropic-compatible endpoints with custom
// base URLs, both configured in Settings → Providers.

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { db } from "@/lib/db";

export interface ResolvedModel {
  model: ReturnType<ReturnType<typeof createOpenAI>["chat"]> | ReturnType<ReturnType<typeof createAnthropic>["chat"]>;
  providerFormat: string;
  displayName: string;
  modelId: string;
}

export async function resolveModel(userId: string, modelConfigId?: string): Promise<ResolvedModel> {
  let modelConfig = modelConfigId
    ? await db.modelConfig.findFirst({ where: { id: modelConfigId, userId }, include: { provider: true } })
    : await db.modelConfig.findFirst({ where: { userId, isActive: true, isDefault: true }, include: { provider: true } });

  if (!modelConfig) {
    modelConfig = await db.modelConfig.findFirst({
      where: { userId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { provider: true },
    });
  }
  if (!modelConfig || !modelConfig.provider) {
    throw new Error(
      "No active model. Go to Settings → Providers to configure a provider and activate a model."
    );
  }

  const provider = modelConfig.provider;
  const format = provider.format === "anthropic" ? "anthropic" : "openai";
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const apiKey = provider.apiKey || "";

  if (format === "anthropic") {
    const anthropic = createAnthropic({
      baseURL: baseUrl ? `${baseUrl}/v1` : undefined,
      apiKey: apiKey || "sk-placeholder",
      headers: apiKey ? {} : { "x-api-key": "" },
    });
    return {
      model: anthropic(modelConfig.modelId),
      providerFormat: "anthropic",
      displayName: modelConfig.displayName,
      modelId: modelConfig.modelId,
    };
  }

  const openai = createOpenAI({
    baseURL: baseUrl ? `${baseUrl}/v1` : undefined,
    apiKey: apiKey || "sk-placeholder",
  });
  return {
    model: openai(modelConfig.modelId),
    providerFormat: "openai",
    displayName: modelConfig.displayName,
    modelId: modelConfig.modelId,
  };
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// Pull the model list from a provider endpoint (/v1/models or /models).
export async function pullModels(
  baseUrl: string,
  apiKey?: string | null
): Promise<{ id: string; name: string; description?: string; contextLength?: number }[]> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("No base URL configured");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastErr: unknown = null;
  for (const path of ["/v1/models", "/models"]) {
    try {
      const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from ${path}`);
        continue;
      }
      const json = (await res.json()) as {
        data?: { id: string; display_name?: string; name?: string; description?: string; context_length?: number; context_window?: number }[];
        models?: { id: string; display_name?: string; name?: string; description?: string; context_length?: number; context_window?: number }[];
      };
      const raw = json.data ?? json.models ?? [];
      const models = raw
        .filter((m) => typeof m.id === "string" && m.id.length > 0)
        .map((m) => ({
          id: m.id,
          name: m.display_name || m.name || m.id,
          description: m.description?.slice(0, 200),
          contextLength: m.context_length ?? m.context_window,
        }));
      return models;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to pull models: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

// Provider connectivity test
export async function testProvider(
  baseUrl: string,
  apiKey?: string | null,
  format: string = "openai",
  testModel?: string
): Promise<{ ok: boolean; message: string; models?: number }> {
  try {
    const models = await pullModels(baseUrl, apiKey);
    if (format === "anthropic" && !testModel) {
      return { ok: true, message: `Connected — ${models.length} models available`, models: models.length };
    }
    const base = normalizeBaseUrl(baseUrl);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const model = testModel || models.find((m) => m.id.includes("gpt-4.1") || m.id.includes("gpt-4o"))?.id || models[0]?.id;
    if (!model) return { ok: true, message: "Connected (no models listed)", models: 0 };
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK" }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) {
      return { ok: true, message: `Connected — chat completion OK with ${model} (${models.length} models)`, models: models.length };
    }
    const text = await res.text().catch(() => "");
    return { ok: false, message: `Models endpoint OK (${models.length} models) but chat failed: HTTP ${res.status} ${text.slice(0, 150)}`, models: models.length };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
