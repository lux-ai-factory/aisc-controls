"""The checklist report renderer: a submission's report JSON to PDF.

The controls app POSTs the payload built by src/lib/report.ts to /render/pdf;
templates/document.html.j2 renders it, WeasyPrint turns it into a PDF.
/render/html returns the same page as HTML, for looking at the template.
Every path but /health needs the CONTROLS_WEB_TO_PDF_TOKEN in
X-AISC-Service-Token.

Run locally (with CONTROLS_WEB_TO_PDF_TOKEN set):
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app:app --port 8005 --reload
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML
from weasyprint.urls import URLFetcher, URLFetcherResponse

from service_token import ServiceTokens

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"

# Always on: select_autoescape decides by the last extension, and document.html.j2 ends in .j2, so it
# escaped nothing and an answer's markup (a file:// attachment, an <img> to an internal service) reached
# WeasyPrint (code review 2026-10-06). No value in the template is meant to be raw HTML.
env = Environment(
    loader=FileSystemLoader(str(TEMPLATES)),
    autoescape=True,
    trim_blocks=True,
    lstrip_blocks=True,
)



_FILES_ONLY = URLFetcher(allowed_protocols={"file"})


def fetch_template_files(url: str, headers: Any = None) -> URLFetcherResponse:
    """A file inside templates/ (the stylesheet), and nothing else: no other local file, no network.
    Anything else raises, and WeasyPrint leaves that resource out."""
    if url.startswith("file://"):
        path = Path(url[len("file://"):].split("?")[0]).resolve()
        if path.is_relative_to(TEMPLATES.resolve()) and path.is_file():
            return _FILES_ONLY.fetch(url, headers)
    raise ValueError(f"the report fetches only its own template files, not {url}")


class TemplateFilesFetcher(URLFetcher):
    """WeasyPrint's fetcher for the report: fetch_template_files, looked up at each call."""

    def fetch(self, url, headers=None):
        return fetch_template_files(url, headers)


app = FastAPI(title="AISC Controls PDF Renderer", version="0.1.0")
# Only controls-web calls this (the submission report route), with its own token.
app.add_middleware(ServiceTokens, names=("CONTROLS_WEB_TO_PDF_TOKEN",))


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/render/html", response_class=Response)
def render_html(payload: Dict[str, Any]) -> Response:
    """The report page as HTML, rendered from the payload."""
    template = env.get_template("document.html.j2")
    html = template.render(data=payload)
    return Response(content=html, media_type="text/html; charset=utf-8")


@app.post("/render/pdf")
def render_pdf(payload: Dict[str, Any]) -> Response:
    template = env.get_template("document.html.j2")
    html = template.render(data=payload)
    try:
        pdf_bytes = HTML(string=html, base_url=str(TEMPLATES), url_fetcher=TemplateFilesFetcher()).write_pdf()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"WeasyPrint failed: {exc}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="document.pdf"'},
    )
