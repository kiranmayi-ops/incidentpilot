import type { ReactNode } from "react";
import Link from "next/link";
import { fmtShortDate } from "@/lib/transforms";

/* ============================================================
   IncidentPilot — Mission Deck component library (v2)
   Commander-console furniture: hero, pipeline stepper, gauges,
   verdict banners, filter bars, tone-coded stats, VS panels.
   ============================================================ */

/* ---------- Icon primitives ---------- */

export function Icon({
  kind,
  size = 16,
}: {
  kind:
    | "memory"
    | "evidence"
    | "check"
    | "x"
    | "arrow"
    | "investigate"
    | "shield"
    | "activity"
    | "sparkles"
    | "search"
    | "bolt"
    | "user";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (kind) {
    case "memory":
      return (
        <svg {...common}>
          <path d="M8 1.5c-3.5 0-6 2.5-6 6 0 2.2 1.2 4.2 3 5.3V14.5c0 .6.4 1 1 1h4c.6 0 1-.4 1-1v-1.7c1.8-1.1 3-3.1 3-5.3 0-3.5-2.5-6-6-6z" />
          <path d="M6 14.5h4" />
        </svg>
      );
    case "evidence":
      return (
        <svg {...common}>
          <ellipse cx="8" cy="4.5" rx="5.5" ry="2.5" />
          <path d="M2.5 4.5v7c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5v-7" />
          <path d="M2.5 8c0 1.38 2.46 2.5 5.5 2.5S13.5 9.38 13.5 8" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M3 8.5l3.2 3.2L13 4.5" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M2 8h11M9 4l4 4-4 4" />
        </svg>
      );
    case "investigate":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M8 1.5L2.5 4v4.5c0 3.5 2.5 6.5 5.5 7.5 3-1 5.5-4 5.5-7.5V4L8 1.5z" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <polyline points="1.5 8 4.5 8 7 3 10 13 12.5 8 14.5 8" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="M8 1.5l1.2 3.8 3.8 1.2-3.8 1.2L8 11.5l-1.2-3.8L3 6.5l3.8-1.2L8 1.5z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="M8.5 1.5L3.5 9h3.5l-.5 5.5L11.5 7H8l.5-5.5z" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 14c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
        </svg>
      );
    default:
      return null;
  }
}

/* ---------- Hero (page-opening banner with headline stats) ---------- */

export function Hero({
  eyebrow,
  title,
  highlight,
  sub,
  stats,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** trailing portion of the title rendered with the gold→cyan gradient */
  highlight?: ReactNode;
  sub?: ReactNode;
  stats?: Array<{ value: ReactNode; label: ReactNode; tone?: "gold" | "cyan" }>;
  actions?: ReactNode;
}) {
  return (
    <div className="hero">
      <div className="hero-head">
        <div>
          {eyebrow && (
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {eyebrow}
            </div>
          )}
          <h1 className="hero-title">
            {title}
            {highlight && <span className="grad"> {highlight}</span>}
          </h1>
          {sub && <p className="hero-sub">{sub}</p>}
        </div>
        {actions && <div className="hero-cta">{actions}</div>}
      </div>
      {stats && stats.length > 0 && (
        <div className="hero-stats">
          {stats.map((s, i) => (
            <div className="hero-stat" key={i}>
              <div className={`hero-stat-num${s.tone ? ` ${s.tone}` : ""}`}>{s.value}</div>
              <div className="hero-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Pipeline (the 5-step product story, horizontal stepper) ------ */

const PIPELINE_STEPS: Array<{
  name: string;
  sub: string;
  tone?: "memory" | "evidence";
}> = [
  { name: "Incident Occurs", sub: "Symptoms + telemetry" },
  { name: "Investigation", sub: "Strategy execution", tone: "evidence" },
  { name: "Engineer Feedback", sub: "Accept / reject / correct" },
  { name: "Hindsight Memory", sub: "Experience retained", tone: "memory" },
  { name: "Future Strategy Shift", sub: "Next recall adapts" },
];

export function Pipeline() {
  return (
    <div className="pipeline" aria-label="How IncidentPilot learns">
      {PIPELINE_STEPS.map((s, i) => (
        <span key={s.name} style={{ display: "contents" }}>
          {i > 0 && (
            <span className="pipeline-arrow" aria-hidden>
              <Icon kind="arrow" size={14} />
            </span>
          )}
          <div className={`pipeline-step${s.tone ? ` ${s.tone}` : ""}`}>
            <span className="pipeline-dot">{i + 1}</span>
            <span>
              <div className="pipeline-name">{s.name}</div>
              <div className="pipeline-sub">{s.sub}</div>
            </span>
          </div>
        </span>
      ))}
    </div>
  );
}

/* Legacy alias — pages previously imported StoryBanner */
export function StoryBanner() {
  return <Pipeline />;
}

/* ---------- Gauge ring metric ---------- */

export function Gauge({
  pct,
  label,
  tone = "neutral",
}: {
  /** 0–100 */
  pct: number;
  label: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    tone === "bad"
      ? "var(--red)"
      : tone === "warn"
        ? "var(--amber)"
        : tone === "ok"
          ? "var(--green)"
          : "var(--accent)";
  return (
    <div className="gauge" role="img" aria-label={`${label}: ${clamped}%`}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle className="gauge-track" cx="42" cy="42" r={R} fill="none" strokeWidth="7" />
        <circle
          className="gauge-fill"
          cx="42"
          cy="42"
          r={R}
          fill="none"
          strokeWidth="7"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C - (clamped / 100) * C}
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-value" style={{ color }}>
          {clamped}%
        </div>
        <div className="gauge-label" title={label}>
          {label}
        </div>
      </div>
    </div>
  );
}

/* ---------- Metric card (gauge or text) ---------- */

export function Metric({
  label,
  value,
  tone,
  pct,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
  /** when set, renders a gauge ring at this 0–100 percentage */
  pct?: number;
}) {
  if (pct !== undefined) {
    return (
      <div className="metric-card">
        <Gauge pct={pct} label={label} tone={tone ?? "neutral"} />
      </div>
    );
  }
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ""}`} style={{ padding: "12px 14px" }}>
      <div className="stat-label" style={{ fontSize: 10.5 }}>
        {label}
      </div>
      <div className="stat-value" style={{ fontSize: 19, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

/* ---------- Filter bar ---------- */

export function FilterBar({
  query,
  onQuery,
  placeholder = "Search service, symptom, or ID…",
  children,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="filter-bar">
      <div className="filter-input">
        <span className="filter-ic">
          <Icon kind="search" size={14} />
        </span>
        <input
          className="input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Filter incidents"
        />
      </div>
      {children}
    </div>
  );
}

export function FilterChip({
  on,
  count,
  onClick,
  children,
}: {
  on: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`filter-chip${on ? " on" : ""}`} onClick={onClick}>
      {children}
      {count !== undefined && <span className="cnt">{count}</span>}
    </button>
  );
}

/* ---------- Verdict banner (compare outcome) ---------- */

export function Verdict({
  changed,
  before,
  after,
}: {
  changed: boolean;
  before?: string | null;
  after?: string | null;
}) {
  return (
    <div className={`verdict${changed ? "" : " changed-neutral"}`}>
      <div className="verdict-icon">
        <Icon kind={changed ? "bolt" : "shield"} size={22} />
      </div>
      <div>
        <div className="verdict-title">
          {changed
            ? "Memory changed the first move"
            : "No strategy change for this incident"}
        </div>
        <p className="verdict-sub">
          {changed ? (
            <>
              Baseline opened at <span className="mono">{before}</span> — the memory-informed
              agent opened at <span className="mono">{after}</span>. Hindsight recalled prior
              engineer corrections for this symptom pattern.
            </>
          ) : (
            <>
              Both runs opened with <span className="mono">{before ?? "—"}</span>. Run the
              scripted replay on the dashboard, then select INC-2001 to see the shift live.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ---------- Context tags ---------- */

export function ContextTag({ kind }: { kind: "now" | "memory" }) {
  return (
    <span className={`context-tag ${kind}`}>
      <span className="context-tag-dot" />
      {kind === "memory" ? "Long-term memory" : "Current evidence"}
    </span>
  );
}

/* ---------- Badges ---------- */

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "ghost";

export function Badge({
  tone = "neutral",
  children,
  dot,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function tierBadge(tier: string): string {
  switch (tier) {
    case "tier1":
      return "Tier 1 Catalog";
    case "eval":
      return "Tier 2 · Eval";
    case "replay":
      return "Scripted";
    case "demo":
      return "Demo";
    default:
      return tier;
  }
}

export function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const tone: BadgeTone =
    tier === "tier1" || tier === "demo" ? "info" : tier === "replay" ? "neutral" : "warning";
  return <Badge tone={tone}>{tierBadge(tier)}</Badge>;
}

export function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  const label = severity.toUpperCase();
  const sevKey = severity.toLowerCase().replace(/[^a-z0-9]/g, "");
  return <span className={`badge sev-${sevKey}`}>{label}</span>;
}

const STATUS_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "warning" },
  detected: { label: "Detected", tone: "warning" },
  investigating: { label: "Investigating", tone: "info" },
  feedback: { label: "Awaiting feedback", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  resolved: { label: "Resolved", tone: "success" },
};

export function StatusBadge({ status, dot }: { status?: string; dot?: boolean }) {
  if (!status) return null;
  const m = STATUS_MAP[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return (
    <Badge tone={m.tone} dot={dot ?? (status !== "completed" && status !== "resolved")}>
      {m.label}
    </Badge>
  );
}

/* ---------- Incident list item ---------- */

export function IncidentListItem({
  id,
  service,
  severity,
  status,
  symptoms,
  environment,
  tier,
  timestamp,
  agentActivity,
}: {
  id: string;
  service: string;
  severity: string;
  status: string;
  symptoms: string[];
  environment: string;
  tier: string;
  timestamp: string;
  agentActivity?: {
    first_step: string | null;
    feedback_kind: string | null;
    retained: boolean;
  };
}) {
  const mainSymptom = symptoms[0] ?? `${service} incident`;
  const extraCount = symptoms.length > 1 ? symptoms.length - 1 : 0;

  return (
    <Link href={`/incidents/${id}`} className="incident-item">
      <div className="incident-item-main">
        <div className="incident-item-title">
          {mainSymptom}
          {extraCount > 0 && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>
              +{extraCount} more
            </span>
          )}
        </div>
        <div className="incident-item-meta">
          <span className="mono" style={{ fontWeight: 650, color: "var(--text)" }}>
            {service}
          </span>
          <span className="meta-sep">·</span>
          <SeverityBadge severity={severity} />
          <span className="meta-sep">·</span>
          <StatusBadge status={status} />
          <span className="meta-sep">·</span>
          <span className="mono" style={{ fontSize: 11.5 }}>
            {id}
          </span>
          <span className="meta-sep">·</span>
          <span>{environment}</span>
          <span className="meta-sep">·</span>
          <span>{fmtShortDate(timestamp)}</span>
        </div>
      </div>

      <div className="incident-item-activity">
        {agentActivity && agentActivity.first_step ? (
          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <span className="chip highlight">
              <span className="n">1</span>
              {agentActivity.first_step}
            </span>
            {agentActivity.feedback_kind === "accept" && <Badge tone="success">accepted</Badge>}
            {agentActivity.feedback_kind === "reject" && <Badge tone="danger">rejected</Badge>}
            {agentActivity.feedback_kind === "correct" && <Badge tone="warning">corrected</Badge>}
            {agentActivity.retained && <Badge tone="info">retained</Badge>}
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            No run yet
          </span>
        )}
        <div className="incident-item-action">
          <span>Inspect</span>
          <Icon kind="arrow" size={14} />
        </div>
      </div>
    </Link>
  );
}

/* ---------- Buttons ---------- */

export function Button({
  variant = "secondary",
  size,
  loading,
  disabled,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "success" | "danger" | "ghost" | "memory-btn";
  size?: "small" | "big";
  loading?: boolean;
}) {
  return (
    <button
      className={`btn ${variant} ${size ? size : ""} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="spin" />}
      {children}
    </button>
  );
}

/* ---------- Stat (tone-coded left edge) ---------- */

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "ok" | "warn" | "bad" | "info";
  hint?: string;
}) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ""}`}>
      <div className="stat-label">
        {tone && <span className={`stat-dot ${tone}`} />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/* ---------- Section ---------- */

export function Section({
  eyebrow,
  title,
  description,
  actions,
  children,
  id,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  const header = eyebrow || title || description || actions;
  return (
    <section className="section" id={id}>
      {header && (
        <div className="section-head">
          <div>
            {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
            <h2 className="section-title">{title}</h2>
            {description && <div className="section-desc">{description}</div>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------- Strategy chips ---------- */

export function StepChips({
  steps,
  highlightFirst = false,
}: {
  steps?: Array<{ step: string; priority?: number } | string>;
  highlightFirst?: boolean;
}) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="chips">
      {steps.map((s, i) => {
        const step = typeof s === "string" ? s : s.step;
        const priority = typeof s === "string" ? i + 1 : s.priority ?? i + 1;
        const cls = highlightFirst && i === 0 ? "chip highlight" : "chip";
        return (
          <span key={`${step}-${i}`} className={cls}>
            <span className="n">{priority}</span>
            {step}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- Distribution bars ---------- */

export function BarList({
  data,
}: {
  data: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <div className="bar-label" title={d.label}>
            {d.label}
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.round((d.count / max) * 100)}%` }}
            />
          </div>
          <div className="bar-count">{d.count}×</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Tool / evidence rendering ---------- */

export function FactRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "ok" | "bad" | "warn";
}) {
  return (
    <div className="tool-fact-row">
      <span className="tool-fact-key">{label}</span>
      <span className={`tool-fact-val ${tone === "bad" ? "bad" : ""}`}>{value}</span>
    </div>
  );
}

export function ToolResultLine({
  tool,
  result,
  verdict,
}: {
  tool: string;
  result?: Record<string, unknown> | null;
  verdict?: string;
}) {
  return (
    <div className="tool-result">
      <div className="row" style={{ gap: 8 }}>
        <span className="mono" style={{ fontWeight: 650 }}>
          {tool}
        </span>
        <Badge
          tone={verdict === "degraded" ? "danger" : verdict === "unknown" ? "warning" : "success"}
          dot
        >
          {verdict ?? "healthy"}
        </Badge>
      </div>
      {result && (
        <div className="mt-8">
          {Object.entries(result).map(([k, v]) => (
            <FactRow key={k} label={k} value={String(v)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Empty / loading / error ---------- */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">
        <Icon kind="evidence" size={30} />
      </div>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>{message}</span>
        {onRetry && (
          <Button size="small" variant="danger" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- Memory card ---------- */

export function MemoryCard({
  title,
  text,
  meta,
}: {
  title?: string;
  text: string;
  meta?: string;
}) {
  return (
    <div className="feature memory-feature">
      {title && (
        <div className="feature-title">
          <Icon kind="memory" size={14} />
          {title}
        </div>
      )}
      <p>{text}</p>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}

/* ---------- Counter-case explanation ---------- */

export function CounterCaseCard() {
  return (
    <div className="notice neutral" style={{ marginBottom: 0 }}>
      <div style={{ width: "100%" }}>
        <div className="notice-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon kind="shield" size={16} />
          Current Evidence Overrides Memory (Counter-case Security)
        </div>
        <p style={{ marginTop: 4 }}>
          Long-term memory is a prior — never an absolute mandate. When live telemetry (e.g. 96%
          DB connection utilization) contradicts past memory (e.g. Redis checks), the
          contradiction gate zeroes the stale historical prior and prioritizes current evidence.
        </p>
      </div>
    </div>
  );
}

/* ---------- Notices ---------- */

export function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "success" | "info" | "warn" | "error" | "neutral";
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`notice ${tone}`}>
      <div>
        {title && <div className="notice-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
