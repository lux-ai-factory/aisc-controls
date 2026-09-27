"""The door of a service that only other services call.

The backend network is not a trust boundary: the engine's worker runs plugin
code there, and that code can open a socket to every service by name. So each
caller of this service holds a token of its own, one per caller edge, and sends
it in X-AISC-Service-Token, the header the platform's internal route reads.

Every path but /health needs one of the tokens this service was given. The
tokens are compared in constant time, all of them, whatever the first answer.
The door fails closed: 503 when a token this service expects is not set (or two
are the same value, which would be one shared token under two names), 401 when
the one sent is none of them.

One module, the same bytes in every service that has this door
(scripts/tests/test_service_tokens.py checks it), because each service is built
from its own directory.
"""
from __future__ import annotations

import hmac
import os
from collections.abc import Mapping

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

HEADER = "x-aisc-service-token"
OPEN_PATHS = frozenset({"/health"})


def refusal(names: tuple[str, ...], given: str | None, env: Mapping[str, str]) -> tuple[int, str] | None:
    """Why this caller may not pass, as (status, detail), or None to let it through."""
    expected = [env.get(name) or "" for name in names]
    if not names or not all(expected):
        return 503, "this service is closed: its service tokens are not set"
    if len(set(expected)) < len(expected):
        return 503, "this service is closed: its service tokens must differ"
    matched = False
    for token in expected:
        if hmac.compare_digest((given or "").encode(), token.encode()):
            matched = True
    if not matched:
        return 401, "a service token is needed"
    return None


class ServiceTokens:
    """ASGI middleware: `app.add_middleware(ServiceTokens, names=("A_TO_B_TOKEN", ...))`.

    `names` are the environment variables holding the callers' tokens, read on
    every request so a test (or a rotated secret on restart) is seen at once.
    """

    def __init__(self, app, names: tuple[str, ...]):
        self.app = app
        self.names = tuple(names)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        if scope["type"] != "http":
            # no websocket route here; refuse rather than pass one through unchecked
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["path"] in OPEN_PATHS:
            await self.app(scope, receive, send)
            return
        refused = refusal(self.names, Headers(scope=scope).get(HEADER), os.environ)
        if refused is not None:
            status, detail = refused
            response = JSONResponse({"detail": detail}, status_code=status,
                                    headers={"Cache-Control": "no-store"})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
