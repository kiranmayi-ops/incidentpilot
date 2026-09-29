import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { ConsoleShell } from "@/app/console-shell";

const health = {
  status: "ok",
  database: { status: "ok" },
  hindsight: { status: "ok" },
  demo_mode: true,
  version: "0.1.0",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(health), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
  try {
    window.localStorage?.clear();
  } catch {
    /* jsdom may not expose localStorage */
  }
});

describe("ConsoleShell", () => {
  it("renders the rail with every console destination", async () => {
    render(
      <ConsoleShell title="Overview" lede="Live engine state.">
        <div>content</div>
      </ConsoleShell>,
    );

    expect(screen.getByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Incidents/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Baseline vs memory/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Learning evolution/ })).toBeInTheDocument();
  });

  it("marks the active nav item with aria-current", async () => {
    render(
      <ConsoleShell title="Overview" lede="Live engine state.">
        <div>content</div>
      </ConsoleShell>,
    );
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Incidents/ })).not.toHaveAttribute("aria-current");
  });

  it("collapses and expands the rail through the same control", async () => {
    const { container } = render(
      <ConsoleShell title="Overview" lede="Live engine state.">
        <div>content</div>
      </ConsoleShell>,
    );

    expect(container.querySelector(".cs")).toHaveAttribute("data-rail", "full");

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    await waitFor(() => {
      expect(container.querySelector(".cs")).toHaveAttribute("data-rail", "mini");
    });
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    await waitFor(() => {
      expect(container.querySelector(".cs")).toHaveAttribute("data-rail", "full");
    });
  });

  it("shows the real health label from /health", async () => {
    render(
      <ConsoleShell title="Overview" lede="Live engine state.">
        <div>content</div>
      </ConsoleShell>,
    );
    expect(await screen.findByText("All systems nominal")).toBeInTheDocument();
  });

  it("reports a degraded engine instead of pretending everything is fine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              detail: { ...health, status: "degraded", hindsight: { status: "unconfigured" } },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );

    render(
      <ConsoleShell title="Overview" lede="Live engine state.">
        <div>content</div>
      </ConsoleShell>,
    );
    expect(await screen.findByText("Running degraded")).toBeInTheDocument();
  });
});
