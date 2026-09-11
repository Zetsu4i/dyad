/**
 * Curated skill gallery — installed (idempotently) on first boot and available
 * under Settings → Skills. Each skill ships a complete SKILL.md so users get
 * real, working guidance out of the box.
 */

export interface GallerySkill {
  slug: string;
  name: string;
  description: string;
  instructions: string;
}

export const SKILL_GALLERY: GallerySkill[] = [
  {
    slug: "landing-pages",
    name: "Landing Page Design",
    description:
      "Conversion-focused landing page patterns: hero, social proof, feature grids, pricing and CTAs.",
    instructions: `# Landing Page Design

When the user asks for a landing page, marketing site, or hero section, follow these principles:

1. **Above the fold**: A single, clear value proposition. One headline, one subheadline, one primary CTA. Never compete with yourself.
2. **Visual hierarchy**: Headline ≥ 48px on desktop (text-5xl+), generous whitespace, max-w constrained prose.
3. **Social proof early**: Logos or testimonial strip right after the hero.
4. **Feature grids**: 3-column responsive grids (grid-cols-1 md:grid-cols-3) with icon + title + 1-line description. Use lucide-react icons.
5. **Pricing**: Highlight one recommended plan visually (ring/border + badge); keep others subdued.
6. **CTAs**: Full-width on mobile, inline on desktop. Primary action uses the accent color; secondary uses outline style.
7. **Responsive**: Verify every section at 375px, 768px and 1280px widths. No horizontal scroll.
8. **Dark mode**: Prefer zinc-950 background, zinc-900 cards, zinc-800 borders, and a single accent color (indigo-500 by default).

Deliver complete, production-ready code — no placeholder images (use gradient blocks or https://placehold.co), no TODOs.`,
  },
  {
    slug: "shadcn-ui-patterns",
    name: "shadcn/ui Component Patterns",
    description:
      "Best practices for composing shadcn/ui + Radix components: forms, dialogs, toasts, tables.",
    instructions: `# shadcn/ui Component Patterns

This project has ALL shadcn/ui components preinstalled. Never edit files in src/components/ui — create your own wrappers instead.

## Forms
- Use react-hook-form + zod + @hookform/resolvers for any form with 2+ fields or validation.
- Compose Form, FormField, FormItem, FormLabel, FormControl, FormMessage from shadcn/ui.

## Feedback
- Use the useToast hook + Toaster for action feedback (success/error).
- Use AlertDialog for destructive confirmations; Dialog for creation forms.

## Data
- Use Table for tabular data; add a Toolbar with Input (search) + Select (filter) + Button (primary action).
- Empty states: center an icon + title + description + CTA inside a dashed border container.

## Accessibility
- Every interactive element needs a visible label or aria-label.
- Dialogs must have a DialogTitle; icon-only buttons need aria-label or sr-only text.`,
  },
  {
    slug: "api-integration",
    name: "API Integration Guide",
    description:
      "How to wire external REST APIs into the app: fetching, loading/error states, env-var secrets.",
    instructions: `# API Integration

When the user asks to connect an external API:

1. **Secrets**: NEVER hardcode API keys. Read them from \`import.meta.env.VITE_*\` and tell the user to add the variables as sandbox environment variables (Settings → Sandbox → Environment). Surface a friendly error when a variable is missing.
2. **Data fetching layer**: Create a dedicated module (e.g. src/lib/api.ts) that exports typed async functions. Never call fetch directly inside components.
3. **States**: Every request UI must handle loading (skeleton/spinner), error (Alert with retry), and empty states.
4. **CORS**: If a public API blocks browser requests, say so and suggest a proxy route; in a Vite app add \`server.proxy\` config guidance in the chat, or use the API's CORS-enabled endpoint.
5. **Timeouts & aborts**: Use AbortController with a 15s timeout. Cancel in-flight requests on unmount.
6. **Types**: Define response types explicitly; parse with zod when the API is untrusted.`,
  },
  {
    slug: "forms-and-validation",
    name: "Forms & Validation",
    description:
      "Production-grade form UX: zod schemas, inline errors, disabled states, optimistic updates.",
    instructions: `# Forms & Validation

1. Define a zod schema next to the form component; derive types with z.infer.
2. Use react-hook-form with zodResolver. Set \`mode: "onBlur"\` so errors appear as the user leaves a field, not on every keystroke.
3. Disable submit while pending; show a Loader2 icon (animate-spin) inside the button.
4. Field-level errors under inputs via FormMessage; form-level errors as a destructive Alert above the form.
5. On success: toast + form reset + (for dialogs) close the dialog.
6. Never invent validation rules — mirror what the user asked for. Required > format > length > business rules, in that order.`,
  },
  {
    slug: "seo-and-performance",
    name: "SEO & Performance",
    description:
      "Meta tags, semantic HTML, image discipline and bundle hygiene for generated apps.",
    instructions: `# SEO & Performance

1. **Semantic HTML**: one h1 per page; header/nav/main/footer/section landmarks; alt text on every img.
2. **Meta**: set <title> and description in index.html; prefer descriptive document titles per route via a tiny usePageTitle hook.
3. **Images**: lazy-load below-the-fold images (loading="lazy"), explicit width/height to avoid layout shift, use WebP/AVIF when the user provides assets.
4. **Fonts**: use system font stacks or self-hosted fonts; never block rendering on third-party fonts.
5. **Code splitting**: lazy-load heavy, route-level views with React.lazy + Suspense fallback.
6. **Lists**: paginate or virtualize lists beyond ~200 items.`,
  },
  {
    slug: "dark-mode-theming",
    name: "Dark Mode Theming",
    description:
      "Consistent dark themes with CSS variables and Tailwind: zinc palette, elevation, contrast.",
    instructions: `# Dark Mode Theming

1. **Palette discipline**: background zinc-950, surfaces zinc-900, raised zinc-800/60, borders zinc-800, text zinc-100 with zinc-400 for secondary. One accent color for primary actions.
2. **Elevation**: darker pages, slightly lighter cards, borders instead of shadows. Shadows are nearly invisible in dark themes.
3. **Contrast**: body text ≥ 4.5:1 (zinc-300 on zinc-900 minimum); never pure black or pure white.
4. **Semantic colors**: emerald-500 success, red-500 destructive, amber-500 warning — always with darker text or tinted backgrounds (e.g. emerald-500/10).
5. Implement theme tokens as CSS variables in globals.css mapped to Tailwind classes so light/dark can be toggled later without rewriting components.`,
  },
];
