// Dyad SaaS server — Express API + static client hosting.
// Pure Node (no Electron): providers/LLM, E2B sandboxes, MCP, skills, agent runs.
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getSettings,
  saveSettings,
  uid,
  getApps,
  getApp,
  upsertApp,
  deleteApp,
  getChats,
  getChat,
  upsertChat,
  DEFAULT_API_BASE,
  DEFAULT_TEST_MODEL,
} from "./store.mjs";
import { fetchModels, testProvider, resolveModelRef } from "./llm.mjs";
import { E2BDriver, LocalDriver, driverFor, PREVIEW_PORT } from "./sandboxes.mjs";
import {
  MCP_TEMPLATES,
  listServers,
  createServer,
  installTemplate,
  updateServer,
  deleteServer,
  getStatuses,
  ensureConnected,
  disconnect,
  callTool,
  aggregateTools,
} from "./mcp.mjs";
import {
  listAllSkills,
  getEnabledSkills,
  setSkillEnabled,
  createCustomSkill,
  updateCustomSkill,
  deleteCustomSkill,
  skillSandboxFiles,
} from "./skills.mjs";
import { runAgentTurn } from "./agent.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8081;
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const send = (res, data) => res.json({ ok: true, data });
const fail = (res, status, message) => res.status(status).json({ ok: false, error: String(message || "error") });

// ---------------------------------------------------------------- health
app.get("/api/health", (req, res) => send(res, { status: "ok", time: new Date().toISOString() }));

// ---------------------------------------------------------------- settings / providers
function maskSettings(s) {
  return {
    ...s,
    e2bKey: s.e2bKey ? `${s.e2bKey.slice(0, 6)}…${s.e2bKey.slice(-4)}` : "",
    e2bKeySet: !!s.e2bKey,
    providers: s.providers.map((p) => ({ ...p, apiKey: p.apiKey ? "••••••" : "", apiKeySet: !!p.apiKey })),
  };
}

app.get("/api/settings", (req, res) => send(res, maskSettings(getSettings())));

app.put("/api/settings", (req, res) => {
  try {
    const cur = getSettings();
    const patch = { ...req.body };
    // don't overwrite masked keys
    if (!patch.e2bKey || patch.e2bKey.includes("…") || patch.e2bKey.includes("•")) delete patch.e2bKey;
    if (patch.e2bKey === "") patch.e2bKey = "";
    const next = saveSettings(patch);
    send(res, maskSettings(next));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.get("/api/providers", (req, res) => send(res, maskSettings(getSettings()).providers));

app.post("/api/providers", (req, res) => {
  try {
    const s = getSettings();
    const p = {
      id: uid("prov"),
      name: req.body.name?.trim() || "Custom Provider",
      type: req.body.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible",
      apiBase: req.body.apiBase?.trim() || DEFAULT_API_BASE,
      apiKey: req.body.apiKey || "",
      createdAt: new Date().toISOString(),
    };
    s.providers.push(p);
    saveSettings({ providers: s.providers });
    send(res, { ...p, apiKey: p.apiKey ? "••••••" : "", apiKeySet: !!p.apiKey });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.put("/api/providers/:id", (req, res) => {
  try {
    const s = getSettings();
    const i = s.providers.findIndex((p) => p.id === req.params.id);
    if (i < 0) return fail(res, 404, "Provider not found");
    const patch = { ...req.body };
    if (!patch.apiKey || patch.apiKey.includes("•")) delete patch.apiKey;
    s.providers[i] = { ...s.providers[i], ...patch, id: req.params.id };
    saveSettings({ providers: s.providers });
    const p = s.providers[i];
    send(res, { ...p, apiKey: p.apiKey ? "••••••" : "", apiKeySet: !!p.apiKey });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.delete("/api/providers/:id", (req, res) => {
  try {
    const s = getSettings();
    s.providers = s.providers.filter((p) => p.id !== req.params.id);
    s.activeModels = (s.activeModels || []).filter((m) => m.providerId !== req.params.id);
    saveSettings({ providers: s.providers, activeModels: s.activeModels });
    send(res, { deleted: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// pull models list from provider
app.post("/api/providers/:id/models", async (req, res) => {
  try {
    const models = await fetchModels(req.params.id);
    const s = getSettings();
    s.modelCatalog[req.params.id] = { models, fetchedAt: new Date().toISOString() };
    saveSettings({ modelCatalog: s.modelCatalog });
    send(res, { models, count: models.length });
  } catch (e) {
    fail(res, 502, `Could not fetch models: ${e.message}`);
  }
});

app.post("/api/providers/:id/test", async (req, res) => {
  try {
    const out = await testProvider(req.params.id, req.body.model);
    send(res, out);
  } catch (e) {
    fail(res, 502, e.message);
  }
});

app.get("/api/models/active", (req, res) => {
  const s = getSettings();
  send(res, { activeModels: s.activeModels || [], defaultModel: s.defaultModel, catalog: s.modelCatalog || {} });
});

app.put("/api/models/active", (req, res) => {
  try {
    const patch = {};
    if (Array.isArray(req.body.activeModels)) patch.activeModels = req.body.activeModels;
    if (req.body.defaultModel) patch.defaultModel = req.body.defaultModel;
    send(res, maskSettings(saveSettings(patch)));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ---------------------------------------------------------------- E2B
app.post("/api/e2b/test", async (req, res) => {
  try {
    const key = req.body.key || getSettings().e2bKey;
    if (!key) return fail(res, 400, "No E2B API key provided");
    const out = await E2BDriver.validateKey(key);
    if (req.body.key) saveSettings({ e2bKey: req.body.key, e2bValidated: true });
    else saveSettings({ e2bValidated: true });
    send(res, out);
  } catch (e) {
    fail(res, 502, `E2B validation failed: ${e.message}`);
  }
});

// ---------------------------------------------------------------- MCP
app.get("/api/mcps", async (req, res) => {
  send(res, { servers: listServers(), statuses: getStatuses(), templates: MCP_TEMPLATES });
});
app.post("/api/mcps", (req, res) => {
  try {
    send(res, createServer(req.body || {}));
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.post("/api/mcps/install-template", (req, res) => {
  try {
    send(res, installTemplate(req.body.templateId, req.body.overrides || {}));
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.put("/api/mcps/:id", (req, res) => {
  try {
    send(res, updateServer(req.params.id, req.body || {}));
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.delete("/api/mcps/:id", (req, res) => {
  try {
    deleteServer(req.params.id);
    send(res, { deleted: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.post("/api/mcps/:id/connect", async (req, res) => {
  try {
    const entry = await ensureConnected(req.params.id);
    send(res, { tools: entry.tools });
  } catch (e) {
    fail(res, 502, e.message);
  }
});
app.post("/api/mcps/:id/disconnect", async (req, res) => {
  await disconnect(req.params.id);
  send(res, { disconnected: req.params.id });
});
app.get("/api/mcps/:id/tools", async (req, res) => {
  try {
    const entry = await ensureConnected(req.params.id);
    send(res, { tools: entry.tools });
  } catch (e) {
    fail(res, 502, e.message);
  }
});
app.post("/api/mcps/:id/call", async (req, res) => {
  try {
    const out = await callTool(req.params.id, req.body.tool, req.body.args || {});
    send(res, { result: out });
  } catch (e) {
    fail(res, 502, e.message);
  }
});
app.get("/api/mcps/tools/all", async (req, res) => {
  const tools = await aggregateTools();
  send(res, { tools, statuses: getStatuses() });
});

// ---------------------------------------------------------------- skills
app.get("/api/skills", (req, res) => send(res, { skills: listAllSkills() }));
app.post("/api/skills", (req, res) => {
  try {
    send(res, createCustomSkill(req.body || {}));
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.put("/api/skills/:id", (req, res) => {
  try {
    send(res, updateCustomSkill(req.params.id, req.body || {}));
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.delete("/api/skills/:id", (req, res) => {
  try {
    deleteCustomSkill(req.params.id);
    send(res, { deleted: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
app.post("/api/skills/:id/toggle", (req, res) => {
  try {
    const skills = setSkillEnabled(req.params.id, req.body.installed !== false);
    send(res, { skills });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
// re-sync enabled skills into an app sandbox
app.post("/api/apps/:id/skills/sync", async (req, res) => {
  try {
    const app = getApp(req.params.id);
    if (!app) return fail(res, 404, "App not found");
    const driver = driverFor(app);
    const files = skillSandboxFiles(getEnabledSkills());
    await driver.writeFiles(app.sandboxId, files);
    send(res, { synced: Object.keys(files).length });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ---------------------------------------------------------------- apps + sandboxes
app.get("/api/apps", (req, res) => send(res, getApps()));

app.post("/api/apps", async (req, res) => {
  // SSE provisioning stream? Keep simple: create + provision synchronously with long timeout.
  // Client polls status. We set status=provisioning then run async.
  try {
    const name = req.body.name?.trim() || `App ${new Date().toLocaleString()}`;
    const app = {
      id: uid("app"),
      name,
      status: "provisioning",
      sandboxId: null,
      sandboxDriver: null,
      previewUrl: null,
      createdAt: new Date().toISOString(),
      log: [],
    };
    upsertApp(app);
    // provision in background
    provisionApp(app.id).catch((err) => {
      const a = getApp(app.id);
      if (a) upsertApp({ ...a, status: "error", error: String(err.message || err) });
    });
    send(res, app);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

async function provisionApp(appId) {
  const app = getApp(appId);
  if (!app) return;
  const settings = getSettings();
  const pushLog = (text) => {
    const a = getApp(appId);
    if (a) upsertApp({ ...a, log: [...(a.log || []), { t: new Date().toISOString(), text }].slice(-200) });
  };
  const onEvent = (e) => {
    if (e.type === "log") pushLog(`[${e.stream}] ${e.text}`);
  };
  const skillFiles = skillSandboxFiles(getEnabledSkills());

  // Try E2B first
  if (settings.e2bKey) {
    try {
      const { sandboxId } = await E2BDriver.create(
        { apiKey: settings.e2bKey, template: settings.e2bTemplate, timeoutMs: settings.sandboxTimeoutMs, metadata: { appId, app: app.name } },
        onEvent,
      );
      upsertApp({ ...getApp(appId), sandboxId, sandboxDriver: "e2b", status: "provisioning" });
      await E2BDriver.provision(sandboxId, skillFiles, onEvent);
      const previewUrl = await E2BDriver.previewUrl(sandboxId, PREVIEW_PORT).catch(() => null);
      upsertApp({ ...getApp(appId), status: "ready", previewUrl });
      pushLog("Sandbox ready.");
      return;
    } catch (err) {
      pushLog(`E2B failed: ${err.message}`);
      if (!settings.allowLocalFallback) {
        upsertApp({ ...getApp(appId), status: "error", error: `E2B provisioning failed: ${err.message}` });
        return;
      }
      pushLog("Falling back to local emulation sandbox…");
    }
  } else if (!settings.allowLocalFallback) {
    upsertApp({ ...getApp(appId), status: "error", error: "No E2B key configured and local fallback is disabled." });
    return;
  }

  // Local fallback
  try {
    const { sandboxId } = await LocalDriver.create({ appId }, onEvent);
    upsertApp({ ...getApp(appId), sandboxId, sandboxDriver: "local", status: "provisioning" });
    await LocalDriver.provision(sandboxId, skillFiles, onEvent);
    upsertApp({ ...getApp(appId), status: "ready", previewUrl: `/preview/${appId}/` });
  } catch (err) {
    upsertApp({ ...getApp(appId), status: "error", error: `Provisioning failed: ${err.message}` });
  }
}

app.get("/api/apps/:id", (req, res) => {
  const a = getApp(req.params.id);
  if (!a) return fail(res, 404, "App not found");
  send(res, a);
});

app.delete("/api/apps/:id", async (req, res) => {
  try {
    const a = getApp(req.params.id);
    if (a?.sandboxId) {
      try {
        await driverFor(a).kill(a.sandboxId);
      } catch {}
    }
    deleteApp(req.params.id);
    send(res, { deleted: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.post("/api/apps/:id/rebuild", async (req, res) => {
  const a = getApp(req.params.id);
  if (!a) return fail(res, 404, "App not found");
  upsertApp({ ...a, status: "provisioning" });
  (async () => {
    try {
      const driver = driverFor(a);
      await driver.rebuild(a.sandboxId, () => {});
      if (a.sandboxDriver === "e2b") {
        const previewUrl = await E2BDriver.previewUrl(a.sandboxId, PREVIEW_PORT).catch(() => a.previewUrl);
        upsertApp({ ...getApp(a.id), status: "ready", previewUrl });
      } else {
        upsertApp({ ...getApp(a.id), status: "ready" });
      }
    } catch (e) {
      upsertApp({ ...getApp(a.id), status: "error", error: String(e.message) });
    }
  })();
  send(res, { rebuilding: true });
});

app.post("/api/apps/:id/restart", async (req, res) => {
  try {
    const a = getApp(req.params.id);
    if (!a) return fail(res, 404, "App not found");
    const driver = driverFor(a);
    await driver.startDev(a.sandboxId, () => {});
    if (a.sandboxDriver === "e2b") {
      const previewUrl = await E2BDriver.previewUrl(a.sandboxId, PREVIEW_PORT).catch(() => a.previewUrl);
      upsertApp({ ...a, previewUrl });
    }
    send(res, { restarted: true });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.get("/api/apps/:id/tree", async (req, res) => {
  try {
    const a = getApp(req.params.id);
    if (!a?.sandboxId) return fail(res, 400, "App has no sandbox yet");
    const tree = await driverFor(a).tree(a.sandboxId);
    send(res, { tree });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.get("/api/apps/:id/file", async (req, res) => {
  try {
    const a = getApp(req.params.id);
    if (!a?.sandboxId) return fail(res, 400, "App has no sandbox yet");
    const content = await driverFor(a).readFile(a.sandboxId, req.query.path || "");
    send(res, { path: req.query.path, content: content.slice(0, 200000) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.post("/api/apps/:id/exec", async (req, res) => {
  try {
    const a = getApp(req.params.id);
    if (!a?.sandboxId) return fail(res, 400, "App has no sandbox yet");
    const out = await driverFor(a).exec(a.sandboxId, req.body.command, { timeoutMs: 120_000 });
    send(res, out);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

app.get("/api/apps/:id/preview", async (req, res) => {
  const a = getApp(req.params.id);
  if (!a) return fail(res, 404, "App not found");
  if (a.sandboxDriver === "e2b" && a.sandboxId) {
    try {
      const url = await E2BDriver.previewUrl(a.sandboxId, PREVIEW_PORT);
      return send(res, { url });
    } catch (e) {
      return fail(res, 502, e.message);
    }
  }
  send(res, { url: `/preview/${a.id}/` });
});

// local-fallback static preview hosting
app.use("/preview/:appId", (req, res, next) => {
  const dir = LocalDriver.distDir(req.params.appId);
  if (!fs.existsSync(dir)) return res.status(404).send("Preview not built yet");
  express.static(dir)(req, res, () => {
    // SPA fallback
    const idx = path.join(dir, "index.html");
    if (fs.existsSync(idx)) res.sendFile(idx);
    else next();
  });
});

// ---------------------------------------------------------------- chats + agent stream (SSE)
app.get("/api/apps/:id/chats", (req, res) => {
  const chats = getChats().chats.filter((c) => c.appId === req.params.id);
  send(res, { chats });
});

app.post("/api/apps/:id/chats", (req, res) => {
  const a = getApp(req.params.id);
  if (!a) return fail(res, 404, "App not found");
  const chat = {
    id: uid("chat"),
    appId: req.params.id,
    title: req.body.title || "New chat",
    messages: [],
    createdAt: new Date().toISOString(),
  };
  upsertChat(chat);
  send(res, chat);
});

app.get("/api/chats/:id", (req, res) => {
  const c = getChat(req.params.id);
  if (!c) return fail(res, 404, "Chat not found");
  send(res, c);
});

app.post("/api/chats/:id/messages", async (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return fail(res, 404, "Chat not found");
  const app = getApp(chat.appId);
  if (!app?.sandboxId) return fail(res, 400, "App sandbox is not ready yet");
  const content = (req.body.content || "").trim();
  if (!content) return fail(res, 400, "Empty message");
  const mode = ["build", "agent", "ask"].includes(req.body.mode) ? req.body.mode : "build";

  let provider, modelId;
  try {
    ({ provider, modelId } = resolveModelRef(req.body.model));
  } catch (e) {
    return fail(res, 400, e.message);
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const write = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  // NOTE: req 'close' fires spuriously after body read; only res close (before end) means cancel.
  res.on("close", () => {
    if (!res.writableEnded) ctrl.abort();
  });

  // persist user message immediately
  const userMsg = { id: uid("m"), role: "user", content, createdAt: new Date().toISOString() };
  upsertChat({ ...getChat(chat.id), messages: [...getChat(chat.id).messages, userMsg] });
  write({ type: "user", message: userMsg });

  const history = getChat(chat.id).messages.filter((m) => m.role !== "system").slice(-30);

  try {
    write({ type: "start", provider: provider.name, model: modelId, mode });
    const out = await runAgentTurn({
      app,
      provider,
      modelId,
      mode,
      history,
      userContent: content,
      signal,
      onEvent: write,
    });
    const assistantMsg = {
      id: uid("m"),
      role: "assistant",
      content: out.text,
      display: out.display,
      mode,
      model: modelId,
      createdAt: new Date().toISOString(),
    };
    const fresh = getChat(chat.id);
    const patch = { ...fresh, messages: [...fresh.messages, assistantMsg] };
    if (out.summary && (fresh.title === "New chat" || !fresh.title)) patch.title = out.summary;
    upsertChat(patch);
    write({ type: "done", message: assistantMsg, title: patch.title });
    res.end();
  } catch (err) {
    const msg = signal.aborted ? "Request cancelled." : String(err.message || err);
    const errMsg = { id: uid("m"), role: "assistant", content: `⚠️ ${msg}`, display: `⚠️ ${msg}`, error: true, createdAt: new Date().toISOString() };
    if (!signal.aborted) {
      const fresh = getChat(chat.id);
      upsertChat({ ...fresh, messages: [...fresh.messages, errMsg] });
    }
    write({ type: "error", error: msg });
    res.end();
  }
});

// ---------------------------------------------------------------- client hosting (production)
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/preview/")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[dyad-saas] API listening on http://0.0.0.0:${PORT}`);
  console.log(`[dyad-saas] default LLM base: ${DEFAULT_API_BASE}`);
  console.log(`[dyad-saas] default model: ${DEFAULT_TEST_MODEL}`);
});
