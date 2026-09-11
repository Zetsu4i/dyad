import {
  getDyadWriteTags,
  getDyadRenameTags,
  getDyadDeleteTags,
  getDyadAddDependencyTags,
  getDyadChatSummaryTag,
  getDyadCommandTags,
} from "@/dyad-core/parser/dyad-tag-parser";

/**
 * Response processing — extracts the actions a completed assistant response
 * asks for. Parsers are the verbatim Dyad ones (dyad-core), so the protocol
 * behaves identically to upstream.
 */

export interface ChatTurnAnnotations {
  writes: { path: string; content: string; description?: string }[];
  renames: { from: string; to: string }[];
  deletes: string[];
  addDependency: string[];
  commands: string[];
  summary: string | null;
}

export function extractAnnotations(fullResponse: string): ChatTurnAnnotations {
  return {
    writes: getDyadWriteTags(fullResponse),
    renames: getDyadRenameTags(fullResponse),
    deletes: getDyadDeleteTags(fullResponse),
    addDependency: getDyadAddDependencyTags(fullResponse),
    commands: getDyadCommandTags(fullResponse),
    summary: getDyadChatSummaryTag(fullResponse),
  };
}

/** Strip the dyad-chat-summary title from user-facing markdown. */
export function stripSummaryTag(text: string): string {
  return text.replace(
    /<dyad-chat-summary>[\s\S]*?<\/dyad-chat-summary>/g,
    "",
  );
}
