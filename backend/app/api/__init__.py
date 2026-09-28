"""API routers.

Endpoints per spec §18. Investigation life cycle:
  GET  /incidents, /incidents/{id}
  POST /incidents/{id}/investigate
  GET  /incidents/{id}/memory
  GET  /incidents/{id}/timeline
  POST /incidents/{id}/feedback
  POST /incidents/{id}/resolve
  GET  /learning/strategy, /learning/evolution
  POST /demo/reset, /demo/seed
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import demo, health, incidents, investigations

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(incidents.router, prefix="/incidents", tags=["incidents"])
api_router.include_router(investigations.router, prefix="/incidents", tags=["investigation"])
api_router.include_router(demo.router, tags=["demo", "learning"])