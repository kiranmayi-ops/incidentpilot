"""Memory-layer tests with a mocked Hindsight client (spec §22)."""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402
from app.hindsight.client import (  # noqa: E402
    HindsightMemory,
    HindsightUnavailable,
    MemoryNotReady,
)
from app.hindsight.formatting import (  # noqa: E402
    ExperienceRecord,
    build_experience_narrative,
    compute_recall_stats,
    extract_incident_ids,
    outcome_from_results,
)
from app.schemas.incident import Incident  # noqa: E402


# --------------------------------------------------------------------------
# fakes
# --------------------------------------------------------------------------


class FakeHindsight:
    """Mimics the real SDK's shapes and its async retention behaviour."""

    def __init__(self, delay_polls: int = 1, recall_results=None, exists: bool = False):
        self.delay_polls = delay_polls
        self._recall_results = recall_results or []
        self.exists = exists
        self.retained: list[dict] = []
        self.polls = 0
        self.deleted = False

    async def acreate_bank(self, **kw):
        if self.exists:
            raise RuntimeError("bank already exists")
        return SimpleNamespace(bank_id=kw["bank_id"])

    async def aretain(self, **kw):
        self.retained.append(kw)
        return SimpleNamespace(
            success=True, bank_id=kw["bank_id"], items_count=1, operation_id="op-1"
        )

    async def arecall(self, **kw):
        self.polls += 1
        if self.polls <= self.delay_polls:
            return SimpleNamespace(results=[])
        return SimpleNamespace(results=self._recall_results)

    async def alist_memories(self, **kw):
        return SimpleNamespace(total=len(self.retained), items=[], limit=1, offset=0)

    async def aget_version(self):
        return SimpleNamespace(version="0.10.1")

    async def adelete_bank(self, bank_id):
        self.deleted = True


def mk_result(text, mid="m1", type_="experience", metadata=None, doc=None, tags=None):
    return SimpleNamespace(
        id=mid, text=text, type=type_, metadata=metadata, document_id=doc, tags=tags
    )


def mk_record(incident: Incident, **kw) -> ExperienceRecord:
    defaults = dict(
        ordered_path=["check_database", "check_recent_deployments", "check_redis"],
        engineer_feedback="For checkout-api latency with 5xx, check Redis earlier.",
        feedback_kind="correct",
        strategy_first_step="check_database",
        low_value_steps=["check_database", "check_recent_deployments"],
        successful_steps=["check_redis"],
        time_to_resolution_minutes=28,
    )
    defaults.update(kw)
    return ExperienceRecord(incident=incident, **defaults)


@pytest.fixture
def inc2001() -> Incident:
    return Incident.model_validate(
        json.loads(
            (Path(__file__).resolve().parents[2] / "data/incidents/INC-2001.json").read_text()
        )
    )


# --------------------------------------------------------------------------
# narrative + id extraction
# --------------------------------------------------------------------------


def test_narrative_states_the_facts_extraction_preserves(inc2001: Incident):
    text = build_experience_narrative(mk_record(inc2001))
    assert "Incident INC-2001" in text
    assert "checkout-api" in text
    assert "redis_connection_exhaustion" in text
    # the ordered path must be explicit, not implied
    assert "check_database -> check_recent_deployments -> check_redis" in text
    assert "check Redis earlier" in text


def test_narrative_survives_a_retain_that_only_keeps_prose(inc2001: Incident):
    """A recall surface holding only the first prose paragraph is still usable."""
    text = build_experience_narrative(mk_record(inc2001))
    first_para = text.split("\n\n")[0]
    assert extract_incident_ids([first_para]) == ["INC-2001"]


def test_extract_incident_ids_is_strict():
    assert extract_incident_ids(["see INC-1042 and inc-1019"]) == ["INC-1042", "INC-1019"]
    # must not "count" plausible-looking junk
    assert extract_incident_ids(["INC-1", "INC-99999999", "incredible"]) == []


def test_recall_uses_metadata_and_document_id_as_corroboration():
    res = mk_result("no id in this text", metadata={"incident_id": "inc-3001"}, doc="INC-4002")
    out = outcome_from_results("q", [res])
    assert out.incident_ids == ["INC-4002", "INC-3001"]
    assert out.count == 1


# --------------------------------------------------------------------------
# async retention
# --------------------------------------------------------------------------


async def test_retain_and_wait_polls_until_recallable(inc2001: Incident):
    fake = FakeHindsight(
        delay_polls=3,
        recall_results=[mk_result("Incident INC-2001 root cause redis_connection_exhaustion")],
    )
    mem = HindsightMemory(Settings(), client=fake)
    out = await mem.retain_and_wait(mk_record(inc2001))
    assert out["memory_ready"] is True
    assert fake.polls == 4, "must keep polling while memory is not yet recallable"
    assert fake.retained[0]["document_id"] == "INC-2001"
    assert "kind:investigation_experience" in fake.retained[0]["tags"]


async def test_retain_and_wait_raises_when_never_recallable(inc2001: Incident):
    s = Settings()
    s.hindsight_retain_timeout_seconds = 1.0
    s.hindsight_retain_poll_seconds = 0.5
    mem = HindsightMemory(s, client=FakeHindsight(delay_polls=10_000))
    with pytest.raises(MemoryNotReady):
        await mem.retain_and_wait(mk_record(inc2001))


async def test_ensure_bank_tolerates_existing_bank():
    mem = HindsightMemory(Settings(), client=FakeHindsight(exists=True))
    res = await mem.ensure_bank()
    assert res["status"] == "already_present"


async def test_retain_failure_surfaces_as_unavailable(inc2001: Incident):
    class Boom(FakeHindsight):
        async def aretain(self, **kw):
            raise RuntimeError("500 from hindsight")

    mem = HindsightMemory(Settings(), client=Boom())
    with pytest.raises(HindsightUnavailable):
        await mem.retain(mk_record(inc2001))


# --------------------------------------------------------------------------
# health
# --------------------------------------------------------------------------


async def test_health_reports_unreachable_rather_than_ok():
    class Down(FakeHindsight):
        async def aget_version(self):
            raise RuntimeError("connection refused")

    out = await HindsightMemory(Settings(), client=Down()).health()
    assert out["reachable"] is False
    assert out["status"] == "unreachable"
    assert "connection refused" in out["error"]


async def test_health_ok_when_reachable():
    out = await HindsightMemory(Settings(), client=FakeHindsight()).health()
    assert out["reachable"] is True


# --------------------------------------------------------------------------
# counts are computed, never typed
# --------------------------------------------------------------------------


def test_recall_stats_are_computed_from_recall_and_records(inc2001: Incident):
    out = outcome_from_results(
        "checkout latency",
        [
            mk_result("Incident INC-2001 ... check_redis ...", mid="m1"),
            mk_result("Incident INC-3001 ... check_redis ...", mid="m2"),
        ],
    )

    class Source:
        def get(self, _):
            return None

        def many(self, ids):
            return [inc2001.model_copy(update={"incident_id": i}) for i in ids]

    stats = compute_recall_stats(out, Source())
    assert stats.recalled_count == 2
    assert stats.incident_ids == ["INC-2001", "INC-3001"]
    assert stats.engineer_confirmations == 2
    assert stats.low_yield_steps == 4
    assert stats.successful_step_counts == {"check_redis": 2}
    assert stats.low_yield_step_counts == {"check_database": 2, "check_recent_deployments": 2}
    assert stats.raw_result_ids == ["m1", "m2"]


def test_recall_stats_are_zero_when_memory_is_empty(inc2001: Incident):
    class Empty:
        def get(self, _):
            return None

        def many(self, ids):
            return []

    stats = compute_recall_stats(outcome_from_results("q", []), Empty())
    assert stats.recalled_count == 0
    assert stats.incident_ids == []
    assert stats.engineer_confirmations == 0


import json  # noqa: E402  (used by the inc2001 fixture)
