# Cadence rules registry

This directory is the curated public registry of rules. Rules
shipped here are merged into `cadence/RULES.yaml` for any consumer
who scaffolds them.

## Contributing

See [docs/contributing-rules.md](../../../../docs/contributing-rules.md)
for the full contribution workflow.

## Layout

```
rules-registry/
├── README.md            (this file)
├── community/           rules contributed by external authors
│   └── <author>/
│       └── <ruleset>.yaml
└── examples/            worked examples for new contributors
    └── no-todo-comments.yaml
```

## License

Contributions to the registry are licensed under CC-BY-4.0 (the same
license cadence uses for content). By contributing, you agree to
that license.
