import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import LandingPage from "@/app/page";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
});

describe("Marketing landing page", () => {
  it("leads with the product promise", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("wires every Demo CTA to the working console", () => {
    render(<LandingPage />);
    const demos = screen.getAllByRole("link", { name: /demo/i });
    expect(demos.length).toBeGreaterThan(0);
    for (const link of demos) {
      expect(link.getAttribute("href")).toMatch(/^\/console/);
    }
  });

  it("links back to the console from the nav", () => {
    render(<LandingPage />);
    const consoleLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/console");
    expect(consoleLinks.length).toBeGreaterThan(0);
  });
});
