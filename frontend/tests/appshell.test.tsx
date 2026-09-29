import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

import { AppShell } from "@/app/app-shell";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            database: { status: "ok" },
            hindsight: { status: "ok" },
            demo_mode: true,
            version: "0.1.0",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );
  try {
    window.localStorage?.clear();
  } catch {
    /* jsdom may not expose localStorage */
  }
});

describe("AppShell animated sidebar", () => {
  it("renders expanded on wide viewports with labels and a toggle control", async () => {
    const { container } = render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    await screen.findByText("System online");
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baseline vs Memory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learning Evolution" })).toBeInTheDocument();
    expect(container.firstChild).not.toHaveClass("sidebar-collapsed");

    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses to an icon-only rail and expands back through the same control", async () => {
    const { container } = render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    await screen.findByText("System online");

    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(container.firstChild).toHaveClass("sidebar-collapsed");
    });
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => {
      expect(container.firstChild).not.toHaveClass("sidebar-collapsed");
    });
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("starts collapsed on narrow viewports so the sidebar never covers content", () => {
    Object.defineProperty(window, "innerWidth", { value: 780, writable: true });
    const { container } = render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(container.firstChild).toHaveClass("sidebar-collapsed");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});