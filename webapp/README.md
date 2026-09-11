# Dyad Cloud

A cloud-hosted, SaaS rebuild of [Dyad](https://github.com/dyad-sh/dyad) — the open-source AI app builder.
The Electron desktop shell is gone: everything runs as a web app, and **user apps execute in isolated
[E2B](https://e2b.dev) cloud sandboxes** instead of local processes.

## What's inside

- **Agent system ported 1:1 from Dyad** — the Basic Agent Mode prompt blocks (role, app commands,
  lifecycle, guidelines, tool calling, workflow, AI rules), the tool set (`write_file`, `search_replace`
  with Dyad's cascading fuzzy line-matcher, `read_file`, `list_files`, `grep`, `delete_file`,
  `rename_file`, `add_dependency`, `restart_app`, `reinstall_and_restart_app`, `read_logs`,
  `set_chat_summary`, `update_todos`), the MCP consent policy, and the compaction prompt.
  See `server/agent/prompts.ts` and `server/agent/tools.ts` for porting notes.
- **E2B sandbox runtime** — every app gets a sandbox: scaffold upload, `npm install`, a Vite dev server
  on a public sandbox URL (live preview), agent commands, and git commits per turn. File changes are
  snapshotted server-side so a sandbox can be recreated after expiry.
  A `local` runtime (same interface, host processes) is included for offline development.
- **Bring-your-own providers** — connect any OpenAI-compatible (`/v1/chat/completions`) or
  Anthropic-compatible (`/v1/messages`) endpoint: base URL + API key. Pull the provider's model list,
  activate models, and pick them per chat in the builder. Ships preconfigured for
  `https://agaam2-7dba6cfc4d0a.herokuapp.com` with `openai/gpt-4.1` as the default test model.
- **MCP support** — a catalog of one-click-installable MCP servers (filesystem, GitHub, Brave, Slack,
  Postgres, Puppeteer, Exa, Notion/Linear hosted endpoints, …) plus custom stdio/HTTP servers.
  stdio servers run *inside the app's sandbox* behind a dependency-free MCP bridge
  (`assets/mcp-bridge.mjs`) that speaks JSON-RPC over the sandbox's public host. Tools are exposed to
  the agent through a single `mcp_tool_call` tool, gated by the ported Dyad consent policy
  (auto / always-ask / always-allow, with an in-chat consent card).
- **Skills** — SKILL.md-style instruction playbooks (six built-in, plus your own). Installing a skill
  writes it into the sandbox at `/home/user/skills/<slug>/` and registers it in the system prompt;
  the agent loads it on demand with `read_skill`.
- **Enterprise dark UI** — zinc/stone neutral palette, dashboard + builder (chat · live preview · code ·
  logs · integrations) + a full settings dashboard (general, providers, models, sandbox/E2B, MCP, skills, billing stub).
- **Auth & workspaces** — email/password sign-up, per-workspace providers/models/apps/chats/integrations.

## Run it

```bash
cd webapp
npm install
cp .env.example .env         # add your E2B_API_KEY (users can also add keys in the UI)
npm run build                # build the React client
npm start                    # serve API + client on :3000
```

Open `http://localhost:3000`, create a workspace, then Settings → Sandbox to add your E2B key and
Settings → Providers to point at your gateway (the default entry is pre-filled). Create an app and
describe what you want — the agent builds it in the sandbox and you watch the preview update live.

### Runtime modes

| Mode | Where apps run | Requires |
|------|----------------|----------|
| `e2b` (default when `E2B_API_KEY` is set) | E2B cloud microVMs, public preview URLs | E2B API key |
| `local` | host processes under `data/apps/<id>/workspace` | nothing (dev fallback) |

## Architecture

```
webapp/
  server/
    index.ts            Express API: auth, settings, providers, models, apps,
                        chats (SSE agent streaming), MCP, skills, preview proxy
    db.ts               JSON-file store (atomic, debounced writes)
    agent/
      prompts.ts        Ported Dyad prompt blocks + skills/MCP blocks
      providers.ts      OpenAI + Anthropic streaming adapters (tool calling)
      tools.ts          Ported tool schemas/executors + MCP consent classifier
      search_replace.ts Port of Dyad's cascading fuzzy line matcher
      loop.ts           Agentic loop: stream → tool calls → consent → commit
    runtime/
      e2b.ts            E2B SDK runtime
      local.ts          Local process runtime (dev)
      manager.ts        Provisioning, skills/MCP install, dev server, mirror
    mcp/
      catalog.ts        One-click MCP catalog
      bridge-source.ts  The in-sandbox MCP bridge (assets/mcp-bridge.mjs)
    skills/catalog.ts   Built-in skills
  src/                  React client (Vite, Tailwind, zinc dark theme)
  assets/
    scaffold.tgz        The app scaffold uploaded to every sandbox
    mcp-bridge.mjs      MCP↔HTTP bridge that runs inside sandboxes
```

The legacy Electron app in the repository root is untouched and remains the upstream reference; this
package is fully self-contained.
