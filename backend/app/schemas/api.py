"""Pydantic schemas for HTTP responses (API layer).

The ORM rows are converted to these plain Pydantic models so the API surface
is stable and never leaks ORM internals.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class OutModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------- /health
class HealthResponse(BaseModel):
    status: str
    database: dict[str, Any]
    hindsight: dict[str, Any]
    demo_mode: bool
    version: str = "0.1.0"


# ---------------------------------------------------------------- incidents
class IncidentOut(OutModel):
    incident_id: str
    tier: str
    timestamp: str
    service: str
    environment: str
    severity: str
    status: str
    symptoms: list[str]
    metrics: dict[str, Any]
    root_cause: str | None
    resolution: str | None
    lesson: str | None
    created_at: datetime

    @classmethod
    def from_record(cls, rec: Any) -> "IncidentOut":
        return cls(
            incident_id=rec.incident_id,
            tier=rec.tier,
            timestamp=rec.timestamp,
            service=rec.service,
            environment=rec.environment,
            severity=rec.severity,
            status=rec.status,
            symptoms=list(rec.symptoms),
            metrics=dict(rec.metrics),
            root_cause=rec.root_cause,
            resolution=rec.resolution,
            lesson=rec.lesson,
            created_at=rec.created_at,
        )


class IncidentListOut(BaseModel):
    total: int
    items: list[IncidentOut]


# ---------------------------------------------------------------------- runs
class RunOut(OutModel):
    id: int
    incident_id: str
    kind: str
    status: str
    engine: str | None
    used_fallback: bool
    llm_model: str | None
    recall_query: str | None
    recalled_count: int | None
    memory_ready: bool
    strategy: list[Any]
    memory_summary: str | None
    feedback_kind: str | None
    feedback_text: str | None
    outcome_resolved: bool | None
    root_cause_candidate: dict[str, Any] | None
    resolution: str | None
    created_at: datetime
    completed_at: datetime | None


class StepOut(OutModel):
    id: int
    run_id: int
    order: int
    tool: str
    hypothesis: str | None
    reason: str | None
    confidence: float | None
    result_status: str | None
    evidence: dict[str, Any]
    records: list[Any]
    useful: bool | None
    created_at: datetime


class FeedbackOut(OutModel):
    id: int
    run_id: int
    kind: str
    text: str | None
    created_at: datetime


class TimelineOut(BaseModel):
    run: RunOut
    steps: list[StepOut]
    feedback: list[FeedbackOut]


# --------------------------------------------------------------- demo state
class DemoStateOut(BaseModel):
    bank_id: str | None
    phase: str
    updated_at: datetime


HealthOut = HealthResponse