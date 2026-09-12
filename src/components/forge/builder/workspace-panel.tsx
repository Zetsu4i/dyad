"use client";

import { useEffect, useState } from "react";
import { Eye, FolderCode, TerminalSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PreviewPanel } from "./preview-panel";
import { FilesPanel } from "./files-panel";
import { TerminalPanel } from "./terminal-panel";
import { cn } from "@/lib/utils";

interface Props {
  appId: string;
  previewUrl: string | null;
  previewKey: number;
  onRefreshPreview: () => void;
}

export function WorkspacePanel({ appId, previewUrl, previewKey, onRefreshPreview }: Props) {
  const [tab, setTab] = useState("preview");
  const [filesDirty, setFilesDirty] = useState(0);

  useEffect(() => {
    const handler = () => setFilesDirty((n) => n + 1);
    window.addEventListener("forge:files-changed", handler);
    return () => window.removeEventListener("forge:files-changed", handler);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b border-zinc-800/80 px-2">
          <TabsList className="h-8 bg-transparent p-0">
            <TabsTrigger
              value="preview"
              className="h-8 gap-1.5 rounded-md px-3 text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="h-8 gap-1.5 rounded-md px-3 text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
            >
              <FolderCode className="h-3.5 w-3.5" />
              Files
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              className="h-8 gap-1.5 rounded-md px-3 text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              Terminal
            </TabsTrigger>
          </TabsList>
          {filesDirty > 0 && tab !== "files" && (
            <span className="ml-2 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {filesDirty} update{filesDirty > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <TabsContent value="preview" className="mt-0 min-h-0 flex-1">
          <PreviewPanel previewUrl={previewUrl} previewKey={previewKey} onRefresh={onRefreshPreview} />
        </TabsContent>
        <TabsContent value="files" className="mt-0 min-h-0 flex-1">
          <FilesPanel appId={appId} />
        </TabsContent>
        <TabsContent value="terminal" className="mt-0 min-h-0 flex-1">
          <TerminalPanel appId={appId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
