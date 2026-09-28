"""Deterministic synthetic telemetry tools.

Rules enforced here (spec §11, §23):

* Every tool is scoped by ``incident_id``. Two incidents on the same service
  return different evidence.
* Tools return RAW telemetry only. They never read ``root_cause``,
  ``successful_steps`` or ``lesson`` - a tool must never leak the answer.
* Tool names come from a hard allowlist. Nothing from LLM output is ever
  dispatched dynamically without passing through :func:`execute_tool`.
"""

from __future__ import annotations

from typing import Any, Callable

from app.schemas.incident import Incident, ToolResult

# Hard allowlist (spec §23). Anything not here cannot be executed.
TOOL_ALLOWLIST: frozenset[str] = frozenset(
    {
        "check_metrics",
        "query_logs",
        "check_database",
        "check_redis",
        "check_recent_deployments",
    }
)

TOOL_DESCRIPTIONS: dict[str, str] = {
    "check_metrics": "Return the current metric snapshot (latency, error rate, saturation).",
    "query_logs": "Return recent log lines for the incident.",
    "check_database": "Check the primary Postgres dependency for this incident.",
    "check_redis": "Check the cache/Redis dependency for this incident.",
    "check_recent_deployments": "Check deployments in the last 24h for this incident.",
}


class ToolNotAllowed(ValueError):
    """Raised when a tool name is not in the allowlist."""


class UnknownIncident(KeyError):
    """Raised when an incident id is not present in the dataset."""


def _component(incident: Incident, tool: str) -> ToolResult:
    comp = incident.telemetry.get(tool)
    if comp is None:
        return ToolResult(
            tool=tool,
            incident_id=incident.incident_id,
            service=incident.service,
            status="informational",
            evidence={},
        )
    return ToolResult(
        tool=tool,
        incident_id=incident.incident_id,
        service=incident.service,
        status=comp.status,
        evidence=comp.evidence,
    )


def check_metrics(incident: Incident, *_: Any, **__: Any) -> ToolResult:
    return ToolResult(
        tool="check_metrics",
        incident_id=incident.incident_id,
        service=incident.service,
        status="informational",
        evidence=dict(incident.metrics),
    )


def query_logs(
    incident: Incident, query: str = "", limit: int = 20, *_: Any, **__: Any
) -> ToolResult:
    """Return incident log lines, optionally filtered by a simple substring."""
    lines = incident.logs
    if query:
        q = query.strip().lower()
        matched = [ln for ln in lines if q in ln.lower()]
        # A query that matches nothing must not silently hide evidence.
        lines = matched or lines
    return ToolResult(
        tool="query_logs",
        incident_id=incident.incident_id,
        service=incident.service,
        status="informational",
        evidence={"query": query, "matched": bool(query) and not query or None},
        records=lines[: max(1, limit)],
    )


def check_database(incident: Incident, *_: Any, **__: Any) -> ToolResult:
    return _component(incident, "check_database")


def check_redis(incident: Incident, *_: Any, **__: Any) -> ToolResult:
    return _component(incident, "check_redis")


def check_recent_deployments(incident: Incident, *_: Any, **__: Any) -> ToolResult:
    result = _component(incident, "check_recent_deployments")
    dep = incident.recent_deployment
    if dep.id:
        result.evidence = {
            **result.evidence,
            "deployment_id": dep.id,
            "author": dep.author,
            "summary": dep.summary,
        }
    return result


_HANDLERS: dict[str, Callable[..., ToolResult]] = {
    "check_metrics": check_metrics,
    "query_logs": query_logs,
    "check_database": check_database,
    "check_redis": check_redis,
    "check_recent_deployments": check_recent_deployments,
}

assert set(_HANDLERS) == TOOL_ALLOWLIST, "handler table and allowlist must match"


def execute_tool(incident: Incident, tool: str, **kwargs: Any) -> ToolResult:
    """Execute an allowlisted telemetry tool against one incident.

    ``tool`` may originate from LLM output; it is validated here and nowhere
    is it used to build a path, import a module, or run a shell command.
    """
    if tool not in TOOL_ALLOWLIST:
        raise ToolNotAllowed(
            f"tool {tool!r} is not allowed. Allowed: {sorted(TOOL_ALLOWLIST)}"
        )
    return _HANDLERS[tool](incident, **kwargs)
