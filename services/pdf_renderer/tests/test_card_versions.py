"""The report says under which versions of the AI card the answers were given, as the submission's page does:
once for the whole submission, and on each answer."""
from fastapi.testclient import TestClient

import app as renderer


def payload(**extra):
    return {"title": "T", "checklistTitle": "C", "version": 1, "status": "Closed", "readiness": 50,
            "scoredCount": 1, "totalQuestions": 2, "createdAt": "2026-10-06",
            "groups": [{"category": None, "entries": [
                {"text": "Q1", "answer": "Yes", "score": 3, "scoreLabel": "Developing", "stamp": "answered under v2"},
                {"text": "Q2", "answer": "No", "score": None, "scoreLabel": None, "stamp": "AI card version not recorded"},
            ]}], **extra}


def html(body):
    return TestClient(renderer.app).post("/render/html", json=body).text


def test_the_versions_of_the_whole_submission():
    assert "v1, v2 of the AI card" in html(payload(cardVersions=[1, 2]))


def test_each_answer_carries_its_stamp():
    out = html(payload(cardVersions=[2]))
    assert "answered under v2" in out and "AI card version not recorded" in out


def test_a_report_without_versions_says_nothing_of_them():
    assert "of the AI card" not in html(payload())
