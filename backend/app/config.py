"""Application configuration.

All secrets are read from environment variables only (loaded from `.env`).
Nothing here hard-codes credentials. `.env` is gitignored.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# repository root = .../incidentpilot  (this file is backend/app/config.py)
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
INCIDENTS_DIR = DATA_DIR / "incidents"
SEEDS_DIR = DATA_DIR / "seeds"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- application -------------------------------------------------------
    demo_mode: bool = True
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000"

    # --- postgres (application state only, never agent memory) -------------
    postgres_user: str = "incidentpilot"
    postgres_password: str = ""
    postgres_db: str = "incidentpilot"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    database_url: str | None = None
    # Create tables on startup (dev/demo convenience; uses SQLAlchemy
    # metadata.create_all). Production can leave this off and rely on alembic.
    db_auto_create_tables: bool = True
    # Mirror the synthetic incident catalog into PostgreSQL on startup when the
    # incidents table is empty. The JSON dataset remains the source of truth for
    # telemetry; PG is app state only and never decides a strategy.
    db_auto_seed: bool = True

    # --- hindsight (the agent's long-term memory) --------------------------
    hindsight_api_url: str = "https://api.hindsight.vectorize.io"
    hindsight_api_key: str = ""
    hindsight_bank_id: str = "engineering-prod"
    hindsight_retain_timeout_seconds: float = 180.0
    hindsight_retain_poll_seconds: float = 3.0
    hindsight_recall_budget: str = "mid"
    hindsight_recall_max_tokens: int = 4096

    # --- llm ---------------------------------------------------------------
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout_seconds: float = 60.0
    llm_temperature: float = 0.0
    llm_seed: int | None = 1234
    llm_max_retries: int = 2
    # Explicit output budget. Reasoning models (gpt-oss, o-series) spend
    # completion tokens on hidden reasoning, so a small or implicit budget can
    # return an empty `content` even on success.
    llm_max_tokens: int = 2048
    # Passed through to providers that support it (Groq gpt-oss). Left empty
    # to disable. Strategy calls do not need deep reasoning.
    llm_reasoning_effort: str = "low"
    # Ask OpenAI-compatible providers for a JSON object response. Providers
    # that reject it are detected at runtime and the parameter is dropped.
    llm_json_mode: bool = True

    # paths
    data_dir: Path = Field(default=DATA_DIR)
    incidents_dir: Path = Field(default=INCIDENTS_DIR)
    seeds_dir: Path = Field(default=SEEDS_DIR)

    @field_validator("data_dir", "incidents_dir", "seeds_dir", mode="before")
    @classmethod
    def _coerce_path(cls, v: object) -> object:
        return Path(v) if v is not None else v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def hindsight_configured(self) -> bool:
        """True when Hindsight is reachable in principle (URL is set)."""
        return bool(self.hindsight_api_url)

    @property
    def llm_configured(self) -> bool:
        """True when an LLM credential is present."""
        return bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
