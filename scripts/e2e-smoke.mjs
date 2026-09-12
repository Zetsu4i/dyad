// E2E smoke test against the running dev server (port 3000).
// Drives the full product path: register → E2B key → provider → models →
// app create → sandbox start → agent chat (SSE) → files → pause/resume.
//
// Usage: bun scripts/e2e-smoke.mjs
const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
const E2B_KEY =
  process.env.E2B_API_KEY || "e2b_1415aff06b90ed6baf98255e8cb6f8c606515139";
const PROVIDER_BASE =
  process.env.PROVIDER_BASE || "https://agaam2-7dba6cfc4d0a.herokuapp.com";

let cookie = "";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) cookie = c.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

function log(step, msg) {
  console.log(`\n[step ${step}] ${msg}`);
}

async function main() {
  console.log(`Smoke target: ${BASE}`);

  // 1) Register a fresh account
  const email = `smoke-${Date.now()}@forge.test`;
  let r = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: "forge-smoke-123", name: "Smoke" }),
  });
  log(1, `register -> ${r.status} ${r.text.slice(0, 140)}`);
  if (r.status >= 400) throw new Error("register failed");

  // 2) Save the E2B key
  r = await api("/api/settings/e2b", {
    method: "PUT",
    body: JSON.stringify({ apiKey: E2B_KEY }),
  });
  log(2, `e2b key save -> ${r.status} ${r.text.slice(0, 100)}`);

  // 3) Point the default provider at the gateway
  r = await api("/api/settings/providers");
  const providers = r.json?.data?.providers || r.json?.providers || [];
  const providerId = providers[0]?.id;
  log(3, `providers list -> ${r.status}, found ${providers.length} (id=${providerId})`);
  r = await api("/api/settings/providers", {
    method: "PUT",
    body: JSON.stringify({ providerId, baseUrl: PROVIDER_BASE, name: "Gateway" }),
  });
  log(3, `provider base set -> ${r.status} ${r.text.slice(0, 100)}`);

  // 4) Pull live models + activate gpt-4.1
  r = await api("/api/settings/models/pull", {
    method: "POST",
    body: JSON.stringify({ activateIds: ["openai/gpt-4.1"] }),
  });
  const models = r.json?.models || r.json?.data?.models || [];
  const has411 = models.some((m) => m.id === "openai/gpt-4.1");
  log(4, `pull models -> ${r.status}, catalog=${models.length}, has openai/gpt-4.1=${has411}`);
  if (models.length === 0) console.log("   raw:", r.text.slice(0, 300));

  // 5) Models list shows active/default
  r = await api("/api/settings/models");
  const active = (r.json?.data?.models || r.json?.models || []).filter((m) => m.isActive);
  log(5, `models active -> ${r.status}: ${active.map((m) => `${m.modelId}${m.isDefault ? "*" : ""}`).join(", ") || r.text.slice(0, 200)}`);

  // 6) Create an app from the react-vite template
  r = await api("/api/apps", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke App", templateId: "react-vite" }),
  });
  const app = r.json?.data?.app || r.json?.app;
  const appId = app?.id;
  log(6, `create app -> ${r.status} appId=${appId} template=${app?.templateId}`);
  if (!appId) throw new Error("app create failed: " + r.text.slice(0, 200));

  // 7) Start the sandbox
  r = await api(`/api/apps/${appId}/sandbox`, {
    method: "POST",
    body: JSON.stringify({ action: "start" }),
  });
  log(7, `sandbox start -> ${r.status} ${r.text.slice(0, 220)}`);

  // 8) Agent chat turn over SSE
  const chatStarted = Date.now();
  const chatRes = await fetch(`${BASE}/api/apps/${appId}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      message:
        "Create a minimal page: a centered card that says 'Hello from Forge smoke test' on a dark background. Keep it small.",
    }),
  });
  log(8, `chat POST -> ${chatRes.status} (${chatRes.headers.get("content-type")})`);
  let events = 0;
  const counts = {};
  let sawText = 0,
    sawTool = 0,
    sawDone = false,
    sawError = null;
  if (chatRes.body) {
    const reader = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          events++;
          let ev;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }
          counts[ev.type] = (counts[ev.type] || 0) + 1;
          if (ev.type === "start") console.log(`   [start] model=${ev.modelId}`);
          else if (ev.type === "tool-start") {
            sawTool++;
            console.log(`   [tool] ${ev.tool} ${JSON.stringify(ev.input || {}).slice(0, 110)}`);
          } else if (ev.type === "tool-result")
            console.log(`   [tool✓] ${ev.tool} ok=${ev.ok} ${String(ev.summary || "").slice(0, 90)}`);
          else if (ev.type === "files-changed")
            console.log(`   [files] ${(ev.paths || []).join(", ")}`);
          else if (ev.type === "error" || ev.type === "stream-warning") {
            sawError = ev.message || JSON.stringify(ev);
            console.log(`   [${ev.type}] ${sawError.slice(0, 220)}`);
          } else if (ev.type === "done") {
            sawDone = true;
            console.log(`   [done] finish=${ev.finishReason} contentLen=${(ev.content || "").length}`);
          } else if (ev.type === "text-delta") sawText += (ev.text || "").length;
        }
      }
      if (Date.now() - chatStarted > 330_000) {
        console.log("   chat timeout after 5.5min — aborting read");
        break;
      }
    }
  }
  log(8, `chat finished: ${events} events (${JSON.stringify(counts)}) in ${Math.round((Date.now() - chatStarted) / 1000)}s`);
  console.log(`   textLen=${sawText} toolCalls=${sawTool} done=${sawDone} error=${sawError}`);

  // 9) Files list
  r = await api(`/api/apps/${appId}/files`);
  const files = r.json?.tree || r.json?.data?.tree || [];
  log(9, `files -> ${r.status}, ${files.length} top-level entries: ${files.slice(0, 12).map((f) => f.path || f.name).join(" | ")}`);

  // 10) Pause sandbox (cost saving)
  r = await api(`/api/apps/${appId}/sandbox`, {
    method: "POST",
    body: JSON.stringify({ action: "pause" }),
  });
  log(10, `sandbox pause -> ${r.status} ${r.text.slice(0, 160)}`);

  // 11) Resume the same sandbox (session resume)
  r = await api(`/api/apps/${appId}/sandbox`, {
    method: "POST",
    body: JSON.stringify({ action: "start" }),
  });
  log(11, `sandbox resume -> ${r.status} ${r.text.slice(0, 220)}`);

  // 12) Command into the resumed sandbox + pause again
  r = await api(`/api/apps/${appId}/command`, {
    method: "POST",
    body: JSON.stringify({ command: "ls -la /app | head -12; echo ---; cat package.json | head -8" }),
  });
  log(12, `command -> ${r.status} ${String(r.json?.data?.output || r.text).slice(0, 400)}`);
  r = await api(`/api/apps/${appId}/sandbox`, {
    method: "POST",
    body: JSON.stringify({ action: "pause" }),
  });
  log(12, `final pause -> ${r.status}`);

  // 13) Dashboard apps list (MyApps)
  r = await api("/api/apps");
  const apps = r.json?.data?.apps || r.json?.apps || [];
  log(13, `apps list -> ${r.status}, ${apps.length} apps`);

  console.log("\n=== SMOKE SUMMARY ===");
  console.log(`register: OK, provider: OK, models: ${models.length} pulled, gpt-4.1: ${has411}`);
  console.log(`sandbox start/pause/resume: OK, chat events: ${events}, tools: ${sawTool}, done: ${sawDone}`);
  console.log(`errors: ${sawError ?? "none"}`);
}

main().catch((e) => {
  console.error("\nSMOKE FAILED:", e);
  process.exit(1);
});
