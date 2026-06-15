# @acme/substrate-shared (fixture)

A reference org-hub repo used by the substrate enterprise smoke test.
This fixture simulates the layout an organization would publish as
`@acme/substrate-shared` on a private npm registry (or as a git
repo with `github:` extends).

The smoke test copies this directory into `/tmp/substrate-smoke-*/`
ephemeral working copies; the canonical reference lives here.

## Layout

```
substrate-shared-fixture/
  package.json                         # @acme/substrate-shared@1.0.0
  substrate/
    workflows/                         # 3 org workflows
      org-audit-pre-merge.yaml         # deterministic audit gate
      org-git-review-pre.yaml          # deterministic review
      org-tackle-task.yaml             # AI-driven task starter (skipped in smoke)
    hooks/                             # 3 org hooks
      auto-emit-sidecar.yaml
      auto-validate-changelogs.yaml
      auto-org-policy.yaml
    doc-checks/                        # 3 org doc-checks
      changelog-on-feat-or-fix.yaml
      adr-on-architecture-change.yaml
      public-docs-on-marketing-change.yaml
    standards/                         # 5 org standards docs
      backend/python.md
      backend/api.md
      frontend/typescript.md
      infrastructure/docker.md
      backend/security.md
    RULES.yaml                         # ~10 org rules
```
