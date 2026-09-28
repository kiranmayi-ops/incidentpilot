# Evaluation Report

> Policy: **real results only.** Every number below comes from either the deterministic test harness (scripted LLM/memory seams) or live runs against real Hindsight + a real OpenAI-compatible LLM. No evaluation result here is fabricated or extrapolated.

## Train / test split

- **Memory training set (what the agent can recall):** Tier-1 (16 incidents, loaded by `/demo/seed`) plus replayed Tier-2 episodes (3 checkout-api incidents with scripted engineer corrections, retained by `/demo/replay`). These are the *only* experiences in the Hindsight bank during evaluation.
- **Held-out test set:** the **eval** tier (14 incidents, including contradictions and counter-cases) and the **demo** incident `INC-2001`. These are recorded in the incident catalog but are **never seeded into, or re-retained into, the demo memory bank**. During eval runs they may be recalled against only if already present from training — they are not part of training recall.
- `INC-2001` (demo) is used for the baseline-vs-memory comparison; `INC-4010` is the counter-case.

## Deterministic harness results (unit/integration tests, 75 passing)

Strategy generation is exercised with a `FakeLLM` (deterministic JSON) and a seeded `FakeMemory`, so the *memory→strategy* change is measured without provider noise:

| Run | First step | Notes |
| --- | --- | --- |
| Baseline `INC-2001` (recall disabled) | `check_database` | No memory input; evidence + generic ordering |
| Memory `INC-2001` (recall seeded) | `check_redis` | Recall surfaces tier-1 redis experience; redis predicted first |
| Fallback `INC-2001` (LLM unavailable) | `check_redis` | Memory-ranked fallback reproduces the memory-driven order |
| Counter-case `INC-4010` (memory on) | `check_database` | Recall present, but `db_util=0.96` + healthy redis → contradiction gate sets the redis prior aside |

Additional regression coverage: re-seeding the memory with a *different* history changes the fallback ordering (proves no per-service hard-coding); tools never leak `root_cause`/`lesson`/`successful_steps`; recalled incident ids are validated against the catalog; baseline first step for the demo incident is asserted **not** to be `check_redis`.

## Live measured results (real Hindsight + real LLM)

Measured during the Phase-7 demo rehearsal on a throwaway bank (`engineering-prod-demo-092df4d0`):

- **Replay of 3 scripted episodes** — every run completed the real investigate→correct→retain pipeline; all 3 retained to Hindsight (`scripted_feedback: True`, `failures: []`). First steps observed: `check_recent_deployments`, `check_redis`, `check_redis`.
- **Learning evolution / strategy** after seed+replay — computed from PostgreSQL runs + live recall:
  - first-choice counts: `check_redis` **2×**, `check_recent_deployments` **2×**, others 0
  - engineer confirmations: `check_redis` **2×**

A final clean-log live run on the fully seeded bank (real LLM `openai/gpt-oss-20b`, temperature 0, no fallback) produced:

| Run | First step | fallback | Recall | Cited ids |
| --- | --- | --- | --- | --- |
| Baseline `INC-2001` (recall disabled) | `check_recent_deployments` | no | 0 | — |
| Memory `INC-2001` | `check_redis` | no | 119 results | `INC-3002, INC-3003` (replayed episodes) |
| Counter-case `INC-4010` (memory on) | `check_database` | no | 119 results | `INC-1009, INC-1002` (db-correct payment) |

The memory run's first step changed because the replayed checkout episodes were recalled **and the LLM could not justify not naming them**; the counter-case run *also recalled* the checkout→Redis lesson but ranked `check_database` first because the current evidence (97% DB connection utilization, pool saturation logs) contradicted it. A Groq daily-token limit independently exercised the reliability path during rehearsal: the LLM was retried then **explicitly** fell back to the memory-ranked fallback, which the API marked `fallback=True` and surfaced in the UI.

Retention readiness was probed until recall succeeded before the UI reported "memory ready" (async ingest, polling).

## What a larger eval would measure (not yet run)

A full eval harness would run each of the 14 eval incidents N times, baseline vs memory, and report first-step accuracy, steps-to-useful-evidence, and root-cause accuracy with confidence intervals. That harness is future work (README → Future Work); the current implementation is verified by the deterministic suite plus the live measured runs above.

## Synthetic-data limitations

- All telemetry and incident narratives are **synthetic and hand-shaped**; log-language variety, multi-cause cascades, partial observability and real-world drift are not modelled. Numbers characterize the agent *on this dataset*.
- The dataset is small (34 incidents; 16 tier-1 seeds). Priors saturate quickly by design (`0.7·log2(1+n)`), which is appropriate for a demo but is not a generalizable learning curve.
- Eval incidents were curated to include counter-cases, which can make results look better than a random sample of production incidents would.
- Hindsight and LLM providers are real; live numbers therefore depend on current provider behavior. The deterministic harness is the reproducible source of truth for the memory-change claim.