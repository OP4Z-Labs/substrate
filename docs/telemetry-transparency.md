# Substrate telemetry — transparency

> **TL;DR.** Telemetry is OFF by default. When you turn it on, substrate
> writes events to a local JSONL log on your machine. There is no
> default remote endpoint. You can ship your own collector by setting
> `SUBSTRATE_TELEMETRY_ENDPOINT` or passing `--telemetry-endpoint`.

This document is the authoritative reference for what substrate collects,
where it goes, and how to verify both.

---

## Preference & log locations

```
~/.config/substrate/telemetry.json     preference (one object)
~/.config/substrate/telemetry.log      events (one JSON object per line)
```

`XDG_CONFIG_HOME` overrides `~/.config` if set. macOS and Linux use
this path; Windows users see the same path under `%APPDATA%` via
Node's `os.homedir()`.

You can inspect both at any time:

```bash
cat ~/.config/substrate/telemetry.json
cat ~/.config/substrate/telemetry.log | head
substrate telemetry show
```

---

## Toggle

```bash
substrate config --telemetry on    # opt in
substrate config --telemetry off   # opt out
substrate config                   # current state
```

Toggling is local — substrate does not phone home to update a server
about your preference. The preference lives on your machine.

---

## Event schema (locked at v1.0)

```ts
interface TelemetryEvent {
  v: 2;                         // schema version (bumped from 1 → 2 when
                                //   the package renamed from `cadence` to
                                //   `@op4z/substrate`: the field
                                //   `cadenceVersion` became
                                //   `substrateVersion`, which is a
                                //   forbidden-field schema change, so the
                                //   contract version moved with it. v1
                                //   events on disk remain parseable —
                                //   tooling intentionally does not
                                //   schema-validate, so legacy logs from
                                //   any internal preview still round-trip.)
  ts: string;                   // ISO 8601, e.g. "2026-05-14T12:34:56.789Z"
  substrateVersion: string;     // e.g. "1.0.0"
  osFamily: string;             // "darwin" | "linux" | "win32"
  command: string;              // e.g. "audit", "init", "upgrade"
  audit?: string;               // e.g. "all", "<rule-id>"
  errorType?: string;           // e.g. "RulesLoadError" — class name ONLY
}
```

### What's collected

- The command you ran (top-level only: `substrate task create` collapses
  to `task`).
- The substrate version and OS family.
- A timestamp.
- If the command errored, the error's class name.

### What's NEVER collected

- **No file paths.** No repo names, no rule IDs (except the audit
  scope label when explicitly run), no template paths.
- **No tokens, credentials, or secrets** of any kind.
- **No user identifiers.** No name, email, machine name, GitHub
  username, or environment values.
- **No error message bodies.** Just the class name.
- **No audit findings.** Just the fact that an audit ran.
- **No rule body content.** Just whether the run produced findings (when
  substrate emits an audit-summary event in a future minor version, the
  schema will declare exactly what's added).

The forbidden-fields discipline is pinned by a unit test
(`tests/telemetry.test.ts`) — adding a path / user / message field
would fail CI.

---

## Transparency commands (v1.0)

```bash
substrate telemetry show              # human view of preference + events
substrate telemetry show --json       # machine-readable
substrate telemetry show --tail 50    # last 50 events

substrate telemetry purge --yes       # wipe preference + log
substrate telemetry export <file>     # copy log as JSONL
substrate telemetry export <file> --format csv
```

Every transparency command is read-only against your local machine
except `purge`, which deletes the local files.

---

## Forwarding to your own collector (opt-in)

If you want events to ALSO ship to a remote endpoint (e.g., your own
analytics system), set the URL via:

```bash
# Environment variable (sticks across invocations)
export SUBSTRATE_TELEMETRY_ENDPOINT="https://your.collector/substrate-events"

# Or per-invocation
substrate audit --telemetry-endpoint https://your.collector/substrate-events
```

When set, substrate POSTs the JSONL line to that URL after each command,
with these properties:

- **Fire-and-forget.** Substrate does not wait for the POST to complete
  before exiting. A slow / down collector cannot slow your CLI.
- **2-second timeout.** Hard cap on the outbound request.
- **No retries.** A failed POST is silently dropped. The local log
  still has the event.
- **Plain `Content-Type: application/json`.** The body is the same
  event shape documented above.

### Building a collector

Any HTTP endpoint that accepts `POST` with JSON body works. Minimum:

```js
// example: tiny Node express server
app.post("/substrate-events", express.json(), (req, res) => {
  console.log("substrate event:", req.body);
  res.status(204).end();
});
```

Substrate does NOT operate a hosted collector. There is no central
"substrate.io/events" endpoint. The transparency story is: you can ship
the events you collect anywhere you want, and you can verify exactly
what those events look like before they leave your machine.

---

## Why opt-in only

The substrate stance: telemetry is useful to maintainers but a privacy
cost to users. Defaulting to OFF, and documenting transparency
commands prominently, is the only ethical default. The dataset is
small enough that the maintainer doesn't need every install's events
— a curious user opting in is sufficient.

If you change your mind, `substrate telemetry purge --yes` wipes
everything.

---

## Audit trail

The locked schema, the forbidden-fields list, and the
local-by-default default are pinned by tests AND in this document.
Any change to telemetry behavior:

- Bumps `v:` in the event schema.
- Updates this document.
- Updates the `telemetry.test.ts` forbidden-fields test.
- Lands as its own commit on the substrate main branch.

The substrate repo's commit history is the audit trail.
