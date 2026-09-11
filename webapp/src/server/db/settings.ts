import { eq } from "drizzle-orm";
import { db } from "./index";
import { settings } from "./schema";

/** Workspace-level settings (E2B key, default model, runner, etc.). */

export const SETTINGS_KEYS = {
  e2bApiKey: "e2b_api_key",
  e2bTemplate: "e2b_template",
  defaultModelKey: "default_model_key",
  runner: "runner", // "e2b" | "local"
  onboarded: "onboarded",
} as const;

export function getSetting(key: string): string | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get() as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  db.transaction((tx) => {
    tx.delete(settings).where(eq(settings.key, key)).run();
    if (value !== null) {
      tx.insert(settings).values({ key, value }).run();
    }
  });
}

export function getE2BApiKey(): string {
  return (
    getSetting(SETTINGS_KEYS.e2bApiKey) ||
    process.env.E2B_API_KEY ||
    ""
  );
}

export function getRunner(): "e2b" | "local" {
  const fromSettings = getSetting(SETTINGS_KEYS.runner);
  if (fromSettings === "local") return "local";
  return "e2b";
}

export function getDefaultModelKey(): string | null {
  return getSetting(SETTINGS_KEYS.defaultModelKey);
}

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return "••••••••";
  return secret.slice(0, 4) + "••••••••" + secret.slice(-4);
}
