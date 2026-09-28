"""Async repository over PostgreSQL application state.

One mutable repository instance per request, constructed around the request's
``AsyncSession``. All methods are thin, type-checked SQLAlchemy queries.

Nothing in here talks to Hindsight (see ``app/db.py`` docstring for the
separation rule).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.state import (
    DemoState,
    EvaluationResult,
    Feedback,
    IncidentRecord,
    InvestigationRun,
    InvestigationStep,
)
from app.services.incidents import IncidentStore


def _now() -> datetime:
    return datetime.now(timezone.utc)


class StateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------ catalog
    async def seed_catalog(self, store: IncidentStore) -> int:
        """Mirror the synthetic incident catalog into PG (idempotent)."""
        existing = set(
            (await self._session.scalars(select(IncidentRecord.incident_id))).all()
        )
        rows: list[IncidentRecord] = []
        for inc in store.list():
            if inc.incident_id in existing:
                continue
            rows.append(
                IncidentRecord(
                    incident_id=inc.incident_id,
                    tier=inc.tier,
                    timestamp=inc.timestamp,
                    service=inc.service,
                    environment=inc.environment,
                    severity=inc.severity,
                    symptoms=list(inc.symptoms),
                    metrics=dict(inc.metrics),
                    root_cause=inc.root_cause,
                    resolution=inc.resolution,
                    lesson=inc.lesson,
                )
            )
        self._session.add_all(rows)
        await self._session.flush()
        return len(rows)

    async def get_incident(self, incident_id: str) -> IncidentRecord | None:
        return await self._session.scalar(
            select(IncidentRecord).where(IncidentRecord.incident_id == incident_id)
        )

    async def list_incidents(
        self,
        *,
        tier: str | None = None,
        service: str | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[IncidentRecord]:
        stmt = select(IncidentRecord)
        if tier:
            stmt = stmt.where(IncidentRecord.tier == tier)
        if service:
            stmt = stmt.where(IncidentRecord.service == service)
        if status:
            stmt = stmt.where(IncidentRecord.status == status)
        stmt = stmt.order_by(IncidentRecord.incident_id).limit(limit).offset(offset)
        return list((await self._session.scalars(stmt)).all())

    async def incident_count(self) -> int:
        return int(await self._session.scalar(select(func.count()).select_from(IncidentRecord)) or 0)

    async def set_incident_status(self, incident_id: str, status: str) -> IncidentRecord | None:
        rec = await self.get_incident(incident_id)
        if rec is None:
            return None
        rec.status = status
        await self._session.flush()
        return rec

    # ------------------------------------------------------------------- runs
    async def create_run(
        self,
        incident_id: str,
        *,
        kind: str = "live",
        status: str = "queued",
        llm_model: str | None = None,
        recall_query: str | None = None,
    ) -> InvestigationRun:
        run = InvestigationRun(
            incident_id=incident_id,
            kind=kind,
            status=status,
            llm_model=llm_model,
            recall_query=recall_query,
        )
        self._session.add(run)
        await self._session.flush()
        return run

    async def get_run(self, run_id: int) -> InvestigationRun | None:
        return await self._session.get(InvestigationRun, run_id)

    async def update_run(self, run_id: int, **fields: Any) -> InvestigationRun | None:
        run = await self.get_run(run_id)
        if run is None:
            return None
        for key, value in fields.items():
            if hasattr(run, key):
                setattr(run, key, value)
        await self._session.flush()
        return run

    async def list_runs(
        self,
        *,
        incident_id: str | None = None,
        kind: str | None = None,
        limit: int = 100,
    ) -> list[InvestigationRun]:
        stmt = select(InvestigationRun)
        if incident_id:
            stmt = stmt.where(InvestigationRun.incident_id == incident_id)
        if kind:
            stmt = stmt.where(InvestigationRun.kind == kind)
        stmt = stmt.order_by(InvestigationRun.created_at.desc()).limit(limit)
        return list((await self._session.scalars(stmt)).all())

    # ------------------------------------------------------------------ steps
    async def add_step(
        self,
        run_id: int,
        *,
        order: int,
        tool: str,
        hypothesis: str | None = None,
        reason: str | None = None,
        confidence: float | None = None,
        result_status: str | None = None,
        evidence: dict[str, Any] | None = None,
        records: Iterable[Any] | None = None,
        useful: bool | None = None,
    ) -> InvestigationStep:
        step = InvestigationStep(
            run_id=run_id,
            order=order,
            tool=tool,
            hypothesis=hypothesis,
            reason=reason,
            confidence=confidence,
            result_status=result_status,
            evidence=evidence or {},
            records=list(records or []),
            useful=useful,
        )
        self._session.add(step)
        await self._session.flush()
        return step

    async def list_steps(self, run_id: int) -> list[InvestigationStep]:
        stmt = (
            select(InvestigationStep)
            .where(InvestigationStep.run_id == run_id)
            .order_by(InvestigationStep.order)
        )
        return list((await self._session.scalars(stmt)).all())

    async def count_steps(self, run_id: int) -> int:
        return int(
            await self._session.scalar(
                select(func.count()).select_from(InvestigationStep).where(
                    InvestigationStep.run_id == run_id
                )
            )
            or 0
        )

    async def completed_runs_with_steps(
        self, *, limit: int = 200
    ) -> list[tuple[InvestigationRun, list[InvestigationStep]]]:
        """Completed runs (oldest first) each with their executed steps.

        Powers the /learning endpoints. Everything the UI shows about strategy
        evolution is derived from REAL rows: the order the agent actually
        planned/executed per run, engineer feedback, and low-yield steps.
        """
        runs = list(
            (
                await self._session.scalars(
                    select(InvestigationRun)
                    .where(InvestigationRun.status == "completed")
                    .order_by(InvestigationRun.created_at.asc())
                )
            ).all()
        )
        runs = runs[-limit:]
        pairs: list[tuple[InvestigationRun, list[InvestigationStep]]] = []
        for run in runs:
            steps = await self.list_steps(run.id)
            pairs.append((run, steps))
        return pairs

    # -------------------------------------------------------------- timeline
    async def timeline(self, run_id: int) -> tuple[InvestigationRun | None, list[InvestigationStep]]:
        """(run, ordered steps) — everything the UI timeline needs."""
        return await self.get_run(run_id), await self.list_steps(run_id)

    # --------------------------------------------------------------- feedback
    async def add_feedback(self, run_id: int, *, kind: str, text: str | None = None) -> Feedback:
        fb = Feedback(run_id=run_id, kind=kind, text=text)
        self._session.add(fb)
        await self._session.flush()
        return fb

    async def list_feedback(self, run_id: int) -> list[Feedback]:
        stmt = (
            select(Feedback)
            .where(Feedback.run_id == run_id)
            .order_by(Feedback.created_at)
        )
        return list((await self._session.scalars(stmt)).all())

    # ------------------------------------------------------------- demo state
    async def get_demo_state(self) -> DemoState | None:
        return await self._session.get(DemoState, 1)

    async def set_demo_state(self, *, bank_id: str | None = None, phase: str) -> DemoState:
        state = await self.get_demo_state()
        if state is None:
            state = DemoState(id=1, bank_id=bank_id, phase=phase)
            self._session.add(state)
        else:
            if bank_id is not None:
                state.bank_id = bank_id
            state.phase = phase
        state.updated_at = _now()
        await self._session.flush()
        return state

    # ------------------------------------------------------------- evaluation
    async def create_eval_result(self, **fields: Any) -> EvaluationResult:
        row = EvaluationResult(**fields)
        self._session.add(row)
        await self._session.flush()
        return row

    async def list_eval_results(self, *, incident_id: str | None = None) -> list[EvaluationResult]:
        stmt = select(EvaluationResult)
        if incident_id:
            stmt = stmt.where(EvaluationResult.incident_id == incident_id)
        stmt = stmt.order_by(EvaluationResult.created_at)
        return list((await self._session.scalars(stmt)).all())