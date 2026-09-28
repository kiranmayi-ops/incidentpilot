"""Incident catalog + investigation-run read endpoints (spec §18).

Write paths (investigate / feedback / resolve / demo) arrive with the
investigation agent phase. This module serves app state to the frontend.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import db as app_db
from app.schemas.api import (
    FeedbackOut,
    IncidentListOut,
    IncidentOut,
    RunOut,
    StepOut,
    TimelineOut,
)
from app.services.state_repository import StateRepository

router = APIRouter()


async def _repo(session: AsyncSession = Depends(app_db.get_session)) -> StateRepository:
    return StateRepository(session)


@router.get("", response_model=IncidentListOut)
async def list_incidents(
    repo: StateRepository = Depends(_repo),
    tier: str | None = Query(default=None),
    service: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> IncidentListOut:
    rows = await repo.list_incidents(tier=tier, service=service, status=status, limit=limit, offset=offset)
    return IncidentListOut(
        total=len(rows),
        items=[IncidentOut.from_record(r) for r in rows],
    )


@router.get("/{incident_id}", response_model=IncidentOut)
async def get_incident(incident_id: str, repo: StateRepository = Depends(_repo)) -> IncidentOut:
    rec = await repo.get_incident(incident_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"incident {incident_id} not found")
    return IncidentOut.from_record(rec)


@router.get("/{incident_id}/runs", response_model=list[RunOut])
async def list_incident_runs(
    incident_id: str,
    repo: StateRepository = Depends(_repo),
    kind: str | None = Query(default=None),
) -> list[RunOut]:
    runs = await repo.list_runs(incident_id=incident_id, kind=kind, limit=50)
    return [RunOut.model_validate(r, from_attributes=True) for r in runs]


@router.get("/{incident_id}/timeline", response_model=TimelineOut)
async def incident_timeline(
    incident_id: str,
    repo: StateRepository = Depends(_repo),
) -> TimelineOut:
    """Timeline of the most recent investigation run for an incident."""
    runs = await repo.list_runs(incident_id=incident_id, limit=1)
    if not runs:
        raise HTTPException(status_code=404, detail=f"no investigation runs for {incident_id}")
    run = runs[0]
    steps = await repo.list_steps(run.id)
    feedback = await repo.list_feedback(run.id)
    return TimelineOut(
        run=RunOut.model_validate(run, from_attributes=True),
        steps=[StepOut.model_validate(s, from_attributes=True) for s in steps],
        feedback=[FeedbackOut.model_validate(f, from_attributes=True) for f in feedback],
    )


@router.get("/runs/{run_id}/timeline", response_model=TimelineOut)
async def run_timeline(run_id: int, repo: StateRepository = Depends(_repo)) -> TimelineOut:
    run = await repo.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    steps = await repo.list_steps(run_id)
    feedback = await repo.list_feedback(run_id)
    return TimelineOut(
        run=RunOut.model_validate(run, from_attributes=True),
        steps=[StepOut.model_validate(s, from_attributes=True) for s in steps],
        feedback=[FeedbackOut.model_validate(f, from_attributes=True) for f in feedback],
    )