/**
 * Substrate v2 — comment-preserving YAML edits (Phase B3, helper used
 * by the proposal applicators).
 *
 * The `yaml` library's `parse` + `stringify` round-trip drops comments
 * and reformats inconsistently. The proposal applicators need to edit
 * user-authored manifests (workflow YAML, hook YAML) without
 * vandalising the user's comments + formatting.
 *
 * Strategy: surgical line-based edits. We support three operations:
 *
 *   - `appendListItem(yaml, listPath, newEntry)` — append a new YAML
 *     entry to a top-level list (e.g. `steps:`). The new entry is
 *     stringified separately and indented to match the existing list.
 *     Existing entries + their inline / leading comments are
 *     untouched.
 *
 *   - `insertListItemAfter(yaml, listPath, anchorId, newEntry)` —
 *     insert after the entry whose `id:` field equals `anchorId`. If
 *     anchor missing, falls back to append.
 *
 *   - `appendToMapKey(yaml, keyPath, value)` — append a scalar to a
 *     nested list value. Used for `strengthen-context-load`
 *     applicator (adding to `context.standards:` etc.).
 *
 * This module intentionally does NOT support arbitrary YAML edits.
 * Each operation maps to one applicator's needs. When a new operation
 * is needed, we add a discriminator + a test fixture demonstrating
 * comment preservation.
 *
 * Layer: deterministic. Pure: same input + same operation → same
 * output. The output is always YAML the `yaml` library can parse back.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Operation: append a new entry to a top-level list under `<listKey>:`.
 *
 * The new entry is stringified to YAML, then re-indented to match the
 * list's existing indentation. We use the first existing list entry's
 * indentation as the reference; when the list is empty (key followed
 * by `[]` or no items at all) we default to 2 spaces.
 *
 * Empty-list semantics:
 *   - `steps: []`         → "steps:\n  - <item>"
 *   - `steps:\n  - <a>`   → ... + "  - <item>"
 *   - no `steps:` key     → throws YamlEditError
 */
export interface YamlEditOptions {
  /** Default indentation for new lines when no existing list entry exists. */
  defaultIndent?: string;
}

export class YamlEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlEditError";
  }
}

/**
 * Append a list item under a top-level list key. Returns the modified
 * YAML text. Comments + formatting outside the immediate insertion
 * point are preserved verbatim.
 */
export function appendListItem(
  yaml: string,
  listKey: string,
  newEntry: unknown,
  options: YamlEditOptions = {},
): string {
  const lines = yaml.split(/\r?\n/);
  const listLineRe = new RegExp(`^${listKey}:\\s*(\\[\\s*\\])?\\s*(#.*)?$`);
  const listLineIdx = lines.findIndex((l) => listLineRe.test(l));
  if (listLineIdx === -1) {
    throw new YamlEditError(`top-level list "${listKey}:" not found`);
  }
  // Locate the last entry of the list (next line at greater indent than
  // the key, until a sibling key reappears at the same indent).
  const keyIndent = leadingSpaces(lines[listLineIdx]);
  let insertAt = lines.length;
  let firstEntryIndent: string | null = null;
  for (let i = listLineIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const ind = leadingSpaces(line);
    if (ind.length <= keyIndent.length) {
      insertAt = i;
      break;
    }
    if (line.trimStart().startsWith("- ") && firstEntryIndent === null) {
      firstEntryIndent = ind;
    }
  }
  const itemIndent = firstEntryIndent ?? keyIndent + (options.defaultIndent ?? "  ");
  // If list is the inline `[]` form, convert it to block form.
  const listLine = lines[listLineIdx];
  if (/\[\s*\]/.test(listLine)) {
    lines[listLineIdx] = listLine.replace(/\[\s*\]\s*(#.*)?$/, "").trimEnd();
  }
  const rendered = renderEntry(newEntry, itemIndent);
  lines.splice(insertAt, 0, ...rendered);
  return lines.join("\n");
}

/**
 * Insert a list item AFTER the existing list entry whose `id:` field
 * equals `anchorId`. Falls back to append when no anchor matches.
 *
 * The applicator most commonly uses this for `add-to-workflow-step`:
 * "insert after step `implement`".
 */
export function insertListItemAfter(
  yaml: string,
  listKey: string,
  anchorId: string,
  newEntry: unknown,
  options: YamlEditOptions = {},
): string {
  const lines = yaml.split(/\r?\n/);
  const listLineRe = new RegExp(`^${listKey}:\\s*(\\[\\s*\\])?\\s*(#.*)?$`);
  const listLineIdx = lines.findIndex((l) => listLineRe.test(l));
  if (listLineIdx === -1) {
    throw new YamlEditError(`top-level list "${listKey}:" not found`);
  }
  const keyIndent = leadingSpaces(lines[listLineIdx]);
  // Walk list entries. Each entry starts with `<indent>- ` at the
  // first-entry indent. We record the start line of each entry; when
  // we hit an entry with `id: <anchorId>`, we mark its end (next entry
  // start, or end of list) as the insertion point.
  let firstEntryIndent: string | null = null;
  type EntryRange = { startLine: number; endLine: number; id?: string };
  const entries: EntryRange[] = [];
  let listEnd = lines.length;
  for (let i = listLineIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const ind = leadingSpaces(line);
    if (ind.length <= keyIndent.length) {
      listEnd = i;
      break;
    }
    if (firstEntryIndent === null && line.trimStart().startsWith("- ")) {
      firstEntryIndent = ind;
    }
    if (firstEntryIndent && ind === firstEntryIndent && line.trimStart().startsWith("- ")) {
      // New entry start. Close out the previous one.
      if (entries.length > 0) {
        entries[entries.length - 1].endLine = i;
      }
      entries.push({ startLine: i, endLine: -1 });
      // Try to capture the inline id on this start line: `- id: foo`
      const inlineId = line.match(/^\s*-\s+id:\s*([A-Za-z0-9_-]+)/);
      if (inlineId) entries[entries.length - 1].id = inlineId[1];
    } else if (firstEntryIndent && ind.length > firstEntryIndent.length && !entries[entries.length - 1].id) {
      // Continuation of current entry — pick up `id:` if present.
      const continuedId = line.match(/^\s*id:\s*([A-Za-z0-9_-]+)/);
      if (continuedId) entries[entries.length - 1].id = continuedId[1];
    }
  }
  if (entries.length > 0 && entries[entries.length - 1].endLine === -1) {
    entries[entries.length - 1].endLine = listEnd;
  }

  const anchor = entries.find((e) => e.id === anchorId);
  const itemIndent = firstEntryIndent ?? keyIndent + (options.defaultIndent ?? "  ");
  // Inline `[]` form → unwrap.
  const listLine = lines[listLineIdx];
  if (/\[\s*\]/.test(listLine)) {
    lines[listLineIdx] = listLine.replace(/\[\s*\]\s*(#.*)?$/, "").trimEnd();
  }
  const rendered = renderEntry(newEntry, itemIndent);
  if (!anchor) {
    // Fall back to append (after the last entry, or at list end).
    const insertAt = entries.length > 0 ? entries[entries.length - 1].endLine : listEnd;
    lines.splice(insertAt, 0, ...rendered);
  } else {
    lines.splice(anchor.endLine, 0, ...rendered);
  }
  return lines.join("\n");
}

/**
 * Render a JS value as a YAML list-entry block, with the leading `- `
 * marker prepended to the first line and the body indented by
 * `itemIndent.length + 2` spaces.
 */
function renderEntry(value: unknown, itemIndent: string): string[] {
  const bodyStringified = stringifyYaml(value, { lineWidth: 0 }).trimEnd();
  const bodyLines = bodyStringified.split("\n");
  if (bodyLines.length === 0) return [`${itemIndent}-`];
  // First line: prepend `- `. Subsequent lines: indent two more spaces.
  const firstLine = `${itemIndent}- ${bodyLines[0]}`;
  const continuation = bodyLines.slice(1).map((l) => `${itemIndent}  ${l}`);
  return [firstLine, ...continuation];
}

/**
 * Append a scalar value to a nested list. Path is a dot-delimited
 * sequence (e.g. `context.standards`). The nested list must exist;
 * we don't auto-create intermediate keys.
 *
 * Used by `strengthen-context-load` applicator.
 */
export function appendToMapKey(
  yaml: string,
  keyPath: string,
  value: string,
  options: YamlEditOptions = {},
): string {
  const segments = keyPath.split(".");
  if (segments.length < 1) throw new YamlEditError(`empty keyPath`);
  // We support depth up to 2 (top-level + one nested) which covers
  // every plan §3.9 use case.
  if (segments.length > 2) {
    throw new YamlEditError(
      `appendToMapKey: depth > 2 not supported (got "${keyPath}")`,
    );
  }
  // Parse first to confirm the key exists + figure out current
  // indentation. We don't write the parsed form back — that's the
  // whole point of this module.
  const parsed = parseYaml(yaml) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new YamlEditError(`YAML root is not an object`);
  }
  if (segments.length === 1) {
    return appendListItem(yaml, segments[0], value, options);
  }
  const [outer, inner] = segments;
  const outerObj = (parsed as Record<string, unknown>)[outer];
  if (!outerObj || typeof outerObj !== "object") {
    throw new YamlEditError(`top-level key "${outer}:" missing or not a mapping`);
  }
  if (!Object.prototype.hasOwnProperty.call(outerObj, inner)) {
    throw new YamlEditError(`nested key "${outer}.${inner}" missing`);
  }
  // Locate the nested key in the raw text. We look for a line matching
  // `<indent><inner>:` at exactly outer + 2 spaces of indent (or any
  // indent greater than outer's indent — block style allows either).
  const lines = yaml.split(/\r?\n/);
  const outerRe = new RegExp(`^${outer}:\\s*$`);
  const outerLineIdx = lines.findIndex((l) => outerRe.test(l));
  if (outerLineIdx === -1) {
    throw new YamlEditError(`outer key "${outer}:" not on a line by itself`);
  }
  const outerIndent = leadingSpaces(lines[outerLineIdx]);
  const innerRe = new RegExp(`^\\s+${inner}:\\s*(\\[\\s*\\])?\\s*(#.*)?$`);
  let innerLineIdx = -1;
  for (let i = outerLineIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const ind = leadingSpaces(line);
    if (ind.length <= outerIndent.length) break;
    if (innerRe.test(line)) {
      innerLineIdx = i;
      break;
    }
  }
  if (innerLineIdx === -1) {
    throw new YamlEditError(`nested key "${inner}:" not found under "${outer}:"`);
  }
  const innerIndent = leadingSpaces(lines[innerLineIdx]);
  // Find where to insert the new list item.
  let insertAt = lines.length;
  let firstEntryIndent: string | null = null;
  for (let i = innerLineIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const ind = leadingSpaces(line);
    if (ind.length <= innerIndent.length) {
      insertAt = i;
      break;
    }
    if (line.trimStart().startsWith("- ") && firstEntryIndent === null) {
      firstEntryIndent = ind;
    }
  }
  const itemIndent = firstEntryIndent ?? innerIndent + (options.defaultIndent ?? "  ");
  // Unwrap `[]` if present.
  const innerLine = lines[innerLineIdx];
  if (/\[\s*\]/.test(innerLine)) {
    lines[innerLineIdx] = innerLine.replace(/\[\s*\]\s*(#.*)?$/, "").trimEnd();
  }
  lines.splice(insertAt, 0, `${itemIndent}- ${value}`);
  return lines.join("\n");
}

function leadingSpaces(line: string): string {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}
