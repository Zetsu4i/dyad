"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronRight,
  File as FileIcon,
  FolderOpen,
  Folder,
  RefreshCw,
  Save,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type FileNode } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-zinc-600">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", css: "css", html: "html", md: "markdown", py: "python",
  sh: "shellscript", yml: "yaml", yaml: "yaml", txt: "plaintext",
};

export function FilesPanel({ appId }: { appId: string }) {
  const { toast } = useToast();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["src", "app"]));
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);

  const loadTree = useCallback(() => {
    api.files(appId)
      .then((r) => setTree(r.tree))
      .catch(() => {})
      .finally(() => setLoadingTree(false));
  }, [appId]);

  useEffect(() => {
    loadTree();
    const handler = () => loadTree();
    window.addEventListener("forge:files-changed", handler);
    return () => window.removeEventListener("forge:files-changed", handler);
  }, [loadTree]);

  const openFile = useCallback(
    async (path: string) => {
      setActiveFile(path);
      setLoadingFile(true);
      try {
        const r = await api.readFile(appId, path);
        setContent(r.content);
        setSavedContent(r.content);
      } catch (err) {
        toast({ title: "Failed to open file", description: err instanceof Error ? err.message : "", variant: "destructive" });
        setActiveFile(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [appId, toast]
  );

  const save = useCallback(async () => {
    if (!activeFile || content === savedContent || saving) return;
    setSaving(true);
    try {
      await api.saveFile(appId, activeFile, content);
      setSavedContent(content);
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [appId, activeFile, content, savedContent, saving, toast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const dirty = content !== savedContent && activeFile !== null;

  return (
    <div className="flex h-full min-h-0">
      {/* File tree */}
      <div className="flex w-56 shrink-0 flex-col border-r border-zinc-800/70">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800/60 px-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Files</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadTree}
            className="h-6 w-6 text-zinc-500 hover:text-zinc-200"
            title="Refresh file tree"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {loadingTree ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
            </div>
          ) : (
            <TreeNode
              nodes={tree}
              expanded={expanded}
              onToggle={(path) =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
              activeFile={activeFile}
              onOpen={openFile}
            />
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800/60 px-3">
          {activeFile ? (
            <>
              <FileIcon className="h-3.5 w-3.5 text-zinc-500" />
              <span className="truncate font-mono text-xs text-zinc-300">{activeFile}</span>
              {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
              <div className="flex-1" />
              <Button
                size="sm"
                onClick={save}
                disabled={!dirty || saving}
                className="h-6 gap-1 bg-zinc-100 px-2.5 text-[11px] font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
            </>
          ) : (
            <span className="text-xs text-zinc-600">Select a file to edit</span>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {activeFile ? (
            <MonacoEditor
              height="100%"
              language={EXT_LANG[activeFile.split(".").pop() ?? ""] ?? "plaintext"}
              value={content}
              onChange={(v) => setContent(v ?? "")}
              theme="forge-dark"
              beforeMount={(monaco) => {
                monaco.editor.defineTheme("forge-dark", {
                  base: "vs-dark",
                  inherit: true,
                  rules: [],
                  colors: {
                    "editor.background": "#09090b",
                    "editor.lineHighlightBackground": "#18181b",
                    "editorLineNumber.foreground": "#52525b",
                    "editorLineNumber.activeForeground": "#a1a1aa",
                    "editorCursor.foreground": "#e4e4e7",
                    "editor.selectionBackground": "#3f3f46",
                    "editorIndentGuide.background1": "#27272a",
                  },
                });
              }}
              options={{
                fontSize: 13,
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                renderLineHighlight: "line",
                padding: { top: 12, bottom: 12 },
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
              }}
              loading={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                </div>
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              {loadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : "No file selected"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNode({
  nodes,
  expanded,
  onToggle,
  activeFile,
  onOpen,
  depth = 0,
}: {
  nodes: FileNode[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  activeFile: string | null;
  onOpen: (path: string) => void;
  depth?: number;
}) {
  return (
    <div>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        return (
          <div key={node.path}>
            {node.type === "dir" ? (
              <button
                onClick={() => onToggle(node.path)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                style={{ paddingLeft: 6 + depth * 12 }}
              >
                <ChevronRight className={cn("h-3 w-3 shrink-0 text-zinc-600 transition-transform", isExpanded && "rotate-90")} />
                {isExpanded ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
            ) : (
              <button
                onClick={() => onOpen(node.path)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs",
                  activeFile === node.path
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                )}
                style={{ paddingLeft: 6 + depth * 12 }}
              >
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                <span className="truncate">{node.name}</span>
              </button>
            )}
            {node.type === "dir" && isExpanded && node.children && (
              <TreeNode
                nodes={node.children}
                expanded={expanded}
                onToggle={onToggle}
                activeFile={activeFile}
                onOpen={onOpen}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
