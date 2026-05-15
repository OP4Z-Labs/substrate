---
scope: backend
area: python
last_updated: 2026-05-14
rules:
  - BE-PY-001
  - BE-PY-002
update_triggers:
  - Python version bumped
  - New formatter / linter / type-checker added
  - Async pattern changed
---

# Python

> **Substrate default standard.** Conventions for Python services and
> shared libraries. Targets Python 3.12+.

## Scope

Every Python codebase in this repo: services, shared packages, scripts
that ship more than one purpose. One-shot ad-hoc scripts (under
~50 lines) can skip the rituals.

## Rules

### 1. Version: Python 3.12 minimum

Pin the minimum in `pyproject.toml`:

```toml
[tool.poetry.dependencies]
python = "^3.12"
```

(or PEP 621 equivalent). Don't ship code that depends on a single
patch version unless absolutely required.

### 2. Dependency management: one tool, one source of truth

Pick one — Poetry, uv, Hatch, Rye — and stick to it across the repo.
The mixed-tool failure mode (one service on Poetry, one on
requirements.txt) is technical debt that compounds.

**`pyproject.toml` is the single source of truth.** Dependencies, tool
config (ruff / black / mypy / pytest), and metadata all live there.
No `setup.py`, no separate `requirements.txt` checked in alongside.

Cross-link: rule `BE-PY-002`.

**Always work inside a virtual environment.** Never `pip install`
into the system Python — that's how dev machines acquire mystery
shared-state bugs. Poetry / uv / Hatch each manage the venv for you
(`poetry env use`, `uv venv`, `hatch shell`); `python -m venv .venv`
is the plain-stdlib fallback. The venv lives next to the project,
gitignored, and is recreated from the lockfile.

### 3. Formatter: ruff format (or black) — pick one

`ruff format` is now substantially black-compatible and ships in the
same binary as the linter, so most 2026 codebases lean toward
`ruff format` for the one-tool-one-pass story. `black` remains a
defensible choice if you're already on it.

Auto-format on save and in pre-commit. The setting bar:

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

# (equivalent block under [tool.black] if you stay on black)
```

100 columns over 88 because modern displays handle it. Whichever
formatter you pick, the codebase commits to one — mixing them
produces line-by-line churn no one needs.

### 4. Linter: ruff with a sane preset

```toml
[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = [
  "E",    # pycodestyle errors
  "W",    # pycodestyle warnings
  "F",    # pyflakes
  "I",    # isort
  "B",    # bugbear
  "N",    # pep8-naming (enforces rule 6 below)
  "UP",   # pyupgrade
  "RUF",  # ruff-specific
]
```

Run in CI. Failing lint blocks merge.

### 5. Type checker: mypy or pyright, strict mode

```toml
[tool.mypy]
python_version = "3.12"
strict = true                  # enables disallow_untyped_defs, no_implicit_optional, etc.
warn_unused_ignores = true     # additive: flags # type: ignore that no longer suppresses anything
warn_redundant_casts = true    # additive: flags `cast()` that the inferred type already covered
```

Strict from the start, not "we'll turn it on later." `strict = true`
turns on the standard family (`disallow_untyped_defs`,
`no_implicit_optional`, `disallow_any_generics`, etc.) — only list
the flags that add something on top. Existing untyped code can opt
out via per-file overrides; new code must be typed.

### 6. Names: PEP 8 throughout

```python
class TaskService:                          # PascalCase
async def create_task(): ...                # snake_case
MAX_RETRIES: Final[int] = 5                 # SCREAMING_SNAKE
_internal_helper()                          # leading underscore = private
```

No exceptions for "framework convention" — frameworks that demand
non-PEP-8 names are old and you should mark those usages clearly.

### 7. Async-first means async-everywhere

In an async codebase, every I/O call is awaited. No `requests.get`,
no `time.sleep`. Use:

- `httpx.AsyncClient` for HTTP.
- `asyncio.sleep` for waits.
- `asyncpg` / `aiosqlite` / async SQLAlchemy for DB.
- `aioboto3` for AWS.

When you must call sync code, wrap it:

```python
result = await asyncio.to_thread(blocking_fn, arg)
```

A sync call inside an async handler is the tail-latency footgun
described in `architecture.md`.

### 8. No `print()` in committed code (BE-PY-001)

`print()` is for the REPL. Production code uses a logger:

```python
import structlog
logger = structlog.get_logger()

logger.info("task.created", task_id=str(task.id))
```

The pre-commit / lint hook catches `print(` leaks before they ship.

### 9. Imports: stdlib → third-party → local

```python
# Standard library
from datetime import datetime
from typing import Optional
from uuid import UUID

# Third-party
import httpx
from fastapi import APIRouter, Depends

# Local
from app.core.config import settings
from app.services.tasks import TaskService
```

Isort (via ruff) enforces this. Don't fight it.

### 10. Pydantic for validation, dataclasses for value objects

- External shapes (request bodies, config) → Pydantic models. You
  get validation, coercion, and JSON schemas for free.
- Internal data with no validation needed → `@dataclass(frozen=True)`
  or a `NamedTuple`. Cheaper, no serialization overhead.

Don't dump 200-attribute Pydantic models around your internal service
layer just because the entry point used Pydantic.

### 11. Tests: pytest, with markers

```toml
[tool.pytest.ini_options]
markers = [
  "unit: fast tests with no I/O",
  "integration: tests that hit a real DB / Redis",
  "slow: tests > 1 second",
]
asyncio_mode = "auto"   # requires pytest-asyncio >= 0.21
```

Mark every test. `pytest -m unit` for the fast loop; `pytest -m
integration` in CI's slower stage.

See `testing.md` for the full bar (forbidden patterns, coverage).

### 12. Use `pathlib`, not `os.path`

```python
from pathlib import Path
path = Path("data") / "tasks" / "list.json"
text = path.read_text()
```

`pathlib` is type-safe and cross-platform. `os.path` is the
historical alternative that should disappear from new code.

## Examples

### Do — typed async service method

```python
async def create_task(
    self,
    data: TaskCreate,
    tenant_id: UUID,
    user_id: UUID,
) -> Task:
    self.logger.info("task.create.start", tenant_id=str(tenant_id), user_id=str(user_id))
    if data.due_at and data.due_at < datetime.now(timezone.utc):
        raise ValidationError("due_at must be in the future")
    task = await self.repo.insert({
        **data.model_dump(),
        "tenant_id": tenant_id,
        "owner_id": user_id,
    })
    self.logger.info("task.create.complete", task_id=str(task.id))
    return task
```

### Don't — untyped, print-laden

```python
async def create_task(self, data, tenant_id, user_id):
    print(f"Creating task for {user_id}")
    if data.due_at and data.due_at < datetime.now():
        raise Exception("bad date")
    task = await self.repo.insert({**data.dict(), "tenant_id": tenant_id, "owner_id": user_id})
    print("done")
    return task
```

`Exception` is too broad, `datetime.now()` is timezone-naive,
`print` is debug residue, no type hints.

## Rationale

Python's optional discipline is what gets you in trouble. The
defaults above — formatter, strict typing, async consistency,
structured logging — are what turns Python from "scripting language"
into "production-grade backend." Pay the small cost up front; reap
the dividend every time you onboard a new contributor or debug a
prod incident.

## See also

- `architecture.md` — service layering.
- `testing.md` — the pyramid and forbidden test patterns.
- `error-handling.md` — exception hierarchy.
- `observability.md` — structured logging.
