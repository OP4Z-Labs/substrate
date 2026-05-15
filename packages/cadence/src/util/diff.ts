/**
 * Tiny line-based diff helper for the v0.5 `cadence upgrade` UX.
 *
 * Why hand-rolled instead of a dep:
 *
 *   - Cadence's deps are kept minimal (commander / kleur / inquirer / yaml).
 *     Pulling in `diff` or `jsdiff` for one screen of upgrade output is
 *     gratuitous; we only need a "what changed" view, not patch-application.
 *   - Output is for human eyes (the user picks keep / take-new / merge / eject
 *     after reading the diff). Anything more sophisticated than line-by-line
 *     Myers-ish output is wasted on a 200-line markdown file.
 *
 * Algorithm: longest-common-subsequence on lines, then walk it to emit
 * unified-diff-shaped hunks. This is the classic Myers diff approach,
 * compressed to ~50 lines. For Cadence's use case (small markdown files,
 * usually < 500 lines) the O(n*m) memory cost is irrelevant.
 *
 * Output format mirrors `git diff --unified=3`:
 *   `@@ -a,b +c,d @@`
 *   `-removed line`
 *   `+added line`
 *   ` context line`
 */

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  /** True if the two inputs are character-identical (no diff). */
  identical: boolean;
}

const CONTEXT_LINES = 3;

export function diffLines(oldText: string, newText: string): DiffResult {
  if (oldText === newText) {
    return { hunks: [], identical: true };
  }
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const edits = buildEdits(oldLines, newLines, lcs);
  const hunks = collectHunks(edits);
  return { hunks, identical: false };
}

/**
 * Pretty-print a DiffResult as a unified-diff string. Used by
 * `cadence upgrade --check` to show drift to the user.
 */
export function formatUnifiedDiff(diff: DiffResult): string {
  if (diff.identical) return "";
  const out: string[] = [];
  for (const hunk of diff.hunks) {
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    );
    out.push(...hunk.lines);
  }
  return out.join("\n");
}

// --- Internals --------------------------------------------------------------

type Edit =
  | { kind: "context"; line: string }
  | { kind: "add"; line: string }
  | { kind: "remove"; line: string };

function longestCommonSubsequence(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }
  return table;
}

function buildEdits(a: string[], b: string[], table: number[][]): Edit[] {
  const edits: Edit[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.unshift({ kind: "context", line: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      edits.unshift({ kind: "add", line: b[j - 1] });
      j -= 1;
    } else {
      edits.unshift({ kind: "remove", line: a[i - 1] });
      i -= 1;
    }
  }
  return edits;
}

function collectHunks(edits: Edit[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let i = 0;
  while (i < edits.length) {
    if (edits[i].kind === "context") {
      oldLine += 1;
      newLine += 1;
      i += 1;
      continue;
    }
    // Found a change run — backtrack up to CONTEXT_LINES of leading context,
    // then sweep forward until we've consumed CONTEXT_LINES of trailing
    // context with no further changes.
    const startContext = Math.min(CONTEXT_LINES, leadingContext(edits, i));
    const hunkStart = i - startContext;
    let hunkEnd = i;
    while (hunkEnd < edits.length) {
      if (edits[hunkEnd].kind !== "context") {
        hunkEnd += 1;
        continue;
      }
      // Look ahead for the next change within CONTEXT_LINES * 2 lines —
      // if one exists, keep extending the hunk (avoids tiny adjacent hunks).
      let lookahead = 0;
      while (
        hunkEnd + lookahead < edits.length &&
        edits[hunkEnd + lookahead].kind === "context" &&
        lookahead < CONTEXT_LINES * 2
      ) {
        lookahead += 1;
      }
      if (
        hunkEnd + lookahead < edits.length &&
        edits[hunkEnd + lookahead].kind !== "context"
      ) {
        hunkEnd += lookahead;
        continue;
      }
      // No more changes in range — close out with up to CONTEXT_LINES
      // of trailing context.
      hunkEnd += Math.min(CONTEXT_LINES, edits.length - hunkEnd);
      break;
    }
    const slice = edits.slice(hunkStart, hunkEnd);
    const oldCount = slice.filter((e) => e.kind !== "add").length;
    const newCount = slice.filter((e) => e.kind !== "remove").length;
    hunks.push({
      oldStart: oldLine - startContext,
      oldCount,
      newStart: newLine - startContext,
      newCount,
      lines: slice.map((e) => {
        if (e.kind === "add") return `+${e.line}`;
        if (e.kind === "remove") return `-${e.line}`;
        return ` ${e.line}`;
      }),
    });
    // Advance the line counters.
    for (const e of slice) {
      if (e.kind !== "add") oldLine += 1;
      if (e.kind !== "remove") newLine += 1;
    }
    i = hunkEnd;
  }
  return hunks;
}

function leadingContext(edits: Edit[], pos: number): number {
  let n = 0;
  for (let i = pos - 1; i >= 0 && edits[i].kind === "context"; i -= 1) {
    n += 1;
  }
  return n;
}
