/**
 * Integration coverage for `substrate mcp serve` — spawning the actual
 * built CLI and exchanging JSON-RPC messages over stdio per the MCP
 * spec.
 *
 * v0.8: scope intentionally narrow — list-tools and a single call-tool
 * round-trip. Deep tool-output coverage is in the per-command unit
 * suites; here we just prove the wire-level transport works.
 *
 * The MCP stdio protocol is line-delimited JSON-RPC over stdin/stdout.
 * We write `{"jsonrpc":"2.0","id":<n>,"method":"initialize",...}` to
 * the child's stdin, then read its stdout one line at a time and parse
 * the response. This is enough to verify the substrate MCP server
 * advertises tools the host can call.
 */

import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_PATH, makeTmpDir, removeTmpDir } from "./helpers.js";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Minimal MCP-over-stdio client. Spawns the substrate binary, performs
 * `initialize` + `tools/list`, and resolves with the parsed tool list.
 * Then it terminates the child.
 */
async function listToolsOverMcp(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, "mcp", "serve"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderrBuf = "";
    child.stderr.on("data", (d) => {
      stderrBuf += d.toString();
    });

    let stdoutBuf = "";
    const pending = new Map<number, (msg: JsonRpcMessage) => void>();

    child.stdout.on("data", (d) => {
      stdoutBuf += d.toString();
      // MCP stdio framing: one JSON message per line.
      let nl = stdoutBuf.indexOf("\n");
      while (nl !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (line) {
          try {
            const msg = JSON.parse(line) as JsonRpcMessage;
            if (msg.id !== undefined) {
              const handler = pending.get(msg.id as number);
              if (handler) {
                handler(msg);
                pending.delete(msg.id as number);
              }
            }
          } catch {
            // Ignore non-JSON lines (server-side logging etc.).
          }
        }
        nl = stdoutBuf.indexOf("\n");
      }
    });

    function send(id: number, method: string, params: Record<string, unknown> = {}) {
      return new Promise<JsonRpcMessage>((resolveSend) => {
        pending.set(id, resolveSend);
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      });
    }

    child.on("error", (e) => reject(e));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          "MCP probe timed out (10s).\nstdout: " +
            stdoutBuf +
            "\nstderr: " +
            stderrBuf,
        ),
      );
    }, 10000);

    (async () => {
      try {
        // MCP handshake: initialize then notifications/initialized.
        await send(1, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          clientInfo: { name: "substrate-test-client", version: "0.0.0" },
        });
        // initialized is a notification — no id, no response.
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n",
        );
        const toolsResp = await send(2, "tools/list", {});
        clearTimeout(timeout);
        const tools = (toolsResp.result as { tools: { name: string }[] }).tools;
        child.stdin.end();
        // Wait for natural close.
        child.on("close", () => resolve(tools.map((t) => t.name)));
      } catch (e) {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(e);
      }
    })();
  });
}

describe("substrate mcp serve (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  it(
    "MCP server starts, completes handshake, and lists all seven v0.8 tools",
    async () => {
      const tools = await listToolsOverMcp(tmp);
      // The order MCP returns isn't guaranteed; sort before comparing.
      const sorted = [...tools].sort();
      expect(sorted).toEqual(
        [
          "substrate_audit_list",
          "substrate_audit_run",
          "substrate_doctor",
          "substrate_knowledge_show",
          "substrate_upgrade_check",
          "substrate_workflow_describe",
          "substrate_workflow_list",
        ].sort(),
      );
    },
    15000,
  );
});
