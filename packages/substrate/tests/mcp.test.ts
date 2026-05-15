/**
 * Unit tests for the MCP bridge (`substrate mcp serve`).
 *
 * Verifies the v0.8 tool surface without spinning up a real stdio
 * transport. `buildMcpServer()` exposes the server with all tools
 * registered; we inspect its internal map directly so the tests don't
 * need an MCP client.
 */

import { describe, expect, it } from "vitest";
import { buildMcpServer } from "../src/commands/mcp.js";

describe("buildMcpServer (v0.8 tool surface)", () => {
  it("registers all seven read-only tools", () => {
    const server = buildMcpServer();
    // McpServer keeps registered tools in a private field. Reach through
    // it for verification — this is the same shape the SDK uses internally
    // when serving listTools requests.
    const registry = (server as unknown as {
      _registeredTools: Record<string, unknown>;
    })._registeredTools;

    const names = Object.keys(registry).sort();
    expect(names).toEqual(
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
  });

  it("does NOT register write-side operations in v0.8", () => {
    const server = buildMcpServer();
    const registry = (server as unknown as {
      _registeredTools: Record<string, unknown>;
    })._registeredTools;
    const names = Object.keys(registry);
    // Locked v0.8 design: no init / add / apply / task create / etc. The
    // v0.8 MCP surface is read-only by deliberate choice (see header
    // comment on src/commands/mcp.ts).
    const forbidden = [
      "substrate_init",
      "substrate_add",
      "substrate_upgrade_apply",
      "substrate_task_create",
      "substrate_task_update",
      "substrate_workflow_start",
    ];
    for (const f of forbidden) {
      expect(names).not.toContain(f);
    }
  });

  it("tools carry titles and descriptions for host UX", () => {
    const server = buildMcpServer();
    const registry = (server as unknown as {
      _registeredTools: Record<
        string,
        { title?: string; description?: string }
      >;
    })._registeredTools;
    for (const [name, def] of Object.entries(registry)) {
      expect(def.title, `${name} should declare a title`).toBeTruthy();
      expect(def.description, `${name} should declare a description`).toBeTruthy();
    }
  });

  it("audit_run requires `type` parameter, upgrade_check is zero-arg", () => {
    const server = buildMcpServer();
    // The SDK wraps the raw inputSchema we pass in (a zod RawShape, i.e.
    // a record of zod types) into a `z.object(...)`. The original shape
    // is recoverable via `.shape` on the resulting ZodObject.
    const registry = (server as unknown as {
      _registeredTools: Record<
        string,
        { inputSchema?: { shape?: Record<string, unknown> } }
      >;
    })._registeredTools;
    const auditShape = registry.substrate_audit_run.inputSchema?.shape ?? {};
    expect(Object.keys(auditShape)).toContain("type");
    // upgrade_check is a true zero-arg tool — empty input schema shape.
    const upgradeShape = registry.substrate_upgrade_check.inputSchema?.shape ?? {};
    expect(Object.keys(upgradeShape).length).toBe(0);
  });
});
