# IncidentPilot backend image.
#
# Build context is the repository root (incidentpilot/) so the image can serve
# both the application code (backend/) and the synthetic dataset (data/) to
# the FastAPI process, which locates both via REPO_ROOT at import time.
FROM python:3.14-slim

WORKDIR /srv/incidentpilot

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY data data

WORKDIR /srv/incidentpilot/backend
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]