# Cadence MCP bridge — {{PROJECT_NAME}}

Cadence ships an MCP (Model Context Protocol) server that any MCP-aware
agent (Claude Desktop, Claude Code, Continue, Cline, etc.) can connect to.
The server exposes a curated subset of cadence commands as tools — your
agent can run audits, inspect knowledge docs, and walk workflows without
shelling out.

## Tool surface (v{{CADENCE_VERSION}})

For v0.8, MCP exposes **read-only** operations and **dry-run** variants of
write operations:

- `cadence_audit_list` — enumerate available audits
- `cadence_audit_run` — run an audit (read-only output)
- `cadence_knowledge_show` — print KNOWLEDGE.md (or one section)
- `cadence_doctor` — diagnose the cadence install
- `cadence_workflow_list` — enumerate workflows
- `cadence_workflow_describe` — print a workflow's definition
- `cadence_upgrade_check` — dry-run of `cadence upgrade --check`

Write operations (`init`, `add`, `apply`, `task create`, `task update`,
`workflow start`) are intentionally NOT exposed from the v0.8 MCP server.
Those have side effects on your repo that should stay user-driven via
the regular CLI. v1.0 may add them behind an explicit `confirm: true`
parameter; flag it in your MCP host's allowlist when that lands.

## Wiring it into Claude Desktop

Claude Desktop reads its MCP config from
`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS and the corresponding %APPDATA% path on Windows. Open that file
and merge the contents of `cadence-server.json` (in this directory)
into the top-level `mcpServers` object:

```jsonc
{
  "mcpServers": {
    "cadence-{{SHORT_CODE}}": {
      "command": "npx",
      "args": ["cadence", "mcp", "serve"],
      "env": {}
    }
    // ... your other MCP servers
  }
}
```

Restart Claude Desktop. The cadence tools should appear under the
"Tools" menu when you start a new conversation.

## Wiring it into Continue / Cline / other MCP hosts

The registration shape is the same JSON object. Consult your host's
docs for the exact config-file location. The `command` + `args` +
`env` shape is canonical across hosts that follow the MCP server-config
convention.

## Running standalone

You can also run the server manually for debugging:

```bash
npx cadence mcp serve
```

The process reads from stdin and writes to stdout per the MCP stdio
transport — point an MCP client at it directly to inspect the tool list
or call a tool by hand.

## Notes

- `cwd` matters. The MCP server runs in the directory where the host
  invokes it. Most MCP hosts let you set `cwd` per server in the
  registration JSON; set it to your repo root if cadence can't find
  `cadence.config.json`.
- Tool output is plain text by default (the same format as the CLI's
  `--json` output, encoded as a string). MCP-aware agents typically
  parse this without help.
- For OP4Z-style multi-project setups, register multiple servers with
  distinct names (`cadence-{{SHORT_CODE}}`, `cadence-acme`, etc.) and
  set per-server `cwd` so each connects to the right repo.
