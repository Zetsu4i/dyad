// Skills: installable instruction packs (SKILL.md style) that extend the agent.
// Built-in catalog + user custom skills. Enabled skills are:
//  1. injected into the agent system prompt, and
//  2. synced into each app sandbox under .skills/<id>/SKILL.md (+ extra files)
// so they are available both to the orchestrator and inside the sandbox.
import { getSkillState, saveSkillState, uid } from "./store.mjs";

export const BUILTIN_SKILLS = [
  {
    id: "skill-stripe-payments",
    name: "Stripe Payments",
    description: "Accept payments with Stripe Checkout + webhooks.",
    category: "Payments",
    content: `# Stripe Payments Skill
When the user asks for payments, subscriptions, or checkout:
- Install: stripe, @stripe/stripe-js (+ @stripe/react-stripe-js for embedded flows).
- NEVER hardcode secret keys. Read STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY from environment variables and tell the user to set them.
- Prefer Stripe Checkout (hosted) for the fastest reliable flow: create a checkout session on the server, redirect with stripe-js.
- For subscriptions use Prices (not inline amounts) and Billing Portal for management.
- Add a /api/stripe-webhook handler verifying the raw-body signature with STRIPE_WEBHOOK_SECRET; handle checkout.session.completed, customer.subscription.* events idempotently.
- Show clear success/cancel pages and loading/empty/error states in the UI.`,
    files: [],
  },
  {
    id: "skill-supabase-auth",
    name: "Supabase Auth + Data",
    description: "Auth, Postgres rows, and storage via Supabase.",
    category: "Backend",
    content: `# Supabase Auth + Data Skill
When the user asks for login, signup, database, or file storage with Supabase:
- Install @supabase/supabase-js. Create a single client in src/lib/supabase.ts using VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
- NEVER put the service-role key in frontend code. Service-role usage is server-only.
- Auth: email/password + magic link via supabase.auth; protect routes with a session check and an AuthContext.
- Data: use Row Level Security (RLS) on every table; write policies for select/insert/update/delete scoped to auth.uid().
- Storage: use signed URLs for private buckets; validate file type/size client-side before upload.
- Tell the user exactly which SQL to run (tables + RLS policies) and which env vars to set.`,
    files: [],
  },
  {
    id: "skill-rest-api",
    name: "REST API Builder",
    description: "Design clean REST endpoints and typed API clients.",
    category: "Backend",
    content: `# REST API Builder Skill
When building API endpoints or API clients:
- REST conventions: plural nouns (/api/todos), correct verbs, 201 on create with Location, 204 on delete, consistent JSON error shape { error: { code, message } }.
- Validate all input at the boundary (zod recommended) and return 400 with field errors.
- Version under /api/v1 when the app is public-facing. Paginate lists (cursor or limit/offset) and always cap page size.
- Generate a typed client (fetch wrapper with types) in src/lib/api.ts colocated with hooks; handle 401 by redirecting to login.
- Document each endpoint: method, path, auth, request/response examples in API.md.`,
    files: [],
  },
  {
    id: "skill-design-system",
    name: "Enterprise UI / Tailwind",
    description: "Professional neutral dark UI with Tailwind.",
    category: "Design",
    content: `# Enterprise UI Skill
Default design language for all generated apps unless the user asks otherwise:
- Dark neutral palette: zinc-950 page bg, zinc-900 panels, zinc-800/60 borders, zinc-100 primary text, zinc-400 secondary text. No gradients, no neon, no glassmorphism.
- Primary action: white button (bg-white text-zinc-950) or zinc-100; destructive: red-600. Radius: rounded-lg (8px). Borders: 1px zinc-800.
- Typography: system sans stack, tight tracking on headings (tracking-tight), text-sm default body, tabular-nums for numbers.
- Layout: max-w-6xl/7xl containers, 24px gutters, cards with p-5/p-6, generous whitespace, left-aligned.
- States: every data view needs loading (skeleton), empty, and error states. Focus-visible rings on all interactive elements.
- Use lucide-react icons (size 16-18) with text, never emoji as iconography.`,
    files: [],
  },
  {
    id: "skill-forms",
    name: "Forms & Validation",
    description: "Accessible forms with react-hook-form + zod.",
    category: "Frontend",
    content: `# Forms & Validation Skill
When building forms:
- Install react-hook-form, zod, @hookform/resolvers. Define a zod schema first, then use zodResolver.
- One reusable Field component: label, input, description, error message with aria-describedby/aria-invalid.
- Validate on submit + touched blur; disable submit while submitting; show inline server errors at top with role="alert".
- Uncontrolled inputs via register; controlled only when needed (Controller). Reset with server values after load.
- Confirm destructive actions with a dialog requiring explicit confirm; never destructive on single click.`,
    files: [],
  },
  {
    id: "skill-neon-postgres",
    name: "Neon Postgres",
    description: "Serverless Postgres with Neon + Drizzle.",
    category: "Backend",
    content: `# Neon Postgres Skill
When the user wants a Postgres database via Neon:
- Install @neondatabase/serverless and drizzle-orm. DATABASE_URL is server-only — NEVER expose it to the browser.
- Define schema with drizzle in db/schema.ts, query with drizzle(sql from @neondatabase/serverless).
- Keep migrations as SQL files under db/migrations and apply in order; never hand-edit auth tables.
- Pool via Neon's serverless driver (fetch-based) for edge/serverless runtimes.
- Tell the user to set DATABASE_URL and show how to create the project + get the pooled connection string.`,
    files: [],
  },
  {
    id: "skill-github",
    name: "GitHub Integration",
    description: "Repos, PRs, issues, and CI via GitHub.",
    category: "Integrations",
    content: `# GitHub Integration Skill
When the user asks for GitHub features (repos, issues, PRs, actions):
- Prefer the GitHub MCP server (see Integrations → MCP) for live data instead of hand-rolled fetch calls.
- For in-app GitHub OAuth: use the device flow for CLIs or web flow with a server-side token exchange; never expose client secrets in the browser.
- Repo operations (clone/commit/push) run inside the sandbox with run_command; configure user.name/user.email per-repo and use GITHUB_TOKEN from env for auth.
- CI: add .github/workflows/ci.yml running install, typecheck, build, and tests on PRs.`,
    files: [],
  },
  {
    id: "skill-e2e-tests",
    name: "Playwright E2E Tests",
    description: "Happy-path browser tests with Playwright.",
    category: "Quality",
    content: `# Playwright E2E Tests Skill
When the user asks for tests:
- Install @playwright/test as a dev dependency. Put specs under e2e-tests/*.spec.ts.
- Prefer role/text locators (getByRole/getByText/getByLabel) over CSS selectors; add data-testid for hard-to-target elements.
- One focused happy-path spec per flow; navigate with relative paths (baseURL points at the running dev server).
- Seed data through the app (UI or its own API), never by writing to the real database directly from tests.
- On failure: read the error-context/screenshot output first, decide whether the TEST or the APP is wrong, then fix the real cause.`,
    files: [],
  },
  {
    id: "skill-vercel-deploy",
    name: "Deploy to Vercel",
    description: "Ship the Vite app to Vercel with env vars.",
    category: "Deploy",
    content: `# Deploy to Vercel Skill
When the user asks to deploy/share/publish:
- Ensure npm run build passes with zero TypeScript errors first.
- Add vercel.json only if rewrites are needed (SPA fallback: { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }).
- List every env var the app needs (VITE_* for frontend) and instruct the user to add them in Vercel Project Settings → Environment Variables.
- Recommend Preview deployments per PR and Production on main; make sure API bases use https absolute URLs in production.`,
    files: [],
  },
];

export function listAllSkills() {
  const state = getSkillState();
  const builtin = BUILTIN_SKILLS.map((s) => ({
    ...s,
    source: "builtin",
    installed: state.enabled[s.id] !== false, // builtins on by default? no—explicit:
  }));
  // Default: builtins installed=false until user installs, except design-system
  const withDefaults = builtin.map((s) => ({
    ...s,
    installed:
      state.enabled[s.id] ?? (s.id === "skill-design-system" ? true : false),
  }));
  const custom = (state.custom || []).map((s) => ({
    ...s,
    source: "custom",
    installed: state.enabled[s.id] ?? true,
  }));
  return [...withDefaults, ...custom];
}

export function getEnabledSkills() {
  return listAllSkills().filter((s) => s.installed);
}

export function setSkillEnabled(id, installed) {
  const state = getSkillState();
  state.enabled[id] = installed;
  saveSkillState(state);
  return listAllSkills();
}

export function createCustomSkill({ name, description, content, files }) {
  const state = getSkillState();
  const skill = {
    id: uid("skill"),
    name: name?.trim() || "Untitled Skill",
    description: description?.trim() || "",
    category: "Custom",
    content: content || "",
    files: Array.isArray(files) ? files : [],
    createdAt: new Date().toISOString(),
  };
  state.custom = [...(state.custom || []), skill];
  state.enabled[skill.id] = true;
  saveSkillState(state);
  return skill;
}

export function updateCustomSkill(id, patch) {
  const state = getSkillState();
  state.custom = (state.custom || []).map((s) =>
    s.id === id ? { ...s, ...patch, id } : s,
  );
  saveSkillState(state);
  return state.custom.find((s) => s.id === id) || null;
}

export function deleteCustomSkill(id) {
  const state = getSkillState();
  state.custom = (state.custom || []).filter((s) => s.id !== id);
  delete state.enabled[id];
  saveSkillState(state);
}

// Files to sync into a sandbox for the enabled skills.
export function skillSandboxFiles(enabledSkills) {
  const files = {};
  for (const s of enabledSkills) {
    const dir = `.skills/${s.id}`;
    files[`${dir}/SKILL.md`] =
      `# ${s.name}\n\n${s.description ? `> ${s.description}\n\n` : ""}${s.content || ""}\n`;
    for (const f of s.files || []) {
      if (f && f.path && typeof f.content === "string") {
        const safe = String(f.path).replace(/^\//, "");
        files[`${dir}/files/${safe}`] = f.content;
      }
    }
  }
  return files;
}
