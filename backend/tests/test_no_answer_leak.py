"""Guards that the pre-tool evidence never contains the answer.

The live gate failed this twice: first because the alert payload listed
`redis-checkout` in its dependencies, then because the request log lines said
"calling cache layer / no connection available in pool". In both cases the
baseline agent opened with check_redis, which destroys the demo: there is no
wasted step for the engineer to correct and nothing for memory to change.

Redis evidence must appear only once check_redis has actually been executed.
"""

from __future__ import annotations

import pytest

from app.agent.strategy import render_current_evidence
from app.hindsight.formatting import ExperienceRecord, build_experience_narrative
from app.services.incidents import IncidentStore
from app.tools.telemetry import TOOL_ALLOWLIST, execute_tool

CACHE_TERMS = ("redis", "cache", "memcached", "valkey", "evict")
GROUND_TRUTH_FIELDS = (
    "root_cause",
    "lesson",
    "investigation_steps",
    "successful_steps",
    "engineer_correction",
    "infra_dependencies",
)


@pytest.fixture(scope="module")
def store() -> IncidentStore:
    return IncidentStore()


@pytest.mark.parametrize("incident_id", ["INC-2001", "INC-4001"])
def test_pre_tool_evidence_does_not_name_the_cache_tier(
    store: IncidentStore, incident_id: str
) -> None:
    """The baseline must not be handed the tier that is actually broken."""
    evidence = render_current_evidence(store.get(incident_id)).lower()
    found = [term for term in CACHE_TERMS if term in evidence]
    assert not found, (
        f"{incident_id} pre-tool evidence leaks the cache tier via {found}. "
        "Infra topology belongs in Hindsight memory or in check_redis output, "
        "not in the alert payload."
    )


@pytest.mark.parametrize("incident_id", ["INC-2001", "INC-4001"])
def test_pre_tool_evidence_omits_ground_truth_fields(
    store: IncidentStore, incident_id: str
) -> None:
    """Answer keys must never reach the strategy prompt."""
    evidence = render_current_evidence(store.get(incident_id))
    for field in GROUND_TRUTH_FIELDS:
        assert field not in evidence


def test_service_dependencies_exclude_infra_tiers(store: IncidentStore) -> None:
    incident = store.get("INC-2001")
    assert incident.service_dependencies == ["payment-api", "auth-service"]
    # The infra tiers are still recorded, just not shown pre-tool.
    assert incident.infra_dependencies == ["redis-checkout", "postgres-orders"]


def test_check_redis_is_where_cache_evidence_actually_appears(
    store: IncidentStore,
) -> None:
    """The withheld diagnosis is real and reachable via the allowlisted tool."""
    incident = store.get("INC-2001")
    result = execute_tool(incident, "check_redis")
    assert result.status == "degraded"
    evidence = result.evidence
    assert evidence["connection_pool_utilization"] > 0.9
    assert evidence["timeouts_last_5m"] > 100
    assert "check_redis" in TOOL_ALLOWLIST


def test_retained_narrative_may_mention_the_cache_tier(
    store: IncidentStore,
) -> None:
    """Memory is allowed to name the tier; that is the whole point of it.

    Hindsight stores the finished diagnosis, so the lesson must reference the
    component that was actually at fault.
    """
    record = ExperienceRecord(incident=store.get("INC-2001"), ordered_path=["check_redis"])
    narrative = build_experience_narrative(record)
    assert "edis" in narrative
