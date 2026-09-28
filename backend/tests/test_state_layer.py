"""PostgreSQL application-state layer tests (spec §18, §31 Phase 1).

Run against real SQLAlchemy + SQLite via the shared engine created from
``DATABASE_URL`` (set in conftest). The API tests exercise the real lifespan
(create tables + seed catalog from the actual JSON dataset) over httpx.
"""

import sys
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import db as app_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.state import Base  # noqa: E402
from app.services.incidents import IncidentStore  # noqa: E402
from app.services.state_repository import StateRepository  # noqa: E402


@pytest.fixture
async def clean_db():
    """Real drop/create through the shared engine, isolating each test."""
    async with app_db.get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


async def _session():
    async with app_db.get_sessionmaker()() as session:
        yield session


# ------------------------------------------------------------------ catalog


async def test_ping_reports_the_database_honestly(clean_db):
    assert await app_db.ping() is True


async def test_seed_catalog_is_idempotent(clean_db):
    store = IncidentStore()
    expected = store.count()
    assert expected >= 25, "dataset unexpectedly small"

    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        first = await repo.seed_catalog(store)
        await session.commit()
        assert first == expected

        second = await repo.seed_catalog(store)
        await session.commit()
        assert second == 0, "re-seeding must be a no-op"

        assert await repo.incident_count() == expected


async def test_incident_list_and_get(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        await repo.seed_catalog(IncidentStore())
        await session.commit()

    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        tier1 = await repo.list_incidents(tier="tier1")
        assert len(tier1) == 16

        demo = await repo.list_incidents(tier="demo")
        assert demo and demo[0].incident_id == "INC-2001"

        by_service = await repo.list_incidents(service="checkout-api")
        assert all(r.service == "checkout-api" for r in by_service)

        inc = await repo.get_incident("INC-2001")
        assert inc is not None
        assert inc.root_cause == "redis_connection_exhaustion"
        assert "checkout latency increased" in inc.symptoms

        assert await repo.get_incident("INC-9999") is None


async def test_set_incident_status(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        await repo.seed_catalog(IncidentStore())
        await session.commit()
        rec = await repo.set_incident_status("INC-2001", "resolved")
        assert rec is not None and rec.status == "resolved"
        assert await repo.get_incident("INC-2001") is not None
        await session.commit()

    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        assert (await repo.get_incident("INC-2001")).status == "resolved"


# ---------------------------------------------------------------------- runs


async def test_run_lifecycle(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        run = await repo.create_run("INC-3001", kind="evaluation", recall_query="checkout 5xx")
        run_id = run.id
        assert run.status == "queued"

        await repo.update_run(run_id, status="recalling", recalled_count=3, memory_ready=True)
        await repo.update_run(
            run_id,
            status="completed",
            outcome_resolved=True,
            resolution="rolled back the redis pool change",
            completed_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        )
        await session.commit()

        loaded = await repo.get_run(run_id)
        assert loaded.status == "completed"
        assert loaded.memory_ready is True
        assert loaded.recalled_count == 3
        assert loaded.resolution == "rolled back the redis pool change"
        assert loaded.kind == "evaluation"
        assert loaded.llm_model is None


async def test_steps_keep_insertion_order(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        run = await repo.create_run("INC-4001", kind="replay")
        await repo.add_step(run.id, order=3, tool="check_redis", reason="memory said so", confidence=0.9)
        await repo.add_step(run.id, order=1, tool="check_database", result_status="healthy")
        await repo.add_step(run.id, order=2, tool="check_recent_deployments", useful=True)
        await session.commit()

        steps = await repo.list_steps(run.id)
        assert [s.tool for s in steps] == ["check_database", "check_recent_deployments", "check_redis"]
        assert steps[0].order == 1 and steps[1].order == 2 and steps[2].order == 3
        assert steps[2].reason == "memory said so"
        assert steps[1].useful is True
        assert await repo.count_steps(run.id) == 3


async def test_feedback_and_timeline(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        run = await repo.create_run("INC-3001", kind="memory")
        await repo.add_step(run.id, order=1, tool="check_redis", useful=True)
        await repo.add_feedback(run.id, kind="correct", text="check Redis earlier")
        await session.commit()

        fb = await repo.list_feedback(run.id)
        assert len(fb) == 1 and fb[0].kind == "correct" and fb[0].text == "check Redis earlier"

        loaded, steps = await repo.timeline(run.id)
        assert loaded is not None and loaded.incident_id == "INC-3001"
        assert len(steps) == 1


async def test_runs_list_orders_by_recency(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        await repo.create_run("INC-3001", kind="baseline")
        await repo.create_run("INC-3001", kind="memory")
        await session.commit()

        runs = await repo.list_runs(incident_id="INC-3001")
        assert [r.kind for r in runs] == ["memory", "baseline"]
        filtered = await repo.list_runs(incident_id="INC-3001", kind="baseline")
        assert len(filtered) == 1


# -------------------------------------------------------------- demo / eval


async def test_demo_state_is_singleton_upsert(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        await repo.set_demo_state(bank_id="demo-bank-1", phase="baseline")
        await session.commit()

        await repo.set_demo_state(bank_id="demo-bank-1", phase="memory")
        await session.commit()

        state = await repo.get_demo_state()
        assert state.phase == "memory"
        assert state.bank_id == "demo-bank-1"
        assert state.id == 1, "demo state is a single row"
        assert await repo.get_demo_state() is state


async def test_eval_result_persistence(clean_db):
    async with app_db.get_sessionmaker()() as session:
        repo = StateRepository(session)
        run = await repo.create_run("INC-4001", kind="evaluation")
        await repo.create_eval_result(
            incident_id="INC-4001",
            agent="memory",
            run_id=run.id,
            steps_taken=2,
            successful_diagnosis=True,
            metrics_json={"time_to_redis": 1},
        )
        await session.commit()

        rows = await repo.list_eval_results(incident_id="INC-4001")
        assert len(rows) == 1
        assert rows[0].agent == "memory" and rows[0].successful_diagnosis is True


# ---------------------------------------------------------------------- API


async def test_api_serves_seeded_catalog():
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/incidents")
            assert resp.status_code == 200
            body = resp.json()
            assert body["total"] == IncidentStore().count()
            assert body["items"][0]["incident_id"].startswith("INC-")

            resp = await client.get("/incidents", params={"tier": "tier1"})
            assert resp.status_code == 200
            assert resp.json()["total"] == 16

            resp = await client.get("/incidents/INC-2001")
            assert resp.status_code == 200
            assert resp.json()["root_cause"] == "redis_connection_exhaustion"

            resp = await client.get("/incidents/INC-9999")
            assert resp.status_code == 404


async def test_api_timeline_latest_run():
    app = create_app()
    async with app.router.lifespan_context(app):
        async with app_db.get_sessionmaker()() as session:
            repo = StateRepository(session)
            run = await repo.create_run("INC-2001", kind="memory")
            await repo.update_run(run.id, recalled_count=2, memory_ready=True)
            await repo.add_step(run.id, order=1, tool="check_redis", reason="recalled memory", useful=True)
            await repo.add_feedback(run.id, kind="correct", text="check Redis earlier")
            await session.commit()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/incidents/INC-2001/timeline")
            assert resp.status_code == 200
            body = resp.json()
            assert body["run"]["recalled_count"] == 2
            assert body["steps"][0]["tool"] == "check_redis"
            assert body["feedback"][0]["text"] == "check Redis earlier"


async def test_health_reports_degraded_when_hindsight_unconfigured(clean_db):
    captured = {}

    async def fake_health(self):
        captured["called"] = True
        return {"status": "unconfigured", "reachable": False, "configured": False}

    app = create_app()
    app.state.memory = type("FakeMem", (), {"health": fake_health, "close": lambda self: None})()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/health")
            assert resp.status_code == 503
            detail = resp.json().get("detail")
            assert "hindsight" in detail
    assert captured.get("called") is True