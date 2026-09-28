# Hindsight Memory in IncidentPilot

How the agent's long-term memory works, end to end.

## 1. What Hindsight stores

Hindsight is a vectorized memory service. IncidentPilot retains an **experience narrative** per incident (built by `backend/app/hindsight/formatting.py` → `build_experience_narrative`):

- the incident id, service, timestamp, severity
- the symptoms that triggered the investigation
- the **steps actually taken** (tool, outcome, how useful each turned out to be)
- the final root cause and resolution
- any **engineer correction** text

Retention also sets `metadata` (service, root cause, resolution, step labels) and `tags` (service, root cause, tier) so the memory is addressable and filterable. `document_id = <incident id>` makes every retained episode idempotently addressable and lets us cross-check recall against PostgreSQL.

## 2. Why PostgreSQL is not the agent's long-term memory

PostgreSQL in this project is **application state only** — the incident catalog mirror, the *runs* that an investigation produced, the *tool steps*, the *feedback action*, and demo/eval flags. Two design reasons keep it out of the memory path:

- **The answer must not leak.** The strategy engine reads only raw telemetry from the deterministic tools. `root_cause`, `successful_steps`, and `lesson` exist in the JSON dataset but are never read by a tool or by the strategy fallback (guarded by tests). Storing strategies-in-runs is fine; storing "the answer recipe" and ranking from it would be hard-coding.
- **Memory is semantic, not tabular.** Incidents match by *meaning* (symptoms, evidence patterns) across services, and memories must be retrieved by query string. That is exactly what a vector bank provides. Summing an SQL table of past first-steps is a weaker, more brittle prior.

## 3. What is retained after an incident

After an investigation completes and the engineer gives feedback, `POST /incidents/{id}/feedback`:

1. persists the run + feedback + (if accepted/corrected) the outcome in PostgreSQL
2. builds an `ExperienceRecord` from the run, the ground-truth steps for that incident, and the engineer's decision/correction
3. calls `HindsightMemory.retain_and_wait(...)`

Retention is **async**: Hindsight returns an operation id, and the client polls recall until the incident id is actually recallable (`retain_and_wait`). The UI shows **"memory ready"** only after this probe succeeds — never speculatively. The poll is bounded by `HINDSIGHT_RETAIN_TIMEOUT_SECONDS` (default 180s) and raises `MemoryNotReady` otherwise, so a demo can never silently proceed as if memory existed.

```
[feedback: accept|custom]        [retain returns operation_id]        [probe recall]
────────────────────────►  ───────────────────────────────►  ─────────────────────────►
ENGINEER  →  PG run row    →  Hindsight aretain(narrative)  →  recall("...mention INC-3001")
                 │                    (async ingest)                    │
                 │                                                    ready?  ──►  "memory ready"
                 └─────────────────────────────────────────────────────────────┘
```

Repetition is safe: the endpoint is idempotent per `document_id`, and re-seeding is a no-op.

## 4. How relevant memories are recalled

The agent recalls at the start of every investigation (`HindsightMemory.recall`, `budget="mid"` default). The query is an *evidence-framed* question (service + prominent metric signals + recent-deployment hint), not a leaked answer — e.g.:

> "An incident like this before: which layer was implicated first — database, redis, or a recent deployment?"

Recall returns ranked snippets plus their incident ids (`RecallOutcome.incident_ids`). Every id is then **validated against the actual catalog** (`records.get(cid)`); if an id is not a known incident it is dropped, and any strategy step that cites an unknown id is rejected (`validate_evidence_ids` + `constrain_to_allowlist`). Raw outcome (query, count, incident ids) is returned by `GET /incidents/{id}/memory` and shown in the UI memory panel.

## 5. How recalled memories affect strategy generation

`generate_strategy` (backend/app/agent/strategy.py) composes three inputs:

```
CURRENT INCIDENT EVIDENCE   +   RECALLED HINDSIGHT EXPERIENCES   +   LLM RANKING
(render_current_evidence)       (render_recalled_memory)              (temperature 0,
                                 structural JSON, ecosystem IDs validated)
────────────────────────────────────────────► ORDERED STRATEGY (check_* steps)
```

The LLM sees both the current evidence and the recalled episodes by id, and produces a JSON plan that is Pydantic-validated. Because recall is one input among several, memory shifts the ordering *without* owning it.

If the LLM is unavailable (or fails twice), a **memory-driven fallback** ranks the same five tools purely from:

- historical prior — how often each tool was `successful` vs `failed` across the *actual* recalled incident ids (diminishing returns: `0.7·log2(1+n)`, capped)
- current-evidence bonuses — e.g. `db_connection_utilization ≥ 0.90 → +1.3 check_database`

The fallback is **not** a per-service table; swap the seeded history and the ordering changes (there is a regression test for exactly that).

## 6. How engineer feedback becomes memory

- **accept**: retained with the engineer's confirmation of the outcome.
- **reject**: retained with the successful-steps emptied (nothing useful remembered) so the prior cannot be boosted.
- **custom correction**: retained with an explicit `engineer_correction` text; the corrected steps become the episode's successful steps. This is the Tier-2 replay mechanism: `POST /demo/replay` re-runs three checkout-api incidents with scripted corrections like *"For checkout-api latency with 5xx, check Redis earlier."* and retains each for real. Hindsight then has experiences whose content literally encodes the correction.

## 7. How new incidents update the memory

Every accepted/corrected incident is itself retained (`document_id = incident id`). The next recall for that service therefore includes the newest episode alongside older ones; retention is append-only, and the bank accumulates the agent's (and engineers') own history. The Learning Evolution page reads PostgreSQL runs grouped by episode *and* live recall to show paths labelled by source: `seed_tier1`, `replay`/"scripted feedback", `demo`, `eval`.

## 8. How stale historical knowledge is handled

Historical priors are **saturating and capped** (`min(1.2, 0.7·log2(1+n))`, waste penalized `min(0.9, 0.35·log2(1+n))`), so a pattern is a strong-but-bounded prior, never a verdict — enough duplicated history can accumulate but not dominate future plans.

The active guard is the **contradiction gate**: if the *current* incident's evidence strongly implicates layer X (`≥ 0.7` live bonus) but a historical prior points at layer Y, the prior for Y is zeroed with the logged reason *"current evidence implicates a different layer, so this historical prior was set aside."* This is what makes the counter-case work: checkout-api with a healthy Redis and a saturated database does **not** start with `check_redis` even after the Redis lesson was retained — the current evidence outranks the memory.

```
                        recalled: "checkout → check_redis"        current: db_util 0.96
        ┌──────────────────────────────────────┐        ┌───────────────────────────┐
        │ hist[check_redis] = +1.2 (from replays)│        │ live[check_database]=+1.3  │
        └──────────────────────────────────────┘        └───────────────────────────┘
                          │                                          │
                          ▼                                          ▼
                        contradiction gate detects mismatch → zeroes stale prior
                          └────────────────►  strategy ranks check_database first
```