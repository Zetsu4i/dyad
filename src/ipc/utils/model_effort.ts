import type {
  LargeLanguageModel,
  ModelSelection,
  UserSettings,
} from "@/lib/schemas";
import { createModelSelection, getModelPreferenceKey } from "@/lib/modelEffort";
import { findLanguageModel } from "./findLanguageModel";

export async function resolveModelSelection({
  model,
  preferredEffortLevel,
}: {
  model: LargeLanguageModel;
  preferredEffortLevel?: string | null;
}): Promise<ModelSelection> {
  const catalogModel = await findLanguageModel(model);
  return createModelSelection({
    model,
    catalogModel,
    preferredEffortLevel,
  });
}

/**
 * Preferred default model for this fork. When the user has not picked a model
 * yet (selection is still "auto") and a BYO provider exposes this exact model,
 * it becomes the default for new chats. `openai/gpt-4.1` matches the naming
 * used by OpenAI-compatible gateways.
 */
export const PREFERRED_DEFAULT_MODEL_NAME = "openai/gpt-4.1";

export async function resolveDefaultModelSelection(
  settings: UserSettings,
): Promise<ModelSelection> {
  const model = await resolveEffectiveDefaultModel(settings);
  return resolveModelSelection({
    model,
    preferredEffortLevel:
      settings.modelEffortPreferences?.[getModelPreferenceKey(model)],
  });
}

async function resolveEffectiveDefaultModel(
  settings: UserSettings,
): Promise<LargeLanguageModel> {
  const stillOnAutoDefault =
    settings.selectedModel?.provider === "auto" &&
    settings.selectedModel?.name === "auto";
  if (!stillOnAutoDefault) {
    return settings.selectedModel;
  }
  try {
    const { getLanguageModelProviders, getLanguageModels } = await import(
      "@/ipc/shared/language_model_helpers"
    );
    const providers = await getLanguageModelProviders();
    for (const provider of providers) {
      if (provider.type !== "custom") {
        continue;
      }
      const models = await getLanguageModels({ providerId: provider.id });
      const match = models.find(
        (candidate) => candidate.apiName === PREFERRED_DEFAULT_MODEL_NAME,
      );
      if (match) {
        return {
          provider: provider.id,
          name: match.apiName,
        };
      }
    }
  } catch {
    // Model resolution is best-effort; fall back to the stored default.
  }
  return settings.selectedModel;
}

export async function normalizeModelSelection(
  selection: ModelSelection,
): Promise<ModelSelection> {
  return resolveModelSelection({
    model: selection,
    preferredEffortLevel: selection.effortLevel,
  });
}
