"""FastAPI service that renders arbitrary JSON to PDF via Jinja + WeasyPrint.

Treat this as a starting point: define a Pydantic model that matches the JSON
your Next.js app will POST, write a Jinja template under ``templates/`` that
renders that model, and the service will return a PDF.

Run locally:
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

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"

env = Environment(
    loader=FileSystemLoader(str(TEMPLATES)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

app = FastAPI(title="LAIF PDF Renderer", version="0.1.0")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/render/html", response_class=Response)
def render_html(payload: Dict[str, Any]) -> Response:
    """Render the default template with the given JSON payload and return HTML."""
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
