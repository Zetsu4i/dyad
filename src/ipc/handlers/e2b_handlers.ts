import { Sandbox } from "e2b";
import { createTypedHandler } from "./base";
import { e2bContracts } from "../types/e2b";
import { readSettings } from "../../main/settings";
import {
  hasRunningE2bSandboxForApp,
  runE2bCommandForApp,
  isE2bRuntimeModeActive,
} from "../utils/e2b_sandbox_provider";
import { runningApps } from "../utils/process_manager";
import { syncCloudSandboxDirtyPaths } from "../utils/cloud_sandbox_provider";

/**
 * Validates a candidate E2B API key by listing the account's sandboxes.
 * Never logs the key itself.
 */
export async function validateE2bApiKey(
  apiKey: string,
): Promise<{ valid: boolean; error?: string; sandboxCount?: number }> {
  try {
    const paginator = Sandbox.list({ apiKey });
    let count = 0;
    while (paginator.hasNext) {
      const page = await paginator.nextItems();
      count += page.length;
    }
    return { valid: true, sandboxCount: count };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return { valid: false, error: message };
  }
}

export function registerE2bHandlers() {
  // Handlers never log args (API keys / commands stay out of logs).

  createTypedHandler(
    e2bContracts.validateApiKey,
    async (_event, { apiKey }) => {
      return validateE2bApiKey(apiKey);
    },
  );

  createTypedHandler(e2bContracts.runCommand, async (_event, params) => {
    if (!isE2bRuntimeModeActive()) {
      throw new Error(
        "E2B commands require the E2B runtime mode (Settings → General → Runtime Mode).",
      );
    }
    if (!hasRunningE2bSandboxForApp(params.appId)) {
      throw new Error(
        "This app has no running E2B sandbox. Start the app preview first.",
      );
    }
    // Flush any pending file syncs so the command sees the latest local edits.
    await syncCloudSandboxDirtyPaths({ appId: params.appId });
    return runE2bCommandForApp(
      params.appId,
      params.command,
      params.timeoutMs ?? 120_000,
    );
  });

  createTypedHandler(e2bContracts.getSandboxState, async (_event, params) => {
    const settings = readSettings();
    const runtimeMode = settings.runtimeMode2 ?? "host";
    const appInfo = runningApps.get(params.appId);
    const attached = hasRunningE2bSandboxForApp(params.appId);
    const result = {
      attached,
      runtimeMode,
      sandboxId: appInfo?.cloudSandboxId ?? null,
      previewUrl: appInfo?.cloudPreviewUrl ?? null,
    } as {
      attached: boolean;
      runtimeMode: "host" | "docker" | "cloud" | "e2b";
      sandboxId: string | null;
      state?:
        | "starting"
        | "running"
        | "restoring"
        | "saving"
        | "stopping"
        | "stopped"
        | "paused"
        | "failed"
        | null;
      previewUrl?: string | null;
      lastError?: string | null;
    };
    if (!attached) {
      result.state = appInfo ? "failed" : "stopped";
      return result;
    }
    result.state = appInfo?.proxyUrl ? "running" : "starting";
    return result;
  });
}
