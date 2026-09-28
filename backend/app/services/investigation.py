"""Investigation agent orchestration (spec §14, §15).

One service that wires the existing pieces together:

    recall (Hindsight) -> strategy (LLM or memory-ranked fallback)
        -> execute telemetry tools -> persist steps
        -> root-cause candidate -> engineer feedback -> retain (Hindsight)

Every write lands in PostgreSQL as it happens, so the UI timeline is live even
mid-run. Learning itself always lives in Hindsight; PG rows only record what
happened. Nothing here fabricates recall, strategy, or retention.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.agent.llm import get_llm, LLMClient
from app.agent.strategy import generate_strategy
from app.config import Settings, get_settings
from app.hindsight.client import (
    HindsightMemory,
    HindsightUnavailable,
    MemoryNotReady,
    get_memory,
)
from app.hindsight.formatting import ExperienceRecord, RecallOutcome
from app.models.state import InvestigationRun
from app.schemas.incident import Incident
from app.services.incidents import IncidentStore
from app.services.state_repository import StateRepository
from app.tools.telemetry import execute_tool

logger = logging.getLogger(__name__)

MAX_PLANNED_STEPS = 5

_KNOWN_FEEDBACK_KINDS = ("accept", "reject", "correct")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def recall_query_for(incident: Incident) -> str:
    return (
        f"{incident.service} reported {', '.join(incident.symptoms)}. "
        "Which layer should we check first?"
    )


def _useful(status: str) -> bool | None:
    """Derived purely from the tool result, never from the dataset answer."""
    if status == "degraded":
        return True
    if status == "healthy":
        return False
    return None


def _candidate(step: Any, res: Any) -> dict[str, Any]:
    evidence = res.evidence or {}
    return {
        "root_cause": step.hypothesis,
        "layer": step.step,
        "confidence": round(float(step.confidence), 2),
        "status": res.status,
        "evidence": [f"{k}={v}" for k, v in list(evidence.items())[:6]],
        "resolution": _resolution_for(step.step, evidence),
    }


def _resolution_for(tool: str, evidence: dict[str, Any]) -> str:
    keys = " ".join(evidence.keys())
    if "connection_pool" in keys or "connected_clients" in keys:
        return "investigate the connection pool: raise the cap or find the client holding stale connections"
    if "replication" in keys or "lock_waits" in keys or "slow_queries" in keys:
        return "investigate database saturation: tune workload, add index, or scale the instance"
    if "deploy" in keys or "rollback_candidate" in keys:
        return "treat the recent deployment as suspect; prepare a rollback while confirming scope"
    if "latency" in keys or "error_rate" in keys:
        return "investigate the saturated path and roll back recent change if implicated"
    return "follow the degraded component; extract its error signature and confirm the fix path"


def _with_bank(settings: Settings, bank_id: str) -> Settings:
    data = settings.model_dump()
    data["hindsight_bank_id"] = bank_id
    return Settings(**data)


def _configured_model(llm: Any) -> str | None:
    """Model name from a real LLMClient or a test fake, whichever is present."""
    model = getattr(llm, "model", None)
    if callable(model):
        model = model()
    if model:
        return model
    s = getattr(llm, "settings", None) or getattr(llm, "_settings", None)
    return getattr(s, "llm_model", None) if s else None


class InvestigationAgent:
    """Turns one incident into a persisted, reviewable investigation."""

    def __init__(
        self,
        *,
        memory: HindsightMemory | None = None,
        llm: LLMClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._memory = memory or get_memory()
        self._llm = llm or get_llm()
        self._store = IncidentStore(self._settings)
        self._records: dict[str, Incident] | None = None

    def records(self) -> dict[str, Incident]:
        if self._records is None:
            self._records = {inc.incident_id: inc for inc in self._store.list()}
        return self._records

    # ------------------------------------------------------------- investigate
    async def investigate(self, repo: StateRepository, incident_id: str, *, kind: str = "live") -> InvestigationRun:
        if kind not in ("live", "memory", "baseline", "replay"):
            raise ValueError(f"unknown investigation kind {kind!r}")

        incident = self._store.get(incident_id)
        if incident is None:
            raise KeyError(incident_id)

        run = await repo.create_run(
            incident_id,
            kind=kind,
            status="recalling",
            llm_model=_configured_model(self._llm),
        )
        run.recall_query = query = recall_query_for(incident)

        outcome: RecallOutcome | None = None
        if kind != "baseline":
            try:
                outcome = await self._memory.recall(query)
            except HindsightUnavailable as exc:
                run.memory_summary = f"memory recall unavailable: {exc}"
        run.recalled_count = outcome.count if outcome else 0
        run.memory_ready = outcome is not None
        if outcome:
            run.recalled_raw = [asdict(m) for m in outcome.memories]

        result = await generate_strategy(incident, outcome, self.records(), self._llm)
        run.strategy = [s.model_dump() for s in result.strategy.ordered()]
        run.used_fallback = result.used_fallback
        run.engine = "fallback" if result.used_fallback else "live_llm"
        if result.strategy.memory_summary:
            note = run.memory_summary or ""
            run.memory_summary = (
                f"{note} | {result.strategy.memory_summary}" if note else result.strategy.memory_summary
            )
        run.status = "investigating"
        await repo._session.flush()

        candidate: dict[str, Any] | None = None
        for order, step in enumerate(result.strategy.ordered()[:MAX_PLANNED_STEPS], start=1):
            res = execute_tool(incident, step.step)
            step_row = await repo.add_step(
                run.id,
                order=order,
                tool=step.step,
                hypothesis=step.hypothesis,
                reason=step.reason,
                confidence=step.confidence,
                result_status=res.status,
                evidence=res.evidence,
                records=res.records,
                useful=_useful(res.status),
            )
            if candidate is None and res.status == "degraded":
                candidate = _candidate(step, res)
            logger.info(
                "step run=%s order=%d tool=%s status=%s",
                run.id, step_row.order, step.step, res.status,
            )

        run.root_cause_candidate = candidate
        if candidate is not None:
            run.status = "feedback"
        else:
            run.status = "completed"
            run.outcome_resolved = False
            run.completed_at = _now()
        await repo._session.flush()
        return run

    # --------------------------------------------------------------- feedback
    async def apply_feedback(
        self, repo: StateRepository, run_id: int, *, kind: str, text: str | None = None
    ) -> dict[str, Any]:
        if kind not in _KNOWN_FEEDBACK_KINDS:
            raise ValueError(f"feedback kind must be one of {_KNOWN_FEEDBACK_KINDS}")
        run = await repo.get_run(run_id)
        if run is None:
            raise KeyError(run_id)
        if run.status != "feedback":
            raise ValueError(
                f"run {run_id} is in state {run.status!r}; feedback only applies to a run awaiting review"
            )

        await repo.add_feedback(run_id, kind=kind, text=text)
        run.feedback_kind = kind
        run.feedback_text = text

        if kind == "reject":
            run.outcome_resolved = False
            run.status = "completed"
            run.completed_at = _now()
            await repo._session.flush()
            return {"run_id": run_id, "status": "completed", "retained": False, "reason": "rejected"}

        run.outcome_resolved = True
        run.status = "retaining"
        await repo._session.flush()

        return await self._finish_and_retain(repo, run, incident_of=run.incident_id)

    # ---------------------------------------------------------------- resolve
    async def resolve(self, repo: StateRepository, run_id: int, *, resolution: str) -> dict[str, Any]:
        run = await repo.get_run(run_id)
        if run is None:
            raise KeyError(run_id)
        if run.status not in ("feedback", "completed"):
            raise ValueError(f"run {run_id} is in state {run.status!r}; cannot resolve")

        if run.status == "feedback":
            kind = run.feedback_kind or "accept"
            text = run.feedback_text or "engineer confirmed and applied the resolution"
            if kind == "reject":
                await self.apply_feedback(repo, run_id, kind="reject", text=text)
            else:
                await self.apply_feedback(repo, run_id, kind=kind, text=text)
            run = await repo.get_run(run_id) or run

        run.resolution = resolution or run.resolution
        run.outcome_resolved = True
        await repo._session.flush()
        return {"run_id": run_id, "status": run.status, "retained": run.retained_at is not None}

    # ------------------------------------------------------- retain (private)
    async def _finish_and_retain(self, repo: StateRepository, run: InvestigationRun, incident_of: str) -> dict[str, Any]:
        """Complete the run and store the experience in Hindsight (real)."""
        if run.retained_at is not None:
            run.status = "completed"
            run.completed_at = _now()
            await repo._session.flush()
            return {"run_id": run.id, "status": "completed", "retained": True, "reason": "already retained"}

        incident = self._store.get(incident_of)
        record = await self._experience(repo, run, incident)
        try:
            out = await self._memory.retain_and_wait(record)
        except (HindsightUnavailable, MemoryNotReady) as exc:
            logger.warning("retain failed run=%s: %s", run.id, exc)
            run.status = "completed"
            run.completed_at = _now()
            run.memory_summary = (run.memory_summary or "") + f" | retain failed: {exc}"
            await repo._session.flush()
            return {"run_id": run.id, "status": "completed", "retained": False, "reason": str(exc)}

        run.retained_at = _now()
        run.status = "completed"
        run.completed_at = _now()
        run.memory_summary = (
            (run.memory_summary or "")
            + f" | retained {run.incident_id}; recallable after {out.get('waited_seconds')}s"
        )
        await repo._session.flush()
        return {
            "run_id": run.id,
            "status": "completed",
            "retained": True,
            "waited_seconds": out.get("waited_seconds"),
            "incident_ids_recalled": out.get("probe_count"),
        }

    async def _experience(self, repo: StateRepository, run: InvestigationRun, incident: Incident) -> ExperienceRecord:
        steps = await repo.list_steps(run.id)
        candidate = run.root_cause_candidate or {}
        return ExperienceRecord(
            incident=incident,
            ordered_path=[s.tool for s in steps],
            tool_results={s.tool: s.result_status for s in steps},
            engineer_feedback=run.feedback_text,
            feedback_kind=run.feedback_kind,
            outcome_resolved=bool(run.outcome_resolved),
            root_cause=candidate.get("root_cause"),
            resolution=candidate.get("resolution"),
            time_to_resolution_minutes=None,
            strategy_first_step=run.strategy[0]["step"] if run.strategy else None,
            low_value_steps=[s.tool for s in steps if s.useful is False],
            successful_steps=[s.tool for s in steps if s.useful is True],
            script_kind="scripted_feedback" if run.kind == "replay" else run.kind,
        )


def _seed_record(inc: Incident) -> ExperienceRecord:
    """Tier-1 knowledge record built from the dataset (spec §19 Tier 1)."""
    path = inc.successful_steps or [s.action for s in inc.investigation_steps]
    return ExperienceRecord(
        incident=inc,
        ordered_path=path,
        engineer_feedback=inc.engineer_correction,
        feedback_kind="correct" if inc.engineer_correction else None,
        outcome_resolved=True,
        root_cause=inc.root_cause,
        resolution=inc.resolution,
        strategy_first_step=path[0] if path else None,
        low_value_steps=list(inc.failed_steps),
        successful_steps=list(inc.successful_steps),
        script_kind="seed_tier1",
    )


async def seed_tier1_bank(memory: HindsightMemory, settings: Settings | None = None) -> dict[str, Any]:
    """Retain Tier-1 operational knowledge into the current bank (real retains)."""
    settings = settings or get_settings()
    store = IncidentStore(settings)
    seeded: list[str] = []
    failures: list[str] = []
    for inc in store.list(tier="tier1"):
        try:
            await memory.retain_and_wait(_seed_record(inc))
            seeded.append(inc.incident_id)
        except Exception as exc:  # keep going; report every failure honestly
            failures.append(f"{inc.incident_id}: {type(exc).__name__}: {exc}")
    return {"tier": "tier1", "seeded": seeded, "failures": failures}


async def reset_demo_bank(
    memory: HindsightMemory, settings: Settings | None = None
) -> tuple[HindsightMemory, dict[str, Any]]:
    """Create a fresh per-demo bank and return (new client, report).

    Spec §19: a fresh bank per demo run so the story is reproducible without
    destroying any real retained knowledge.
    """
    settings = settings or get_settings()
    fresh_id = f"{settings.hindsight_bank_id}-demo-{uuid4().hex[:8]}"
    fresh = HindsightMemory(_with_bank(settings, fresh_id))
    report = await fresh.ensure_bank()
    logger.info("demo bank created bank_id=%s status=%s", fresh_id, report.get("status"))
    return fresh, {"bank_id": fresh_id, "status": report.get("status"), "phase": "baseline"}