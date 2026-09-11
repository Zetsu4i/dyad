import { describe, expect, it } from "vitest";
import {
  advanceParser,
  getOpenBlock,
  getParserBlocks,
  initialParserState,
  parseFullMessage,
} from "./streaming-message-parser";
import { getDyadWriteTags } from "./dyad-tag-parser";

/**
 * Focused port of Dyad's streamingMessageParser tests (upstream:
 * src/chat_stream/streamingMessageParser.test.ts) — the cases that define the
 * wire protocol behavior Dyad Cloud depends on.
 */

function parseAll(content: string) {
  let state = initialParserState();
  // advanceParser consumes from `content` using its internal cursor, so each
  // call receives the full text so far (matches upstream usage).
  const step = 7;
  for (let i = step; i <= content.length + step; i += step) {
    state = advanceParser(state, content.slice(0, i));
  }
  return getParserBlocks(state);
}

describe("streaming message parser (ported from Dyad)", () => {
  it("parses plain markdown", () => {
    const blocks = parseAll("Hello **world**");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("markdown");
    expect((blocks[0] as { content: string }).content).toBe("Hello **world**");
  });

  it("parses a complete dyad-write block", () => {
    const src = `Here you go:\n<dyad-write path="src/App.tsx" description="update">\nconsole.log(1);\n</dyad-write>\nDone!`;
    const blocks = parseAll(src);
    const tags = blocks.filter((b) => b.kind === "custom-tag");
    expect(tags).toHaveLength(1);
    const tag = tags[0] as Extract<(typeof blocks)[number], { kind: "custom-tag" }>;
    expect(tag.tag).toBe("dyad-write");
    expect(tag.attributes.path).toBe("src/App.tsx");
    expect(tag.attributes.description).toBe("update");
    expect(tag.content.trim()).toBe("console.log(1);");
    expect(tag.complete).toBe(true);
    // markdown preserved around it
    expect((blocks[0] as { content: string }).content).toContain("Here you go:");
  });

  it("handles an in-progress (unclosed) dyad-write while streaming", () => {
    let state = initialParserState();
    const snapshots = [
      "<dyad-write path=\"a.ts\">",
      "<dyad-write path=\"a.ts\">const x = 1;",
      "<dyad-write path=\"a.ts\">const x = 1;\nconst y = 2;",
    ];
    for (const c of snapshots) state = advanceParser(state, c);
    const open = getOpenBlock(state);
    expect(open).not.toBeNull();
    if (open?.kind === "custom-tag") {
      expect(open.tag).toBe("dyad-write");
      expect(open.complete).toBe(false);
      expect(open.content).toContain("const y = 2;");
    } else {
      throw new Error("expected open custom tag");
    }
  });

  it("does not treat regular HTML-ish text as dyad tags", () => {
    const blocks = parseAll("use <div> elements and <stdio> pipes");
    const custom = blocks.filter((b) => b.kind === "custom-tag");
    expect(custom).toHaveLength(0);
  });

  it("parses add-dependency, rename, delete, command, summary tags", () => {
    const src = [
      '<dyad-add-dependency packages="left-pad right-pad"></dyad-add-dependency>',
      '<dyad-rename from="a.ts" to="b.ts"></dyad-rename>',
      '<dyad-delete path="c.ts"></dyad-delete>',
      '<dyad-command type="rebuild"></dyad-command>',
      "<dyad-chat-summary>My title</dyad-chat-summary>",
    ].join("\n");
    const blocks = parseFullMessage(src).blocks;
    const tags = blocks.filter((b) => b.kind === "custom-tag") as Extract<
      (typeof blocks)[number],
      { kind: "custom-tag" }
    >[];
    expect(tags.map((t) => t.tag)).toEqual([
      "dyad-add-dependency",
      "dyad-rename",
      "dyad-delete",
      "dyad-command",
      "dyad-chat-summary",
    ]);
    expect(tags[0].attributes.packages).toBe("left-pad right-pad");
    expect(tags[1].attributes.to).toBe("b.ts");
    expect(tags[3].attributes.type).toBe("rebuild");
    expect(tags[4].content.trim()).toBe("My title");
  });

  it("unescapes XML entities in file contents", () => {
    const src = `<dyad-write path="x.ts">\nconst s = "a &amp; b &lt;tag&gt;";\n</dyad-write>`;
    const blocks = parseFullMessage(src).blocks;
    const tag = blocks.find((b) => b.kind === "custom-tag") as Extract<
      (typeof blocks)[number],
      { kind: "custom-tag" }
    >;
    expect(tag.content).toContain(`a & b <tag>`);
  });
});
