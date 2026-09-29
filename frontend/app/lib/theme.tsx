// Theme + scroll-reveal helpers shared by the marketing site and the console.
// Theme is persisted in localStorage and applied to <html data-theme> by the
// bootstrap script in the root layout, so there is never a light flash.

"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try {
        window.localStorage.setItem("ip.theme", next);
      } catch {
        /* private mode — persistence is best effort */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}

export function ThemeToggle({ className = "theme-btn" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={theme === "light" ? "Dark mode" : "Light mode"}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        {theme === "light" ? (
          <path d="M20.5 14.3A8.8 8.8 0 0 1 9.7 3.5 9 9 0 1 0 20.5 14.3z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Reveals `[data-reveal]` children once they scroll into view. */
export function useRevealRoot() {
  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal='in'])"),
    );
    if (nodes.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.setAttribute("data-reveal", "in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-reveal", "in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  });
}
