"use client";

import { useState } from "react";
import { RefreshCw, ExternalLink, Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  previewUrl: string | null;
  previewKey: number;
  onRefresh: () => void;
}

export function PreviewPanel({ previewUrl, previewKey, onRefresh }: Props) {
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [loading, setLoading] = useState(true);

  const width =
    device === "desktop" ? "100%" : device === "tablet" ? "768px" : "390px";

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {/* Preview toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800/60 px-3">
        <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-900">
          <DeviceButton active={device === "desktop"} onClick={() => setDevice("desktop")}>
            <Monitor className="h-3.5 w-3.5" />
          </DeviceButton>
          <DeviceButton active={device === "tablet"} onClick={() => setDevice("tablet")}>
            <Tablet className="h-3.5 w-3.5" />
          </DeviceButton>
          <DeviceButton active={device === "mobile"} onClick={() => setDevice("mobile")}>
            <Smartphone className="h-3.5 w-3.5" />
          </DeviceButton>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", previewUrl ? "bg-emerald-500" : "bg-zinc-600")} />
          <span className="truncate font-mono text-[11px] text-zinc-500">
            {previewUrl ? previewUrl.replace("https://", "") : "waiting for sandbox…"}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
          title="Refresh preview"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        {previewUrl && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.open(previewUrl, "_blank")}
            className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Preview frame */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-zinc-950 p-3">
        {!previewUrl ? (
          <div className="flex flex-col items-center text-zinc-600">
            <Loader2 className="mb-2 h-5 w-5 animate-spin" />
            <span className="text-xs">Starting dev server…</span>
          </div>
        ) : (
          <div
            className="relative h-full overflow-hidden rounded-lg border border-zinc-800 bg-white transition-all"
            style={{ width, maxWidth: "100%" }}
          >
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
              </div>
            )}
            <iframe
              key={previewKey}
              src={previewUrl}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => setLoading(false)}
              title="App preview"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-6 w-7 items-center justify-center first:rounded-l-md last:rounded-r-md",
        active ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
      )}
    >
      {children}
    </button>
  );
}
