/**
 * Real filesystem-backed skills for the Dyad web runtime.
 *
 * A skill is a directory of files (SKILL.md + scripts + any bundled assets)
 * stored under <userData>/skills/<slug>/. Installed skills are:
 *
 *  1. synced into every app's E2B sandbox at /home/user/dyad-skills/<slug>/
 *     so the agent can read the instructions and run the scripts INSIDE the
 *     sandbox, and
 *  2. listed in the agent's system prompt so it knows they exist.
 *
 * Skills can be created in the UI (name + SKILL.md content + extra files) or
 * installed from GitHub (a whole repo, or a /tree/<ref>/<subdir> URL). Any
 * directory containing a SKILL.md in the cloned repo becomes a skill.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getUserDataPath } from "@/paths/paths";

const execFileAsync = promisify(execFile);

const logger = { warn: (...args: unknown[]) => console.warn("[skills]", ...args) };

const MAX_FILE_BYTES = 512 * 1024; // per-file cap when reading for sync
const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // per-install cap
const MAX_SKILL_FILES = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillMeta {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  source: "local" | "github";
  sourceUrl?: string;
  installedAt: string;
  fileCount: number;
}

export interface SkillFile {
  relPath: string;
  content: string;
}

export interface SkillLibraryEntry {
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  subdirectory?: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function skillsRootDir(): string {
  return path.join(getUserDataPath(), "skills");
}

function skillDir(slug: string): string {
  return path.join(skillsRootDir(), slug);
}

function registryPath(): string {
  return path.join(skillsRootDir(), "registry.json");
}

interface RegistryEntry {
  name: string;
  description: string;
  enabled: boolean;
  source: "local" | "github";
  sourceUrl?: string;
  installedAt: string;
}

function readRegistry(): Record<string, RegistryEntry> {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(registry: Record<string, RegistryEntry>): void {
  fs.mkdirSync(skillsRootDir(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "skill"
  );
}

/**
 * Parses `name` / `description` from the SKILL.md YAML frontmatter.
 */
export function parseSkillMd(
  content: string,
): { name?: string; description?: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const frontmatter = m[1];
  const pick = (key: string) => {
    const km = frontmatter.match(
      new RegExp(`^${key}:\\s*(.+)$`, "m"),
    );
    if (!km) return undefined;
    return km[1].trim().replace(/^["']|["']$/g, "");
  };
  return { name: pick("name"), description: pick("description") };
}

function walkFiles(
  dir: string,
  baseDir: string = dir,
  out: { absPath: string; relPath: string }[] = [],
): { absPath: string; relPath: string }[] {
  if (out.length >= MAX_SKILL_FILES) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_SKILL_FILES) break;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(baseDir, abs).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      walkFiles(abs, baseDir, out);
    } else if (entry.isFile()) {
      out.push({ absPath: abs, relPath: rel });
    }
  }
  return out;
}

function readTextFile(absPath: string): string | null {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_BYTES) return null;
    const buf = fs.readFileSync(absPath);
    // Skip likely-binary files.
    let zeroBytes = 0;
    for (let i = 0; i < Math.min(buf.length, 8000); i++) {
      if (buf[i] === 0) zeroBytes++;
    }
    if (zeroBytes > 0) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listSkills(): SkillMeta[] {
  const registry = readRegistry();
  const metas: SkillMeta[] = [];
  for (const [slug, entry] of Object.entries(registry)) {
    const dir = skillDir(slug);
    const fileCount = fs.existsSync(dir) ? walkFiles(dir).length : 0;
    metas.push({
      slug,
      name: entry.name,
      description: entry.description,
      enabled: entry.enabled,
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      installedAt: entry.installedAt,
      fileCount,
    });
  }
  metas.sort((a, b) => a.name.localeCompare(b.name));
  return metas;
}

export function getSkillFiles(slug: string): SkillFile[] {
  const dir = skillDir(slug);
  if (!fs.existsSync(dir)) return [];
  const files: SkillFile[] = [];
  let total = 0;
  for (const f of walkFiles(dir)) {
    const content = readTextFile(f.absPath);
    if (content === null) continue;
    total += content.length;
    if (total > MAX_TOTAL_BYTES) break;
    files.push({ relPath: f.relPath, content });
  }
  files.sort((a, b) => {
    if (a.relPath === "SKILL.md") return -1;
    if (b.relPath === "SKILL.md") return 1;
    return a.relPath.localeCompare(b.relPath);
  });
  return files;
}

export function getSkillFileContent(
  slug: string,
  relPath: string,
): string | null {
  const dir = skillDir(slug);
  const abs = path.resolve(dir, relPath);
  if (!abs.startsWith(path.resolve(dir) + path.sep) && abs !== path.resolve(dir)) {
    throw new Error("Invalid path");
  }
  return readTextFile(abs);
}

export function saveSkillFile(slug: string, relPath: string, content: string): void {
  const dir = skillDir(slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`Skill "${slug}" does not exist`);
  }
  const abs = path.resolve(dir, relPath);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error("Invalid path");
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

export function deleteSkillFile(slug: string, relPath: string): void {
  const dir = skillDir(slug);
  const abs = path.resolve(dir, relPath);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error("Invalid path");
  }
  fs.rmSync(abs, { recursive: true, force: true });
}

export function createSkill(input: {
  name: string;
  description?: string;
  skillMd?: string;
}): SkillMeta {
  const slug = slugify(input.name);
  const dir = skillDir(slug);
  if (fs.existsSync(dir)) {
    throw new Error(`A skill named "${slug}" already exists`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const skillMd =
    input.skillMd ??
    `---\nname: ${input.name}\ndescription: ${input.description ?? ""}\n---\n\n# ${input.name}\n\nWrite step-by-step instructions for the AI agent here.\n`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd, "utf8");

  const registry = readRegistry();
  registry[slug] = {
    name: input.name,
    description: input.description ?? "",
    enabled: true,
    source: "local",
    installedAt: new Date().toISOString(),
  };
  writeRegistry(registry);
  return {
    slug,
    name: input.name,
    description: input.description ?? "",
    enabled: true,
    source: "local",
    installedAt: registry[slug].installedAt,
    fileCount: 1,
  };
}

export function removeSkill(slug: string): void {
  fs.rmSync(skillDir(slug), { recursive: true, force: true });
  const registry = readRegistry();
  delete registry[slug];
  writeRegistry(registry);
}

export function setSkillEnabled(slug: string, enabled: boolean): void {
  const registry = readRegistry();
  if (!registry[slug]) throw new Error(`Skill "${slug}" does not exist`);
  registry[slug].enabled = enabled;
  writeRegistry(registry);
}

// ---------------------------------------------------------------------------
// GitHub installation
// ---------------------------------------------------------------------------

interface ParsedGithubUrl {
  repoUrl: string;
  ref?: string;
  subdirectory?: string;
}

export function parseGithubSkillUrl(rawUrl: string): ParsedGithubUrl {
  const url = new URL(rawUrl);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("Only github.com URLs are supported");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("URL must look like https://github.com/{owner}/{repo}");
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  let ref: string | undefined;
  let subdirectory: string | undefined;
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
    ref = decodeURIComponent(parts[3]);
    if (parts.length >= 5) {
      subdirectory = parts.slice(4).map(decodeURIComponent).join("/");
    }
  }
  return { repoUrl: `https://github.com/${owner}/${repo}.git`, ref, subdirectory };
}

async function gitCloneShallow(
  repoUrl: string,
  dest: string,
  ref?: string,
): Promise<void> {
  const args = ["clone", "--depth", "1"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push("--single-branch", "--", repoUrl, dest);
  try {
    await execFileAsync("git", args, { timeout: 180_000 });
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    throw new Error(`git clone failed: ${message.slice(0, 400)}`);
  }
}

function findSkillDirs(
  repoDir: string,
  subdirectory?: string,
): { dir: string; name: string }[] {
  const results: { dir: string; name: string }[] = [];
  const consider = (dir: string) => {
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      results.push({ dir, name: path.basename(dir) });
    }
  };
  if (subdirectory) {
    const sub = path.join(repoDir, subdirectory);
    if (!fs.existsSync(sub)) {
      throw new Error(`Subdirectory "${subdirectory}" not found in the repository`);
    }
    consider(sub);
    if (results.length === 0) {
      // Maybe the subdir contains multiple skills one level down.
      for (const entry of fs.readdirSync(sub, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          consider(path.join(sub, entry.name));
        }
      }
    }
    if (results.length === 0) {
      throw new Error(
        `No SKILL.md found in "${subdirectory}" (looked in the directory and one level down)`,
      );
    }
    return results;
  }

  consider(repoDir);
  if (results.length > 0) return results;
  // One level down (repo-of-skills layout, e.g. anthropics/skills).
  for (const entry of fs.readdirSync(repoDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== ".git") {
      consider(path.join(repoDir, entry.name));
    }
  }
  if (results.length === 0) {
    throw new Error("No SKILL.md found in the repository");
  }
  return results;
}

/**
 * Installs skills from a GitHub URL. Every directory containing a SKILL.md
 * becomes an installed skill (repos like anthropics/skills install many).
 * Returns the slugs that were installed.
 */
export async function installSkillsFromGithub(input: {
  url: string;
}): Promise<{ installed: string[]; skipped: string[] }> {
  const { repoUrl, ref, subdirectory } = parseGithubSkillUrl(input.url);
  const tmpRoot = path.join(skillsRootDir(), ".tmp-install");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  const cloneDir = path.join(tmpRoot, "repo");

  try {
    await gitCloneShallow(repoUrl, cloneDir, ref);
    const skillDirs = findSkillDirs(cloneDir, subdirectory);
    const registry = readRegistry();
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const { dir, name } of skillDirs) {
      const slug = slugify(name);
      const dest = skillDir(slug);
      if (fs.existsSync(dest)) {
        skipped.push(slug);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(dir, dest, {
        recursive: true,
        filter: (src) => !src.includes(`${path.sep}.git`),
      });

      let skillName = name;
      let description = "";
      const skillMdPath = path.join(dest, "SKILL.md");
      if (fs.existsSync(skillMdPath)) {
        const parsed = parseSkillMd(
          fs.readFileSync(skillMdPath, "utf8"),
        );
        if (parsed.name) skillName = parsed.name;
        if (parsed.description) description = parsed.description;
      }

      registry[slug] = {
        name: skillName,
        description,
        enabled: true,
        source: "github",
        sourceUrl: input.url,
        installedAt: new Date().toISOString(),
      };
      installed.push(slug);
    }

    writeRegistry(registry);
    return { installed, skipped };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Sandbox sync + prompt helpers
// ---------------------------------------------------------------------------

/**
 * All enabled skills with their file contents — used by the E2B provider to
 * materialize skills inside sandboxes.
 */
export async function getEnabledSkillsForSync(): Promise<
  { slug: string; files: SkillFile[] }[]
> {
  const out: { slug: string; files: SkillFile[] }[] = [];
  for (const meta of listSkills()) {
    if (!meta.enabled) continue;
    const files = getSkillFiles(meta.slug);
    if (files.length > 0) {
      out.push({ slug: meta.slug, files });
    }
  }
  return out;
}

/** Re-sync skills into all live sandboxes (after install/toggle). */
export async function resyncLiveSandboxes(): Promise<void> {
  try {
    const { e2bSandboxProvider, isE2bRuntimeMode } = await import(
      "./e2b_sandbox_provider"
    );
    if (!isE2bRuntimeMode()) return;
    for (const appId of e2bSandboxProvider.getLiveAppIds()) {
      await e2bSandboxProvider.syncSkillsIntoSandbox(appId);
    }
  } catch (error) {
    logger.warn("resyncLiveSandboxes failed:", error);
  }
}
