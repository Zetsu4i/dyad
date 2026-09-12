# Forge — AI App Builder (Dyad fork, web-first)

A fully web-based, enterprise-dark SaaS rebuild of [Dyad](https://github.com/dyad-sh/dyad) — Electron stripped out, execution moved to **E2B cloud sandboxes**, with **skills** and **MCP server** support, bring-your-own LLM providers, and a professional zinc/stone dark UI.

The agent system (system prompts, tool set, search/replace editing semantics) is **ported from Dyad's local agent v2** and adapted to run every file and command operation inside a per-app E2B sandbox.

---

## What it does

- **Build apps by chatting** — an agent with real tools (write/edit/read files, grep, run commands, install packages, restart the dev server) works inside a live cloud sandbox. You watch its thinking, tool calls, and results stream in the chat while the preview updates.
- **Templates** — React+Vite, Next.js, Node API (Express), **Expo (iOS/Android/Web)**, and static HTML starters.
- **Live preview** — each app's dev server runs in the sandbox and is proxied on a public E2B URL shown in the Preview panel (with device-size switcher).
- **Files & code editor** — full file tree plus a Monaco editor (open, edit, ⌘S save).
- **Terminal** — dev server logs plus a one-shot command runner into the sandbox.
- **Sandbox lifecycle that saves money** — leaving the builder pauses the sandbox (debounced, snapshot first); re-opening resumes the *same* sandbox with all files, node_modules and state. Idle sandboxes auto-pause after ~4 minutes.
- **Skills** (SKILL.md bundles) — install from a curated catalog (anthropics/skills) or any GitHub repo; they're copied into the app sandbox at `.skills/<slug>/` and advertised to the agent in the system prompt.
- **MCP servers** — register stdio MCP servers (e.g. `npx -y @modelcontextprotocol/server-filesystem /home/user/app`); they're launched **inside the app sandbox** via [supergateway](https://github.com/nicholasgriffintn/supergateway) (stdio → streamable HTTP) and their tools are bridged live into the agent as `mcp_<server>_<tool>`.
- **Bring your own keys, always** — LLM provider base URLs + keys, and the E2B key, are entered in the Settings UI and stored in the app database. **Nothing is ever hardcoded, and keys are never rendered back to the UI or exposed to the agent.**

## Settings dashboard

| Section | What you configure |
| --- | --- |
| **Providers** | OpenAI-compatible and Anthropic-compatible endpoints (base URL + optional key), with a live connection test. |
| **Models** | Pull the live model list from the provider's `/v1/models`, activate the ones you want, set a default (they then appear in the builder's model picker). Manual model IDs work too. |
| **E2B Sandboxes** | Your E2B API key + connection test, plus how sandbox billing/pausing works. |
| **Skills** | Installed skills (enable/disable/uninstall), curated catalog one-click install, GitHub URL install. |
| **MCP Servers** | Register servers (with presets), test the connection (tools are discovered and cached), enable/disable per app. |

Per-app selections are managed from the builder header (✦ skills / ⏚ MCP chips) — toggles re-sync the sandbox immediately.

## Architecture

```
Browser (Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui, Monaco)
  │  SSE: /api/apps/[id]/chat          (agent streaming: thinking, text, tool events)
  │  REST: /api/apps/*, /api/settings/*, /api/skills, /api/mcp
  ▼
Next.js route handlers (Node runtime)
  ├─ Agent runner (AI SDK v7 streamText, ported Dyad prompts + tool set)
  │    tools: write_file, search_replace, read_file, list_files, grep,
  │           delete_file, rename_file, add_dependency, run_command,
  │           restart_app, reinstall_and_restart_app, read_logs,
  │           set_chat_title, read_skill  +  mcp_<server>_<tool> (dynamic)
  ├─ Sandbox manager (E2B SDK v2)
  │    create / connect(resume) / pause / snapshot per app
  │    files, commands, detached dev servers (setsid + nohup)
  │    auto-reconnect on stale SDK connections, idle sweeper
  ├─ MCP bridge (@modelcontextprotocol/sdk clients → supergateway in sandbox)
  └─ Prisma + SQLite (users, sessions, apps, chats, messages,
     provider configs, models, skills, mcp servers, per-app links)
```

- **Dev servers are fully detached** (`setsid nohup … > /tmp/forge-dev.log`) so they survive SDK reconnects and module reloads; logs are read from the file.
- **Pause/resume**: `sandbox.pause()` keeps the sandbox resumable via `Sandbox.connect(sandboxId)`; snapshots (`createSnapshot()`) are taken after every agent turn and before pausing as a durable fallback (`Sandbox.create(snapshotId)`).
- **Model routing**: OpenAI-compatible providers go through `createOpenAI({ baseURL })`; Anthropic-compatible through `createAnthropic({ baseURL })`. The default test model is `openai/gpt-4.1`.

## Getting started

```bash
bun install        # or npm install
cp .env.example .env   # set DATABASE_URL (and optionally FORGE_DEFAULT_API_BASE)
mkdir -p db && bun run db:push    # create the SQLite schema
bun run dev        # http://localhost:3000
```

1. Register an account.
2. **Settings → E2B** — paste your [E2B API key](https://e2b.dev/dashboard?tab=keys) and test it.
3. **Settings → Providers** — your gateway base URL (OpenAI- or Anthropic-compatible). Optionally test it.
4. **Settings → Models** — *Pull model list*, activate models, set a default. (A default `openai/gpt-4.1` entry is seeded for quick testing.)
5. **Dashboard → New app** — pick a template and start building.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file path (Prisma). |
| `FORGE_DEFAULT_API_BASE` | Optional default base URL seeded for new accounts (a URL, never a key). |

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma + SQLite · AI SDK v7 (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) · E2B SDK v2 (`e2b`) · `@modelcontextprotocol/sdk` · Monaco · react-resizable-panels

## Relationship to Dyad

This branch is a from-scratch webapp rebuild of the Dyad product concept on a new stack:

- **Kept (ported)**: the agent's system-prompt structure and guidance blocks (role, tool-calling rules, file-editing tool selection, development workflow), the core tool set and semantics (notably `search_replace` line-based matching with the two-failure fallback rule), and the product flow (apps, chats, live preview, restart/rebuild).
- **Replaced**: Electron/IPC → web SSE; local/Docker execution → E2B cloud sandboxes; local settings files → per-user settings in the DB; static model catalog → live model pull + activation.
- **Added**: skills bundles in-sandbox, MCP servers in-sandbox via supergateway, the settings dashboard, auth, and the zinc/stone enterprise dark UI.

See `LICENSE` (Apache-2.0, upstream Dyad) and `NOTICE` for attribution.

## Security notes

- API keys live only in your own database and are masked in every API response.
- The agent never sees provider keys, your E2B key, or other users' data.
- MCP `env` values are passed to the sandbox process only.
