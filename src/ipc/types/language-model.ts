import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Language Model Schemas
// =============================================================================

export const LanguageModelProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  hasFreeTier: z.boolean().optional(),
  websiteUrl: z.string().optional(),
  gatewayPrefix: z.string().optional(),
  secondary: z.boolean().optional(),
  envVarName: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  /** Wire protocol for custom providers: OpenAI-compatible or Anthropic-compatible. */
  apiType: z.enum(["openai", "anthropic"]).optional(),
  type: z.enum(["custom", "local", "cloud"]),
  isCustom: z.boolean().optional(),
});

export type LanguageModelProvider = z.infer<typeof LanguageModelProviderSchema>;

export const EffortSettingsSchema = z
  .object({
    defaultEffortLevel: z.string().trim().min(1),
    possibleEffortLevels: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine((levels) => new Set(levels).size === levels.length, {
        message: "Effort levels must be unique",
      }),
  })
  .refine(
    ({ defaultEffortLevel, possibleEffortLevels }) =>
      possibleEffortLevels.includes(defaultEffortLevel),
    { message: "Default effort level must be included in possible levels" },
  );

export type EffortSettings = z.infer<typeof EffortSettingsSchema>;

export const LanguageModelSchema = z.object({
  id: z.number().optional(),
  apiName: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  tag: z.string().optional(),
  tagColor: z.string().optional(),
  maxOutputTokens: z.number().optional(),
  contextWindow: z.number().optional(),
  temperature: z.number().optional(),
  dollarSigns: z.number().optional(),
  effortSettings: EffortSettingsSchema.optional(),
  type: z.enum(["custom", "local", "cloud"]).optional(),
  /** Discovered models can be toggled off to hide them from pickers. */
  enabled: z.boolean().optional(),
});

export type LanguageModel = z.infer<typeof LanguageModelSchema>;

export const LocalModelSchema = z.object({
  provider: z.enum(["ollama", "lmstudio"]),
  modelName: z.string(),
  displayName: z.string(),
});

export type LocalModel = z.infer<typeof LocalModelSchema>;

export const CreateCustomLanguageModelProviderParamsSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiBaseUrl: z.string(),
  envVarName: z.string().optional(),
  apiType: z.enum(["openai", "anthropic"]).optional(),
});

export type CreateCustomLanguageModelProviderParams = z.infer<
  typeof CreateCustomLanguageModelProviderParamsSchema
>;

export const CreateCustomLanguageModelParamsSchema = z.object({
  apiName: z.string(),
  displayName: z.string(),
  providerId: z.string(),
  description: z.string().optional(),
  maxOutputTokens: z.number().optional(),
  contextWindow: z.number().optional(),
  enabled: z.boolean().optional(),
});

export type CreateCustomLanguageModelParams = z.infer<
  typeof CreateCustomLanguageModelParamsSchema
>;

export const UpdateCustomLanguageModelParamsSchema =
  CreateCustomLanguageModelParamsSchema.extend({ id: z.number() });

export type UpdateCustomLanguageModelParams = z.infer<
  typeof UpdateCustomLanguageModelParamsSchema
>;

export const DeleteCustomModelParamsSchema = z.object({
  providerId: z.string(),
  modelApiName: z.string(),
});

// =============================================================================
// Language Model Contracts
// =============================================================================

export const languageModelContracts = {
  getProviders: defineContract({
    channel: "get-language-model-providers",
    input: z.void(),
    output: z.array(LanguageModelProviderSchema),
  }),

  getModels: defineContract({
    channel: "get-language-models",
    input: z.object({
      providerId: z.string(),
      /** Settings pages pass true so disabled models can be re-enabled. */
      includeDisabled: z.boolean().optional(),
    }),
    output: z.array(LanguageModelSchema),
  }),

  getModelsByProviders: defineContract({
    channel: "get-language-models-by-providers",
    input: z.void(),
    output: z.record(z.string(), z.array(LanguageModelSchema)),
  }),

  createCustomProvider: defineContract({
    channel: "create-custom-language-model-provider",
    input: CreateCustomLanguageModelProviderParamsSchema,
    output: LanguageModelProviderSchema,
  }),

  editCustomProvider: defineContract({
    channel: "edit-custom-language-model-provider",
    input: CreateCustomLanguageModelProviderParamsSchema,
    output: LanguageModelProviderSchema,
  }),

  deleteCustomProvider: defineContract({
    channel: "delete-custom-language-model-provider",
    input: z.object({ providerId: z.string() }),
    output: z.void(),
  }),

  createCustomModel: defineContract({
    channel: "create-custom-language-model",
    input: CreateCustomLanguageModelParamsSchema,
    output: z.number(),
  }),

  updateCustomModel: defineContract({
    channel: "update-custom-language-model",
    input: UpdateCustomLanguageModelParamsSchema,
    output: z.number(),
  }),

  deleteCustomModel: defineContract({
    channel: "delete-custom-language-model",
    input: z.string(), // modelId
    output: z.void(),
  }),

  deleteModel: defineContract({
    channel: "delete-custom-model",
    input: DeleteCustomModelParamsSchema,
    output: z.void(),
  }),

  listOllamaModels: defineContract({
    channel: "local-models:list-ollama",
    input: z.void(),
    output: z.object({ models: z.array(LocalModelSchema) }),
  }),

  listLMStudioModels: defineContract({
    channel: "local-models:list-lmstudio",
    input: z.void(),
    output: z.object({ models: z.array(LocalModelSchema) }),
  }),

  // ==========================================================================
  // Model discovery for custom (BYO) providers: fetch the provider's
  // /models endpoint, bulk-import selected models, and toggle visibility.
  // ==========================================================================
  fetchProviderModels: defineContract({
    channel: "custom-providers:fetch-models",
    input: z.object({ providerId: z.string() }),
    output: z.object({
      models: z
        .array(
          z.object({
            apiName: z.string(),
            displayName: z.string(),
            alreadyImported: z.boolean(),
          }),
        )
        .max(2000),
      endpoint: z.string(),
    }),
  }),

  importProviderModels: defineContract({
    channel: "custom-providers:import-models",
    input: z.object({
      providerId: z.string(),
      models: z
        .array(
          z.object({
            apiName: z.string().min(1),
            displayName: z.string().min(1),
          }),
        )
        .min(1)
        .max(500),
    }),
    output: z.object({ imported: z.number() }),
  }),

  setCustomModelEnabled: defineContract({
    channel: "custom-models:set-enabled",
    input: z.object({
      modelId: z.number(),
      enabled: z.boolean(),
    }),
    output: z.object({ ok: z.literal(true) }),
  }),
} as const;

// =============================================================================
// Language Model Client
// =============================================================================

export const languageModelClient = createClient(languageModelContracts);
