#!/usr/bin/env node
/**
 * Substrate GitHub Action — v0.8 entry point.
 *
 * Wraps the `substrate` CLI for CI use. Reads inputs from `INPUT_*` env
 * vars (the GitHub Actions convention), shells out to `npx @op4z/substrate@<version>
 * <command>`, captures stdout/stderr, writes a structured report to
 * `substrate-report.json`, and surfaces outputs to subsequent workflow steps.
 *
 * Design decisions:
 *
 * 1. Pure node stdlib, zero deps. No `@actions/core` — we use the file-
 *    based output API documented at
 *    https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-output-parameter
 *    and the env-var input convention. Keeping the action dep-free
 *    eliminates a `dist/` bundling pipeline.
 *
 * 2. ESM module (the repo root's package.json is `type: "module"`).
 *    Action runs under Node 20's `node20` runtime per action.yml.
 *
 * 3. Always installs substrate via npx. The action user doesn't need a
 *    preceding `npm install` step in their workflow; `npx -y @op4z/substrate@<version>`
 *    handles fetch + run in one step.
 *
 * 4. `fail-on` is enforced at the action layer, not the CLI layer.
 *    The CLI itself exits 0 for "audit ran and found findings"; the
 *    action interprets findings and decides whether to fail the job.
 *
 * 5. Report is always written, even on failure. CI tooling
 *    (artifact upload, PR comments) can consume the JSON regardless
 *    of whether the action passed.
 *
 * Inputs (via INPUT_<UPPERCASED_HYPHENS_TO_UNDERSCORES>):
 *   - INPUT_COMMAND          : "audit --type backend", required
 *   - INPUT_WORKING_DIRECTORY: defaults to process.cwd()
 *   - INPUT_VERSION          : npm tag/version, default "latest"
 *   - INPUT_FAIL_ON          : "none" | "error" | "warning", default "error"
 *
 * Outputs (written to $GITHUB_OUTPUT):
 *   - exit-code  : numeric exit code of the substrate command
 *   - stdout     : captured stdout (truncated to 64KB)
 *   - stderr     : captured stderr (truncated to 64KB)
 *   - report-path: path to substrate-report.json relative to working dir
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const OUTPUT_SIZE_LIMIT = 64 * 1024;

function getInput(name, fallback = "") {
  // GitHub Actions exposes inputs as INPUT_<NAME>, uppercase, hyphens
  // converted to underscores. The action.yml input `working-directory`
  // becomes `INPUT_WORKING_DIRECTORY`.
  const key = "INPUT_" + name.replace(/-/g, "_").toUpperCase();
  return (process.env[key] ?? "").trim() || fallback;
}

function setOutput(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) {
    // Local-run fallback: print so a human can see what would happen.
    console.log(`[output] ${name}=${truncate(value)}`);
    return;
  }
  // Multi-line outputs use heredoc framing per the GHA docs. We pick a
  // delimiter unlikely to appear in any tool output.
  const delim = `_SUBSTRATE_OUT_${Date.now()}_`;
  appendFileSync(path, `${name}<<${delim}\n${value}\n${delim}\n`, "utf8");
}

function truncate(value) {
  const s = typeof value === "string" ? value : String(value);
  if (s.length <= OUTPUT_SIZE_LIMIT) return s;
  return (
    s.slice(0, OUTPUT_SIZE_LIMIT) +
    `\n... (truncated; full output ${s.length} bytes)`
  );
}

function log(level, message) {
  // GitHub Actions log levels: ::notice / ::warning / ::error
  if (level === "warning") {
    console.log(`::warning::${message}`);
  } else if (level === "error") {
    console.log(`::error::${message}`);
  } else {
    console.log(`::notice::${message}`);
  }
}

function main() {
  const command = getInput("command");
  if (!command) {
    log("error", "Required input `command` is missing.");
    process.exit(2);
  }
  const workingDirectory = getInput("working-directory") || process.cwd();
  const version = getInput("version", "latest");
  const failOn = getInput("fail-on", "error").toLowerCase();
  const validFailOn = ["none", "error", "warning"];
  if (!validFailOn.includes(failOn)) {
    log(
      "error",
      `Invalid \`fail-on\` value "${failOn}". Use one of: ${validFailOn.join(", ")}.`,
    );
    process.exit(2);
  }

  const workdir = resolve(workingDirectory);
  if (!existsSync(workdir)) {
    log("error", `Working directory does not exist: ${workdir}`);
    process.exit(2);
  }

  // Split the user-supplied command on whitespace. We avoid shell:true to
  // keep the surface narrow; users who need shell features can wrap the
  // action in their own bash step.
  const args = command.match(/\S+/g) ?? [];
  const npxArgs = ["-y", `@op4z/substrate@${version}`, ...args];

  log("notice", `Running: npx ${npxArgs.join(" ")}`);
  const result = spawnSync("npx", npxArgs, {
    cwd: workdir,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? -1;

  // Always write a report, even on failure.
  const reportDir = workdir;
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = join(reportDir, "substrate-report.json");
  const report = {
    substrateVersion: version,
    command,
    workingDirectory: workdir,
    exitCode,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    timestamp: new Date().toISOString(),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  setOutput("exit-code", String(exitCode));
  setOutput("stdout", stdout);
  setOutput("stderr", stderr);
  setOutput("report-path", reportPath);

  // Surface output to the workflow log for visibility.
  if (stdout) {
    console.log("--- substrate stdout ---");
    console.log(stdout);
  }
  if (stderr) {
    console.log("--- substrate stderr ---");
    console.log(stderr);
  }

  // Decide pass/fail per `fail-on`.
  if (failOn === "none") {
    log("notice", `substrate exit code: ${exitCode} (fail-on=none, ignoring).`);
    process.exit(0);
  }

  if (exitCode === 0) {
    log("notice", "substrate completed successfully.");
    process.exit(0);
  }

  // The CLI exits non-zero for any failure (broken command, error-level
  // finding, etc.). For v0.8 we treat any non-zero as an error.
  // `fail-on=warning` is a forward-compatible name — when substrate
  // commands grow a richer severity axis (v1.0), warning-level findings
  // will exit with a distinct code that this branch can trip on.
  if (failOn === "warning" || failOn === "error") {
    log("error", `substrate failed (exit code ${exitCode}).`);
    process.exit(exitCode);
  }
  process.exit(exitCode);
}

main();
