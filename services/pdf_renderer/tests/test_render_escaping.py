"""What an editor typed reaches the report as text, never as markup, and WeasyPrint fetches nothing but the
bundled stylesheet (code review 2026-10-06).

select_autoescape(["html", "xml"]) decides by the template's last extension, and document.html.j2 ends in
.j2: nothing was escaped. An answer like <a rel="attachment" href="file:///proc/self/environ"> then made
WeasyPrint attach the renderer's environment (its service token in it) to the PDF, and <img src="http://...">
made it call any service the renderer can reach."""
import pytest
from fastapi.testclient import TestClient

import app as renderer

ATTACH = '<a rel="attachment" href="file:///etc/passwd">x</a>'
IMAGE = '<img src="http://platform:8000/internal">'


def payload(answer):
    return {"title": "T", "checklistTitle": "C", "version": 1, "status": "Closed", "readiness": 50,
            "scoredCount": 1, "totalQuestions": 1, "createdAt": "2026-10-06",
            "groups": [{"category": "Cat", "entries": [{"text": "Q", "answer": answer, "score": 3,
                                                      "scoreLabel": "Partly"}]}]}


def test_an_answer_is_text_not_markup():
    html = TestClient(renderer.app).post("/render/html", json=payload(ATTACH + IMAGE)).text
    assert '<a rel="attachment"' not in html and "<img src=" not in html
    assert "&lt;a rel=&#34;attachment&#34;" in html or "&lt;a rel=&quot;attachment&quot;" in html


@pytest.mark.parametrize("url", ["file:///etc/passwd", "file:///proc/self/environ", "http://platform:8000/x",
                                 "https://example.com/x.png", "ftp://example.com/x"])
def test_the_fetcher_refuses_everything_outside_the_templates(url):
    with pytest.raises(ValueError):
        renderer.fetch_template_files(url)


def test_the_fetcher_serves_the_bundled_stylesheet():
    fetched = renderer.fetch_template_files((renderer.TEMPLATES / "styles.css").as_uri())
    assert b"{" in fetched.read()


def test_a_pdf_still_renders_with_its_stylesheet(monkeypatch):
    asked = []
    real = renderer.fetch_template_files

    def spy(url, *args, **kwargs):
        asked.append(url)
        return real(url, *args, **kwargs)

    monkeypatch.setattr(renderer, "fetch_template_files", spy)
    response = TestClient(renderer.app).post("/render/pdf", json=payload(ATTACH + IMAGE))
    assert response.status_code == 200 and response.content.startswith(b"%PDF")
    assert asked and all(u.endswith("styles.css") for u in asked)
