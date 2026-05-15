/**
 * Substrate v2 — Plural knowledge sources (Primitive 11, plan §3.11).
 *
 * v1.0 shipped a flat-string `knowledge.sources` list inside
 * `substrate.config.json` and assumed every entry was a path to a
 * docker-compose file or a `.env.example`. v2.0 introduces a typed
 * plugin contract so consumers can drop kubernetes manifests, env
 * registries, terraform state, or third-party plugin output into the
 * same auto-discovery pipeline.
 *
 * Source plugins are pure functions of `(absolutePath, repoRoot) →
 * KnowledgeBlock[]`. They receive the resolved file path and the repo
 * root, parse the file, and return one or more `KnowledgeBlock`s
 * carrying the discovered facts. The knowledge command renders them
 * into `auto/docs/KNOWLEDGE.md` using a per-kind formatter.
 *
 * Layer: deterministic. Pure file I/O + parsing; no AI, no network.
 *
 * Schema for `substrate/knowledge-sources.yaml`:
 *
 *   sources:
 *     - kind: docker-compose
 *       path: ./docker-compose.yml
 *     - kind: kubernetes
 *       paths: ["./k8s/** /*.yaml"]
 *     - kind: env-registry
 *       paths: [".env.production.template"]
 *
 * Plural inputs (`paths`) are supported alongside single (`path`) for
 * the kinds that commonly span many files. Built-in plugins are
 * registered in `BUILTIN_PLUGINS` below; consumer-side custom plugins
 * register at runtime via `registerKnowledgePlugin`. The custom-plugin
 * contract is documented in `docs/knowledge-sources.md`.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveTargetRoot } from "../../util/paths.js";

/**
 * One discovered fact (or row, or service, or env-var) extracted from a
 * knowledge source. The renderer groups blocks by `kind` so e.g. all
 * services from docker-compose + kubernetes land in one Services
 * section.
 */
export interface KnowledgeBlock {
  /** Plugin kind that produced this block. */
  sourceKind: string;
  /** Source file the block originated from (relative to repo root). */
  sourcePath: string;
  /** Render category — `services`, `env-vars`, `secrets`, `custom`. */
  category: "services" | "env-vars" | "secrets" | "custom";
  /** Free-form payload — shape depends on category. */
  payload: Record<string, unknown>;
}

export interface KnowledgeSourceManifestEntry {
  kind: string;
  path?: string;
  paths?: string[];
  /** Optional plugin-specific options. */
  options?: Record<string, unknown>;
}

export interface KnowledgeSourceManifest {
  sources: KnowledgeSourceManifestEntry[];
}

export type KnowledgeSourcePlugin = (
  absolutePath: string,
  repoRoot: string,
  options?: Record<string, unknown>,
) => KnowledgeBlock[];

/**
 * Built-in plugin registry. Keyed by `kind`. Consumers may extend via
 * `registerKnowledgePlugin`; built-ins are not overwritten unless
 * explicitly cleared (see `_clearRegistryForTests`).
 */
const BUILTIN_PLUGINS: Record<string, KnowledgeSourcePlugin> = {
  "docker-compose": parseDockerComposeFile,
  kubernetes: parseKubernetesManifestFile,
  "env-registry": parseEnvRegistryFile,
};

const REGISTRY: Map<string, KnowledgeSourcePlugin> = new Map(
  Object.entries(BUILTIN_PLUGINS),
);

/**
 * Register a custom knowledge source plugin. Names collide
 * destructively — the last registration wins. Consumer code should
 * scope plugin names (e.g. `mycorp:internal-services`) to avoid
 * stepping on built-ins.
 */
export function registerKnowledgePlugin(
  kind: string,
  plugin: KnowledgeSourcePlugin,
): void {
  REGISTRY.set(kind, plugin);
}

export function listRegisteredKinds(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** Test-only: restore the registry to the built-in plugins. */
export function _clearRegistryForTests(): void {
  REGISTRY.clear();
  for (const [k, v] of Object.entries(BUILTIN_PLUGINS)) REGISTRY.set(k, v);
}

export interface LoadKnowledgeSourcesOptions {
  cwd?: string;
  /** Manifest path override (default substrate/knowledge-sources.yaml). */
  manifestPath?: string;
}

export interface LoadKnowledgeSourcesResult {
  manifest: KnowledgeSourceManifest | null;
  manifestPath: string | null;
  warnings: string[];
}

/**
 * Read and parse `substrate/knowledge-sources.yaml`. Absent file is a
 * first-class state (returns `manifest: null`) — consumers fall through
 * to the v1 substrate.config.json `knowledge.sources` list in that
 * case.
 */
export function loadKnowledgeSourcesManifest(
  options: LoadKnowledgeSourcesOptions = {},
): LoadKnowledgeSourcesResult {
  const root = resolveTargetRoot(options.cwd);
  const path =
    options.manifestPath ??
    join(root, "substrate", "knowledge-sources.yaml");
  if (!existsSync(path)) {
    return { manifest: null, manifestPath: null, warnings: [] };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      manifest: null,
      manifestPath: path,
      warnings: [
        `Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      manifest: null,
      manifestPath: path,
      warnings: [`${path} is not a YAML map`],
    };
  }
  const raw = parsed as { sources?: unknown };
  if (!Array.isArray(raw.sources)) {
    return {
      manifest: null,
      manifestPath: path,
      warnings: [`${path} is missing a top-level \`sources:\` array`],
    };
  }
  const warnings: string[] = [];
  const sources: KnowledgeSourceManifestEntry[] = [];
  for (let i = 0; i < raw.sources.length; i += 1) {
    const entry = raw.sources[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`sources[${i}] is not an object — skipping`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.kind !== "string" || e.kind.length === 0) {
      warnings.push(`sources[${i}] missing required \`kind\` — skipping`);
      continue;
    }
    const path = typeof e.path === "string" ? e.path : undefined;
    const paths = Array.isArray(e.paths)
      ? e.paths.filter((p): p is string => typeof p === "string")
      : undefined;
    if (!path && (!paths || paths.length === 0)) {
      warnings.push(
        `sources[${i}] (kind=${e.kind}) has neither \`path\` nor \`paths\` — skipping`,
      );
      continue;
    }
    sources.push({
      kind: e.kind,
      path,
      paths,
      options:
        e.options && typeof e.options === "object" && !Array.isArray(e.options)
          ? (e.options as Record<string, unknown>)
          : undefined,
    });
  }
  return {
    manifest: { sources },
    manifestPath: path,
    warnings,
  };
}

export interface DiscoverKnowledgeOptions {
  cwd?: string;
  manifest?: KnowledgeSourceManifest;
}

export interface DiscoverKnowledgeResult {
  blocks: KnowledgeBlock[];
  /** Source files that were actually consumed. Repo-relative paths. */
  sourcesUsed: string[];
  /** Source kinds that were registered but produced no blocks. */
  kindsWithoutResults: string[];
  /** Source entries with no registered plugin. */
  unknownKinds: string[];
  warnings: string[];
}

/**
 * Walk a knowledge-sources manifest, invoking the registered plugin for
 * each entry and collecting all `KnowledgeBlock`s. Glob patterns inside
 * `paths` are expanded literally via a minimal walker — no full glob
 * spec, just `**` directory recursion + `*` per-segment match (the
 * minimum needed for `./k8s/** /*.yaml` and `.env.production.template`).
 */
export function discoverKnowledge(
  options: DiscoverKnowledgeOptions = {},
): DiscoverKnowledgeResult {
  const root = resolveTargetRoot(options.cwd);
  const manifest = options.manifest ?? loadKnowledgeSourcesManifest({ cwd: root }).manifest;
  const result: DiscoverKnowledgeResult = {
    blocks: [],
    sourcesUsed: [],
    kindsWithoutResults: [],
    unknownKinds: [],
    warnings: [],
  };
  if (!manifest) return result;
  for (const entry of manifest.sources) {
    const plugin = REGISTRY.get(entry.kind);
    if (!plugin) {
      result.unknownKinds.push(entry.kind);
      result.warnings.push(
        `No plugin registered for kind="${entry.kind}". Register via registerKnowledgePlugin().`,
      );
      continue;
    }
    const expanded = expandEntryPaths(entry, root);
    let produced = 0;
    for (const absPath of expanded) {
      if (!existsSync(absPath)) {
        result.warnings.push(`source not found: ${absPath}`);
        continue;
      }
      const stat = statSync(absPath);
      if (!stat.isFile()) {
        result.warnings.push(`source is not a file: ${absPath}`);
        continue;
      }
      const rel = relative(root, absPath);
      try {
        const blocks = plugin(absPath, root, entry.options);
        result.blocks.push(...blocks);
        produced += blocks.length;
        if (blocks.length > 0 && !result.sourcesUsed.includes(rel)) {
          result.sourcesUsed.push(rel);
        }
      } catch (err) {
        result.warnings.push(
          `plugin "${entry.kind}" failed on ${rel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (produced === 0 && !result.kindsWithoutResults.includes(entry.kind)) {
      result.kindsWithoutResults.push(entry.kind);
    }
  }
  // Stable order — by source path then category.
  result.blocks.sort((a, b) => {
    const p = a.sourcePath.localeCompare(b.sourcePath);
    return p !== 0 ? p : a.category.localeCompare(b.category);
  });
  return result;
}

// ----------------------------- path expansion -----------------------

function expandEntryPaths(
  entry: KnowledgeSourceManifestEntry,
  repoRoot: string,
): string[] {
  const raw: string[] = [];
  if (entry.path) raw.push(entry.path);
  if (entry.paths) raw.push(...entry.paths);
  const out: string[] = [];
  for (const r of raw) {
    if (r.includes("*")) {
      out.push(...expandGlob(r, repoRoot));
    } else {
      out.push(resolveRelative(r, repoRoot));
    }
  }
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of out) {
    if (seen.has(p)) continue;
    seen.add(p);
    unique.push(p);
  }
  return unique;
}

function resolveRelative(p: string, repoRoot: string): string {
  if (p.startsWith("./")) return resolve(repoRoot, p.slice(2));
  if (p.startsWith("/")) return p;
  return resolve(repoRoot, p);
}

/**
 * Minimal glob expander. Supports:
 *   - `**` matches any number of intermediate directories
 *   - `*` matches one path segment (anything but slash)
 *   - Literal text matches verbatim
 *
 * Returns absolute paths. Skips dotfile-prefixed entries unless the
 * pattern itself starts with `.` (so `.env.*` discovers dotfiles
 * intentionally).
 */
function expandGlob(pattern: string, repoRoot: string): string[] {
  // Normalize leading `./`. Anchor at repoRoot.
  const cleaned = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  const segments = cleaned.split("/");
  const matches: string[] = [];
  walkGlob(repoRoot, segments, matches);
  return matches.sort();
}

function walkGlob(
  currentDir: string,
  remainingSegments: string[],
  out: string[],
): void {
  if (remainingSegments.length === 0) {
    if (existsSync(currentDir)) {
      const s = statSync(currentDir);
      if (s.isFile()) out.push(currentDir);
    }
    return;
  }
  const [head, ...rest] = remainingSegments;
  if (head === "**") {
    // `**` matches zero or more directories. Try matching here (rest
    // applied to currentDir) AND recurse into every subdirectory with
    // `**` still in front of `rest`.
    walkGlob(currentDir, rest, out);
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const name of entries) {
      // Hidden directories are walked only if pattern explicitly contains
      // a leading dot in a later segment — keep `**` from descending into
      // node_modules / .git noise.
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(currentDir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walkGlob(full, ["**", ...rest], out);
      }
    }
    return;
  }
  if (head.includes("*")) {
    // Per-segment wildcard. Convert to a regex on the basename.
    const re = new RegExp(
      "^" +
        head
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, "[^/]*") +
        "$",
    );
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const name of entries) {
      // Allow dotfile-leading patterns; otherwise skip dotfiles.
      if (name.startsWith(".") && !head.startsWith(".")) continue;
      if (!re.test(name)) continue;
      const full = join(currentDir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (rest.length === 0) {
        if (st.isFile()) out.push(full);
      } else if (st.isDirectory()) {
        walkGlob(full, rest, out);
      }
    }
    return;
  }
  // Literal segment.
  const full = join(currentDir, head);
  if (!existsSync(full)) return;
  if (rest.length === 0) {
    const s = statSync(full);
    if (s.isFile()) out.push(full);
    return;
  }
  const s = statSync(full);
  if (s.isDirectory()) walkGlob(full, rest, out);
}

// ----------------------------- built-in plugins -----------------------

type YamlScalar = string | number | boolean | null;
type YamlValue = YamlScalar | YamlValue[] | { [k: string]: YamlValue };

function parseDockerComposeFile(
  absolutePath: string,
  repoRoot: string,
): KnowledgeBlock[] {
  const raw = readFileSync(absolutePath, "utf8");
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const services = (doc as { services?: unknown }).services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return [];
  const blocks: KnowledgeBlock[] = [];
  const sourcePath = relative(repoRoot, absolutePath) || absolutePath;
  for (const [name, raw2] of Object.entries(services as Record<string, unknown>)) {
    if (!raw2 || typeof raw2 !== "object" || Array.isArray(raw2)) continue;
    const node = raw2 as Record<string, YamlValue>;
    blocks.push({
      sourceKind: "docker-compose",
      sourcePath,
      category: "services",
      payload: {
        name,
        image: typeof node.image === "string" ? node.image : null,
        ports: toStringArray(node.ports),
        dependsOn: toStringArray(node.depends_on),
        volumes: toStringArray(node.volumes),
      },
    });
  }
  return blocks;
}

/**
 * Kubernetes manifest plugin. Reads one manifest file (which may contain
 * multiple `---`-separated documents) and extracts Service / Deployment
 * / StatefulSet entries as `services` blocks, plus Secret + ConfigMap
 * names as `secrets` blocks (values are never emitted, only the keys
 * and source path so reviewers know what to look at).
 *
 * Multi-doc YAML is parsed via `yaml`'s `parseAllDocuments`-style split:
 * we split on lines that are exactly `---` and parse each section.
 * (We intentionally do not use the streaming Document API because the
 * scalar parse path is sufficient for the limited shape we read.)
 */
function parseKubernetesManifestFile(
  absolutePath: string,
  repoRoot: string,
): KnowledgeBlock[] {
  const raw = readFileSync(absolutePath, "utf8");
  const docs = splitYamlDocuments(raw);
  const blocks: KnowledgeBlock[] = [];
  const sourcePath = relative(repoRoot, absolutePath) || absolutePath;
  for (const docText of docs) {
    let parsed: unknown;
    try {
      parsed = parseYaml(docText);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const d = parsed as Record<string, unknown>;
    if (typeof d.kind !== "string") continue;
    const kind = d.kind;
    const meta = (d.metadata as Record<string, unknown> | undefined) ?? {};
    const name = typeof meta.name === "string" ? meta.name : "(unnamed)";
    const namespace =
      typeof meta.namespace === "string" ? meta.namespace : "default";

    if (kind === "Service") {
      const spec = (d.spec as Record<string, unknown> | undefined) ?? {};
      const ports = Array.isArray(spec.ports)
        ? (spec.ports as Array<Record<string, unknown>>).map((p) => {
            const port = typeof p.port === "number" ? String(p.port) : null;
            const target = typeof p.targetPort === "number" || typeof p.targetPort === "string"
              ? String(p.targetPort)
              : null;
            return target && target !== port ? `${port}:${target}` : (port ?? "");
          }).filter((s) => s.length > 0)
        : [];
      blocks.push({
        sourceKind: "kubernetes",
        sourcePath,
        category: "services",
        payload: { name, namespace, kind: "Service", ports },
      });
    } else if (kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet") {
      const spec = (d.spec as Record<string, unknown> | undefined) ?? {};
      const template = (spec.template as Record<string, unknown> | undefined) ?? {};
      const podSpec = (template.spec as Record<string, unknown> | undefined) ?? {};
      const containers = Array.isArray(podSpec.containers)
        ? (podSpec.containers as Array<Record<string, unknown>>)
        : [];
      const images = containers
        .map((c) => (typeof c.image === "string" ? c.image : null))
        .filter((s): s is string => s !== null);
      blocks.push({
        sourceKind: "kubernetes",
        sourcePath,
        category: "services",
        payload: {
          name,
          namespace,
          kind,
          containers: containers.length,
          images,
        },
      });
    } else if (kind === "Secret" || kind === "ConfigMap") {
      const data = (d.data as Record<string, unknown> | undefined) ?? {};
      blocks.push({
        sourceKind: "kubernetes",
        sourcePath,
        category: "secrets",
        payload: {
          name,
          namespace,
          kind,
          // Never emit values — the key list is the safe surface.
          keys: Object.keys(data).sort(),
        },
      });
    }
  }
  return blocks;
}

/**
 * env-registry plugin. Reads a `.env.production.template` (or any env-
 * shaped file) and emits one `env-vars` block per key. Values are
 * unconditionally redacted — the template is the documented surface,
 * not the values. Keys carry their template-literal value (e.g.
 * `<set-in-vault>`) so reviewers know what shape to provide.
 */
function parseEnvRegistryFile(
  absolutePath: string,
  repoRoot: string,
): KnowledgeBlock[] {
  const raw = readFileSync(absolutePath, "utf8");
  const sourcePath = relative(repoRoot, absolutePath) || absolutePath;
  const blocks: KnowledgeBlock[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const placeholder = line.slice(eq + 1).trim();
    blocks.push({
      sourceKind: "env-registry",
      sourcePath,
      category: "env-vars",
      payload: {
        key,
        placeholder,
        redacted: true,
      },
    });
  }
  return blocks;
}

// ----------------------------- helpers -----------------------

function toStringArray(value: YamlValue | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((v): string[] => {
      if (typeof v === "string") return [v];
      if (typeof v === "number" || typeof v === "boolean") return [String(v)];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const obj = v as Record<string, YamlValue>;
        const target = obj.target ?? obj.published;
        return target !== undefined ? [String(target)] : [];
      }
      return [];
    });
  }
  if (typeof value === "object") return Object.keys(value);
  return [];
}

/**
 * Split a multi-document YAML string on `---` boundaries. Lines that
 * are exactly `---` (after trim) are document separators; the `---` at
 * the very start of the file is allowed and stripped.
 */
function splitYamlDocuments(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const docs: string[][] = [[]];
  for (const line of lines) {
    if (line.trim() === "---") {
      docs.push([]);
    } else {
      docs[docs.length - 1].push(line);
    }
  }
  return docs.map((d) => d.join("\n")).filter((d) => d.trim().length > 0);
}
