"""FastAPI application entrypoint.

Lifespan:
  1. create tables when ``DB_AUTO_CREATE_TABLES`` is on (demo/dev);
  2. mirror the synthetic incident catalog into PostgreSQL when ``DB_AUTO_SEED``
     is on and the catalog is empty (spec §19 demo mode; the JSON dataset stays
     the source of truth for telemetry);
  3. close the Hindsight client on shutdown.

The agent's long-term learning is NOT stored here — it lives in Hindsight.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db as app_db
from app.api import api_router
from app.config import get_settings
from app.hindsight.client import HindsightMemory
from app.services.incidents import IncidentStore
from app.services.state_repository import StateRepository

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    # One Hindsight client per process, created lazily on first use and closed
    # at shutdown. Never construct it inside a request handler. Tests may
    # pre-inject a fake into app.state.memory before lifespan starts.
    if getattr(app.state, "memory", None) is None:
        app.state.memory = HindsightMemory(settings)
    memory = app.state.memory
    try:
        await app_db.init_models(settings)
        if settings.db_auto_seed:
            async with app_db.get_sessionmaker(settings)() as session:
                repo = StateRepository(session)
                if await repo.incident_count() == 0:
                    created = await repo.seed_catalog(IncidentStore(settings))
                    await session.commit()
                    logger.info("seeded %d incidents into PostgreSQL", created)
                else:
                    logger.info("incident catalog already present in PostgreSQL")
    except Exception as exc:  # pragma: no cover - startup must not hard-fail
        logger.warning("database init failed: %s (see GET /health)", exc)
    yield
    memory.close()
    await app_db.dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="IncidentPilot API",
        description="An SRE agent that learns investigation strategy from Hindsight memory.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    return app


app = create_app()