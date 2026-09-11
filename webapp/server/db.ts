// ============================================================================
// JSON file data store — zero-dependency persistence with atomic writes.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  App,
  Chat,
  McpServerConfig,
  ModelConfig,
  Provider,
  Session,
  Settings,
  Skill,
  User,
} from "./types.js";

const DATA_DIR = process.env.DYAD_CLOUD_DATA_DIR
  ? path.resolve(process.env.DYAD_CLOUD_DATA_DIR)
  : path.resolve(import.meta.dirname, "../data");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const pendingWrites = new Map<string, NodeJS.Timeout>();
function writeJson(file: string, value: unknown) {
  // Debounce + atomic replace to survive concurrent agent writes.
  const existing = pendingWrites.get(file);
  if (existing) clearTimeout(existing);
  pendingWrites.set(
    file,
    setTimeout(() => {
      pendingWrites.delete(file);
      ensureDir(path.dirname(file));
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
      fs.renameSync(tmp, file);
    }, 25),
  );
}

export function uid(prefix = ""): string {
  return `${prefix}${crypto.randomBytes(9).toString("base64url")}`;
}

export function hashPassword(password: string, salt?: string): string {
  salt = salt ?? crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

// ---- Collections -----------------------------------------------------------

interface StoreShape {
  users: User[];
  sessions: Record<string, Session>;
  settings: Record<string, Settings>;
  providers: Provider[];
  models: ModelConfig[];
  apps: App[];
  chats: Chat[];
  mcps: McpServerConfig[];
  skills: Skill[];
}

const FILES: Record<keyof StoreShape, string> = {
  users: "users.json",
  sessions: "sessions.json",
  settings: "settings.json",
  providers: "providers.json",
  models: "models.json",
  apps: "apps.json",
  chats: "chats.json",
  mcps: "mcps.json",
  skills: "skills.json",
};

const store: StoreShape = {
  users: [],
  sessions: {},
  settings: {},
  providers: [],
  models: [],
  apps: [],
  chats: [],
  mcps: [],
  skills: [],
};

const loaded = { value: false };

export function ensureLoaded() {
  if (loaded.value) return;
  loaded.value = true;
  ensureDir(DATA_DIR);
  for (const key of Object.keys(FILES) as (keyof StoreShape)[]) {
    // @ts-expect-error generic assignment
    store[key] = readJson(path.join(DATA_DIR, FILES[key]), store[key]);
  }
  seedDefaults();
}

function persist(key: keyof StoreShape) {
  writeJson(path.join(DATA_DIR, FILES[key]), store[key]);
}

export function getStore() {
  ensureLoaded();
  return store;
}

export function save(key: keyof StoreShape) {
  persist(key);
}

export function dataDir() {
  ensureDir(DATA_DIR);
  return DATA_DIR;
}

// ---- Seeded defaults ---------------------------------------------------------

function seedDefaults() {
  if (store.providers.length === 0) {
    // A starter provider record (no user attached yet) is moved onto the first
    // registered user. We model this with userId = "__seed__".
    const defaultApiBase = process.env.DYAD_DEFAULT_API_BASE ?? "https://agaam2-7dba6cfc4d0a.herokuapp.com";
    const defaultModel = process.env.DYAD_DEFAULT_MODEL ?? "openai/gpt-4.1";
    store.providers.push({
      id: "provider-default",
      userId: "__seed__",
      name: "Default Gateway",
      format: "openai",
      baseUrl: defaultApiBase,
      apiKey: process.env.DYAD_DEFAULT_API_KEY ?? "",
      createdAt: new Date().toISOString(),
    });
    store.models.push({
      userId: "__seed__",
      providerId: "provider-default",
      apiName: defaultModel,
      displayName: defaultModel,
      enabled: true,
    });
    persist("providers");
    persist("models");
  }
  if (store.skills.length === 0) {
    for (const skill of BUILTIN_SKILLS) {
      store.skills.push({
        id: uid("skill_"),
        userId: "__builtin__",
        catalogId: skill.catalogId,
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        instructions: skill.instructions,
        builtin: true,
        createdAt: new Date().toISOString(),
      });
    }
    persist("skills");
  }
}

import { BUILTIN_SKILLS } from "./skills/catalog.js";
