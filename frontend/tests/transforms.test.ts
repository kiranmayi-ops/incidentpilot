import { describe, expect, it } from "vitest";
import {
  dashboardStats,
  efficiencyFromEvolution,
  learnedOverview,
  pathToStepsLabel,
  formatMetrics,
  fmtShortDate,
  incidentActivity,
  firstStepDistribution,
  beforeAfter,
  servicePatterns,
  serviceRollups,
  type DashboardStats,
} from "@/lib/transforms";
import type { Incident, LearningEvolutionItem, LearningStrategy } from "@/lib/api";

function inc(id: string, service: string, status: string, severity = "SEV2"): Incident {
  return {
    incident_id: id,
    tier: "tier1",
    timestamp: "2026-01-01T00:00:00Z",
    service,
    environment: "prod",
    severity,
    status,
    symptoms: [],
    metrics: {},
    root_cause: null,
    resolution: null,
    lesson: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("dashboardStats", () => {
  it("counts statuses, resolves and groups services", () => {
    const items = [
      inc("INC-1", "checkout-api", "detected"),
      inc("INC-2", "checkout-api", "resolved"),
      inc("INC-3", "payment-api", "resolved"),
    ];
    const s: DashboardStats = dashboardStats(items);
    expect(s.total).toBe(3);
    expect(s.active).toBe(1);
    expect(s.resolved).toBe(2);
    expect(s.by_status.detected).toBe(1);
    expect(s.services).toHaveLength(2);
    expect(s.services[0].service).toBe("checkout-api");
    expect(s.services[0].incident_ids).toEqual(["INC-1", "INC-2"]);
  });

  it("reports the most frequent severity", () => {
    const items = [inc("A", "s", "detected", "SEV1"), inc("B", "s", "detected", "SEV1")];
    expect(dashboardStats(items).top_severity).toBe("SEV1");
  });
});

function evo(incident_id: string, path: string[], retained: boolean): LearningEvolutionItem {
  return {
    incident_id,
    kind: "memory",
    path,
    first_step: path[0] ?? null,
    feedback_kind: "accept",
    retained,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("efficiencyFromEvolution", () => {
  it("derives retention, average steps and first-step counts", () => {
    const e = efficiencyFromEvolution([
      evo("INC-1", ["check_database", "check_redis"], true),
      evo("INC-2", ["check_redis", "check_database", "query_logs"], true),
      evo("INC-3", ["check_database"], false),
    ]);
    expect(e.completed_runs).toBe(3);
    expect(e.retained_runs).toBe(2);
    expect(e.retention_rate).toBe(67);
    expect(e.avg_steps).toBe(2);
    expect(e.first_step_counts).toEqual({ check_database: 2, check_redis: 1 });
  });

  it("returns nulls for an empty history", () => {
    const e = efficiencyFromEvolution([]);
    expect(e.completed_runs).toBe(0);
    expect(e.retention_rate).toBeNull();
    expect(e.avg_steps).toBeNull();
  });
});

const strategy: LearningStrategy = {
  strategy: [
    {
      step: "check_redis",
      priority: 1,
      reason: "recalled memory",
      first_choice_count: 2,
      engineer_confirmations: 1,
      low_yield_count: 0,
    },
  ],
  why: { totals: { completed_runs: 2, retained_runs: 1, engineer_confirmations: 1 } },
  computed_from: "investigation_runs in PostgreSQL",
};

describe("learnedOverview", () => {
  it("names the top pattern and carries the honest computed_from", () => {
    const o = learnedOverview(strategy, 2);
    expect(o.top_pattern).toBe("check_redis (2× first)");
    expect(o.total_runs).toBe(2);
    expect(o.computed_from).toContain("PostgreSQL");
  });

  it("handles an empty strategy honestly", () => {
    const o = learnedOverview({ strategy: [], why: {}, computed_from: "x" }, 0);
    expect(o.top_pattern).toBeNull();
  });
});

describe("pathToStepsLabel", () => {
  it("labels each run kind", () => {
    expect(pathToStepsLabel("baseline")).toBe("baseline plan");
    expect(pathToStepsLabel("memory")).toBe("memory plan");
    expect(pathToStepsLabel("live")).toBe("live plan");
    expect(pathToStepsLabel("replay")).toBe("scripted feedback");
  });
});

describe("formatMetrics", () => {
  it("labels, formats and tones known metrics from incident payloads", () => {
    const views = formatMetrics({
      latency_p99_ms: 1625,
      error_rate_pct: 4.25,
      throughput_rps: 1467,
      db_connection_utilization: 0.9,
      memory_utilization: 0.62,
      queue_depth: 91,
      replicas_restarted_last_1h: 0,
    });
    const byKey = Object.fromEntries(views.map((v) => [v.key, v]));
    expect(byKey["latency_p99_ms"].value).toBe("1625 ms");
    expect(byKey["latency_p99_ms"].tone).toBe("bad");
    expect(byKey["error_rate_pct"].value).toBe("4%");
    expect(byKey["error_rate_pct"].tone).toBe("warn");
    expect(byKey["db_connection_utilization"].value).toBe("90%");
    expect(byKey["db_connection_utilization"].tone).toBe("bad");
    expect(byKey["memory_utilization"].value).toBe("62%");
    expect(byKey["memory_utilization"].tone).toBeUndefined();
    expect(byKey["replicas_restarted_last_1h"].tone).toBeUndefined();
  });

  it("ignores unknown metrics and handles non-numeric values", () => {
    const views = formatMetrics({ mystery_field: 12, flag: "on" });
    expect(views).toEqual([]);
  });
});

describe("fmtShortDate", () => {
  it("renders dates and passes through opaque strings", () => {
    expect(fmtShortDate("2026-02-02T07:13:00Z")).toBe("2026-02-02");
    expect(fmtShortDate("session")).toBe("session");
    expect(fmtShortDate(null)).toBe("—");
  });
});

const actIncidents = [inc("INC-2001", "checkout-api", "detected"), inc("INC-1001", "payment-api", "resolved")];

describe("incidentActivity", () => {
  it("maps the latest evolution entry per incident", () => {
    const evolution = [
      evo("INC-2001", ["check_redis", "check_database"], true),
      evo("INC-1001", ["check_database"], false),
    ];
    const m = incidentActivity(actIncidents, evolution);
    expect(m.get("INC-2001")).toEqual({
      first_step: "check_redis",
      feedback_kind: "accept",
      retained: true,
    });
    expect(m.get("INC-1001")?.first_step).toBe("check_database");
  });

  it("reports no activity for incidents without runs", () => {
    const m = incidentActivity([inc("INC-9", "s", "open")], []);
    expect(m.get("INC-9")).toEqual({ first_step: null, feedback_kind: null, retained: null });
  });
});

describe("firstStepDistribution", () => {
  it("counts and sorts first steps descending", () => {
    const d = firstStepDistribution([
      evo("A", ["check_redis"], true),
      evo("B", ["check_database"], true),
      evo("C", ["check_redis"], false),
    ]);
    expect(d).toEqual([
      { label: "check_redis", count: 2 },
      { label: "check_database", count: 1 },
    ]);
  });
});

describe("beforeAfter", () => {
  it("finds an incident with both a baseline and a memory run", () => {
    const items = [
      { ...evo("INC-2001", ["check_recent_deployments"], false), kind: "baseline", created_at: "2026-01-01T00:00:00Z" },
      { ...evo("INC-2001", ["check_redis"], true), kind: "memory", created_at: "2026-01-02T00:00:00Z" },
      { ...evo("INC-1001", ["check_database"], true), kind: "live", created_at: "2026-01-03T00:00:00Z" },
    ];
    expect(beforeAfter(items)).toEqual({
      incident_id: "INC-2001",
      before: "check_recent_deployments",
      after: "check_redis",
    });
  });

  it("returns null when no incident has both kinds", () => {
    expect(beforeAfter([{ ...evo("A", ["x"], true), kind: "baseline" }])).toBeNull();
    expect(beforeAfter([])).toBeNull();
  });
});

describe("servicePatterns", () => {
  it("groups first steps by service using the incident catalog", () => {
    const patterns = servicePatterns(actIncidents, [
      evo("INC-1001", ["check_database"], true),
      evo("INC-2001", ["check_redis"], true),
      evo("INC-2001", ["check_redis"], true),
    ]);
    expect(patterns[0]).toEqual({ service: "checkout-api", first_step: "check_redis", count: 2 });
    expect(patterns[1]).toEqual({ service: "payment-api", first_step: "check_database", count: 1 });
  });
});

describe("serviceRollups", () => {
  const incidents = [
    inc("INC-2001", "checkout-api", "feedback", "SEV1"),
    inc("INC-2002", "payments-gw", "resolved", "SEV2"),
  ];

  it("does not treat a baseline run as a learned first check", () => {
    // The baseline opened on deployments; memory opened on Redis. Rolling both up
    // would tie, and the pre-memory control would win the tie by insertion order.
    const [rollup] = serviceRollups(incidents, [
      { ...evo("INC-2001", ["check_recent_deployments"], false), kind: "baseline" },
      { ...evo("INC-2001", ["check_redis"], true), kind: "memory" },
    ]);
    expect(rollup.first_step).toBe("check_redis");
    expect(rollup.first_step_count).toBe(1);
  });

  it("reports null when only baseline runs exist", () => {
    const [rollup] = serviceRollups(incidents, [
      { ...evo("INC-2001", ["check_recent_deployments"], false), kind: "baseline" },
    ]);
    expect(rollup.first_step).toBeNull();
  });

  it("counts the most frequent learned step across incidents", () => {
    const [rollup] = serviceRollups(incidents, [
      { ...evo("INC-2001", ["check_redis"], true), kind: "memory" },
      { ...evo("INC-2001", ["check_redis"], true), kind: "memory" },
      { ...evo("INC-2001", ["check_database"], true), kind: "live" },
    ]);
    expect(rollup.first_step).toBe("check_redis");
    expect(rollup.first_step_count).toBe(2);
  });

  it("orders by worst severity then active count", () => {
    const rollups = serviceRollups(incidents, []);
    expect(rollups.map((r) => r.service)).toEqual(["checkout-api", "payments-gw"]);
    expect(rollups[0].worst).toBe("SEV1");
    expect(rollups[0].active).toBe(1);
    expect(rollups[1].resolved).toBe(1);
  });
});