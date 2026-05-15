---
scope: backend
area: testing
last_updated: 2026-05-14
rules:
  - BE-TEST-001
  - BE-TEST-002
update_triggers:
  - Coverage threshold changed
  - New test category introduced
  - Forbidden pattern surfaced in audits
---

# Backend Testing

> **Substrate default standard.** What backend tests look like, what they
> must do, and what they're not allowed to do. The pyramid still
> works — but only if the assertions actually fail when the code
> breaks.

## Scope

All backend test code: unit, integration, end-to-end. Frontend
testing is `frontend/testing.md`.

## Rules

### 1. The pyramid: many unit, fewer integration, very few E2E

- **Unit tests** (~70 %): pure functions, single class, mocked I/O.
  Fast (< 30 ms each). Run on every save.
- **Integration tests** (~25 %): real DB, real Redis, real broker
  (against test containers). One service at a time. Slower (~ 1 s).
- **E2E tests** (~5 %): multiple services, browser if there's a UI.
  Slow (seconds to minutes). Run in CI, not on save.

Inverted pyramids ("most of our tests are E2E") are slow,
flaky, and don't help triage. Top-heavy unit tests with no
integration tests miss interaction bugs.

### 2. Forbidden patterns (these are silent test failures)

```python
# WRONG — always passes (BE-TEST-001)
assert result or True

# WRONG — empty body
def test_something():
    pass

# WRONG — async test missing the asyncio mark (BE-TEST-002)
async def test_create():
    result = await service.create(data)
    assert result.id is not None

# WRONG — bare null check, no further validation
result = await service.get(id)
assert result is not None  # passes for ANY object

# WRONG — bare except swallows the failure
try:
    result = await service.create()
except Exception:
    pass  # accepts any failure

# WRONG — print instead of assert
if status == 200:
    print("ok")  # never fails

# WRONG — magic number
assert count == 42
```

Each of these passes when the code is broken. The forbidden list is
in pre-commit and lint config; new code can't merge with them.

### 3. Required patterns

```python
# Async tests carry the asyncio mark
@pytest.mark.asyncio
async def test_create_task():
    result = await service.create(data, tenant_id, user_id)
    # Specific assertions
    assert result.title == data.title
    assert result.tenant_id == tenant_id
    assert result.owner_id == user_id

# Named constants beat magic numbers
EXPECTED_PAGE_SIZE = 50
assert len(results) == EXPECTED_PAGE_SIZE, f"expected page of {EXPECTED_PAGE_SIZE}, got {len(results)}"

# Specific exception, with a message check
with pytest.raises(TenantIsolationError) as exc_info:
    await service.get(task_id, wrong_tenant_id)
assert "isolation" in str(exc_info.value).lower()

# Env-based config instead of hardcoded ports
BASE_URL = os.getenv("TEST_API_URL", "http://localhost:9000")

# Mock verification carries args
mock_db.commit.assert_called_once_with()
mock_publisher.publish.assert_called_once_with(stream="events", data=expected_event)
```

### 4. Coverage thresholds

| Code category    | Min line coverage |
| ---------------- | ----------------- |
| Shared packages  | 90 %              |
| Service business logic | 80 %        |
| HTTP handlers    | 70 %              |
| Migrations       | not measured (run via integration tests) |

Coverage is a floor, not a goal. 100 % coverage on a function with no
assertions is worse than 60 % on a function with sharp assertions.

### 5. Unit vs integration: mock the boundaries, not the core

**Unit tests** mock:
- Database sessions
- Redis clients
- HTTP clients (external)
- Message broker publishers
- Email / SMS senders

**Integration tests** mock only:
- Third-party APIs (Stripe, Google OAuth, GitHub).
- Real-money side effects.

The temptation to mock the database in an "integration" test is
the temptation to write a slower unit test. Resist.

```python
# WRONG — mocking the core dep in an integration test
@patch("app.services.auth.AuthService.create_session")
async def test_login(mock_session, client):
    ...

# RIGHT — real service, real (test) database
async def test_login(client, test_db):
    response = await client.post("/auth/login", json={"email": ..., "password": ...})
    assert response.status_code == 200
    user = await test_db.execute(select(User).where(User.email == email))
    assert user.scalar_one().last_login_at is not None
```

### 6. Fixtures: shared, scoped, reset

```python
# tests/conftest.py
@pytest.fixture(scope="session")
async def test_db_engine():
    """One async engine for the whole test session."""
    engine = create_async_engine(TEST_DATABASE_URL, ...)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def test_db(test_db_engine):
    """One session per test, rolled back at the end."""
    async with test_db_engine.connect() as conn:
        async with conn.begin() as txn:
            async with AsyncSession(bind=conn) as session:
                yield session
            await txn.rollback()
```

Each test starts from a clean slate. No leaked state between tests.

### 7. Tests document the API as well as exercise it

A good test name reads as a sentence:

```python
def test_create_task_rejects_due_date_in_the_past(): ...
def test_list_tasks_only_returns_active_for_current_tenant(): ...
def test_complete_task_records_actual_hours_when_supplied(): ...
```

Bad names:

```python
def test_create_1(): ...   # no signal
def test_task(): ...       # what about it?
def test_works(): ...      # nothing fails this assertion either
```

### 8. Test organization

```
tests/
├── conftest.py             shared fixtures
├── unit/
│   ├── services/           service unit tests
│   ├── repositories/       repo unit tests
│   └── utils/              helper utility tests
├── integration/
│   ├── api/                full HTTP request → response
│   ├── messaging/          publish + consume round trips
│   └── workflows/          multi-step service interactions
└── e2e/                    cross-service flows
```

### 9. Fast feedback for local dev

`pytest -m unit` should finish in < 5 seconds for a typical
service. If it doesn't, the unit tests are doing too much
I/O. Move things into integration.

`pytest --lf` runs only last-failed. Use it.

`pytest -x` stops on first failure. Use it during local dev; not in
CI.

### 10. CI runs the whole suite, in a sensible order

```yaml
jobs:
  unit:
    runs: pytest -m unit
  integration:
    runs: pytest -m integration
    needs: unit
  e2e:
    runs: pytest -m e2e
    needs: integration
```

Fast tests fail fast. Slow tests don't run until fast tests pass.

## Examples

### Do — meaningful assertions

```python
@pytest.mark.asyncio
async def test_create_task_records_owner_and_tenant(test_db):
    user = await create_user(test_db, tenant_id=TENANT_ID)
    service = TaskService(test_db)

    task = await service.create(
        TaskCreate(title="Buy milk", priority="low"),
        tenant_id=TENANT_ID,
        user_id=user.id,
    )

    assert task.id is not None
    assert task.title == "Buy milk"
    assert task.priority == "low"
    assert task.owner_id == user.id
    assert task.tenant_id == TENANT_ID
    assert task.status == "open"  # default
    assert task.created_at is not None
```

### Don't — bare existence check

```python
async def test_create_task(test_db):
    service = TaskService(test_db)
    task = await service.create(TaskCreate(title="x", priority="low"), TENANT, USER)
    assert task is not None  # passes for any object including ones missing required fields
```

### Do — test the error path with specifics

```python
async def test_get_task_rejects_cross_tenant_access(test_db):
    own_user = await create_user(test_db, tenant_id=TENANT_A)
    other_user = await create_user(test_db, tenant_id=TENANT_B)
    task = await create_task(test_db, owner=other_user, tenant=TENANT_B)

    service = TaskService(test_db)
    with pytest.raises(TenantIsolationError) as exc_info:
        await service.get(task.id, tenant_id=TENANT_A)
    assert "tenant" in str(exc_info.value).lower()
```

## Rationale

Tests are a contract: they say "when the code works, here's what
that means." Tests with `assert x or True`, bare null checks, or
print-instead-of-assert lie about the contract. They pass when the
code is broken, then fail mysteriously in production.

The forbidden-pattern list and coverage thresholds are the boring
defense. The pyramid keeps the suite fast. The unit vs integration
boundary keeps each layer sharp.

## See also

- `architecture.md` — the layering you're testing.
- `error-handling.md` — exceptions to assert on.
- `infrastructure/ci-cd.md` — when each test runs.
- `frontend/testing.md` — equivalent rules for the FE.
