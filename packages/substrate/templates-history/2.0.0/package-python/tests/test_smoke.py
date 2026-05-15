"""Smoke tests for {{NAME}}."""

from {{NAME_SNAKE}} import hello, __version__


def test_hello_returns_named_greeting() -> None:
    """hello() must include the package name so renames stay loud."""
    expected = "hello from {{NAME}}"
    assert hello() == expected, f"Expected {expected!r}, got {hello()!r}"


def test_version_is_set() -> None:
    """Version metadata should be present and non-empty."""
    assert isinstance(__version__, str), "__version__ must be a string"
    assert __version__, "__version__ must not be empty"
