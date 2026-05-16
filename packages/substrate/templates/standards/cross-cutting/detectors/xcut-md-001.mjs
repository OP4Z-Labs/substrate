/**
 * Detector for XCUT-MD-001 — standards docs declare scope + area in frontmatter.
 *
 * Replaces a ripgrep regex that used `\n` (which ripgrep doesn't match
 * line-by-line without --multiline). Walks every markdown file under
 * substrate/standards/ and checks that the YAML frontmatter contains
 * both `scope:` and `area:` keys before the closing `---`.
 *
 * Flagged: standards/*.md files whose frontmatter is missing one of
 * the required keys, or whose frontmatter block isn't present at all.
 */

const STANDARDS_ROOTS = ["substrate/standards", "standards", "auto/standards"];
const REQUIRED_KEYS = ["scope", "area"];

export default function detect(ctx) {
  const findings = [];
  let root = null;
  for (const candidate of STANDARDS_ROOTS) {
    if (ctx.exists(candidate)) {
      root = candidate;
      break;
    }
  }
  if (!root) return findings;
  walk(root, ctx, findings);
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
    const childRel = relDir + "/" + entry;
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
    if (!childRel.endsWith(".md")) continue;
    // Skip the RULES.yaml location itself + non-doc artefacts.
    if (childRel.endsWith("RULES.yaml")) continue;
    let text;
    try {
      text = ctx.readFile(childRel);
    } catch {
      continue;
    }
    const frontmatter = extractFrontmatter(text);
    const missing = [];
    if (frontmatter === null) {
      missing.push(...REQUIRED_KEYS);
    } else {
      for (const key of REQUIRED_KEYS) {
        const re = new RegExp("^" + key + "\\s*:", "m");
        if (!re.test(frontmatter)) missing.push(key);
      }
    }
    if (missing.length > 0) {
      findings.push(
        ctx.finding({
          message:
            "Standards doc missing frontmatter key(s): " + missing.join(", "),
          path: childRel,
          line: 1,
        }),
      );
    }
  }
}

function extractFrontmatter(text) {
  if (!text.startsWith("---")) return null;
  const closeIdx = text.indexOf("\n---", 3);
  if (closeIdx === -1) return null;
  return text.slice(3, closeIdx);
}
