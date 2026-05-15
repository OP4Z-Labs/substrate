/**
 * RULES.yaml loader.
 *
 * Parses and validates the rules registry. Validation is strict-by-default
 * (`--strict` is the assumed mode; opt-out is via the `lenient` flag for
 * legacy v0.x registries that were authored before the v1.0 schema froze).
 *
 * The loader is intentionally side-effect-free: it reads, parses, validates,
 * returns. The actual rule execution happens in `runner.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CompositeDetector, Detector, EscalationStep, RipgrepDetector, RuleDefinition, RulesYamlDocument, ScriptDetector, Severity } from "./types.js";

const ALLOWED_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const ALLOWED_DETECTOR_TYPES = ["ripgrep", "script", "composite", "shell", "manual"] as const;

export class RulesLoadError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "RulesLoadError";
  }
}

export interface LoadRulesOptions {
  /**
   * When true, unknown fields and lenient detector types ("shell", "manual")
   * are treated as fatal. When false (the legacy default), they're
   * downgraded to warnings and the rule is skipped at runtime.
   */
  strict?: boolean;
}

export interface LoadRulesResult {
  document: RulesYamlDocument;
  /** Non-fatal warnings collected during parse (one per problem). */
  warnings: string[];
  /** Absolute path of the file consumed. */
  path: string;
}

/**
 * Locate `RULES.yaml` in the repo. Priority:
 *
 *   1. The path passed in (treated as repo-relative or absolute).
 *   2. `substrate/RULES.yaml` (the v1.0 default location for consumer repos).
 *   3. `auto/RULES.yaml` (legacy v0.x location, kept for back-compat).
 *
 * Returns null when nothing is found — callers decide whether that's a hard
 * error or just a "no rules to run" no-op.
 */
export function locateRulesFile(repoRoot: string, configuredPath?: string): string | null {
  if (configuredPath) {
    const abs = isAbsolute(configuredPath) ? configuredPath : join(repoRoot, configuredPath);
    return existsSync(abs) ? abs : null;
  }
  const candidates = [join(repoRoot, "substrate", "RULES.yaml"), join(repoRoot, "auto", "RULES.yaml")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Read, parse, and validate a RULES.yaml file. Returns the parsed
 * document plus any non-fatal warnings.
 *
 * Throws `RulesLoadError` on:
 *  - missing file
 *  - YAML parse error
 *  - missing `rules:` key
 *  - in strict mode, any structural problem (bad severity, unknown
 *    detector type, missing required fields)
 */
export function loadRules(path: string, options: LoadRulesOptions = {}): LoadRulesResult {
  if (!existsSync(path)) {
    throw new RulesLoadError(`RULES.yaml not found at ${path}`, path);
  }
  const source = readFileSync(path, "utf8");
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    throw new RulesLoadError(
      `Could not parse RULES.yaml at ${path}: ${(err as Error).message}`,
      path,
    );
  }
  if (!isObject(raw) || !Array.isArray((raw as { rules?: unknown }).rules)) {
    throw new RulesLoadError(
      `RULES.yaml at ${path} is missing the "rules:" array.`,
      path,
    );
  }

  const warnings: string[] = [];
  const rawDoc = raw as { rules: unknown[]; meta?: unknown };
  const rules: RuleDefinition[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rawDoc.rules.length; i += 1) {
    const r = rawDoc.rules[i];
    try {
      const rule = validateRule(r, i, options.strict ?? false, warnings);
      if (rule) {
        if (seenIds.has(rule.id)) {
          throw new RulesLoadError(`Duplicate rule id "${rule.id}" in ${path}`, path);
        }
        seenIds.add(rule.id);
        rules.push(rule);
      }
    } catch (err) {
      throw new RulesLoadError((err as Error).message, path);
    }
  }

  const document: RulesYamlDocument = {
    meta: isObject(rawDoc.meta) ? (rawDoc.meta as RulesYamlDocument["meta"]) : undefined,
    rules,
  };
  return { document, warnings, path };
}

function validateRule(
  raw: unknown,
  index: number,
  strict: boolean,
  warnings: string[],
): RuleDefinition | null {
  if (!isObject(raw)) {
    throw new RulesLoadError(`rules[${index}] is not an object`);
  }
  const o = raw as Record<string, unknown>;
  const id = strField(o, "id", index);
  const title = strField(o, "title", index);
  const severityRaw = strField(o, "severity", index);
  if (!ALLOWED_SEVERITIES.includes(severityRaw as Severity)) {
    throw new RulesLoadError(
      `rules[${index}] (${id}) has invalid severity "${severityRaw}" — expected one of ${ALLOWED_SEVERITIES.join(", ")}`,
    );
  }
  const rule: RuleDefinition = {
    id,
    title,
    severity: severityRaw as Severity,
    doc: typeof o.doc === "string" ? o.doc : undefined,
    description: typeof o.description === "string" ? o.description : undefined,
    category: typeof o.category === "string" ? o.category : undefined,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : undefined,
  };

  if (o.detector !== undefined) {
    const detector = validateDetector(o.detector, id, strict, warnings);
    if (detector) rule.detector = detector;
  }

  if (o.escalate_after !== undefined) {
    const steps = validateEscalateAfter(o.escalate_after, id, strict, warnings);
    if (steps && steps.length > 0) rule.escalate_after = steps;
  }

  // Surface unknown top-level fields when strict.
  const allowed = new Set([
    "id",
    "title",
    "doc",
    "severity",
    "description",
    "category",
    "tags",
    "detector",
    "escalate_after",
  ]);
  for (const key of Object.keys(o)) {
    if (!allowed.has(key)) {
      const msg = `rules[${index}] (${id}) has unknown field "${key}"`;
      if (strict) throw new RulesLoadError(msg);
      warnings.push(msg);
    }
  }
  return rule;
}

function validateDetector(
  raw: unknown,
  ruleId: string,
  strict: boolean,
  warnings: string[],
): Detector | null {
  if (!isObject(raw)) {
    throw new RulesLoadError(`rule "${ruleId}" has malformed detector (not an object)`);
  }
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  if (!ALLOWED_DETECTOR_TYPES.includes(type as (typeof ALLOWED_DETECTOR_TYPES)[number])) {
    throw new RulesLoadError(
      `rule "${ruleId}" has unknown detector type "${type}" — expected one of ${ALLOWED_DETECTOR_TYPES.join(", ")}`,
    );
  }
  // "manual" and "shell" are legacy detector types from v0.3's skeleton.
  // They survive as no-op shapes — runtime marks them skipped.
  if (type === "manual" || type === "shell") {
    if (strict && type === "shell") {
      warnings.push(
        `rule "${ruleId}" uses legacy detector type "shell" — migrate to "script" for v1.0+`,
      );
    }
    // Return null so the rule still loads but no detector executes.
    return null;
  }
  if (type === "ripgrep") {
    const pattern = strField(o, "pattern", `detector(${ruleId})`);
    const d: RipgrepDetector = {
      type: "ripgrep",
      pattern,
      paths: arrayField(o, "paths"),
      exclude: arrayField(o, "exclude"),
      caseSensitive: typeof o.caseSensitive === "boolean" ? o.caseSensitive : undefined,
      fixedString: typeof o.fixedString === "boolean" ? o.fixedString : undefined,
      multiline: typeof o.multiline === "boolean" ? o.multiline : undefined,
    };
    return d;
  }
  if (type === "script") {
    const path = strField(o, "path", `detector(${ruleId})`);
    const d: ScriptDetector = {
      type: "script",
      path,
      export: typeof o.export === "string" ? o.export : undefined,
      options: isObject(o.options) ? (o.options as Record<string, unknown>) : undefined,
      timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs : undefined,
    };
    return d;
  }
  if (type === "composite") {
    const rules = arrayField(o, "rules");
    if (!rules || rules.length === 0) {
      throw new RulesLoadError(
        `rule "${ruleId}" composite detector requires a non-empty "rules" array`,
      );
    }
    const operator = typeof o.operator === "string" ? o.operator : "";
    if (!["all", "any", "none"].includes(operator)) {
      throw new RulesLoadError(
        `rule "${ruleId}" composite detector has invalid operator "${operator}" — expected all/any/none`,
      );
    }
    const d: CompositeDetector = {
      type: "composite",
      rules,
      operator: operator as CompositeDetector["operator"],
    };
    return d;
  }
  return null;
}

function strField(o: Record<string, unknown>, key: string, where: string | number): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new RulesLoadError(`${typeof where === "number" ? `rules[${where}]` : where} missing required field "${key}"`);
  }
  return v;
}

function arrayField(o: Record<string, unknown>, key: string): string[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a rule's `escalate_after` declaration. Each entry must be
 * `{ age_days: <int>, target_severity: <severity|bump> }`.
 *
 * Steps are sorted by `age_days` ascending so the runtime can walk them
 * in order and pick the highest-age step that applies.
 */
function validateEscalateAfter(
  raw: unknown,
  ruleId: string,
  strict: boolean,
  warnings: string[],
): EscalationStep[] | null {
  if (!Array.isArray(raw)) {
    const msg = `rule "${ruleId}" has malformed escalate_after (not an array)`;
    if (strict) throw new RulesLoadError(msg);
    warnings.push(msg);
    return null;
  }
  const out: EscalationStep[] = [];
  const allowedTargets = new Set([...ALLOWED_SEVERITIES, "bump"]);
  for (let i = 0; i < raw.length; i += 1) {
    const e = raw[i];
    if (!isObject(e)) {
      const msg = `rule "${ruleId}" escalate_after[${i}] is not an object`;
      if (strict) throw new RulesLoadError(msg);
      warnings.push(msg);
      continue;
    }
    const ageRaw = (e as Record<string, unknown>).age_days;
    const targetRaw = (e as Record<string, unknown>).target_severity;
    if (typeof ageRaw !== "number" || !Number.isFinite(ageRaw) || ageRaw < 0) {
      const msg = `rule "${ruleId}" escalate_after[${i}] has invalid age_days (must be a non-negative integer)`;
      if (strict) throw new RulesLoadError(msg);
      warnings.push(msg);
      continue;
    }
    if (typeof targetRaw !== "string" || !allowedTargets.has(targetRaw)) {
      const msg = `rule "${ruleId}" escalate_after[${i}] has invalid target_severity "${String(targetRaw)}" — expected one of ${[...allowedTargets].join(", ")}`;
      if (strict) throw new RulesLoadError(msg);
      warnings.push(msg);
      continue;
    }
    out.push({
      age_days: Math.floor(ageRaw),
      target_severity: targetRaw as EscalationStep["target_severity"],
    });
  }
  out.sort((a, b) => a.age_days - b.age_days);
  return out;
}
