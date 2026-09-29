"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EngineAPI } from "../lib/api";

/* ---------- Inline icon set (24x24, 1.75 stroke, lucide-inspired) ---------- */

function NavIcon({ kind }: { kind: string }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (kind) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="6" height="6" rx="1.25" />
          <rect x="13.5" y="4.5" width="6" height="6" rx="1.25" />
          <rect x="4.5" y="13.5" width="6" height="6" rx="1.25" />
          <rect x="13.5" y="13.5" width="6" height="6" rx="1.25" />
        </svg>
      );
    case "incidents":
      return (
        <svg {...common}>
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="7" cy="6" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="11" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "compare":
      return (
        <svg {...common}>
          <line x1="12.5" y1="3" x2="12.5" y2="21" />
          <path d="M5 7h5v14H5z" />
          <path d="M14 4h5v14h-5z" />
        </svg>
      );
    case "learning":
      return (
        <svg {...common}>
          <polyline points="3 17 9.5 10.5 13 14 20 7" />
          <polyline points="15 7 20 7 20 12" />
        </svg>
      );
    default:
      return null;
  }
}

function ToggleIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 5l7 7-7 7" />
    </svg>
  );
}

/* ---------- Configuration ---------- */

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/#incidents", label: "Incidents", icon: "incidents" },
  { href: "/compare", label: "Baseline vs Memory", icon: "compare" },
  { href: "/learning", label: "Learning Evolution", icon: "learning" },
];

function isActive(item: NavItem, pathname: string, hash: string): boolean {
  if (item.href === "/") return pathname === "/" && hash !== "#incidents";
  if (item.href === "/#incidents")
    return pathname.startsWith("/incidents") || (pathname === "/" && hash === "#incidents");
  if (item.href === "/compare") return pathname.startsWith("/compare");
  if (item.href === "/learning") return pathname.startsWith("/learning");
  return pathname === item.href;
}

/* ---------- Live system status ---------- */

function useHealth() {
  const [state, setState] = useState<{ status: string | null; demo: boolean }>({
    status: null,
    demo: false,
  });
  useEffect(() => {
    let active = true;
    EngineAPI.health()
      .then((h) => {
        if (!active) return;
        setState({ status: h.status, demo: Boolean(h.demo_mode) });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "unreachable", demo: false });
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/* ---------- Shell ---------- */

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const health = useHealth();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 900;
  });
  const [hash, setHash] = useState<string>("");

  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    try {
      window.localStorage?.setItem("ip.sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      /* private mode: persistence is best-effort */
    }
  }, [collapsed]);

  const dotClass =
    health.status === null
      ? ""
      : health.status === "ok"
        ? "ok"
        : health.status === "degraded"
          ? "warn"
          : "bad";

  const statusLabel =
    health.status === null
      ? "Checking system…"
      : health.status === "ok"
        ? "System online"
        : health.status === "degraded"
          ? "System degraded"
          : "Backend unreachable";

  const statusSub =
    health.status === null ? "" : health.demo ? "Demo · Live pipeline" : "Live pipeline";

  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-top">
          <Link href="/" className="brand" aria-label="IncidentPilot home">
            <div className="brand-mark">IR</div>
            <div className="brand-text">
              <div className="brand-name">IncidentPilot</div>
              <div className="brand-tag">SRE Investigation</div>
            </div>
          </Link>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            <span className={`toggle-ic${collapsed ? " flip" : ""}`}>
              <ToggleIcon />
            </span>
          </button>
        </div>

        <div className="sidebar-divider" />

        <nav className="nav-main" aria-label="Main navigation">
          {NAV.map((item) => {
            const active = isActive(item, pathname, hash);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-link${active ? " active" : ""}`}
                aria-label={item.label}
                data-tip={item.label}
                aria-current={active ? "page" : undefined}
              >
                <NavIcon kind={item.icon} />
                <span className="nav-label-text">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="status-pill" title={statusLabel}>
            <span className={`status-dot ${dotClass}`} />
            <div className="status-text">
              <div className="status-label">{statusLabel}</div>
              {statusSub && <div className="status-sub">{statusSub}</div>}
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}