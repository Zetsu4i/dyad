#!/bin/bash
# Sync the Forge app onto a new branch of the user's Dyad fork (Zetsu4i/dyad)
# Branch: web-saas (from main). The branch replaces the Electron app with the
# web SaaS rebuild while preserving upstream history + Apache-2.0 LICENSE.
set -euo pipefail

SRC=/home/z/my-project
DST=$SRC/dyad-web
BRANCH=web-saas

cd "$DST"

# idempotency: hard-reset any previous partial run on this clone
git checkout -q main 2>/dev/null || true
git reset --hard -q main
git clean -q -fdx -e .git/ || true

echo "== 1) branch from main =="
git fetch origin main --depth 1 2>/dev/null || true
git checkout -q main
git checkout -q -B "$BRANCH" main
git log --oneline -1

echo "== 2) remove tracked upstream files =="
git rm -rf -q .
ls -A | grep -v '^\.git$' || echo "(working tree clean)"

echo "== 3) copy Forge app in =="
rsync -a \
  --exclude '.git' --exclude '.env' --exclude 'db' --exclude 'node_modules' \
  --exclude '.next' --exclude 'dev.log' --exclude '*.log' --exclude 'dyad-web' \
  --exclude 'skills' --exclude 'upload' --exclude 'download' --exclude 'mini-services' \
  --exclude 'examples' --exclude 'tests' --exclude 'Caddyfile' --exclude '485' \
  --exclude 'next-env.d.ts' \
  --exclude 'scripts/e2b-files-diag.mjs' --exclude 'scripts/files-verify.mjs' \
  --exclude '.claude' --exclude '.z-ai-config' --exclude 'agent-ctx' --exclude 'tool-results' \
  "$SRC/" "$DST/"

echo "== 4) clean .gitignore =="
cat > .gitignore << 'EOF'
# dependencies
node_modules/

# next.js
.next/
out/
build/
next-env.d.ts

# testing
coverage/

# env files — never commit keys
.env
.env*.local

# local database
db/
*.db
*.db-journal

# logs
*.log
dev.log

# misc
.DS_Store
.vercel
*.tsbuildinfo
EOF

echo "== 5) verify no secrets staged (added/modified only) =="
git add -A
if git diff --cached --name-only --diff-filter=AM | grep -E '^\.env$|^db/|\.db$'; then
  echo "ERROR: secret-looking file staged!"; exit 1
fi
echo "staged changes: $(git diff --cached --name-only | wc -l) (adds/mods: $(git diff --cached --name-only --diff-filter=AM | wc -l))"

echo "== 6) commit =="
git -c user.name="Zetsu4i" -c user.email="79372809+Zetsu4i@users.noreply.github.com" commit -q -m "Rebuild as a web-based SaaS: strip Electron, run agents in E2B cloud sandboxes

- Replaces the Electron desktop app with a Next.js 16 web app (App Router,
  React 19, Tailwind CSS 4, shadcn/ui, Prisma + SQLite)
- Agent system ported from Dyad's local-agent prompt structure and tool
  design (search/replace line matching + two-failure fallback, app-lifecycle
  guidance); all file/command execution moved into per-app E2B sandboxes
- Sandbox lifecycle saves cost: pause on leaving the builder, snapshot +
  resume on return, idle auto-pause
- BYOK settings dashboard: OpenAI- and Anthropic-compatible providers,
  live /v1/models pull + activation (default test model openai/gpt-4.1),
  E2B API key
- Skills bundles (SKILL.md) installed into the sandbox filesystem and
  advertised to the agent; MCP servers run inside the sandbox via
  supergateway and bridge as live agent tools
- Templates: React+Vite, Next.js, Node API, Expo (mobile), static HTML
- Builder: chat with thinking + tool-call streams, full file tree with
  Monaco editor, terminal, live preview, MyApps dashboard
- Enterprise zinc/stone dark theme; upstream Apache-2.0 LICENSE + NOTICE
  attribution preserved"

git log --oneline -2

echo "== 7) push =="
git push origin "$BRANCH" 2>&1 | grep -vE "ghp_|x-access"
echo "DONE: branch $BRANCH pushed"
