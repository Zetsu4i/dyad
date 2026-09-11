// ============================================================================
// Dyad Cloud — API server
// ============================================================================
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
  dataDir,
  ensureLoaded,
  getStore,
  hashPassword,
  save,
  uid,
  verifyPassword,
} from "./db.js";
import { runtimeManager } from "./runtime/manager.js";
import { listProviderModels } from "./agent/providers.js";
import { runAgentTurn } from "./agent/loop.js";
import { MCP_CATALOG } from "./mcp/catalog.js";
import type {
  AgentEvent,
  App,
  Chat,
  ChatMessage,
  McpServerConfig,
  Provider,
  Settings,
  Skill,
  User,
} from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(here, "../dist");
const PORT = Number(process.env.PORT ?? 3000);

// Minimal .env loader (no dependency) — webapp/.env
function loadEnvFile() {
  try {
    const raw = fs.readFileSync(path.resolve(here, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env — fine */
  }
}
loadEnvFile();

ensureLoaded();
const store = getStore();
const app = express();
app.use(express.json({ limit: "60mb" }));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const COOKIE = "dc_session";

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie ?? "";
  return Object.fromEntries(header.split(";").map((c) => {
    const idx = c.indexOf("=");
    return idx === -1 ? [c.trim(), ""] : [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
  }));
}

function getTokenFromRequest(req: express.Request): string | undefined {
  // Bearer tokens work inside cross-site preview iframes where browsers
  // refuse to store SameSite cookies.
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return parseCookies(req)[COOKIE];
}

// ---------------------------------------------------------------------------
// Demo mode: authentication is disabled for this MVP deployment. Every request
// runs against a single auto-provisioned workspace so the product works
// everywhere (including sandboxed preview iframes that block cookies and
// storage). Real auth can be layered back in later.
// ---------------------------------------------------------------------------

let demoUserCache: User | null = null;

function ensureDemoUser(): User {
  if (demoUserCache) return demoUserCache;
  let user = store.users.find((u) => u.id === "user_demo");
  if (!user) {
    user = {
      id: "user_demo",
      email: "demo@dyad.cloud",
      name: "Demo",
      passwordHash: "",
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    store.settings[user.id] = defaultSettings(user.id);
    // Adopt the preconfigured starter provider + model.
    for (const p of store.providers) if (p.userId === "__seed__") p.userId = user!.id;
    for (const m of store.models) if (m.userId === "__seed__") m.userId = user!.id;
    const seedModel = store.models.find((m) => m.userId === user!.id && m.enabled);
    if (seedModel) {
      store.settings[user.id].defaultModel = `${seedModel.providerId}:${seedModel.apiName}`;
    }
    save("users");
    save("settings");
    save("providers");
    save("models");
  } else if (!store.settings[user.id]) {
    store.settings[user.id] = defaultSettings(user.id);
    save("settings");
  }
  demoUserCache = user;
  return user;
}

function currentUser(_req: express.Request): User | null {
  try {
    return ensureDemoUser();
  } catch {
    return null;
  }
}

function requireUser(req: express.Request, _res: express.Response, next: express.NextFunction) {
  (req as any).user = currentUser(req);
  next();
}

function adoptSeedData(userId: string) {
  // Give the first registered user the preconfigured starter provider/models.
  for (const p of store.providers) if (p.userId === "__seed__") p.userId = userId;
  for (const m of store.models) if (m.userId === "__seed__") m.userId = userId;
  const seedModel = store.models.find((m) => m.userId === userId && m.enabled);
  if (seedModel && !store.settings[userId]?.defaultModel) {
    store.settings[userId].defaultModel = `${seedModel.providerId}:${seedModel.apiName}`;
    save("settings");
  }
  save("providers");
  save("models");
}

function defaultSettings(userId: string): Settings {
  return {
    userId,
    runtimeMode:
      process.env.DYAD_DEFAULT_RUNTIME === "local"
        ? "local"
        : process.env.E2B_API_KEY
          ? "e2b"
          : "local",
    e2bApiKey: process.env.E2B_API_KEY ?? "",
    e2bDomain: process.env.E2B_DOMAIN ?? "",
    e2bTimeoutMinutes: 30,
    defaultModel: null,
    agentMaxSteps: 25,
    agentTemperature: 0,
    mcpConsentMode: "auto",
    autoManageSandbox: true,
    updatedAt: new Date().toISOString(),
  };
}

app.post("/api/auth/register", (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || String(password).length < 6) {
    return res.status(400).json({ error: "Email and a password of at least 6 characters are required" });
  }
  const normalized = String(email).trim().toLowerCase();
  if (store.users.some((u) => u.email === normalized)) {
    return res.status(400).json({ error: "An account with this email already exists" });
  }
  const user: User = {
    id: uid("user_"),
    email: normalized,
    name: String(name ?? normalized.split("@")[0]),
    passwordHash: hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  store.settings[user.id] = defaultSettings(user.id);
  // Seed skills catalog visibility: built-ins have userId __builtin__ and are
  // shared; copy them as selectable for every user automatically (read path).
  const isFirst = store.users.length === 1;
  save("users");
  save("settings");
  if (isFirst) adoptSeedData(user.id);
  // Every workspace starts with the preconfigured default gateway + model so
  // the builder works immediately (users can edit/remove it in Settings).
  const settings = store.settings[user.id];
  if (!store.providers.some((p) => p.userId === user.id)) {
    const seed = store.providers.find((p) => p.userId === "__seed__");
    const providerId = uid("prov_");
    store.providers.push({
      id: providerId,
      userId: user.id,
      name: seed?.name ?? "Default Gateway",
      format: seed?.format ?? "openai",
      baseUrl: seed?.baseUrl ?? process.env.DYAD_DEFAULT_API_BASE ?? "https://agaam2-7dba6cfc4d0a.herokuapp.com",
      apiKey: seed?.apiKey ?? process.env.DYAD_DEFAULT_API_KEY ?? "",
      createdAt: new Date().toISOString(),
    });
    const seedModel = store.models.find((m) => m.userId === "__seed__" && m.enabled);
    const apiName = seedModel?.apiName ?? process.env.DYAD_DEFAULT_MODEL ?? "openai/gpt-4.1";
    store.models.push({
      userId: user.id,
      providerId,
      apiName,
      displayName: apiName,
      enabled: true,
    });
    settings.defaultModel = `${providerId}:${apiName}`;
    save("providers");
    save("models");
    save("settings");
  }
  const token = setSession(req, res, user.id);
  res.json({ user: publicUser(user), token });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  const user = store.users.find((u) => u.email === String(email ?? "").trim().toLowerCase());
  if (!user || !verifyPassword(String(password ?? ""), user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (!store.settings[user.id]) store.settings[user.id] = defaultSettings(user.id);
  const token = setSession(req, res, user.id);
  res.json({ user: publicUser(user), token });
});

app.post("/api/auth/logout", (req, res) => {
  const token = getTokenFromRequest(req);
  if (token && store.sessions[token]) {
    delete store.sessions[token];
    save("sessions");
  }
  res.clearCookie(COOKIE).json({ ok: true });
});

function setSession(req: express.Request, res: express.Response, userId: string): string {
  const token = uid("ses_");
  store.sessions[token] = {
    token,
    userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
  };
  save("sessions");
  // Cross-site preview iframes require SameSite=None; Secure to store cookies.
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
    maxAge: 30 * 24 * 3600_000,
  });
  return token;
}

function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name };
}

app.get("/api/auth/me", (req, res) => {
  res.json({ user: publicUser(ensureDemoUser()) });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

app.get("/api/settings", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const s = store.settings[user.id] ?? defaultSettings(user.id);
  // never send raw keys to the client; send masked + presence flag
  res.json({
    ...s,
    e2bApiKey: maskKey(s.e2bApiKey),
    hasE2BKey: !!s.e2bApiKey,
    e2bKeySetHere: false,
  });
});

app.put("/api/settings", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const s = store.settings[user.id] ?? (store.settings[user.id] = defaultSettings(user.id));
  const body = req.body ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (typeof body.runtimeMode === "string" && ["e2b", "local"].includes(body.runtimeMode)) s.runtimeMode = body.runtimeMode;
  const e2bKey = str(body.e2bApiKey);
  if (e2bKey !== undefined && !e2bKey.includes("•")) s.e2bApiKey = e2bKey.trim();
  if (str(body.e2bDomain) !== undefined) s.e2bDomain = str(body.e2bDomain)!.trim();
  if (Number.isFinite(body.e2bTimeoutMinutes)) s.e2bTimeoutMinutes = Math.min(Math.max(Number(body.e2bTimeoutMinutes), 5), 60);
  if (typeof body.defaultModel === "string" || body.defaultModel === null) s.defaultModel = body.defaultModel;
  if (Number.isFinite(body.agentMaxSteps)) s.agentMaxSteps = Math.min(Math.max(Number(body.agentMaxSteps), 3), 50);
  if (Number.isFinite(body.agentTemperature)) s.agentTemperature = Math.min(Math.max(Number(body.agentTemperature), 0), 1);
  if (["auto", "always_allow", "always_ask"].includes(body.mcpConsentMode)) s.mcpConsentMode = body.mcpConsentMode;
  s.updatedAt = new Date().toISOString();
  save("settings");
  res.json({ ...s, e2bApiKey: maskKey(s.e2bApiKey), hasE2BKey: !!s.e2bApiKey });
});

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 6)}${"•".repeat(12)}${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Providers & models
// ---------------------------------------------------------------------------

app.get("/api/providers", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const providers = store.providers.filter((p) => p.userId === user.id).map((p) => ({ ...p, apiKey: maskKey(p.apiKey), hasKey: !!p.apiKey }));
  res.json({ providers });
});

app.post("/api/providers", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const { name, format, baseUrl, apiKey } = req.body ?? {};
  if (!name || !baseUrl || !["openai", "anthropic"].includes(format)) {
    return res.status(400).json({ error: "name, format (openai|anthropic) and baseUrl are required" });
  }
  const provider: Provider = {
    id: uid("prov_"),
    userId: user.id,
    name: String(name),
    format,
    baseUrl: String(baseUrl).trim(),
    apiKey: String(apiKey ?? "").trim(),
    createdAt: new Date().toISOString(),
  };
  store.providers.push(provider);
  save("providers");
  res.json({ provider: { ...provider, apiKey: maskKey(provider.apiKey), hasKey: !!provider.apiKey } });
});

app.put("/api/providers/:id", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const provider = store.providers.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const body = req.body ?? {};
  if (typeof body.name === "string") provider.name = body.name;
  if (["openai", "anthropic"].includes(body.format)) provider.format = body.format;
  if (typeof body.baseUrl === "string") provider.baseUrl = body.baseUrl.trim();
  if (typeof body.apiKey === "string" && !body.apiKey.includes("•")) provider.apiKey = body.apiKey.trim();
  save("providers");
  res.json({ provider: { ...provider, apiKey: maskKey(provider.apiKey), hasKey: !!provider.apiKey } });
});

app.delete("/api/providers/:id", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const idx = store.providers.findIndex((p) => p.id === req.params.id && p.userId === user.id);
  if (idx === -1) return res.status(404).json({ error: "Provider not found" });
  const [removed] = store.providers.splice(idx, 1);
  store.models = store.models.filter((m) => !(m.providerId === removed.id && m.userId === user.id));
  save("providers");
  save("models");
  res.json({ ok: true });
});

app.post("/api/providers/:id/test", requireUser, async (req, res) => {
  const user = (req as any).user as User;
  const provider = store.providers.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  try {
    const models = await listProviderModels(provider);
    res.json({ ok: true, modelCount: models.length });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

app.post("/api/providers/:id/pull-models", requireUser, async (req, res) => {
  const user = (req as any).user as User;
  const provider = store.providers.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  try {
    const models = await listProviderModels(provider);
    // Upsert into the user's model list, preserving enabled state.
    const existing = new Map(store.models.filter((m) => m.userId === user.id && m.providerId === provider.id).map((m) => [m.apiName, m]));
    for (const m of models) {
      if (!existing.has(m.id)) {
        store.models.push({
          userId: user.id,
          providerId: provider.id,
          apiName: m.id,
          displayName: m.displayName ?? m.id,
          enabled: false,
        });
      } else {
        const cur = existing.get(m.id)!;
        if (m.displayName) cur.displayName = m.displayName;
      }
    }
    save("models");
    res.json({ ok: true, count: models.length });
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get("/api/models", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const settings = store.settings[user.id];
  const models = store.models
    .filter((m) => m.userId === user.id)
    .map((m) => ({
      ...m,
      providerName: store.providers.find((p) => p.id === m.providerId)?.name ?? "unknown",
      providerFormat: store.providers.find((p) => p.id === m.providerId)?.format,
    }));
  res.json({ models, defaultModel: settings?.defaultModel ?? null });
});

app.put("/api/models/:providerId/:apiName/enabled", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const model = store.models.find((m) => m.userId === user.id && m.providerId === req.params.providerId && m.apiName === decodeURIComponent(req.params.apiName));
  if (!model) return res.status(404).json({ error: "Model not found" });
  model.enabled = !!req.body?.enabled;
  save("models");
  res.json({ model });
});

app.put("/api/models/default", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const s = store.settings[user.id] ?? (store.settings[user.id] = defaultSettings(user.id));
  s.defaultModel = req.body?.defaultModel ?? null;
  save("settings");
  res.json({ defaultModel: s.defaultModel });
});

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

app.get("/api/mcp", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const servers = store.mcps.filter((m) => m.userId === user.id);
  res.json({ servers, catalog: MCP_CATALOG });
});

app.post("/api/mcp", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const body = req.body ?? {};
  let server: Partial<McpServerConfig>;
  if (body.catalogId) {
    const entry = MCP_CATALOG.find((c) => c.catalogId === body.catalogId);
    if (!entry) return res.status(404).json({ error: "Catalog entry not found" });
    server = {
      catalogId: entry.catalogId,
      name: entry.name,
      description: entry.description,
      transport: entry.transport,
      command: entry.command,
      args: entry.args,
      env: { ...(entry.env ?? {}), ...(body.env ?? {}) },
      url: entry.url,
      headers: body.headers,
      requiredEnvKeys: entry.requiredEnvKeys?.map((k) => k.key),
    };
  } else {
    server = {
      name: String(body.name ?? "Custom MCP server"),
      description: String(body.description ?? ""),
      transport: body.transport === "http" ? "http" : "stdio",
      command: body.command,
      args: Array.isArray(body.args) ? body.args.map(String) : String(body.args ?? "").split(/\s+/).filter(Boolean),
      env: body.env ?? {},
      url: body.url,
      headers: body.headers,
    };
    if (server.transport === "stdio" && !server.command) {
      return res.status(400).json({ error: "command is required for stdio servers" });
    }
    if (server.transport === "http" && !server.url) {
      return res.status(400).json({ error: "url is required for http servers" });
    }
  }
  const full: McpServerConfig = {
    ...(server as McpServerConfig),
    id: uid("mcp_"),
    userId: user.id,
    createdAt: new Date().toISOString(),
  };
  store.mcps.push(full);
  save("mcps");
  res.json({ server: full });
});

app.put("/api/mcp/:id", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const server = store.mcps.find((m) => m.id === req.params.id && m.userId === user.id);
  if (!server) return res.status(404).json({ error: "Server not found" });
  const body = req.body ?? {};
  if (typeof body.name === "string") server.name = body.name;
  if (typeof body.description === "string") server.description = body.description;
  if (body.env && typeof body.env === "object") server.env = { ...server.env, ...body.env };
  if (body.headers && typeof body.headers === "object") server.headers = { ...server.headers, ...body.headers };
  if (typeof body.command === "string") server.command = body.command;
  if (Array.isArray(body.args)) server.args = body.args.map(String);
  if (typeof body.url === "string") server.url = body.url;
  save("mcps");
  res.json({ server });
});

app.delete("/api/mcp/:id", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const idx = store.mcps.findIndex((m) => m.id === req.params.id && m.userId === user.id);
  if (idx === -1) return res.status(404).json({ error: "Server not found" });
  store.mcps.splice(idx, 1);
  for (const a of store.apps) {
    if (a.userId === user.id) {
      a.config.installedMcpServerIds = a.config.installedMcpServerIds.filter((id) => id !== req.params.id);
    }
  }
  save("mcps");
  save("apps");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

app.get("/api/skills", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const skills = store.skills.filter((s) => s.builtin || s.userId === user.id);
  res.json({ skills });
});

app.post("/api/skills", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const { name, description, instructions } = req.body ?? {};
  if (!name || !instructions) return res.status(400).json({ error: "name and instructions are required" });
  const skill: Skill = {
    id: uid("skill_"),
    userId: user.id,
    name: String(name),
    slug: String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || uid("skill"),
    description: String(description ?? ""),
    instructions: String(instructions),
    builtin: false,
    createdAt: new Date().toISOString(),
  };
  store.skills.push(skill);
  save("skills");
  res.json({ skill });
});

app.put("/api/skills/:id", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const skill = store.skills.find((s) => s.id === req.params.id && (s.userId === user.id || s.builtin));
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  if (skill.builtin) return res.status(400).json({ error: "Built-in skills cannot be edited — duplicate it first" });
  const body = req.body ?? {};
  if (typeof body.name === "string") skill.name = body.name;
  if (typeof body.description === "string") skill.description = body.description;
  if (typeof body.instructions === "string") skill.instructions = body.instructions;
  save("skills");
  res.json({ skill });
});

app.delete("/api/skills/:id", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const idx = store.skills.findIndex((s) => s.id === req.params.id && s.userId === user.id && !s.builtin);
  if (idx === -1) return res.status(404).json({ error: "Skill not found" });
  store.skills.splice(idx, 1);
  for (const a of store.apps) {
    if (a.userId === user.id) {
      a.config.installedSkillIds = a.config.installedSkillIds.filter((id) => id !== req.params.id);
    }
  }
  save("skills");
  save("apps");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

const EMOJIS = ["🚀", "⚡", "🎨", "🧩", "📊", "🛠️", "🔮", "🌱", "🪄", "📦", "🤖", "💡"];

app.get("/api/apps", requireUser, (req, res) => {
  const user = (req as any).user as User;
  const apps = store.apps
    .filter((a) => a.userId === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ apps });
});

app.post("/api/apps", requireUser, async (req, res) => {
  const user = (req as any).user as User;
  const { name, description } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
  const appRow: App = {
    id: uid("app_"),
    userId: user.id,
    name: String(name).trim().slice(0, 60),
    description: String(description ?? ""),
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sandbox: { mode: store.settings[user.id]?.runtimeMode ?? "local", status: "provisioning" },
    config: { installedMcpServerIds: [], installedSkillIds: [] },
    fileCount: 0,
  };
  store.apps.push(appRow);
  save("apps");

  // Provision in the background; the client polls app status.
  provisionApp(appRow).catch((e) => {
    console.error(`[app ${appRow.id}] provisioning failed:`, e.message);
    appRow.sandbox.status = "error";
    appRow.sandbox.lastError = e.message;
    save("apps");
  });
  res.json({ app: appRow });
});

async function provisionApp(appRow: App) {
  const settings = store.settings[appRow.userId];
  await runtimeManager.createSandbox(appRow, settings);
  const chat: Chat = {
    id: uid("chat_"),
    userId: appRow.userId,
    appId: appRow.id,
    title: "New chat",
    messages: [],
    status: "idle",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.chats.push(chat);
  save("chats");
}

function findApp(req: express.Request): App | undefined {
  const user = (req as any).user as User;
  return store.apps.find((a) => a.id === req.params.id && a.userId === user.id);
}

app.get("/api/apps/:id", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  res.json({ app: appRow });
});

app.put("/api/apps/:id", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  if (typeof req.body?.name === "string") appRow.name = req.body.name.slice(0, 60);
  if (typeof req.body?.emoji === "string") appRow.emoji = req.body.emoji.slice(0, 8);
  if (typeof req.body?.description === "string") appRow.description = req.body.description.slice(0, 300);
  appRow.updatedAt = new Date().toISOString();
  save("apps");
  res.json({ app: appRow });
});

app.delete("/api/apps/:id", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  runtimeManager.cleanupSession(appRow.id);
  store.apps = store.apps.filter((a) => a.id !== appRow.id);
  store.chats = store.chats.filter((c) => c.appId !== appRow.id);
  fs.rmSync(path.join(dataDir(), "apps", appRow.id), { recursive: true, force: true });
  save("apps");
  save("chats");
  res.json({ ok: true });
});

app.post("/api/apps/:id/start", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const settings = store.settings[appRow.userId];
  res.json({ app: appRow });
  try {
    await runtimeManager.ensureRunning(appRow, settings);
  } catch (e: any) {
    appRow.sandbox.status = "error";
    appRow.sandbox.lastError = e.message;
    save("apps");
  }
});

app.post("/api/apps/:id/recreate", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const settings = store.settings[appRow.userId];
  res.json({ app: appRow });
  try {
    await runtimeManager.recreateFromMirror(appRow, settings);
  } catch (e: any) {
    appRow.sandbox.status = "error";
    appRow.sandbox.lastError = e.message;
    save("apps");
  }
});

app.post("/api/apps/:id/stop", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  await runtimeManager.stopApp(appRow);
  res.json({ app: appRow });
});

app.post("/api/apps/:id/restart", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const settings = store.settings[appRow.userId];
  try {
    const session = await runtimeManager.ensureRunning(appRow, settings);
    await runtimeManager.startDevServer(appRow, settings, session.runtime);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/apps/:id/rebuild", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const settings = store.settings[appRow.userId];
  try {
    const session = await runtimeManager.ensureRunning(appRow, settings);
    await runtimeManager.runInApp(appRow.id, "rm -rf node_modules", 120_000);
    const res2 = await runtimeManager.runInApp(appRow.id, "npm install --no-audit --no-fund 2>&1 | tail -3", 15 * 60_000);
    if (res2.exitCode !== 0) throw new Error(`npm install failed: ${(res2.stdout + res2.stderr).slice(0, 400)}`);
    await runtimeManager.startDevServer(appRow, settings, session.runtime);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/apps/:id/logs", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  res.json({ logs: runtimeManager.logs(appRow.id) });
});

// ---- Files (from the durable mirror; sandbox is synced) ----------------------

app.get("/api/apps/:id/files", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  res.json({ files: runtimeManager.listMirrorFiles(appRow.id) });
});

app.get("/api/apps/:id/file", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const rel = String(req.query.path ?? "");
  if (rel.includes("..")) return res.status(400).json({ error: "Invalid path" });
  const content = runtimeManager.readMirrorFile(appRow.id, rel);
  if (content === null) return res.status(404).json({ error: "File not found" });
  res.json({ path: rel, content });
});

app.put("/api/apps/:id/file", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const rel = String(req.body?.path ?? "");
  const content = String(req.body?.content ?? "");
  if (rel.includes("..")) return res.status(400).json({ error: "Invalid path" });
  await runtimeManager.writeFile(appRow.id, rel, content);
  res.json({ ok: true });
});

// ---- Per-app MCP & skills -----------------------------------------------------

app.post("/api/apps/:id/mcp/:serverId", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const server = store.mcps.find((m) => m.id === req.params.serverId && m.userId === appRow.userId);
  if (!server) return res.status(404).json({ error: "MCP server not found" });
  if (!appRow.config.installedMcpServerIds.includes(server.id)) {
    appRow.config.installedMcpServerIds.push(server.id);
    save("apps");
  }
  const session = runtimeManager.getSession(appRow.id);
  if (session) {
    await runtimeManager.setupMcp(appRow, store.settings[appRow.userId]);
    const tools = await runtimeManager.listMcpTools(appRow.id);
    return res.json({ ok: true, tools: tools.length });
  }
  res.json({ ok: true, tools: 0 });
});

app.delete("/api/apps/:id/mcp/:serverId", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  appRow.config.installedMcpServerIds = appRow.config.installedMcpServerIds.filter((id) => id !== req.params.serverId);
  save("apps");
  const session = runtimeManager.getSession(appRow.id);
  if (session) await runtimeManager.setupMcp(appRow, store.settings[appRow.userId]);
  res.json({ ok: true });
});

app.post("/api/apps/:id/skills/:skillId", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const skill = store.skills.find((s) => s.id === req.params.skillId && (s.builtin || s.userId === appRow.userId));
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  if (!appRow.config.installedSkillIds.includes(skill.id)) {
    appRow.config.installedSkillIds.push(skill.id);
    save("apps");
  }
  const session = runtimeManager.getSession(appRow.id);
  if (session) await runtimeManager.installSkills(appRow);
  res.json({ ok: true });
});

app.delete("/api/apps/:id/skills/:skillId", requireUser, async (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  appRow.config.installedSkillIds = appRow.config.installedSkillIds.filter((id) => id !== req.params.skillId);
  save("apps");
  const session = runtimeManager.getSession(appRow.id);
  if (session) await runtimeManager.installSkills(appRow);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Chats + agent streaming
// ---------------------------------------------------------------------------

const consentWaiters = new Map<string, Map<string, (allow: boolean) => void>>();

app.get("/api/apps/:id/chats", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const chats = store.chats
    .filter((c) => c.appId === appRow.id)
    .map(({ messages, ...rest }) => ({ ...rest, messageCount: messages.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ chats });
});

app.post("/api/apps/:id/chats", requireUser, (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const chat: Chat = {
    id: uid("chat_"),
    userId: appRow.userId,
    appId: appRow.id,
    title: "New chat",
    messages: [],
    status: "idle",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.chats.push(chat);
  save("chats");
  res.json({ chat: { ...chat, messages: undefined } });
});

function findChat(req: express.Request): Chat | undefined {
  const user = (req as any).user as User;
  return store.chats.find((c) => c.id === req.params.id && c.userId === user.id);
}

app.get("/api/chats/:id", requireUser, (req, res) => {
  const chat = findChat(req);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json({ chat });
});

app.delete("/api/chats/:id", requireUser, (req, res) => {
  const chat = findChat(req);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  store.chats = store.chats.filter((c) => c.id !== chat.id);
  save("chats");
  res.json({ ok: true });
});

app.post("/api/chats/:id/consent", requireUser, (req, res) => {
  const chat = findChat(req);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const { activityId, decision } = req.body ?? {};
  const waiter = consentWaiters.get(chat.id)?.get(String(activityId));
  if (waiter) {
    waiter(decision === "allow");
    consentWaiters.get(chat.id)!.delete(String(activityId));
    return res.json({ ok: true });
  }
  res.status(404).json({ error: "No pending consent request" });
});

const abortControllers = new Map<string, AbortController>();

app.post("/api/chats/:id/stop", requireUser, (req, res) => {
  const chat = findChat(req);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  abortControllers.get(chat.id)?.abort();
  res.json({ ok: true });
});

app.post("/api/chats/:id/messages", requireUser, async (req, res) => {
  const chat = findChat(req);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const user = (req as any).user as User;
  const appRow = store.apps.find((a) => a.id === chat.appId)!;
  const content = String(req.body?.content ?? "").trim();
  const modelRef = req.body?.model ?? null;
  const mode: "agent" | "ask" = req.body?.mode === "ask" ? "ask" : "agent";
  if (!content) return res.status(400).json({ error: "Message content is required" });

  const userMessage: ChatMessage = {
    id: uid("msg_"),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
  chat.messages.push(userMessage);
  chat.status = "streaming";
  chat.updatedAt = new Date().toISOString();
  save("chats");

  // SSE response
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event: AgentEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch { /* client gone */ }
  };

  const controller = new AbortController();
  abortControllers.set(chat.id, controller);

  const requestConsent = (r: { activityId: string; toolName: string; args: Record<string, unknown>; reason: string }) => {
    return new Promise<boolean>((resolve) => {
      const activityId = uid("consent_");
      if (!consentWaiters.has(chat.id)) consentWaiters.set(chat.id, new Map());
      const timeout = setTimeout(() => {
        consentWaiters.get(chat.id)?.delete(activityId);
        resolve(false);
      }, 10 * 60_000);
      consentWaiters.get(chat.id)!.set(activityId, (allow: boolean) => {
        clearTimeout(timeout);
        resolve(allow);
      });
      send({ type: "consent_request", activityId, toolName: r.toolName, args: r.args, reason: r.reason });
    });
  };

  try {
    // Make sure the app sandbox is up before the agent works on it
    // (fast-path when the session is already live and healthy).
    const settings = store.settings[user.id];
    if (appRow.sandbox.status !== "running") {
      send({ type: "status", status: "Preparing sandbox...", detail: "Starting the app sandbox" });
    }
    await runtimeManager.ensureRunning(appRow, settings);

    const message = await runAgentTurn({
      user,
      app: appRow,
      chat,
      userMessage: content,
      modelRef,
      mode,
      emit: send,
      requestConsent,
      signal: controller.signal,
    });
    chat.messages.push(message);
    if (message.summary) chat.title = message.summary;
    chat.status = "idle";
  } catch (e: any) {
    send({ type: "error", error: e?.message ?? String(e) });
    chat.status = "error";
  } finally {
    abortControllers.delete(chat.id);
    chat.updatedAt = new Date().toISOString();
    appRow.updatedAt = chat.updatedAt;
    save("chats");
    save("apps");
    send({ type: "done" });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Preview proxy (local runtime) — E2B apps use their public host URL directly.
// Local apps run vite with --base /preview/<appId>/ and we proxy that prefix.
// ---------------------------------------------------------------------------

const previewProxies = new Map<string, any>();

function getPreviewProxy(appId: string, port: number) {
  if (!previewProxies.has(appId)) {
    previewProxies.set(
      appId,
      createProxyMiddleware({
        target: `http://127.0.0.1:${port}`,
        ws: true,
        changeOrigin: true,
      }),
    );
  }
  return previewProxies.get(appId);
}

app.use("/preview/:appId", (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const appRow = store.apps.find((a) => a.id === (req.params as any).appId);
  if (!appRow || appRow.sandbox.mode !== "local" || !appRow.sandbox.port) {
    res.status(503).send("Preview not ready — start the app first.");
    return;
  }
  // Restore the full original path so vite sees its --base prefix.
  req.url = req.originalUrl;
  const proxy = getPreviewProxy(appRow.id, appRow.sandbox.port);
  return proxy(req, res, next);
});

app.get("/api/apps/:id/preview-url", (req, res) => {
  const appRow = findApp(req);
  if (!appRow) return res.status(404).json({ error: "App not found" });
  const url =
    appRow.sandbox.mode === "local" ? `/preview/${appRow.id}/` : appRow.sandbox.previewUrl ?? null;
  res.json({ url });
});

// ---------------------------------------------------------------------------
// E2B connectivity test
// ---------------------------------------------------------------------------

app.post("/api/e2b/test", requireUser, async (req, res) => {
  const user = (req as any).user as User;
  const settings = store.settings[user.id];
  const apiKey = settings?.e2bApiKey || process.env.E2B_API_KEY || "";
  if (!apiKey) return res.json({ ok: false, error: "No E2B API key configured" });
  try {
    const { Sandbox } = await import("e2b");
    const sandbox = await Sandbox.create({
      apiKey,
      ...(settings?.e2bDomain ? { domain: settings.e2bDomain } : {}),
      timeoutMs: 60_000,
    });
    try {
      const result = await sandbox.commands.run("echo ok", { timeoutMs: 15_000 });
      if (result.exitCode !== 0) throw new Error(result.stderr || "echo failed");
    } finally {
      await sandbox.kill().catch(() => {});
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: false, error: e?.message ?? String(e) });
  }
});

// ---------------------------------------------------------------------------
// Static client
// ---------------------------------------------------------------------------

app.use(express.static(DIST_DIR, {
  setHeaders: (res, filePath) => {
    // index.html must never be cached — it references hashed assets.
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));
app.get(/^\/(?!api\/|preview\/).*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

// ---- WebSocket upgrade passthrough for local-runtime HMR ---------------------

const server = http.createServer(app);
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  const match = url.match(/^\/preview\/([^/]+)/);
  const appRow = match ? store.apps.find((a) => a.id === match[1]) : undefined;
  if (appRow?.sandbox.mode === "local" && appRow.sandbox.port) {
    const proxy = getPreviewProxy(appRow.id, appRow.sandbox.port);
    (proxy as any).upgrade?.(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dyad Cloud server listening on http://0.0.0.0:${PORT}`);
});
