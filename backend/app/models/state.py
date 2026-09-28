"""SQLAlchemy ORM models for application state (spec §6).

These tables store *what happened during investigations*: the incident
catalog, investigation runs, the individual steps the agent executed, engineer
feedback, demo state, and evaluation records.

They never store the agent's learned conclusions as if they were memory.
Learning lives in Hindsight. PostgreSQL rows are only ever used to:
  - show the timeline / learning evolution
  - compute counts that annotate what Hindsight actually recalled
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class IncidentStatus(str, enum.Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"


class RunKind(str, enum.Enum):
    """What produced a run. Mirrors spec demo tiers / evaluation agents."""
    BASELINE = "baseline"  # memory recall disabled
    MEMORY = "memory"  # recall enabled
    LIVE = "live"  # interactive demo run
    REPLAY = "replay"  # scripted pre-run through the real pipeline
    EVALUATION = "evaluation"


class RunStatus(str, enum.Enum):
    QUEUED = "queued"
    RECALLING = "recalling"
    STRATEGIZING = "strategizing"
    INVESTIGATING = "investigating"
    FEEDBACK = "feedback"
    RETAINING = "retaining"
    COMPLETED = "completed"
    FAILED = "failed"


class FeedbackKind(str, enum.Enum):
    ACCEPT = "accept"
    REJECT = "reject"
    CORRECT = "correct"


class IncidentRecord(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    tier: Mapped[str] = mapped_column(String(16), index=True)
    timestamp: Mapped[str] = mapped_column(String(64))
    service: Mapped[str] = mapped_column(String(64), index=True)
    environment: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default=IncidentStatus.OPEN.value)
    symptoms: Mapped[list[Any]] = mapped_column(JSON, default=list)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    root_cause: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lesson: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<IncidentRecord {self.incident_id} {self.service}>"


class InvestigationRun(Base):
    __tablename__ = "investigation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16), default=RunKind.LIVE.value, index=True)
    status: Mapped[str] = mapped_column(String(16), default=RunStatus.QUEUED.value)
    engine: Mapped[str | None] = mapped_column(String(32), nullable=True)  # live_llm | fallback
    used_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    llm_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    recall_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    recalled_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recalled_raw: Mapped[list[Any]] = mapped_column(JSON, default=list)  # raw results for inspection
    memory_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    strategy: Mapped[list[Any]] = mapped_column(JSON, default=list)
    memory_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_observed: Mapped[bool] = mapped_column(Boolean, default=False)
    feedback_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    feedback_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_resolved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    root_cause_candidate: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set to the real timestamp when the experience was successfully retained in
    # Hindsight. Guard against double-retains from feedback + resolve.
    retained_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("incident_id", "kind", "created_at", name="uq_run_incident_kind_time"),)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InvestigationRun {self.id} {self.incident_id} {self.kind}>"


class InvestigationStep(Base):
    __tablename__ = "investigation_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, index=True)
    order: Mapped[int] = mapped_column(Integer)
    tool: Mapped[str] = mapped_column(String(64), index=True)
    hypothesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    result_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    records: Mapped[list[Any]] = mapped_column(JSON, default=list)
    useful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InvestigationStep run={self.run_id} #{self.order} {self.tool}>"


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Feedback run={self.run_id} {self.kind}>"


class DemoState(Base):
    """Single-row demo lifecycle (spec §19: fresh bank per demo run).

    Lets the frontend know which bank/phase the current demo session is in and
    keeps the story reproducible without guessing.
    """

    __tablename__ = "demo_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bank_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    phase: Mapped[str] = mapped_column(String(16), default="unknown")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class EvaluationResult(Base):
    """One evaluation run per incident per agent (baseline vs memory).

    Metrics are computed by the evaluation harness from real runs; nothing here
    is pre-baked. Rows reference the actual InvestigationRun ids they came from.
    """

    __tablename__ = "evaluation_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[str] = mapped_column(String(32), index=True)
    agent: Mapped[str] = mapped_column(String(16))  # baseline | memory
    run_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    steps_taken: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wrong_steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_to_useful_evidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    successful_diagnosis: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    adaptation_changed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)