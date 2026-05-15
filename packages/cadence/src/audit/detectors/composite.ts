/**
 * Composite detector.
 *
 * Combines previously-computed sub-rule results into a single yes/no
 * verdict, then emits a synthetic finding when the operator triggers.
 *
 *   - `all`  : fire when every sub-rule emitted at least one finding
 *   - `any`  : fire when any sub-rule emitted at least one finding
 *   - `none` : fire when no sub-rule emitted any findings (useful for
 *              "you must have at least one X" rules)
 *
 * Composite detectors are evaluated AFTER all of their referenced rules
 * have completed, so dependency ordering is left to `runner.ts`.
 */

import type { CompositeDetector, Finding, RuleResult, Severity } from "../types.js";

export interface RunCompositeOptions {
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  /** Sub-rule results keyed by rule id. */
  subResults: Map<string, RuleResult>;
}

export function runCompositeDetector(
  detector: CompositeDetector,
  options: RunCompositeOptions,
): { findings: Finding[]; note?: string } {
  const missing: string[] = [];
  const present: RuleResult[] = [];
  for (const ref of detector.rules) {
    const sub = options.subResults.get(ref);
    if (sub) present.push(sub);
    else missing.push(ref);
  }
  if (missing.length > 0 && present.length === 0) {
    return {
      findings: [],
      note: `composite rule could not resolve any referenced rules (missing: ${missing.join(", ")})`,
    };
  }
  const flags = present.map((r) => r.findings.length > 0);
  let triggered = false;
  if (detector.operator === "all") {
    triggered = flags.length > 0 && flags.every(Boolean);
  } else if (detector.operator === "any") {
    triggered = flags.some(Boolean);
  } else if (detector.operator === "none") {
    triggered = flags.length > 0 && flags.every((f) => f === false);
  }
  if (!triggered) {
    return {
      findings: [],
      note: missing.length > 0 ? `composite evaluated; missing refs: ${missing.join(", ")}` : undefined,
    };
  }
  // Single synthetic finding so the composite is visible in reports.
  return {
    findings: [
      {
        ruleId: options.ruleId,
        severity: options.severity,
        message: `composite(${detector.operator}) triggered: ${detector.rules.join(", ")}`,
      },
    ],
    note: missing.length > 0 ? `missing refs: ${missing.join(", ")}` : undefined,
  };
}
