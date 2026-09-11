# Dyad SaaS — web-based AI app builder

A cloud-hosted, Electron-free build of Dyad: chat with an agent that writes code
directly into **E2B sandboxes**. Bring your own LLM provider (OpenAI-compatible
or Anthropic-compatible), connect **MCP servers**, install **Skills**, and build
apps from the browser.

Enterprise-neutral dark UI (zinc-950/zinc-900, no gradients).

## Quick start

```bash
cd saas
npm install
npm run dev        # API :8081 + web client :5173
# or production:
npm run build && npm start   # serves API + client on :8081
node scripts/smoke.mjs       # API smoke test
```

## Configure (Settings)

1. **Providers** — add an OpenAI-compatible (`/v1/chat/completions`) or
   Anthropic-compatible (`/v1/messages`) endpoint with base URL + key.
   Pre-seeded: `Default Gateway → https://agaam2-7dba6cfc4d0a.herokuapp.com/`.
2. **Models** — `Pull models list` per provider, **Activate** the ones you want,
   pick a default. Only activated models show in the builder. Cheap default for
   testing: `openai/gpt-4.1`.
3. **E2B & Runtime** — paste your E2B API key, `Validate`, choose template +
   sandbox lifetime. Optional local-emulation fallback for offline testing.

## Build apps

- **Apps → New app**: provisions an E2B sandbox (Node ensured, React +
  Tailwind starter installed, enabled skills synced to `.skills/`), starts the
  dev server on :5173 and gives you a public preview URL.
- **Builder**: chat (Build / Agent / Ask modes), model picker, live preview,
  file explorer, tool + sandbox logs, restart/rebuild controls.
- Agent tools: `read/write/edit/delete/rename files`, `run_command`,
  `add_dependency`, `run_type_checks`, `update_todos`, plus MCP tools —
  with `<dyad-write>`-tag compatibility carried over from desktop Dyad.

## Integrations (MCP)

- **Installed**: add stdio / SSE / streamable-HTTP servers, enable/disable,
  connect, browse tools, test-call with JSON args.
- **Catalog**: one-click installs (GitHub, Postgres, Stripe, Slack, Notion,
  Puppeteer, Brave Search, filesystem…) — then add credentials under Configure.
- Connected tools are exposed to the agent natively (`mcp__<server>__<tool>`)
  and via `list_mcp_tools` / `call_mcp_tool`.

## Skills

- **Catalog**: 9 built-ins (Stripe, Supabase, REST API, Enterprise UI, Forms,
  Neon, GitHub, Playwright, Vercel) — one-click install.
- **Custom**: author SKILL.md-style instruction packs for your APIs/workflows.
- Installed skills are **injected into the system prompt** and **synced into
  every sandbox** under `.skills/<id>/SKILL.md`, so both the orchestrator and
  in-sandbox work follow them. Re-sync any time (per-app API or "Sync to all
  sandboxes").

## Architecture

```
saas/
  server/          Express API (plain Node, no Electron)
    index.mjs      routes: settings/providers/models, e2b, mcp, skills, apps, chats (SSE)
    llm.mjs        OpenAI-compat + Anthropic-compat streaming clients w/ tool calls
    agent.mjs      agentic loop: tools → sandbox, dyad-tag compat, mock offline agent
    sandboxes.mjs  E2B driver (primary) + local emulation fallback
    mcp.mjs        MCP connection manager (stdio/SSE/HTTP) + install templates
    skills.mjs     skill registry + prompt injection + sandbox sync
    prompts.mjs    system prompts adapted from Dyad desktop (build/agent/ask)
    scaffold.mjs   Vite+React+TS+Tailwind starter written into new sandboxes
  client/          React + Tailwind v4 (zinc dark) — Apps, Builder, Settings, MCP, Skills
```

## Notes / roadmap to full SaaS

- Single-workspace MVP: data in `server/data/*.json`. Multi-tenancy, auth
  (OAuth/teams), billing, and per-user sandbox quotas are the next layer.
- E2B sandboxes expire after the configured lifetime; reconnect/pause-resume
  surfacing is minimal in this MVP.
- `mock-agent` in the model picker runs a scripted offline turn (no LLM) —
  useful for verifying sandbox + preview plumbing.
