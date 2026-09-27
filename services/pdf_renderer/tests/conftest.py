import pytest

# ── API auth WP2 (2026-09-25): the service-token door ────────────────────────
# Every endpoint of this service is behind service_token.py. The endpoint tests
# are about the endpoints, so their client carries a caller's token; the door is
# tested in test_service_token.py (DOOR_TEST = True), whose clients carry exactly
# what each test sends.

DOOR_TOKENS = {name: name.lower().replace("_", "-") + "-test-value" for name in ('CONTROLS_WEB_TO_PDF_TOKEN',)}


@pytest.fixture(autouse=True)
def _a_callers_token(monkeypatch, request):
    for name, value in DOOR_TOKENS.items():
        monkeypatch.setenv(name, value)
    if getattr(request.module, "DOOR_TEST", False):
        return
    try:
        from starlette.testclient import TestClient
    except ImportError:  # a suite run without the web stack has no client to give it
        return
    # on the request, not the constructor: some suites make their client at import
    original = TestClient.request
    first = next(iter(DOOR_TOKENS.values()))

    def with_token(self, method, url, *args, headers=None, **kwargs):
        headers = {"X-AISC-Service-Token": first, **(headers or {})}
        return original(self, method, url, *args, headers=headers, **kwargs)

    monkeypatch.setattr(TestClient, "request", with_token)
