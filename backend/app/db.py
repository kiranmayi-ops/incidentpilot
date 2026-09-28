"""Async SQLAlchemy engine and session management.

**Separation rule (spec §6):** PostgreSQL holds *application state* (the
incident catalog, investigation runs, steps, feedback, demo/eval state).
Hindsight is the agent's long-term memory. This module never touches Hindsight.

The engine is built from ``settings.sqlalchemy_url``:
- production/dev default: ``postgresql+asyncpg://...``
- tests override with ``DATABASE_URL`` pointing at sqlite+aiosqlite (the same
  real SQLAlchemy code path, same SQL, no mocked ORM).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings

_sqla_engine: AsyncEngine | None = None
_sqla_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _build(setting: Settings) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        setting.sqlalchemy_url,
        echo=False,
        pool_pre_ping=True,
    )
    # pool_pre_ping is the only flag above that matters on Postgres; SQLite
    # ignores the extra args. Keep construction shared for both backends.
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory


def get_engine(settings: Settings | None = None) -> AsyncEngine:
    global _sqla_engine, _sqla_sessionmaker
    if _sqla_engine is None:
        _sqla_engine, _sqla_sessionmaker = _build(settings or get_settings())
    return _sqla_engine


def get_sessionmaker(settings: Settings | None = None) -> async_sessionmaker[AsyncSession]:
    get_engine(settings)
    assert _sqla_sessionmaker is not None
    return _sqla_sessionmaker


async def dispose_engine() -> None:
    global _sqla_engine, _sqla_sessionmaker
    if _sqla_engine is not None:
        await _sqla_engine.dispose()
    _sqla_engine = None
    _sqla_sessionmaker = None


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, closed afterwards.

    Commits on success so agent writes (runs, steps, feedback) survive past
    the request, and rolls back on error so a failed endpoint never persists
    a partial investigation.
    """
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise


async def init_models(settings: Settings | None = None) -> None:
    """Create tables if they do not exist (demo/dev convenience).

    Uses real DDL against whatever backend ``DATABASE_URL`` points at. When
    ``settings.db_auto_create_tables`` is False this is a no-op (production
    uses alembic migrations instead).
    """
    from app.models.state import Base  # noqa: PLC0415  (import after metadata)

    setting = settings or get_settings()
    if not setting.db_auto_create_tables:
        return
    async with get_engine(setting).begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def ping() -> bool:
    """Cheap real round-trip to confirm the database is reachable."""
    from sqlalchemy import text  # noqa: PLC0415

    async with get_engine().connect() as conn:
        await conn.execute(text("SELECT 1"))
    return True