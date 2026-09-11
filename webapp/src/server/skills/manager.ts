import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { appSkills, skills, type Skill } from "../db/schema";

/**
 * Skills — reusable instruction modules (Anthropic "Agent Skills" style).
 *
 * A skill is a folder with a SKILL.md: name, description and instructions
 * (plus optional extra files). Dyad Cloud:
 *  1. injects enabled skills into the agent system prompt (summary + full
 *     instructions), and
 *  2. materializes them inside every app sandbox at
 *     /home/user/skills/<slug>/SKILL.md so the code the agent writes (or any
 *     process running in the sandbox) can read them at runtime.
 */

export interface SkillFile {
  path: string;
  content: string;
}

/** Skills enabled for an app = globally enabled ∪ attached to the app. */
export function getEnabledSkillsForApp(appId: number): Skill[] {
  const all = db.select().from(skills).all() as Skill[];
  const attached = new Set(
    (
      db
        .select()
        .from(appSkills)
        .where(eq(appSkills.appId, appId))
        .all() as { skillId: number }[]
    ).map((r) => r.skillId),
  );
  return all.filter((s) => s.enabled && (s.source === "gallery" || attached.has(s.id)));
}

export function getAllSkills(): Skill[] {
  return db.select().from(skills).all() as Skill[];
}

export function skillExtraFiles(skill: Skill): SkillFile[] {
  if (!skill.files) return [];
  try {
    return JSON.parse(skill.files) as SkillFile[];
  } catch {
    return [];
  }
}

/** Files to write into the sandbox for a skill (SKILL.md + extras). */
export function skillSandboxFiles(skill: Skill): { path: string; content: string }[] {
  const files = [
    {
      path: `skills/${skill.slug}/SKILL.md`,
      content: `---
name: ${skill.name}
description: ${skill.description}
---

${skill.instructions}
`,
    },
  ];
  for (const f of skillExtraFiles(skill)) {
    const rel = f.path.replace(/^\/+/, "").replace(/\.\./g, "");
    files.push({ path: `skills/${skill.slug}/${rel}`, content: f.content });
  }
  return files;
}

export function skillsForApp(appId: number): Skill[] {
  const rows = db
    .select()
    .from(appSkills)
    .where(eq(appSkills.appId, appId))
    .all() as { skillId: number }[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.skillId);
  return db.select().from(skills).where(inArray(skills.id, ids)).all() as Skill[];
}

export function attachSkill(appId: number, skillId: number, attached: boolean) {
  if (attached) {
    db.insert(appSkills).values({ appId, skillId }).onConflictDoNothing().run();
  } else {
    db.delete(appSkills)
      .where(and(eq(appSkills.appId, appId), eq(appSkills.skillId, skillId)))
      .run();
  }
}
