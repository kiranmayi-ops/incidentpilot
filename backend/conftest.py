"""Session-wide test configuration.

Forces the app's async engine onto a throwaway SQLite file for the whole test
session. Tests exercise the EXACT SAME SQLAlchemy code the real app runs
against Postgres — no mocked ORM, no fake database — just a local SQL engine.
Set before any test module imports app.config so the cached Settings build the
engine from DATABASE_URL.
"""

import os
import tempfile

_TEST_DB = os.path.join(tempfile.gettempdir(), "incidentpilot_test_state.db")
for _p in (_TEST_DB, f"{_TEST_DB}-wal", f"{_TEST_DB}-shm"):
    try:
        os.remove(_p)
    except FileNotFoundError:  # pragma: no cover - first run
        pass

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DB_AUTO_CREATE_TABLES"] = "true"