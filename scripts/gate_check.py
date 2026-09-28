#!/usr/bin/env python
"""Phase 3 / Phase 5 gate: does memory actually change behaviour?

Runs the REAL LLM (no stub) and the REAL Hindsight service. Every check that
cannot be run reports itself as SKIPPED rather than passing quietly.

Usage:
    python scripts/gate_check.py
    python scripts/gate_check.py --incidents INC-2001 INC-4001 INC-4002 INC-4003
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

from app.agent.llm import get_llm, reset_llm  # noqa: E402
from app.agent.strategy import generate_strategy  # noqa: E402
from app.config import Settings  # noqa: E402
from app.hindsight.client import HindsightBillingError, HindsightMemory, HindsightUnavailable  # noqa: E402
from app.hindsight.formatting import RecallOutcome  # noqa: E402
from app.services.incidents import IncidentStore  # noqa: E402

GREEN, RED, YELLOW, CYAN, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[36m", "\033[2m", "\033[0m"


def hdr(t: str) -> None:
    print(f"\n{'=' * 74}\n{t}\n{'=' * 74}")


def order_of(res) -> str:
    return " -> ".join(s.step for s in res.strategy.ordered())


class Gate:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.notes = 0

    def ok(self, name: str, detail: str = "") -> None:
        self.passed += 1
        print(f"{GREEN}PASS{RESET}  {name}" + (f"  {DIM}{detail}{RESET}" if detail else ""))

    def bad(self, name: str, detail: str = "") -> None:
        self.failed += 1
        print(f"{RED}FAIL{RESET}  {name}  {detail}")

    def skip(self, name: str, why: str) -> None:
        self.skipped += 1
        print(f"{YELLOW}SKIP{RESET}  {name}  {DIM}{why}{RESET}")

    def note(self, name: str, detail: str = "") -> None:
        """Informational: measured and reported, but neither pass nor fail."""
        self.notes += 1
        print(f"{CYAN}NOTE{RESET}  {name}  {DIM}{detail}{RESET}")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--incidents", nargs="*", default=["INC-2001", "INC-4001", "INC-4002", "INC-4003"])
    ap.add_argument("--recall", action="store_true", help="also test the memory-enabled path")
    ap.add_argument("--repeats", type=int, default=5,
                    help="repeats used to measure the baseline/spread distribution")
    args = ap.parse_args()

    settings = Settings()
    store = IncidentStore(settings)
    gate = Gate()

    hdr("CONFIG")
    print(f"llm      : {settings.llm_model} via {settings.llm_base_url}")
    print(f"temperature={settings.llm_temperature} seed={settings.llm_seed} "
          f"max_tokens={settings.llm_max_tokens} effort={settings.llm_reasoning_effort!r}")
    print(f"hindsight: {settings.hindsight_api_url} bank={settings.hindsight_bank_id}")
    print(f"demo_mode: {settings.demo_mode}  (llm cache active)")

    mem = HindsightMemory(settings)
    health = await mem.health()
    print(f"hindsight health: {health.get('status')} reachable={health.get('reachable')}")

    llm = get_llm()

    # ---------------------------------------------------------------- 1
    hdr("1. LIVE BASELINE (no memory) - real LLM, no stub")
    baseline: dict[str, object] = {}
    for iid in args.incidents:
        inc = store.get(iid)
        if inc is None:
            gate.bad(f"{iid} exists")
            continue
        t0 = time.time()
        res = await generate_strategy(inc, RecallOutcome(query="", memories=[]), {}, llm=llm)
        dt = time.time() - t0
        baseline[iid] = res
        tag = "fallback" if res.used_fallback else f"{'cache' if res.from_cache else 'live llm'}"
        print(f"\n  {iid} ({inc.service}, true cause {inc.root_cause})")
        print(f"    order    : {order_of(res)}")
        print(f"    engine   : {tag}  ({dt:.1f}s)")
        if res.llm_error:
            print(f"    llm_error: {res.llm_error[:160]}")
        if res.strategy.memory_summary:
            print(f"    memory   : {res.strategy.memory_summary[:120]}")

    # ---------------------------------------------------------------- 2
    hdr("2. SPEC GATE: baseline must NOT prioritise redis (measured over N repeats)")
    demo_ids = [i for i in args.incidents if store.get(i) and store.get(i).tier in ("demo", "eval")]
    redis_hits = 0
    live_runs = 0
    for iid in demo_ids:
        base = baseline.get(iid)
        if base is None or base.used_fallback:  # type: ignore[union-attr]
            continue
        for _ in range(args.repeats):
            llm.clear_cache()
            rep = await generate_strategy(
                store.get(iid), RecallOutcome(query="", memories=[]), {}, llm=llm
            )
            if rep.used_fallback:
                continue
            live_runs += 1
            if rep.first_step == "check_redis":  # type: ignore[union-attr]
                redis_hits += 1
    if not live_runs:
        gate.skip("baseline never picks redis", "all runs used the fallback, not live LLM")
    elif redis_hits:
        gate.bad("baseline never picks redis",
                 f"{redis_hits}/{live_runs} live baseline runs started with check_redis - "
                 "symptoms/logs are still leaking the answer")
    else:
        gate.ok("baseline never picks redis",
                f"0/{live_runs} live baseline runs chose check_redis first")

    # ---------------------------------------------------------------- 3
    hdr(f"3. SPREAD: {args.repeats} repeats of the same prompt, cache cleared between")
    inc = store.get(args.incidents[0])
    firsts: Counter = Counter()
    orders: list[str] = []
    for _ in range(args.repeats):
        llm.clear_cache()
        r = await generate_strategy(inc, RecallOutcome(query="", memories=[]), {}, llm=llm)
        if r.used_fallback:
            continue
        firsts[order_of(r).split(" -> ")[0]] += 1
        orders.append(order_of(r))
    n = len(orders)
    if not n:
        gate.skip("strategy spread", "fallback was used, not a live measurement")
    else:
        dist = ", ".join(f"{k}x{v}" for k, v in firsts.most_common())
        note = f"first step: {dist} | distinct full orders: {len(set(orders))}/{n}"
        if len(set(orders)) == 1:
            gate.ok("full strategy is reproducible", note)
        else:
            # Not a hard failure: temperature=0 and seed=1234 are both sent,
            # and short completions DO reproduce. Long multi-step plans drift
            # because gpt-oss-120b is a mixture-of-experts model whose expert
            # routing is not reproducible across server-side batches. Reported
            # as spread, per the spec.
            gate.note("strategy order varies across repeats", note)

    # ---------------------------------------------------------------- 4
    hdr("4. GUARD: can the live model cite an incident id that was not recalled?")
    res4 = await generate_strategy(inc, RecallOutcome(query="", memories=[]), {}, llm=llm)
    cited = [i for s in res4.strategy.strategy for i in s.historical_evidence]
    if res4.used_fallback:
        gate.skip("no fabricated ids with empty memory", "fallback")
    elif cited:
        gate.bad("live model cited ids with empty memory", f"cited={cited}")
    else:
        gate.ok("live model cites no ids when nothing was recalled")
    if res4.stripped_ids:
        print(f"    {DIM}guard stripped: {res4.stripped_ids}{RESET}")

    # ---------------------------------------------------------------- 5
    hdr("5. MEMORY RESPONSE: does recalled context change the first step?")
    # Uses the recall SHAPE Hindsight returns, built from a locally rendered
    # narrative. This proves the strategy prompt actually reacts to memory
    # without depending on the Hindsight account having credits; the real
    # retain/recall roundtrip is check 6.
    from app.hindsight.formatting import (  # noqa: PLC0415
        ExperienceRecord,
        RecalledMemory,
        build_experience_narrative,
    )

    probe = store.get("INC-4001")
    source = store.get("INC-2001")
    if source is None or probe is None:
        gate.skip("memory changes the first step", "probe incidents missing")
    else:
        narrative = build_experience_narrative(
            ExperienceRecord(incident=source, ordered_path=["check_redis", "check_database"])
        )
        mem_outcome = RecallOutcome(
            query="checkout latency 5xx cache pool",
            memories=[
                RecalledMemory(
                    memory_id="simulated-1",
                    text=narrative,
                    incident_ids=["INC-2001"],
                )
            ],
        )
        base_first, mem_first = Counter(), Counter()
        for _ in range(args.repeats):
            llm.clear_cache()
            rb = await generate_strategy(probe, RecallOutcome(query="", memories=[]), {}, llm=llm)
            llm.clear_cache()
            rm = await generate_strategy(probe, mem_outcome, {}, llm=llm)
            if not rb.used_fallback:
                base_first[rb.first_step] += 1  # type: ignore[union-attr]
            if not rm.used_fallback:
                mem_first[rm.first_step] += 1  # type: ignore[union-attr]
        b_redis = base_first.get("check_redis", 0)
        m_redis = mem_first.get("check_redis", 0)
        n_base = sum(base_first.values())
        n_mem = sum(mem_first.values())
        print(f"  no memory  : {dict(base_first)}")
        print(f"  with memory: {dict(mem_first)}")
        if not n_base or not n_mem:
            gate.skip("memory changes the first step", "fallback was used, not a live result")
        elif m_redis == n_mem and b_redis == 0:
            gate.ok("recalled memory makes redis the first step",
                    f"memory {m_redis}/{n_mem}, baseline {b_redis}/{n_base}")
        else:
            gate.bad("recalled memory does not reliably make redis first",
                     f"memory {m_redis}/{n_mem}, baseline {b_redis}/{n_base}")

    # ---------------------------------------------------------------- 6
    hdr("6. LIVE HINDSIGHT: retain -> wait-until-recallable -> recall")
    if not args.recall:
        gate.skip("hindsight roundtrip", "pass --recall to exercise it")
    else:
        try:
            await mem.ensure_bank()
            from app.hindsight.formatting import ExperienceRecord

            demo_inc = store.get("INC-3001") or inc
            record = ExperienceRecord(
                incident=demo_inc,
                ordered_path=["check_redis", "check_recent_deployments", "check_database"],
                engineer_feedback="For checkout-api latency with 5xx, check Redis earlier.",
                feedback_kind="correct",
                strategy_first_step="check_redis",
                low_value_steps=["check_recent_deployments", "check_database"],
                successful_steps=["check_redis"],
                time_to_resolution_minutes=demo_inc.time_to_resolution,
            )
            out = await mem.retain_and_wait(record)
            print(f"  memory ready after {out.get('waited_seconds')}s")
            recall_res = await mem.recall("checkout-api latency 5xx - which steps were useful?")
            print(f"  recall returned {recall_res.count} result(s)")
            print(f"  incident ids   : {recall_res.incident_ids}")
            for m in recall_res.memories[:3]:
                print(f"    - [{m.memory_id}] {m.text[:140]!r}")
            gate.ok("hindsight retain+recall roundtrip", f"{recall_res.count} results")
        except HindsightBillingError as exc:
            gate.skip("hindsight roundtrip", f"BILLING: {str(exc)[:150]}")
        except (HindsightUnavailable, TimeoutError) as exc:
            gate.skip("hindsight roundtrip", f"hindsight unavailable: {str(exc)[:150]}")
        except Exception as exc:  # pragma: no cover
            gate.bad("hindsight roundtrip", f"{type(exc).__name__}: {str(exc)[:200]}")

    hdr("SUMMARY")
    print(f"  {GREEN}passed {gate.passed}{RESET}   {RED}failed {gate.failed}{RESET}   "
          f"{YELLOW}skipped {gate.skipped}{RESET}   {CYAN}noted {gate.notes}{RESET}")
    if gate.skipped:
        print(f"  {YELLOW}skipped checks are NOT passes - they could not be run.{RESET}")
    if gate.notes:
        print(f"  {CYAN}noted checks are measured observations, not assertions.{RESET}")
    return 1 if gate.failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
