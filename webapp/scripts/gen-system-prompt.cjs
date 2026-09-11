// One-shot generator: writes src/dyad-core/prompts/system-prompt.ts using the
// verbatim prompt strings extracted from the upstream Dyad repository.
const fs = require("fs");
const read = (n) => fs.readFileSync(`/tmp/prompt-${n}.txt`, "utf8");
const PREFIX = read("BUILD_SYSTEM_PREFIX");
const POSTFIX = read("BUILD_SYSTEM_POSTFIX");
const ASK = read("ASK_MODE_SYSTEM_PROMPT");
const RULES = read("DEFAULT_AI_RULES");

const CLOUD_ENV_BLOCK = `
# Cloud Sandbox Environment

This app runs in a secure cloud sandbox (not on the user's machine). The user has NO terminal access — they rely entirely on you and the action buttons.

- The app's files are synced into the sandbox automatically after your response.
- **Rebuild**: deletes node_modules, reinstalls packages, and restarts the app server.
- **Restart**: restarts the app server.
- **Refresh**: refreshes the app preview page.

Suggest one of these commands by using the <dyad-command> tag exactly like this:
<dyad-command type="rebuild"></dyad-command>
<dyad-command type="restart"></dyad-command>
<dyad-command type="refresh"></dyad-command>

If you output one of these commands, tell the user to look for the action button above the chat input.
`;

const out = `/**
 * Ported VERBATIM from Dyad (https://github.com/dyad-sh/dyad):
 *   src/prompts/system_prompt.ts
 *
 * The prompt strings below (BUILD_SYSTEM_PREFIX, BUILD_SYSTEM_POSTFIX,
 * ASK_MODE_SYSTEM_PROMPT, DEFAULT_AI_RULES) are byte-for-byte copies of the
 * upstream agent prompts — the Dyad build/ask protocol is preserved exactly
 * (dyad-write / dyad-rename / dyad-delete / dyad-add-dependency /
 * dyad-command / dyad-chat-summary).
 *
 * Cloud adaptation (additive only — no upstream prompt text was changed):
 * an extra CLOUD_ENV_BLOCK is appended in build mode and skills / MCP context
 * sections are appended by the server agent module at runtime
 * (see src/server/agent/prompt-context.ts).
 */

export type ChatMode = "build" | "ask";

export const BUILD_SYSTEM_PREFIX = ${JSON.stringify(PREFIX)};

export const BUILD_SYSTEM_POSTFIX = ${JSON.stringify(POSTFIX)};

export const ASK_MODE_SYSTEM_PROMPT = ${JSON.stringify(ASK)};

export const DEFAULT_AI_RULES = ${JSON.stringify(RULES)};

/**
 * Cloud addition (not part of upstream text): explains that the app runs in
 * an E2B cloud sandbox. The Rebuild / Restart / Refresh command semantics are
 * taken 1:1 from the upstream prefix block.
 */
export const CLOUD_ENV_BLOCK = ${JSON.stringify(CLOUD_ENV_BLOCK)};

export const BUILD_SYSTEM_PROMPT_BASE = \`$\{BUILD_SYSTEM_PREFIX}

[[AI_RULES]]

$\{BUILD_SYSTEM_POSTFIX}\`;

export function getSystemPromptForChatMode(opts: { chatMode: ChatMode }): string {
  if (opts.chatMode === "ask") {
    return ASK_MODE_SYSTEM_PROMPT;
  }
  return BUILD_SYSTEM_PROMPT_BASE;
}

/**
 * Web equivalent of upstream constructSystemPrompt, restricted to the two
 * tag-protocol modes (build / ask). Context blocks (cloud env, app files,
 * skills, MCP tools) are appended by the caller.
 */
export function constructSystemPrompt(opts: {
  aiRules?: string;
  chatMode: ChatMode;
  themePrompt?: string;
}): string {
  let systemPrompt = getSystemPromptForChatMode({ chatMode: opts.chatMode });
  systemPrompt = systemPrompt.replace(
    "[[AI_RULES]]",
    opts.aiRules ?? DEFAULT_AI_RULES,
  );
  if (opts.chatMode === "build") {
    systemPrompt += "\\n\\n" + CLOUD_ENV_BLOCK;
  }
  if (opts.themePrompt) {
    systemPrompt += "\\n\\n" + opts.themePrompt;
  }
  return systemPrompt;
}

/** Reads AI_RULES.md from the app's file map, falling back to defaults. */
export function readAiRules(files: Record<string, string>): string {
  const aiRules = files["AI_RULES.md"];
  return aiRules && aiRules.trim().length > 0 ? aiRules : DEFAULT_AI_RULES;
}
`;

fs.writeFileSync("src/dyad-core/prompts/system-prompt.ts", out);
console.log("written chars:", out.length);
