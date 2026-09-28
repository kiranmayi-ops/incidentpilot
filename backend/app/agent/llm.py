"""OpenAI-compatible LLM client used for strategy reasoning.

Spec constraints implemented here (§13, §30):

* temperature 0 and a fixed seed where the provider supports it, so a rerun
  reproduces the same strategy;
* every response is validated with Pydantic, never trusted as raw text;
* one retry, then a safe fallback, and the fallback is clearly marked;
* in demo mode, responses are cached on a hash of
  ``(prompt + recalled memory text + model)``. The cache is a
  performance/reliability layer only - a miss always calls the real LLM, and
  it is clearable.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.config import Settings, get_settings

logger = logging.getLogger("incidentpilot.llm")

T = TypeVar("T", bound=BaseModel)

CACHE_DIR = Path(os.environ.get("INCIDENTPILOT_CACHE_DIR", ".llm_cache"))


class LLMUnavailable(RuntimeError):
    """The LLM could not be called, or could not produce valid output."""


def cache_key(model: str, system: str, user: str) -> str:
    h = hashlib.sha256()
    for part in (model, system, user):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


class LLMClient:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        self._settings = settings or get_settings()
        self._client = client
        self._last_call_from_cache: bool | None = None

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self._settings.llm_api_key:
                raise LLMUnavailable(
                    "LLM_API_KEY is not set. The agent must not invent a strategy, "
                    "so this is fatal for strategy generation."
                )
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self._settings.llm_api_key,
                base_url=self._settings.llm_base_url,
                timeout=self._settings.llm_timeout_seconds,
            )
        return self._client

    @property
    def last_call_from_cache(self) -> bool | None:
        return self._last_call_from_cache

    # -- cache ------------------------------------------------------------

    def _cache_path(self, key: str) -> Path:
        return CACHE_DIR / f"{key}.json"

    def _cache_get(self, key: str) -> dict | None:
        if not self._settings.demo_mode:
            return None
        p = self._cache_path(key)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _cache_put(self, key: str, payload: dict) -> None:
        if not self._settings.demo_mode:
            return
        try:
            p = self._cache_path(key)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception as exc:  # pragma: no cover - cache must never break a run
            logger.warning("llm cache write failed: %s", exc)

    def clear_cache(self) -> int:
        """Clear the demo cache. Explicitly supported so it is never a hidden input."""
        if not CACHE_DIR.exists():
            return 0
        n = sum(1 for _ in CACHE_DIR.glob("*.json"))
        for f in CACHE_DIR.glob("*.json"):
            f.unlink()
        return n

    # -- call -------------------------------------------------------------

    async def complete_json(
        self,
        system: str,
        user: str,
        response_model: type[T],
    ) -> tuple[T, bool]:
        """Return ``(validated, from_cache)``.

        Retries once on transport failure or schema-invalid output, then
        raises :class:`LLMUnavailable` so the caller can run its fallback.
        """
        model = self._settings.llm_model
        key = cache_key(model, system, user)
        cached = self._cache_get(key)
        if cached is not None:
            self._last_call_from_cache = True
            try:
                return response_model.model_validate(cached), True
            except ValidationError:
                pass  # stale cache entry: fall through to a real call

        last_error: Exception | None = None
        for attempt in range(self._settings.llm_max_retries):
            try:
                raw = await self._call(model, system, user)
            except Exception as exc:
                last_error = exc
                logger.warning("llm call failed (attempt %s): %s", attempt + 1, exc)
                continue

            try:
                parsed = response_model.model_validate_json(raw)
            except ValidationError as exc:
                last_error = exc
                logger.warning("llm output failed validation (attempt %s): %s", attempt + 1, exc)
                continue

            self._cache_put(key, parsed.model_dump())
            self._last_call_from_cache = False
            return parsed, False

        raise LLMUnavailable(f"llm failed after retries: {last_error}")

    async def _call(self, model: str, system: str, user: str) -> str:
        kwargs: dict[str, Any] = {
            "model": model,
            "temperature": self._settings.llm_temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if self._settings.llm_seed is not None:
            kwargs["seed"] = self._settings.llm_seed
        resp = await self.client.chat.completions.create(**kwargs)
        content = resp.choices[0].message.content
        if not content:
            raise LLMUnavailable("llm returned empty content")
        return content.strip()


_llm: LLMClient | None = None


def get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        _llm = LLMClient(get_settings())
    return _llm


def reset_llm() -> None:
    global _llm
    _llm = None
