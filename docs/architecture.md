# IncidentPilot Architecture

## Data flow

```
Frontend (Next.js)
   │        fetch → /incidents, /incidents/{id}/investigate|memory|feedback|resolve
   │                    /demo/reset|seed|replay, /learning/strategy|evolution
   ▼
FastAPI
   ├── health        → reachability (DB + Hindsight) — real probes only
   ├── incidents     → incident catalog + runs + timeline (PostgreSQL read)
   ├── investigation → recall → strategy → execute → feedback → resolve
   └── demo+learning → reset / seed / replay / strategy / evolution
   │
   ▼
Incident Service (backend/app/services/investigation.py)
   │   InvestigationAgent owns one incident:
   │     recall() → generate_strategy() → execute_tool()* → propose root cause
   ▼
Strategy Engine (backend/app/agent/strategy.py)
   ├── Hindsight Recall   (backend/app/hindsight/client.py, formatting.py)
   ├── Current Evidence   (incident.metrics + telemetry statuses)
   └── LLM Reasoning      (backend/app/agent/llm.py, Pydantic-validated JSON)
   │                       └─ unavailable → memory-ranked fallback (contradiction gate)
   ▼
Investigation Tools (backend/app/tools/telemetry.py)
   │   check_metrics · query_logs · check_database · check_redis · check_recent_deployments
   │   deterministic, scoped by incident id, allowlisted — never leak the answer
   ▼
Human Feedback (POST /incidents/{id}/feedback)
   │   accept / reject / custom correction → PostgreSQL run+feedback row
   ▼
Hindsight Retain (retain_and_wait → poll until recallable)
   │   ← memory-ready is only reported after a successful recall probe
   ▼
Hindsight bank  (vector long-term memory; PostgreSQL is app state only)
```

## Component explanations

### Frontend (`frontend/`)

Next.js 15 App Router, TypeScript. Pages:

- `/` Dashboard — incidents, "Learned patterns (from PostgreSQL runs)" (real counts of first-steps + engineer confirmations), demo controls (reset / seed / replay) with busy, ok and error states.
- `/incidents/[id]` — investigation page: symptoms, metrics, **strategy cards** (each step with hypothesis, confidence, cited historical ids), tool result panels, **timeline visualization**, **memory panel** (raw recall outcome: incident ids, count, retention/ready status), feedback + resolve controls.
- `/learning` — Learning Evolution: episodes and paths read from PostgreSQL runs *and* live recall; replay episodes are labelled "scripted feedback".
- `/compare` — Baseline vs Memory: runs the incident with recall **disabled** and with recall **enabled**, shows both strategies side by side plus the difference banner.

All UI numbers come from real API responses (`lib/api.ts`, typed) and pure transforms (`lib/transforms.ts`); nothing is hard-coded.

### FastAPI (`backend/app/main.py`, `backend/app/api/routes/`)

- `health.py` — `/health`: real PostgreSQL reachability probe and real Hindsight `aget_version()`; a failed probe is an honest "unreachable" status (and retain capability is downgraded on a billing 402).
- `incidents.py` — `/incidents`, `/incidents/{id}`, `/incidents/{id}/runs`, `/incidents/{id}/timeline`, `/incidents/runs/{run_id}/timeline`.
- `investigations.py` — investigate, memory, feedback, resolve.
- `demo.py` — `/demo/reset`, `/demo/seed`, `/demo/replay`, `/learning/strategy`, `/learning/evolution`.

### Incident Service (`backend/app/services/investigation.py`)

`InvestigationAgent` drives one incident: build the recall query from evidence, call Hindsight, generate the strategy, execute tools in order (each result updates the hypothesis state and the timeline), propose a root cause, and on feedback retain the experience. `replay_tier2()` reuses the **same** pipeline for demo replay (recall→investigate→correct→retain) with per-incident error isolation so one bad memory cannot abort the batch.

### Strategy Engine (`backend/app/agent/strategy.py`)

- `render_current_evidence(incident)` — metric snapshot + telemetry statuses.
- `render_recalled_memory(outcome)` — the remembered episodes by attached id, deliberate: IDs → catalog lookup (so the LLM can never cite an id that does not exist).
- `generate_strategy` — system prompt asks for **structural JSON** (never free text); response parsed and Pydantic-validated (`Strategy`), steps constrained to the hard tool allowlist, cited ids cross-checked against recall output. Temperature 0, optional fixed seed.
- `memory_ranked_fallback` — deterministic memory+evidence ranking with the **contradiction gate** (see `docs/hindsight-memory.md` §8). Marked `fallback_used=True` and surfaced in the UI.

### Investigation Tools (`backend/app/tools/telemetry.py`)

Five deterministic tools over the synthetic dataset. Each is scoped by `incident_id`, so two incidents on the same service can legitimately return opposite evidence (required by the counter-case). Tools read only raw telemetry from the incident file — never `root_cause`, `successful_steps`, or `lesson` (regression test `test_no_answer_leak.py`).

### Hindsight client (`backend/app/hindsight/`)

- `client.py` — `HindsightMemory`: bank create/health, `retain`/`retain_and_wait`, `recall`; classifies auth, unavailable, and **billing** failures distinctly.
- `formatting.py` — builds the retained narrative, metadata, tags; parses recall results into `RecallOutcome` with validated incident ids.

### State layer (`backend/app/services/state_repository.py`, `backend/app/models/`)

SQLAlchemy async models: `Incident` (catalog mirror), `Run` (strategy, memory recall ids, fallback flag, used_feedback), `RunStep` (tool order, result), `RunFeedback` (action, correction text), `DemoIncident` (baseline/memory visibility flags). `seed_catalog()` mirrors the JSON dataset idempotently; `DB_AUTO_SEED` does this at startup. PostgreSQL is **never** consulted by the strategy fallback for what to try next.

### Dataset (`data/incidents/`)

34 incidents: tier1 (16), eval (14 — including contradictions and counter-cases), replay (3, scripted corrections), demo (1). Full telemetry per incident powers the deterministic tools.