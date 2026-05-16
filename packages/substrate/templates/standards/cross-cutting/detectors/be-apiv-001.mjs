/**
 * Detector for BE-APIV-001 — URLs use /api/vN prefix.
 *
 * Replaces a ripgrep negative-lookahead pattern that ripgrep silently
 * skipped without --pcre2. Walks Python source, finds FastAPI / Flask
 * route decorators, and flags those whose URL does not start with
 * /api/v<digits>.
 */

const ROUTE_PATTERN = /@(?:app|router)\.(?:get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
const FILE_EXT = ".py";
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".pytest_cache",
]);

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
    if (!childRel.endsWith(FILE_EXT)) continue;
    let text;
    try {
      text = ctx.readFile(childRel);
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let m;
      ROUTE_PATTERN.lastIndex = 0;
      while ((m = ROUTE_PATTERN.exec(line)) !== null) {
        const url = m[1];
        if (!/^\/api\/v\d+(\/|$)/.test(url)) {
          findings.push(
            ctx.finding({
              message: 'Route URL "' + url + '" should start with /api/vN prefix',
              path: childRel,
              line: i + 1,
              snippet: line.trim().slice(0, 200),
            }),
          );
        }
      }
    }
  }
}
