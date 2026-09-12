import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { ipc } from "@/ipc/types";
import { previewPortOverrideAtom } from "@/atoms/previewAtoms";
import { useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

export interface SandboxPort {
  port: number;
  process: string | null;
}

interface OpenPortsState {
  sandboxId: string;
  previewBase: string | null;
  ports: SandboxPort[];
}

/**
 * Polls the app's sandbox for ALL listening ports so the preview URL bar can
 * offer a dropdown of every live port (web dev server, API server, storybook,
 * etc). Polling is lightweight — one shell command in the sandbox.
 */
export function useAppOpenPorts(
  appId: number | null,
  enabled: boolean,
): { ports: SandboxPort[]; sandboxId: string } {
  const [state, setState] = useState<OpenPortsState>({
    sandboxId: "",
    previewBase: null,
    ports: [],
  });

  useEffect(() => {
    if (appId === null || !enabled) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const result = await ipc.app.getAppOpenPorts({ appId });
        if (!cancelled) {
          setState({
            sandboxId: result.sandboxId,
            previewBase: result.previewBase,
            ports: result.ports,
          });
        }
      } catch {
        /* sandbox may be between states — retry silently */
      }
      if (!cancelled) {
        timer = setTimeout(poll, 5000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, enabled]);

  return { ports: state.ports, sandboxId: state.sandboxId };
}

/**
 * Applies the user's port selection to an app URL: swaps the origin to
 * `https://{port}-{sandboxId}.e2b.app` for E2B-hosted previews.
 */
export function applyPortOverride(
  appUrl: string | null,
  sandboxId: string,
  port: number | null,
): string | null {
  if (!appUrl || port === null || !sandboxId) return appUrl;
  try {
    const url = new URL(appUrl);
    // Only rewrite E2B public preview hosts ({port}-{sandboxId}.e2b.app).
    if (!url.hostname.endsWith(".e2b.app") || !url.hostname.includes(`-${sandboxId}`)) {
      return appUrl;
    }
    url.host = `${port}-${sandboxId}.e2b.app`;
    return url.toString();
  } catch {
    return appUrl;
  }
}

/** Convenience: current port override for the selected app. */
export function useSelectedPortOverride(): {
  selectedPort: number | null;
  setPort: (appId: number, port: number | null) => void;
  clearPort: (appId: number) => void;
} {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const overrides = useAtomValue(previewPortOverrideAtom);
  const setOverrides = useSetAtom(previewPortOverrideAtom);

  const selectedPort =
    selectedAppId !== null ? (overrides[selectedAppId] ?? null) : null;

  const setPort = (appId: number, port: number | null) => {
    setOverrides((prev) => ({ ...prev, [appId]: port }));
  };
  const clearPort = (appId: number) => {
    setOverrides((prev) => ({ ...prev, [appId]: null }));
  };

  return { selectedPort, setPort, clearPort };
}
