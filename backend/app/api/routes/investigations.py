"""Investigation lifecycle endpoints (spec §18).

POST /incidents/{id}/investigate  — recall, plan, execute, review
GET  /incidents/{id}/memory       — what Hindsight recalls for this incident
POST /incidents/{id}/feedback     — accept / reject / correct
POST /incidents/{id}/resolve      — engineer applies a resolution
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import db as app_db
from app.hindsight.formatting import RecallOutcome
from app.schemas.api import (
    FeedbackRequest,
    FeedbackResponse,
    InvestigateRequest,
    InvestigateResponse,
    MemoryResponse,
    RecallSummary,
    ResolveRequest,
    ResolveResponse,
    StepOut,
)
from app.services.incidents import IncidentStore
from app.services.investigation import InvestigationAgent
from app.services.state_repository import StateRepository

router = APIRouter()


async def _repo(session: AsyncSession = Depends(app_db.get_session)) -> StateRepository:
    return StateRepository(session)


def _agent(request: Request) -> InvestigationAgent:
    return InvestigationAgent(memory=request.app.state.memory)


def _bad(exc: Exception, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=str(exc))


def _dedup(ids: Iterable[str]) -> list[str]:
    seen: list[str] = []
    for i in ids:
        if i not in seen:
            seen.append(i)
    return seen


@router.post("/{incident_id}/investigate", response_model=InvestigateResponse)
async def investigate(
    incident_id: str,
    request: Request,
    payload: InvestigateRequest | None = None,
    repo: StateRepository = Depends(_repo),
) -> InvestigateResponse:
    kind = (payload.kind if payload else "live") or "live"
    store = IncidentStore()
    if not store.get(incident_id):
        raise _bad(f"incident {incident_id} not found", 404)
    try:
        run = await _agent(request).investigate(repo, incident_id, kind=kind)
    except (KeyError, ValueError) as exc:
        raise _bad(exc) from exc

    steps = await repo.list_steps(run.id)
    return InvestigateResponse(
        run_id=run.id,
        incident_id=run.incident_id,
        kind=run.kind,
        status=run.status,
        recall=RecallSummary(
            query=run.recall_query or "",
            count=run.recalled_count or 0,
            incident_ids=_dedup(
                i for m in (run.recalled_raw or []) for i in (m.get("incident_ids") or [])
            ),
            memory_ready=bool(run.memory_ready),
            note=None if run.memory_ready else "memory recall disabled for baseline",
        ),
        strategy=run.strategy or [],
        root_cause_candidate=run.root_cause_candidate,
        used_fallback=bool(run.used_fallback),
        memory_summary=run.memory_summary,
        steps=[StepOut.model_validate(s, from_attributes=True) for s in steps],
    )


@router.get("/{incident_id}/memory", response_model=MemoryResponse)
async def incident_memory(
    incident_id: str,
    request: Request,
    repo: StateRepository = Depends(_repo),
) -> MemoryResponse:
    if not await repo.get_incident(incident_id):
        raise _bad(f"incident {incident_id} not found", 404)
    store = IncidentStore()
    incident = store.get(incident_id)
    if incident is None:
        raise _bad(f"incident {incident_id} not found", 404)

    query = f"{incident.service} reported {', '.join(incident.symptoms)}. Which layer should we check first?"
    memory = request.app.state.memory
    outcome: RecallOutcome | None = None
    note: str | None = None
    try:
        outcome = await memory.recall(query)
    except Exception as exc:  # surface the real failure, never a fake empty recall
        note = f"{type(exc).__name__}: {exc}"
    memories = []
    ids = []
    lessons: list[str] = []
    if outcome is not None:
        ids = list(outcome.incident_ids)
        memories = [
            {
                "memory_id": m.memory_id,
                "text": m.text,
                "document_id": m.document_id,
                "metadata": m.metadata,
                "tags": m.tags,
            }
            for m in outcome.memories
        ]
        for mid in ids:
            inc = store.get(mid)
            if inc and inc.lesson:
                lessons.append(inc.lesson)

    return MemoryResponse(
        query=query,
        ready=outcome is not None,
        recalled_count=outcome.count if outcome else 0,
        incident_ids=ids,
        memories=memories,
        lessons=lessons,
        stats={
            "count": len(memories),
            "incident_ids": ids,
            "source": "hindsight_recall",
            "note": note,
        },
    )


@router.post("/{incident_id}/feedback", response_model=FeedbackResponse)
async def feedback(
    incident_id: str,
    request: Request,
    payload: FeedbackRequest,
    repo: StateRepository = Depends(_repo),
) -> FeedbackResponse:
    run = None
    if payload.run_id is not None:
        run = await repo.get_run(payload.run_id)
        if run is None:
            raise _bad(f"run {payload.run_id} not found", 404)
        if run.incident_id != incident_id:
            raise _bad("run does not belong to this incident", 400)
    else:
        runs = await repo.list_runs(incident_id=incident_id, limit=50)
        awaiting = [r for r in runs if r.status == "feedback"]
        if not awaiting:
            raise _bad("no investigation for this incident is awaiting review", 409)
        run = awaiting[0]
    try:
        out = await _agent(request).apply_feedback(repo, run.id, kind=payload.kind, text=payload.text)
    except (KeyError, ValueError) as exc:
        raise _bad(exc) from exc
    run = await repo.get_run(run.id)
    return FeedbackResponse(
        run_id=out["run_id"],
        status=out["status"],
        retained=out["retained"],
        retained_at=run.retained_at if run else None,
        reason=out.get("reason"),
    )


@router.post("/{incident_id}/resolve", response_model=ResolveResponse)
async def resolve(
    incident_id: str,
    request: Request,
    payload: ResolveRequest,
    repo: StateRepository = Depends(_repo),
) -> ResolveResponse:
    # resolve() targets the latest run for this incident that is still open
    runs = await repo.list_runs(incident_id=incident_id, limit=50)
    open_runs = [r for r in runs if r.status in ("feedback", "completed")]
    if not runs:
        raise _bad(f"no investigation runs for {incident_id}", 404)
    if not open_runs:
        raise _bad("no open investigation for this incident to resolve", 409)
    run = open_runs[0]
    try:
        out = await _agent(request).resolve(repo, run.id, resolution=payload.resolution)
    except (KeyError, ValueError) as exc:
        raise _bad(exc) from exc
    return ResolveResponse(run_id=out["run_id"], status=out["status"], retained=out["retained"])