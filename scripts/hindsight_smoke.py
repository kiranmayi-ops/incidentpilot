#!/usr/bin/env python
"""Phase 0 - Hindsight smoke test.

Creates the bank, retains one real investigation experience, waits until it is
actually recallable, then recalls it and prints the RAW results so a judge can
inspect exactly what Hindsight returned.

Usage:
    python scripts/hindsight_smoke.py
    python scripts/hindsight_smoke.py --bank-id scratch-probe

Requires HINDSIGHT_API_URL and HINDSIGHT_API_KEY in the environment (or a
.env file at the repository root).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

from app.config import Settings  # noqa: E402
from app.hindsight.client import HindsightMemory  # noqa: E402
from app.hindsight.formatting import ExperienceRecord  # noqa: E402
from app.schemas.incident import Incident  # noqa: E402

SMOKE_INCIDENT = REPO_ROOT / "data" / "incidents" / "INC-2001.json"


def hr(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank-id", default="incidentpilot-smoke")
    ap.add_argument("--timeout", type=float, default=240.0)
    ap.add_argument("--keep", action="store_true", help="do not delete the bank at the end")
    args = ap.parse_args()

    settings = Settings()
    settings.hindsight_bank_id = args.bank_id
    settings.hindsight_retain_timeout_seconds = args.timeout

    if not settings.hindsight_api_url:
        print("HINDSIGHT_API_URL is not set. Copy .env.example to .env first.")
        return 2

    hr("1. CONFIG")
    print(f"base_url   : {settings.hindsight_api_url}")
    print(f"api_key    : {'set (len=%d)' % len(settings.hindsight_api_key) if settings.hindsight_api_key else 'not set (self-hosted?)'}")
    print(f"bank_id    : {args.bank_id}")

    mem = HindsightMemory(settings)

    hr("2. HEALTH (real reachability check)")
    health = await mem.health()
    print(json.dumps({k: v for k, v in health.items() if k != "version"}, indent=2))
    if not health.get("reachable"):
        print("\nHindsight is NOT reachable. Stopping - we will not fake it.")
        return 1

    hr("3. CREATE BANK")
    print(json.dumps(await mem.ensure_bank(), indent=2, default=str)[:600])

    incident = Incident.model_validate(json.loads(SMOKE_INCIDENT.read_text()))
    record = ExperienceRecord(
        incident=incident,
        ordered_path=["check_database", "check_recent_deployments", "check_redis"],
        engineer_feedback="For checkout-api latency with 5xx, check Redis earlier.",
        feedback_kind="correct",
        strategy_first_step="check_database",
        low_value_steps=["check_database", "check_recent_deployments"],
        successful_steps=["check_redis"],
        time_to_resolution_minutes=incident.time_to_resolution,
    )

    hr("4. RETAIN (real call; note it is asynchronous)")
    t0 = time.time()
    out = await mem.retain(record)
    print(json.dumps(out, indent=2, default=str)[:800])
    print(f"\nretain returned in {time.time() - t0:.2f}s")

    hr("5. WAIT UNTIL RECALLABLE (retention is async - this is required)")
    t0 = time.time()
    try:
        ready = await mem.retain_and_wait(record)
        print(json.dumps(ready, indent=2, default=str)[:800])
    except TimeoutError as exc:
        print(f"NOT READY: {exc}")
        print("\nRetention never became recallable. A demo must not proceed past this.")
        return 1
    print(f"memory ready after {time.time() - t0:.1f}s")

    hr("6. RECALL (raw results, for judge inspection)")
    outcome = await mem.recall(
        "checkout-api latency with 5xx - which investigation steps were useful?"
    )
    print(f"query        : {outcome.query}")
    print(f"results      : {outcome.count}")
    print(f"incident_ids : {outcome.incident_ids}")
    print(f"memory ids   : {[m.memory_id for m in outcome.memories]}")
    for m in outcome.memories:
        print("\n--- memory ------------------------------------------------")
        print(f"id       : {m.memory_id}")
        print(f"type     : {m.type}")
        print(f"doc_id   : {m.document_id}")
        print(f"tags     : {m.tags}")
        print(f"metadata : {m.metadata}")
        print(f"ids found: {m.incident_ids}")
        print(f"text     : {m.text[:700]}")

    hr("7. LIST MEMORY COUNT (reported by the API, for cross-checking)")
    print(await mem.list_memory_count())

    if not args.keep:
        hr("8. CLEANUP")
        try:
            await mem.client.adelete_bank(bank_id=args.bank_id)
            print(f"deleted bank {args.bank_id}")
        except Exception as exc:
            print(f"could not delete bank: {exc}")

    hr("SMOKE TEST OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
