/**
 * Stack auto-detection.
 *
 * v0.3 introduces lightweight detection so `cadence init` can pre-enable
 * stack-appropriate audits and standards. The rules are intentionally
 * boring per the brief: look for manifest files and trust them.
 *
 *   pyproject.toml | poetry.lock | requirements.txt      → python
 *   package.json   | tsconfig.json                        → typescript
 *   go.mod                                                → go
 *   Cargo.toml                                            → rust
 *
 * Multiple matches → "mixed" in the sense that we just return all matched
 * stacks. Callers (init) then make policy decisions about defaults.
 *
 * Why not heuristics or file-content sniffing? Plan §9 calls out v0.3 as
 * "don't try to be too clever". We can always tighten in v0.5 when the
 * upgrade flow gives us a place to re-detect.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Canonical stack identifiers. Add new entries here when adding markers. */
export type Stack = "python" | "typescript" | "go" | "rust";

export const ALL_STACKS: readonly Stack[] = ["python", "typescript", "go", "rust"];

/**
 * Marker files that uniquely identify a stack at the repo root.
 *
 * Order within a stack matters only for the "evidence" return value —
 * the first match is what `detectStacks` cites. The presence of any
 * marker in the list is enough to flag the stack.
 */
export const STACK_MARKERS: Record<Stack, readonly string[]> = {
  python: ["pyproject.toml", "poetry.lock", "requirements.txt", "setup.py", "setup.cfg"],
  typescript: ["package.json", "tsconfig.json"],
  go: ["go.mod"],
  rust: ["Cargo.toml"],
};

export interface StackDetectionResult {
  /** Stacks found, in canonical order (python, typescript, go, rust). */
  stacks: Stack[];
  /** Per-stack evidence: which marker file triggered the detection. */
  evidence: Partial<Record<Stack, string>>;
  /** True when more than one stack matched. */
  mixed: boolean;
}

/**
 * Detect stacks present in a repo by looking for marker files at root.
 *
 * Returns an empty `stacks` array (and `mixed: false`) when no markers
 * are found. Callers decide what to do — `init` falls back to a default
 * of `["python", "typescript"]` for parity with v0.1 behaviour so
 * existing test fixtures keep working.
 */
export function detectStacks(cwd: string): StackDetectionResult {
  const stacks: Stack[] = [];
  const evidence: Partial<Record<Stack, string>> = {};

  for (const stack of ALL_STACKS) {
    for (const marker of STACK_MARKERS[stack]) {
      if (existsSync(join(cwd, marker))) {
        stacks.push(stack);
        evidence[stack] = marker;
        break;
      }
    }
  }

  return {
    stacks,
    evidence,
    mixed: stacks.length > 1,
  };
}

/**
 * Audits to pre-enable for a given stack.
 *
 * The base set (pre-merge, dependencies, dead-code, security, performance,
 * functionality-gaps, trend, all, api-contract, reusability, extensibility)
 * applies to every project. Stack-specific additions toggle the
 * backend / frontend / package / service-consistency audits.
 *
 * Returned list is the union for the given stacks, deduplicated, in
 * canonical order matching the audit catalog.
 */
export function defaultAuditsFor(stacks: Stack[]): string[] {
  const universal = [
    "pre-merge",
    "dependencies",
    "dead-code",
    "security",
    "performance",
    "functionality-gaps",
    "trend",
    "all",
    "api-contract",
    "reusability",
    "extensibility",
  ];
  const stackSpecific = new Set<string>();
  if (stacks.includes("python") || stacks.includes("go") || stacks.includes("rust")) {
    stackSpecific.add("backend");
    stackSpecific.add("package");
    stackSpecific.add("service-consistency");
  }
  if (stacks.includes("typescript")) {
    stackSpecific.add("frontend");
    stackSpecific.add("package");
  }
  // Order: universal first (in the listed order), then sorted stack-specific.
  const ordered = [...universal, ...Array.from(stackSpecific).sort()];
  return Array.from(new Set(ordered));
}

/**
 * Standards categories to pre-enable for a given stack.
 *
 * Backend standards key off python/go/rust; frontend keys off typescript;
 * cross-cutting (rules, markdown-format-specification) and operations docs
 * ship for every project.
 */
export function defaultStandardsFor(stacks: Stack[]): string[] {
  const universal = [
    "cross-cutting/rules",
    "cross-cutting/markdown-format-specification",
    "infrastructure/ci-cd",
    "infrastructure/docker",
    "operations/runbooks",
    "operations/feature-flags",
  ];
  const set = new Set<string>(universal);
  if (stacks.includes("python") || stacks.includes("go") || stacks.includes("rust")) {
    set.add("backend/architecture");
    set.add("backend/api");
    set.add("backend/database");
    set.add("backend/error-handling");
    set.add("backend/observability");
    set.add("backend/security");
    set.add("backend/testing");
  }
  if (stacks.includes("python")) {
    set.add("backend/python");
  }
  if (stacks.includes("typescript")) {
    set.add("frontend/react");
    set.add("frontend/typescript");
    set.add("frontend/accessibility");
    set.add("frontend/performance");
    set.add("frontend/testing");
    set.add("frontend/data-management");
    set.add("frontend/logging");
  }
  return Array.from(set).sort();
}
