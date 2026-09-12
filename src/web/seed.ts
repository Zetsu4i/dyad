/**
 * First-boot seeding for the Dyad web server.
 *
 * Writes the initial user-settings.json (E2B runtime mode, E2B API key,
 * default custom OpenAI-compatible provider + model) so a fresh deployment
 * is immediately usable. Values come from environment variables when
 * present, falling back to sensible defaults.
 *
 *   DYAD_E2B_API_KEY        E2B API key (sandbox execution)
 *   DYAD_GATEWAY_URL        OpenAI-compatible base URL
 *   DYAD_GATEWAY_KEY        API key for the gateway
 *   DYAD_DEFAULT_MODEL      Model name for the gateway (default openai/gpt-4.1)
 *   DYAD_CUSTOM_APPS_FOLDER Where app working dirs live on the server
 */
import fs from "node:fs";
import path from "node:path";

import { getUserDataPath } from "@/paths/paths";

interface SeedOptions {
  e2bApiKey?: string;
  gatewayUrl?: string;
  gatewayKey?: string;
  defaultModel?: string;
  customAppsFolder?: string;
}

export const CUSTOM_GATEWAY_PROVIDER_ID = "custom::gateway";

// Default E2B key for this deployment (user-provided at setup time; can be
// changed any time in Settings). Overridable via DYAD_E2B_API_KEY.
const DEFAULT_E2B_API_KEY = "e2b_1415aff06b90ed6baf98255e8cb6f8c606515139";

function settingsFilePath(): string {
  return path.join(getUserDataPath(), "user-settings.json");
}

export async function seedWebDefaults(): Promise<void> {
  const settingsPath = settingsFilePath();
  const alreadySeeded = fs.existsSync(settingsPath);

  const e2bApiKey =
    process.env.DYAD_E2B_API_KEY?.trim() || DEFAULT_E2B_API_KEY;
  const gatewayUrl =
    process.env.DYAD_GATEWAY_URL?.trim() ||
    (seedOptions().gatewayUrl?.trim() ?? "https://agaam2-7dba6cfc4d0a.herokuapp.com");
  const gatewayKey =
    process.env.DYAD_GATEWAY_KEY?.trim() ||
    (seedOptions().gatewayKey?.trim() ?? "");
  const defaultModel =
    process.env.DYAD_DEFAULT_MODEL?.trim() ||
    (seedOptions().defaultModel?.trim() ?? "openai/gpt-4.1");

  if (!alreadySeeded) {
    const settings = {
      runtimeMode2: "e2b",
      selectedTemplateId: "react",
      e2bApiKey: e2bApiKey ? { value: e2bApiKey } : undefined,
      providerSettings: {
        [CUSTOM_GATEWAY_PROVIDER_ID]: {
          apiKey: { value: gatewayKey || "sk-gateway" },
        },
      },
      selectedModel: {
        name: defaultModel,
        provider: CUSTOM_GATEWAY_PROVIDER_ID,
      },
      autoApproveChanges: true,
      hasRunBefore: true,
      enableDyadPro: false,
    };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log("[web:seed] wrote initial user-settings.json");
  }

  // Register the custom provider + default model in the DB (idempotent).
  try {
    const { db } = await import("@/db");
    const { language_model_providers, language_models } = await import(
      "@/db/schema"
    );
    const { eq } = await import("drizzle-orm");

    const existingProvider = await db
      .select()
      .from(language_model_providers)
      .where(eq(language_model_providers.id, CUSTOM_GATEWAY_PROVIDER_ID))
      .limit(1);

    if (existingProvider.length === 0) {
      await db
        .insert(language_model_providers)
        .values({
          id: CUSTOM_GATEWAY_PROVIDER_ID,
          name: "Custom Gateway (OpenAI-compatible)",
          api_base_url: gatewayUrl,
        })
        .onConflictDoNothing();
      console.log("[web:seed] registered custom provider", CUSTOM_GATEWAY_PROVIDER_ID);
    }

    const existingModel = await db
      .select()
      .from(language_models)
      .where(eq(language_models.apiName, defaultModel))
      .limit(1);

    if (existingModel.length === 0) {
      await db.insert(language_models).values({
        displayName: defaultModel,
        apiName: defaultModel,
        customProviderId: CUSTOM_GATEWAY_PROVIDER_ID,
        description: "Default model on the custom OpenAI-compatible gateway",
        context_window: 1_000_000,
        max_output_tokens: 32_768,
      });
      console.log("[web:seed] registered default model", defaultModel);
    }
  } catch (error) {
    // DB might not be initialized yet on very first boot; the provider/model
    // can also be added from the Settings UI.
    console.warn(
      "[web:seed] custom provider registration deferred:",
      (error as Error).message,
    );
  }
}

function seedOptions(): SeedOptions {
  return {};
}
