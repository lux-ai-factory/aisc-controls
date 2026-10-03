"""The service-token door of the checklist report renderer (controls-pdf).

controls-web is its only caller, from the submission report route, with a token
of its own sent in X-AISC-Service-Token.
/health stays open; everything else (the API, /docs and /openapi.json) is 401
without the right token and 503 when this service has no token set.
"""
import os

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient

import app as service

DOOR_TEST = True  # conftest gives this module's clients no token of their own
HEADER = "X-AISC-Service-Token"
NAMES = ('CONTROLS_WEB_TO_PDF_TOKEN',)
#: (method, path, body) for each kind of route; the body is only there to get past the door
PROBES = [['POST', '/render/pdf', {}], ['POST', '/render/html', {}], ['GET', '/docs', None], ['GET', '/openapi.json', None]]


@pytest.fixture
def client():
    return TestClient(service.app, raise_server_exceptions=False)


@pytest.fixture
def tokens():
    """The callers' tokens, as conftest set them for this test."""
    return {name: os.environ[name] for name in NAMES}


def send(client, method, path, body, headers=None):
    return client.request(method, path, json=body, headers=headers or {})


def test_the_service_is_behind_the_door_with_its_callers_tokens():
    names = [m.kwargs.get("names") for m in service.app.user_middleware
             if m.cls.__name__ == "ServiceTokens"]
    assert names == [NAMES]


def test_health_stays_open_even_with_no_token_set(client, monkeypatch):
    assert client.get("/health").status_code == 200
    for name in NAMES:
        monkeypatch.delenv(name)
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("method,path,body", PROBES)
def test_without_a_token_it_is_401(client, method, path, body):
    res = send(client, method, path, body)
    assert res.status_code == 401
    assert res.json() == {"detail": "a service token is needed"}


@pytest.mark.parametrize("method,path,body", PROBES)
def test_a_wrong_token_is_401(client, tokens, method, path, body):
    for wrong in ("", "x", tokens[NAMES[0]] + "x", tokens[NAMES[0]].upper()):
        assert send(client, method, path, body, {HEADER: wrong}).status_code == 401, wrong


@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize("method,path,body", PROBES)
def test_each_callers_own_token_passes(client, tokens, name, method, path, body):
    res = send(client, method, path, body, {HEADER: tokens[name]})
    assert res.status_code not in (401, 503), res.text[:300]


@pytest.mark.parametrize("unset", NAMES)
def test_a_token_that_is_not_set_closes_the_service(client, tokens, monkeypatch, unset):
    monkeypatch.delenv(unset)
    method, path, body = PROBES[0]
    for name in NAMES:
        res = send(client, method, path, body, {HEADER: tokens[name]})
        assert res.status_code == 503, name
    # an empty variable is not a token either
    monkeypatch.setenv(unset, "")
    assert send(client, method, path, body, {HEADER: ""}).status_code == 503
