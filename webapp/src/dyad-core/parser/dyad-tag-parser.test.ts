import { describe, expect, it } from "vitest";
import {
  getDyadAddDependencyTags,
  getDyadChatSummaryTag,
  getDyadCommandTags,
  getDyadDeleteTags,
  getDyadRenameTags,
  getDyadWriteTags,
} from "./dyad-tag-parser";

/** Behavioral checks for the ported dyad-tag parser. */

describe("dyad tag parser (ported from Dyad)", () => {
  it("extracts write tags with paths, descriptions, unescaped content", () => {
    const res = getDyadWriteTags(
      `<dyad-write path="src/a\\b.ts" description="does &quot;stuff&quot;">\nconst x = 1 &amp; 2;\n</dyad-write>`,
    );
    expect(res).toHaveLength(1);
    expect(res[0].path).toBe("src/a/b.ts"); // backslashes normalized to slashes
    expect(res[0].description).toBe('does "stuff"');
    expect(res[0].content).toBe("const x = 1 & 2;");
  });

  it("extracts renames, deletes, dependencies, commands, summary", () => {
    const src = `
<dyad-rename from="a.ts" to="b.ts"></dyad-rename>
<dyad-delete path="c.ts"></dyad-delete>
<dyad-add-dependency packages="react-hot-toast lodash"></dyad-add-dependency>
<dyad-command type="restart"></dyad-command>
<dyad-chat-summary>Renaming profile file</dyad-chat-summary>`;
    expect(getDyadRenameTags(src)).toEqual([{ from: "a.ts", to: "b.ts" }]);
    expect(getDyadDeleteTags(src)).toEqual(["c.ts"]);
    expect(getDyadAddDependencyTags(src)).toEqual(["react-hot-toast", "lodash"]);
    expect(getDyadCommandTags(src)).toEqual(["restart"]);
    expect(getDyadChatSummaryTag(src)).toBe("Renaming profile file");
  });

  it("tolerates multiple write blocks in one response", () => {
    const src =
      `<dyad-write path="a.ts">A</dyad-write>\n` +
      `middle text\n` +
      `<dyad-write path="b.ts" description="B">B</dyad-write>`;
    const res = getDyadWriteTags(src);
    expect(res.map((r) => r.path)).toEqual(["a.ts", "b.ts"]);
    expect(res[1].description).toBe("B");
  });
});
