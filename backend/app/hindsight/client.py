"""Hindsight client wrapper.

Thin, typed adapter over ``hindsight-client``. Two behaviours here are
mandatory and come from the real SDK, not from assumption:

1. **Retention is asynchronous.** ``retain()`` kicks off an LLM extraction +
   embedding pipeline and returns immediately (``RetainResponse`` with
   ``operation_id``). Calling ``recall()`` straight afterwards can return
   nothing. :meth:`retain_and_wait` therefore polls recall until the retained
   experience is actually recallable, bounded by a timeout.

2. **Recall returns facts, not our JSON.** Everything downstream goes through
   :mod:`app.hindsight.formatting`, which parses ids and counts out of the
   returned text.

If Hindsight is unreachable the app must not pretend it works: :func:`health`
reports the real status and ``/health`` fails (spec §8.5).
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any


def _ensure_trust_store() -> str | None:
    """Point the TLS stack at certifi's CA bundle when the system store is thin.

    ``hindsight-client`` is aiohttp-based. Where the active interpreter has no
    usable system CA bundle, aiohttp raises ``CERTIFICATE_VERIFY_FAILED`` and
    a perfectly healthy Hindsight API looks unreachable. Setting
    ``SSL_CERT_FILE`` makes aiohttp's default context verifiable.

    This MUST run before ``hindsight_client`` is imported, because aiohttp
    builds its default SSL context at import time. That ordering is why the
    call sits above the third-party import below.
    """
    if os.environ.get("SSL_CERT_FILE"):
        return None
    try:
        import certifi
    except ImportError:
        return None
    path = certifi.where()
    if path and os.path.exists(path):
        os.environ["SSL_CERT_FILE"] = path
        return path
    return None


_TRUST_STORE = _ensure_trust_store()

from hindsight_client import Hindsight  # noqa: E402  (import order is load-bearing)

from app.config import Settings, get_settings  # noqa: E402
from app.hindsight.formatting import (
    ExperienceRecord,
    RecallOutcome,
    build_experience_narrative,
    inc_id,
    outcome_from_results,
    retain_metadata,
    retain_tags,
)

logger = logging.getLogger("incidentpilot.hindsight")

BANK_MISSION = """You are the long-term operational memory for a production engineering team.

Remember incident investigation experiences, diagnostic actions, evidence,
failed hypotheses, successful hypotheses, engineer corrections, root causes,
resolutions and lessons.

Use historical experience to help construct better investigation strategies
for future incidents.

Do not blindly trust historical knowledge. Historical information must be
validated against current evidence.

Prefer experiences that are relevant to the current service, relevant to the
current symptoms, recent when appropriate, repeatedly confirmed, and
supported by successful outcomes.

Remember both useful and low-value investigation paths.
"""


class HindsightUnavailable(RuntimeError):
    """Hindsight could not be reached or is not configured."""


class MemoryNotReady(TimeoutError):
    """Retention did not become recallable within the timeout."""


class HindsightMemory:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        self._settings = settings or get_settings()
        self._client = client
        self._bank_ready: set[str] = set()

    # -- plumbing ---------------------------------------------------------

    @property
    def bank_id(self) -> str:
        return self._settings.hindsight_bank_id

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self._settings.hindsight_api_url:
                raise HindsightUnavailable("HINDSIGHT_API_URL is not set")
            self._client = Hindsight(
                base_url=self._settings.hindsight_api_url,
                api_key=self._settings.hindsight_api_key or None,
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # pragma: no cover - best effort
                pass
            self._client = None

    # -- bank -------------------------------------------------------------

    async def ensure_bank(self) -> dict[str, Any]:
        if self.bank_id in self._bank_ready:
            return {"bank_id": self.bank_id, "status": "already_present"}
        try:
            res = await self.client.acreate_bank(
                bank_id=self.bank_id,
                name="IncidentPilot Engineering Memory",
                mission=BANK_MISSION,
                background=(
                    "Production SRE incident investigations. Experiences are "
                    "retained after each incident is resolved."
                ),
            )
            self._bank_ready.add(self.bank_id)
            logger.info("hindsight bank ready bank_id=%s", self.bank_id)
            return {"bank_id": self.bank_id, "status": "created", "detail": _dump(res)}
        except Exception as exc:
            # A pre-existing bank is a normal, non-fatal outcome.
            if _looks_like_exists(exc):
                self._bank_ready.add(self.bank_id)
                logger.info("hindsight bank already exists bank_id=%s", self.bank_id)
                return {"bank_id": self.bank_id, "status": "already_present"}
            raise HindsightUnavailable(f"could not create Hindsight bank: {exc}") from exc

    # -- retain -----------------------------------------------------------

    async def retain(self, rec: ExperienceRecord) -> dict[str, Any]:
        content = build_experience_narrative(rec)
        try:
            res = await self.client.aretain(
                bank_id=self.bank_id,
                content=content,
                context=(
                    f"Incident {inc_id(rec)} investigation experience for "
                    f"{rec.incident.service}: {rec.root_cause_value}."
                ),
                document_id=inc_id(rec),
                metadata=retain_metadata(rec),
                tags=retain_tags(rec),
            )
        except Exception as exc:
            raise HindsightUnavailable(f"hindsight retain failed: {exc}") from exc
        out = _dump(res)
        logger.info(
            "hindsight retain incident=%s success=%s async=%s operation_id=%s",
            inc_id(rec),
            out.get("success"),
            out.get("async"),
            out.get("operation_id"),
        )
        return out

    async def retain_and_wait(self, rec: ExperienceRecord) -> dict[str, Any]:
        """Retain, then block until the experience is actually recallable.

        This is what makes the demo honest: we never recall before the
        memory exists, and we never claim 'memory ready' speculatively.
        """
        out = await self.retain(rec)
        target = inc_id(rec)
        deadline_s = self._settings.hindsight_retain_timeout_seconds
        poll_s = max(0.5, self._settings.hindsight_retain_poll_seconds)
        waited = 0.0

        while waited < deadline_s:
            probe = await self.recall(
                f"Which service had root cause {rec.root_cause_value}? Mention {target}."
            )
            if target in probe.incident_ids:
                logger.info(
                    "hindsight memory ready incident=%s waited=%.1fs", target, waited
                )
                return {
                    **out,
                    "memory_ready": True,
                    "waited_seconds": round(waited, 2),
                    "probe_count": probe.count,
                }
            await asyncio.sleep(poll_s)
            waited += poll_s

        raise MemoryNotReady(
            f"incident {target} was not recallable after {deadline_s:.0f}s. "
            "The demo must not proceed as if the memory were stored."
        )

    # -- recall -----------------------------------------------------------

    async def recall(
        self,
        query: str,
        max_tokens: int | None = None,
        budget: str | None = None,
    ) -> RecallOutcome:
        budget = budget or self._settings.hindsight_recall_budget
        max_tokens = max_tokens or self._settings.hindsight_recall_max_tokens
        try:
            res = await self.client.arecall(
                bank_id=self.bank_id,
                query=query,
                budget=budget,
                max_tokens=max_tokens,
            )
        except Exception as exc:
            raise HindsightUnavailable(f"hindsight recall failed: {exc}") from exc

        outcome = outcome_from_results(query, list(res.results), budget=budget)
        logger.info(
            "hindsight recall query=%r results=%d incident_ids=%s",
            query,
            outcome.count,
            outcome.incident_ids,
        )
        return outcome

    # -- diagnostics ------------------------------------------------------

    async def health(self) -> dict[str, Any]:
        """Real reachability check. Never returns a fake 'ok'."""
        out: dict[str, Any] = {
            "configured": self._settings.hindsight_configured,
            "base_url": self._settings.hindsight_api_url,
            "bank_id": self.bank_id,
            "tls_trust_store": "certifi" if _TRUST_STORE else "system",
        }
        if not self._settings.hindsight_configured:
            out["status"] = "unconfigured"
            out["reachable"] = False
            return out
        try:
            version = await self.client.aget_version()
            out["status"] = "ok"
            out["reachable"] = True
            out["version"] = _dump(version)
        except Exception as exc:
            out["status"] = "unreachable"
            out["reachable"] = False
            out["error"] = f"{type(exc).__name__}: {exc}"
        return out

    async def list_memory_count(self) -> int | None:
        try:
            res = await self.client.alist_memories(bank_id=self.bank_id, limit=1)
            return int(getattr(res, "total", 0))
        except Exception as exc:  # pragma: no cover - diagnostics only
            logger.warning("hindsight list_memories failed: %s", exc)
            return None


def _dump(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return dict(obj)
    for attr in ("model_dump", "dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return dict(fn())
            except Exception:  # pragma: no cover
                pass
    return {"value": str(obj)}


def _looks_like_exists(exc: Exception) -> bool:
    text = str(exc).lower()
    return "exist" in text or "409" in text or "conflict" in text


_memory: HindsightMemory | None = None


def get_memory() -> HindsightMemory:
    global _memory
    if _memory is None:
        _memory = HindsightMemory(get_settings())
    return _memory


def reset_memory() -> None:
    """Drop the cached client (used by tests and /demo/reset)."""
    global _memory
    if _memory is not None:
        _memory.close()
    _memory = None
