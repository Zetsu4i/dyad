// Smoke test: verifies the API surface is up and coherent.
// Usage: node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] || "http://127.0.0.1:8081";
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
async function get(p) {
  const r = await fetch(`${BASE}${p}`);
  const j = await r.json();
  if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
  return j.data;
}
async function post(p, body) {
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
  return j.data;
}
async function del(p) {
  const r = await fetch(`${BASE}${p}`, { method: "DELETE" });
  const j = await r.json();
  if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
  return j.data;
}

console.log(`smoke: ${BASE}`);
await check("health", async () => get("/api/health"));
await check("settings (keys masked)", async () => {
  const s = await get("/api/settings");
  if (!s.providers?.length) throw new Error("no default provider");
  if (s.e2bKeySet && s.e2bKey.length > 16) throw new Error("e2b key not masked");
});
await check("models/active", async () => get("/api/models/active"));
await check("skills catalog", async () => {
  const d = await get("/api/skills");
  if (!d.skills?.length) throw new Error("empty catalog");
});
await check("mcp templates", async () => {
  const d = await get("/api/mcps");
  if (!d.templates?.length) throw new Error("no templates");
});
await check("provider CRUD", async () => {
  const p = await post("/api/providers", { name: "smoke", type: "openai-compatible", apiBase: "http://x", apiKey: "k" });
  await del(`/api/providers/${p.id}`);
});
await check("skill CRUD", async () => {
  const s = await post("/api/skills", { name: "smoke", description: "d", content: "# x" });
  await post(`/api/skills/${s.id}/toggle`, { installed: false });
  await del(`/api/skills/${s.id}`);
});
await check("mcp CRUD", async () => {
  const m = await post("/api/mcps/install-template", { templateId: "custom-http", overrides: { url: "https://x/mcp" } });
  await del(`/api/mcps/${m.id}`);
});
console.log(failures ? `SMOKE FAILED (${failures})` : "SMOKE PASSED");
process.exit(failures ? 1 : 0);
