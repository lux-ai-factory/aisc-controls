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
from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from service_token import ServiceTokens

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"

env = Environment(
    loader=FileSystemLoader(str(TEMPLATES)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

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
        pdf_bytes = HTML(string=html, base_url=str(TEMPLATES)).write_pdf()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"WeasyPrint failed: {exc}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="document.pdf"'},
    )
