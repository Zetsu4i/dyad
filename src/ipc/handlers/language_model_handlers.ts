import type {
  LanguageModelProvider,
  LanguageModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
} from "@/ipc/types";
import { languageModelContracts } from "@/ipc/types";
import { createLoggedHandler } from "./safe_handle";
import { createLoggedTypedHandler } from "./base";
import log from "electron-log";
import {
  CUSTOM_PROVIDER_PREFIX,
  getLanguageModelProviders,
  getLanguageModels,
  getLanguageModelsByProviders,
} from "../shared/language_model_helpers";
import { db } from "@/db";
import {
  language_models,
  language_model_providers as languageModelProvidersSchema,
  language_models as languageModelsSchema,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";

const logger = log.scope("language_model_handlers");
const handle = createLoggedHandler(logger);
const handleTyped = createLoggedTypedHandler(logger);

export function registerLanguageModelHandlers() {
  handle(
    "get-language-model-providers",
    async (): Promise<LanguageModelProvider[]> => {
      return getLanguageModelProviders();
    },
  );

  handle(
    "create-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      const { id, name, apiBaseUrl, envVarName } = params;

      // Validation
      if (!id) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      if (!name) {
        throw new DyadError(
          "Provider name is required",
          DyadErrorKind.Validation,
        );
      }

      if (!apiBaseUrl) {
        throw new DyadError(
          "API base URL is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if a provider with this ID already exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, id))
        .get();

      if (existingProvider) {
        throw new DyadError(
          `A provider with ID "${id}" already exists`,
          DyadErrorKind.Conflict,
        );
      }

      // Insert the new provider
      await db.insert(languageModelProvidersSchema).values({
        // Make sure we will never have accidental collisions with builtin providers
        id: CUSTOM_PROVIDER_PREFIX + id,
        name,
        api_base_url: apiBaseUrl,
        env_var_name: envVarName || null,
      });

      // Return the newly created provider
      return {
        id,
        name,
        apiBaseUrl,
        envVarName,
        type: "custom",
      };
    },
  );

  handle(
    "create-custom-language-model",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelParams,
    ): Promise<number> => {
      const {
        apiName,
        displayName,
        providerId,
        description,
        maxOutputTokens,
        contextWindow,
      } = params;

      // Validation
      if (!apiName) {
        throw new DyadError(
          "Model API name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!displayName) {
        throw new DyadError(
          "Model display name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if provider exists
      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }

      // Insert the new model
      const result = db
        .insert(languageModelsSchema)
        .values({
          displayName,
          apiName,
          builtinProviderId: provider.type === "cloud" ? providerId : undefined,
          customProviderId: provider.type === "custom" ? providerId : undefined,
          description: description || null,
          max_output_tokens: maxOutputTokens || null,
          context_window: contextWindow || null,
        })
        .run();
      return Number(result.lastInsertRowid);
    },
  );

  handleTyped(
    languageModelContracts.updateCustomModel,
    async (_event, params): Promise<number> => {
      const {
        id,
        apiName,
        displayName,
        providerId,
        description,
        maxOutputTokens,
        contextWindow,
      } = params;

      if (!apiName) {
        throw new DyadError(
          "Model API name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!displayName) {
        throw new DyadError(
          "Model display name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      const providers = await getLanguageModelProviders();
      const provider = providers.find(
        (candidate) => candidate.id === providerId,
      );
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be updated",
          DyadErrorKind.Validation,
        );
      }

      const result = db
        .update(languageModelsSchema)
        .set({
          displayName,
          apiName,
          description: description || null,
          max_output_tokens: maxOutputTokens || null,
          context_window: contextWindow || null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(languageModelsSchema.id, id),
            provider.type === "cloud"
              ? eq(languageModelsSchema.builtinProviderId, providerId)
              : eq(languageModelsSchema.customProviderId, providerId),
          ),
        )
        .run();

      if (result.changes === 0) {
        throw new DyadError(
          `Custom model with ID "${id}" was not found for provider "${providerId}"`,
          DyadErrorKind.NotFound,
        );
      }

      return id;
    },
  );

  handle(
    "edit-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      const { id, name, apiBaseUrl, envVarName } = params;

      if (!id) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }
      if (!name) {
        throw new DyadError(
          "Provider name is required",
          DyadErrorKind.Validation,
        );
      }
      if (!apiBaseUrl) {
        throw new DyadError(
          "API base URL is required",
          DyadErrorKind.Validation,
        );
      }

      // Check if the provider being edited exists
      const existingProvider = db
        .select()
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, CUSTOM_PROVIDER_PREFIX + id))
        .get();

      if (!existingProvider) {
        throw new DyadError(
          `Provider with ID "${id}" not found`,
          DyadErrorKind.NotFound,
        );
      }

      // Use transaction to ensure atomicity when updating provider and potentially its models
      const result = db.transaction((tx) => {
        // Update the provider
        const updateResult = tx
          .update(languageModelProvidersSchema)
          .set({
            id: CUSTOM_PROVIDER_PREFIX + id,
            name,
            api_base_url: apiBaseUrl,
            env_var_name: envVarName || null,
          })
          .where(
            eq(languageModelProvidersSchema.id, CUSTOM_PROVIDER_PREFIX + id),
          )
          .run();

        if (updateResult.changes === 0) {
          throw new DyadError(
            `Failed to update provider with ID "${id}"`,
            DyadErrorKind.External,
          );
        }

        return {
          id,
          name,
          apiBaseUrl,
          envVarName,
          type: "custom" as const,
        };
      });
      logger.info(`Successfully updated provider`);
      return result;
    },
  );

  handle(
    "delete-custom-language-model",
    async (
      event: IpcMainInvokeEvent,
      params: { modelId: string },
    ): Promise<void> => {
      const { modelId: apiName } = params;

      // Validation
      if (!apiName) {
        throw new DyadError(
          "Model API name (modelId) is required",
          DyadErrorKind.Validation,
        );
      }

      logger.info(
        `Handling delete-custom-language-model for apiName: ${apiName}`,
      );

      const existingModel = await db
        .select()
        .from(languageModelsSchema)
        .where(eq(languageModelsSchema.apiName, apiName))
        .get();

      if (!existingModel) {
        throw new Error(
          `A model with API name (modelId) "${apiName}" was not found`,
        );
      }

      await db
        .delete(languageModelsSchema)
        .where(eq(languageModelsSchema.apiName, apiName));
    },
  );

  handle(
    "delete-custom-model",
    async (
      _event: IpcMainInvokeEvent,
      params: { providerId: string; modelApiName: string },
    ): Promise<void> => {
      const { providerId, modelApiName } = params;
      logger.info(
        `Handling delete-custom-model for ${providerId} / ${modelApiName}`,
      );
      if (!providerId || !modelApiName) {
        throw new DyadError(
          "Provider ID and Model API Name are required.",
          DyadErrorKind.External,
        );
      }
      logger.info(
        `Attempting to delete custom model ${modelApiName} for provider ${providerId}`,
      );

      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be deleted",
          DyadErrorKind.External,
        );
      }
      const result = db
        .delete(language_models)
        .where(
          and(
            provider.type === "cloud"
              ? eq(language_models.builtinProviderId, providerId)
              : eq(language_models.customProviderId, providerId),

            eq(language_models.apiName, modelApiName),
          ),
        )
        .run();

      if (result.changes === 0) {
        logger.warn(
          `No custom model found matching providerId=${providerId} and apiName=${modelApiName} for deletion.`,
        );
      } else {
        logger.info(
          `Successfully deleted ${result.changes} custom model(s) with apiName=${modelApiName} for provider=${providerId}`,
        );
      }
    },
  );

  handle(
    "delete-custom-language-model-provider",
    async (
      event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<void> => {
      const { providerId } = params;

      // Validation
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }

      logger.info(
        `Handling delete-custom-language-model-provider for providerId: ${providerId}`,
      );

      // Check if the provider exists before attempting deletion
      const existingProvider = await db
        .select({ id: languageModelProvidersSchema.id })
        .from(languageModelProvidersSchema)
        .where(eq(languageModelProvidersSchema.id, providerId))
        .get();

      if (!existingProvider) {
        // If the provider doesn't exist, maybe it was already deleted. Log and return.
        logger.warn(
          `Provider with ID "${providerId}" not found. It might have been deleted already.`,
        );
        // Optionally, throw new Error(`Provider with ID "${providerId}" not found`);
        // Deciding to return gracefully instead of throwing an error if not found.
        return;
      }

      // Use a transaction to ensure atomicity
      db.transaction((tx) => {
        // 1. Delete associated models
        const deleteModelsResult = tx
          .delete(languageModelsSchema)
          .where(eq(languageModelsSchema.customProviderId, providerId))
          .run();
        logger.info(
          `Deleted ${deleteModelsResult.changes} model(s) associated with provider ${providerId}`,
        );

        // 2. Delete the provider
        const deleteProviderResult = tx
          .delete(languageModelProvidersSchema)
          .where(eq(languageModelProvidersSchema.id, providerId))
          .run();

        if (deleteProviderResult.changes === 0) {
          // This case should ideally not happen if existingProvider check passed,
          // but adding safety check within transaction.
          logger.error(
            `Failed to delete provider with ID "${providerId}" during transaction, although it was found initially. Rolling back.`,
          );
          throw new Error(
            `Failed to delete provider with ID "${providerId}" which should have existed.`,
          );
        }
        logger.info(`Successfully deleted provider with ID "${providerId}".`);
      });
    },
  );

  handle(
    "get-language-models",
    async (
      event: IpcMainInvokeEvent,
      params: { providerId: string },
    ): Promise<LanguageModel[]> => {
      if (!params || typeof params.providerId !== "string") {
        throw new DyadError(
          "Invalid parameters: providerId (string) is required.",
          DyadErrorKind.Validation,
        );
      }
      const providers = await getLanguageModelProviders();
      const provider = providers.find((p) => p.id === params.providerId);
      if (!provider) {
        throw new DyadError(
          `Provider with ID "${params.providerId}" not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (provider.type === "local") {
        throw new DyadError(
          "Local models cannot be fetched",
          DyadErrorKind.External,
        );
      }
      return getLanguageModels({ providerId: params.providerId });
    },
  );

  handle(
    "get-language-models-by-providers",
    async (): Promise<Record<string, LanguageModel[]>> => {
      const all = await getLanguageModelsByProviders();
      const settings = readSettings();
      const activeKeys = settings.activeModelKeys;
      if (!activeKeys || activeKeys.length === 0) {
        return all;
      }
      // Curated mode: only the admin-activated models appear in the builder.
      const active = new Set(activeKeys);
      const filtered: Record<string, LanguageModel[]> = {};
      for (const [providerId, models] of Object.entries(all)) {
        const kept = models.filter((m) => active.has(`${providerId}:${m.apiName}`));
        if (kept.length > 0) {
          filtered[providerId] = kept;
        }
      }
      return filtered;
    },
  );

  handle(
    "fetch-provider-models-from-api",
    async (event, params: { providerId: string; baseUrl?: string; apiKey?: string }) => {
      const { providerId } = params;
      const settings = readSettings();

      // Resolve base URL: explicit param > custom provider record > builtin map.
      let baseUrl = params.baseUrl?.trim();
      let keySource = "request";
      if (!baseUrl) {
        const customProvider = db
          .select()
          .from(languageModelProvidersSchema)
          .where(eq(languageModelProvidersSchema.id, providerId))
          .get();
        if (customProvider?.api_base_url) {
          baseUrl = customProvider.api_base_url;
          keySource = "custom-provider";
        }
      }
      if (!baseUrl) {
        baseUrl = BUILTIN_PROVIDER_MODEL_LIST_URL[providerId];
        keySource = "builtin";
      }
      if (!baseUrl) {
        throw new DyadError(
          `No API base URL known for provider "${providerId}". Add it as a custom provider first.`,
          DyadErrorKind.NotFound,
        );
      }

      // Resolve key: explicit param > stored provider setting.
      const storedKey = settings.providerSettings?.[providerId]?.apiKey?.value;
      const apiKey = params.apiKey?.trim() || storedKey?.trim();
      if (!apiKey) {
        throw new DyadError(
          `No API key configured for provider "${providerId}". Add the key first, then sync models.`,
          DyadErrorKind.Auth,
        );
      }

      const url = `${baseUrl.replace(/\/+$/, "")}/models`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        // Signal an abort so a hung provider doesn't block the settings UI.
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new DyadError(
          `Model list request failed (${response.status}): ${body.slice(0, 200)}`,
          DyadErrorKind.External,
        );
      }
      const json = (await response.json()) as {
        data?: { id?: string; name?: string }[];
        models?: { id?: string; name?: string }[];
      };
      const raw = json.data ?? json.models ?? [];
      const models = raw
        .map((m) => m.id ?? m.name ?? "")
        .filter((id) => typeof id === "string" && id.length > 0)
        .sort((a, b) => a.localeCompare(b));

      logger.info(
        `Fetched ${models.length} models for provider ${providerId} from ${url} (key source: ${keySource})`,
      );
      return { models, source: url };
    },
  );
}

/**
 * OpenAI-compatible /models endpoints for built-in cloud providers that
 * expose one. Providers not listed here need an explicit baseUrl.
 */
const BUILTIN_PROVIDER_MODEL_LIST_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};
