# Hindsight memory in IncidentPilot

> Everything marked **VERIFIED** below was read off the installed
> `hindsight-client` **0.10.1** and, where noted, confirmed against the live
> Hindsight Cloud API on 2026-09-28. Nothing here is assumed.

## 0. What Hindsight actually is

Hindsight is an open-source agent-memory system by Vectorize
(<https://github.com/vectorize-io/hindsight>, paper arXiv:2512.12818). It is
**not** the PyPI package named `hindsight` — that one is a Behave-for-Jira test
client and is a naming trap. The real client is `hindsight-client`.

It exposes three operations over a *memory bank*:

| Operation | Purpose | Uses an LLM? | Returns |
|---|---|---|---|
| `retain`  | store content, extracting facts | **yes** (extraction + embedding) | memory ids |
| `recall`  | multi-strategy search (semantic, keyword, graph, temporal) | no | ranked facts |
| `reflect` | reason *over* memory | yes | generated answer |

**VERIFIED** — the exact client surface we depend on:

```python
from hindsight_client import Hindsight            # hindsight-client==0.10.1
client = Hindsight(base_url=..., api_key=...)     # or HINDSIGHT_API_URL / HINDSIGHT_API_KEY

await client.acreate_bank(bank_id, name=, mission=, background=, disposition=)
await client.aretain(bank_id, content, context=, document_id=, metadata=, tags=)
await client.arecall(bank_id, query, budget=, max_tokens=, types=, tags=)
await client.alist_memories(bank_id, limit=, offset=)
await client.aget_version()
```

## 1. The four facts that shaped this integration

### 1.1 `retain` is not a structured write, and returns no counts

**VERIFIED** — `RetainResponse` fields are exactly:

```
success, bank_id, items_count, async, operation_id, operation_ids, usage
```

There is **no memory count**. `items_count` is how many *items you submitted*,
not how many memories were created.

Worse for design purposes: retain runs an LLM that *extracts facts* from your
text and links them into a knowledge graph. So recall **will not** hand back
the JSON you retained. If you retain a JSON blob and then recall it, you get
prose fragments, not your object.

**What we do about it** — `app/hindsight/formatting.py` renders each experience
as prose that states, explicitly and in plain language:

- `incident_id` and `service`
- the **ordered investigation path** (`check_database -> check_redis -> ...`)
- `root_cause` and `resolution`
- which steps were low-value and which were useful
- the engineer's correction
- the lesson

and *then* appends a structured JSON copy as a second layer. Recall usually
surfaces the prose; the JSON is there if the chunk is ever returned whole.
Incident ids are also written to `document_id`, `metadata` and `tags`.

### 1.2 Retention is asynchronous

**VERIFIED** — Hindsight's own integration guide tells you to
`await asyncio.sleep(3)` when retain and recall happen back to back, and
`retain(..., retain_async=)` plus `operation_id` exist for this reason.

So `retain()` returning does **not** mean the memory exists yet. A naive
`retain(); recall()` can legitimately return nothing — and a demo that then
concludes "memory didn't change the strategy" would be wrong.

**What we do about it** — `HindsightMemory.retain_and_wait()` polls `recall`
until the retained `incident_id` is actually present, bounded by
`HINDSIGHT_RETAIN_TIMEOUT_SECONDS`. If it never becomes recallable it raises
`MemoryNotReady` and the run stops. The UI only shows **memory ready** when
that poll succeeded. The smoke script exercises exactly this.

### 1.3 Recall returns results, not a total

**VERIFIED** — `RecallResponse` has `results`, `trace`, `entities`, `chunks`,
`source_facts`. There is **no `total`**.

Therefore every count in the UI is `len(results)` plus computation over
structured records — never a number somebody typed. See §3.

### 1.4 `RecallResult` is the join surface

**VERIFIED** — each result carries:

```
id, text, type, entities, context, occurred_start, occurred_end,
mentioned_at, document_id, metadata, chunk_id, tags, source_fact_ids,
scores, attachments
```

`text` is authoritative (extraction may drop the rest), so we parse incident
ids out of it with a strict `\bINC-\d{3,6}\b` pattern and use `metadata` /
`document_id` only as corroboration.

## 2. Where Hindsight is used, and where it is not

```
PostgreSQL  ── application state ──► incidents, investigation_runs,
                                    investigation_steps, feedback,
                                    evaluation results, demo state

Hindsight   ── long-term memory  ──► investigation experiences, engineer
                                    corrections, lessons, recurring patterns
```

PostgreSQL is **never** used as a stand-in for memory and never decides a
strategy. It is used for exactly one thing in the memory path: **counting and
annotating incidents that Hindsight's recall actually returned.** If recall
returns nothing, the counts are zero — the database does not backfill them.

## 3. Every number in the UI is computed

`compute_recall_stats()` produces the "N similar experiences / M engineer
confirmations / K low-yield steps" line:

| Number | Source |
|---|---|
| `recalled_count` | `len(RecallResponse.results)` |
| `incident_ids` | ids parsed from recall `text`/`metadata`/`document_id` |
| `engineer_confirmations` | recalled incidents that carry a correction |
| `low_yield_steps` | ruled-out steps across those same recalled incidents |
| `*_step_counts` | per-tool tallies over those same recalled incidents |

The incident ids that were counted are returned alongside the counts so a
judge can see the derivation.

## 4. Memory as guidance, not proof

The bank mission instructs Hindsight to prefer experiences that are relevant,
recent, repeatedly confirmed and backed by successful outcomes — and explicitly
to treat history as something to validate against current evidence, not as
proof.

This matters for the counter-case (`INC-4002`): a `checkout-api` incident with
*identical* symptoms where Redis is **healthy** and a bad deploy is the cause.
The agent recalls the Redis lesson and must still decline to lead with Redis.
Strategy validation lives in `app/agent/strategy.py`, which also **rejects any
`historical_evidence` id that is not in the current recall result**, so the
model cannot cite a memory it did not get.

## 5. Deployment

- **Hindsight Cloud** (default, recommended) — no Docker, free tier. Set
  `HINDSIGHT_API_URL=https://api.hindsight.vectorize.io` and
  `HINDSIGHT_API_KEY`.
- **Self-hosted** — `pip install hindsight-all` then `hindsight-api` on
  `:8888`. **VERIFIED** it needs PostgreSQL with `pgvector` (deps: `asyncpg`,
  `pgvector`, `psycopg2-binary`); there is an `embedded-db` extra
  (`pg0-embedded`) for Docker-free local use, plus a `local-llm` extra
  (`llama-cpp-python`). It also needs its own LLM key
  (`HINDSIGHT_API_LLM_API_KEY`) to extract facts on retain.

## 6. Operational notes found in practice

- **TLS on macOS/CPython**: `hindsight-client` is aiohttp-based. With no system
  CA bundle for the active interpreter it fails with
  `CERTIFICATE_VERIFY_FAILED` and a healthy API looks dead. We set
  `SSL_CERT_FILE` to certifi's bundle **before importing `hindsight_client`**,
  because aiohttp builds its default SSL context at import time. This was
  found by running the smoke test, not by assumption.
- **`/health` must fail loudly.** `HindsightMemory.health()` performs a real
  `aget_version()`. An unreachable bank reports `reachable: false` and the app
  never silently pretends memory is working.

## 7. Reproducing the verification

```bash
cp .env.example .env      # add HINDSIGHT_API_KEY
.venv/bin/python scripts/hindsight_smoke.py
```

It creates the bank, retains one real experience, blocks until recallable,
recalls, and prints the **raw** results (ids, types, tags, metadata, text) so
the behaviour above can be inspected directly.
