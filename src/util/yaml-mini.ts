/**
 * Minimal YAML parser for the narrow shapes Cadence needs.
 *
 * Supports just enough to read `docker-compose.yml` files and structured
 * configs:
 *   - Block-style mappings (`key: value`)
 *   - Block-style sequences (`- value` or `- key: value`)
 *   - Inline values (strings, integers, booleans, null)
 *   - Inline arrays `[a, b, c]`
 *   - Inline maps `{a: 1, b: 2}` (limited)
 *   - Comments (`#`)
 *   - Two-space indentation (the docker-compose convention)
 *
 * Does NOT support:
 *   - Anchors / aliases (`&foo`, `*foo`)
 *   - Multi-line scalars (`|`, `>`)
 *   - Tagged scalars (`!!str`)
 *   - Tab indentation
 *
 * For a full parser, depend on `yaml` or `js-yaml`. We avoid the
 * dependency in v0.3 to keep `cadence` install-time light; v0.5's
 * upgrade flow will reach for a real parser if needed.
 */

type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  raw: string;
  indent: number;
  content: string;
}

function tokenizeLines(source: string): Line[] {
  const out: Line[] = [];
  for (const raw of source.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    let i = 0;
    while (i < raw.length && raw[i] === " ") i += 1;
    out.push({ raw, indent: i, content: raw.slice(i).replace(/\s+#.*$/, "") });
  }
  return out;
}

export function parseYaml(source: string): YamlValue {
  const lines = tokenizeLines(source);
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  if (start >= lines.length) return [null, start];
  const line = lines[start];
  if (line.content.startsWith("- ") || line.content === "-") {
    return parseSequence(lines, start, indent);
  }
  return parseMapping(lines, start, indent);
}

function parseSequence(lines: Line[], start: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && lines[i].content.startsWith("-")) {
    const after = lines[i].content === "-" ? "" : lines[i].content.slice(2);
    if (after === "") {
      // Block sub-element: parse the next deeper block.
      i += 1;
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        items.push(value);
        i = next;
      } else {
        items.push(null);
      }
    } else if (looksLikeMapKey(after)) {
      // Inline map start on the same line as the dash, e.g.
      //   - name: foo
      //     port: 80
      const synthetic: Line = { raw: lines[i].raw, indent: indent + 2, content: after };
      const synLines = [synthetic, ...lines.slice(i + 1)];
      const [value, consumed] = parseMapping(synLines, 0, indent + 2);
      items.push(value);
      // `consumed` includes the synthetic line; advance i by the number of
      // real lines we consumed (consumed - 1) plus this dash-line itself.
      const realConsumed = Math.max(1, consumed - 1);
      i += realConsumed;
    } else {
      // Plain scalar item (string, number, etc.). Strings like
      // "./app:/app" pass through untouched because they don't look
      // like a mapping key (no `: ` separator).
      items.push(parseScalar(after));
      i += 1;
    }
  }
  return [items, i];
}

function parseMapping(lines: Line[], start: number, indent: number): [YamlValue, number] {
  const out: { [key: string]: YamlValue } = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    const colon = findUnquotedColon(line.content);
    if (colon === -1) {
      // Not a mapping line — bail.
      break;
    }
    const key = unquote(line.content.slice(0, colon).trim());
    const rest = line.content.slice(colon + 1).trim();
    if (rest === "") {
      // Value is on the next indented line(s).
      i += 1;
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        out[key] = value;
        i = next;
      } else {
        out[key] = null;
      }
    } else if (rest.startsWith("[")) {
      out[key] = parseInlineArray(rest);
      i += 1;
    } else if (rest.startsWith("{")) {
      out[key] = parseInlineMap(rest);
      i += 1;
    } else {
      out[key] = parseScalar(rest);
      i += 1;
    }
  }
  return [out, i];
}

function parseScalar(input: string): YamlScalar {
  const trimmed = input.trim();
  // Quoted strings stay as strings, regardless of content. This matches
  // YAML 1.2 semantics: `"8080"` is the string "8080", not the number.
  const wasQuoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  const v = wasQuoted ? trimmed.slice(1, -1) : trimmed;
  if (wasQuoted) return v;
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}

function parseInlineArray(input: string): YamlValue[] {
  // Strip brackets and split on commas honoring quotes.
  const body = input.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (body === "") return [];
  return splitCsv(body).map((s) => parseScalar(s.trim()));
}

function parseInlineMap(input: string): { [key: string]: YamlValue } {
  const body = input.replace(/^\{/, "").replace(/\}$/, "").trim();
  const out: { [key: string]: YamlValue } = {};
  if (body === "") return out;
  for (const part of splitCsv(body)) {
    const colon = findUnquotedColon(part);
    if (colon === -1) continue;
    out[unquote(part.slice(0, colon).trim())] = parseScalar(part.slice(colon + 1).trim());
  }
  return out;
}

function splitCsv(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let inStr: string | null = null;
  for (const ch of input) {
    if (inStr) {
      buf += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function findUnquotedColon(input: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inStr) {
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === ":" && (i === input.length - 1 || input[i + 1] === " ")) {
      return i;
    }
  }
  return -1;
}

/**
 * True when `content` looks like a YAML mapping key — that is, a
 * sequence of non-whitespace chars followed by `: ` (or `:` at EOL).
 * "./app:/app" returns false; "name: foo" returns true.
 */
function looksLikeMapKey(content: string): boolean {
  const colon = findUnquotedColon(content);
  return colon !== -1;
}
