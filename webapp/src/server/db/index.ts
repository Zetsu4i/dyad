import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

/**
 * SQLite-backed workspace store. The database file lives under
 * `webapp/.data/` (gitignored) so the whole workspace state — apps, files,
 * chats, provider keys, MCP config, skills — persists across restarts.
 */

const DATA_DIR = process.env.DYAD_DATA_DIR || path.join(process.cwd(), ".data");
const DB_PATH =
  process.env.DYAD_DB_PATH || path.join(DATA_DIR, "dyad-cloud.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/** Location for local-runner app working copies (self-hosted/dev mode). */
export function appDataDir(): string {
  return path.join(DATA_DIR, "apps");
}

export function dbPath(): string {
  return DB_PATH;
}

export * as schema from "./schema";
