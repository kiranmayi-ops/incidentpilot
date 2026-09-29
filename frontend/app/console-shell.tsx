"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EngineAPI, type Health } from "@/lib/api";
import { engineSummary } from "@/lib/transforms";
import { Icon, type IconName } from "./lib/icons";
import { ThemeToggle } from "./lib/theme";

/* ---------------------------------------------------------------- config -- */

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  section: "Operate" | "Prove";
  match: (path: string) => boolean;
}

const NAV: NavItem[] = [
  {
    href: "/console",
    label: "Overview",
    icon: "compass",
    section: "Operate",
    match: (p) => p === "/console",
  },
  {
    href: "/console/incidents",
    label: "Incidents",
    icon: "pulse",
    section: "Operate",
    match: (p) => p.startsWith("/console/incidents"),
  },
  {
    href: "/console/compare",
    label: "Baseline vs memory",
    icon: "scale",
    section: "Prove",
    match: (p) => p.startsWith("/console/compare"),
  },
  {
    href: "/console/learning",
    label: "Learning evolution",
    icon: "trend",
    section: "Prove",
    match: (p) => p.startsWith("/console/learning"),
  },
];

const SECTIONS: NavItem["section"][] = ["Operate", "Prove"];

/* ----------------------------------------------------------------- shell -- */

export function ConsoleShell({
  children,
  title,
  lede,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  lede: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [rail, setRail] = useState<"full" | "mini">("full");
  const [health, setHealth] = useState<Health | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    try {
      setRail(window.localStorage.getItem("ip.console.rail") === "mini" ? "mini" : "full");
    } catch {
      /* persistence is best effort */
    }
  }, []);

  const toggleRail = useCallback(() => {
    setRail((r) => {
      const next = r === "full" ? "mini" : "full";
      try {
        window.localStorage.setItem("ip.console.rail", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    setPending(true);
    EngineAPI.health()
      .then((h) => {
        if (active) setHealth(h);
      })
      .catch(() => {
        if (active) setHealth(null);
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  const engine = useMemo(
    () => engineSummary(health as never),
    [health, pending],
  );

  const isHome = pathname === "/console";

  return (
    <div className="cs" data-rail={rail}>
      <div className="cs-ambient" aria-hidden="true" />

      <aside className="cs-rail" aria-label="Console navigation">
        <div className="cs-rail-head">
          <Link href="/console" className="cs-rail-mark" aria-label="IncidentPilot console home">
            IP
          </Link>
          <span className="cs-rail-name">
            IncidentPilot
            <span>Console</span>
          </span>
        </div>

        <nav className="cs-rail-nav">
          {SECTIONS.map((section) => (
            <div key={section}>
              <div className="cs-rail-section">{section}</div>
              {NAV.filter((n) => n.section === section).map((n) => {
                const active = n.match(pathname);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="cs-nav"
                    aria-current={active ? "page" : undefined}
                    title={n.label}
                  >
                    <Icon name={n.icon} />
                    <span className="cs-nav-label">{n.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="cs-rail-foot">
          <Link href="/" className="cs-rail-btn" title="Back to the website">
            <Icon name="chevron-left" />
            <span className="cs-rail-foot-text">Website</span>
          </Link>
          <button
            type="button"
            className="cs-rail-btn"
            onClick={toggleRail}
            aria-label={rail === "full" ? "Collapse navigation" : "Expand navigation"}
          >
            <Icon name="panel-left" />
            <span className="cs-rail-foot-text">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="cs-main">
        <div className="cs-topbar">
          <div className="cs-crumbs">
            <Link href="/" className="cs-crumbs" style={{ color: "inherit" }}>
              IncidentPilot
            </Link>
            <Icon name="chevron-right" />
            <b>{title}</b>
          </div>
          <div className="cs-topbar-right">
            <span
              className="cs-health"
              data-state={pending ? "pending" : engine.state}
              title={`${engine.label} · memory ${engine.memory} · db ${engine.database} · v${engine.version}`}
            >
              <span className="cs-health-dot" />
              {pending ? "Connecting…" : engine.label}
            </span>
            <ThemeToggle />
          </div>
        </div>

        <div className="cs-page">
          <div className="cs-head">
            <div>
              <h1>{title}</h1>
              <p>{lede}</p>
            </div>
            {actions && <div className="cs-head-actions">{actions}</div>}
          </div>
          {children}
        </div>
      </div>

      {isHome && null}
    </div>
  );
}
