"""Investigation agent state-machine tests (spec §14, §15).

Uses real SQLAlchemy+SQLite, the REAL synthetic dataset and the REAL telemetry
tools. The LLM is pointed at a client that raises LLMUnavailable so strategy
generation falls back to the deterministic memory-ranked engine, and Hindsight
is a fake. These are test seams for a live integration, not mock-based
replacement of the agent itself.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import db as app_db  # noqa: E402
from app.agent.llm import LLMUnavailable  # noqa: E402
from app.hindsight.client import HindsightUnavailable  # noqa: E402
from app.hindsight.formatting import RecallOutcome, RecalledMemory  # noqa: E402
from app.models.state import Base  # noqa: E402
from app.services.investigation import InvestigationAgent  # noqa: E402
from app.services.state_repository import StateRepository  # noqa: E402


class FakeLLM:
    settings = type("S", (), {"llm_model": "openai/gpt-oss-120b"})()

    async def complete_json(self, *args, **kwargs):
        raise LLMUnavailable("tests use the deterministic memory-ranked fallback")


def _outcome(query: str, incident_ids: list[str] = ()) -> RecallOutcome:
    text = " ".join(f"Incident {mid} relevant experience." for mid in incident_ids)
    return RecallOutcome(
        query=query,
        memories=(
            [RecalledMemory(memory_id="m1", text=text, incident_ids=incident_ids)]
            if incident_ids
            else []
        ),
    )


class FakeMemory:
    def __init__(self, recalls=None):
        self.recalls = list(recalls or [])
        self.retained: list = []
        self.closed = False

    def close(self):
        self.closed = True

    async def recall(self, query, **kwargs):
        if self.recalls:
            return self.recalls.pop(0)
        return RecallOutcome(query=query, memories=[])

    async def retain_and_wait(self, rec, **kwargs):
        self.retained.append(rec)
        return {"success": True, "memory_ready": True, "waited_seconds": 0.2, "probe_count": 1}


@pytest.fixture
async def clean_db():
    async with app_db.get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


async def _repo():
    s = app_db.get_sessionmaker()()
    session = await s.__aenter__()
    return StateRepository(session)


async def _close(repo):
    await repo._session.__aexit__(None, None, None)


def _agent(memory: FakeMemory) -> InvestigationAgent:
    return InvestigationAgent(memory=memory, llm=FakeLLM())


# -------------------------------------------------------------- investigate


async def test_investigate_baseline_plans_generic_and_finds_candidate(clean_db):
    repo = await _repo()
    try:
        agent = _agent(FakeMemory())
        run = await agent.investigate(repo, "INC-2001", kind="baseline")
        assert run.status == "feedback"
        assert run.kind == "baseline"
        assert run.recalled_count == 0
        assert run.used_fallback is True
        assert run.recall_query is not None
        assert run.strategy, "a plan must be recorded"
        assert run.strategy[0]["step"] == "check_database"
        # baseline is memory-less: the plan should not be redis-first
        assert run.strategy[0]["step"] != "check_redis"

        steps = await repo.list_steps(run.id)
        assert [s.tool for s in steps] == [s["step"] for s in run.strategy]
        # the redis step discovered the degraded component -> candidate
        assert run.root_cause_candidate is not None
        assert run.root_cause_candidate["layer"] == "check_redis"
        assert run.root_cause_candidate["status"] == "degraded"
    finally:
        await _close(repo)


async def test_recalled_memory_changes_first_step(clean_db):
    repo = await _repo()
    try:
        memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
        run = await InvestigationAgent(memory=memory, llm=FakeLLM()).investigate(repo, "INC-2001", kind="memory")
        assert run.recalled_count == 1
        assert run.memory_ready is True
        assert run.strategy[0]["step"] == "check_redis", (
            "recalled redis-useful experience must move redis ahead of the generic database-first baseline"
        )
        steps = await repo.list_steps(run.id)
        assert steps[0].tool == "check_redis"
        assert steps[0].useful is True
    finally:
        await _close(repo)


async def test_unknown_incident_is_rejected(clean_db):
    repo = await _repo()
    try:
        with pytest.raises(KeyError):
            await _agent(FakeMemory()).investigate(repo, "INC-9999")
    finally:
        await _close(repo)


async def test_baseline_skips_recall_entirely(clean_db):
    calls: list[str] = []

    class Spying(FakeMemory):
        async def recall(self, query, **kwargs):
            calls.append(query)
            return _outcome(query, ["INC-1008"])

    repo = await _repo()
    try:
        run = await _agent(Spying()).investigate(repo, "INC-2001", kind="baseline")
        assert calls == [], "baseline must not call Hindsight"
        assert run.recalled_count == 0 and run.memory_ready is False
    finally:
        await _close(repo)


async def test_recall_failure_is_recorded_not_faked(clean_db):
    class Down(FakeMemory):
        async def recall(self, query, **kwargs):
            raise HindsightUnavailable("recall exploded")

    repo = await _repo()
    try:
        run = await _agent(Down()).investigate(repo, "INC-2001", kind="memory")
        assert run.memory_ready is False
        assert "recall exploded" in (run.memory_summary or "")
        assert run.strategy, "still must produce a strategy when memory is down"
    finally:
        await _close(repo)


# --------------------------------------------------------------- feedback


async def _investigated(repo, kind="memory", recalls=None):
    run = await _agent(FakeMemory(recalls=recalls)).investigate(repo, "INC-2001", kind=kind)
    return run


async def test_accept_retains_and_closes(clean_db):
    repo = await _repo()
    try:
        memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
        run = await InvestigationAgent(memory=memory, llm=FakeLLM()).investigate(repo, "INC-2001")
        assert run.status == "feedback"

        out = await _agent(memory).apply_feedback(repo, run.id, kind="accept")
        assert out["retained"] is True
        assert out["status"] == "completed"

        assert len(memory.retained) == 1
        rec = memory.retained[0]
        assert rec.feedback_kind == "accept"
        assert rec.outcome_resolved is True
        assert rec.ordered_path[0] == "check_redis"
        assert rec.successful_steps == ["check_redis"]

        closed = await repo.get_run(run.id)
        assert closed.status == "completed"
        assert closed.retained_at is not None
        assert closed.completed_at is not None
    finally:
        await _close(repo)


async def test_correct_records_engineer_correction(clean_db):
    repo = await _repo()
    try:
        memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
        run = await InvestigationAgent(memory=memory, llm=FakeLLM()).investigate(repo, "INC-2001")
        out = await _agent(memory).apply_feedback(
            repo, run.id, kind="correct", text="For checkout-api latency with 5xx, check Redis earlier."
        )
        assert out["retained"] is True
        rec = memory.retained[0]
        assert rec.engineer_feedback == "For checkout-api latency with 5xx, check Redis earlier."
        assert rec.feedback_kind == "correct"
        closed = await repo.get_run(run.id)
        assert closed.feedback_text == "For checkout-api latency with 5xx, check Redis earlier."
    finally:
        await _close(repo)


async def test_reject_closes_without_retain(clean_db):
    repo = await _repo()
    try:
        memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
        run = await InvestigationAgent(memory=memory, llm=FakeLLM()).investigate(repo, "INC-2001")
        out = await _agent(memory).apply_feedback(repo, run.id, kind="reject", text="unlikely")
        assert out["retained"] is False
        assert out["status"] == "completed"
        assert memory.retained == []
        closed = await repo.get_run(run.id)
        assert closed.outcome_resolved is False
        assert closed.retained_at is None
    finally:
        await _close(repo)


async def test_feedback_on_completed_run_is_rejected(clean_db):
    repo = await _repo()
    try:
        memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
        run = await InvestigationAgent(memory=memory, llm=FakeLLM()).investigate(repo, "INC-2001")
        await _agent(memory).apply_feedback(repo, run.id, kind="accept")
        with pytest.raises(ValueError):
            await _agent(memory).apply_feedback(repo, run.id, kind="accept")
    finally:
        await _close(repo)


async def test_resolve_applies_resolution_and_retains_once(clean_db):
    repo = await _repo()
    try:
        memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
        run = await InvestigationAgent(memory=memory, llm=FakeLLM()).investigate(repo, "INC-2001")
        out = await _agent(memory).resolve(repo, run.id, resolution="increase_connection_pool")
        assert out["retained"] is True
        assert len(memory.retained) == 1, "double-retain must be impossible"
        closed = await repo.get_run(run.id)
        assert closed.resolution == "increase_connection_pool"
    finally:
        await _close(repo)