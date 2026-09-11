/**
 * Line-based search/replace with cascading fuzzy matching.
 * PORTED FROM DYAD: src/pro/main/ipc/processors/search_replace_processor.ts
 *
 * Matching passes (decreasing strictness):
 *   1. Exact
 *   2. Trailing whitespace ignored
 *   3. All edge whitespace ignored
 *   4. Unicode normalization (smart quotes/dashes/nbsp → ASCII)
 * The pattern must match exactly ONE region of the file per pass.
 */

export class SearchReplaceError extends Error {}

type LineComparator = (fileLine: string, patternLine: string) => boolean;

const exactMatch: LineComparator = (a, b) => a === b;
const trailingWhitespaceIgnored: LineComparator = (a, b) => a.trimEnd() === b.trimEnd();
const allEdgeWhitespaceIgnored: LineComparator = (a, b) => a.trim() === b.trim();

function normalizeString(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u00A0/g, " ")
    .trim();
}

const unicodeNormalized: LineComparator = (a, b) => normalizeString(a) === normalizeString(b);

const MATCHING_PASSES: { name: string; comparator: LineComparator }[] = [
  { name: "exact", comparator: exactMatch },
  { name: "trailing-whitespace-ignored", comparator: trailingWhitespaceIgnored },
  { name: "all-edge-whitespace-ignored", comparator: allEdgeWhitespaceIgnored },
  { name: "unicode-normalized", comparator: unicodeNormalized },
];

function trimEmptyLines(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result[0] === "") result.shift();
  while (result.length > 0 && result[result.length - 1] === "") result.pop();
  return result;
}

export function applySearchReplace(original: string, oldString: string, newString: string): string {
  if (oldString === newString) {
    throw new SearchReplaceError("old_string and new_string must be different");
  }
  if (oldString.trim() === "") {
    throw new SearchReplaceError("old_string cannot be empty. Use write_file to create a new file.");
  }

  const fileLines = original.split("\n");
  const searchLines = trimEmptyLines(oldString.split("\n"));
  const replaceLinesRaw = newString.split("\n");

  // Mirror edge empty lines that had to be trimmed from the search block back
  // onto the replace block (ported behavior).
  const originalSearchLines = oldString.split("\n");
  let leadingTrimmed = 0;
  while (leadingTrimmed < originalSearchLines.length && originalSearchLines[leadingTrimmed] === "") {
    leadingTrimmed++;
  }
  const trailingTrimmed = originalSearchLines.length - searchLines.length - leadingTrimmed;
  const replaceLines = [...replaceLinesRaw];
  for (let i = 0; i < trailingTrimmed; i++) {
    if (replaceLines.length === 0 || replaceLines[replaceLines.length - 1] !== "") break;
    replaceLines.pop();
  }
  for (let i = 0; i < leadingTrimmed; i++) {
    if (replaceLines.length === 0 || replaceLines[0] !== "") break;
    replaceLines.shift();
  }

  for (const pass of MATCHING_PASSES) {
    const matches: number[] = [];
    for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
      let ok = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (!pass.comparator(fileLines[i + j], searchLines[j])) {
          ok = false;
          break;
        }
      }
      if (ok) matches.push(i);
    }

    if (matches.length === 1) {
      const at = matches[0];
      const before = fileLines.slice(0, at);
      const after = fileLines.slice(at + searchLines.length);
      return [...before, ...replaceLines, ...after].join("\n");
    }
    if (matches.length > 1) {
      const lineNums = matches.map((m) => `${m + 1}`).join(", ");
      throw new SearchReplaceError(
        `Found ${matches.length} matches for the search block (lines ${lineNums}). The search block must be unique — include more surrounding lines in old_string.`,
      );
    }
    // zero matches → try the next, laxer pass
  }

  // All passes failed — build a helpful diagnostic (closest pass).
  let bestPass = MATCHING_PASSES[0];
  let bestMatches = 0;
  for (const pass of MATCHING_PASSES) {
    let count = 0;
    for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
      let ok = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (!pass.comparator(fileLines[i + j], searchLines[j])) {
          ok = false;
          break;
        }
      }
      if (ok) count++;
    }
    if (count > bestMatches) {
      bestMatches = count;
      bestPass = pass;
    }
  }
  throw new SearchReplaceError(
    `Search block not found in file (closest pass "${bestPass.name}" matched ${bestMatches} region(s)). Re-read the file with read_file and copy the exact lines, including indentation, into old_string.`,
  );
}
