# IncidentPilot

An SRE investigation agent whose past incidents (stored in Hindsight long-term memory) visibly change how it investigates the next incident.

## Problem

Incident response is often procedural guesswork: engineers re-run the same five checks top-down, wasting the first 10 minutes on the wrong component. Past incidents hold the answer, but helm charts rot and wiki pages go stale. Teams need a memory that is **recalled automatically**, **surfaces the relevant past**, and — crucially — is **contradicted by fresh evidence when the past does not apply**.

## Solution

IncidentPilot pairs a FastAPI investigation agent with a Next.js SRE console:

- A **strategy engine** builds the investigation plan from three inputs: recalled Hindsight memories, *current* telemetry evidence, and LLM reasoning.
- A **tool layer** of deterministic synthetic telemetry (`check_metrics`, `query_logs`, `check_database`, `check_redis`, `check_recent_deployments`) scoped by `incident_id` — the same tools return different evidence for different incidents on the same service.
- **Engineer feedback** (`accept / reject / correct`) is retained into Hindsight, so the agent's next investigation literally incorporates what a real engineer corrected.
- A **baseline-vs-memory comparison** shows the strategy before and after memory, plus a **learning evolution** panel computed from PostgreSQL runs *and* live recall.

## Why Hindsight

Hindsight is the agent's long-term memory. PostgreSQL in this project stores *application state only*: the incident catalog mirror, investigation *runs*, tool *steps*, feedback, and demo/eval flags. It **never** stores the knowledge that shapes a strategy, and the strategy engine never reads `root_cause`, `lesson`, or `successful_steps` from PG — those answers live only in the JSON dataset, and the deterministic tools return raw telemetry only (see `docs/architecture.md`).

What Hindsight stores is an *experience narrative*: symptoms, the steps actually taken, which steps were successful and which were low-yield, the final root cause, and any engineer correction. Hindsight owns extraction, embedding, and similarity recall — the pieces an SRE memory actually needs and that a relational table does not provide faithfully.

## How Memory Changes Agent Behavior

The full behavior loop:

1. An incident arrives. The agent **recalls** from Hindsight (`recall.top(n=...)`), which returns historical experience snippets with their incident IDs.
2. The strategy engine folds the recalled experiences into the plan **alongside the current evidence signals** — e.g. a degraded `check_database` result, or a recent deployment — and the LLM ranks candidate tools into an ordered strategy.
3. The agent executes tools in order. If the LLM fails, a **memory-driven fallback** ranks tools by recalled success/low-yield statistics plus current-evidence bonuses (never a fixed per-service order).
4. The engineer confirms or **corrects** the outcome. The correction — e.g. *"For checkout-api latency with 5xx, check Redis earlier"* — is retained into Hindsight.
5. The **next** incident on that service recalls the corrected episode, and the strategy shifts: the demo incident's first step changes from `check_recent_deployments`/`check_database` (baseline) to `check_redis` (memory) — see the live baseline-vs-memory page.

Because current evidence is always a ranking input, the agent does **not** blindly follow memory: the eval counter-case includes checkout-api incidents with a *healthy* Redis and a broken database, where the recalled "check Redis" lesson is deliberately deprioritized.

## Architecture

```
Frontend (Next.js)
   ↓
FastAPI
   ↓
Incident Service
   ↓
Strategy Engine
   ├── Hindsight Recall
   ├── Current Evidence
   └── LLM Reasoning
   ↓
Investigation Tools
   ↓
Human Feedback
   ↓
Hindsight Retain
```

Details, component-by-component: `docs/architecture.md`. Memory model and retention lifecycle: `docs/hindsight-memory.md`.

## Memory Model

- **Tier 1 — synthetic catalog (16 incidents).** Loaded by `POST /demo/seed`. No checkout-api Redis history (per test design), includes cases where database-first *was* correct so memory is not trivially "always Redis".
- **Tier 2 — replayed scripted incidents (3).** `POST /demo/replay` re-runs the full investigate→feedback→retain pipeline with scripted engineer corrections (`scripted_feedback: True`). These are the episodes that actually change the strategy.
- **Demo — 1 incident** (`INC-2001`) used in the demo.
- **Eval — 14 incidents**, including contradictions and counter-cases used for evaluation without polluting the demo memory.
- **Retention is async.** The agent retains, then polls recall until the experience is recallable ("memory ready"), bounded by `HINDSIGHT_RETAIN_TIMEOUT_SECONDS`.

## Agent Workflow

1. `POST /incidents/{id}/investigate` — recall memories, build strategy, run tools, update hypotheses, propose root cause.
2. `POST /incidents/{id}/feedback` — accept / reject / correct the outcome; store the run/feedback in PG *and* retain the episode (with the correction) into Hindsight.
3. `POST /incidents/{id}/resolve` — mark resolved.
4. `GET /incidents/{id}/memory` — raw recall results and retention status, shown in the UI memory panel.

## Demo

A 3-minute judge-ready script with a pre-warmed demo bank: `docs/demo-script.md`.

```
POST /demo/reset    # wipe the demo memory bank (and demo run history)
POST /demo/seed     # load Tier 1 knowledge into memory
POST /demo/replay   # replay scripted Tier 2 episodes with real feedback + retention
```

Run the demo flow, then open the dashboard → **Baseline vs Memory** for `INC-2001`: baseline first step ≠ `check_redis`; memory first step = `check_redis`. **Learning Evolution** shows the replayed episode paths labelled "scripted feedback".

## Screenshots

The live demo is the source of truth — run the demo flow and screenshot:
- Dashboard (incidents, learned patterns, demo controls)
- Investigation page (timeline + memory panel)
- Learning Evolution
- Baseline vs Memory

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2 (async), Pydantic v2, httpx/OpenAI-compatible LLM client
- **Memory:** Hindsight (vectorized long-term memory; Cloud or self-hosted)
- **Frontend:** Next.js 15 (App Router, TypeScript), Vitest
- **State:** PostgreSQL (local dev/tests: SQLite)
- **Deployment:** Docker Compose

## Local Setup

```bash
git clone <repo> && cd incidentpilot
python3.12 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

Configure `.env` (copy from `.env.example`):

| Variable | Meaning |
| --- | --- |
| `HINDSIGHT_API_URL` | Hindsight endpoint (Cloud: `https://api.hindsight.vectorize.io`) |
| `HINDSIGHT_API_KEY` | Hindsight API key (blank OK when self-hosted) |
| `HINDSIGHT_BANK_ID` | Memory bank to use (use a throwaway bank for demos) |
| `LLM_API_KEY` | OpenAI-compatible key (Groq, OpenRouter, ...) |
| `LLM_BASE_URL` / `LLM_MODEL` | Provider endpoint and model |
| `DATABASE_URL` | PostgreSQL URL (or `sqlite+aiosqlite:///./incidentpilot.db` for local) |
| `CORS_ORIGINS` | e.g. `http://localhost:3000` |

## Running the Project

Full stack (PostgreSQL + API + frontend):

```bash
docker compose up --build
```

Frontend build bakes `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`, the compose backend address).

Local dev (SQLite, no Docker):

```bash
# terminal 1 — backend
.venv/bin/uvicorn app.main:app --port 8000 --reload   # from backend/
# terminal 2 — frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev # from frontend/
```

## Running Tests

```bash
# backend (SQLite in-memory; nested in backend/)
cd backend && ../.venv/bin/python -m pytest -q

# frontend
cd frontend && npm run test

# typecheck + production build
cd frontend && npm run build
```

Current: **75 backend tests, 17 frontend tests, clean `next build`.**

## Evaluation

`docs/evaluation-report.md` describes the train/test split (Tier 1 + replay = memory training memory; eval/incidents = held-out), the measured first-step metrics, and the synthetic-data limitations.

Key measured facts:

- Baseline (recall disabled) for the demo incident does **not** start with `check_redis`.
- Memory agent for the demo incident, after seeding + replay, **does** start with `check_redis`.
- The counter-case (checkout-api with healthy Redis) does **not** blindly priority the recalled Redis lesson.

## Project Structure

```
backend/
  app/
    api/routes/       # health, incidents, investigations, demo+learning
    services/         # investigation agent, strategy engine, hindsight client,
                      # incidents store, state repository
    tools/            # deterministic telemetry tools (hard allowlist)
    schemas/          # Pydantic v2 models
  tests/              # 75 tests (agent, strategy, state, API, memory seams)
frontend/
  app/                # dashboard, /incidents/[id], /learning, /compare
  lib/                # typed API client + pure transforms
  tests/              # 17 Vitest tests
data/incidents/       # 34-incident synthetic dataset (tier1/eval/replay/demo)
docs/                 # architecture, hindsight memory, demo script, evaluation
docker-compose.yml
```

## Demo Video

Record the demo script (`docs/demo-script.md`) end-to-end against the pre-warmed demo bank.

## Limitations

- All telemetry and incident descriptions are **synthetic**. Real-world drift (deeper evidence, more tool kinds, cascading failures, log-language variety) is not modelled. Evaluation numbers describe the agent on *this* dataset.
- Hindsight retains are real and cost credits; retention is async (polled for readiness). The human retain on the judge demo takes real wall-clock seconds.
- The full Docker/PostgreSQL path is verified by configuration and design, but this environment ran the app against SQLite; see `docs/evaluation-report.md`.

## Future Work

- Add `check_memory`/`check_secrets` and request-level tool coverage so external-api and memory-leak root causes have a direct degraded tool.
- Larger multi-service training set + similarity fine-tuning budgets.
- Automated nightly evaluation harness that keeps a "stale memory" regime in check (spec §8).