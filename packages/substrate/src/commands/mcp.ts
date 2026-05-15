/**
 * `substrate mcp serve` — Model Context Protocol server bridge (v0.8).
 *
 * The third bridge target alongside Claude Code slash commands (v0.1) and
 * Cursor commands (v0.5). Unlike those — which scaffold a markdown file
 * the editor reads at startup — the MCP bridge exposes substrate commands
 * as tools to ANY MCP-aware agent (Claude Desktop, Continue, Cline,
 * Claude Code's MCP client, etc.).
 *
 * Transport: stdio (per the MCP spec's reference transport). The MCP host
 * spawns `substrate mcp serve` as a child process and exchanges JSON-RPC
 * messages over stdin/stdout. No HTTP, no port allocation, no network
 * surface — just a process that the host owns the lifetime of.
 *
 * **Tool surface (v0.8 — conservative):**
 *
 * Exposed READ-ONLY (or dry-run) only. Writes that mutate the user's repo
 * stay user-driven via the regular CLI; we don't want an agent triggering
 * `substrate init` or `substrate task create` without an explicit confirmation
 * loop. v1.0 will revisit with a `confirm: true` parameter convention.
 *
 *   - substrate_audit_list           : enumerate available audits
 *   - substrate_audit_run            : run an audit, return its output (no
 *                                     writes — audits are read-only by
 *                                     design)
 *   - substrate_knowledge_show       : print KNOWLEDGE.md (or section)
 *   - substrate_doctor               : diagnose the substrate install
 *   - substrate_workflow_list        : enumerate workflows
 *   - substrate_workflow_describe    : print one workflow's definition
 *   - substrate_upgrade_check        : dry-run of `substrate upgrade --check`
 *
 * **Locked design (v0.8) — record this in the HANDOFF when changes are
 * proposed in v1.0:**
 *
 * 1. Tool naming is `substrate_<verb>` (snake_case, prefixed). MCP tool
 *    names must be unique across all servers a host loads, and many
 *    hosts surface them in flat lists. The `substrate_` prefix prevents
 *    collisions; underscores mirror the conventional MCP tool-name
 *    casing.
 *
 * 2. Tool input schemas use zod for type-safe parameter parsing. The
 *    MCP SDK accepts zod RawShapes or AnySchema for `inputSchema`; we
 *    use RawShapes for clarity.
 *
 * 3. Tool outputs are TEXT (the same shape as the CLI's stdout for the
 *    underlying command). MCP supports structured output but most hosts
 *    surface text uniformly; structured output is a v1.0 enhancement.
 *
 * 4. Write operations (init, add, apply, task create/update, workflow
 *    start) are intentionally absent. See header comment.
 */

import process from "node:process";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runAuditList, runAuditType } from "./audit.js";
import { runDoctor } from "./doctor.js";
import { runKnowledgeShow } from "./knowledge.js";
import { runUpgrade } from "./upgrade.js";
import { runWorkflowDescribe, runWorkflowList } from "./workflow.js";
import { SUBSTRATE_VERSION } from "../util/version.js";

/**
 * Capture stdout/stderr produced by a command and return it as a string.
 * Substrate commands write to process.stdout/stderr directly; for MCP, we
 * intercept the writes and serialize them into the tool-response payload.
 *
 * Design note: this is a tactical capture, not a structured rewrite of
 * the command modules. The alternative — refactoring every command to
 * return a string instead of writing to console — is a much larger
 * change. The capture is honest about its tradeoff: it can't intercept
 * `process.exit()` calls, so any command that exits non-zero on error
 * (e.g. `audit --list` when no instructions exist) will tear down the
 * MCP server. That's acceptable for v0.8 — error cases are rare in the
 * read-only surface.
 */
async function captureStdout<T>(fn: () => Promise<T> | T): Promise<{
  result: T;
  stdout: string;
  stderr: string;
}> {
  const out: string[] = [];
  const err: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
}

export interface McpServeOptions {
  /** Override the substrate working directory the tools resolve against. */
  cwd?: string;
}

/**
 * Build the MCP server and register the v0.8 tool surface. Returned
 * separately from `runMcpServe()` so tests can probe the tool list
 * without spinning up a transport.
 */
export function buildMcpServer(options: McpServeOptions = {}): McpServer {
  const server = new McpServer(
    { name: "substrate", version: SUBSTRATE_VERSION },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  // ------------------------------------------------------ audit_list
  server.registerTool(
    "substrate_audit_list",
    {
      title: "List available audits",
      description:
        "Enumerate the audits registered in this substrate project " +
        "(read from `auto/instructions/main/audit-*.md` plus the bundled " +
        "audit catalog).",
      inputSchema: {
        json: z
          .boolean()
          .optional()
          .describe("Return machine-readable JSON instead of human-readable text."),
      },
    },
    async ({ json }) => {
      const captured = await captureStdout(() => runAuditList({ json: json ?? false }));
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  // -------------------------------------------------------- audit_run
  server.registerTool(
    "substrate_audit_run",
    {
      title: "Run an audit",
      description:
        "Run a specific audit by type (e.g. backend, frontend, security, " +
        "pre-merge). The audit emits a report to stdout; no files are " +
        "written to the user's repo.",
      inputSchema: {
        type: z.string().describe("Audit type, e.g. `backend` or `pre-merge`."),
        json: z.boolean().optional().describe("Emit JSON instead of text."),
      },
    },
    async ({ type, json }) => {
      const captured = await captureStdout(() =>
        runAuditType(type, { json: json ?? false }),
      );
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  // -------------------------------------------------- knowledge_show
  server.registerTool(
    "substrate_knowledge_show",
    {
      title: "Show substrate knowledge",
      description:
        "Print the auto-discovered KNOWLEDGE.md (or a single section). " +
        "Refreshed by `substrate knowledge refresh` from `docker-compose.yml` " +
        "and `.env.example`.",
      inputSchema: {
        section: z
          .string()
          .optional()
          .describe("Print only one section (e.g. `services`, `env`)."),
      },
    },
    async ({ section }) => {
      const captured = await captureStdout(() => runKnowledgeShow({ section }));
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  // ------------------------------------------------------------ doctor
  server.registerTool(
    "substrate_doctor",
    {
      title: "Diagnose substrate install",
      description:
        "Check installed substrate components (config, manifest, bridges, " +
        "auto/ layout) and report problems.",
      inputSchema: {
        json: z.boolean().optional().describe("Emit JSON instead of text."),
      },
    },
    async ({ json }) => {
      const captured = await captureStdout(() => runDoctor({ json: json ?? false }));
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  // -------------------------------------------------- workflow_list
  server.registerTool(
    "substrate_workflow_list",
    {
      title: "List workflows",
      description:
        "Enumerate workflows registered in `auto/config/workflows.yaml`.",
      inputSchema: {
        json: z.boolean().optional().describe("Emit JSON instead of text."),
      },
    },
    async ({ json }) => {
      const captured = await captureStdout(() =>
        runWorkflowList({ json: json ?? false }),
      );
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  // ---------------------------------------------- workflow_describe
  server.registerTool(
    "substrate_workflow_describe",
    {
      title: "Describe one workflow",
      description:
        "Print one workflow's definition (name, description, step list).",
      inputSchema: {
        id: z.string().describe("Workflow ID (e.g. `new-service`)."),
        json: z.boolean().optional().describe("Emit JSON instead of text."),
      },
    },
    async ({ id, json }) => {
      const captured = await captureStdout(() =>
        runWorkflowDescribe({ id, json: json ?? false }),
      );
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  // --------------------------------------------------- upgrade_check
  server.registerTool(
    "substrate_upgrade_check",
    {
      title: "Check for substrate template drift",
      description:
        "Dry-run of `substrate upgrade --check`. Reports tracked files whose " +
        "templates have changed in this substrate version, without writing " +
        "anything.",
      inputSchema: {},
    },
    async () => {
      const captured = await captureStdout(() =>
        runUpgrade({ check: true, cwd: options.cwd }),
      );
      return {
        content: [{ type: "text", text: captured.stdout || captured.stderr }],
      };
    },
  );

  return server;
}

/**
 * Start the MCP server over stdio transport. Blocks until the transport
 * closes (i.e. the host disconnects or sends SIGINT).
 *
 * This is the CLI entry point for `substrate mcp serve`. Tests that need
 * to probe the server without a real transport should call `buildMcpServer()`
 * directly and inspect its registered tools.
 */
export async function runMcpServe(options: McpServeOptions = {}): Promise<void> {
  const server = buildMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Block until transport closes. Node will exit naturally when the host
  // hangs up stdin.
}
