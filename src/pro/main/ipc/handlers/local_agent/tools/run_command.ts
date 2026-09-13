import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import {
  hasRunningE2bSandboxForApp,
  isE2bRuntimeModeActive,
  runE2bCommandForApp,
} from "@/ipc/utils/e2b_sandbox_provider";
import { syncCloudSandboxDirtyPaths } from "@/ipc/utils/cloud_sandbox_provider";
import { trackAppMutation } from "./tool_invocation";

const MAX_OUTPUT_LENGTH = 6000;

const runCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "The shell command to execute inside the project's E2B sandbox. Runs with /home/user/app as the working directory. Commands may be chained with && or ;.",
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .describe(
      "Optional timeout in milliseconds (default 120000, max 600000). Use a larger value for long-running tasks like heavy builds.",
    ),
});

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  const head = output.slice(0, MAX_OUTPUT_LENGTH / 2);
  const tail = output.slice(-MAX_OUTPUT_LENGTH / 2);
  return `${head}\n... [output truncated, ${output.length} characters total] ...\n${tail}`;
}

export function isRunCommandToolAvailable(_ctx: AgentContext): boolean {
  // The tool only exists when the app's execution environment is an E2B
  // sandbox with a live session. Host/Docker/Engine-cloud modes keep their
  // existing tool behavior untouched.
  return isE2bRuntimeModeActive() && hasRunningE2bSandboxForApp(_ctx.appId);
}

/**
 * App-id variant used by prompt construction before an AgentContext exists.
 */
export function isRunCommandToolAvailableForApp(
  appId: number | null | undefined,
): boolean {
  if (appId == null) {
    return false;
  }
  return isE2bRuntimeModeActive() && hasRunningE2bSandboxForApp(appId);
}

export const runCommandTool: ToolDefinition<z.infer<typeof runCommandSchema>> =
  {
    name: "run_command",
    description:
      "Run a shell command inside the project's remote E2B sandbox (working directory /home/user/app). Use for general-purpose execution: scripts, CLI tools, data processing, file operations, package installation, builds, and any task that needs a real Linux environment. The project's files are synced to /home/user/app before the command runs.",
    inputSchema: runCommandSchema,
    defaultConsent: "ask",
    modifiesState: true,
    mutationTracking: "internal",

    isEnabled: (ctx) => isRunCommandToolAvailable(ctx),

    getConsentPreview: (args) => `Run in sandbox: ${args.command}`,

    shouldTrackMutation: (_args, result) =>
      result.startsWith("Command succeeded (exit code 0"),

    buildXml: (args, _isComplete) => {
      if (!args.command) return undefined;
      return `<dyad-run-command command="${escapeXmlAttr(
        args.command.slice(0, 500),
      )}"></dyad-run-command>`;
    },

    execute: async (args, ctx: AgentContext) => {
      // Make sure pending local file edits (write_file / search_replace) have
      // been uploaded before the command inspects or builds them.
      await syncCloudSandboxDirtyPaths({ appId: ctx.appId });

      const result = await runE2bCommandForApp(
        ctx.appId,
        args.command,
        args.timeoutMs ?? 120_000,
      );

      const stdout = truncateOutput(result.stdout);
      const stderr = truncateOutput(result.stderr);
      const parts: string[] = [];
      if (stdout.trim().length > 0) {
        parts.push(`stdout:\n${stdout}`);
      }
      if (stderr.trim().length > 0) {
        parts.push(`stderr:\n${stderr}`);
      }
      const output = parts.length > 0 ? parts.join("\n\n") : "(no output)";

      if (result.exitCode === 0) {
        trackAppMutation(ctx, "run_command", true, false);
        return `Command succeeded (exit code 0).\n\n${output}`;
      }
      return `Command failed with exit code ${result.exitCode}.\n\n${output}`;
    },
  };
