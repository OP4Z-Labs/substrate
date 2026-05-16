/**
 * Detector for FE-TS-001 — `any` without an inline justification.
 *
 * Replaces a ripgrep negative-lookahead pattern that ripgrep silently
 * skipped without --pcre2. Scans TS/TSX files, finds `: any` (the
 * canonical "typed escape hatch"), and flags occurrences whose line
 * doesn't end with a justification comment (eslint-disable / TODO /
 * HACK / xxx).
 */

const ANY_PATTERN = /:\s*any\b/g;
const ALLOWED_TRAILING = /\/\/\s*(eslint|TODO|HACK|FIXME|XXX)/i;
const EXTENSIONS = [".ts", ".tsx"];
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);
const TYPE_DECL_EXCLUDE = /\.d\.ts$/;

export default function detect(ctx) {
  const findings = [];
  walk(".", ctx, findings);
  return findings;
}

function walk(relDir, ctx, findings) {
  let entries;
  try {
    entries = ctx.readdir(relDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const childRel = relDir === "." ? entry : relDir + "/" + entry;
    let isDir = false;
    try {
      ctx.readdir(childRel);
      isDir = true;
    } catch {
      isDir = false;
    }
    if (isDir) {
      walk(childRel, ctx, findings);
      continue;
    }
    if (!EXTENSIONS.some((ext) => childRel.endsWith(ext))) continue;
    if (TYPE_DECL_EXCLUDE.test(childRel)) continue;
    let text;
    try {
      text = ctx.readFile(childRel);
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      ANY_PATTERN.lastIndex = 0;
      if (!ANY_PATTERN.test(line)) continue;
      if (ALLOWED_TRAILING.test(line)) continue;
      findings.push(
        ctx.finding({
          message:
            'TypeScript `any` without inline justification (// eslint-disable / TODO / HACK)',
          path: childRel,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
        }),
      );
    }
  }
}
