/**
 * Detector for BE-APIV-001 — URLs use /api/vN prefix.
 *
 * Two-pass detector that understands FastAPI's two route-declaration
 * patterns:
 *
 *   1. **Decorator-only** — the version prefix lives in the route
 *      decorator itself:
 *
 *          @app.get("/api/v1/users")
 *          def list_users(): ...
 *
 *   2. **Router-include prefix** — the version prefix is applied at
 *      router-include time and the decorator carries only the resource
 *      path:
 *
 *          # app/api/users.py
 *          router = APIRouter()
 *          @router.get("/users")
 *          def list_users(): ...
 *
 *          # app/api/api.py
 *          app.include_router(users.router, prefix="/api/v1")
 *
 * The v2.0.0 detector covered (1) but not (2), producing 535 false
 * positives in OP4Z (which exclusively uses pattern 2). The v2.0.0
 * cleanup (OP-1374 #4) adds router-include awareness via a two-pass
 * walk:
 *
 *   - Pass 1 builds `routerPrefixes` — a map from
 *     `<file>:<router-variable>` to its declared prefix.
 *   - Pass 2 walks route decorators and looks up the router's prefix
 *     (if any). A route is flagged only when the effective path
 *     (`prefix + decorator-path`) doesn't start with `/api/vN`.
 *
 * The look-up is per-file: a route in `app/api/users.py` decorated
 * with `@users_router.get(...)` only matches a router-include of
 * `users_router` declared anywhere in the project, so we union the
 * router-variable scope. False negatives are possible if two files
 * declare the same variable name with different prefixes, but that's
 * an anti-pattern this detector can't unambiguously resolve without
 * actually executing the Python — and we'd rather emit zero false
 * positives there than guess.
 */

const ROUTE_PATTERN =
  /@(?<varName>\w+)\.(?:get|post|put|patch|delete)\(\s*["'](?<path>[^"']+)["']/g;
const INCLUDE_PATTERN =
  /\.include_router\(\s*(?<routerExpr>[^,)]+?)(?:\s*,\s*[^)]*?prefix\s*=\s*["'](?<prefix>[^"']+)["'][^)]*)?\)/g;
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
  // Pass 1: collect every `include_router(<router>, prefix="...")`
  // we can find. Indexed by the bare router-variable name (the last
  // dotted component) so `include_router(users.router, prefix="/api/v1")`
  // resolves both as `users.router` and as `router`.
  const routerPrefixes = new Map();
  // Pass 2: walk decorators. Keyed list of (file, line, varName, path).
  const decoratorSites = [];

  walk(".", ctx, routerPrefixes, decoratorSites);

  for (const site of decoratorSites) {
    // The "well-known" FastAPI app variable. By convention `@app.get(...)`
    // is the top-level application and any path it declares is the
    // effective full path. We don't look up an include prefix for `app`
    // (it can't be included into anything).
    const isAppDecorator = site.varName === "app";
    let effectivePath = site.path;
    if (!isAppDecorator) {
      // Look up the matching router's prefix. We try the exact varName
      // first, then fall back to "router" (the conventional default).
      const prefix =
        routerPrefixes.get(site.varName) ?? routerPrefixes.get("router") ?? "";
      if (prefix) effectivePath = joinPath(prefix, site.path);
    }
    if (!/^\/api\/v\d+(\/|$)/.test(effectivePath)) {
      findings.push(
        ctx.finding({
          message:
            'Route URL "' +
            effectivePath +
            '" should start with /api/vN prefix',
          path: site.file,
          line: site.line,
          snippet: site.snippet,
        }),
      );
    }
  }
  return findings;
}

function walk(relDir, ctx, routerPrefixes, decoratorSites) {
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
      walk(childRel, ctx, routerPrefixes, decoratorSites);
      continue;
    }
    if (!childRel.endsWith(FILE_EXT)) continue;
    let text;
    try {
      text = ctx.readFile(childRel);
    } catch {
      continue;
    }
    // Collect include_router prefixes from this file. Stored in a
    // project-wide map because pattern 2 splits the decorator and the
    // include across files.
    collectRouterPrefixes(text, routerPrefixes);
    collectDecoratorSites(childRel, text, decoratorSites);
  }
}

function collectRouterPrefixes(text, routerPrefixes) {
  INCLUDE_PATTERN.lastIndex = 0;
  let m;
  while ((m = INCLUDE_PATTERN.exec(text)) !== null) {
    const expr = (m.groups?.routerExpr ?? "").trim();
    const prefix = m.groups?.prefix;
    // No prefix at the call site means the routes attached to that
    // router rely solely on the decorator path. Skip — there's nothing
    // to record (the decorator path is the effective path).
    if (!prefix) continue;
    // The router expression may be `users.router`, `router`,
    // `users_router`, etc. Record under the last dotted component
    // AND the full expression so lookup is forgiving.
    const lastComponent = expr.split(".").pop() ?? expr;
    routerPrefixes.set(lastComponent, prefix);
    routerPrefixes.set(expr, prefix);
  }
}

function collectDecoratorSites(file, text, decoratorSites) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    ROUTE_PATTERN.lastIndex = 0;
    let m;
    while ((m = ROUTE_PATTERN.exec(line)) !== null) {
      const varName = m.groups?.varName ?? "";
      const path = m.groups?.path ?? "";
      decoratorSites.push({
        file,
        line: i + 1,
        varName,
        path,
        snippet: line.trim().slice(0, 200),
      });
    }
  }
}

/**
 * Join a router-include prefix with a route decorator path, normalizing
 * separators so neither leading nor trailing slashes double up. Matches
 * FastAPI's `APIRouter(prefix=...).include_router(..., prefix=...)`
 * concatenation semantics.
 */
function joinPath(prefix, path) {
  const p = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const r = path.startsWith("/") ? path : "/" + path;
  return p + r;
}
