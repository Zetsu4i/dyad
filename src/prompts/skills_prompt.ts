/**
 * Prompt section describing the skills installed for this deployment.
 *
 * Skills are REAL directories synced into the app's sandbox at
 * /home/user/dyad-skills/<slug>/ — the agent reads SKILL.md for instructions
 * and can execute bundled scripts with its sandbox shell.
 */
import { listSkills } from "@/ipc/utils/skills_store";
import { SKILLS_SANDBOX_ROOT } from "@/ipc/utils/e2b_sandbox_provider";

export function buildSkillsPromptSection(): string {
  let skills;
  try {
    skills = listSkills().filter((s) => s.enabled);
  } catch {
    return "";
  }
  if (skills.length === 0) return "";

  const lines = skills.map(
    (s) =>
      `- **${s.name}** (\`${SKILLS_SANDBOX_ROOT}/${s.slug}/\`): ${
        s.description || "No description"
      }`,
  );

  return `

# Skills

The following skills are installed in this sandbox under \`${SKILLS_SANDBOX_ROOT}/\`. Each skill directory contains a \`SKILL.md\` with step-by-step instructions and may include helper scripts and resources.

${lines.join("\n")}

When a user's request matches a skill, read its \`SKILL.md\` FIRST (e.g. \`cat ${SKILLS_SANDBOX_ROOT}/<slug>/SKILL.md\`) and follow its instructions. You can run any bundled scripts from inside the sandbox.`;
}
