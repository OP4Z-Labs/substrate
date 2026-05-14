import type { AuditFrontMatter } from "./types.js";

/**
 * Minimal YAML-front-matter parser.
 *
 * We only need to read a handful of scalar fields (string + integer) from
 * the audit-instruction headers. Pulling in a full YAML dependency for
 * that is overkill, and the v0.3 runtime will reach for a real parser
 * when it needs to consume `RULES.yaml`.
 *
 * Supports:
 *   ---
 *   key: value
 *   schema_version: 2
 *   ---
 *
 * Does NOT support nested keys, arrays, multi-line strings, or quoting
 * edge cases. The audit templates this parser reads are authored by us
 * and constrained to the simple form.
 */
export function parseFrontMatter(source: string): {
  data: AuditFrontMatter;
  body: string;
} {
  const trimmed = source.replace(/^﻿/, ""); // strip BOM if present
  if (!trimmed.startsWith("---")) {
    return { data: {}, body: trimmed };
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: trimmed };
  }
  const headerBlock = trimmed.slice(3, end).trim();
  const bodyStart = end + 4;
  const body = trimmed.slice(bodyStart).replace(/^\n/, "");
  const data: AuditFrontMatter = {};
  for (const line of headerBlock.split("\n")) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const colon = stripped.indexOf(":");
    if (colon === -1) continue;
    const key = stripped.slice(0, colon).trim();
    const rawValue = stripped.slice(colon + 1).trim();
    if (!key) continue;
    if (/^-?\d+$/.test(rawValue)) {
      (data as Record<string, unknown>)[key] = Number(rawValue);
    } else {
      const unquoted = rawValue.replace(/^["']|["']$/g, "");
      (data as Record<string, unknown>)[key] = unquoted;
    }
  }
  return { data, body };
}
