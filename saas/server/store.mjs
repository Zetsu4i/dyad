// Simple JSON file store (single-user SaaS MVP).
// Data lives in server/data/*.json — gitignored, survives restarts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

export const DEFAULT_API_BASE = "https://agaam2-7dba6cfc4d0a.herokuapp.com/";
export const DEFAULT_TEST_MODEL = "openai/gpt-4.1";
export const DEFAULT_E2B_KEY = "e2b_1415aff06b90ed6baf98255e8cb6f8c606515139";

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  ensureDir();
  return path.join(DATA_DIR, `${name}.json`);
}

export function readCollection(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeCollection(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
  return data;
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- settings ----
const DEFAULT_SETTINGS = () => ({
  e2bKey: DEFAULT_E2B_KEY,
  e2bValidated: false,
  e2bTemplate: "base",
  sandboxTimeoutMs: 60 * 60 * 1000,
  allowLocalFallback: true,
  providers: [
    {
      id: "prov_default",
      name: "Default Gateway",
      type: "openai-compatible",
      apiBase: DEFAULT_API_BASE,
      apiKey: "",
      createdAt: new Date().toISOString(),
    },
  ],
  // models the user activated from "pull models list"
  activeModels: [
    { providerId: "prov_default", modelId: DEFAULT_TEST_MODEL, enabled: true },
  ],
  defaultModel: { providerId: "prov_default", modelId: DEFAULT_TEST_MODEL },
  // last fetched catalog per provider: { [providerId]: [{id}] }
  modelCatalog: {},
});

export function getSettings() {
  const s = readCollection("settings", null);
  if (!s) return writeCollection("settings", DEFAULT_SETTINGS());
  // forward-fill new keys
  return writeCollection("settings", { ...DEFAULT_SETTINGS(), ...s });
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  return writeCollection("settings", next);
}

export function getProvider(providerId) {
  return getSettings().providers.find((p) => p.id === providerId) || null;
}

// ---- apps ----
export function getApps() {
  return readCollection("apps", { apps: [] });
}
export function saveApps(data) {
  return writeCollection("apps", data);
}
export function getApp(appId) {
  return getApps().apps.find((a) => a.id === appId) || null;
}
export function upsertApp(app) {
  const data = getApps();
  const i = data.apps.findIndex((a) => a.id === app.id);
  if (i >= 0) data.apps[i] = app;
  else data.apps.unshift(app);
  return writeCollection("apps", data);
}
export function deleteApp(appId) {
  const data = getApps();
  data.apps = data.apps.filter((a) => a.id !== appId);
  writeCollection("apps", data);
  // cascade chats
  const chats = getChats();
  chats.chats = chats.chats.filter((c) => c.appId !== appId);
  writeCollection("chats", chats);
}

// ---- chats ----
export function getChats() {
  return readCollection("chats", { chats: [] });
}
export function getChat(chatId) {
  return getChats().chats.find((c) => c.id === chatId) || null;
}
export function upsertChat(chat) {
  const data = getChats();
  const i = data.chats.findIndex((c) => c.id === chat.id);
  if (i >= 0) data.chats[i] = chat;
  else data.chats.unshift(chat);
  return writeCollection("chats", data);
}

// ---- mcp ----
export function getMcpState() {
  return readCollection("mcps", { servers: [] });
}
export function saveMcpState(data) {
  return writeCollection("mcps", data);
}

// ---- skills ----
export function getSkillState() {
  return readCollection("skills", { custom: [], enabled: {} });
}
export function saveSkillState(data) {
  return writeCollection("skills", data);
}
