# Dyad Cloud

A fully web-based, SaaS distribution of [Dyad](https://github.com/dyad-sh/dyad) —
the open-source AI app builder. The Electron shell is gone: the agent runs on a
Node server, apps are built and hosted in **E2B cloud sandboxes** (or local
processes for self-hosting), and the whole product is delivered as a single
Next.js web app with an enterprise dark UI.

## What's here

| Upstream Dyad (Electron)                     | Dyad Cloud (web)                                          |
| -------------------------------------------- | --------------------------------------------------------- |
| Electron main process + IPC                  | Next.js server (App Router API routes)                    |
| Apps on local disk, local dev servers        | Apps in **E2B sandboxes** (user-provided key) or local runner |
| Local SQLite via drizzle                     | SQLite via drizzle (`webapp/.data/dyad-cloud.db`)          |
| Custom LLM engine / provider setup           | **Any OpenAI-compatible or Anthropic-compatible endpoint** (base URL + key) |
| —                                            | **MCP servers** (HTTP/SSE/stdio) with dashboard + catalog |
| —                                            | **Skills** (SKILL.md modules) injected into prompt + sandbox |
| `scaffold/` Vite template                    | Same template, ported verbatim                            |

### Agent core — ported, not reinvented

The agent's prompts and streaming protocol are copied **verbatim** from the
upstream repository (`src/dyad-core/`, with per-file port notes):

- `prompts/system-prompt.ts` — the build/ask system prompts, byte-for-byte,
  including the `<dyad-write>` / `<dyad-rename>` / `<dyad-delete>` /
  `<dyad-add-dependency>` / `<dyad-command>` / `<dyad-chat-summary>` protocol.
  Only additions: a `CLOUD_ENV_BLOCK` (explains the cloud sandbox; command
  semantics identical to upstream).
- `parser/streaming-message-parser.ts` — the incremental streaming parser,
  verbatim (same import path fix only).
- `parser/dyad-tag-parser.ts` — final-response tag extraction, verbatim minus
  electron-log and the Supabase/Turbo-Edits parsers.
- MCP tool calls are persisted into messages using the same
  `<dyad-mcp-tool-call>` / `<dyad-mcp-tool-result>` wire format as upstream's
  `chat_stream_handlers.ts`.
- `server/sandbox/template/` — the `scaffold/` Vite + React + shadcn template,
  verbatim (vite config gains an env-driven `base` for local-runner proxying).

## Quick start

```bash
cd webapp
npm install            # on very new Node ABIs: npm install --nodedir=<headers dir>
npm run dev            # or: npm run build && npm start  (port 3000)
```

Open http://localhost:3000. First boot seeds:

- two provider entries for the default gateway
  (`https://agaam2-7dba6cfc4d0a.herokuapp.com`, OpenAI- and Anthropic-compatible)
  with `openai/gpt-4.1` active as the cheap testing model,
- an **Offline Demo** provider (no network needed — exercises the full
  chat → files → sandbox → preview pipeline),
- a curated **skills gallery** (6 skills) and an **MCP catalog** (8 presets).

### Environment

| Variable                | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `E2B_API_KEY`           | Seeds the E2B key on first boot (can also be set in Settings → Sandbox) |
| `DEFAULT_LLM_BASE_URL`  | Overrides the seeded gateway URL                                    |
| `DEFAULT_LLM_API_KEY`   | Seeds the gateway API key                                           |
| `DYAD_RUNNER=local`     | Default the runner to local processes (dev/no-E2B environments)     |
| `WORKSPACE_PASSWORD`    | Requires a password sign-in (recommended for cloud deploys)         |

### Settings dashboard

- **Providers** — add OpenAI-compatible / Anthropic-compatible endpoints
  (name + base URL + key), **Pull models** (`GET {base}/v1/models`), then
  activate the models you want in the builder's picker.
- **Models** — all active models across providers; pick the default.
- **Sandbox (E2B)** — paste and **Verify** your E2B key (verified via
  `Sandbox.list`); optional custom E2B template; runner selection.
- **MCP Servers** — add HTTP/SSE/stdio servers (headers/env supported), test
  connections, browse discovered tools, or one-click install from the catalog
  (DeepWiki, Context7, GitHub, Sentry, Fetch, Filesystem, Memory, Postgres).
- **Skills** — enable curated skills or write your own (name, description,
  SKILL.md markdown).

## How an app runs

1. **Create**: "New app" from a prompt → template files seeded → first agent
   turn streams (build mode).
2. **Agent turn**: server assembles the verbatim Dyad prompt + codebase
   context + skills + MCP tools → streams via the AI SDK → parses dyad tags →
   applies writes/renames/deletes/dependency installs.
3. **Sandbox**: files sync into the sandbox; `npm install --legacy-peer-deps`
   (same flags as upstream) and `vite` run inside; the dev server is exposed
   at `https://{sandbox.getHost(8080)}` (E2B) or proxied at
   `/api/preview/{appId}/` (local runner).
4. **Commands**: `rebuild` (rm node_modules → install → restart), `restart`,
   `refresh` — suggested by the agent via `<dyad-command>` and available as
   header buttons.

## Notes & limits (MVP)

- Secrets (LLM/E2B keys) are stored in the workspace SQLite file — single-tenant
  MVP; encrypt at rest or move to a secret manager for multi-tenant production.
- `stdio` MCP servers run on the web server (great for self-hosting); remote
  HTTP/SSE servers are the recommended path for cloud deployments.
- The upstream *Local Agent* tool-calling mode, Supabase/Neon integrations,
  GitHub sync and Turbo Edits are intentionally out of scope for this MVP;
  the tag-protocol build/ask modes are fully preserved.
- This repo's dev sandbox blocks outbound HTTPS to `api.e2b.app` / LLM
  gateways, so the bundled `.env` uses `DYAD_RUNNER=local` and the Offline
  Demo provider for testing. Remove `DYAD_RUNNER=local` in a real deployment
  to default to E2B.

## Tests

```bash
npm run test        # vitest — parser & tag protocol suites
npm run typecheck   # tsc --noEmit
```
