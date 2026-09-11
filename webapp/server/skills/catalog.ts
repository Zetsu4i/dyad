// ============================================================================
// Built-in skill catalog. Skills follow the SKILL.md convention: a folder with
// markdown instructions that are installed into the app sandbox and loadable
// by the agent on demand (mirrors Dyad's guide system + read_guide tool).
// ============================================================================

export interface CatalogSkill {
  catalogId: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

export const BUILTIN_SKILLS: CatalogSkill[] = [
  {
    catalogId: "shadcn-design-system",
    name: "shadcn/ui Design System",
    slug: "shadcn-design-system",
    description:
      "Conventions for building polished, consistent UIs with shadcn/ui, Radix primitives and Tailwind in this React app.",
    instructions: `# Skill: shadcn/ui Design System

## When to use
Load this skill whenever you create or restyle pages, dialogs, forms, or any UI component.

## Rules
- Always import prebuilt components from "@/components/ui/*" — never edit those files. Compose new components in src/components/ that use them.
- Prefer Radix-backed primitives (Dialog, DropdownMenu, Popover, Tabs, Toast) over hand-rolled interactive widgets.
- Use Tailwind utility classes exclusively for layout, spacing, colors, and typography. Use the theme tokens (bg-background, text-foreground, text-muted-foreground, border, etc.) instead of raw colors so themes keep working.
- Layout: use flex/grid with gap-* instead of magic margins. Content should be centered with a max-w-* container.
- Accessibility: every icon-only button needs an accessible name (aria-label or sr-only text). Every form control needs a Label.
- Empty states: show a centered icon + short title + one-line description + primary action.
- Loading states: use Skeleton components, never spinners for page-level loads.

## Patterns
\`\`\`tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        <Button size="sm">Create your first item</Button>
      </CardContent>
    </Card>
  );
}
\`\`\``,
  },
  {
    catalogId: "rest-api-integration",
    name: "REST API Integration",
    slug: "rest-api-integration",
    description:
      "Patterns for calling external REST APIs from the app: typed fetch clients, error handling, loading states, and secrets.",
    instructions: `# Skill: REST API Integration

## When to use
Load this skill when the app needs to call external HTTP APIs (weather, stock, AI services, internal services).

## Rules
- Create one typed client module per API in src/lib/<api>-client.ts. Do not scatter fetch calls across components.
- Read the base URL and key from import.meta.env.VITE_<API>_API_KEY at build time for public APIs. For secret keys, call your own backend endpoint instead of exposing keys in the client bundle.
- Always set a timeout with AbortSignal.timeout(10_000) and handle non-2xx by throwing an error with the response body text.
- Model responses with TypeScript types. Parse with runtime validation (zod) when the shape matters.
- UI: use TanStack Query style state (or minimal useState/useEffect with cleanup) — show loading, error, empty, and success states explicitly.

## Pattern
\`\`\`ts
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(\`API error \${res.status}: \${await res.text()}\`);
  return res.json() as Promise<T>;
}
\`\`\``,
  },
  {
    catalogId: "forms-and-validation",
    name: "Forms & Validation",
    slug: "forms-and-validation",
    description:
      "Building robust forms with react-hook-form + zod: schemas, inline errors, submission states, and toasts.",
    instructions: `# Skill: Forms & Validation

## When to use
Load this skill when creating any form (auth, settings, create/edit dialogs, search bars).

## Rules
- Define a zod schema first, derive types from it, and register it with react-hook-form via zodResolver.
- Use the shadcn Form components (Form, FormField, FormItem, FormLabel, FormControl, FormMessage) so errors render consistently.
- Submit button must show a pending state (disabled + spinner) while submitting and must be idempotent-safe (disable double submits).
- On success: close the dialog, show a sonner toast, and invalidate/refresh affected lists.
- On server errors: map them to field errors when possible, otherwise toast the message.

## Pattern
\`\`\`ts
const schema = z.object({ email: z.string().email(), name: z.string().min(2) });
type Values = z.infer<typeof schema>;
const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", name: "" } });
\`\`\``,
  },
  {
    catalogId: "data-visualization",
    name: "Data Visualization",
    slug: "data-visualization",
    description:
      "Charts and dashboards with recharts: responsive containers, theming with CSS variables, tooltips and empty states.",
    instructions: `# Skill: Data Visualization

## When to use
Load this skill when adding any chart, sparkline, or dashboard widget.

## Rules
- Wrap every chart in a fixed-height ResponsiveContainer (h-64 or taller). A chart with no height renders nothing — this is the #1 bug.
- Pull series colors from CSS variables (hsl(var(--primary)) etc.) so charts follow the theme; register them in the ChartConfig.
- Always provide a Tooltip and, for categorical axes, a CartesianGrid with strokeDasharray="3 3" at low opacity.
- Format axis ticks (compact numbers, dates) — never dump raw floats.
- Empty data: render an empty state message instead of an empty chart frame.`,
  },
  {
    catalogId: "app-testing",
    name: "App Testing",
    slug: "app-testing",
    description:
      "Manual QA checklist and Playwright patterns to verify app behavior after changes.",
    instructions: `# Skill: App Testing

## When to use
Load this skill before declaring a feature complete, or when the user reports a bug.

## Checklist
1. Happy path: does the core flow work end-to-end in the preview?
2. Edge cases: empty lists, long text, network failure, double-submit.
3. Keyboard: can you Tab through and operate the UI? Enter submits, Escape closes dialogs.
4. Responsive: 375px, 768px, 1280px widths.
5. Console: any errors or unhandled promise rejections in the preview devtools?

## Playwright (if e2e-tests/ exists)
- One spec per user flow, name them after behavior: auth.spec.ts, todo-crud.spec.ts.
- Prefer role-based selectors: getByRole("button", { name: "Save" }).
- Assert visible outcomes, never implementation details.`,
  },
  {
    catalogId: "polish-and-animations",
    name: "Polish & Micro-interactions",
    slug: "polish-and-animations",
    description:
      "Small touches that make apps feel premium: transitions, optimistic UI, skeletons, and focus states.",
    instructions: `# Skill: Polish & Micro-interactions

## When to use
Load this skill when the user asks to "make it look better", "polish", or when finishing a feature.

## Rules
- Transitions: add transition-colors / transition-all with duration-150–200ms on interactive elements. Animate layout changes with tailwindcss-animate utilities.
- Optimistic UI: update the list immediately on create/delete, roll back on error with a toast.
- Focus: visible focus rings (ring-2 ring-ring ring-offset-2) — never outline-none without a replacement.
- Numbers: use tabular-nums for columns of figures; animate counters when they change meaningfully.
- Shadows & depth: prefer border + subtle shadow-sm over heavy shadows. Dark mode: raise elevation with lighter surfaces, not shadows.
- Never animate more than opacity and transform; keep everything under 300ms.`,
  },
];
