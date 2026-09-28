"""Pydantic schemas for the synthetic incident dataset.

These mirror ``data/incidents/*.json``. The dataset is the single source of
truth for synthetic telemetry; the tools never read ``root_cause`` or
``lesson`` when returning evidence.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Tier = Literal["tier1", "replay", "demo", "eval"]


class InvestigationStep(BaseModel):
    model_config = ConfigDict(extra="allow")

    order: int
    action: str
    result: str
    useful: bool


class RecentDeployment(BaseModel):
    id: str | None = None
    age_minutes: int | None = None
    author: str | None = None
    summary: str | None = None


class TelemetryComponent(BaseModel):
    """Raw, incident-scoped evidence for one dependency."""

    model_config = ConfigDict(extra="allow")

    status: Literal["healthy", "degraded", "informational"]
    evidence: dict[str, Any] = Field(default_factory=dict)


class Incident(BaseModel):
    model_config = ConfigDict(extra="allow")

    incident_id: str
    tier: Tier
    timestamp: str
    service: str
    environment: str
    severity: str
    symptoms: list[str]
    metrics: dict[str, Any]
    logs: list[str]
    recent_deployment: RecentDeployment
    initial_hypotheses: list[str]
    investigation_steps: list[InvestigationStep]
    root_cause: str
    resolution: str
    failed_steps: list[str]
    successful_steps: list[str]
    engineer_correction: str | None = None
    time_to_resolution: int
    lesson: str
    dependencies: list[str] = Field(default_factory=list)
    # Infra tiers are withheld from pre-tool evidence on purpose: naming the
    # cache tier in the alert payload hands the agent the answer.
    service_dependencies: list[str] = Field(default_factory=list)
    infra_dependencies: list[str] = Field(default_factory=list)
    telemetry: dict[str, TelemetryComponent] = Field(default_factory=dict)


class ToolResult(BaseModel):
    """Uniform envelope returned by every telemetry tool."""

    tool: str
    incident_id: str
    service: str
    status: Literal["healthy", "degraded", "informational"]
    evidence: dict[str, Any] = Field(default_factory=dict)
    records: list[str] = Field(default_factory=list)
