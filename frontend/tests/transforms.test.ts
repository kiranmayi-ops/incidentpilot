import { describe, expect, it } from "vitest";
import {
  dashboardStats,
  efficiencyFromEvolution,
  learnedOverview,
  pathToStepsLabel,
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