---
scope: backend
area: testing
last_updated: TODO
rules:
  - BE-TEST-001
  - BE-TEST-002
update_triggers:
  - Test framework changes
  - Coverage threshold updates
---

# Backend Testing Standards

> Cadence scaffold — fill in the TODOs.

How tests are written, organized, and gated.

## 1. Test pyramid

TODO: Your distribution (unit-heavy vs integration-heavy). Common
shape: ~70% unit, ~25% integration, ~5% end-to-end.

## 2. Frameworks

TODO: pytest / unittest / Vitest / etc. Configuration lives where.

## 3. Test organization

```
tests/
├── conftest.py           # shared fixtures
├── unit/
│   ├── services/         # service-class tests
│   └── integrations/     # client tests with mocks
├── integration/          # full integration tests
└── utils/                # test helpers
```

## 4. Unit vs integration boundary

- **Unit tests** mock external dependencies (DB, Redis, HTTP).
- **Integration tests** use real dependencies (test DB, real Redis),
  mocking only third-party services (payment gateway, OAuth provider).

## 5. Naming

TODO: `test_<what>_<condition>_<expected>` or your variant. Discover-by-prefix.

## 6. Fixtures

TODO: Convention for fixture scopes. Where they live. How they handle
cleanup.

## 7. Assertions (BE-TEST-001)

Required patterns:

```python
# Meaningful messages
assert result.title == expected_title, \
    f"Expected '{expected_title}', got '{result.title}'"

# Validate properties, not just existence
assert result.id is not None
assert result.tenant_id == tenant_id
assert result.status == "active"
```

Forbidden patterns:

- `assert result or True` — never fails.
- `assert result is not None` alone — combine with property assertions.
- Empty `def test_x(): pass`.
- Bare `try: ... except: pass` in tests.
- Magic numbers — use named constants.

## 8. Async tests

TODO: How async test functions are marked / awaited in your framework.

## 9. Coverage

- Packages: 90% minimum
- Services: 70% minimum
- New code: must include tests

CI gates on these thresholds.

## 10. Test data

TODO: Factories, fixtures, in-line data. Recommended pattern per type.

## 11. Snapshot tests

TODO: When you use them, when you don't. How they're updated.

## 12. Performance / load tests

TODO: Reference whether these live in this repo or a separate one.
