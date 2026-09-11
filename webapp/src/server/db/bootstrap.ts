import { sql } from "drizzle-orm";
import { db } from "./index";
import {
  mcpServers,
  models,
  providers,
  skills,
} from "./schema";
import { SETTINGS_KEYS, getSetting, setSetting } from "./settings";
import { SKILL_GALLERY } from "../skills/gallery";
import { normalizeBaseUrl } from "../llm/providers";

/**
 * Idempotent schema + first-boot seeding. Uses raw DDL (CREATE TABLE IF NOT
 * EXISTS) so the app always boots even before any drizzle-kit migration flow.
 */

const DDL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS models_provider_model_uq ON models (provider_id, model_id);
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  runner TEXT NOT NULL DEFAULT 'e2b',
  sandbox_id TEXT,
  preview_url TEXT,
  preview_port INTEGER,
  desired_state TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS app_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS app_files_app_path_uq ON app_files (app_id, path);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  title TEXT,
  chat_mode TEXT NOT NULL DEFAULT 'build',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  annotations TEXT,
  segments TEXT,
  model_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  transport TEXT NOT NULL,
  url TEXT,
  command TEXT,
  args TEXT,
  env TEXT,
  headers TEXT,
  scope TEXT NOT NULL DEFAULT 'global',
  enabled INTEGER NOT NULL DEFAULT 1,
  from_catalog INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  tools_cache TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS app_mcps (
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  mcp_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (app_id, mcp_id)
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  files TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'custom',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS app_skills (
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (app_id, skill_id)
);
`;

const DEFAULT_BASE_URL = "https://agaam2-7dba6cfc4d0a.herokuapp.com";

let bootstrapped = false;

export function bootstrap() {
  if (bootstrapped) return;
  // better-sqlite3 executes one statement per prepare — split the DDL.
  for (const statement of DDL.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) db.run(sql.raw(trimmed));
  }

  // ---- First-boot seeding -------------------------------------------------
  if (!getSetting(SETTINGS_KEYS.onboarded)) {
    const baseUrl = normalizeBaseUrl(
      process.env.DEFAULT_LLM_BASE_URL || DEFAULT_BASE_URL,
    );
    const apiKey = process.env.DEFAULT_LLM_API_KEY || null;

    // Default gateway registered for both dialects (same base URL supports
    // OpenAI and Anthropic compatible endpoints).
    const openaiProvider = db
      .insert(providers)
      .values({
        type: "openai-compatible",
        name: "Default Gateway (OpenAI-compatible)",
        baseUrl,
        apiKey,
        isDefault: true,
      })
      .returning()
      .get() as { id: number };
    db.insert(providers)
      .values({
        type: "anthropic-compatible",
        name: "Default Gateway (Anthropic-compatible)",
        baseUrl,
        apiKey,
        isDefault: false,
      })
      .run();

    // Cheap default model for testing, as recommended in onboarding.
    db.insert(models)
      .values({
        providerId: openaiProvider.id,
        modelId: "openai/gpt-4.1",
        displayName: "GPT-4.1 (via gateway)",
        active: true,
      })
      .run();

    // Offline demo provider: exercises the full pipeline with zero network.
    const demoProvider = db
      .insert(providers)
      .values({
        type: "demo",
        name: "Offline Demo",
        baseUrl: "demo://local",
        apiKey: null,
        isDefault: false,
      })
      .returning()
      .get() as { id: number };
    db.insert(models)
      .values({
        providerId: demoProvider.id,
        modelId: "demo/app",
        displayName: "Demo builder (offline)",
        active: true,
      })
      .run();

    if (process.env.E2B_API_KEY) {
      setSetting(SETTINGS_KEYS.e2bApiKey, process.env.E2B_API_KEY);
    }
    if (process.env.DYAD_RUNNER === "local") {
      setSetting(SETTINGS_KEYS.runner, "local");
    }

    // Curated skills gallery.
    for (const s of SKILL_GALLERY) {
      db.insert(skills)
        .values({
          slug: s.slug,
          name: s.name,
          description: s.description,
          instructions: s.instructions,
          source: "gallery",
          enabled: true,
        })
        .onConflictDoNothing()
        .run();
    }

    setSetting(SETTINGS_KEYS.onboarded, "1");
  }
  bootstrapped = true;
}

/** Count of MCP catalog entries, used by the settings UI copy. */
export function catalogSize() {
  return db.select().from(mcpServers).all().length;
}
