import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/console/incidents",
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

import IncidentsPage from "@/app/console/incidents/page";

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
    metrics: {},
    root_cause: null,
    resolution: null,
    lesson: null,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    incident_id: "INC-2002",
    tier: "tier1",
    timestamp: "2026-01-01T00:00:00Z",
    service: "payments-gw",
    environment: "prod",
    severity: "SEV2",
    status: "resolved",
    symptoms: ["gateway timeouts"],
    metrics: {},
    root_cause: null,
    resolution: "failover",
    lesson: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const body = (url: string | URL | Request) => {
  const p = String(url);
  if (p.endsWith("/health")) {
    return { status: "ok", database: {}, hindsight: { status: "ok" }, demo_mode: false, version: "0.1.0" };
  }
  if (p.includes("/incidents")) return { total: 2, items: incidents };
  if (p.endsWith("/learning/evolution")) return { items: [] };
  return {};
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) =>
      Promise.resolve(
        new Response(JSON.stringify(body(url)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
});

describe("Incident catalog", () => {
  it("lists every incident when no filter is active", async () => {
    render(<IncidentsPage />);

    expect(await screen.findByText("checkout latency increased")).toBeInTheDocument();
    expect(screen.getByText("gateway timeouts")).toBeInTheDocument();
    // No filters are engaged, so no "clear filters" escape hatch should show.
    expect(screen.queryByRole("button", { name: /Clear \d+ filter/ })).not.toBeInTheDocument();
    expect(screen.queryByText("No incidents match these filters")).not.toBeInTheDocument();
  });

  it("narrows to a single service", async () => {
    render(<IncidentsPage />);
    await screen.findByText("checkout latency increased");

    fireEvent.change(screen.getByLabelText("Filter by service"), {
      target: { value: "checkout-api" },
    });

    expect(screen.getByText("checkout latency increased")).toBeInTheDocument();
    expect(screen.queryByText("gateway timeouts")).not.toBeInTheDocument();
  });

  it("narrows by severity through the segmented control", async () => {
    render(<IncidentsPage />);
    await screen.findByText("checkout latency increased");

    fireEvent.click(screen.getByRole("button", { name: /^SEV1/ }));

    expect(screen.getByText("checkout latency increased")).toBeInTheDocument();
    expect(screen.queryByText("gateway timeouts")).not.toBeInTheDocument();
  });

  it("restores every row when the filters are cleared", async () => {
    render(<IncidentsPage />);
    await screen.findByText("checkout latency increased");

    fireEvent.change(screen.getByLabelText("Filter by service"), {
      target: { value: "checkout-api" },
    });
    expect(screen.queryByText("gateway timeouts")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear 1 filter/ }));

    expect(await screen.findByText("gateway timeouts")).toBeInTheDocument();
  });

  it("searches across symptoms and service names", async () => {
    render(<IncidentsPage />);
    await screen.findByText("checkout latency increased");

    fireEvent.change(screen.getByLabelText("Search incidents"), {
      target: { value: "gateway" },
    });

    expect(screen.getByText("gateway timeouts")).toBeInTheDocument();
    expect(screen.queryByText("checkout latency increased")).not.toBeInTheDocument();
  });
});
