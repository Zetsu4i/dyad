"use client";

import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileEdit,
  FilePlus2,
  FileX2,
  FolderSync,
  Package,
  Wrench,
  RefreshCw,
  RotateCw,
  ChevronsLeftRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  parseFullMessage,
  type Block,
} from "@/dyad-core/parser/streaming-message-parser";

/**
 * Chat message renderer — identical block model to Dyad's: the ported
 * incremental parser splits a message into markdown and dyad custom-tag
 * blocks; each custom tag renders as a card (file write, dependency,
 * command, MCP tool call…).
 */

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="dyad-md text-sm leading-relaxed text-zinc-300 [&_a]:text-indigo-300 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-700 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-400 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-zinc-300 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3]:text-zinc-200 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-3 [&_strong]:text-zinc-100 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function FileWriteCard({
  path,
  description,
  content,
  streaming,
}: {
  path: string;
  description?: string;
  content: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lines = content.split("\n").length;
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <FileEdit className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <span className="truncate font-mono text-xs text-zinc-200">{path}</span>
        {streaming ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        ) : (
          <span className="rounded border border-zinc-700/70 px-1 text-[10px] text-zinc-500">
            {lines} lines
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {description ? (
            <span className="hidden truncate text-2xs text-zinc-500 sm:inline" title={description}>
              {description}
            </span>
          ) : null}
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </span>
      </div>
      {open ? (
        <pre className="max-h-80 overflow-auto border-t border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs leading-relaxed text-zinc-300">
          {content}
        </pre>
      ) : null}
    </div>
  );
}

function McpCard({
  kind,
  server,
  tool,
  content,
}: {
  kind: "call" | "result";
  server: string;
  tool: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench className={`h-3.5 w-3.5 shrink-0 ${kind === "call" ? "text-sky-400" : "text-emerald-400"}`} />
        <span className="text-xs text-zinc-300">
          <span className="text-zinc-500">{kind === "call" ? "Calling" : "Result from"}</span>{" "}
          <span className="font-medium text-zinc-200">{tool}</span>
          <span className="text-zinc-500"> · {server}</span>
        </span>
        <span className="ml-auto text-zinc-600">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/70 p-2 font-mono text-2xs leading-relaxed text-zinc-400">
          {content}
        </pre>
      ) : null}
    </div>
  );
}

function CommandChips({ commands }: { commands: string[] }) {
  const icons: Record<string, React.ReactNode> = {
    rebuild: <FolderSync className="h-3 w-3" />,
    restart: <RotateCw className="h-3 w-3" />,
    refresh: <RefreshCw className="h-3 w-3" />,
  };
  return (
    <span className="my-1 inline-flex flex-wrap gap-1">
      {commands.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900 px-2 py-0.5 text-2xs text-zinc-400"
        >
          {icons[c] ?? <ChevronsLeftRight className="h-3 w-3" />} {c}
        </span>
      ))}
    </span>
  );
}

const TagBlock = memo(function TagBlock({
  block,
  streaming,
}: {
  block: Extract<Block, { kind: "custom-tag" }>;
  streaming: boolean;
}) {
  const { tag, attributes, content } = block;
  switch (tag) {
    case "dyad-write":
      return (
        <FileWriteCard
          path={attributes.path ?? "file"}
          description={attributes.description}
          content={content}
          streaming={streaming && !block.complete}
        />
      );
    case "dyad-rename":
      return (
        <div className="my-1.5 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
          <FileEdit className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-mono">{attributes.from}</span>
          <span className="text-zinc-600">→</span>
          <span className="font-mono">{attributes.to}</span>
        </div>
      );
    case "dyad-delete":
      return (
        <div className="my-1.5 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
          <FileX2 className="h-3.5 w-3.5 text-red-400" />
          <span className="font-mono text-zinc-300 line-through">{attributes.path}</span>
        </div>
      );
    case "dyad-add-dependency":
      return (
        <div className="my-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <Package className="h-3.5 w-3.5 text-emerald-400" />
          {(attributes.packages ?? "").split(/\s+/).filter(Boolean).map((p) => (
            <span key={p} className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-2xs text-emerald-300">
              {p}
            </span>
          ))}
        </div>
      );
    case "dyad-command": {
      if (!block.complete) return null;
      return <CommandChips commands={[attributes.type ?? "refresh"]} />;
    }
    case "dyad-chat-summary":
      return null; // rendered as the chat title, not inline
    case "dyad-mcp-tool-call":
      return (
        <McpCard kind="call" server={attributes.server ?? ""} tool={attributes.tool ?? ""} content={content} />
      );
    case "dyad-mcp-tool-result":
      return (
        <McpCard kind="result" server={attributes.server ?? ""} tool={attributes.tool ?? ""} content={content} />
      );
    case "think":
      return null; // hide raw thinking tags
    case "dyad-output": {
      const variant = attributes.type;
      return (
        <div
          className={`my-1.5 rounded-lg border px-3 py-2 text-xs ${
            variant === "error"
              ? "border-red-500/25 bg-red-500/10 text-red-300"
              : "border-amber-500/25 bg-amber-500/10 text-amber-300"
          }`}
        >
          {attributes.message ? <span className="font-medium">{attributes.message}: </span> : null}
          {content}
        </div>
      );
    }
    default:
      // Unknown dyad tags render as muted code (same as upstream's fallback).
      return (
        <div className="my-1.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-2xs text-zinc-600">
          &lt;{tag}&gt;
        </div>
      );
  }
});

export function MessageBlocks({ content }: { content: string }) {
  const blocks = useMemo(() => parseFullMessage(content).blocks, [content]);
  return (
    <div>
      {blocks.map((block) =>
        block.kind === "markdown" ? (
          block.content.trim() ? (
            <MarkdownBlock key={block.id} content={block.content} />
          ) : null
        ) : (
          <TagBlock key={block.id} block={block} streaming={false} />
        ),
      )}
    </div>
  );
}
