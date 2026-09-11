// ============================================================================
// Agent tool definitions + executors.
//
// Tool names, argument schemas and descriptions are PORTED FROM DYAD's local
// agent tool set (src/pro/main/ipc/handlers/local_agent/tools/*). The
// executors target the app's cloud sandbox instead of a local folder.
//
// Additions for the cloud product (documented): run_command, read_skill,
// mcp_tool_call.
// ============================================================================
import { runtimeManager } from "../runtime/manager.js";
import { applySearchReplace, SearchReplaceError } from "./search_replace.js";
import { uid } from "../db.js";
import type { AgentToolDef, ChatTurn, ToolCallRequest } from "./providers.js";
import type { AgentEvent, ToolActivity } from "../types.js";

export interface ToolContext {
  appId: string;
  emit: (event: AgentEvent) => void;
  filesChanged: { path: string; action: "write" | "delete" | "rename" }[];
  addTurn: (turn: ChatTurn) => void;
  /** Resolves MCP consent; returns true when allowed. */
  requestMcpConsent: (args: { toolName: string; server: string; args: Record<string, unknown>; reason: string }) => Promise<boolean>;
  mcpConsentMode: "auto" | "always_allow" | "always_ask";
}

interface ToolSpec {
  def: AgentToolDef;
  /** Default consent: always | ask */
  consent?: "always" | "ask";
  execute: (args: any, ctx: ToolContext) => Promise<string>;
}

const MAX_TOOL_RESULT_CHARS = 30_000;

function clip(text: string, limit = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... [output truncated at ${limit} characters]`;
}

function safeRelPath(p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("path is required");
  const normalized = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error(`Path must stay inside the app directory: ${p}`);
  return normalized;
}

// ----------------------------------------------------------------------------
// Tool specs (schemas ported from Dyad)
// ----------------------------------------------------------------------------

export const TOOLS: Record<string, ToolSpec> = {
  set_chat_summary: {
    def: {
      name: "set_chat_summary",
      description: "Set the summary/title of the current chat. Call exactly once, early in the turn, with a short title (a few words, less than a sentence).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "A short title for the chat, derived from the user's request." },
        },
        required: ["summary"],
      },
    },
    execute: async (args, ctx) => {
      const summary = String(args.summary ?? "").slice(0, 120);
      if (!summary) throw new Error("summary is required");
      ctx.emit({ type: "summary", summary });
      return `Successfully set chat summary to "${summary}"`;
    },
  },

  update_todos: {
    def: {
      name: "update_todos",
      description: "Track progress on complex tasks with a todo list. Replace the whole list each call; keep completed items with status \"completed\".",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "The full todo list.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id, e.g. todo-1" },
                content: { type: "string", description: "The task, one sentence." },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
    execute: async (args) => {
      const todos = Array.isArray(args.todos) ? args.todos.slice(0, 30) : [];
      return `Successfully updated ${todos.length} todo(s)`;
    },
  },

  list_files: {
    def: {
      name: "list_files",
      description: "List files and folders in the app codebase. Set recursive=true to list everything (excluding node_modules). Prefer a targeted read of a subdirectory when you know where to look.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Optional subdirectory to list, relative to the app root." },
          recursive: { type: "boolean", description: "Whether to list files recursively (default: false)" },
        },
      },
    },
    execute: async (args, ctx) => {
      const base = args.directory ? safeRelPath(args.directory) : "";
      const recursive = args.recursive === true;
      const session = runtimeManager.getSession(ctx.appId);
      let entries: { path: string; isDirectory: boolean }[];
      if (session) {
        entries = await session.runtime.listDir(`${runtimeManager.appDir()}/${base}`.replace(/\/$/, ""));
        if (recursive) {
          const all: { path: string; isDirectory: boolean }[] = [];
          const walk = async (dir: string, rel: string, depth: number) => {
            if (depth > 8 || all.length > 1200) return;
            for (const e of await session.runtime.listDir(dir)) {
              const name = e.path.split("/").pop() ?? e.path;
              if (["node_modules", ".git", "dist", ".next"].includes(name)) continue;
              const childRel = rel ? `${rel}/${name}` : name;
              all.push({ path: childRel, isDirectory: e.isDirectory });
              if (e.isDirectory) await walk(e.path, childRel, depth + 1);
            }
          };
          await walk(`${runtimeManager.appDir()}/${base}`.replace(/\/$/, ""), base, 0);
          entries = all;
        }
      } else {
        entries = runtimeManager.listMirrorFiles(ctx.appId).filter((e) => (base ? e.path.startsWith(`${base}/`) : true));
      }
      const sorted = entries
        .map((e) => (e.isDirectory ? `${e.path}/` : e.path))
        .sort((a, b) => a.localeCompare(b));
      const limited = sorted.slice(0, 1000);
      const trunc = sorted.length > 1000 ? `\n... (${sorted.length - 1000} more)` : "";
      return clip(`<files count="${limited.length}">\n${limited.map((p) => p).join("\n")}${trunc}\n</files>`);
    },
  },

  read_file: {
    def: {
      name: "read_file",
      description: `Read the content of a file from the codebase.

- Batch independent file reads when several files are concretely likely to be useful.`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to read, relative to the app root." },
          start_line_one_indexed: { type: "integer", description: "The one-indexed line number to start reading from (inclusive)." },
          end_line_one_indexed_inclusive: { type: "integer", description: "The one-indexed line number to end reading at (inclusive)." },
        },
        required: ["path"],
      },
    },
    execute: async (args, ctx) => {
      const p = safeRelPath(args.path);
      let content = await runtimeManager.readFile(ctx.appId, p);
      if (content.length > 200_000) content = `${content.slice(0, 200_000)}\n... [file truncated]`;
      let lines = content.split("\n");
      const start = Number.isInteger(args.start_line_one_indexed) ? Math.max(1, args.start_line_one_indexed) : 1;
      const end = Number.isInteger(args.end_line_one_indexed_inclusive) ? args.end_line_one_indexed_inclusive : lines.length;
      lines = lines.slice(start - 1, end);
      const numbered = lines.map((l, i) => `${String(start + i).padStart(5)} | ${l}`).join("\n");
      return clip(`<file path="${p}" lines="${start}-${end}">\n${numbered}\n</file>`);
    },
  },

  write_file: {
    def: {
      name: "write_file",
      description: "Create or completely overwrite a file in the codebase",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path relative to the app root" },
          content: { type: "string", description: "The content to write to the file" },
          description: { type: "string", description: "Brief description of the change" },
        },
        required: ["path", "content"],
      },
    },
    execute: async (args, ctx) => {
      const p = safeRelPath(args.path);
      await runtimeManager.writeFile(ctx.appId, p, String(args.content ?? ""));
      ctx.filesChanged.push({ path: p, action: "write" });
      ctx.emit({
        type: "files_changed",
        files: [{ path: p, action: "write" }],
      });
      return `Successfully wrote ${p}`;
    },
  },

  search_replace: {
    def: {
      name: "search_replace",
      description: `Use this tool to propose a search and replace operation on an existing file.

The tool will replace ONE occurrence of old_string with new_string in the specified file. Matching is line-based: old_string must match whole file lines, not a partial fragment within a line. To edit part of a line, include the entire original line in old_string and the entire edited line in new_string.

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
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "The path to the file you want to search and replace in." },
          old_string: { type: "string", description: "The text block to replace. Matching is line-based: each line in old_string must match a whole line in the file. The block must be unique within the file." },
          new_string: { type: "string", description: "The edited text to replace the old_string (must be different from the old_string)" },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
    execute: async (args, ctx) => {
      const p = safeRelPath(args.file_path);
      const original = await runtimeManager.readFile(ctx.appId, p);
      const updated = applySearchReplace(original, String(args.old_string ?? ""), String(args.new_string ?? ""));
      await runtimeManager.writeFile(ctx.appId, p, updated);
      if (!ctx.filesChanged.some((f) => f.path === p && f.action === "write")) {
        ctx.filesChanged.push({ path: p, action: "write" });
        ctx.emit({ type: "files_changed", files: [{ path: p, action: "write" }] });
      }
      return `Successfully edited ${p}`;
    },
  },

  delete_file: {
    def: {
      name: "delete_file",
      description: "Delete a file from the codebase. Only delete files related to the user's request.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to delete, relative to the app root." },
        },
        required: ["path"],
      },
    },
    execute: async (args, ctx) => {
      const p = safeRelPath(args.path);
      await runtimeManager.deleteFile(ctx.appId, p);
      ctx.filesChanged.push({ path: p, action: "delete" });
      ctx.emit({ type: "files_changed", files: [{ path: p, action: "delete" }] });
      return `Successfully deleted ${p}`;
    },
  },

  rename_file: {
    def: {
      name: "rename_file",
      description: "Rename or move a file within the app codebase.",
      parameters: {
        type: "object",
        properties: {
          old_path: { type: "string", description: "Current file path relative to the app root." },
          new_path: { type: "string", description: "New file path relative to the app root." },
        },
        required: ["old_path", "new_path"],
      },
    },
    execute: async (args, ctx) => {
      const from = safeRelPath(args.old_path);
      const to = safeRelPath(args.new_path);
      await runtimeManager.renameFile(ctx.appId, from, to);
      ctx.filesChanged.push({ path: to, action: "rename" });
      ctx.emit({ type: "files_changed", files: [{ path: to, action: "rename" }] });
      return `Successfully renamed ${from} to ${to}`;
    },
  },

  grep: {
    def: {
      name: "grep",
      description: "Search file contents with a regex across the codebase (excludes node_modules). Returns matching file paths, line numbers and text.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The regex pattern to search for, or the exact text when literal is true" },
          include_pattern: { type: "string", description: "Glob pattern for files to include (e.g. '*.ts')" },
          exclude_pattern: { type: "string", description: "Glob pattern for files to exclude" },
          case_sensitive: { type: "boolean", description: "Whether the search should be case sensitive (default: false)" },
          literal: { type: "boolean", description: "Search query as exact text instead of a regex." },
          limit: { type: "integer", description: "Maximum number of matching lines to return (default 100, max 250)." },
        },
        required: ["query"],
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(args.limit ?? 100, 1), 250);
      const session = runtimeManager.getSession(ctx.appId);
      const query = String(args.query ?? "");
      if (!query) throw new Error("query is required");
      const pattern = args.literal ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query;
      const includeArgs = args.include_pattern ? ` --include='${String(args.include_pattern).replace(/'/g, "")}'` : "";
      const excludeArgs = args.exclude_pattern ? ` --exclude='${String(args.exclude_pattern).replace(/'/g, "")}'` : "";
      const caseArg = args.case_sensitive ? "" : " -i";
      const cmd = `cd ${runtimeManager.appDir()} && grep -rn${caseArg} -E ${includeArgs}${excludeArgs} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next -e '${pattern.replace(/'/g, `'\\''`)}' . | head -n ${limit}`;
      if (!session) return "Sandbox not running. Start the app and try again.";
      const res = await session.runtime.run(cmd, { timeoutMs: 30_000 });
      if (!res.stdout.trim()) return `No matches found for "${query}"`;
      return clip(`<grep_results query="${query.replace(/"/g, "&quot;")}" count="${res.stdout.trim().split("\n").length}">\n${res.stdout.trim()}\n</grep_results>`);
    },
  },

  run_command: {
    def: {
      name: "run_command",
      description: "Run a shell command inside the app's sandbox (in the app directory). Use for installing packages, running scripts/migrations, git operations, or inspecting the environment. Do not use it to start long-running servers (use restart_app instead).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
          timeout_seconds: { type: "integer", description: "Timeout in seconds (default 60, max 600)." },
        },
        required: ["command"],
      },
    },
    consent: "ask",
    execute: async (args, ctx) => {
      const command = String(args.command ?? "").trim();
      if (!command) throw new Error("command is required");
      if (/^\s*(sudo|shutdown|reboot|rm\s+-rf\s+\/)\b/.test(command)) {
        throw new Error("Command not allowed");
      }
      const timeoutMs = Math.min(Math.max((args.timeout_seconds ?? 60) * 1000, 1000), 600_000);
      const res = await runtimeManager.runInApp(ctx.appId, command, timeoutMs);
      const out = [
        res.exitCode !== 0 ? `Exit code: ${res.exitCode}` : null,
        res.stdout.trim() ? `stdout:\n${res.stdout.trim()}` : null,
        res.stderr.trim() ? `stderr:\n${res.stderr.trim()}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return clip(out || "(no output)");
    },
  },

  add_dependency: {
    def: {
      name: "add_dependency",
      description: `Install npm packages for the app. Use a bare package name to install it. If the user asks for multiple packages, pass them space-separated in the packages field.

Example: packages="package1 package2 package3"`,
      parameters: {
        type: "object",
        properties: {
          packages: { type: "string", description: "Space-separated list of npm packages to install." },
        },
        required: ["packages"],
      },
    },
    execute: async (args, ctx) => {
      const packages = String(args.packages ?? "").trim();
      if (!packages) throw new Error("packages is required");
      if (packages.split(/\s+/).length > 10) throw new Error("Install at most 10 packages at a time");
      const res = await runtimeManager.runInApp(ctx.appId, `npm install ${packages} --include=dev --no-audit --no-fund 2>&1 | tail -3`, 10 * 60_000);
      if (res.exitCode !== 0) {
        return `npm install failed:\n${clip(res.stdout + res.stderr, 4000)}`;
      }
      return `Successfully installed: ${packages}`;
    },
  },

  restart_app: {
    def: {
      name: "restart_app",
      description: "Restart the app's development server. Only use when the dev server is stopped, unresponsive, or a process-boundary change (env vars, server config) requires a fresh process.",
      parameters: { type: "object", properties: {} },
    },
    execute: async (_args, ctx) => {
      const store = (await import("../db.js")).getStore();
      const appRow = store.apps.find((a) => a.id === ctx.appId);
      const settings = store.settings[appRow!.userId];
      await runtimeManager.startDevServer(appRow!, settings);
      return "Successfully restarted the app";
    },
  },

  reinstall_and_restart_app: {
    def: {
      name: "reinstall_and_restart_app",
      description: "Reinstall node_modules from scratch and restart the dev server. Only use when dependencies are missing or broken, or the user explicitly asks to reinstall.",
      parameters: { type: "object", properties: {} },
    },
    execute: async (_args, ctx) => {
      const store = (await import("../db.js")).getStore();
      const appRow = store.apps.find((a) => a.id === ctx.appId);
      const settings = store.settings[appRow!.userId];
      const session = runtimeManager.getSession(ctx.appId);
      if (!session) throw new Error("sandbox not running");
      await runtimeManager.runInApp(ctx.appId, "rm -rf node_modules", 120_000);
      await runtimeManager.runInApp(ctx.appId, "npm install --include=dev --no-audit --no-fund 2>&1 | tail -3", 15 * 60_000);
      await runtimeManager.startDevServer(appRow!, settings, session.runtime);
      return "Successfully reinstalled dependencies and restarted the app";
    },
  },

  read_logs: {
    def: {
      name: "read_logs",
      description: "Read recent output from the app's sandbox: dev server logs, build output, and command history. Use this to debug runtime errors the user reports.",
      parameters: {
        type: "object",
        properties: {
          lines: { type: "integer", description: "Number of recent lines to read (default 80)." },
        },
      },
    },
    execute: async (args, ctx) => {
      const lines = Math.min(Math.max(args.lines ?? 80, 10), 400);
      const logs = runtimeManager.logs(ctx.appId);
      const tail = logs.split("\n").slice(-lines).join("\n");
      return clip(tail || "(no logs yet)");
    },
  },

  read_skill: {
    def: {
      name: "read_skill",
      description: "Read the full instructions of a skill installed in this app's sandbox. Use when the system prompt tells you to load a skill for a matching task.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "The skill slug from the <skills> block (e.g. 'shadcn-design-system')." },
        },
        required: ["slug"],
      },
    },
    execute: async (args, ctx) => {
      const slug = String(args.slug ?? "").replace(/[^a-z0-9-]/gi, "");
      if (!slug) throw new Error("slug is required");
      const session = runtimeManager.getSession(ctx.appId);
      if (session) {
        try {
          // Skills live at /home/user/skills/<slug>/SKILL.md inside the sandbox.
          return await session.runtime.readFile(`/home/user/skills/${slug}/SKILL.md`);
        } catch {
          // fall back to the server-side skill store
        }
      }
      const store = (await import("../db.js")).getStore();
      const appRow = store.apps.find((a) => a.id === ctx.appId);
      const skill = store.skills.find((s) => s.slug === slug && appRow?.config.installedSkillIds.includes(s.id));
      if (!skill) throw new Error(`Skill "${slug}" not found. Load skills with read_skill using the slugs listed in the system prompt.`);
      return skill.instructions;
    },
  },

  mcp_tool_call: {
    def: {
      name: "mcp_tool_call",
      description: "Call a tool on a connected MCP server. Use the server id, tool name and a JSON arguments object from the <mcp_servers> block.",
      parameters: {
        type: "object",
        properties: {
          server: { type: "string", description: "The MCP server id from the <mcp_servers> block." },
          tool: { type: "string", description: "The tool name to call." },
          arguments: { type: "object", description: "Arguments object matching the tool's input schema." },
        },
        required: ["server", "tool"],
      },
    },
    consent: "ask",
    execute: async (args, ctx) => {
      const server = String(args.server ?? "");
      const tool = String(args.tool ?? "");
      const toolArgs = (args.arguments && typeof args.arguments === "object" ? args.arguments : {}) as Record<string, unknown>;
      if (!server || !tool) throw new Error("server and tool are required");

      // ---- MCP consent policy (ported from src/prompts/mcp_consent_policy.ts,
      // deterministic subset; "always_allow"/"always_ask" honored from settings)
      const consentInfo = classifyMcpCall(tool, toolArgs);
      const allowed =
        ctx.mcpConsentMode === "always_allow" ||
        (ctx.mcpConsentMode === "auto" && consentInfo.decision === "allow") ||
        (await ctx.requestMcpConsent({ toolName: tool, server, args: toolArgs, reason: consentInfo.reason }));
      if (!allowed) {
        return "The user declined this tool call. Do not retry it; ask the user how to proceed.";
      }
      const res = await runtimeManager.callMcp(ctx.appId, server, tool, toolArgs);
      if (!res.ok) throw new Error(res.error ?? "MCP tool call failed");
      return clip(res.text ?? "(empty result)");
    },
  },
};

// ----------------------------------------------------------------------------
// MCP consent classifier (deterministic port of Dyad's consent policy)
// ----------------------------------------------------------------------------

const ALLOW_PATTERNS: RegExp[] = [
  /^(get|read|list|search|fetch|query|describe|show|find|lookup|check|view|schema|health)/i,
  /^(take_)?screenshot/i,
  /^(echo|add|think|sequential)/i,
];

const ALWAYS_ASK_PATTERNS: RegExp[] = [
  /^(send|create|post|delete|remove|update|write|merge|publish|rotate|grant|revoke|invite|share|pay|transfer|purchase|deploy|schedule)/i,
];

export function classifyMcpCall(
  toolName: string,
  _args: Record<string, unknown>,
): { decision: "allow" | "ask"; reason: string } {
  if (ALWAYS_ASK_PATTERNS.some((r) => r.test(toolName))) {
    return {
      decision: "ask",
      reason: "This tool changes state outside the app (send/create/delete/update) and needs your approval.",
    };
  }
  if (ALLOW_PATTERNS.some((r) => r.test(toolName))) {
    return { decision: "allow", reason: "Read-only or sandboxed tool call." };
  }
  return {
    decision: "ask",
    reason: "The effect of this tool call could not be determined automatically.",
  };
}

// ----------------------------------------------------------------------------
// Schema export for the LLM
// ----------------------------------------------------------------------------

export function getToolDefs(opts: { mode: "agent" | "ask"; hasMcpServers: boolean; hasSkills: boolean }): AgentToolDef[] {
  const readOnly = new Set(["set_chat_summary", "update_todos", "list_files", "read_file", "grep", "read_logs", "read_skill"]);
  const defs: AgentToolDef[] = [];
  for (const spec of Object.values(TOOLS)) {
    if (opts.mode === "ask" && !readOnly.has(spec.def.name)) continue;
    if (spec.def.name === "mcp_tool_call" && !opts.hasMcpServers) continue;
    if (spec.def.name === "read_skill" && !opts.hasSkills) continue;
    defs.push(spec.def);
  }
  return defs;
}

export async function executeTool(
  toolName: string,
  rawArgs: string,
  ctx: ToolContext,
  providerToolCallId: string,
): Promise<{ activity: ToolActivity; turn: ChatTurn }> {
  const id = uid("act_");
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    args = { __raw: rawArgs };
  }
  const activity: ToolActivity = {
    id,
    toolName,
    args,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  ctx.emit({ type: "tool_start", activity });

  const spec = TOOLS[toolName];
  let resultText: string;
  let isError = false;
  if (!spec) {
    resultText = `Unknown tool: ${toolName}`;
    isError = true;
  } else {
    try {
      resultText = await spec.execute(args, ctx);
    } catch (e: any) {
      resultText = `Error: ${e?.message ?? String(e)}`;
      isError = true;
    }
  }

  activity.status = isError ? "error" : "completed";
  activity.result = clip(resultText, 8000);
  activity.finishedAt = new Date().toISOString();
  ctx.emit({ type: "tool_result", activity });

  const turn: ChatTurn = { role: "tool", toolCallId: providerToolCallId, toolName, content: resultText, isError };
  return { activity, turn };
}

/** Map our tool-call ids to stable ids for the provider protocol. */
export function toolCallIdFor(activityId: string): string {
  return activityId;
}
