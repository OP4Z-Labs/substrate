/**
 * `substrate knowledge` — auto-discovery of local stack reference.
 *
 *   substrate knowledge refresh  → parses docker-compose.yml + .env.example
 *                                 from the repo and writes
 *                                 auto/docs/KNOWLEDGE.md (redacted).
 *
 *   substrate knowledge show     → prints the generated doc.
 *                                 --section <name> filters.
 *
 * Sources and redaction rules are configurable via substrate.config.json's
 * `knowledge` block. If config is absent we fall back to the v0.3
 * defaults baked into `defaultKnowledgeConfig` below.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import kleur from "kleur";
import { parse as parseYaml } from "yaml";
import { ensureDir } from "../util/fs.js";
import { resolveTargetRoot } from "../util/paths.js";
import type { SubstrateConfig } from "../util/types.js";
import {
  discoverKnowledge,
  loadKnowledgeSourcesManifest,
  type KnowledgeBlock,
} from "../v2/knowledge/sources.js";

/**
 * v0.5: swapped the hand-rolled `yaml-mini` parser for `yaml` (eemeli/yaml).
 *
 * The mini parser handled the docker-compose subset Substrate cared about, but
 * lost services after a `command: >` block scalar (P1 finding from the v0.3
 * smoke run, blocking the OP4Z dogfood loop). The eemeli `yaml` library is
 * the canonical full-spec parser for the Node ecosystem.
 *
 * Local `YamlValue` alias keeps the rest of this module's types stable —
 * `yaml`'s `parse()` returns `unknown` so we shape the result at the boundary.
 */
type YamlScalar = string | number | boolean | null;
type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue };

export interface KnowledgeRefreshOptions {
  cwd?: string;
  quiet?: boolean;
}

export interface KnowledgeShowOptions {
  cwd?: string;
  /** Print only the named section (case-insensitive). */
  section?: string;
}

export interface KnowledgeRefreshResult {
  /** Absolute path of the generated KNOWLEDGE.md. */
  outputPath: string;
  /** Sources actually consumed (a subset of the configured list). */
  sourcesUsed: string[];
  /** Service entries discovered. */
  serviceCount: number;
  /** Env-var keys discovered (count includes redacted ones). */
  envVarCount: number;
}

const KNOWLEDGE_FILE = "KNOWLEDGE.md";

function defaultKnowledgeConfig(): NonNullable<SubstrateConfig["knowledge"]> {
  return {
    sources: ["docker-compose.yml", ".env.example"],
    redactPatterns: ["PASSWORD", "TOKEN", "SECRET", "KEY"],
  };
}

function loadConfig(root: string): SubstrateConfig | null {
  const path = join(root, "substrate.config.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SubstrateConfig;
  } catch {
    return null;
  }
}

export function runKnowledgeRefresh(options: KnowledgeRefreshOptions = {}): KnowledgeRefreshResult {
  const root = resolveTargetRoot(options.cwd);
  const config = loadConfig(root);
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);

  // v2.0: prefer `substrate/knowledge-sources.yaml` when present.
  // Falls through to the v1 `substrate.config.json#knowledge.sources`
  // flat-string list otherwise (zero-break for existing consumers).
  const manifestResult = loadKnowledgeSourcesManifest({ cwd: root });
  if (manifestResult.manifest) {
    return refreshFromV2Manifest({
      root,
      config,
      manifest: manifestResult.manifest,
      manifestPath: manifestResult.manifestPath,
      manifestWarnings: manifestResult.warnings,
      log,
    });
  }
  return refreshFromV1Sources({ root, config, log });
}

function refreshFromV1Sources(args: {
  root: string;
  config: SubstrateConfig | null;
  log: (msg: string) => void;
}): KnowledgeRefreshResult {
  const { root, config, log } = args;
  const knowledgeCfg = config?.knowledge ?? defaultKnowledgeConfig();

  // 1. Parse docker-compose.yml (if listed in sources).
  const services: ServiceSummary[] = [];
  const sourcesUsed: string[] = [];
  for (const source of knowledgeCfg.sources) {
    const sourcePath = join(root, source);
    if (!existsSync(sourcePath)) continue;
    sourcesUsed.push(source);
    if (/docker-compose(\.\w+)?\.ya?ml/.test(source)) {
      services.push(...parseDockerCompose(readFileSync(sourcePath, "utf8")));
    }
  }

  // 2. Parse .env example file(s).
  const envVars: EnvVar[] = [];
  for (const source of knowledgeCfg.sources) {
    if (!source.includes(".env")) continue;
    const sourcePath = join(root, source);
    if (!existsSync(sourcePath)) continue;
    if (!sourcesUsed.includes(source)) sourcesUsed.push(source);
    envVars.push(...parseEnvFile(readFileSync(sourcePath, "utf8"), knowledgeCfg.redactPatterns));
  }

  // 3. Render the KNOWLEDGE.md.
  const md = renderKnowledgeDoc({
    projectName: config?.project.name ?? "project",
    sourcesUsed,
    services,
    envVars,
    sourceKindCounts: {},
  });

  const outputDir = join(root, "auto", "docs");
  ensureDir(outputDir);
  const outputPath = join(outputDir, KNOWLEDGE_FILE);
  writeFileSync(outputPath, md, "utf8");

  log(kleur.green("✓") + ` auto/docs/${KNOWLEDGE_FILE}`);
  log(
    kleur.dim(
      `  services: ${services.length}, env-vars: ${envVars.length}, ` +
        `sources: ${sourcesUsed.join(", ") || "(none)"}`,
    ),
  );

  return {
    outputPath,
    sourcesUsed,
    serviceCount: services.length,
    envVarCount: envVars.length,
  };
}

function refreshFromV2Manifest(args: {
  root: string;
  config: SubstrateConfig | null;
  manifest: NonNullable<ReturnType<typeof loadKnowledgeSourcesManifest>["manifest"]>;
  manifestPath: string | null;
  manifestWarnings: string[];
  log: (msg: string) => void;
}): KnowledgeRefreshResult {
  const { root, config, manifest, manifestPath, manifestWarnings, log } = args;
  const discovery = discoverKnowledge({ cwd: root, manifest });

  // Group blocks by category so v2's render uses the same headings as v1.
  const services: ServiceSummary[] = [];
  const k8sBlocks: KnowledgeBlock[] = [];
  const secretBlocks: KnowledgeBlock[] = [];
  const envVars: EnvVar[] = [];
  const sourceKindCounts: Record<string, number> = {};
  for (const block of discovery.blocks) {
    sourceKindCounts[block.sourceKind] = (sourceKindCounts[block.sourceKind] ?? 0) + 1;
    if (block.category === "services") {
      if (block.sourceKind === "docker-compose") {
        services.push({
          name: String(block.payload.name ?? ""),
          image: (block.payload.image as string | null) ?? null,
          ports: (block.payload.ports as string[] | undefined) ?? [],
          dependsOn: (block.payload.dependsOn as string[] | undefined) ?? [],
          volumes: (block.payload.volumes as string[] | undefined) ?? [],
        });
      } else {
        k8sBlocks.push(block);
      }
    } else if (block.category === "env-vars") {
      envVars.push({
        key: String(block.payload.key ?? ""),
        value: "***REDACTED***",
        redacted: true,
      });
    } else if (block.category === "secrets") {
      secretBlocks.push(block);
    }
  }

  const md = renderKnowledgeDoc({
    projectName: config?.project.name ?? "project",
    sourcesUsed: discovery.sourcesUsed,
    services,
    envVars,
    k8sBlocks,
    secretBlocks,
    sourceKindCounts,
    manifestPath,
    manifestWarnings: [...manifestWarnings, ...discovery.warnings],
  });

  const outputDir = join(root, "auto", "docs");
  ensureDir(outputDir);
  const outputPath = join(outputDir, KNOWLEDGE_FILE);
  writeFileSync(outputPath, md, "utf8");

  log(kleur.green("✓") + ` auto/docs/${KNOWLEDGE_FILE}`);
  const kindSummary = Object.entries(sourceKindCounts)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  log(
    kleur.dim(
      `  services: ${services.length}, env-vars: ${envVars.length}, ` +
        `kinds: ${kindSummary || "(none)"}`,
    ),
  );
  for (const w of [...manifestWarnings, ...discovery.warnings]) {
    log(kleur.yellow("  ! ") + w);
  }

  return {
    outputPath,
    sourcesUsed: discovery.sourcesUsed,
    serviceCount: services.length,
    envVarCount: envVars.length,
  };
}

export function runKnowledgeShow(options: KnowledgeShowOptions = {}): string {
  const root = resolveTargetRoot(options.cwd);
  const path = join(root, "auto", "docs", KNOWLEDGE_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `Substrate: ${KNOWLEDGE_FILE} not found at ${path}. Run \`substrate knowledge refresh\` first.`,
    );
  }
  const content = readFileSync(path, "utf8");
  if (!options.section) {
    process.stdout.write(content);
    return content;
  }
  const section = extractSection(content, options.section);
  if (section === null) {
    throw new Error(`Substrate: section "${options.section}" not found in ${KNOWLEDGE_FILE}.`);
  }
  process.stdout.write(section);
  return section;
}

interface ServiceSummary {
  name: string;
  image: string | null;
  ports: string[];
  dependsOn: string[];
  volumes: string[];
}

function parseDockerCompose(source: string): ServiceSummary[] {
  let doc: unknown;
  try {
    // `yaml` (eemeli) handles anchors, multi-line scalars (`|`, `>`), tags,
    // and tab-mixed indentation that the prior mini-parser dropped on the
    // floor. Errors here just mean "this file isn't parseable" — callers
    // get an empty service list and the rest of the discovery still runs.
    doc = parseYaml(source);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const services = (doc as { services?: unknown }).services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return [];
  const out: ServiceSummary[] = [];
  for (const [name, raw] of Object.entries(services as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const node = raw as Record<string, YamlValue>;
    out.push({
      name,
      image: typeof node.image === "string" ? node.image : null,
      ports: toStringArray(node.ports),
      dependsOn: toStringArray(node.depends_on),
      volumes: toStringArray(node.volumes),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function toStringArray(value: YamlValue | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((v): string[] => {
      if (typeof v === "string") return [v];
      if (typeof v === "number" || typeof v === "boolean") return [String(v)];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // Long-form port spec like `{ target: 80, published: 8080 }`
        const obj = v as Record<string, YamlValue>;
        const target = obj.target ?? obj.published;
        return target !== undefined ? [String(target)] : [];
      }
      return [];
    });
  }
  if (typeof value === "object") {
    // depends_on can be a map: { foo: { condition: service_started } }
    return Object.keys(value);
  }
  return [];
}

interface EnvVar {
  key: string;
  value: string;
  redacted: boolean;
}

function parseEnvFile(source: string, redactPatterns: string[]): EnvVar[] {
  const out: EnvVar[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const redacted = redactPatterns.some((pattern) =>
      key.toUpperCase().includes(pattern.toUpperCase()),
    );
    out.push({
      key,
      value: redacted ? "***REDACTED***" : value,
      redacted,
    });
  }
  return out;
}

interface RenderInput {
  projectName: string;
  sourcesUsed: string[];
  services: ServiceSummary[];
  envVars: EnvVar[];
  /** v2: kubernetes-derived service blocks. Render as a separate section. */
  k8sBlocks?: KnowledgeBlock[];
  /** v2: kubernetes Secret + ConfigMap blocks. Keys only — no values. */
  secretBlocks?: KnowledgeBlock[];
  /** v2: per-kind block counts; informational footer. */
  sourceKindCounts?: Record<string, number>;
  /** v2: path to the resolved knowledge-sources.yaml (if any). */
  manifestPath?: string | null;
  /** v2: warnings from manifest parse + discovery (rendered at the top). */
  manifestWarnings?: string[];
}

function renderKnowledgeDoc(input: RenderInput): string {
  const lines: string[] = [];
  lines.push("# KNOWLEDGE.md");
  lines.push("");
  lines.push(
    "> Auto-generated by `substrate knowledge refresh`. Don't edit by hand — re-run the command.",
  );
  lines.push("");
  lines.push(`Project: \`${input.projectName}\``);
  lines.push("");
  lines.push(`Sources: ${input.sourcesUsed.length > 0 ? input.sourcesUsed.map((s) => "`" + s + "`").join(", ") : "(none — no recognized sources found)"}`);
  if (input.manifestPath) {
    lines.push("");
    lines.push(`Manifest: \`${input.manifestPath}\``);
  }
  if (input.manifestWarnings && input.manifestWarnings.length > 0) {
    lines.push("");
    lines.push("### Warnings");
    lines.push("");
    for (const w of input.manifestWarnings) lines.push(`- ${w}`);
  }
  lines.push("");

  // Services (docker-compose)
  lines.push("## Services");
  lines.push("");
  if (input.services.length === 0) {
    lines.push("_No services discovered._");
  } else {
    lines.push("| Service | Image | Ports | Depends on |");
    lines.push("| ------- | ----- | ----- | ---------- |");
    for (const svc of input.services) {
      lines.push(
        `| \`${svc.name}\` | ${svc.image ?? "(build)"} | ${svc.ports.join(", ") || "—"} | ${svc.dependsOn.join(", ") || "—"} |`,
      );
    }
    lines.push("");
    lines.push("### Volume mounts");
    lines.push("");
    const withVolumes = input.services.filter((s) => s.volumes.length > 0);
    if (withVolumes.length === 0) {
      lines.push("_No volume mounts._");
    } else {
      for (const svc of withVolumes) {
        lines.push(`- **${svc.name}**:`);
        for (const v of svc.volumes) lines.push(`  - \`${v}\``);
      }
    }
  }
  lines.push("");

  // Kubernetes (v2)
  if (input.k8sBlocks && input.k8sBlocks.length > 0) {
    lines.push("## Kubernetes resources");
    lines.push("");
    lines.push("| Kind | Name | Namespace | Detail |");
    lines.push("| ---- | ---- | --------- | ------ |");
    for (const block of input.k8sBlocks) {
      const p = block.payload;
      const kind = String(p.kind ?? "?");
      const name = String(p.name ?? "?");
      const ns = String(p.namespace ?? "default");
      let detail = "—";
      if (Array.isArray(p.ports) && (p.ports as string[]).length > 0) {
        detail = `ports: ${(p.ports as string[]).join(", ")}`;
      } else if (Array.isArray(p.images) && (p.images as string[]).length > 0) {
        detail = `images: ${(p.images as string[]).join(", ")}`;
      }
      lines.push(`| ${kind} | \`${name}\` | ${ns} | ${detail} |`);
    }
    lines.push("");
  }

  // Secrets / ConfigMaps (v2)
  if (input.secretBlocks && input.secretBlocks.length > 0) {
    lines.push("## Secret + ConfigMap keys");
    lines.push("");
    lines.push(
      "_Substrate emits the key list only. Values are never read or written here._",
    );
    lines.push("");
    for (const block of input.secretBlocks) {
      const p = block.payload;
      const keys = (p.keys as string[] | undefined) ?? [];
      lines.push(
        `- **${String(p.kind)} \`${String(p.name)}\`** (${String(p.namespace)}): ${
          keys.length > 0 ? keys.map((k) => "`" + k + "`").join(", ") : "_(no keys)_"
        }`,
      );
    }
    lines.push("");
  }

  // Env vars
  lines.push("## Environment variables");
  lines.push("");
  if (input.envVars.length === 0) {
    lines.push("_No env-var examples discovered._");
  } else {
    lines.push("| Key | Example value |");
    lines.push("| --- | ------------- |");
    for (const env of input.envVars) {
      lines.push(`| \`${env.key}\` | ${env.redacted ? "`***REDACTED***`" : "`" + env.value + "`"} |`);
    }
    lines.push("");
    lines.push(
      "Values matching the configured redact patterns are masked. Configure under " +
        "`knowledge.redactPatterns` in `substrate.config.json`.",
    );
  }
  lines.push("");

  // v2 footer: discovered-kinds summary
  if (input.sourceKindCounts && Object.keys(input.sourceKindCounts).length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("### Discovery summary");
    lines.push("");
    for (const [kind, count] of Object.entries(input.sourceKindCounts).sort()) {
      lines.push(`- \`${kind}\`: ${count} block(s)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function extractSection(content: string, requestedSection: string): string | null {
  const wanted = requestedSection.toLowerCase().trim();
  const lines = content.split("\n");
  const out: string[] = [];
  let collecting = false;
  let currentLevel = 0;
  for (const line of lines) {
    const headingMatch = line.match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].toLowerCase().trim();
      if (!collecting) {
        if (title === wanted || title.startsWith(wanted + " ")) {
          collecting = true;
          currentLevel = level;
          out.push(line);
          continue;
        }
      } else {
        if (level <= currentLevel) break;
        out.push(line);
        continue;
      }
    } else if (collecting) {
      out.push(line);
    }
  }
  if (out.length === 0) return null;
  return out.join("\n") + "\n";
}
