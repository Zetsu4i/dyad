import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Dyad Cloud — SaaS data model.
 *
 * A single SQLite database backs the whole workspace. Every user-provided
 * secret (LLM API keys, E2B key) lives here so the entire workspace can be
 * backed up / moved by copying one file.
 */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** openai-compatible | anthropic-compatible | demo */
  type: text("type").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key"),
  isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const models = sqliteTable(
  "models",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    /** Model identifier as expected by the provider API, e.g. "openai/gpt-4.1" */
    modelId: text("model_id").notNull(),
    displayName: text("display_name"),
    /** Activated models are selectable in the builder. */
    active: integer("active", { mode: "boolean" }).default(false).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("models_provider_model_uq").on(t.providerId, t.modelId)],
);

export const apps = sqliteTable("apps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  /** idle | creating | installing | building | running | error | stopped */
  status: text("status").default("idle").notNull(),
  lastError: text("last_error"),
  /** e2b (cloud) | local (self-hosted dev runner) */
  runner: text("runner").default("e2b").notNull(),
  /** Live sandbox id (E2B) — resumable while the sandbox is alive. */
  sandboxId: text("sandbox_id"),
  previewUrl: text("preview_url"),
  previewPort: integer("preview_port"),
  desiredState: text("desired_state").default("stopped").notNull(), // running | stopped
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const appFiles = sqliteTable(
  "app_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("app_files_app_path_uq").on(t.appId, t.path)],
);

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appId: integer("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  title: text("title"),
  /** build | ask */
  chatMode: text("chat_mode").default("build").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  /** JSON annotations: writes/renames/deps/commands/mcp calls etc. */
  annotations: text("annotations"),
  /** Raw chunks logged during MCP tool use (JSON array of segments). */
  segments: text("segments"),
  modelKey: text("model_key"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const mcpServers = sqliteTable("mcp_servers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** http (streamable) | sse | stdio — stdio runs inside the app sandbox */
  transport: text("transport").notNull(),
  url: text("url"),
  command: text("command"),
  args: text("args"), // JSON array
  env: text("env"), // JSON object
  headers: text("headers"), // JSON object
  /** global = available to every app; app = only when attached */
  scope: text("scope").default("global").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  /** true when created from the built-in catalog */
  fromCatalog: integer("from_catalog", { mode: "boolean" })
    .default(false)
    .notNull(),
  lastStatus: text("last_status").default("unknown").notNull(), // connected | error | unknown
  lastError: text("last_error"),
  toolsCache: text("tools_cache"), // JSON snapshot of tools
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const appMcps = sqliteTable(
  "app_mcps",
  {
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    mcpId: integer("mcp_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.appId, t.mcpId] })],
);

export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  /** Full SKILL.md instructions injected into the sandbox + prompt. */
  instructions: text("instructions").notNull(),
  /** Optional extra files: JSON array of { path, content } */
  files: text("files"),
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  /** gallery | custom */
  source: text("source").default("custom").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const appSkills = sqliteTable(
  "app_skills",
  {
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.appId, t.skillId] })],
);

export type Provider = typeof providers.$inferSelect;
export type ModelRow = typeof models.$inferSelect;
export type App = typeof apps.$inferSelect;
export type AppFile = typeof appFiles.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type McpServer = typeof mcpServers.$inferSelect;
export type Skill = typeof skills.$inferSelect;
