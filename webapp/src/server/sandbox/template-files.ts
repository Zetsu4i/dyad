import fs from "node:fs";
import path from "node:path";

/**
 * Accessor for the app template — a verbatim copy of Dyad's `scaffold/`
 * (Vite + React + TypeScript + Tailwind + shadcn/ui). New apps are seeded
 * with these files so every Dyad Cloud app starts from the same proven base
 * the upstream product uses.
 */

// Resolved from the project root (Next bundles this module — __dirname is not
// stable inside the server bundle).
const TEMPLATE_DIR = path.join(
  process.cwd(),
  "src",
  "server",
  "sandbox",
  "template",
);

export function templateFiles(): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const walk = (dir: string, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        out.push({
          path: rel,
          content: fs.readFileSync(path.join(dir, entry.name), "utf8"),
        });
      }
    }
  };
  walk(TEMPLATE_DIR);
  return out;
}

export function templateFile(relPath: string): string | null {
  const p = path.join(TEMPLATE_DIR, relPath);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

/** Derive an app name (and slug) from the first user prompt, Dyad-style. */
export function appNameFromPrompt(prompt: string): {
  name: string;
  slug: string;
} {
  const cleaned = prompt
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  const name =
    words.length > 0
      ? words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
          .slice(0, 40)
      : "New App";
  const baseSlug =
    words
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || "app";
  const slug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
  return { name, slug };
}
