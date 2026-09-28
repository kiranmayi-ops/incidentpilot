"""API routers.

Following spec §18. The investigation/feedback/memory/demo/learning endpoints
arrive with the investigation agent; the state-layer endpoints live here now.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import health, incidents

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(incidents.router, prefix="/incidents", tags=["incidents"])