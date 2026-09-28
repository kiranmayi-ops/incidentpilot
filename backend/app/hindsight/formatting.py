"""Turning an investigation into Hindsight content, and back again.

The design here is dictated by what the real ``hindsight-client`` actually does
(verified against hindsight-client 0.10.1, see docs/hindsight-memory.md):

* ``retain()`` runs an **LLM fact-extraction** pipeline. It does NOT store
  your JSON. Recall therefore will not return the object below verbatim, and
  ``RetainResponse`` carries no memory count.
* ``recall()`` returns ``RecallResponse.results`` (no ``total``), so counts
  must be computed from ``len(results)``.
* ``RecallResult`` exposes ``id``/``text``/``document_id``/``metadata``/``tags``.

Consequences, which are the reason this module exists:

1. The narrative passed to ``retain`` states ``incident_id``, ``service``,
   ``root_cause`` and the **ordered investigation path** in plain prose, so
   those facts survive LLM extraction. The structured JSON is embedded too,
   as a belt-and-braces copy.
2. Incident ids are recovered from recall output by parsing them out of the
   text, with ``metadata``/``document_id`` used as corroborating signals.
3. Nothing in this module decides a strategy. It only converts memory in and
   memory out, and computes counts.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Protocol

from app.schemas.incident import Incident
from app.schemas.strategy import RecallStats

# INC-1042 style ids. Deliberately strict so we never "count" a hallucinated
# id that merely looks plausible.
INCIDENT_ID_RE = re.compile(r"\bINC-\d{3,6}\b", re.IGNORECASE)


def normalize_incident_id(value: str) -> str:
    return value.strip().upper()


def extract_incident_ids(texts: Iterable[str]) -> list[str]:
    """Recover incident ids mentioned in recall text, in first-seen order."""
    found: list[str] = []
    for text in texts:
        for m in INCIDENT_ID_RE.findall(text or ""):
            mid = normalize_incident_id(m)
            if mid not in found:
                found.append(mid)
    return found


# ---------------------------------------------------------------------------
# Experience -> retain content
# ---------------------------------------------------------------------------


@dataclass
class ExperienceRecord:
    """A single completed investigation, ready to be written to memory."""

    incident: Incident
    ordered_path: list[str]
    tool_results: dict[str, str] = field(default_factory=dict)
    engineer_feedback: str | None = None
    feedback_kind: str | None = None  # accept | reject | correct
    outcome_resolved: bool = True
    root_cause: str | None = None
    resolution: str | None = None
    time_to_resolution_minutes: int | None = None
    strategy_first_step: str | None = None
    low_value_steps: list[str] = field(default_factory=list)
    successful_steps: list[str] = field(default_factory=list)
    baseline_first_step: str | None = None
    script_kind: str = "live"  # or "scripted_feedback" for demo replay

    @property
    def root_cause_value(self) -> str:
        return self.root_cause or self.incident.root_cause

    @property
    def resolution_value(self) -> str:
        return self.resolution or self.incident.resolution


def build_experience_narrative(rec: ExperienceRecord) -> str:
    """Render the investigation as prose that survives Hindsight's extraction.

    Every fact the strategy engine later needs is stated explicitly and in
    plain language, because the retained text is what recall will surface.
    """
    inc = rec.incident
    path_text = " -> ".join(rec.ordered_path) if rec.ordered_path else "(no steps recorded)"
    low_value = ", ".join(rec.low_value_steps) or "none"
    successful = ", ".join(rec.successful_steps) or "none"
    feedback = rec.engineer_feedback or "no engineer correction recorded"
    first_step = rec.strategy_first_step or "unknown"
    baseline_first = rec.baseline_first_step or "not compared"

    lines = [
        f"Incident {inc.incident_id} on service {inc.service} "
        f"(environment {inc.environment}, severity {inc.severity}).",
        "",
        f"Symptoms reported: {', '.join(inc.symptoms)}.",
        "",
        f"The investigation path actually executed, in order, was: {path_text}.",
        f"The first investigation step chosen was {first_step}.",
        f"A memory-less baseline agent would have started with {baseline_first}.",
        "",
        f"Steps that produced useful evidence: {successful}.",
        f"Steps that were low-value (checked but ruled out): {low_value}.",
        "",
        f"Root cause of incident {inc.incident_id} was {rec.root_cause_value}.",
        f"The resolution applied was {rec.resolution_value}.",
        f"Outcome: resolved={'yes' if rec.outcome_resolved else 'no'}"
        + (
            f", time to resolution {rec.time_to_resolution_minutes} minutes."
            if rec.time_to_resolution_minutes is not None
            else "."
        ),
        "",
        f"Engineer feedback ({rec.feedback_kind or 'none'}): {feedback}",
        "",
        f"Lesson learned: {inc.lesson}",
        f"Service dependencies for {inc.service}: {', '.join(inc.dependencies) or 'unknown'}.",
    ]

    # Structured copy. Recall will not hand this back verbatim, but if the
    # chunk is ever surfaced it keeps every field addressable.
    structured = {
        "incident_id": inc.incident_id,
        "service": inc.service,
        "environment": inc.environment,
        "severity": inc.severity,
        "root_cause": rec.root_cause_value,
        "resolution": rec.resolution_value,
        "investigation_path": rec.ordered_path,
        "first_step": first_step,
        "baseline_first_step": baseline_first,
        "low_value_steps": rec.low_value_steps,
        "successful_steps": rec.successful_steps,
        "engineer_feedback": rec.engineer_feedback,
        "feedback_kind": rec.feedback_kind,
        "outcome": {
            "resolved": rec.outcome_resolved,
            "time_to_resolution_minutes": rec.time_to_resolution_minutes,
        },
        "script_kind": rec.script_kind,
    }
    lines += ["", "Structured record:", json.dumps(structured, indent=2)]
    return "\n".join(lines)


def retain_metadata(rec: ExperienceRecord) -> dict[str, str]:
    """Metadata/tags that let recall results be cross-checked.

    ``retain`` accepts ``metadata: dict[str, str]`` and ``tags: list[str]``,
    and ``RecallResult`` echoes them back. These are *corroborating* signals
    only - the authoritative id comes from the narrative text, because LLM
    extraction may drop metadata.
    """
    return {
        "incident_id": inc_id(rec),
        "service": rec.incident.service,
        "root_cause": rec.root_cause_value,
        "severity": rec.incident.severity,
        "first_step": rec.strategy_first_step or "unknown",
    }


def retain_tags(rec: ExperienceRecord) -> list[str]:
    tags = [
        "kind:investigation_experience",
        f"service:{rec.incident.service}",
        f"incident:{inc_id(rec)}",
        f"root_cause:{rec.root_cause_value}",
        f"script:{rec.script_kind}",
    ]
    if rec.engineer_feedback:
        tags.append("has_engineer_correction")
    return tags


def inc_id(rec: ExperienceRecord) -> str:
    return normalize_incident_id(rec.incident.incident_id)


# ---------------------------------------------------------------------------
# Recall results -> memory panel + counts
# ---------------------------------------------------------------------------


@dataclass
class RecalledMemory:
    memory_id: str
    text: str
    type: str | None = None
    incident_ids: list[str] = field(default_factory=list)
    document_id: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)


@dataclass
class RecallOutcome:
    query: str
    memories: list[RecalledMemory]
    budget: str = "mid"

    @property
    def count(self) -> int:
        return len(self.memories)

    @property
    def incident_ids(self) -> list[str]:
        """Ids discovered in recall text, in first-seen order."""
        out: list[str] = []
        for m in self.memories:
            for i in m.incident_ids:
                if i not in out:
                    out.append(i)
        return out

    def text(self) -> str:
        return "\n\n".join(m.text for m in self.memories)


def outcome_from_results(
    query: str, results: Iterable[Any], budget: str = "mid"
) -> RecallOutcome:
    """Adapt ``RecallResponse.results`` into our own shape.

    Accepts any object exposing ``id``/``text`` (i.e. the SDK's
    ``RecallResult``) so tests can pass lightweight stand-ins.
    """
    memories: list[RecalledMemory] = []
    for r in results:
        text = getattr(r, "text", "") or ""
        metadata = dict(getattr(r, "metadata", None) or {})
        doc_id = getattr(r, "document_id", None)
        ids = extract_incident_ids([text])
        for key in ("incident_id", "incident"):
            if metadata.get(key):
                mid = normalize_incident_id(metadata[key])
                if mid not in ids:
                    ids.append(mid)
        if doc_id and re.fullmatch(r"INC-\d{3,6}", doc_id.strip(), re.IGNORECASE):
            mid = normalize_incident_id(doc_id)
            if mid not in ids:
                ids.insert(0, mid)
        memories.append(
            RecalledMemory(
                memory_id=str(getattr(r, "id", "") or ""),
                text=text,
                type=getattr(r, "type", None),
                incident_ids=ids,
                document_id=doc_id,
                metadata=metadata,
                tags=list(getattr(r, "tags", None) or []),
            )
        )
    return RecallOutcome(query=query, memories=memories, budget=budget)


class ExperienceRecordSource(Protocol):
    """Structured records used to *count* what recall returned.

    This never influences the strategy - it only annotates recall.
    """

    def get(self, incident_id: str) -> Incident | None: ...
    def many(self, incident_ids: Iterable[str]) -> list[Incident]: ...


def compute_recall_stats(
    outcome: RecallOutcome, source: ExperienceRecordSource
) -> RecallStats:
    """Compute every number the UI shows, from real recall + real records.

    * ``recalled_count``      - len(RecallResponse.results)
    * ``incident_ids``        - ids parsed out of the recall text
    * ``engineer_confirmations`` - recalled incidents that carry a correction
    * ``low_yield_steps``     - low-value steps across those same incidents
    * ``*_step_counts``       - per-tool tallies over those same incidents
    """
    ids = outcome.incident_ids
    records = source.many(ids)
    confirmations = 0
    low_yield = 0
    success_counts: dict[str, int] = {}
    low_yield_counts: dict[str, int] = {}

    for inc in records:
        if inc.engineer_correction:
            confirmations += 1
        low_value = [s for s in inc.failed_steps]
        low_yield += len(low_value)
        for step in inc.successful_steps:
            success_counts[step] = success_counts.get(step, 0) + 1
        for step in low_value:
            low_yield_counts[step] = low_yield_counts.get(step, 0) + 1

    return RecallStats(
        recalled_count=outcome.count,
        incident_ids=ids,
        engineer_confirmations=confirmations,
        low_yield_steps=low_yield,
        successful_step_counts=dict(sorted(success_counts.items())),
        low_yield_step_counts=dict(sorted(low_yield_counts.items())),
        source="hindsight_recall",
        raw_result_ids=[m.memory_id for m in outcome.memories if m.memory_id],
    )
