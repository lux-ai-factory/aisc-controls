"""The report uses the words the submission's page uses: maturity, questions, Final, and no dashes."""
from fastapi.testclient import TestClient

import app as renderer


def payload(**extra):
    return {"title": "T", "checklistTitle": "C", "version": 1, "status": "Final", "readiness": None,
            "scoredCount": 1, "answeredCount": 1, "totalQuestions": 2, "createdAt": "2026-10-06",
            "closedAt": "2026-10-07", "scoreScale": [{"value": 4, "label": "Established"}],
            "groups": [{"category": None, "entries": [
                {"text": "Q1", "answer": "Yes", "score": 4, "scoreLabel": "Established", "stamp": None},
                {"text": "Q2", "answer": None, "score": None, "scoreLabel": None, "stamp": None},
            ]}], **extra}


def html(body):
    return TestClient(renderer.app).post("/render/html", json=body).text


def test_maturity_not_readiness():
    out = html(payload())
    assert "Maturity 4/5 (Established)" in out
    assert "Maturity scale (1-5)" in out
    assert "Readiness" not in out


def test_questions_not_controls():
    out = html(payload())
    assert "Questions answered" in out and "Questions scored" in out
    assert "Controls" not in out


def test_finalised_and_not_answered_without_dashes():
    out = html(payload())
    assert "Finalised" in out and ">Closed<" not in out
    assert "Not answered" in out
    assert "—" not in out


def test_no_product_name_in_the_footer():
    assert "AISC Controls" not in html(payload())
