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


def _with_schema_contract(system: str, user: str, response_model: type[BaseModel]) -> tuple[str, str]:
    """Append the exact JSON shape the model must return.

    Needed because models frequently return a bare array when asked for
    "JSON" without being told the required top-level object shape. Deriving
    the contract from the Pydantic model keeps it in sync with validation
    automatically.
    """
    try:
        schema = json.dumps(response_model.model_json_schema(), indent=2)
    except Exception:  # pragma: no cover
        return system, user
    contract = (
        "\n\nOUTPUT CONTRACT\n"
        "Respond with a single JSON OBJECT and nothing else. No prose, no markdown "
        "fences, no commentary.\n"
        "The top level MUST be a JSON object (not a bare array) whose keys match "
        "this JSON Schema exactly:\n"
        f"{schema}\n"
        "Output the JSON object only."
    )
    return system + contract, user


class LLMClient:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        self._settings = settings or get_settings()
        self._client = client
        self._last_call_from_cache: bool | None = None
        self._effort_unsupported = False
        self._json_mode_unsupported = False

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self._settings.llm_api_key:
                raise LLMUnavailable(
                    "LLM_API_KEY is not set. The agent must not invent a strategy, "
                    "so this is fatal for strategy generation."
                )
            from openai import AsyncOpenAI

            # AsyncOpenAI is required: this module awaits completions. The
            # sync `OpenAI` client returns a ChatCompletion that cannot be
            # awaited, which surfaces as a confusing TypeError.
            self._client = AsyncOpenAI(
                api_key=self._settings.llm_api_key,
                base_url=self._settings.llm_base_url,
                timeout=self._settings.llm_timeout_seconds,
            )
        return self._client

    @property
    def last_call_from_cache(self) -> bool | None:
        return self._last_call_from_cache

    @property
    def model(self) -> str | None:
        """Configured model name (used to label runs honestly)."""
        return self._settings.llm_model

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
        system, user = _with_schema_contract(system, user, response_model)
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
            "max_tokens": self._settings.llm_max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if self._settings.llm_seed is not None:
            kwargs["seed"] = self._settings.llm_seed
        if self._settings.llm_reasoning_effort and not self._effort_unsupported:
            kwargs["reasoning_effort"] = self._settings.llm_reasoning_effort
        if self._settings.llm_json_mode and not self._json_mode_unsupported:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            resp = await self.client.chat.completions.create(**kwargs)
        except Exception as exc:
            # Not every provider accepts every optional parameter. Drop the
            # offending one and retry once rather than burning all attempts.
            msg = str(exc)
            dropped = False
            if "reasoning_effort" in msg and "reasoning_effort" in kwargs:
                logger.info("provider rejected reasoning_effort; retrying without it")
                kwargs.pop("reasoning_effort", None)
                self._effort_unsupported = True
                dropped = True
            if not dropped and "response_format" in msg and "response_format" in kwargs:
                logger.info("provider rejected response_format; retrying without it")
                kwargs.pop("response_format", None)
                self._json_mode_unsupported = True
                dropped = True
            if dropped:
                resp = await self.client.chat.completions.create(**kwargs)
            else:
                raise

        message = resp.choices[0].message
        content = message.content
        if not content or not content.strip():
            # Reasoning models can burn the whole output budget on hidden
            # reasoning and return an empty answer. Say so precisely, because
            # "empty response" otherwise looks like a provider outage.
            reasoning = getattr(message, "reasoning", None)
            raise LLMUnavailable(
                "llm returned empty content"
                + (f" (finish_reason={resp.choices[0].finish_reason})")
                + (f"; reasoning consumed {len(reasoning)} chars" if reasoning else "")
                + ". Raise LLM_MAX_TOKENS or lower LLM_REASONING_EFFORT."
            )
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
