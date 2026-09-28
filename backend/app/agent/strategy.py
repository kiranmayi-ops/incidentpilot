"""Strategy engine: recall + current evidence + LLM reasoning -> ordered plan.

The whole project rests on this module being honest, so the rules below are
enforced in code rather than left to the prompt:

1. **Every cited incident id must exist in the recall result.** The LLM is
   never trusted to report which memories it used; ids not present in
   ``RecallOutcome.incident_ids`` are stripped and logged. A hallucinated
   "4 similar incidents" therefore cannot survive.
2. **The fallback is memory-driven, never a per-service rule.** If the LLM
   fails twice, candidate tools are ranked using the recalled experiences
   (tools that were successful vs low-yield in the incidents recall actually
   returned) plus signals from the current incident's own evidence. Change the
   seeded history and the fallback ranking changes with it.
3. **Determinism.** temperature 0, fixed seed, and a demo cache keyed on
   prompt + recalled memory text + model.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from math import log2
from typing import Any

from app.agent.llm import LLMClient, LLMUnavailable, get_llm
from app.hindsight.formatting import RecallOutcome
from app.schemas.incident import Incident
from app.schemas.strategy import Strategy, StrategyStep
from app.tools.telemetry import TOOL_ALLOWLIST

logger = logging.getLogger("incidentpilot.strategy")

STRATEGY_SYSTEM = """You are an SRE investigation strategist.

Do not immediately declare a root cause.

Your task is to determine the most useful ORDER in which to investigate the
current incident.

Consider:
1. current incident evidence
2. current metrics/logs
3. recent deployments
4. recalled Hindsight experiences
5. previous investigation sequences
6. successful investigation steps
7. low-value investigation steps
8. failed hypotheses
9. engineer corrections
10. contradictory or stale historical evidence

Use historical knowledge as a guide, not as proof. If the current evidence
contradicts the historical pattern, say so and do not lead with it.

For every proposed investigation step return:
- priority
- step (one of: check_metrics, query_logs, check_database, check_redis, check_recent_deployments)
- hypothesis
- reason
- historical_evidence (ONLY incident ids that appear in the recalled memory below)
- confidence

Prefer actions that maximize useful evidence quickly.

Never claim that a historical pattern proves the current root cause.
Return 3 to 5 steps as JSON matching the required schema."""


@dataclass
class StrategyResult:
    strategy: Strategy
    recall: RecallOutcome | None
    used_fallback: bool
    llm_error: str | None = None
    from_cache: bool | None = None
    stripped_ids: list[str] | None = None

    @property
    def first_step(self) -> str | None:
        steps = self.strategy.ordered()
        return steps[0].step if steps else None


# ---------------------------------------------------------------------------
# evidence rendering
# ---------------------------------------------------------------------------


def render_current_evidence(incident: Incident) -> str:
    """What the agent knows BEFORE calling any tool.

    Deliberately excludes root_cause, lesson, successful/failed steps and the
    telemetry tool results, so the strategist cannot peek at the answer.
    """
    dep = incident.recent_deployment
    deploy = (
        f"id={dep.id} age_minutes={dep.age_minutes} author={dep.author} summary={dep.summary}"
        if dep.id
        else "no deployment in the last 24h"
    )
    metrics = "\n".join(f"  {k}: {v}" for k, v in sorted(incident.metrics.items()))
    logs = "\n".join(f"  {line}" for line in incident.logs[:6])
    return (
        f"incident_id: {incident.incident_id}\n"
        f"service: {incident.service}\n"
        f"environment: {incident.environment}\n"
        f"severity: {incident.severity}\n"
        f"symptoms: {', '.join(incident.symptoms)}\n"
        f"current metrics:\n{metrics}\n"
        f"recent log lines:\n{logs}\n"
        f"most recent deployment: {deploy}\n"
        f"known dependencies: {', '.join(incident.dependencies) or 'unknown'}"
    )


def render_recalled_memory(outcome: RecallOutcome | None) -> str:
    if outcome is None or outcome.count == 0:
        return (
            "No relevant prior investigation experience was recalled. "
            "Choose a generic, evidence-driven order."
        )
    blocks = []
    for i, m in enumerate(outcome.memories, start=1):
        ids = ", ".join(m.incident_ids) or "no incident id"
        blocks.append(f"[memory {i}] (references: {ids})\n{m.text}")
    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# hallucination guard
# ---------------------------------------------------------------------------


def validate_evidence_ids(strategy: Strategy, outcome: RecallOutcome | None) -> list[str]:
    """Strip any incident id that is not in the actual recall result.

    Returns the ids that were stripped, for logging and for the UI to be able
    to show that the guard fired.
    """
    if outcome is None:
        allowed: set[str] = set()
    else:
        allowed = set(outcome.incident_ids)

    stripped: list[str] = []
    for step in strategy.strategy:
        kept = []
        for raw in step.historical_evidence:
            cid = raw.strip().upper()
            if cid in allowed:
                kept.append(cid)
            else:
                stripped.append(cid)
        step.historical_evidence = kept
    if stripped:
        logger.warning(
            "stripped hallucinated historical evidence ids: %s (allowed=%s)",
            stripped,
            sorted(allowed),
        )
    return stripped


def constrain_to_allowlist(strategy: Strategy) -> Strategy:
    kept = [s for s in strategy.strategy if s.step in TOOL_ALLOWLIST]
    if len(kept) != len(strategy.strategy):
        logger.warning(
            "dropped non-allowlisted steps: %s",
            [s.step for s in strategy.strategy if s.step not in TOOL_ALLOWLIST],
        )
        strategy.strategy = kept
    for i, s in enumerate(strategy.strategy, start=1):
        s.priority = i
    return strategy


# ---------------------------------------------------------------------------
# memory-driven fallback (spec §30)
# ---------------------------------------------------------------------------


def _log2(x: float) -> float:
    return log2(max(1.0, x))


def memory_ranked_fallback(
    incident: Incident, outcome: RecallOutcome | None, records: dict[str, Incident]
) -> Strategy:
    """Rank tools using recalled experience + current evidence.

    No per-service table exists anywhere in this function. The ranking is a
    function of (a) which tools proved useful in the incidents recall actually
    returned and (b) signals in the current incident's own evidence. Swap the
    seeded history and this ordering changes.
    """
    scores: dict[str, float] = {tool: 0.0 for tool in TOOL_ALLOWLIST}
    reasons: dict[str, list[str]] = {tool: [] for tool in TOOL_ALLOWLIST}

    ids = outcome.incident_ids if outcome else []
    useful_hits: dict[str, list[str]] = {}
    waste_hits: dict[str, list[str]] = {}
    for cid in ids:
        rec = records.get(cid)
        if rec is None:
            continue
        for step in rec.successful_steps:
            if step in scores:
                useful_hits.setdefault(step, []).append(cid)
        for step in rec.failed_steps:
            if step in scores:
                waste_hits.setdefault(step, []).append(cid)

    # --- historical prior, saturating ------------------------------------
    hist: dict[str, float] = {tool: 0.0 for tool in TOOL_ALLOWLIST}
    for step, hits in useful_hits.items():
        # Diminishing returns: three similar incidents is strong evidence but
        # must remain a *prior*, not a verdict.
        hist[step] += min(1.2, 0.7 * _log2(1 + len(hits)))
        reasons[step].append(f"useful in {len(hits)} recalled incident(s): {', '.join(hits)}")
    for step, hits in waste_hits.items():
        hist[step] -= min(0.9, 0.35 * _log2(1 + len(hits)))
        reasons[step].append(f"low-yield in {len(hits)} recalled incident(s): {', '.join(hits)}")

    # --- current evidence -------------------------------------------------
    m = incident.metrics
    live: dict[str, float] = {tool: 0.0 for tool in TOOL_ALLOWLIST}

    db_util = m.get("db_connection_utilization") or 0
    if db_util >= 0.90:
        live["check_database"] += 1.3
        reasons["check_database"].append(
            f"current db_connection_utilization={db_util} is near exhaustion"
        )
    elif db_util >= 0.70:
        live["check_database"] += 0.6
        reasons["check_database"].append(
            f"current db_connection_utilization={db_util} is elevated"
        )

    mem = m.get("memory_utilization") or 0
    restarts = m.get("replicas_restarted_last_1h") or 0
    if mem >= 0.85:
        live["check_recent_deployments"] += 0.7
        reasons["check_recent_deployments"].append(
            f"current memory_utilization={mem} suggests an application-level change"
        )
    if restarts >= 1:
        live["check_recent_deployments"] += 0.7
        reasons["check_recent_deployments"].append(
            f"replicas_restarted_last_1h={restarts} points at a recent change"
        )
    if (m.get("queue_depth") or 0) >= 5000:
        live["check_metrics"] += 0.5
        reasons["check_metrics"].append(f"current queue_depth={m.get('queue_depth')}")

    live["check_metrics"] += 0.15
    reasons["check_metrics"].append("cheap to establish a baseline")
    live["query_logs"] += 0.1
    reasons["query_logs"].append("logs are cheap corroboration")

    # --- contradiction gate ----------------------------------------------
    # If the current incident's own evidence strongly implicates some layer,
    # then a historical prior pointing at a *different* layer is not
    # "outvoted" by arithmetic - it is stale, and is dropped. This is what
    # stops the agent from being pure pattern matching, and it is derived
    # purely from the current incident plus the recalled ids. There is no
    # per-service or per-incident table anywhere in this function.
    STRONG = 0.7
    strongly_implicated = {t for t, v in live.items() if v >= STRONG}
    contradicted = {
        t for t, h in hist.items() if h > 0 and t not in strongly_implicated
    } if strongly_implicated else set()
    for t in sorted(contradicted):
        if strongly_implicated:
            logger.debug("contradiction gate: dropping historical prior for %s", t)
            hist[t] = 0.0
            reasons[t].append(
                "current evidence implicates a different layer, so this historical "
                "prior was set aside"
            )

    for tool in TOOL_ALLOWLIST:
        scores[tool] = live[tool] + hist[tool]

    ordered = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    steps: list[StrategyStep] = []
    for i, (tool, score) in enumerate(ordered[:5], start=1):
        conf = max(0.05, min(0.75, 0.2 + 0.12 * score))
        steps.append(
            StrategyStep(
                step=tool,
                priority=i,
                hypothesis=_hypothesis_for(tool),
                reason="; ".join(reasons[tool]) or "generic baseline ordering",
                historical_evidence=sorted(set(useful_hits.get(tool, []))),
                confidence=round(conf, 2),
            )
        )

    return Strategy(
        strategy=steps,
        memory_summary=(
            f"Fallback ranking from {len(ids)} recalled experience(s): "
            f"{', '.join(ids) if ids else 'none'}."
        ),
        fallback_used=True,
    )


def _hypothesis_for(tool: str) -> str:
    return {
        "check_metrics": "A saturation or regression is visible in the metric shape",
        "query_logs": "Error signatures in logs will narrow the failing layer",
        "check_database": "The primary datastore is saturated or contended",
        "check_redis": "The cache tier is exhausted or timing out",
        "check_recent_deployments": "A recent change introduced the regression",
    }.get(tool, "Unknown failure layer")


# ---------------------------------------------------------------------------
# engine
# ---------------------------------------------------------------------------


async def generate_strategy(
    incident: Incident,
    outcome: RecallOutcome | None,
    records: dict[str, Incident],
    llm: LLMClient | None = None,
) -> StrategyResult:
    """Produce the investigation strategy for one incident."""
    llm = llm or get_llm()
    user = (
        "CURRENT INCIDENT EVIDENCE\n"
        f"{render_current_evidence(incident)}\n\n"
        "RECALLED HINDSIGHT EXPERIENCES\n"
        f"{render_recalled_memory(outcome)}\n\n"
        "Produce the investigation order as JSON."
    )

    try:
        strategy, from_cache = await llm.complete_json(STRATEGY_SYSTEM, user, Strategy)
        strategy = constrain_to_allowlist(strategy)
        stripped = validate_evidence_ids(strategy, outcome)
        strategy.fallback_used = False
        return StrategyResult(
            strategy=strategy,
            recall=outcome,
            used_fallback=False,
            from_cache=from_cache,
            stripped_ids=stripped,
        )
    except LLMUnavailable as exc:
        logger.warning("strategy LLM unavailable, using memory-ranked fallback: %s", exc)
        strategy = memory_ranked_fallback(incident, outcome, records)
        return StrategyResult(
            strategy=strategy,
            recall=outcome,
            used_fallback=True,
            llm_error=str(exc),
            from_cache=None,
        )
