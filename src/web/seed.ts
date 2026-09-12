/**
 * First-boot seeding for the Dyad web server.
 *
 * Writes the initial user-settings.json so a fresh deployment boots into the
 * E2B runtime with sane defaults. This deployment is strictly BYO-key:
 * providers and the E2B API key are entered by the user in the Settings UI
 * and are NEVER hardcoded here or anywhere else.
 *
 * Optional environment overrides (deployment-level defaults, still visible
 * and editable from the Settings UI):
 *
 *   DYAD_E2B_API_KEY   E2B API key to prefill (no default)
 */
import fs from "node:fs";
import path from "node:path";

import { getUserDataPath } from "@/paths/paths";

export const DEFAULT_WEB_MODEL = {
  name: "gpt-4.1",
  provider: "openai",
};

function settingsFilePath(): string {
  return path.join(getUserDataPath(), "user-settings.json");
}

export async function seedWebDefaults(): Promise<void> {
  const settingsPath = settingsFilePath();
  const alreadySeeded = fs.existsSync(settingsPath);

  if (alreadySeeded) {
    return;
  }

  const envE2bKey = process.env.DYAD_E2B_API_KEY?.trim();

  const settings: Record<string, unknown> = {
    // Sandbox execution always runs on the user's own E2B account.
    runtimeMode2: "e2b",
    selectedTemplateId: "react",
    // Keys are intentionally NOT seeded — the user adds them in Settings.
    ...(envE2bKey ? { e2bApiKey: { value: envE2bKey } } : {}),
    // Pro-tier agent features are fully unlocked on the web runtime; the
    // enforcement of the actual LLM usage is the user's own provider keys.
    enableDyadPro: true,
    proLazyEditsMode: "v2",
    enableProSmartFilesContextMode: true,
    enableImplementerSubagent: true,
    enableAdvancedSubagents: true,
    enableExplorerSubagent: true,
    selectedModel: DEFAULT_WEB_MODEL,
    autoApproveChanges: true,
    hasRunBefore: true,
  };

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(
    "[web:seed] wrote initial user-settings.json (BYOK — no keys preconfigured)",
  );
}
