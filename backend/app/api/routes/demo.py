"""Demo lifecycle + learning-evolution endpoints (spec §18, §19, §16).

POST /demo/reset    — fresh Hindsight bank per demo run (spec §19), resets PG
POST /demo/seed     — retain Tier-1 operational knowledge into the demo bank
GET  /learning/strategy   — current learned strategy, computed from real rows
GET  /learning/evolution  — investigation paths from real rows
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import db as app_db
from app.config import get_settings
from app.schemas.api import (
    DemoResetResponse,
    DemoSeedResponse,
    LearningEvolutionItem,
    LearningEvolutionResponse,
    LearningStrategyResponse,
)
from app.services.investigation import reset_demo_bank, seed_tier1_bank
from app.services.learning import derive_learning, evolution_items
from app.services.state_repository import StateRepository

router = APIRouter()


async def _repo(session: AsyncSession = Depends(app_db.get_session)) -> StateRepository:
    return StateRepository(session)


@router.post("/demo/reset", response_model=DemoResetResponse)
async def demo_reset(request: Request, repo: StateRepository = Depends(_repo)) -> DemoResetResponse:
    """Fresh memory bank so the learning story restarts (no real data lost)."""
    settings = get_settings()
    try:
        fresh_memory, report = await reset_demo_bank(
            request.app.state.memory, settings=settings
        )
    except Exception as exc:  # honest failure surface for a demo-critical endpoint
        raise HTTPException(status_code=503, detail=f"could not create fresh bank: {exc}") from exc

    # Point the running process at the fresh bank from here on. The old client
    # (if it differs) is closed so no aiohttp session is leaked.
    old = request.app.state.memory
    if old is not fresh_memory:
        old.close()
    request.app.state.memory = fresh_memory

    await repo.set_demo_state(bank_id=report["bank_id"], phase="baseline")
    return DemoResetResponse(bank_id=report["bank_id"], phase="baseline", status=report["status"])


@router.post("/demo/seed", response_model=DemoSeedResponse)
async def demo_seed(request: Request) -> DemoSeedResponse:
    """Retain Tier-1 knowledge (real Hindsight retain calls)."""
    settings = get_settings()
    out = await seed_tier1_bank(request.app.state.memory, settings=settings)
    return DemoSeedResponse(tier=out["tier"], seeded=out["seeded"], failures=out["failures"])


@router.get("/learning/strategy", response_model=LearningStrategyResponse)
async def learning_strategy(repo: StateRepository = Depends(_repo)) -> LearningStrategyResponse:
    pairs = await repo.completed_runs_with_steps()
    learned = derive_learning(pairs)
    strategy = learned["strategy"]
    why = learned["why"]
    return LearningStrategyResponse(
        strategy=[_step_model(s) for s in strategy],
        why=why,
        computed_from=learned["computed_from"],
    )


def _step_model(s: dict) -> dict:
    return {
        "step": s["step"],
        "priority": s["priority"],
        "reason": s["reason"],
        "first_choice_count": s["first_choice_count"],
        "engineer_confirmations": s["engineer_confirmations"],
        "low_yield_count": s["low_yield_count"],
    }


@router.get("/learning/evolution", response_model=LearningEvolutionResponse)
async def learning_evolution(repo: StateRepository = Depends(_repo)) -> LearningEvolutionResponse:
    pairs = await repo.completed_runs_with_steps()
    items = evolution_items(pairs)
    return LearningEvolutionResponse(
        items=[LearningEvolutionItem(**it) for it in items]
    )