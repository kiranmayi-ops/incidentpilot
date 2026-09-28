"""Strategy + agent schemas.

LLM output is validated against these. Any cited historical incident id is
checked against the ids that actually appeared in the Hindsight recall
(see ``app/agent/strategy.py``) so the model cannot invent evidence.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrategyStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: str = Field(description="Tool name to execute, must be in the tool allowlist")
    priority: int = Field(ge=1, description="1 = investigate first")
    hypothesis: str = Field(min_length=3)
    reason: str = Field(min_length=3)
    historical_evidence: list[str] = Field(
        default_factory=list,
        description="Incident ids that genuinely appeared in the memory recall",
    )
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator("step")
    @classmethod
    def _strip_step(cls, v: str) -> str:
        v = v.strip()
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("step must be a simple tool name")
        return v


class Strategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy: list[StrategyStep] = Field(min_length=1, max_length=6)
    memory_summary: str = Field(
        default="",
        description="Plain-language summary of what memory contributed",
    )
    fallback_used: bool = Field(
        default=False, description="True when the LLM was unavailable and the memory-ranked fallback ran"
    )

    @field_validator("strategy")
    @classmethod
    def _unique_steps(cls, v: list[StrategyStep]) -> list[StrategyStep]:
        seen: set[str] = set()
        for s in v:
            if s.step in seen:
                raise ValueError(f"duplicate step: {s.step}")
            seen.add(s.step)
        return v

    def ordered(self) -> list[StrategyStep]:
        return sorted(self.strategy, key=lambda s: s.priority)


class HypothesisUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["supported", "refuted", "unchanged", "new"]
    hypothesis: str
    reason: str
    confidence: float = Field(ge=0.0, le=1.0)


class RootCauseCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    root_cause: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)
    contradicting_evidence: list[str] = Field(default_factory=list)
    resolution: str


class RecallStats(BaseModel):
    """Counts shown in the UI.

    Every field is COMPUTED from the real Hindsight recall plus the structured
    PostgreSQL rows for the incidents the recall actually returned. Nothing
    here is hard-coded (spec §8.4).
    """

    recalled_count: int = 0
    incident_ids: list[str] = Field(default_factory=list)
    engineer_confirmations: int = 0
    low_yield_steps: int = 0
    successful_step_counts: dict[str, int] = Field(default_factory=dict)
    low_yield_step_counts: dict[str, int] = Field(default_factory=dict)
    source: str = "hindsight_recall"
    raw_result_ids: list[str] = Field(default_factory=list)
    truncated: bool = False


class MemoryPanel(BaseModel):
    """What the memory panel renders."""

    query: str
    stats: RecallStats
    memories: list[dict[str, Any]] = Field(default_factory=list)
    lessons: list[str] = Field(default_factory=list)
    ready: bool = True
    note: str | None = None
