# Demo Script — the 3-minute judge demo

> **Preconditions (do not do on stage):**
> 1. Start the stack (see README → Running the Project).
> 2. `POST /demo/reset`, `POST /demo/seed` (16 tier-1 incidents → real Hindsight retains), `POST /demo/replay` (3 scripted episodes, real retains; ~2–3 min wall time due to async ingestion).
> 3. Warm the LLM cache by visiting **Baseline vs Memory** once for `INC-2001` before presenting.
> 4. Backend on a throwaway bank (`HINDSIGHT_BANK_ID=...-demo-...`), **not** the real `engineering-prod`.
>
> Retention wait times must never appear on stage.

Use the pre-warmed demo bank. Example values below are the real observed state on the demo bank at rehearsal time; re-run the flow and the UI will show your fresh bank's numbers.

---

### 0:00–0:20 — Problem and pitch

> "When an incident page opens, engineers re-run the same five checks top-down. IncidentPilot gives the agent a real long-term memory — Hindsight — so past incidents actually change the next investigation. This is not a chatbot: it's a strategy-first SRE console."

Show the dashboard.

### 0:20–0:50 — Incident A (an incident *before* memory changed things)

Open **Incident Investigation** for `INC-2001`. Click **Investigate** (or show the pre-run). The memory panel shows **little relevant history**; the strategy is generic. Run the investigation: the agent checks the database first (a wasted step — healthy), then finds **Redis exhausted** (`check_redis` degraded, "connection pool max clients"). Zero in on the Redis telemetry.

### 0:50–1:10 — Engineer correction

Enter a feedback **correction**:

> "For checkout-api latency with 5xx, check Redis earlier."

Submit it. Point out "accepted, retained."

### 1:10–1:30 — Hindsight retention + learning evolution

Show the memory panel flipping to **"memory ready"** (only after the retention probe succeeds). Open **Learning Evolution**: real paths from PostgreSQL runs *and* live recall — Tier-1 seeds (label `seed_tier1`) and the replayed scripted episodes labelled **"scripted feedback"**, with the correction visible in the retained experience.

### 1:30–2:05 — Incident B (memory changes the strategy)

Open **Baseline vs Memory** for `INC-2001`. Show:

- **Baseline** (recall disabled): first step is **not** `check_redis` (observed live: `check_recent_deployments`; deterministic stub: `check_database`).
- **Memory** (recall enabled): the computed recall panel lists the **actual incident ids** (e.g. `INC-3001, INC-3002, INC-3003` cross-checked against PostgreSQL), and the first step is now **`check_redis`** — with the reason citing the replayed episodes and the history that made it (checkout → redis).

Side-by-side, the difference banner: *"First step changed: ... → check_redis."*

### 2:05–2:35 — Counter-case: memory is respected, not obeyed

Open the counter-case incident (`INC-4010`, checkout-api) on the Evaluation page or via `POST /incidents/INC-4010/investigate` with memory enabled. Hindsight *recalls* the exact same Redis lesson (panel shows the ids). But the current evidence shows `db_connection_utilization = 0.96` and a **healthy Redis** — the contradiction gate sets the stale prior aside, and the strategy ranks `check_database` first. Narrate: *"the recalled lesson doesn't get blindly reapplied — current evidence outranks it."*

### 2:35–3:00 — Why Hindsight + measured evaluation

Recap the memory model (PostgreSQL = app state, Hindsight = memory; retention is async and only "ready" when recallable). Show the real numbers (`docs/evaluation-report.md`): baseline first-step ≠ Redis for the demo incident, memory first-step = Redis; counter-case avoids the trap. Mention limits are synthetic-data only, honestly.