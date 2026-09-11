import { constructSystemPrompt, readAiRules } from "@/dyad-core/prompts/system-prompt";
import type { ChatMode } from "@/dyad-core/prompts/system-prompt";
import type { Skill } from "../db/schema";
import type { McpToolInfo } from "../mcp/manager";

/**
 * Assembles the final system prompt for a chat turn.
 *
 * Base prompt = verbatim Dyad build/ask prompt (see dyad-core). Appended, in
 * order: codebase context, cloud skills, MCP tools. Keeping additions at the
 * end preserves the upstream prompt's structure and examples untouched.
 */

const CODEBASE_CONTEXT_BUDGET = 60_000; // characters

function fileTree(paths: string[]): string {
  const sorted = [...paths].sort();
  const lines: string[] = [];
  let lastDirs: string[] = [];
  for (const p of sorted) {
    const parts = p.split("/");
    const dirs = parts.slice(0, -1);
    let common = 0;
    while (
      common < dirs.length &&
      common < lastDirs.length &&
      dirs[common] === lastDirs[common]
    ) {
      common++;
    }
    for (let i = common; i < dirs.length; i++) {
      lines.push(`${"  ".repeat(i)}${dirs[i]}/`);
    }
    lines.push(`${"  ".repeat(dirs.length)}${parts[parts.length - 1]}`);
    lastDirs = dirs;
  }
  return lines.join("\n");
}

export function buildCodebaseContext(files: Record<string, string>): string {
  const paths = Object.keys(files);
  if (paths.length === 0) return "";
  let budget = CODEBASE_CONTEXT_BUDGET;
  let contents = "";
  // Include the most relevant files first: source, config, then the rest.
  const priority = (p: string) =>
    p === "package.json" || p === "AI_RULES.md"
      ? 0
      : p.startsWith("src/")
        ? 1
        : 2;
  const sorted = [...paths].sort((a, b) => priority(a) - priority(b));
  const included: string[] = [];
  for (const p of sorted) {
    const block = `\n<dyad-file path="${p}">\n${files[p]}\n</dyad-file>\n`;
    if (budget - block.length < 0) break;
    budget -= block.length;
    contents += block;
    included.push(p);
  }
  const omitted = paths.length - included.length;
  return `
# Current App State

The app "${""}" has the following file tree:

<dyad-codebase-context tree>
${fileTree(paths)}
</dyad-codebase-context>

Full contents of the app's files${omitted > 0 ? ` (${omitted} additional files omitted for context budget — use your judgment for those)` : ""}:
${contents}`;
}

export function buildSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const list = skills
    .map(
      (s) => `## Skill: ${s.name} (installed at /home/user/skills/${s.slug}/SKILL.md)

${s.description}

${s.instructions}`,
    )
    .join("\n\n");
  return `
# Installed Skills

The following skills are installed into this app's sandbox. Apply them whenever they are relevant to the user's request:

${list}`;
}

export function buildMcpSection(
  servers: { name: string; tools: McpToolInfo[] }[],
): string {
  const withTools = servers.filter((s) => s.tools.length > 0);
  if (withTools.length === 0) return "";
  const list = withTools
    .map(
      (s) =>
        `## MCP Server: ${s.name}\n\nTools: ${s.tools
          .map((t) => `\`${t.name}\`${t.description ? ` — ${t.description}` : ""}`)
          .join("; ")}`,
    )
    .join("\n\n");
  return `
# MCP Tools

MCP tools from connected servers are available to you as function calls. Use them when they help fulfill the user's request. Tool calls and results appear in the conversation automatically.

${list}`;
}

export function assembleSystemPrompt(opts: {
  chatMode: ChatMode;
  files: Record<string, string>;
  appName: string;
  skills?: Skill[];
  mcpServers?: { name: string; tools: McpToolInfo[] }[];
}): string {
  const base = constructSystemPrompt({
    aiRules: readAiRules(opts.files),
    chatMode: opts.chatMode,
  });
  let prompt = base;
  const context = buildCodebaseContext(opts.files).replaceAll(
    'The app ""',
    `The app "${opts.appName}"`,
  );
  prompt += "\n" + context;
  if (opts.chatMode === "build") {
    prompt += buildSkillsSection(opts.skills ?? []);
    prompt += buildMcpSection(opts.mcpServers ?? []);
  }
  return prompt;
}
