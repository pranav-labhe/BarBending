# 100% Offline Bar Bending Schedule (BBS) Web App Containerfile
# Compatible with both Podman (`podman build -f Containerfile`) and Docker (`docker build -f Containerfile`).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Create non-root runtime user
RUN groupadd --system appgroup && useradd --system --gid appgroup --create-home bbsuser

# Install Python dependencies (for air-gapped builds, copy ./wheels and pass --no-index --find-links=/wheels)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY pyproject.toml ./
COPY app ./app

RUN chown -R bbsuser:appgroup /app
USER bbsuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
