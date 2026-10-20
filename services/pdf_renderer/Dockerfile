# PDF renderer (FastAPI + Jinja + WeasyPrint). WeasyPrint needs Pango/Cairo/
# GDK-Pixbuf at runtime plus a font, so we install those system libs on top of
# the slim Python image before pip-installing the Python deps.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libgdk-pixbuf-2.0-0 \
      libcairo2 \
      libffi8 \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8005
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8005"]
