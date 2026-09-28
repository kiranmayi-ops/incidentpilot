"""GET /health — real DB + Hindsight reachability (spec §8.5, §18).

The app must never silently pretend Hindsight is available. This endpoint
performs a real DB round-trip and a real Hindsight version call, and returns
HTTP 503 when either is unusable so an orchestrator / demo judge can see it.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import db as app_db
from app.config import get_settings
from app.schemas.api import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter()


async def _db_status() -> dict:
    try:
        await app_db.ping()
        return {"status": "ok", "reachable": True}
    except Exception as exc:  # pragmatic: report the failure honestly
        return {"status": "unreachable", "reachable": False, "error": f"{type(exc).__name__}: {exc}"}


@router.get("/health", response_model=HealthResponse)
async def health(request: Request, _: AsyncSession = Depends(app_db.get_session)) -> HealthResponse:
    settings = get_settings()
    database = await _db_status()
    memory: HindsightMemory = request.app.state.memory
    try:
        hindsight = await memory.health()
    except Exception as exc:  # pragma: no cover - defensive
        hindsight = {"status": "unreachable", "reachable": False, "error": f"{type(exc).__name__}: {exc}"}

    status = "ok"
    if database.get("status") != "ok":
        status = "degraded"
    if hindsight.get("status") not in ("ok", "payment_required"):
        status = "degraded"

    body = HealthResponse(
        status=status,
        database=database,
        hindsight=hindsight,
        demo_mode=settings.demo_mode,
    )
    if status != "ok":
        raise HTTPException(status_code=503, detail=body.model_dump())
    return body