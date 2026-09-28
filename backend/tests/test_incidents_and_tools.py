import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402
from app.services.incidents import IncidentStore  # noqa: E402
from app.tools.telemetry import (  # noqa: E402
    TOOL_ALLOWLIST,
    ToolNotAllowed,
    execute_tool,
)


@pytest.fixture(scope="session")
def store() -> IncidentStore:
    return IncidentStore(Settings())


# --------------------------------------------------------------------------
# dataset integrity
# --------------------------------------------------------------------------


def test_dataset_loads(store: IncidentStore):
    incidents = store.list()
    assert len(incidents) >= 20, "expected a meaningful synthetic dataset"
    assert all(i.incident_id for i in incidents)


def test_tier1_has_no_checkout_api(store: IncidentStore):
    """The story depends on checkout-api history NOT existing at the start."""
    assert [i for i in store.by_tier("tier1") if i.service == "checkout-api"] == []


def test_demo_symptoms_do_not_leak_the_answer(store: IncidentStore):
    """A memory-less agent must not be handed 'redis' for free (spec §20)."""
    for inc in store.list():
        if inc.service != "checkout-api":
            continue
        blob = " ".join(inc.symptoms).lower()
        assert "redis" not in blob, f"{inc.incident_id} leaks redis in symptoms"
        assert "cache" not in blob, f"{inc.incident_id} leaks cache in symptoms"


def test_held_out_eval_incidents_exist(store: IncidentStore):
    ids = {i.incident_id for i in store.by_tier("eval")}
    assert {"INC-4001", "INC-4002", "INC-4003"} <= ids


# --------------------------------------------------------------------------
# incident-scoped telemetry
# --------------------------------------------------------------------------


def test_same_service_different_evidence(store: IncidentStore):
    """Two checkout-api incidents must disagree, or the counter-case is fake."""
    a = execute_tool(store.get("INC-2001"), "check_redis")
    b = execute_tool(store.get("INC-4002"), "check_redis")
    assert a.service == b.service == "checkout-api"
    assert a.status == "degraded"
    assert b.status == "healthy"


def test_counter_case_deploy_is_degraded(store: IncidentStore):
    r = execute_tool(store.get("INC-4002"), "check_recent_deployments")
    assert r.status == "degraded"
    assert r.evidence["rollback_candidate"]


def test_demo_incident_database_is_healthy(store: IncidentStore):
    """Baseline wastes its first step on the database, and finds nothing."""
    assert execute_tool(store.get("INC-2001"), "check_database").status == "healthy"


def test_payment_db_incident_database_is_degraded(store: IncidentStore):
    """Database-first is genuinely correct here, so memory must not say 'always redis'."""
    assert execute_tool(store.get("INC-4003"), "check_database").status == "degraded"
    assert execute_tool(store.get("INC-4003"), "check_redis").status == "healthy"


def test_tools_do_not_leak_root_cause_or_lesson(store: IncidentStore):
    inc = store.get("INC-2001")
    for tool in sorted(TOOL_ALLOWLIST):
        out = execute_tool(inc, tool)
        blob = str(out.model_dump()).lower()
        assert "root_cause" not in blob
        assert inc.lesson.lower() not in blob
        assert inc.root_cause not in blob


def test_tool_allowlist_rejects_unknown(store: IncidentStore):
    with pytest.raises(ToolNotAllowed):
        execute_tool(store.get("INC-2001"), "run_shell")  # type: ignore[arg-type]
    with pytest.raises(ToolNotAllowed):
        execute_tool(store.get("INC-2001"), "../../etc/passwd")  # type: ignore[arg-type]


def test_query_logs_falls_back_when_nothing_matches(store: IncidentStore):
    inc = store.get("INC-2001")
    out = execute_tool(inc, "query_logs", query="zzz-no-such-token")
    assert out.records, "a non-matching query must not hide the evidence"
