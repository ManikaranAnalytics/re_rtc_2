# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build the React / Vite frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Install dependencies first (layer-cached)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent

# Copy source and build
COPY frontend/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Python / FastAPI runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY main.py __init__.py ./
COPY routers/   routers/
COPY services/  services/
COPY models/    models/
COPY data/      data/
COPY assets/    assets/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Switch to non-root
USER appuser

# Expose the app port
EXPOSE 8000

# Health-check so orchestrators know when the app is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
