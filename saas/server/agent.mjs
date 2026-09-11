// Agentic loop: streams model output, executes tools against the app sandbox,
// applies legacy <dyad-*> tags, and emits SSE events to the browser.
// Tools: files + commands (sandbox), MCP tools (connected servers), skills.
import { getApp, getSettings } from "./store.mjs";
import { buildSystemPrompt } from "./prompts.mjs";
import { streamChat } from "./llm.mjs";
import { driverFor } from "./sandboxes.mjs";
import { aggregateTools, callTool } from "./mcp.mjs";
import { getEnabledSkills } from "./skills.mjs";

const MAX_STEPS = 30;

// ---- tool definitions (OpenAI shape; converted for Anthropic) ----
function baseTools(mode, mcpTools) {
  const tools = [];
  const read = [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List files in a directory of the app sandbox. Use path '.' for the project root.",
        parameters: { type: "object", properties: { path: { type: "string", description: "Relative directory path, default '.'" } } },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file from the app sandbox. Returns content or an error.",
        parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path, e.g. src/App.tsx" } }, required: ["path"] },
      },
    },
  ];
  const write = [
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Create or overwrite a file in the app sandbox. ALWAYS write the complete file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
            content: { type: "string", description: "Complete file content" },
            description: { type: "string", description: "Short description of the change" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_replace",
        description: "Replace a unique block of text in a file. Match whole lines.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            search: { type: "string", description: "Exact original text (whole lines)" },
            replace: { type: "string", description: "Replacement text" },
          },
          required: ["path", "search", "replace"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file or directory in the sandbox.",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    },
    {
      type: "function",
      function: {
        name: "rename_file",
        description: "Rename/move a file or directory in the sandbox.",
        parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
      },
    },
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Run a shell command inside the app sandbox (cwd = project root). Use for builds, tests, git, etc. Long commands time out after 120s.",
        parameters: { type: "object", properties: { command: { type: "string" }, timeoutMs: { type: "number" } }, required: ["command"] },
      },
    },
    {
      type: "function",
      function: {
        name: "add_dependency",
        description: "Install npm packages in the sandbox (npm install -S). Separate multiple packages with spaces.",
        parameters: { type: "object", properties: { packages: { type: "string" } }, required: ["packages"] },
      },
    },
    {
      type: "function",
      function: {
        name: "run_type_checks",
        description: "Run TypeScript checks (npx tsc --noEmit) in the sandbox and return errors.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
  const planning = [
    {
      type: "function",
      function: {
        name: "update_todos",
        description: "Track progress on multi-step tasks.",
        parameters: {
          type: "object",
          properties: {
            todos: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["id", "text", "status"] } },
          },
          required: ["todos"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_chat_summary",
        description: "Set a short title for this chat. Call exactly once per turn.",
        parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      },
    },
  ];
  const mcp = [
    {
      type: "function",
      function: {
        name: "list_mcp_tools",
        description: "List available MCP integration tools from connected servers.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "call_mcp_tool",
        description: "Call an MCP integration tool by its exact name (see list_mcp_tools).",
        parameters: {
          type: "object",
          properties: { name: { type: "string" }, arguments: { type: "object", description: "Tool arguments object" } },
          required: ["name"],
        },
      },
    },
  ];
  if (mode === "ask") return [...read];
  tools.push(...read, ...write, ...planning, ...mcp);
  // expose each MCP tool natively too (capped to avoid huge schemas)
  for (const t of (mcpTools || []).slice(0, 40)) {
    tools.push({
      type: "function",
      function: {
        name: t.name,
        description: `[MCP:${t.originServerName}] ${t.description || t.originTool}`.slice(0, 500),
        parameters: sanitizeSchema(t.inputSchema),
      },
    });
  }
  return tools;
}

function sanitizeSchema(s) {
  if (!s || typeof s !== "object") return { type: "object", properties: {} };
  return { type: "object", properties: s.properties || {}, required: Array.isArray(s.required) ? s.required : [] };
}

// ---- dyad tag parsing (compat with build-mode style outputs) ----
export function parseDyadTags(text) {
  const ops = [];
  const pick = (re) => {
    let m;
    while ((m = re.exec(text)) !== null) ops.push(m);
    return ops;
  };
  // writes
  const writeRe = /<dyad-write\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/dyad-write>/g;
  let m;
  while ((m = writeRe.exec(text)) !== null) {
    ops.push({ kind: "write", path: m[1], content: m[2].replace(/^\n/, "").replace(/\n$/, "") });
  }
  const delRe = /<dyad-delete\s+path="([^"]+)"\s*\/?>(?:<\/dyad-delete>)?/g;
  while ((m = delRe.exec(text)) !== null) ops.push({ kind: "delete", path: m[1] });
  const renRe = /<dyad-rename\s+from="([^"]+)"\s+to="([^"]+)"\s*\/?>(?:<\/dyad-rename>)?/g;
  while ((m = renRe.exec(text)) !== null) ops.push({ kind: "rename", from: m[1], to: m[2] });
  const depRe = /<dyad-add-dependency\s+packages="([^"]+)"\s*\/?>(?:<\/dyad-add-dependency>)?/g;
  while ((m = depRe.exec(text)) !== null) ops.push({ kind: "deps", packages: m[1] });
  const sumRe = /<dyad-chat-summary>([\s\S]*?)<\/dyad-chat-summary>/;
  const sm = sumRe.exec(text);
  if (sm) ops.push({ kind: "summary", summary: sm[1].trim().slice(0, 120) });
  const cmdRe = /<dyad-command\s+type="([^"]+)"\s*\/?>(?:<\/dyad-command>)?/g;
  while ((m = cmdRe.exec(text)) !== null) ops.push({ kind: "command", command: m[1] });
  return ops;
}

export function stripDyadTags(text) {
  return text
    .replace(/<dyad-write\s+path="[^"]+"[^>]*>[\s\S]*?<\/dyad-write>/g, "")
    .replace(/<dyad-delete\s+path="[^"]+"\s*\/?>(?:<\/dyad-delete>)?/g, "")
    .replace(/<dyad-rename\s+from="[^"]+"\s+to="[^"]+"\s*\/?>(?:<\/dyad-rename>)?/g, "")
    .replace(/<dyad-add-dependency\s+packages="[^"]+"\s*\/?>(?:<\/dyad-add-dependency>)?/g, "")
    .replace(/<dyad-chat-summary>[\s\S]*?<\/dyad-chat-summary>/g, "")
    .replace(/<dyad-command\s+type="[^"]+"\s*\/?>(?:<\/dyad-command>)?/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

// ---- main loop ----
export async function runAgentTurn({ app, provider, modelId, mode, history, userContent, signal, onEvent }) {
  const emit = (e) => {
    try {
      onEvent && onEvent(e);
    } catch {}
  };
  const driver = driverFor(app);
  const settings = getSettings();
  await driver.keepalive(app.sandboxId, settings.sandboxTimeoutMs).catch(() => {});

  // gather context: AI rules, skills, mcp tools
  let aiRules = null;
  try {
    aiRules = await driver.readFile(app.sandboxId, "AI_RULES.md");
  } catch {}
  const enabledSkills = getEnabledSkills();
  let mcpTools = [];
  try {
    mcpTools = await aggregateTools();
    if (mcpTools.length) emit({ type: "log", stream: "system", text: `MCP: ${mcpTools.length} tools available from connected servers.` });
  } catch (err) {
    emit({ type: "log", stream: "system", text: `MCP aggregation failed: ${err.message}` });
  }

  const system = buildSystemPrompt({ mode, aiRules, enabledSkills, mcpTools });
  const tools = baseTools(mode, mcpTools);

  const messages = [
    ...(history || []).flatMap((m) => {
      if (m.role === "user") return [{ role: "user", content: m.content }];
      if (m.role === "assistant") return [{ role: "assistant", content: m.display || m.content || "" }];
      return [];
    }),
    { role: "user", content: userContent },
  ];

  // Mock provider: scripted offline run (for testing without network/keys)
  if (provider.id === "mock" || provider.type === "mock") {
    return runMockTurn({ app, driver, messages, emit });
  }

  let fullText = "";
  let summary = null;
  let steps = 0;
  const chatMessages = [...messages];

  while (steps < MAX_STEPS) {
    steps += 1;
    emit({ type: "step", n: steps });
    const { text, toolCalls } = await streamChat({
      provider,
      modelId,
      system,
      messages: chatMessages,
      tools,
      signal,
      onToken: (d) => emit({ type: "token", text: d }),
    });
    fullText += (steps > 1 ? "\n" : "") + text;

    if (!toolCalls || toolCalls.length === 0) {
      chatMessages.push({ role: "assistant", content: text });
      break;
    }

    chatMessages.push({
      role: "assistant",
      content: text || "",
      tool_calls: toolCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    });

    for (const call of toolCalls) {
      if (signal?.aborted) throw new Error("aborted");
      emit({ type: "tool_start", id: call.id, name: call.name, args: previewArgs(call.args) });
      const result = await executeTool({ app, driver, mcpTools, name: call.name, args: call.args || {}, emit });
      if (result.summary) summary = result.summary;
      emit({ type: "tool_end", id: call.id, name: call.name, ok: result.ok, output: String(result.output || "").slice(0, 4000) });
      chatMessages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: String(result.output || "").slice(0, 12000) });
    }
  }

  // apply legacy dyad tags if the model emitted any
  const ops = parseDyadTags(fullText);
  for (const op of ops) {
    try {
      if (op.kind === "write") {
        await driver.writeFile(app.sandboxId, op.path, op.content);
        emit({ type: "file", action: "write", path: op.path });
      } else if (op.kind === "delete") {
        await driver.remove(app.sandboxId, op.path);
        emit({ type: "file", action: "delete", path: op.path });
      } else if (op.kind === "rename") {
        await driver.rename(app.sandboxId, op.from, op.to);
        emit({ type: "file", action: "rename", path: `${op.from} → ${op.to}` });
      } else if (op.kind === "deps") {
        emit({ type: "tool_start", id: `tag-deps`, name: "add_dependency", args: op.packages });
        const r = await driver.exec(app.sandboxId, `npm install -S ${op.packages} --no-audit --no-fund`, { timeoutMs: 300_000 });
        emit({ type: "tool_end", id: `tag-deps`, name: "add_dependency", ok: r.exitCode === 0, output: (r.stdout + r.stderr).slice(-2000) });
      } else if (op.kind === "summary") {
        if (!summary) summary = op.summary;
      } else if (op.kind === "command") {
        emit({ type: "command", command: op.command });
      }
    } catch (err) {
      emit({ type: "log", stream: "stderr", text: `dyad-tag ${op.kind} failed: ${err.message}` });
    }
  }

  // local fallback: rebuild static preview after writes
  if (app.sandboxDriver === "local") {
    try {
      await driver.buildStatic(app.sandboxId, emit);
      emit({ type: "command", command: "refresh" });
    } catch (err) {
      emit({ type: "log", stream: "stderr", text: `Preview rebuild failed: ${err.message}` });
    }
  }

  return { text: fullText, display: stripDyadTags(fullText), summary };
}

function previewArgs(args) {
  try {
    const s = JSON.stringify(args);
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  } catch {
    return "";
  }
}

async function executeTool({ app, driver, mcpTools, name, args, emit }) {
  const ok = (output) => ({ ok: true, output });
  const fail = (output) => ({ ok: false, output });
  try {
    switch (name) {
      case "list_files": {
        const entries = await driver.list(app.sandboxId, args.path || ".");
        return ok(entries.map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path || e.name}`).join("\n") || "(empty)");
      }
      case "read_file": {
        const content = await driver.readFile(app.sandboxId, args.path);
        return ok(content.slice(0, 30000));
      }
      case "write_file": {
        await driver.writeFile(app.sandboxId, args.path, args.content || "");
        emit({ type: "file", action: "write", path: args.path });
        return ok(`Wrote ${args.path} (${(args.content || "").length} chars)`);
      }
      case "search_replace": {
        const content = await driver.readFile(app.sandboxId, args.path);
        const occurrences = content.split(args.search).length - 1;
        if (occurrences === 0) return fail(`search text not found in ${args.path}`);
        if (occurrences > 1) return fail(`search text matches ${occurrences} times in ${args.path}; make it unique`);
        await driver.writeFile(app.sandboxId, args.path, content.replace(args.search, args.replace));
        emit({ type: "file", action: "edit", path: args.path });
        return ok(`Edited ${args.path}`);
      }
      case "delete_file": {
        await driver.remove(app.sandboxId, args.path);
        emit({ type: "file", action: "delete", path: args.path });
        return ok(`Deleted ${args.path}`);
      }
      case "rename_file": {
        await driver.rename(app.sandboxId, args.from, args.to);
        emit({ type: "file", action: "rename", path: `${args.from} → ${args.to}` });
        return ok(`Renamed ${args.from} → ${args.to}`);
      }
      case "run_command": {
        const r = await driver.exec(app.sandboxId, args.command, { timeoutMs: Math.min(args.timeoutMs || 120_000, 600_000) });
        emit({ type: "log", stream: "stdout", text: `$ ${args.command}\n${(r.stdout || "").slice(-1500)}${r.stderr ? `\nSTDERR:\n${r.stderr.slice(-1500)}` : ""}` });
        return r.exitCode === 0 ? ok((r.stdout || "(no output)").slice(-6000)) : fail(`exit ${r.exitCode}\n${(r.stdout + "\n" + r.stderr).slice(-6000)}`);
      }
      case "add_dependency": {
        const pkgs = String(args.packages || "").trim();
        if (!pkgs) return fail("No packages specified");
        const r = await driver.exec(app.sandboxId, `npm install -S ${pkgs} --no-audit --no-fund`, { timeoutMs: 300_000 });
        return r.exitCode === 0 ? ok(`Installed ${pkgs}`) : fail(`npm install failed:\n${(r.stdout + r.stderr).slice(-3000)}`);
      }
      case "run_type_checks": {
        const r = await driver.exec(app.sandboxId, "npx -y typescript@5.5.3 tsc --noEmit 2>&1 | head -n 60", { timeoutMs: 240_000 });
        const out = (r.stdout + r.stderr).trim();
        return ok(out ? `Type errors:\n${out}` : "No type errors.");
      }
      case "update_todos": {
        emit({ type: "todos", todos: args.todos || [] });
        return ok("Todos updated.");
      }
      case "set_chat_summary": {
        return { ok: true, output: "Summary set.", summary: String(args.summary || "").slice(0, 120) };
      }
      case "list_mcp_tools": {
        if (!mcpTools || mcpTools.length === 0) return ok("No MCP tools connected. Ask the user to connect servers in Integrations → MCP.");
        return ok(mcpTools.map((t) => `- ${t.name}: ${t.description || ""}`.slice(0, 300)).join("\n"));
      }
      case "call_mcp_tool": {
        const found = (mcpTools || []).find((t) => t.name === args.name || t.originTool === args.name);
        if (!found) return fail(`Unknown MCP tool: ${args.name}. Use list_mcp_tools for exact names.`);
        const res = await callTool(found.originServer, found.originTool, args.arguments || {});
        return ok(formatMcpResult(res).slice(0, 8000));
      }
      default: {
        // native mcp__<server>__<tool> calls
        if (name.startsWith("mcp__")) {
          const found = (mcpTools || []).find((t) => t.name === name);
          if (!found) return fail(`Unknown MCP tool: ${name}`);
          const res = await callTool(found.originServer, found.originTool, args || {});
          return ok(formatMcpResult(res).slice(0, 8000));
        }
        return fail(`Unknown tool: ${name}`);
      }
    }
  } catch (err) {
    return fail(`${name} failed: ${err.message}`);
  }
}

function formatMcpResult(res) {
  if (!res) return "(empty result)";
  if (typeof res === "string") return res;
  const content = res.content;
  if (Array.isArray(content)) {
    return content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
  }
  return JSON.stringify(res);
}

// ---- scripted mock run (offline testing without LLM/E2B network) ----
async function runMockTurn({ app, driver, messages, emit }) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "Hello";
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  emit({ type: "step", n: 1 });
  emit({ type: "token", text: "I'll take a look at the project and make that change. " });
  await tick(200);
  emit({ type: "tool_start", id: "mock1", name: "list_files", args: '{"path":"."}' });
  let listing = "";
  try {
    const entries = await driver.list(app.sandboxId, ".");
    listing = entries.map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path || e.name}`).join("\n");
  } catch (e) {
    listing = `(list failed: ${e.message})`;
  }
  emit({ type: "tool_end", id: "mock1", name: "list_files", ok: true, output: listing.slice(0, 1000) });
  await tick(200);
  emit({ type: "token", text: "\n\nNow I'll update the homepage with your request. " });
  const page = `export default function Index() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <p className="text-xs uppercase tracking-widest text-zinc-500">Mock agent build</p>
        <h1 className="text-4xl font-semibold tracking-tight">Your request is live</h1>
        <p className="text-zinc-400">${String(lastUser).slice(0, 140).replace(/[<>&]/g, "")}</p>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-left text-sm text-zinc-300">
          <p>This page was written by the offline mock agent to verify the full pipeline: chat → tools → sandbox → preview.</p>
        </div>
      </div>
    </div>
  );
}
`;
  emit({ type: "tool_start", id: "mock2", name: "write_file", args: '{"path":"src/pages/Index.tsx"}' });
  try {
    await driver.writeFile(app.sandboxId, "src/pages/Index.tsx", page);
    emit({ type: "file", action: "write", path: "src/pages/Index.tsx" });
    emit({ type: "tool_end", id: "mock2", name: "write_file", ok: true, output: "Wrote src/pages/Index.tsx" });
  } catch (e) {
    emit({ type: "tool_end", id: "mock2", name: "write_file", ok: false, output: String(e.message) });
  }
  await tick(200);
  const text = `I'll take a look at the project and make that change.\n\nNow I'll update the homepage with your request.\n\nDone — I updated \`src/pages/Index.tsx\` with a first version based on your prompt. This was produced by the offline mock agent (used when no LLM is reachable); connect a provider in Settings to use a real model.\n<dyad-chat-summary>Mock homepage update</dyad-chat-summary>`;
  emit({ type: "token", text: "\n\nDone — I updated `src/pages/Index.tsx` with a first version based on your prompt." });
  if (app.sandboxDriver === "local") {
    try {
      await driver.buildStatic(app.sandboxId, emit);
      emit({ type: "command", command: "refresh" });
    } catch (e) {
      emit({ type: "log", stream: "stderr", text: `Preview rebuild failed: ${e.message}` });
    }
  }
  return { text, display: stripDyadTags(text), summary: "Mock homepage update" };
}
