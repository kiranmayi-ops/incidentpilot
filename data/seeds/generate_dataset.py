"""Deterministic generator for the synthetic IncidentPilot incident dataset.

Run:  python data/seeds/generate_dataset.py

Writes one JSON file per incident into data/incidents/.

Design constraints enforced here (spec §11, §20):

* Tools are scoped by ``incident_id``, so two incidents on the SAME service can
  return DIFFERENT evidence. This is what makes the counter-case possible
  (a checkout-api incident with a healthy Redis and a bad deployment).
* Telemetry contains only raw observability signals. It never contains the
  root cause or the lesson - a tool must not leak the answer.
* Demo incidents carry AMBIGUOUS symptoms. The word "redis" must never appear
  in the symptoms of a checkout-api demo incident, otherwise the baseline
  agent is handed the answer for free (spec §20).
* Tier 1 contains NO checkout-api incident at all, so that recall returns
  little relevant history before the first lesson exists.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "data" / "incidents"

SERVICES = [
    "checkout-api",
    "payment-api",
    "auth-service",
    "order-service",
    "catalog-service",
    "notification-service",
    "user-service",
    "search-service",
]

ROOT_CAUSES = [
    "redis_connection_exhaustion",
    "database_connection_exhaustion",
    "memory_leak",
    "bad_deployment",
    "external_api_failure",
    "queue_backlog",
]

# Services each one depends on, used for the "operational knowledge" seed.
SERVICE_DEPENDENCIES: dict[str, list[str]] = {
    "checkout-api": ["payment-api", "auth-service", "redis-checkout", "postgres-orders"],
    "payment-api": ["external-psp", "postgres-orders", "redis-sessions"],
    "auth-service": ["redis-sessions", "postgres-users"],
    "order-service": ["postgres-orders", "queue-fulfillment", "redis-checkout"],
    "catalog-service": ["postgres-catalog", "search-index"],
    "notification-service": ["queue-fulfillment", "external-psp"],
    "user-service": ["postgres-users", "redis-sessions"],
    "search-service": ["search-index", "catalog-service"],
}

# Infrastructure tiers are deliberately split out of the pre-tool evidence.
# An alert payload naming "redis-checkout" hands the agent the answer, since
# redis exhaustion is the true cause of the demo incidents. Infra topology is
# instead DISCOVERED by running check_redis / check_database, or recalled from
# the Tier 1 Hindsight memory seed which retains the full dependency map.
_INFRA_PREFIXES = ("redis-", "postgres-", "queue-", "search-index", "external-")


def _split(service: str) -> tuple[list[str], list[str]]:
    """Return ``(service_dependencies, infra_dependencies)`` for a service."""
    svc: list[str] = []
    infra: list[str] = []
    for dep in SERVICE_DEPENDENCIES.get(service, []):
        (infra if dep.startswith(_INFRA_PREFIXES) else svc).append(dep)
    return svc, infra


# ---------------------------------------------------------------------------
# Telemetry templates
# ---------------------------------------------------------------------------


def _healthy_db(rng: random.Random) -> dict[str, Any]:
    return {
        "status": "healthy",
        "evidence": {
            "connection_utilization": round(rng.uniform(0.31, 0.46), 2),
            "active_connections": rng.randint(28, 52),
            "lock_waits_per_min": rng.randint(0, 3),
            "replication_lag_s": rng.randint(0, 2),
            "slow_queries_over_1s": rng.randint(0, 2),
        },
    }


def _healthy_redis(rng: random.Random) -> dict[str, Any]:
    return {
        "status": "healthy",
        "evidence": {
            "connection_pool_utilization": round(rng.uniform(0.28, 0.45), 2),
            "timeouts_last_5m": rng.randint(0, 4),
            "avg_latency_ms": rng.randint(1, 4),
            "evicted_keys_last_5m": rng.randint(0, 9),
            "connected_clients": rng.randint(40, 90),
        },
    }


def _degraded_db(rng: random.Random) -> dict[str, Any]:
    return {
        "status": "degraded",
        "evidence": {
            "connection_utilization": round(rng.uniform(0.93, 0.99), 2),
            "active_connections": rng.randint(180, 240),
            "lock_waits_per_min": rng.randint(120, 400),
            "replication_lag_s": rng.randint(20, 75),
            "slow_queries_over_1s": rng.randint(90, 260),
        },
    }


def _degraded_redis(rng: random.Random) -> dict[str, Any]:
    return {
        "status": "degraded",
        "evidence": {
            "connection_pool_utilization": round(rng.uniform(0.94, 0.99), 2),
            "timeouts_last_5m": rng.randint(90, 260),
            "avg_latency_ms": rng.randint(620, 1100),
            "evicted_keys_last_5m": rng.randint(400, 1500),
            "connected_clients": rng.randint(300, 480),
        },
    }


def _clean_deploy(rng: random.Random) -> dict[str, Any]:
    return {
        "status": "healthy",
        "evidence": {
            "deploys_last_24h": rng.randint(0, 1),
            "last_deploy_age_minutes": rng.randint(600, 4000),
            "error_rate_delta_pct": 0.0,
            "rollback_candidate": None,
        },
    }


def _bad_deploy(rng: random.Random) -> dict[str, Any]:
    return {
        "status": "degraded",
        "evidence": {
            "deploys_last_24h": 1,
            "last_deploy_age_minutes": rng.randint(6, 40),
            "error_rate_delta_pct": round(rng.uniform(3.4, 9.8), 1),
            "rollback_candidate": f"rel-{rng.randint(1000, 9999)}",
        },
    }


def build_telemetry(root_cause: str, rng: random.Random) -> dict[str, Any]:
    """Return per-tool raw evidence for an incident with the given root cause."""
    db = _healthy_db(rng)
    redis = _healthy_redis(rng)
    deploy = _clean_deploy(rng)

    if root_cause == "redis_connection_exhaustion":
        redis = _degraded_redis(rng)
    elif root_cause == "database_connection_exhaustion":
        db = _degraded_db(rng)
    elif root_cause == "bad_deployment":
        deploy = _bad_deploy(rng)
    # memory_leak / external_api_failure / queue_backlog show up in metrics+logs
    # while db and redis stay healthy.

    return {
        "check_database": db,
        "check_redis": redis,
        "check_recent_deployments": deploy,
    }


def build_logs(root_cause: str, service: str, rng: random.Random) -> list[str]:
    """Request-level log lines as seen BEFORE any diagnostic tool runs.

    These must stay deliberately generic about *which dependency* failed:
    an alert saying "calling cache layer / no connection available in pool"
    hands the baseline the answer, and the spec requires that redis evidence
    appear only once check_redis has been executed. Tier-specific diagnosis
    lives in the per-tool telemetry instead.
    """
    rid = f"req-{rng.randint(10000, 99999)}"
    if root_cause == "redis_connection_exhaustion":
        return [
            f"{rid} WARN  upstream timeout after 2000ms",
            f"{rid} ERROR upstream timeout exceeded threshold",
            f"{rid} WARN  retrying upstream call (attempt 2/3)",
            f"{rid} ERROR 5xx returned to client",
        ]
    if root_cause == "database_connection_exhaustion":
        return [
            f"{rid} ERROR db.pool: connection pool saturated (waiting 4.2s)",
            f"{rid} WARN  lock wait detected on orders_pkey",
            f"{rid} ERROR query timeout after 5000ms",
            f"{rid} WARN  pool waiters=57",
        ]
    if root_cause == "memory_leak":
        return [
            f"{rid} WARN  heap usage 93% of limit, GC pressure rising",
            f"{rid} WARN  long pause 1.8s during mark-sweep",
            f"{rid} ERROR container OOMKilled risk, rss=3.9Gi",
            f"{rid} WARN  allocation rate 2.4x baseline",
        ]
    if root_cause == "bad_deployment":
        return [
            f"{rid} ERROR panic: nil pointer dereference in OrderSummary.render",
            f"{rid} ERROR unhandled TypeError in totals calculation",
            f"{rid} WARN  500s concentrated on pods from latest rollout",
            f"{rid} ERROR feature flag default path is throwing",
        ]
    if root_cause == "external_api_failure":
        return [
            f"{rid} ERROR upstream psp.example HTTP 503 Service Unavailable",
            f"{rid} WARN  circuit breaker half-open for psp.example",
            f"{rid} ERROR external call timeout after 3000ms",
            f"{rid} WARN  retry storm detected for psp.example",
        ]
    if root_cause == "queue_backlog":
        return [
            f"{rid} WARN  consumer lag 18400 messages on queue-fulfillment",
            f"{rid} ERROR publish failed, broker unreachable (retrying)",
            f"{rid} WARN  queue depth 21500 and growing",
            f"{rid} ERROR message processing deadline exceeded",
        ]
    return [f"{rid} INFO  heartbeat ok"]


# ---------------------------------------------------------------------------
# Strategy-time metrics (what the agent sees BEFORE calling any tool)
# ---------------------------------------------------------------------------


def build_metrics(
    root_cause: str, service: str, rng: random.Random, demo: bool = False
) -> dict[str, Any]:
    """Metrics visible to the strategist BEFORE any tool call.

    NOTE: there is deliberately NO ``redis_pool_utilization`` here. The spec
    requires that Redis evidence appears only when ``check_redis`` runs, so
    exposing a Redis number up front would both leak the answer and wrongly
    signal "cache is fine" on incidents where it is not.

    For the ambiguous demo incidents the pre-tool metrics show an
    ELEVATED-BUT-NOT-CRITICAL database pool, which is a legitimate reason for a
    memory-less SRE agent to check the database first, and nothing about
    Redis.
    """
    base: dict[str, Any] = {
        "latency_p99_ms": rng.randint(380, 900),
        "error_rate_pct": round(rng.uniform(0.4, 1.6), 2),
        "throughput_rps": rng.randint(700, 1500),
        "db_connection_utilization": round(rng.uniform(0.38, 0.72), 2),
        "memory_utilization": round(rng.uniform(0.52, 0.74), 2),
        "queue_depth": rng.randint(0, 120),
        "replicas_restarted_last_1h": 0,
    }

    if demo:
        # Ambiguous. Elevated DB pool is a fair generic first suspect; there is
        # no redis signal anywhere.
        base.update(
            {
                "latency_p99_ms": rng.randint(1500, 2100),
                "error_rate_pct": round(rng.uniform(3.6, 5.2), 2),
                "throughput_rps": rng.randint(520, 700),
                "db_connection_utilization": round(rng.uniform(0.74, 0.81), 2),
                "memory_utilization": round(rng.uniform(0.66, 0.74), 2),
                "queue_depth": rng.randint(0, 40),
            }
        )

    if root_cause == "redis_connection_exhaustion":
        base.update(
            {
                "latency_p99_ms": rng.randint(1500, 2200),
                "error_rate_pct": round(rng.uniform(3.4, 5.6), 2),
                "throughput_rps": rng.randint(480, 700),
            }
        )
    elif root_cause == "database_connection_exhaustion":
        base.update(
            {
                "latency_p99_ms": rng.randint(1200, 1900),
                "error_rate_pct": round(rng.uniform(2.8, 4.9), 2),
                "db_connection_utilization": round(rng.uniform(0.88, 0.96), 2),
            }
        )
    elif root_cause == "memory_leak":
        base.update(
            {
                "latency_p99_ms": rng.randint(1800, 2600),
                "error_rate_pct": round(rng.uniform(1.8, 3.4), 2),
                "memory_utilization": round(rng.uniform(0.90, 0.97), 2),
            }
        )
    elif root_cause == "bad_deployment":
        base.update(
            {
                "latency_p99_ms": rng.randint(1400, 2200),
                "error_rate_pct": round(rng.uniform(4.0, 8.5), 2),
                "memory_utilization": round(rng.uniform(0.88, 0.95), 2),
                "replicas_restarted_last_1h": rng.randint(1, 4),
            }
        )
    elif root_cause == "external_api_failure":
        base.update(
            {
                "latency_p99_ms": rng.randint(1300, 2000),
                "error_rate_pct": round(rng.uniform(3.0, 6.0), 2),
            }
        )
    elif root_cause == "queue_backlog":
        base.update(
            {
                "latency_p99_ms": rng.randint(900, 1500),
                "error_rate_pct": round(rng.uniform(2.0, 4.0), 2),
                "queue_depth": rng.randint(14000, 26000),
            }
        )
    return base


# ---------------------------------------------------------------------------
# The incident catalogue
# ---------------------------------------------------------------------------

# tier:
#   "tier1"  -> loaded by /demo/seed (general knowledge + distractors).
#               MUST contain no checkout-api incident.
#   "replay" -> loaded by /demo/replay through the REAL pipeline.
#   "demo"   -> the live demo incident A (drives Phase 1-3).
#   "eval"   -> held-out evaluation incident. NEVER retained before evaluation.

CATALOGUE: list[dict[str, Any]] = [
    # ---------------- TIER 1: distractors, no checkout-api -----------------
    dict(incident_id="INC-1001", tier="tier1", service="payment-api", root_cause="database_connection_exhaustion",
         severity="SEV-2", symptoms=["payment latency increased", "5xx increased"],
         resolution="scale_db_connection_pool", ttr=26, useful_order=["check_database", "check_recent_deployments", "check_redis"]),
    dict(incident_id="INC-1002", tier="tier1", service="payment-api", root_cause="database_connection_exhaustion",
         severity="SEV-1", symptoms=["payment requests timing out", "5xx increased"],
         resolution="scale_db_connection_pool", ttr=34, useful_order=["check_database", "check_recent_deployments", "check_redis"]),
    dict(incident_id="INC-1003", tier="tier1", service="auth-service", root_cause="memory_leak",
         severity="SEV-2", symptoms=["auth latency increased", "pod restarts observed"],
         resolution="rollback_and_fix_leak", ttr=48, useful_order=["check_recent_deployments", "check_metrics", "check_database"]),
    dict(incident_id="INC-1004", tier="tier1", service="order-service", root_cause="queue_backlog",
         severity="SEV-2", symptoms=["order writes delayed", "consumer lag growing"],
         resolution="scale_consumers", ttr=41, useful_order=["check_metrics", "check_database", "check_redis"]),
    dict(incident_id="INC-1005", tier="tier1", service="catalog-service", root_cause="bad_deployment",
         severity="SEV-3", symptoms=["catalog 5xx increased", "latency increased"],
         resolution="rollback_deployment", ttr=15, useful_order=["check_recent_deployments", "check_database", "check_redis"]),
    dict(incident_id="INC-1006", tier="tier1", service="notification-service", root_cause="queue_backlog",
         severity="SEV-3", symptoms=["notifications delayed", "backlog growing"],
         resolution="scale_consumers", ttr=29, useful_order=["check_metrics", "check_redis", "check_database"]),
    dict(incident_id="INC-1007", tier="tier1", service="search-service", root_cause="external_api_failure",
         severity="SEV-2", symptoms=["search latency increased", "5xx increased"],
         resolution="enable_circuit_breaker", ttr=37, useful_order=["check_metrics", "check_database", "check_recent_deployments"]),
    dict(incident_id="INC-1008", tier="tier1", service="user-service", root_cause="redis_connection_exhaustion",
         severity="SEV-2", symptoms=["user profile latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=22, useful_order=["check_redis", "check_database", "check_recent_deployments"]),
    dict(incident_id="INC-1009", tier="tier1", service="auth-service", root_cause="database_connection_exhaustion",
         severity="SEV-2", symptoms=["login latency increased", "5xx increased"],
         resolution="scale_db_connection_pool", ttr=31, useful_order=["check_database", "check_redis", "check_recent_deployments"]),
    dict(incident_id="INC-1010", tier="tier1", service="catalog-service", root_cause="external_api_failure",
         severity="SEV-3", symptoms=["catalog enrichment failing", "5xx increased"],
         resolution="enable_circuit_breaker", ttr=24, useful_order=["check_metrics", "check_recent_deployments", "check_database"]),
    dict(incident_id="INC-1011", tier="tier1", service="search-service", root_cause="bad_deployment",
         severity="SEV-2", symptoms=["search results empty", "5xx increased"],
         resolution="rollback_deployment", ttr=18, useful_order=["check_recent_deployments", "check_redis", "check_database"]),
    dict(incident_id="INC-1012", tier="tier1", service="order-service", root_cause="memory_leak",
         severity="SEV-3", symptoms=["order service pod restarts", "latency increased"],
         resolution="rollback_and_fix_leak", ttr=44, useful_order=["check_recent_deployments", "check_metrics", "check_database"]),
    dict(incident_id="INC-1013", tier="tier1", service="payment-api", root_cause="bad_deployment",
         severity="SEV-1", symptoms=["payment 5xx spike", "latency increased"],
         resolution="rollback_deployment", ttr=12, useful_order=["check_recent_deployments", "check_database", "check_redis"]),
    dict(incident_id="INC-1014", tier="tier1", service="notification-service", root_cause="external_api_failure",
         severity="SEV-3", symptoms=["notification delivery failing", "5xx increased"],
         resolution="enable_circuit_breaker", ttr=27, useful_order=["check_metrics", "check_redis", "check_database"]),
    dict(incident_id="INC-1015", tier="tier1", service="user-service", root_cause="database_connection_exhaustion",
         severity="SEV-2", symptoms=["user lookup latency increased", "5xx increased"],
         resolution="scale_db_connection_pool", ttr=33, useful_order=["check_database", "check_recent_deployments", "check_redis"]),
    dict(incident_id="INC-1016", tier="tier1", service="search-service", root_cause="queue_backlog",
         severity="SEV-3", symptoms=["indexing delayed", "backlog growing"],
         resolution="scale_consumers", ttr=36, useful_order=["check_metrics", "check_database", "check_redis"]),

    # ---------------- TIER 2: scripted replay (real pipeline) --------------
    dict(incident_id="INC-3001", tier="replay", service="checkout-api", root_cause="redis_connection_exhaustion",
         severity="SEV-1", demo=True,
         symptoms=["checkout latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=19, useful_order=["check_redis", "check_recent_deployments", "check_database"],
         correction="For checkout-api latency with 5xx, check Redis earlier."),
    dict(incident_id="INC-3002", tier="replay", service="checkout-api", root_cause="redis_connection_exhaustion",
         severity="SEV-2", demo=True,
         symptoms=["checkout latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=16, useful_order=["check_redis", "check_recent_deployments", "check_database"],
         correction="Same pattern as last week. Check the cache tier first for checkout-api."),
    dict(incident_id="INC-3003", tier="replay", service="checkout-api", root_cause="redis_connection_exhaustion",
         severity="SEV-2", demo=True,
         symptoms=["checkout latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=21, useful_order=["check_redis", "check_recent_deployments", "check_database"],
         correction="Cache tier first on checkout-api. We have seen this four times now."),

    # ---------------- DEMO INCIDENT A (Phase 1-3) --------------------------
    dict(incident_id="INC-2001", tier="demo", service="checkout-api", root_cause="redis_connection_exhaustion",
         severity="SEV-1", demo=True,
         symptoms=["checkout latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=28, useful_order=["check_redis", "check_recent_deployments", "check_database"],
         correction="For checkout-api latency with 5xx, check Redis earlier."),

    # ---------------- HELD-OUT EVALUATION (never pre-retained) --------------
    # Demo incident B: memory agent must now check Redis FIRST.
    dict(incident_id="INC-4001", tier="eval", service="checkout-api", root_cause="redis_connection_exhaustion",
         severity="SEV-1", demo=True,
         symptoms=["checkout latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=20, useful_order=["check_redis", "check_recent_deployments", "check_database"]),
    # Counter-case 1: checkout-api, but Redis is HEALTHY and a bad deploy is
    # the cause. Memory must be recalled but must NOT win.
    dict(incident_id="INC-4002", tier="eval", service="checkout-api", root_cause="bad_deployment",
         severity="SEV-2", demo=True,
         symptoms=["checkout latency increased", "5xx increased"],
         resolution="rollback_deployment", ttr=14, useful_order=["check_recent_deployments", "check_database", "check_redis"]),
    # Counter-case 2: payment-api database exhaustion - database-first was and
    # is the correct answer, so the agent must not blindly "always redis".
    dict(incident_id="INC-4003", tier="eval", service="payment-api", root_cause="database_connection_exhaustion",
         severity="SEV-1", symptoms=["payment latency increased", "5xx increased"],
         resolution="scale_db_connection_pool", ttr=25, useful_order=["check_database", "check_redis", "check_recent_deployments"]),
    dict(incident_id="INC-4004", tier="eval", service="order-service", root_cause="queue_backlog",
         severity="SEV-2", symptoms=["order latency increased", "5xx increased"],
         resolution="scale_consumers", ttr=30, useful_order=["check_metrics", "check_database", "check_redis"]),
    dict(incident_id="INC-4005", tier="eval", service="user-service", root_cause="redis_connection_exhaustion",
         severity="SEV-2", symptoms=["user profile latency increased", "5xx increased"],
         resolution="increase_connection_pool", ttr=18, useful_order=["check_redis", "check_recent_deployments", "check_database"]),
    dict(incident_id="INC-4006", tier="eval", service="auth-service", root_cause="memory_leak",
         severity="SEV-2", symptoms=["auth latency increased", "pod restarts observed"],
         resolution="rollback_and_fix_leak", ttr=39, useful_order=["check_recent_deployments", "check_metrics", "check_database"]),
    dict(incident_id="INC-4007", tier="eval", service="catalog-service", root_cause="external_api_failure",
         severity="SEV-3", symptoms=["catalog latency increased", "5xx increased"],
         resolution="enable_circuit_breaker", ttr=26, useful_order=["check_metrics", "check_database", "check_recent_deployments"]),
    dict(incident_id="INC-4008", tier="eval", service="notification-service", root_cause="queue_backlog",
         severity="SEV-3", symptoms=["notification latency increased", "5xx increased"],
         resolution="scale_consumers", ttr=28, useful_order=["check_metrics", "check_redis", "check_database"]),
]

LESSONS: dict[str, str] = {
    "redis_connection_exhaustion": "The cache tier was the highest-yield first check here; the database was ruled out quickly and was not the cause.",
    "database_connection_exhaustion": "Checking the database first was the fastest route to useful evidence; the cache tier was not involved.",
    "memory_leak": "A recent change correlated with memory growth; the database and cache tier were both healthy.",
    "bad_deployment": "Correlating the alert with the most recent rollout found the cause fastest; dependency checks were not useful.",
    "external_api_failure": "Metrics plus logs identified the failing external dependency; internal dependency checks were low-yield.",
    "queue_backlog": "Consumer lag was visible in metrics before any dependency check was needed.",
}

INITIAL_HYPOTHESES = [
    "dependency saturation",
    "recent regression",
    "capacity exhaustion",
    "configuration change",
]


def build_incident(spec: dict[str, Any], index: int) -> dict[str, Any]:
    rng = random.Random(1000 + index * 7919)
    service = spec["service"]
    root_cause = spec["root_cause"]
    demo = bool(spec.get("demo"))
    order: list[str] = list(spec["useful_order"])
    step_names = ["check_database", "check_recent_deployments", "check_redis", "check_metrics"]

    steps: list[dict[str, Any]] = []
    for i, action in enumerate(order, start=1):
        tel = build_telemetry(root_cause, random.Random(1000 + index * 7919 + i))
        if action in tel:
            ev = tel[action]
            healthy = ev["status"] == "healthy"
        else:
            ev = {"status": "informational", "evidence": {"note": "no anomaly detected"}}
            healthy = True
        steps.append(
            {
                "order": i,
                "action": action,
                "result": "healthy" if healthy else "anomaly_detected",
                "useful": not healthy,
            }
        )

    successful = [s["action"] for s in steps if s["useful"]]
    failed = [s["action"] for s in steps if not s["useful"]]

    dep_age = None
    telemetry = build_telemetry(root_cause, rng)
    if telemetry["check_recent_deployments"]["evidence"].get("last_deploy_age_minutes"):
        dep_age = telemetry["check_recent_deployments"]["evidence"]["last_deploy_age_minutes"]

    return {
        "incident_id": spec["incident_id"],
        "tier": spec["tier"],
        "timestamp": f"2026-0{(index % 8) + 1}-{(index % 27) + 1:02d}T{(index * 7) % 24:02d}:{(index * 13) % 60:02d}:00Z",
        "service": service,
        "environment": "production",
        "severity": spec["severity"],
        "symptoms": spec["symptoms"],
        "metrics": build_metrics(root_cause, service, rng, demo=demo),
        "logs": build_logs(root_cause, service, rng),
        "recent_deployment": (
            {
                "id": f"rel-{1000 + index}",
                "age_minutes": dep_age,
                "author": "platform-team",
                "summary": "dependency bump + config change",
            }
            if dep_age is not None
            else {"id": None, "age_minutes": None, "author": None, "summary": "no deploy in last 24h"}
        ),
        "initial_hypotheses": list(INITIAL_HYPOTHESES),
        "investigation_steps": steps,
        "root_cause": root_cause,
        "resolution": spec["resolution"],
        "failed_steps": failed,
        "successful_steps": successful,
        "engineer_correction": spec.get("correction"),
        "time_to_resolution": spec["ttr"],
        "lesson": LESSONS[root_cause],
        # Pre-tool evidence shows service_dependencies only. Infra tiers are
        # DISCOVERED by investigating (or recalled from memory), because
        # naming the cache tier in the alert payload hands the agent the
        # answer: the live baseline started with check_redis on every
        # checkout-api incident until this was fixed.
        "service_dependencies": _split(service)[0],
        "infra_dependencies": _split(service)[1],
        # raw, incident-scoped telemetry used by the tools
        "telemetry": telemetry,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in OUT_DIR.glob("*.json"):
        f.unlink()

    written = []
    for i, spec in enumerate(CATALOGUE):
        inc = build_incident(spec, i)
        path = OUT_DIR / f"{inc['incident_id']}.json"
        path.write_text(json.dumps(inc, indent=2) + "\n", encoding="utf-8")
        written.append(inc)

    tier1_checkout = [i for i in written if i["tier"] == "tier1" and i["service"] == "checkout-api"]
    assert not tier1_checkout, "Tier 1 must contain no checkout-api incident"

    for i in written:
        if i["service"] == "checkout-api" and i["tier"] in ("demo", "replay", "eval") and i["root_cause"] == "redis_connection_exhaustion":
            joined = " ".join(i["symptoms"]).lower()
            assert "redis" not in joined, f"{i['incident_id']} symptoms leak the answer: {i['symptoms']}"
            assert "cache" not in joined, f"{i['incident_id']} symptoms leak the answer: {i['symptoms']}"

    counts: dict[str, int] = {}
    for i in written:
        counts[i["tier"]] = counts.get(i["tier"], 0) + 1
    print(f"wrote {len(written)} incidents to {OUT_DIR}")
    print("by tier:", counts)
    print("by root cause:", {rc: sum(1 for i in written if i['root_cause'] == rc) for rc in ROOT_CAUSES})


if __name__ == "__main__":
    main()
