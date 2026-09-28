import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";

const incidents = [
  {
    incident_id: "INC-2001",
    tier: "demo",
    timestamp: "session",
    service: "checkout-api",
    environment: "prod",
    severity: "SEV1",
    status: "detected",
    symptoms: ["checkout latency increased"],
    metrics: { db_connection_utilization: 0.79 },
    root_cause: null,
    resolution: null,
    lesson: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const incBody = (url: string | URL | Request) => {
  const p = String(url);
  if (p.endsWith("/health")) {
    return { status: "ok", database: {}, hindsight: { status: "ok" }, demo_mode: false, version: "0.1.0" };
  }
  if (p.endsWith("/incidents")) return { total: 1, items: incidents };
  if (p.endsWith("/learning/strategy")) {
    return {
      strategy: [
        {
          step: "check_redis",
          priority: 1,
          reason: "recalled memory",
          first_choice_count: 1,
          engineer_confirmations: 1,
          low_yield_count: 0,
        },
      ],
      why: { totals: {} },
      computed_from: "investigation_runs in PostgreSQL",
    };
  }
  if (p.endsWith("/learning/evolution")) {
    return {
      items: [
        {
          incident_id: "INC-2001",
          kind: "memory",
          path: ["check_redis", "check_database"],
          first_step: "check_redis",
          feedback_kind: null,
          retained: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
  }
  return {};
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) =>
      Promise.resolve(
        new Response(JSON.stringify(incBody(url)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
});

describe("DashboardPage", () => {
  it("renders counts derived from the mocked API responses", async () => {
    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Incident dashboard" })).toBeInTheDocument();

    // dashboard stat cards derived from the incident list (one incident -> total 1)
    expect((await screen.findAllByText("Incidents")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(await screen.findByText("Active (unresolved)")).toBeInTheDocument();
    expect(await screen.findByText("Resolved")).toBeInTheDocument();

    // learned pattern row derived from /learning/strategy
    expect((await screen.findAllByText("check_redis")).length).toBeGreaterThan(0);

    // checkout-api service row derived from the incident list
    expect(await screen.findByRole("heading", { name: "Services" })).toBeInTheDocument();
  });

  it("shows a real Hindsight status from /health", async () => {
    render(<DashboardPage />);
    await screen.findByRole("heading", { name: "Incident dashboard" });
    const oks = await screen.findAllByText("ok");
    expect(oks.length).toBeGreaterThan(0);
    expect(await screen.findByText("Hindsight")).toBeInTheDocument();
  });
});