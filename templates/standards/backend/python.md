---
scope: backend
area: python
last_updated: TODO
rules:
  - BE-PY-001
  - BE-PY-002
update_triggers:
  - Python version upgrades
  - Linter / formatter changes
---

# Python Standards

> Cadence scaffold — fill in the TODOs.

Python-specific conventions that complement the broader backend
standards. Drop this file if your repo doesn't use Python.

## 1. Versions

TODO: Minimum Python version. Pyenv / asdf policy. CI runs against
which versions.

## 2. Formatter and linter

TODO: Black + Ruff (or similar). Configuration lives where. Pre-commit
hook enforces it.

```toml
# pyproject.toml
[tool.black]
line-length = 100

[tool.ruff]
select = ["E", "F", "I", "B", "UP"]
ignore = []
```

## 3. Type checking

TODO: mypy / pyright? Strict-ish settings? Where the config lives.

## 4. Imports

TODO: Order (stdlib, third-party, internal, relative). Whether you use
`isort` or `ruff`'s import rules.

## 5. Naming conventions

```
ClassName          PascalCase
function_name      snake_case
CONSTANT_NAME      SCREAMING_SNAKE_CASE
_internal          leading underscore for module-private
__dunder__         reserved for stdlib
```

## 6. Async / await

TODO: Async-first or sync-first? Mixing rules. `asyncio.run` only at
the entry point.

## 7. Type hints

TODO: Required on public APIs, optional elsewhere. Whether `Any` is
banned or merely discouraged.

## 8. Docstrings

TODO: Style (Google, NumPy, reST). Required on public APIs, optional
on private. What goes in (purpose, args, returns, raises).

## 9. Dependency management

TODO: Poetry / pip-tools / pipenv / uv? Lockfile committed. Update
policy.

## 10. Testing

TODO: Reference `testing.md`. pytest vs unittest, fixture conventions.

## 11. Common patterns to avoid

- `from module import *` (except in carefully-scoped `__init__.py`)
- Catching `Exception` in service code
- Bare `assert` statements in production paths (they're stripped with
  `-O`)
- Mutable default arguments (`def f(x=[])`)
