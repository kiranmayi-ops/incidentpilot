import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/console",
  useParams: () => ({ id: "INC-2001" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import OverviewPage from "@/app/console/page";

const incidents = [
  {
    incident_id: "INC-2001",
    tier: "demo",
    timestamp: "2026-01-01T00:00:00Z",
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
    return {
      status: "ok",
      database: { status: "ok" },
      hindsight: { status: "ok" },
      demo_mode: false,
      version: "0.1.0",
    };
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

describe("Console overview", () => {
  it("renders counts derived from the mocked API responses", async () => {
    render(<OverviewPage />);

    expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();

    // One incident in the catalog -> "Incidents tracked" is 1 and the queue shows it.
    expect(await screen.findByText("Incidents tracked")).toBeInTheDocument();
    expect(screen.getByText("Active now")).toBeInTheDocument();
    expect(await screen.findAllByText("1")).not.toHaveLength(0);

    // The learned first check comes from /learning/strategy, not a constant.
    expect(await screen.findAllByText("check_redis")).not.toHaveLength(0);
    expect(await screen.findByText("What the agent learned")).toBeInTheDocument();

    // The service rollup is derived from the incident list.
    expect(await screen.findByText("Services and their learned opening move")).toBeInTheDocument();
    expect((await screen.findAllByText("checkout-api")).length).toBeGreaterThan(0);
  });

  it("shows the real memory status from /health", async () => {
    render(<OverviewPage />);
    expect(await screen.findByText("All systems nominal")).toBeInTheDocument();
    expect(screen.queryByText(/Engine unreachable/)).not.toBeInTheDocument();
  });

  it("stays useful when health reports a reachable but degraded backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request) =>
        Promise.resolve(
          String(url).endsWith("/health")
            ? new Response(
                JSON.stringify({
                  detail: {
                    status: "degraded",
                    database: { status: "ok" },
                    hindsight: { status: "unconfigured" },
                    demo_mode: true,
                    version: "0.1.0",
                  },
                }),
                { status: 503, headers: { "Content-Type": "application/json" } },
              )
            : new Response(JSON.stringify(incBody(url)), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
        ),
      ),
    );

    render(<OverviewPage />);

    expect(await screen.findByText("Running degraded")).toBeInTheDocument();
    // A degraded engine is surfaced, not silently swallowed.
    expect(await screen.findByText("Engine is running degraded")).toBeInTheDocument();
  });
});
