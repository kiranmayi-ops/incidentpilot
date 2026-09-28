"""Incident loading / retrieval over the synthetic dataset."""

from __future__ import annotations

import json
from functools import lru_cache

from app.config import Settings, get_settings
from app.schemas.incident import Incident


class IncidentStore:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._cache: dict[str, Incident] | None = None

    def _load(self) -> dict[str, Incident]:
        if self._cache is None:
            out: dict[str, Incident] = {}
            for path in sorted(self._settings.incidents_dir.glob("*.json")):
                raw = json.loads(path.read_text(encoding="utf-8"))
                inc = Incident.model_validate(raw)
                out[inc.incident_id] = inc
            self._cache = out
        return self._cache

    def reload(self) -> None:
        self._cache = None

    def get(self, incident_id: str) -> Incident | None:
        return self._load().get(incident_id)

    def list(self, tier: str | None = None, service: str | None = None) -> list[Incident]:
        items = list(self._load().values())
        if tier:
            items = [i for i in items if i.tier == tier]
        if service:
            items = [i for i in items if i.service == service]
        return sorted(items, key=lambda i: i.incident_id)

    def by_tier(self, tier: str) -> list[Incident]:
        return self.list(tier=tier)

    def services(self) -> list[str]:
        return sorted({i.service for i in self._load().values()})

    def count(self) -> int:
        return len(self._load())


@lru_cache
def get_store() -> IncidentStore:
    return IncidentStore()
