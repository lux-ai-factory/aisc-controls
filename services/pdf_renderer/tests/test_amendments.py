"""The report says what the submission's page says about its versions: an amendment names the version it
amends, why it was made and who asked for it, and a version that was replaced names the one that replaced it."""
from fastapi.testclient import TestClient

import app as renderer


def payload(**extra):
    return {"title": "T", "checklistTitle": "C", "version": 2, "status": "Final", "readiness": 50,
            "scoredCount": 0, "totalQuestions": 0, "createdAt": "2026-10-06", "groups": [], **extra}


def html(body):
    return TestClient(renderer.app).post("/render/html", json=body).text


def test_an_amendment_names_the_version_it_amends_why_and_who_asked():
    out = html(payload(amendment={"amends": 1, "reason": "Corrections after the card was revised",
                                  "requestedBy": "Mijke team"}))
    assert "Amends version 1" in out
    assert "Corrections after the card was revised" in out
    assert "requested by Mijke team" in out


def test_a_replaced_version_says_which_version_replaced_it():
    out = html(payload(version=1, replacedBy=2))
    assert "Replaced by version 2" in out


def test_a_first_version_still_current_says_neither():
    out = html(payload(version=1))
    assert "Amends" not in out and "Replaced by" not in out


def test_the_reason_is_escaped():
    out = html(payload(amendment={"amends": 1, "reason": "<script>x</script>", "requestedBy": "A & B"}))
    assert "<script>x</script>" not in out and "A &amp; B" in out
