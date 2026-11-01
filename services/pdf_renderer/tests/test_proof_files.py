"""The report lists each question's proof files: name, type, size, who attached it, when, and SHA-256.
The files themselves are never in the report, and their names are text, never markup."""
from fastapi.testclient import TestClient

import app as renderer

FILE = {"name": "policy.pdf", "mime": "application/pdf", "size": "2.0 KB", "uploadedBy": "alice@example.org",
        "uploadedAt": "01/11/2026 09:30", "sha256": "ab" * 32}


def payload(files):
    return {"title": "T", "checklistTitle": "C", "version": 1, "status": "Closed", "readiness": 50,
            "scoredCount": 1, "totalQuestions": 1, "createdAt": "2026-10-06",
            "groups": [{"category": None, "entries": [
                {"text": "Q1", "answer": "Yes", "score": 3, "scoreLabel": "Developing", "stamp": None,
                 "files": files}]}]}


def html(body):
    return TestClient(renderer.app).post("/render/html", json=body).text


def test_each_file_is_listed_with_what_proves_it():
    out = html(payload([FILE]))
    for expected in ("policy.pdf", "application/pdf", "2.0 KB", "alice@example.org", "01/11/2026 09:30", "ab" * 32):
        assert expected in out, expected


def test_a_question_without_files_lists_none():
    assert "Proof files" not in html(payload([]))


def test_a_report_made_before_proof_files_still_renders():
    body = payload([])
    del body["groups"][0]["entries"][0]["files"]
    assert "Proof files" not in html(body)


def test_a_file_name_is_text_not_markup():
    out = html(payload([{**FILE, "name": "<img src=x onerror=alert(1)>.pdf"}]))
    assert "<img src=x" not in out and "&lt;img src=x" in out
