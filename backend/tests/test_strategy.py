"""Strategy-engine tests.

The two properties that decide whether this project meets its own goal:

* recalled memory must CHANGE the strategy;
* the same agent must DEcline to follow memory when current evidence
  contradicts it.

Both are asserted with a stubbed LLM so they are deterministic, plus one test
with a real-format LLM stub whose output mimics a plausible model reply.
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.agent.llm import LLMClient, cache_key  # noqa: E402
from app.agent.strategy import (  # noqa: E402
    generate_strategy,
    memory_ranked_fallback,
    render_current_evidence,
    validate_evidence_ids,
)
from app.config import Settings  # noqa: E402
from app.hindsight.formatting import RecallOutcome, RecalledMemory  # noqa: E402
from app.schemas.strategy import Strategy  # noqa: E402
from app.services.incidents import IncidentStore  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "data" / "incidents"


def load(iid: str):
    return IncidentStore(Settings()).get(iid)


def recall(*pairs: tuple[str, str]) -> RecallOutcome:
    return RecallOutcome(
        query="checkout latency",
        memories=[
            RecalledMemory(memory_id=mid, text=text, incident_ids=[iid]) for mid, (iid, text) in enumerate(pairs)
        ],
    )


class StubLLM:
    """Stands in for LLMClient.complete_json; returns a canned Strategy."""

    def __init__(self, payload: dict | None = None, fail: bool = False) -> None:
        self.payload = payload
        self.fail = fail
        self.last_call_from_cache = False

    async def complete_json(self, system, user, model):
        if self.fail:
            from app.agent.llm import LLMUnavailable

            raise LLMUnavailable("stubbed failure")
        return model.model_validate(self.payload), False


# ---------------------------------------------------------------------------
# evidence rendering must not leak the answer
# ---------------------------------------------------------------------------


def test_current_evidence_hides_root_cause_and_lesson():
    inc = load("INC-2001")
    blob = render_current_evidence(inc)
    assert inc.root_cause not in blob
    assert inc.lesson not in blob
    assert "check_redis" not in blob.split("known dependencies")[0].replace(
        "redis-checkout", ""
    ), "tool outcomes must not be visible before the tool runs"


# ---------------------------------------------------------------------------
# hallucination guard
# ---------------------------------------------------------------------------


def test_hallucinated_incident_ids_are_stripped():
    s = Strategy.model_validate(
        {
            "strategy": [
                {
                    "step": "check_redis",
                    "priority": 1,
                    "hypothesis": "hyp",
                    "reason": "reason text",
                    "historical_evidence": ["INC-3001", "INC-9999"],
                    "confidence": 0.8,
                }
            ]
        }
    )
    stripped = validate_evidence_ids(s, recall(("INC-3001", "text")))
    assert s.strategy[0].historical_evidence == ["INC-3001"]
    assert stripped == ["INC-9999"]


def test_all_evidence_stripped_when_memory_was_empty():
    s = Strategy.model_validate(
        {
            "strategy": [
                {"step": "check_database", "priority": 1, "hypothesis": "hyp",
                 "reason": "reason text", "historical_evidence": ["INC-3001"], "confidence": 0.5}
            ]
        }
    )
    validate_evidence_ids(s, RecallOutcome(query="q", memories=[]))
    assert s.strategy[0].historical_evidence == []


# ---------------------------------------------------------------------------
# THE core claim: memory changes behaviour
# ---------------------------------------------------------------------------


def test_fallback_prefers_database_without_memory():
    inc = load("INC-2001")
    s = memory_ranked_fallback(inc, RecallOutcome(query="q", memories=[]), {})
    assert s.fallback_used is True
    assert s.strategy[0].step == "check_database"


def test_fallback_flips_to_redis_when_memory_says_so():
    """Same incident, same evidence - only the recalled history differs."""
    inc = load("INC-2001")
    store = IncidentStore(Settings())
    records = {cid: store.get(cid) for cid in ("INC-2001", "INC-3001", "INC-3002", "INC-3003")}
    outcome = recall(
        ("INC-2001", "Investigation path: check_redis -> check_recent_deployments -> check_database"),
        ("INC-3001", "Investigation path: check_redis -> check_database"),
        ("INC-3002", "Investigation path: check_redis -> check_database"),
        ("INC-3003", "Investigation path: check_redis -> check_database"),
    )
    s = memory_ranked_fallback(inc, outcome, records)
    assert s.strategy[0].step == "check_redis", (
        "recalled experience (redis-first, db low-yield) must outrank the "
        "generic database-first default"
    )
    assert s.strategy[0].historical_evidence


def test_fallback_keeps_database_first_for_payment_incident():
    """INC-4003: recalled checkout history must not make the agent 'always redis'."""
    inc = load("INC-4003")
    store = IncidentStore(Settings())
    records = {cid: store.get(cid) for cid in ("INC-3001", "INC-3002", "INC-3003")}
    outcome = recall(*[(cid, "Investigation path: check_redis -> check_database") for cid in records])
    s = memory_ranked_fallback(inc, outcome, records)
    assert s.strategy[0].step == "check_database"


def test_counter_case_deploy_signal_outweighs_redis_history():
    """INC-4002: strong deployment signal must not be buried under the redis lesson."""
    inc = load("INC-4002")
    store = IncidentStore(Settings())
    records = {cid: store.get(cid) for cid in ("INC-3001", "INC-3002", "INC-3003")}
    outcome = recall(*[(cid, "Investigation path: check_redis -> check_database") for cid in records])
    s = memory_ranked_fallback(inc, outcome, records)
    assert s.strategy[0].step != "check_redis", (
        "current evidence (memory_utilization 0.93, restart, 19-minute-old deploy) "
        "contradicts the recalled redis-first pattern"
    )


# ---------------------------------------------------------------------------
# engine wiring
# ---------------------------------------------------------------------------


async def test_engine_marks_fallback_and_survives_llm_failure():
    inc = load("INC-2001")
    res = await generate_strategy(inc, RecallOutcome(query="q", memories=[]), {}, llm=StubLLM(fail=True))
    assert res.used_fallback is True
    assert res.strategy.fallback_used is True
    assert res.llm_error


async def test_engine_strips_bad_ids_from_real_llm_output():
    inc = load("INC-4001")
    stub = StubLLM(
        {
            "strategy": [
                {"step": "check_redis", "priority": 1, "hypothesis": "cache exhaustion",
                 "reason": "recalled", "historical_evidence": ["INC-3001", "INC-7777"],
                 "confidence": 0.9},
                {"step": "check_database", "priority": 2, "hypothesis": "db saturation",
                 "reason": "reason text", "historical_evidence": [], "confidence": 0.3},
            ]
        }
    )
    outcome = recall(("INC-3001", "checkout redis pattern"))
    res = await generate_strategy(inc, outcome, {}, llm=stub)
    assert res.used_fallback is False
    assert res.strategy.strategy[0].historical_evidence == ["INC-3001"]
    assert res.stripped_ids == ["INC-7777"]


async def test_engine_drops_non_allowlisted_tool():
    inc = load("INC-2001")
    stub = StubLLM(
        {
            "strategy": [
                {"step": "run_shell", "priority": 1, "hypothesis": "shell hypothesis", "reason": "reason text",
                 "historical_evidence": [], "confidence": 0.9},
                {"step": "check_redis", "priority": 2, "hypothesis": "redis hypothesis", "reason": "reason text",
                 "historical_evidence": [], "confidence": 0.5},
            ]
        }
    )
    res = await generate_strategy(inc, None, {}, llm=stub)
    assert [s.step for s in res.strategy.ordered()] == ["check_redis"]
    assert res.first_step == "check_redis"


# ---------------------------------------------------------------------------
# LLM client: determinism, cache, validation
# ---------------------------------------------------------------------------


def test_cache_key_depends_on_memory_text():
    a = cache_key("m", "sys", "recall says INC-1")
    b = cache_key("m", "sys", "recall says INC-2")
    c = cache_key("m2", "sys", "recall says INC-1")
    assert a != b and a != c


async def test_llm_client_caches_in_demo_mode(tmp_path, monkeypatch):
    monkeypatch.setattr("app.agent.llm.CACHE_DIR", tmp_path)
    calls = []

    class FakeCompletions:
        async def create(self, **kw):
            calls.append(kw)
            msg = SimpleNamespace(
                content=json.dumps(
                    {"strategy": [{"step": "check_redis", "priority": 1, "hypothesis": "hyp",
                                   "reason": "reason text", "historical_evidence": [], "confidence": 0.5}]}
                )
            )
            return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    s = Settings()
    fake_openai = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
    llm = LLMClient(s, client=fake_openai)

    a, cached_a = await llm.complete_json("sys", "user", Strategy)
    b, cached_b = await llm.complete_json("sys", "user", Strategy)
    assert len(calls) == 1, "second identical call must come from cache"
    assert cached_a is False and cached_b is True
    assert a.strategy[0].step == b.strategy[0].step == "check_redis"

    assert llm.clear_cache() == 1
    await llm.complete_json("sys", "user", Strategy)
    assert len(calls) == 2, "after clearing the cache the real LLM is called again"


async def test_llm_client_rejects_invalid_output_then_retries(tmp_path, monkeypatch):
    monkeypatch.setattr("app.agent.llm.CACHE_DIR", tmp_path)
    responses = ["not json at all", json.dumps({"strategy": []})]

    class FakeCompletions:
        async def create(self, **kw):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=responses.pop(0)))]
            )

    s = Settings()
    llm = LLMClient(s, client=SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions())))
    with pytest.raises(Exception):
        await llm.complete_json("sys", "user", Strategy)
    assert responses == [], "both retries must be consumed"


async def test_llm_client_uses_temperature_zero_and_seed(tmp_path, monkeypatch):
    monkeypatch.setattr("app.agent.llm.CACHE_DIR", tmp_path)
    seen = {}

    class FakeCompletions:
        async def create(self, **kw):
            seen.update(kw)
            return SimpleNamespace(
                choices=[SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps(
                            {"strategy": [{"step": "check_redis", "priority": 1, "hypothesis": "hyp",
                                           "reason": "reason text", "historical_evidence": [], "confidence": 0.5}]}
                        )
                    )
                )]
            )

    s = Settings()
    s.demo_mode = False
    llm = LLMClient(s, client=SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions())))
    await llm.complete_json("sys", "user", Strategy)
    assert seen["temperature"] == 0.0
    assert seen["seed"] == s.llm_seed
