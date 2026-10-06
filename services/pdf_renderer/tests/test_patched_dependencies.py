"""The renderer's pinned dependencies carry the fixes pip-audit knew of on 2026-10-06 (58 advisories
against fastapi 0.115.5's starlette 0.41.3, jinja2 3.1.4, pillow 10.4.0 and weasyprint 63.0). The
installed versions, as requirements.txt pins them, not only a range."""
from importlib.metadata import version

import pytest

MINIMUM = {"starlette": "1.3.1", "jinja2": "3.1.6", "pillow": "12.3.0", "weasyprint": "70.0"}


def parts(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.split(".")[:3] if p.isdigit())


@pytest.mark.parametrize("name, minimum", sorted(MINIMUM.items()))
def test_a_patched_release_is_installed(name, minimum):
    assert parts(version(name)) >= parts(minimum), f"{name} {version(name)} < {minimum}"
