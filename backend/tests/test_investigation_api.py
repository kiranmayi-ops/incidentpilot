"""End-to-end API tests for the investigation life cycle (spec §18).

Runs the REAL app (lifespan seeds the actual dataset), real SQLAlchemy+SQLite,
real telemetry tools. The LLM is switched to the deterministic fallback and
Hindsight is a fake — the same seams the unit tests use; the HTTP layer,
state machine, seeding and response schemas are all real.
"""

import sys
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import db as app_db  # noqa: E402
from app.agent.llm import LLMUnavailable  # noqa: E402
from app.hindsight.formatting import RecallOutcome, RecalledMemory  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.state import Base  # noqa: E402
from app.services.state_repository import StateRepository  # noqa: E402

try:
    from app.api.routes import demo as demo_routes  # noqa: E402
except ImportError:  # pragma: no cover
    demo_routes = None


class FakeLLM:
    settings = type("S", (), {"llm_model": "openai/gpt-oss-120b"})()

    async def complete_json(self, *args, **kwargs):
        raise LLMUnavailable("tests use the deterministic fallback")


def _outcome(query, incident_ids=()):
    text = " ".join(f"Incident {i} relevant experience." for i in incident_ids)
    return RecallOutcome(
        query=query,
        memories=[RecalledMemory(memory_id="m1", text=text, incident_ids=list(incident_ids))]
        if incident_ids
        else [],
    )


class FakeMemory:
    def __init__(self, recalls=None, bank_id="fake-bank"):
        self.recalls = list(recalls or [])
        self.retained: list = []
        self.closed = False
        self.bank_id = bank_id

    def close(self):
        self.closed = True

    async def recall(self, query, **kwargs):
        if self.recalls:
            return self.recalls.pop(0)
        return RecallOutcome(query=query, memories=[])

    async def retain_and_wait(self, rec, **kwargs):
        self.retained.append(rec)
        return {"success": True, "memory_ready": True, "waited_seconds": 0.1, "probe_count": 1}

    async def ensure_bank(self):
        return {"status": "created", "bank_id": self.bank_id}


@pytest.fixture
async def clean_db():
    async with app_db.get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture
def llm_fallback(monkeypatch):
    monkeypatch.setattr("app.services.investigation.get_llm", lambda: FakeLLM())


@pytest.fixture
async def api(clean_db, llm_fallback):
    app = create_app()
    memory = FakeMemory(recalls=[_outcome("q", ["INC-1008"])])
    app.state.memory = memory
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, memory, app


# ------------------------------------------------------------- investigate


async def test_investigate_endpoint_full_life_cycle_via_api(api):
    client, memory, _ = api

    resp = await client.post("/incidents/INC-2001/investigate", json={"kind": "memory"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "feedback"
    assert body["incident_id"] == "INC-2001"
    assert body["recall"]["count"] == 1
    assert body["strategy"][0]["step"] == "check_redis", "memory moved redis first"
    assert body["root_cause_candidate"]["layer"] == "check_redis"
    assert len(body["steps"]) == len(body["strategy"])
    run_id = body["run_id"]

    fb = await client.post(
        "/incidents/INC-2001/feedback",
        json={"kind": "correct", "text": "For checkout-api latency with 5xx, check Redis earlier.", "run_id": run_id},
    )
    assert fb.status_code == 200
    fbody = fb.json()
    assert fbody["retained"] is True
    assert fbody["status"] == "completed"
    assert len(memory.retained) == 1
    assert memory.retained[0].engineer_feedback.startswith("For checkout-api latency")

    timeline = await client.get(f"/incidents/runs/{run_id}/timeline")
    assert timeline.status_code == 200
    tl = timeline.json()
    assert tl["run"]["status"] == "completed"
    assert tl["run"]["retained_at"] is not None
    assert tl["steps"][0]["tool"] == "check_redis"
    assert tl["feedback"][0]["text"].startswith("For checkout-api")


async def test_investigate_baseline_ignores_memory(api):
    client, _, _ = api
    resp = await client.post("/incidents/INC-2001/investigate", json={"kind": "baseline"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["recall"]["count"] == 0
    assert body["strategy"][0]["step"] == "check_database"
    assert "memory recall disabled for baseline" in body["recall"]["note"]


async def test_investigate_404_and_feedback_state_guard(api):
    client, _, _ = api
    assert (await client.post("/incidents/INC-9999/investigate", json={"kind": "live"})).status_code == 404
    # feedback on a run that is not awaiting review
    assert (await client.post("/incidents/INC-2001/feedback", json={"kind": "accept"})).status_code == 409


# ------------------------------------------------------------------ memory


async def test_memory_endpoint_shows_real_recall(api):
    client, memory, _ = api
    resp = await client.get("/incidents/INC-2001/memory")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ready"] is True
    assert body["recalled_count"] == 1
    assert body["incident_ids"] == ["INC-1008"]
    assert body["memories"][0]["memory_id"] == "m1"
    assert body["stats"]["source"] == "hindsight_recall"
    assert (await client.get("/incidents/INC-9999/memory")).status_code == 404


# --------------------------------------------------------------- learning


async def test_learning_derived_only_from_real_runs(api):
    client, _, _ = api
    # empty db -> honest empty answer
    empty = await client.get("/learning/strategy")
    assert empty.status_code == 200
    assert empty.json()["strategy"] == []

    first = (await client.post("/incidents/INC-2001/investigate", json={"kind": "baseline"})).json()
    await client.post("/incidents/INC-2001/feedback", json={"kind": "accept", "run_id": first["run_id"]})

    learned = (await client.get("/learning/strategy")).json()
    assert len(learned["strategy"]) >= 1
    top = learned["strategy"][0]
    assert top["step"] == "check_database"
    assert top["first_choice_count"] >= 1
    assert learned["why"]["totals"]["engineer_confirmations"] >= 1

    evo = (await client.get("/learning/evolution")).json()
    assert evo["items"][0]["incident_id"] == "INC-2001"
    assert evo["items"][0]["path"] == ["check_database", "check_metrics", "query_logs", "check_recent_deployments", "check_redis"]
    assert evo["items"][0]["retained"] is True


# ------------------------------------------------------------------- demo


async def test_demo_reset_swaps_bank(api, monkeypatch):
    client, memory, app = api

    fresh = FakeMemory(bank_id="fresh-bank")
    report = {"bank_id": "fresh-bank", "status": "created", "phase": "baseline"}

    async def fake_reset(mem, settings=None):
        return fresh, report

    monkeypatch.setattr(demo_routes, "reset_demo_bank", fake_reset)
    resp = await client.post("/demo/reset")
    assert resp.status_code == 200
    body = resp.json()
    assert body["bank_id"] == "fresh-bank"
    assert body["phase"] == "baseline"
    assert app.state.memory is fresh, "the running process must now use the fresh bank"

    async with app_db.get_sessionmaker()() as session:
        state = await StateRepository(session).get_demo_state()
        assert state.bank_id == "fresh-bank"


async def test_demo_seed_retains_tier1(api):
    client, memory, _ = api
    resp = await client.post("/demo/seed")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["seeded"]) == 16
    assert body["failures"] == []
    assert len(memory.retained) == 16
    assert all(rec.script_kind == "seed_tier1" for rec in memory.retained)


async def test_demo_replay_scripted_feedback_through_real_pipeline(api):
    client, memory, _ = api
    resp = await client.post("/demo/replay")
    assert resp.status_code == 200
    body = resp.json()
    assert {r["incident_id"] for r in body["replayed"]} == {"INC-3001", "INC-3002", "INC-3003"}
    assert body["scripted_feedback"] is True
    assert body["failures"] == []
    for rec in body["replayed"]:
        assert rec["run_id"] is not None
        assert rec["retained"] is True
        assert rec["scripted_feedback"] is True
        assert rec["feedback_text"]
    assert len(memory.retained) == 3
    assert all(rec.script_kind == "scripted_feedback" for rec in memory.retained)

    # replay produced real PostgreSQL rows that feed learning
    evo = (await client.get("/learning/evolution")).json()
    replay_items = [it for it in evo["items"] if it["kind"] == "replay"]
    assert len(replay_items) == 3
    assert all(it["retained"] and it["feedback_kind"] == "correct" for it in replay_items)