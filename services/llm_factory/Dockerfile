FROM python:3.12-slim

WORKDIR /app

# Install deps first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Module visibility
ENV PYTHONPATH=/app

# Runtime env
ENV DOCKER_ENV=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 5001

CMD ["uvicorn", "api:asgi_app", "--host", "0.0.0.0", "--port", "5001", "--proxy-headers"]
