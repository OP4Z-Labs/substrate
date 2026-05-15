# Knowledge sources — plugin contract (v2.0)

> **Scope.** This document describes the v2.0 plural-knowledge-sources
> contract (Primitive 11). It supersedes the v1.x flat-string
> `knowledge.sources` list in `substrate.config.json`, which keeps
> working but is no longer recommended for new repos.

The substrate `knowledge` command auto-discovers local-stack reference
material — services, ports, env-var surface, Kubernetes resources,
secrets-by-key — and renders it into `auto/docs/KNOWLEDGE.md`. v1.0
hard-coded docker-compose + `.env.example` as the only inputs. v2.0
opens this up via a typed plugin contract so consumers can add
Kubernetes, env-registry, terraform-state, or third-party plugin
outputs to the same pipeline.

---

## Manifest

Drop `substrate/knowledge-sources.yaml` into your repo:

```yaml
sources:
  - kind: docker-compose
    path: ./docker-compose.yml
  - kind: kubernetes
    paths: ["./k8s/**/*.yaml"]
  - kind: env-registry
    paths: [".env.production.template"]
```

Each entry has:

| Field     | Required               | Description                                                                                  |
| --------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `kind`    | yes                    | Plugin name. Built-in: `docker-compose`, `kubernetes`, `env-registry`. Custom: see below.   |
| `path`    | one of path/paths      | Single source file (repo-relative or absolute).                                              |
| `paths`   | one of path/paths      | Multiple sources. Glob patterns supported (`**` for recursion, `*` per segment).             |
| `options` | no                     | Plugin-specific options map. Built-in plugins ignore this; custom plugins can use it freely. |

`substrate knowledge refresh` reads the manifest first; if it's absent
the command falls back to v1's `substrate.config.json#knowledge.sources`
flat-string list. Both paths render to the same `auto/docs/KNOWLEDGE.md`.

---

## Built-in plugins

### `docker-compose`

Parses a docker-compose file. Extracts services, ports, depends-on, and
volume mounts. The renderer groups them in the "Services" section.

### `kubernetes`

Parses Kubernetes manifests (single- or multi-document YAML). Extracts:

- `Service` resources → ports
- `Deployment` / `StatefulSet` / `DaemonSet` resources → container images
- `Secret` / `ConfigMap` resources → key list only (values are **never** read)

The renderer adds a "Kubernetes resources" table and a "Secret + ConfigMap
keys" section. Secret values do not leave your repo's filesystem.

Glob patterns are the canonical way to point at k8s manifests:

```yaml
- kind: kubernetes
  paths:
    - "k8s/**/*.yaml"
    - "k8s/**/*.yml"
```

### `env-registry`

Parses an env-var registry file (`.env.production.template` or similar).
Emits one block per key. Values are **always** redacted — the registry
is the documented surface, not the values.

---

## Custom plugins

A plugin is a pure function that maps `(absolutePath, repoRoot,
options?) → KnowledgeBlock[]`. The signature lives in
`@op4z/substrate`'s deterministic-layer barrel:

```ts
import {
  registerKnowledgePlugin,
  type KnowledgeBlock,
  type KnowledgeSourcePlugin,
} from "@op4z/substrate";
import { readFileSync } from "node:fs";

const myPlugin: KnowledgeSourcePlugin = (absolutePath, repoRoot, options) => {
  const raw = readFileSync(absolutePath, "utf8");
  // Parse however you like — JSON, custom DSL, etc.
  const { services } = JSON.parse(raw);
  return services.map(
    (s: { name: string; port: number }): KnowledgeBlock => ({
      sourceKind: "mycorp:internal-services",
      sourcePath: absolutePath.replace(repoRoot + "/", ""),
      category: "services",
      payload: { name: s.name, image: null, ports: [String(s.port)] },
    }),
  );
};

registerKnowledgePlugin("mycorp:internal-services", myPlugin);
```

Then declare the source in `substrate/knowledge-sources.yaml`:

```yaml
sources:
  - kind: mycorp:internal-services
    path: ./.mycorp/services.json
```

### Naming conventions

- **Built-in plugins** use bare names (`docker-compose`, `kubernetes`).
- **Third-party plugins** should namespace with `<org>:<name>` (e.g.
  `mycorp:internal-services`, `acme:registry`). This keeps registry
  conflicts loud and makes the source obvious in the rendered
  `KNOWLEDGE.md`.

### Block categories

Choose a category to control which section the renderer places blocks in:

| Category   | Renderer section                | Payload shape (built-ins)                                |
| ---------- | ------------------------------- | -------------------------------------------------------- |
| `services` | "Services" or "Kubernetes resources" | `{ name, image, ports, dependsOn?, volumes? }` (compose) <br/> `{ name, namespace, kind, ports?, images? }` (k8s) |
| `env-vars` | "Environment variables"          | `{ key, value?, placeholder?, redacted: boolean }`       |
| `secrets`  | "Secret + ConfigMap keys"        | `{ name, namespace, kind, keys: string[] }`              |
| `custom`   | (not rendered by the built-in renderer in v2.0) | Free-form. Surface via the programmatic API. |

> **Note.** v2.0's built-in renderer does not surface `custom`-category
> blocks. The category exists so external consumers of
> `discoverKnowledge()` (e.g. an MCP tool or a custom CI script) can
> attach arbitrary metadata. A future minor version may add a
> "Custom integrations" section.

### Determinism contract

Plugins must be deterministic:

- No network calls. The knowledge command runs locally and in CI.
- No process spawning. Read files, parse them, return blocks.
- No mutation. The plugin receives a read-only view of the source path.
- No AI calls. Knowledge discovery sits in the deterministic layer; AI
  surfacing happens elsewhere (e.g. `substrate run` with
  `context.knowledge-sections: [...]`).

A plugin that violates this contract may still register, but the
output will be unreliable across environments and the consumer may see
spurious drift in their `auto/docs/KNOWLEDGE.md`.

---

## Glob support

Glob expansion is intentionally minimal — just what's needed for the
common k8s + env-registry shapes:

- `**` matches zero or more intermediate directories. Skips `node_modules`
  and dotfile-prefixed directories so it doesn't hammer `.git/`.
- `*` matches one path segment (anything but `/`).
- Literal segments match verbatim.
- Patterns that start with `.` (e.g. `.env.*.template`) discover
  dotfiles intentionally.

If you need richer patterns (`{a,b}`, `?`, character classes), use
multiple explicit `path:` entries or expand the list yourself in a
custom plugin.

---

## Programmatic API

For consumers that want to call discovery from a script:

```ts
import {
  discoverKnowledge,
  loadKnowledgeSourcesManifest,
} from "@op4z/substrate";

const manifest = loadKnowledgeSourcesManifest({ cwd: process.cwd() });
if (!manifest.manifest) {
  console.error("No substrate/knowledge-sources.yaml found.");
  process.exit(1);
}
const result = discoverKnowledge({ cwd: process.cwd(), manifest: manifest.manifest });
for (const block of result.blocks) {
  console.log(`${block.category}/${block.sourceKind} from ${block.sourcePath}`);
}
```

`discoverKnowledge` returns:

- `blocks` — all KnowledgeBlocks emitted by every plugin
- `sourcesUsed` — repo-relative paths that produced at least one block
- `kindsWithoutResults` — declared kinds whose plugins emitted nothing
- `unknownKinds` — kinds with no registered plugin
- `warnings` — non-fatal parse / discovery messages

---

## Migration from v1.x

Existing v1.x consumers should keep their `substrate.config.json`
unchanged. When they're ready to adopt the v2 surface:

1. Run `substrate knowledge refresh` once to confirm the current
   output baseline.
2. Author `substrate/knowledge-sources.yaml` with one entry per source
   you currently have, plus any new k8s / env-registry inputs you
   want surfaced.
3. Re-run `substrate knowledge refresh`. The output should look the
   same for the migrated sources, plus new sections for the new
   inputs.
4. (Optional.) Remove the `knowledge.sources` block from
   `substrate.config.json` — `substrate knowledge refresh` will keep
   working from the manifest alone. The `knowledge.redactPatterns`
   field still applies to the v1 fallback path.

There's no breaking change: v1 sources keep working as long as no
v2 manifest exists.
