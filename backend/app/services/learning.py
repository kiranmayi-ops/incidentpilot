"""Learning-strategy derivation from real PostgreSQL rows (spec §16 [v2]).

The UI must show how strategy evolved. All of it is COMPUTED from
``investigation_runs`` / ``investigation_steps`` rows the agent actually wrote:

  * paths: the tools executed per run, in their planned order;
  * 'first choice': the very first step the agent executed per completed run;
  * engineer confirmations: runs whose feedback was accept/correct;
  * low-yield steps: steps the tools themselves marked not useful.

Nothing here is static or pre-baked. With an empty database the response is
empty — that is the honest answer.
"""

from __future__ import annotations

from typing import Any

from app.models.state import InvestigationRun, InvestigationStep


def first_step_of(steps: list[InvestigationStep]) -> str | None:
    if not steps:
        return None
    ordered = sorted(steps, key=lambda s: s.order)
    return ordered[0].tool


def derive_learning(
    pairs: list[tuple[InvestigationRun, list[InvestigationStep]]]
) -> dict[str, Any]:
    """Return the 'current learned strategy' + 'why' panel for completed runs.

    An empty strategy with an explanatory ``why`` is a fully valid result —
    it means nothing has been learned yet and nothing should be shown as if it
    had been.
    """
    first_counts: dict[str, int] = {}
    confirmations_by_step: dict[str, int] = {}
    low_yield: dict[str, int] = {}
    seen_incidents: set[str] = set()

    for run, steps in pairs:
        if not steps:
            continue
        if run.incident_id in seen_incidents:
            continue
        seen_incidents.add(run.incident_id)

        first = first_step_of(steps)
        if first:
            first_counts[first] = first_counts.get(first, 0) + 1
        if run.feedback_kind in ("accept", "correct"):
            # an accept/correct confirms the strategy the run followed
            confirmations_by_step[first] = confirmations_by_step.get(first, 0) + 1 if first else 0
        for s in steps:
            if s.useful is False:
                low_yield[s.tool] = low_yield.get(s.tool, 0) + 1

    strategy: list[dict[str, Any]] = []
    for tool in set(first_counts) | set(confirmations_by_step):
        strategy.append(
            {
                "step": tool,
                "priority": 0,  # assigned after sorting
                "reason": _reason_for(
                    tool, first_counts.get(tool, 0), confirmations_by_step.get(tool, 0), low_yield.get(tool, 0)
                ),
                "first_choice_count": first_counts.get(tool, 0),
                "engineer_confirmations": confirmations_by_step.get(tool, 0),
                "low_yield_count": low_yield.get(tool, 0),
            }
        )
    # Prefer first-choice frequency; reward confirmation; penalize low-yield.
    strategy.sort(
        key=lambda s: (-s["first_choice_count"], -s["engineer_confirmations"], s["low_yield_count"])
    )
    for i, entry in enumerate(strategy, start=1):
        entry["priority"] = i

    totals = {
        "completed_runs": len(pairs),
        "distinct_incidents": len(seen_incidents),
        "engineer_confirmations": sum(1 for r, _ in pairs if r.feedback_kind in ("accept", "correct")),
        "low_yield_steps_total": sum(low_yield.values()),
    }

    return {
        "strategy": strategy,
        "why": {
            "totals": totals,
            "note": (
                "Computed from real investigation_runs / investigation_steps rows "
                "(planned order, engineer feedback, low-yield steps)."
            ),
        },
        "computed_from": "investigation_runs in PostgreSQL",
    }


def _reason_for(tool: str, firsts: int, confirmations: int, low_yield: int) -> str:
    parts: list[str] = []
    if firsts:
        parts.append(f"{firsts} completed investigation(s) started here")
    if confirmations:
        parts.append(f"{confirmations} engineer confirmation(s)")
    if low_yield:
        parts.append(f"checked but low-yield {low_yield} time(s)")
    return "; ".join(parts) or "no signal from completed runs"


def evolution_items(pairs: list[tuple[InvestigationRun, list[InvestigationStep]]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for run, steps in pairs:
        path = [s.tool for s in sorted(steps, key=lambda s: s.order)]
        out.append(
            {
                "incident_id": run.incident_id,
                "kind": run.kind,
                "path": path,
                "first_step": first_step_of(steps),
                "feedback_kind": run.feedback_kind,
                "retained": run.retained_at is not None,
                "created_at": run.created_at,
            }
        )
    return out