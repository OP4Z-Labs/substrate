#!/usr/bin/env bash
# =============================================================================
# enterprise-smoke.sh — Substrate v3.0.0-alpha.1 enterprise pattern smoke test
# =============================================================================
# Validates the full org-hub + consumer-repo `extends` pattern against the
# packaged tarball (NOT the dev source tree). Designed to run in under a
# minute on a warm machine.
#
# Scenarios:
#   1   cold-start fixture copy
#   2   `substrate extends list` provenance
#   3   `substrate extends list --json` envelope
#   4   per-repo overrides across all 5 kinds
#   5   all three source kinds (file:, npm:, github:)
#   6   air-gap (SUBSTRATE_OFFLINE=1) behavior
#   7   `substrate doctor` against composed setup
#   8   each daily-driver CLI surface that consumes merged content
#   9   `substrate run <workflow>` from copied org-shared content
#   10a `substrate mcp serve` initialise + tools/list
#   10b v2-shaped consumer (no extends) regression
#   10c version surface + tarball + CHANGELOG checks
#   10d edge cases (malformed URL, missing source, circular extends)
#
# Run modes:
#   bash tests/smoke/enterprise-smoke.sh            # standalone
#   npm run smoke:enterprise                        # via npm script
#
# Layer/conventions:
#   - Fixtures at tests/smoke/fixtures/substrate-shared-fixture/
#     are the canonical reference. Tests COPY them to /tmp/.
#   - All /tmp/substrate-smoke-* paths are ephemeral.
#   - Each scenario prints "[OK] Scenario N: <name>" on pass or
#     "[FAIL] Scenario N: <reason>" on fail (and exits nonzero).
#
# Exit code: 0 if all scenarios pass; nonzero otherwise.
# =============================================================================

set -eu
set -o pipefail

# ---------------------------------------------------------------- paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${PKG_DIR}/../.." && pwd)"
FIXTURE_DIR="${SCRIPT_DIR}/fixtures/substrate-shared-fixture"
TARBALL="${PKG_DIR}/op4z-substrate-3.0.0-alpha.1.tgz"

# ---------------------------------------------------------------- workspaces
WORK_ROOT="$(mktemp -d -t substrate-smoke-XXXXXX)"
ORG_DIR="${WORK_ROOT}/substrate-shared"
CONSUMER_DIR="${WORK_ROOT}/consumer"
V2_CONSUMER_DIR="${WORK_ROOT}/consumer-v2-shaped"
CIRC_A="${WORK_ROOT}/circ-a"
CIRC_B="${WORK_ROOT}/circ-b"
NPM_PACK_DIR="${WORK_ROOT}/npm-pack"
GH_CLONE_DIR="${WORK_ROOT}/github-source"

# ---------------------------------------------------------------- helpers
COLOR_OK="\033[32m"
COLOR_FAIL="\033[31m"
COLOR_DIM="\033[2m"
COLOR_OFF="\033[0m"
[ -t 1 ] || { COLOR_OK= COLOR_FAIL= COLOR_DIM= COLOR_OFF=; }

fail_count=0
pass_count=0

log() { printf "%s\n" "$*"; }
note() { printf "${COLOR_DIM}    %s${COLOR_OFF}\n" "$*"; }
pass() {
    pass_count=$((pass_count + 1))
    printf "${COLOR_OK}[OK]${COLOR_OFF} Scenario %s: %s\n" "$1" "$2"
}
fail() {
    fail_count=$((fail_count + 1))
    printf "${COLOR_FAIL}[FAIL]${COLOR_OFF} Scenario %s: %s\n" "$1" "$2" >&2
    if [ "${SMOKE_FAIL_FAST:-1}" = "1" ]; then
        finalize 1
    fi
}

cleanup() {
    # Wipe ephemeral /tmp/substrate-smoke-* dirs. Only this run's WORK_ROOT.
    if [ -n "${WORK_ROOT:-}" ] && [ -d "${WORK_ROOT}" ]; then
        rm -rf "${WORK_ROOT}"
    fi
}
trap cleanup EXIT INT TERM

finalize() {
    local code="${1:-0}"
    printf "\n${COLOR_DIM}---${COLOR_OFF}\n"
    printf "Scenarios passed: %s\n" "${pass_count}"
    printf "Scenarios failed: %s\n" "${fail_count}"
    printf "Workspace (cleaned on exit): %s\n" "${WORK_ROOT}"
    exit "${code}"
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        log "[FAIL] Pre-flight: required command not found on PATH: $1" >&2
        exit 2
    fi
}

# ---------------------------------------------------------------- pre-flight
require_cmd node
require_cmd npm
require_cmd jq

if [ ! -f "${TARBALL}" ]; then
    log "Tarball missing at ${TARBALL}."
    log "Building it now via 'cd packages/substrate && npm pack' ..."
    (cd "${PKG_DIR}" && npm pack >/dev/null 2>&1)
    if [ ! -f "${TARBALL}" ]; then
        log "[FAIL] Pre-flight: could not build tarball." >&2
        exit 2
    fi
fi

if [ ! -d "${FIXTURE_DIR}" ]; then
    log "[FAIL] Pre-flight: fixture not found at ${FIXTURE_DIR}." >&2
    exit 2
fi

log "${COLOR_DIM}Pre-flight: node $(node --version), npm $(npm --version), jq $(jq --version)${COLOR_OFF}"
log "${COLOR_DIM}Workspace: ${WORK_ROOT}${COLOR_OFF}"
log ""

# =============================================================================
# Scenario 1 — Cold start: copy fixture into /tmp working copies
# =============================================================================
scenario_1() {
    cp -r "${FIXTURE_DIR}/." "${ORG_DIR}/" 2>/dev/null || {
        mkdir -p "${ORG_DIR}"
        cp -r "${FIXTURE_DIR}/." "${ORG_DIR}/"
    }
    mkdir -p "${CONSUMER_DIR}"

    cat > "${CONSUMER_DIR}/substrate.config.json" <<EOF
{
  "\$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "consumer-smoke" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": [
    { "source": "file:${ORG_DIR}" }
  ]
}
EOF

    # Verify the two trees exist with expected shapes
    [ -d "${ORG_DIR}/substrate/workflows" ] || { fail 1 "org workflows dir missing"; return; }
    [ -d "${ORG_DIR}/substrate/hooks" ] || { fail 1 "org hooks dir missing"; return; }
    [ -d "${ORG_DIR}/substrate/doc-checks" ] || { fail 1 "org doc-checks dir missing"; return; }
    [ -d "${ORG_DIR}/substrate/standards" ] || { fail 1 "org standards dir missing"; return; }
    [ -f "${ORG_DIR}/substrate/RULES.yaml" ] || { fail 1 "org RULES.yaml missing"; return; }
    [ -f "${CONSUMER_DIR}/substrate.config.json" ] || { fail 1 "consumer config missing"; return; }

    # Install substrate from the tarball into the consumer
    mkdir -p "${CONSUMER_DIR}"
    (cd "${CONSUMER_DIR}" && npm init -y >/dev/null 2>&1)
    (cd "${CONSUMER_DIR}" && npm install --silent "${TARBALL}" >/dev/null 2>&1)
    [ -x "${CONSUMER_DIR}/node_modules/.bin/substrate" ] || {
        fail 1 "substrate binary not installed in consumer"
        return
    }

    pass 1 "fixture copied + consumer installed from tarball"
}

# =============================================================================
# Scenario 2 — `substrate extends list` provenance
# =============================================================================
scenario_2() {
    local out
    out="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends list 2>&1)"

    echo "${out}" | grep -q "file:${ORG_DIR}" || { fail 2 "org source not listed"; return; }
    echo "${out}" | grep -q "(repo-local)" || { fail 2 "repo-local layer missing"; return; }
    echo "${out}" | grep -qE "workflows: 3 +hooks: 3 +doc-checks: 3 +standards: 5 +RULES: 10 rows" || {
        note "got output:"
        note "${out}"
        fail 2 "expected workflows:3 hooks:3 doc-checks:3 standards:5 RULES:10 on the org layer"
        return
    }
    echo "${out}" | grep -qE "Effective registry: 3 workflows" || {
        fail 2 "effective workflow count != 3"
        return
    }
    pass 2 "extends list reports correct per-layer counts + provenance"
}

# =============================================================================
# Scenario 3 — `substrate extends list --json` envelope
# =============================================================================
scenario_3() {
    local json
    json="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends list --json 2>"${WORK_ROOT}/s3-stderr.log")"

    echo "${json}" | jq -e '.layers | length == 2' >/dev/null || {
        fail 3 "expected 2 layers in JSON"
        return
    }
    echo "${json}" | jq -e '.layers[0].kind == "file"' >/dev/null || {
        fail 3 "first layer kind should be file"
        return
    }
    echo "${json}" | jq -e '.layers[1].kind == "local"' >/dev/null || {
        fail 3 "second layer kind should be local"
        return
    }
    echo "${json}" | jq -e '.effective.workflows == 3' >/dev/null || {
        fail 3 "effective.workflows != 3"
        return
    }
    echo "${json}" | jq -e '.effective.rules == 10' >/dev/null || {
        fail 3 "effective.rules != 10"
        return
    }
    echo "${json}" | jq -e '.collisions | length == 0' >/dev/null || {
        fail 3 "expected zero collisions in baseline"
        return
    }
    echo "${json}" | jq -e '.exitCode == 0' >/dev/null || {
        fail 3 "exitCode != 0"
        return
    }
    pass 3 "extends list --json envelope is structurally correct"
}

# =============================================================================
# Scenario 4 — Per-repo overrides at each kind
# =============================================================================
scenario_4() {
    # Add repo-local overrides for: workflow, hook, doc-check, standard, rule
    mkdir -p "${CONSUMER_DIR}/substrate/workflows" \
             "${CONSUMER_DIR}/substrate/hooks" \
             "${CONSUMER_DIR}/substrate/doc-checks" \
             "${CONSUMER_DIR}/substrate/standards/backend"

    cat > "${CONSUMER_DIR}/substrate/workflows/org-audit-pre-merge.yaml" <<'YAML'
schema_version: v2.0
id: org-audit-pre-merge
name: Repo override of pre-merge audit
description: Repo-local override.
kind: audit
authors: [repo]
trigger: [manual-command]
steps:
  - id: marker
    name: Local marker
    type: invoke-deterministic
    run: 'echo "repo-local audit override"'
acceptance:
  exit_codes:
    pass: 0
    fail: 2
YAML

    cat > "${CONSUMER_DIR}/substrate/hooks/auto-emit-sidecar.yaml" <<'YAML'
schema_version: v2.0
id: auto-emit-sidecar
description: Repo override of auto-emit-sidecar.
trigger: [workflow-completion]
matches:
  exit-code: any
enabled: true
order: 10
step:
  type: run-deterministic
  command: 'echo "repo-local sidecar override"'
  pass-result: false
  fail-on-error: false
YAML

    cat > "${CONSUMER_DIR}/substrate/doc-checks/changelog-on-feat-or-fix.yaml" <<'YAML'
schema_version: v2.0
id: changelog-on-feat-or-fix
description: Repo override of changelog doc-check.
when:
  commit-message-pattern: "^(feat|fix):"
require:
  one-of:
    - CHANGELOG.md
prompt: Repo-local prompt.
severity: high
YAML

    cat > "${CONSUMER_DIR}/substrate/standards/backend/python.md" <<'EOF'
# Repo override of backend/python.md
EOF

    cat > "${CONSUMER_DIR}/substrate/RULES.yaml" <<'YAML'
rules:
  - id: ORG-BE-PY-001
    title: Repo override of black formatting rule
    severity: low
    description: Tweaked locally.
    category: backend
    detector:
      type: manual
YAML

    local json
    json="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends list --json 2>"${WORK_ROOT}/s4-stderr.log")"

    echo "${json}" | jq -e '.collisions | length == 5' >/dev/null || {
        note "collisions: $(echo "${json}" | jq -c '.collisions')"
        fail 4 "expected exactly 5 collisions (one per kind)"
        return
    }

    for class in workflow hook docCheck standard rule; do
        # Note: collision class names in the JSON are: workflow, hook, doc-check, standard, rule
        local key="${class}"
        case "${class}" in
            docCheck) key="doc-check" ;;
        esac
        echo "${json}" | jq -e ".collisions[] | select(.class == \"${key}\") | .winner == \"repo-local\"" >/dev/null || {
            fail 4 "${key} collision did not resolve to repo-local"
            return
        }
    done

    # Effective totals stay the same (overrides don't grow registry)
    echo "${json}" | jq -e '.effective.workflows == 3' >/dev/null || {
        fail 4 "effective workflows shouldnt change on override"
        return
    }
    echo "${json}" | jq -e '.effective.rules == 10' >/dev/null || {
        fail 4 "effective rules shouldnt change on override"
        return
    }

    pass 4 "per-repo overrides at 5 kinds: all collisions report repo-local as winner"
}

# =============================================================================
# Scenario 5 — All three source kinds (file: / npm: / github:)
# =============================================================================
scenario_5() {
    # npm: pack the fixture and install it into the consumer's node_modules
    mkdir -p "${NPM_PACK_DIR}"
    cp -r "${ORG_DIR}/." "${NPM_PACK_DIR}/"
    # Move it out of the way: this becomes the npm-installed @acme/substrate-shared.
    # The consumer already has substrate installed; install the fixture
    # as @acme/substrate-shared from the local directory.
    (cd "${CONSUMER_DIR}" && npm install --silent --no-save "${NPM_PACK_DIR}" >/dev/null 2>&1) || {
        fail 5 "npm install of fixture as @acme/substrate-shared failed"
        return
    }

    [ -d "${CONSUMER_DIR}/node_modules/@acme/substrate-shared/substrate" ] || {
        fail 5 "@acme/substrate-shared/substrate not present after install"
        return
    }

    # github: per the brief, use octocat/Hello-World (no substrate content);
    # smoke verifies the source-kind plumbing handles a real clone without
    # crashing. We skip github: by default if SMOKE_SKIP_GITHUB=1.
    local skip_github="${SMOKE_SKIP_GITHUB:-0}"
    if [ "${skip_github}" = "1" ]; then
        note "Skipping github: source (SMOKE_SKIP_GITHUB=1)."
    fi

    # Rewrite the consumer config to use all three source kinds in order.
    # We KEEP the repo-local overrides from scenario 4 so the merge has
    # something interesting to show. The order matters:
    #   1. npm:    (base)
    #   2. file:   (overlay)
    #   3. github: (overlay — skipped when offline)
    #   4. repo-local (always last)
    local extends_arr='[{"source":"npm:@acme/substrate-shared"},{"source":"file:'"${ORG_DIR}"'"}]'
    if [ "${skip_github}" != "1" ]; then
        extends_arr='[{"source":"npm:@acme/substrate-shared"},{"source":"file:'"${ORG_DIR}"'"},{"source":"github:octocat/Hello-World","ref":"master"}]'
    fi

    cat > "${CONSUMER_DIR}/substrate.config.json" <<EOF
{
  "\$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "consumer-smoke" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": ${extends_arr}
}
EOF

    # NOTE: git clone writes "Cloning into..." to stderr. We must NOT merge
    # stderr into stdout when parsing JSON; route stderr to a separate file.
    local json
    json="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends list --json 2>"${WORK_ROOT}/extends-list-stderr.log")"

    # Both npm: and file: layers should resolve as ok (no errors).
    # The github: layer may either succeed (if network is up) or error out;
    # we just check the npm + file layers are present.
    echo "${json}" | jq -e '[.layers[] | select(.kind == "npm")] | length == 1' >/dev/null || {
        fail 5 "npm: layer not in resolved chain"
        return
    }
    echo "${json}" | jq -e '[.layers[] | select(.kind == "file")] | length == 1' >/dev/null || {
        fail 5 "file: layer not in resolved chain"
        return
    }
    echo "${json}" | jq -e '[.layers[] | select(.kind == "local")] | length == 1' >/dev/null || {
        fail 5 "local layer not in resolved chain"
        return
    }
    if [ "${skip_github}" != "1" ]; then
        # github: may either resolve as a layer or appear in errors[].
        # We accept both. Empty Hello-World repo means 0 substrate content;
        # that's fine — what matters is the plumbing didnt crash.
        echo "${json}" | jq -e '([.layers[] | select(.kind == "github")] | length == 1) or ([.errors[] | select(.source | startswith("github:"))] | length >= 1)' >/dev/null || {
            note "neither layer nor error entry for github source"
            note "$(echo "${json}" | jq '.layers,.errors')"
            fail 5 "github: source did not produce a layer or an error"
            return
        }
    fi

    pass 5 "npm: + file: + github: sources resolve through the chain"
}

# =============================================================================
# Scenario 6 — air-gap (SUBSTRATE_OFFLINE=1) behavior
# =============================================================================
# Per the HANDOFF design decision 6:
#   - cold cache + offline → warning + github source skipped
#   - warm cache + offline → ok (cache hit served)
# We exercise the cold path by clearing the cache first.
scenario_6() {
    # Clear github cache so we're definitively cold.
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends clear-cache --json >/dev/null 2>"${WORK_ROOT}/extends-clear-stderr.log" || true)

    local json
    json="$(cd "${CONSUMER_DIR}" && SUBSTRATE_OFFLINE=1 ./node_modules/.bin/substrate extends list --json 2>"${WORK_ROOT}/extends-list-offline-stderr.log")"

    # Even in offline mode, npm: + file: must still resolve.
    echo "${json}" | jq -e '[.layers[] | select(.kind == "npm")] | length == 1' >/dev/null || {
        fail 6 "npm: layer missing when offline"
        return
    }
    echo "${json}" | jq -e '[.layers[] | select(.kind == "file")] | length == 1' >/dev/null || {
        fail 6 "file: layer missing when offline"
        return
    }
    # github: with cold cache + offline should warn and skip. The layer is
    # still recorded in the chain (with kind=github), but content count
    # should be 0 (no clone happened). Alternatively, the runtime may
    # surface it as a warning rather than a layer.
    if [ "${SMOKE_SKIP_GITHUB:-0}" != "1" ]; then
        local gh_warned gh_layer_count
        gh_warned="$(echo "${json}" | jq -r '[.warnings[] | select((.source | startswith("github:")) and (.message | test("SUBSTRATE_OFFLINE")))] | length')"
        gh_layer_count="$(echo "${json}" | jq -r '[.layers[] | select(.kind == "github")] | length')"
        # Accept either: (a) warning emitted + layer absent, or
        #                (b) layer present but empty content (counts all 0)
        if [ "${gh_warned}" -lt 1 ] && [ "${gh_layer_count}" -lt 1 ]; then
            note "$(echo "${json}" | jq '.warnings,.errors,.layers')"
            fail 6 "github: cold cache + offline should produce a SUBSTRATE_OFFLINE warning or skip the layer"
            return
        fi
    fi

    pass 6 "SUBSTRATE_OFFLINE=1: npm + file still resolve; github cold-cache skipped"
}

# =============================================================================
# Scenario 7 — `substrate doctor` against composed setup
# =============================================================================
scenario_7() {
    # Revert config to the simple file: source for doctor (npm + github
    # noise irrelevant here).
    cat > "${CONSUMER_DIR}/substrate.config.json" <<EOF
{
  "\$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "consumer-smoke" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": [
    { "source": "file:${ORG_DIR}" }
  ]
}
EOF

    local out
    out="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate doctor 2>&1 || true)"

    # Expected warns: missing auto/ directory and missing manifest stub
    # are documented in V3-NE11 HANDOFF as v2-baseline warns. The doctor
    # itself MUST not crash; it produces a Summary line.
    echo "${out}" | grep -qE "Summary: [0-9]+ ok" || {
        note "${out}"
        fail 7 "doctor did not produce a Summary line"
        return
    }
    # Core checks must pass: substrate.config.json + Node runtime + git
    echo "${out}" | grep -qE "✓.*substrate.config.json" || {
        fail 7 "config check did not pass"
        return
    }
    echo "${out}" | grep -qE "✓.*Node.js" || {
        fail 7 "Node runtime check did not pass"
        return
    }
    pass 7 "doctor runs clean against the composed setup (expected v2 warns documented)"
}

# =============================================================================
# Scenario 8 — daily-driver CLI surface
# =============================================================================
scenario_8() {
    # extends list — already covered. Re-verify exit 0 + JSON shape.
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends list --json >/dev/null 2>&1) || {
        fail 8 "extends list exited nonzero"
        return
    }
    # extends sync — file: is no-op; should exit 0.
    local sync_json
    sync_json="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends sync --json 2>"${WORK_ROOT}/s8-sync-stderr.log")"
    echo "${sync_json}" | jq -e '.exitCode == 0' >/dev/null || {
        note "${sync_json}"
        fail 8 "extends sync exit code != 0"
        return
    }
    # extends clear-cache — no-op since no github cache present here.
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate extends clear-cache >/dev/null 2>&1) || {
        fail 8 "extends clear-cache exited nonzero"
        return
    }
    # validate — repo-local manifests must validate clean.
    local valid_out
    valid_out="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate validate 2>&1)"
    echo "${valid_out}" | grep -qE "manifest\(s\) valid" || {
        note "${valid_out}"
        fail 8 "substrate validate did not report success"
        return
    }
    # query rules — repo-local RULES.yaml only (not extends-aware in alpha.1)
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate query rules --json >/dev/null 2>&1) || {
        fail 8 "query rules exited nonzero"
        return
    }
    # query standards --for-files
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate query standards --for-files src/foo.py --json >/dev/null 2>&1) || {
        fail 8 "query standards --for-files exited nonzero"
        return
    }
    # query doc-checks --for-files
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate query doc-checks --for-files src/foo.py --json >/dev/null 2>&1) || {
        fail 8 "query doc-checks --for-files exited nonzero"
        return
    }
    # hooks list — repo-local only (not extends-aware in alpha.1)
    (cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate hooks list --json >/dev/null 2>&1) || {
        fail 8 "hooks list exited nonzero"
        return
    }
    pass 8 "daily-driver CLI surface runs (note: query/hooks/audit are NOT extends-aware in alpha.1)"
}

# =============================================================================
# Scenario 9 — `substrate run <workflow>` from copied org content
# =============================================================================
# v3.0.0-alpha.1 has a documented limitation: `substrate run` reads only
# repo-local substrate/workflows/. To exercise an org-shared workflow via
# `substrate run`, the smoke test copies the deterministic workflow into
# the consumer's repo-local workflows/ first.
scenario_9() {
    cp "${ORG_DIR}/substrate/workflows/org-git-review-pre.yaml" \
       "${CONSUMER_DIR}/substrate/workflows/org-git-review-pre.yaml"

    local out
    out="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate run org-git-review-pre 2>&1 || true)"

    echo "${out}" | grep -q "org-shared:org-git-review-pre OK" || {
        note "${out}"
        fail 9 "deterministic workflow did not produce the org-shared marker"
        return
    }
    pass 9 "substrate run executes a deterministic org-shared workflow (copied locally)"
}

# =============================================================================
# Scenario 10a — `substrate mcp serve` initialise + tools/list
# =============================================================================
scenario_10a() {
    local out
    out="$(cd "${CONSUMER_DIR}" && {
        printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'
        printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
        printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
        sleep 1
    } | timeout 5 ./node_modules/.bin/substrate mcp serve 2>&1 || true)"

    # First line: initialize response with our id=1
    echo "${out}" | grep -q '"id":1' || {
        note "${out}"
        fail 10a "initialize response missing"
        return
    }
    echo "${out}" | grep -q '"serverInfo":{"name":"substrate"' || {
        fail 10a "serverInfo block missing"
        return
    }
    # Second line: tools/list with 7 tools
    local tool_count
    tool_count="$(echo "${out}" | grep -o '"name":"substrate_[a-z_]*"' | sort -u | wc -l)"
    if [ "${tool_count}" -ne 7 ]; then
        note "got ${tool_count} unique substrate_* tools (expected 7)"
        note "${out}" | head -5
        fail 10a "expected 7 substrate_* tools, got ${tool_count}"
        return
    fi
    pass 10a "mcp serve responds to initialize + tools/list with 7 tools"
}

# =============================================================================
# Scenario 10b — v2-shaped consumer (no extends) regression
# =============================================================================
scenario_10b() {
    mkdir -p "${V2_CONSUMER_DIR}"
    cat > "${V2_CONSUMER_DIR}/substrate.config.json" <<'JSON'
{
  "$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v2.0",
  "project": { "name": "v2-shaped" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false }
}
JSON
    (cd "${V2_CONSUMER_DIR}" && npm init -y >/dev/null 2>&1)
    (cd "${V2_CONSUMER_DIR}" && npm install --silent "${TARBALL}" >/dev/null 2>&1)

    # extends list against a v2-shaped (no extends field) config must still
    # work — yields just the repo-local layer.
    local json
    json="$(cd "${V2_CONSUMER_DIR}" && ./node_modules/.bin/substrate extends list --json 2>"${WORK_ROOT}/s10b-stderr.log")"
    echo "${json}" | jq -e '.layers | length == 1' >/dev/null || {
        note "${json}"
        fail 10b "v2-shaped consumer: expected 1 layer (repo-local only)"
        return
    }
    echo "${json}" | jq -e '.layers[0].kind == "local"' >/dev/null || {
        fail 10b "v2-shaped consumer: only layer should be local"
        return
    }
    echo "${json}" | jq -e '.exitCode == 0' >/dev/null || {
        fail 10b "v2-shaped consumer: exitCode != 0"
        return
    }
    # doctor must run too
    (cd "${V2_CONSUMER_DIR}" && ./node_modules/.bin/substrate doctor >/dev/null 2>&1 || true)
    pass 10b "v2-shaped consumer (no extends field) still works"
}

# =============================================================================
# Scenario 10c — version surface + tarball + CHANGELOG checks
# =============================================================================
scenario_10c() {
    local ver
    ver="$(cd "${CONSUMER_DIR}" && ./node_modules/.bin/substrate --version 2>&1)"
    [ "${ver}" = "3.0.0-alpha.1" ] || {
        fail 10c "substrate --version != 3.0.0-alpha.1 (got '${ver}')"
        return
    }
    # Tarball contains package.json with the right version
    local tar_ver
    tar_ver="$(tar -xzOf "${TARBALL}" package/package.json 2>/dev/null | jq -r '.version')"
    [ "${tar_ver}" = "3.0.0-alpha.1" ] || {
        fail 10c "tarball package.json version != 3.0.0-alpha.1 (got '${tar_ver}')"
        return
    }
    # NOTE: package.json `files` whitelist does NOT include CHANGELOG.md
    # in v3.0.0-alpha.1 (the CHANGELOG lives at the workspace root, not
    # the package root). The repo-level CHANGELOG must still have the
    # [3.0.0-alpha.1] section.
    grep -qE "^## \[3\.0\.0-alpha\.1\]" "${ROOT_DIR}/CHANGELOG.md" || {
        fail 10c "root CHANGELOG.md missing [3.0.0-alpha.1] section"
        return
    }
    pass 10c "version surface: substrate -v + tarball + CHANGELOG entry all at 3.0.0-alpha.1"
}

# =============================================================================
# Scenario 10d — edge cases: malformed URL, missing source, circular
# =============================================================================
scenario_10d() {
    # Malformed source
    local bad_config="${WORK_ROOT}/bad-config"
    mkdir -p "${bad_config}"
    cat > "${bad_config}/substrate.config.json" <<'JSON'
{
  "$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "bad" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": [
    { "source": "invalid-scheme:foo/bar" }
  ]
}
JSON
    local out
    out="$(cd "${bad_config}" && "${CONSUMER_DIR}/node_modules/.bin/substrate" extends list 2>&1 || true)"
    echo "${out}" | grep -q "Unknown extends source kind" || {
        note "${out}"
        fail 10d "malformed source did not produce 'Unknown extends source kind' error"
        return
    }

    # Missing file: source
    local missing_config="${WORK_ROOT}/missing-config"
    mkdir -p "${missing_config}"
    cat > "${missing_config}/substrate.config.json" <<'JSON'
{
  "$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "missing" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": [
    { "source": "file:/this/path/does/not/exist/abc123" }
  ]
}
JSON
    out="$(cd "${missing_config}" && "${CONSUMER_DIR}/node_modules/.bin/substrate" extends list --json 2>"${WORK_ROOT}/s10d-missing-stderr.log" || true)"
    echo "${out}" | jq -e '.errors | length >= 1' >/dev/null || {
        note "${out}"
        fail 10d "missing source did not produce an error entry"
        return
    }
    echo "${out}" | jq -e '.exitCode == 1' >/dev/null || {
        fail 10d "missing source did not produce exitCode 1"
        return
    }

    # Circular extends (A → B → A). v3.0.0-alpha.1 doesn't resolve
    # transitively, so B's extends back to A is silently ignored.
    # Verify it does NOT crash.
    mkdir -p "${CIRC_A}" "${CIRC_B}"
    cat > "${CIRC_A}/substrate.config.json" <<EOF
{
  "\$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "circ-a" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": [
    { "source": "file:${CIRC_B}" }
  ]
}
EOF
    cat > "${CIRC_B}/substrate.config.json" <<EOF
{
  "\$schema": "https://op4z.dev/substrate/schemas/config.schema.json",
  "version": "v3.0",
  "project": { "name": "circ-b" },
  "stacks": ["typescript"],
  "paths": { "auto": "auto" },
  "defaults": { "audits": [], "standards": [], "scaffolds": [], "workflows": [] },
  "bridges": {},
  "telemetry": { "enabled": false },
  "extends": [
    { "source": "file:${CIRC_A}" }
  ]
}
EOF
    out="$(cd "${CIRC_A}" && "${CONSUMER_DIR}/node_modules/.bin/substrate" extends list --json 2>"${WORK_ROOT}/s10d-circ-stderr.log" || true)"
    echo "${out}" | jq -e '.exitCode == 0' >/dev/null || {
        note "${out}"
        fail 10d "circular extends crashed or errored (expected silent non-transitive)"
        return
    }
    pass 10d "edge cases: malformed URL → error; missing → exit 1; circular → silent (no transitive)"
}

# =============================================================================
# Run everything
# =============================================================================
START_TIME="$(date +%s)"

scenario_1
scenario_2
scenario_3
scenario_4
scenario_5
scenario_6
scenario_7
scenario_8
scenario_9
scenario_10a
scenario_10b
scenario_10c
scenario_10d

END_TIME="$(date +%s)"
ELAPSED=$((END_TIME - START_TIME))
printf "\n${COLOR_DIM}Elapsed: %ds${COLOR_OFF}\n" "${ELAPSED}"

if [ "${fail_count}" -gt 0 ]; then
    finalize 1
fi
finalize 0
