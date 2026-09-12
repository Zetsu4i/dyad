// Agent tools — ported from Dyad's local agent tool set (write_file,
// search_replace, read_file, list_files, grep, delete/rename, add_dependency,
// run_command, restart_app...) and adapted to execute against the E2B sandbox.

import { z } from "zod";
import { tool, jsonSchema, type ToolSet } from "ai";
import {
  ensureSandbox,
  runSandboxCommand,
  readSandboxFile,
  writeSandboxFile,
  restartApp,
  reinstallAndRestartApp,
  isIgnored,
  type RunningSandbox,
} from "@/lib/e2b/sandbox";
import { callMcpTool, contentToText, type McpBridge } from "@/lib/mcp/manager";
import { sanitize } from "./prompts";
import { APP_ROOT } from "@/lib/e2b/sandbox";

export interface ToolEvent {
  type: "tool-start" | "tool-result";
  tool: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  detail?: string;
}

export interface AgentToolContext {
  appId: string;
  userId: string;
  entry: RunningSandbox;
  chatId: string;
  mcpBridges: McpBridge[];
  changedFiles: Set<string>;
  title?: string;
  onEvent: (evt: ToolEvent) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function grepSandbox(
  ctx: AgentToolContext,
  query: string,
  includePattern?: string,
  path?: string
): Promise<string> {
  const target = path ? `${APP_ROOT}/${path.replace(/^\/+/, "")}` : APP_ROOT;
  const include = includePattern ? ` --include='${includePattern.replace(/'/g, "")}'` : "";
  const cmd = `grep -rn --binary-files=without-match -m 40 ${include} -- '${query.replace(/'/g, `'\\''`)}' ${target} 2>/dev/null | grep -v node_modules | grep -v '.next/' | head -100 || true`;
  const res = await runSandboxCommand(ctx.appId, ctx.userId, cmd, 30_000);
  const out = res.stdout.trim();
  return out || `No matches for "${query}"`;
}

function applySearchReplace(content: string, oldString: string, newString: string): { ok: boolean; result?: string; error?: string } {
  if (oldString === newString) return { ok: false, error: "old_string and new_string are identical" };
  const firstIdx = content.indexOf(oldString);
  if (firstIdx === -1) {
    // Line-based fuzzy fallback: trim trailing whitespace per line
    const normalize = (s: string) => s.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");
    const normContent = normalize(content);
    const normOld = normalize(oldString);
    const idx = normContent.indexOf(normOld);
    if (idx === -1) {
      return { ok: false, error: "old_string not found in file. Ensure it matches the file exactly, including whitespace and indentation." };
    }
    if (normContent.indexOf(normOld, idx + 1) !== -1) {
      return { ok: false, error: "old_string matches multiple locations in the file. Include more surrounding lines to make it unique." };
    }
    // Reconstruct with normalized content (rare path)
    const result = normContent.slice(0, idx) + normalize(newString) + normContent.slice(idx + normOld.length);
    return { ok: true, result };
  }
  if (content.indexOf(oldString, firstIdx + 1) !== -1) {
    return { ok: false, error: "old_string matches multiple locations in the file. Include more surrounding lines (3-5 lines before and after the change) to make it unique." };
  }
  const result = content.slice(0, firstIdx) + newString + content.slice(firstIdx + oldString.length);
  return { ok: true, result };
}

function truncate(s: string, max = 4000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (truncated ${s.length - max} chars)`;
}

// ---------------------------------------------------------------------------
// Core tool factory
// ---------------------------------------------------------------------------

export function buildAgentTools(ctx: AgentToolContext) {
  const markChanged = (path: string) => {
    if (!isIgnored(path)) ctx.changedFiles.add(path);
  };

  const writeFile = tool({
    description: "Create or completely overwrite a file in the codebase.",
    inputSchema: z.object({
      path: z.string().describe("The file path relative to the app root (/app)"),
      content: z.string().describe("The content to write to the file"),
      description: z.string().optional().describe("Brief description of the change"),
    }),
    execute: async (args: { path: string; content: string; description?: string }) => {
      const { path, content, description } = args;
      ctx.onEvent({ type: "tool-start", tool: "write_file", input: { path, description } });
      if (isIgnored(path)) {
        const msg = `Path ${path} is ignored/protected`;
        ctx.onEvent({ type: "tool-result", tool: "write_file", ok: false, summary: msg });
        return msg;
      }
      try {
        await writeSandboxFile(ctx.appId, ctx.userId, path, content);
        markChanged(path);
        const lines = content.split("\n").length;
        const summary = `Created ${path} +${lines}`;
        ctx.onEvent({ type: "tool-result", tool: "write_file", ok: true, summary });
        return `Successfully wrote ${path}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.onEvent({ type: "tool-result", tool: "write_file", ok: false, summary: `Failed to write ${path}` });
        return `Error writing ${path}: ${msg}`;
      }
    },
  });

  const searchReplace = tool({
    description: `Use this tool to propose a search and replace operation on an existing file.

The tool will replace ONE occurrence of old_string with new_string in the specified file. Matching is line-based: old_string must match whole file lines, not just a partial fragment within a line. To edit part of a line, include the entire original line in old_string and the entire edited line in new_string.

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. UNIQUENESS: The old_string MUST uniquely identify the specific instance you want to change. This means:
   - Include AT LEAST 3-5 lines of context BEFORE the change point
   - Include AT LEAST 3-5 lines of context AFTER the change point
   - Include all whitespace, indentation, and surrounding code exactly as it appears in the file
   - Do NOT use only a partial fragment of a line. Include the full line containing the change.

2. SINGLE INSTANCE: This tool can only change ONE instance at a time. If you need to change multiple instances:
   - Make separate calls to this tool for each instance
   - Each call must uniquely identify its specific instance using extensive context

3. VERIFICATION: Before using this tool:
   - If multiple instances exist, gather enough context to uniquely identify each one
   - Plan separate tool calls for each instance`,
    inputSchema: z.object({
      file_path: z.string().describe("The path to the file you want to search and replace in"),
      old_string: z.string().describe("The text block to replace. Must match whole file lines and be unique in the file."),
      new_string: z.string().describe("The edited text to replace the old_string"),
    }),
    execute: async (args: { file_path: string; old_string: string; new_string: string }) => {
      const { file_path, old_string, new_string } = args;
      ctx.onEvent({ type: "tool-start", tool: "search_replace", input: { file_path } });
      try {
        const content = await readSandboxFile(ctx.appId, ctx.userId, file_path);
        const { ok, result, error } = applySearchReplace(content, old_string, new_string);
        if (!ok || result === undefined) {
          ctx.onEvent({ type: "tool-result", tool: "search_replace", ok: false, summary: `Edit failed in ${file_path}` });
          return `SEARCH/REPLACE failed: ${error}. If it fails twice in a row, use write_file to rewrite the file.`;
        }
        await writeSandboxFile(ctx.appId, ctx.userId, file_path, result);
        markChanged(file_path);
        ctx.onEvent({ type: "tool-result", tool: "search_replace", ok: true, summary: `Edited ${file_path}` });
        return `Successfully edited ${file_path}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.onEvent({ type: "tool-result", tool: "search_replace", ok: false, summary: `Edit failed in ${file_path}` });
        return `Error editing ${file_path}: ${msg}`;
      }
    },
  });

  const readFile = tool({
    description: "Read the contents of a file in the codebase.",
    inputSchema: z.object({
      path: z.string().describe("The file path relative to the app root"),
      start_line: z.number().optional().describe("1-indexed start line"),
      end_line: z.number().optional().describe("1-indexed end line (inclusive)"),
    }),
    execute: async (args: { path: string; start_line?: number; end_line?: number }) => {
      const { path, start_line, end_line } = args;
      ctx.onEvent({ type: "tool-start", tool: "read_file", input: { path } });
      try {
        let content = await readSandboxFile(ctx.appId, ctx.userId, path);
        if (start_line || end_line) {
          const lines = content.split("\n");
          const s = Math.max(0, (start_line ?? 1) - 1);
          const e = Math.min(lines.length, end_line ?? lines.length);
          content = lines.slice(s, e).join("\n");
        }
        ctx.onEvent({ type: "tool-result", tool: "read_file", ok: true, summary: `Read ${path}` });
        return truncate(content, 30000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.onEvent({ type: "tool-result", tool: "read_file", ok: false, summary: `Failed to read ${path}` });
        return `Error reading ${path}: ${msg}`;
      }
    },
  });

  const listFiles = tool({
    description: "List files and directories in the project (relative to /app). Use path '' for the project root.",
    inputSchema: z.object({
      path: z.string().default("").describe("Directory path relative to app root; empty string = root"),
    }),
    execute: async (args: { path: string }) => {
      const { path } = args;
      ctx.onEvent({ type: "tool-start", tool: "list_files", input: { path } });
      const cmd = `cd ${APP_ROOT}${path ? `/${path.replace(/^\/+/, "")}` : ""} && find . -maxdepth 3 -not -path '*/node_modules*' -not -path '*/.git*' -not -path '*/.next*' -not -path '*/.expo*' -not -path '*/.skills*' -not -path '*/dist*' -not -path '*/build*' | sort | head -200`;
      const res = await runSandboxCommand(ctx.appId, ctx.userId, cmd, 20_000);
      ctx.onEvent({ type: "tool-result", tool: "list_files", ok: true, summary: `Listed ${path || "/"}` });
      return res.stdout.trim() || "(empty directory)";
    },
  });

  const grep = tool({
    description: "Search for a text pattern (regex) across files in the codebase. Returns matching lines with file/line context.",
    inputSchema: z.object({
      query: z.string().describe("The text pattern or regex to search for"),
      include_pattern: z.string().optional().describe("Glob pattern to filter files, e.g. '*.tsx'"),
      path: z.string().optional().describe("Subdirectory to search in (relative to app root)"),
    }),
    execute: async (args: { query: string; include_pattern?: string; path?: string }) => {
      const { query, include_pattern, path } = args;
      ctx.onEvent({ type: "tool-start", tool: "grep", input: { query } });
      const out = await grepSandbox(ctx, query, include_pattern, path);
      ctx.onEvent({ type: "tool-result", tool: "grep", ok: true, summary: `Searched for "${query.slice(0, 40)}"` });
      return truncate(out, 8000);
    },
  });

  const deleteFile = tool({
    description: "Delete a file from the codebase.",
    inputSchema: z.object({ path: z.string().describe("File path relative to app root") }),
    execute: async (args: { path: string }) => {
      const { path } = args;
      ctx.onEvent({ type: "tool-start", tool: "delete_file", input: { path } });
      if (isIgnored(path)) return `Path ${path} is ignored/protected`;
      const res = await runSandboxCommand(ctx.appId, ctx.userId, `rm -f -- '${APP_ROOT}/${path.replace(/'/g, "")}'`, 15_000);
      markChanged(path);
      ctx.onEvent({ type: "tool-result", tool: "delete_file", ok: res.exitCode === 0, summary: `Deleted ${path}` });
      return res.exitCode === 0 ? `Successfully deleted ${path}` : `Failed to delete ${path}: ${res.stderr}`;
    },
  });

  const renameFile = tool({
    description: "Rename or move a file within the codebase.",
    inputSchema: z.object({
      from: z.string().describe("Current path relative to app root"),
      to: z.string().describe("New path relative to app root"),
    }),
    execute: async (args: { from: string; to: string }) => {
      const { from, to } = args;
      ctx.onEvent({ type: "tool-start", tool: "rename_file", input: { from, to } });
      if (isIgnored(from) || isIgnored(to)) return "Path is ignored/protected";
      const res = await runSandboxCommand(
        ctx.appId,
        ctx.userId,
        `mkdir -p "${APP_ROOT}/$(dirname '${APP_ROOT}/${to.replace(/'/g, "")}')" 2>/dev/null; mv '${APP_ROOT}/${from.replace(/'/g, "")}' '${APP_ROOT}/${to.replace(/'/g, "")}'`,
        15_000
      );
      markChanged(from);
      markChanged(to);
      ctx.onEvent({ type: "tool-result", tool: "rename_file", ok: res.exitCode === 0, summary: `Renamed ${from} → ${to}` });
      return res.exitCode === 0 ? `Successfully renamed ${from} to ${to}` : `Failed: ${res.stderr}`;
    },
  });

  const addDependency = tool({
    description: "Install npm packages into the project. Use a bare package name to install, or package@latest to upgrade to the newest release.",
    inputSchema: z.object({
      packages: z.string().describe("Space-separated package names, e.g. 'zod react-hot-toast' (NO commas)"),
    }),
    execute: async (args: { packages: string }) => {
      const { packages } = args;
      ctx.onEvent({ type: "tool-start", tool: "add_dependency", input: { packages } });
      const pkgs = packages.split(/[\s,]+/).filter((p) => p.length > 0);
      if (pkgs.length === 0) return "No packages specified";
      const res = await runSandboxCommand(
        ctx.appId,
        ctx.userId,
        `npm install --no-audit --no-fund --loglevel=error ${pkgs.join(" ")}`,
        5 * 60_000
      );
      ctx.onEvent({ type: "tool-result", tool: "add_dependency", ok: res.exitCode === 0, summary: `Installed ${pkgs.join(", ")}` });
      if (res.exitCode !== 0) return `npm install failed:\n${truncate(res.stderr || res.stdout, 3000)}`;
      return `Successfully installed ${pkgs.join(", ")}`;
    },
  });

  const runCommand = tool({
    description: "Run a shell command in the project's cloud sandbox (cwd: /home/user/app, the project root). Use for builds, tests, git, or any project task. Do NOT use it to start the dev server (it's managed — use restart_app).",
    inputSchema: z.object({
      command: z.string().describe("The shell command to run"),
      timeout_ms: z.number().optional().describe("Timeout in milliseconds (default 120000, max 300000)"),
    }),
    execute: async (args: { command: string; timeout_ms?: number }) => {
      const { command, timeout_ms } = args;
      ctx.onEvent({ type: "tool-start", tool: "run_command", input: { command: command.slice(0, 200) } });
      const timeout = Math.min(timeout_ms ?? 120_000, 300_000);
      try {
        const res = await runSandboxCommand(ctx.appId, ctx.userId, command, timeout);
        const out = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
        ctx.onEvent({
          type: "tool-result",
          tool: "run_command",
          ok: res.exitCode === 0,
          summary: `${command.split("\n")[0].slice(0, 60)} → exit ${res.exitCode}`,
          detail: truncate(out, 2000),
        });
        return `exit code: ${res.exitCode}\n${truncate(out, 20000)}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.onEvent({ type: "tool-result", tool: "run_command", ok: false, summary: `Command failed: ${command.slice(0, 50)}`, detail: truncate(msg, 1000) });
        return `Command failed: ${msg}`;
      }
    },
  });

  const restartAppTool = tool({
    description: "Restart the app's dev server. Use only when: the user explicitly asks, the dev server is stopped/unresponsive/stale, or process-boundary changes were made (config, startup scripts, env vars, server init code).",
    inputSchema: z.object({}),
    execute: async () => {
      ctx.onEvent({ type: "tool-start", tool: "restart_app", input: {} });
      await restartApp(ctx.appId, ctx.userId);
      ctx.onEvent({ type: "tool-result", tool: "restart_app", ok: true, summary: "Restarted dev server" });
      return "Dev server restarted. The preview will reload automatically.";
    },
  });

  const reinstallAndRestart = tool({
    description: "Delete node_modules, re-install dependencies, and restart the dev server. Use only when node_modules is missing/broken or the user asks to reinstall.",
    inputSchema: z.object({}),
    execute: async () => {
      ctx.onEvent({ type: "tool-start", tool: "reinstall_and_restart_app", input: {} });
      await reinstallAndRestartApp(ctx.appId, ctx.userId);
      ctx.onEvent({ type: "tool-result", tool: "reinstall_and_restart_app", ok: true, summary: "Reinstalled deps + restarted" });
      return "Dependencies reinstalled and dev server restarted.";
    },
  });

  const readLogs = tool({
    description: "Read the app's dev server logs (stdout/stderr) from the sandbox. Use when the app fails to render or behaves unexpectedly.",
    inputSchema: z.object({}),
    execute: async () => {
      ctx.onEvent({ type: "tool-start", tool: "read_logs", input: {} });
      const { getDevLogs } = await import("@/lib/e2b/sandbox");
      const logs = (await getDevLogs(ctx.appId)).slice(-80).map((l) => l.line).join("\n");
      ctx.onEvent({ type: "tool-result", tool: "read_logs", ok: true, summary: "Read dev server logs" });
      return truncate(logs || "(no logs yet)", 8000);
    },
  });

  const setChatTitle = tool({
    description: "Set the chat title/summary. Call exactly once per turn, early, as soon as you understand the user's request. Keep it under one sentence.",
    inputSchema: z.object({ title: z.string().describe("Short chat title, less than a sentence") }),
    execute: async (args: { title: string }) => {
      const { title } = args;
      ctx.title = title.slice(0, 80);
      ctx.onEvent({ type: "tool-result", tool: "set_chat_title", ok: true, summary: `Title: ${title}` });
      return "Title set.";
    },
  });

  const readSkill = tool({
    description: "Read the SKILL.md instructions of an installed skill. Skills listed in the system prompt live at .skills/<slug>/ under the project root.",
    inputSchema: z.object({ slug: z.string().describe("The skill slug, e.g. 'artifacts-builder'") }),
    execute: async (args: { slug: string }) => {
      const { slug } = args;
      ctx.onEvent({ type: "tool-start", tool: "read_skill", input: { slug } });
      try {
        const content = await readSandboxFile(ctx.appId, ctx.userId, `${APP_ROOT}/.skills/${sanitize(slug)}/SKILL.md`);
        ctx.onEvent({ type: "tool-result", tool: "read_skill", ok: true, summary: `Read skill ${slug}` });
        return truncate(content, 20000);
      } catch {
        ctx.onEvent({ type: "tool-result", tool: "read_skill", ok: false, summary: `Skill ${slug} not found` });
        return `Skill ${slug} not found in the sandbox.`;
      }
    },
  });

  const tools: ToolSet = {
    write_file: writeFile,
    search_replace: searchReplace,
    read_file: readFile,
    list_files: listFiles,
    grep,
    delete_file: deleteFile,
    rename_file: renameFile,
    add_dependency: addDependency,
    run_command: runCommand,
    restart_app: restartAppTool,
    reinstall_and_restart_app: reinstallAndRestart,
    read_logs: readLogs,
    set_chat_title: setChatTitle,
    read_skill: readSkill,
  } as unknown as ToolSet;

  // MCP tools — namespaced and bridged to live servers inside the sandbox
  for (const bridge of ctx.mcpBridges) {
    if (bridge.status !== "connected") continue;
    for (const t of bridge.tools) {
      const key = `mcp_${sanitize(bridge.serverName)}_${sanitize(t.name)}`;
      const serverId = bridge.serverId;
      const toolName = t.name;
      const description = t.description || `MCP tool ${bridge.serverName}/${t.name}`;
      tools[key] = tool({
        description: `[${bridge.serverName}] ${description}`.slice(0, 800),
        inputSchema: jsonSchema((t.inputSchema as object) ?? { type: "object", properties: {} }),
        execute: async (input: Record<string, unknown>) => {
          ctx.onEvent({ type: "tool-start", tool: key, input: { server: bridge.serverName, tool: toolName } });
          try {
            const res = await callMcpTool(ctx.entry, serverId, toolName, input ?? {});
            const text = contentToText((res as { content?: unknown })?.content ?? res);
            ctx.onEvent({ type: "tool-result", tool: key, ok: true, summary: `${bridge.serverName}/${toolName} OK`, detail: truncate(text, 1500) });
            return truncate(text, 20000);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.onEvent({ type: "tool-result", tool: key, ok: false, summary: `${bridge.serverName}/${toolName} failed`, detail: truncate(msg, 1000) });
            return `MCP tool call failed: ${msg}`;
          }
        },
      });
    }
  }

  return tools;
}
