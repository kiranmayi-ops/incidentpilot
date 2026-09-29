// Console UI kit — the presentation layer for the operator workspace.
// Deliberately new class names (.cs-*) and a new visual grammar versus the
// previous marketing-mirror build. All numbers come from API payloads via
// lib/transforms; nothing is hard-coded here.

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Incident, LearningEvolutionItem, RunSummary } from "@/lib/api";
import {
  fmtRelative,
  fmtShortDate,
  incidentActivity,
  kindLabel,
  severityKey,
  severityTone,
  statusLabel,
  statusTone,
  type StatusTone,
} from "@/lib/transforms";
import { Icon, type IconName } from "./lib/icons";

export type Tone = "ok" | "warn" | "bad" | "info" | "mem" | "evd" | "neutral";

/* ---------------------------------------------------------------- button -- */

export function Button({
  variant = "default",
  size,
  icon,
  loading,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "memory" | "ok" | "bad" | "ghost";
  size?: "sm";
  icon?: IconName;
  loading?: boolean;
}) {
  const cls = [
    "cs-btn",
    variant !== "default" ? `cs-btn-${variant}` : "",
    size === "sm" ? "cs-btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} disabled={rest.disabled || loading} {...rest}>
      {loading ? <span className="cs-spin" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- panel -- */

export function Panel({
  title,
  icon,
  meta,
  action,
  flush,
  children,
  note,
}: {
  title: ReactNode;
  icon?: IconName;
  meta?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="cs-panel">
      <div className="cs-panel-head">
        <h2>
          {icon && <Icon name={icon} />}
          {title}
        </h2>
        {action ?? meta}
      </div>
      <div className={flush ? "cs-panel-body flush" : "cs-panel-body"}>{children}</div>
      {note && <div className="cs-panel-note">{note}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------- kpi -- */

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ok" | "warn" | "bad" | "mem" | "evd";
}) {
  return (
    <div className="cs-kpi" data-tone={tone}>
      <div className="cs-kpi-l">{label}</div>
      <div className="cs-kpi-v">{value}</div>
      {hint && <div className="cs-kpi-h">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ pill -- */

export function Pill({
  tone = "neutral",
  children,
  dot,
}: {
  tone?: "ok" | "warn" | "bad" | "info" | "mem" | "evd" | "neutral" | "sev1" | "sev2" | "sev3";
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`cs-pill ${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Tone = statusTone(status);
  return <Pill tone={tone === "neutral" ? "neutral" : tone}>{statusLabel(status)}</Pill>;
}

export function SeverityPill({ severity }: { severity: string }) {
  return <Pill tone={severityTone(severity)}>{severityKey(severity)}</Pill>;
}

export function TierPill({ tier }: { tier: string }) {
  const map: Record<string, { label: string; tone: "info" | "mem" | "neutral" }> = {
    tier1: { label: "Catalog", tone: "info" },
    demo: { label: "Demo", tone: "mem" },
    replay: { label: "Replay", tone: "neutral" },
    eval: { label: "Eval", tone: "neutral" },
  };
  const m = map[tier] ?? { label: tier, tone: "neutral" as const };
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function FeedbackPill({ kind }: { kind: string | null }) {
  if (!kind) return null;
  const map: Record<string, { label: string; tone: StatusTone }> = {
    accept: { label: "Accepted", tone: "ok" },
    reject: { label: "Rejected", tone: "bad" },
    correct: { label: "Corrected", tone: "warn" },
  };
  const m = map[kind];
  if (!m) return <Pill>{kind}</Pill>;
  return <Pill tone={m.tone === "neutral" ? "neutral" : m.tone}>{m.label}</Pill>;
}

export function ChannelPill({ channel }: { channel: "memory" | "evidence" }) {
  return (
    <Pill tone={channel === "memory" ? "mem" : "evd"} dot>
      {channel === "memory" ? "Long-term memory" : "Current evidence"}
    </Pill>
  );
}

/* ------------------------------------------------------------------ chip -- */

export function StepChips({
  steps,
  highlightFirst,
}: {
  steps: Array<{ step: string; priority?: number } | string> | undefined;
  highlightFirst?: boolean;
}) {
  if (!steps || steps.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {steps.map((s, i) => {
        const step = typeof s === "string" ? s : s.step;
        const n = typeof s === "string" ? i + 1 : (s.priority ?? i + 1);
        return (
          <span key={`${step}-${i}`} className={`cs-chip${highlightFirst && i === 0 ? " mem" : ""}`}>
            <b>{n}</b>
            {step}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ note -- */

const NOTE_ICON: Record<string, IconName> = {
  ok: "check-circle",
  warn: "alert",
  bad: "x-circle",
  info: "plug",
  mem: "brain",
  evd: "pulse",
  neutral: "pulse",
};

export function Note({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "info" | "mem" | "evd" | "neutral";
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`cs-note ${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <Icon name={NOTE_ICON[tone] ?? "pulse"} />
      <div>
        {title && <div className="cs-note-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ empty/load -- */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cs-empty">
      <Icon name="inbox" size={26} />
      <b>{title}</b>
      {children && <span>{children}</span>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="cs-load" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="cs-load-row" key={i}>
          <div className="cs-skel" style={{ height: 14 }} />
          <div className="cs-skel" style={{ height: 14 }} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ bars -- */

export function Bars({
  data,
  tone,
  memoryFirst,
}: {
  data: Array<{ label: string; count: number }>;
  tone?: "mem";
  memoryFirst?: boolean;
}) {
  if (data.length === 0) return <Empty title="No samples yet" />;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="cs-bars">
      {data.map((d) => (
        <div
          className="cs-bar"
          data-tone={memoryFirst && d === data[0] ? "mem" : tone}
          key={d.label}
        >
          <span className="cs-bar-l" title={d.label}>
            {d.label}
          </span>
          <span className="cs-bar-t">
            <span
              className="cs-bar-f"
              style={{ width: `${Math.round((d.count / max) * 100)}%` }}
            />
          </span>
          <span className="cs-bar-c">{d.count}×</span>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- gauge -- */

export function Gauge({ pct, label, tone = "evd" }: { pct: number; label: string; tone?: Tone }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const color = `var(--${tone === "neutral" ? "evidence" : tone === "mem" ? "memory" : tone})`;
  return (
    <div className="cs-gauge" role="img" aria-label={`${label}: ${clamped}%`}>
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r={R} fill="none" stroke="var(--panel-3)" strokeWidth="6" />
        <circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C - (clamped / 100) * C}
          style={{ transition: "stroke-dashoffset 0.6s var(--ease)" }}
        />
      </svg>
      <div className="cs-gauge-c">
        <div className="cs-gauge-v" style={{ color }}>
          {clamped}%
        </div>
        <div className="cs-gauge-l">{label}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ incident row */

export function IncidentRow({
  incident,
  activity,
}: {
  incident: Incident;
  activity?: { first_step: string | null; feedback_kind: string | null; retained: boolean | null };
}) {
  const sev = severityKey(incident.severity);
  return (
    <Link href={`/console/incidents/${incident.incident_id}`} className="cs-inc" data-sev={sev}>
      <span className="cs-inc-rail" aria-hidden="true" />
      <div className="cs-inc-main">
        <div className="cs-inc-title">
          {incident.symptoms[0] ?? `${incident.service} incident`}
          {incident.symptoms.length > 1 && (
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-4)" }}>
              +{incident.symptoms.length - 1}
            </span>
          )}
        </div>
        <div className="cs-inc-meta">
          <span className="mono" style={{ color: "var(--text-2)" }}>
            {incident.service}
          </span>
          <em>·</em>
          <span className="mono">{incident.incident_id}</span>
          <em>·</em>
          <span>{incident.environment}</span>
          <em>·</em>
          <span title={incident.timestamp}>{fmtShortDate(incident.timestamp)}</span>
        </div>
      </div>
      <div className="cs-inc-right">
        {activity?.first_step && (
          <span className="cs-chip mem">
            <b>1</b>
            {activity.first_step}
          </span>
        )}
        <FeedbackPill kind={activity?.feedback_kind ?? null} />
        {activity?.retained && <Pill tone="mem">retained</Pill>}
        <SeverityPill severity={incident.severity} />
        <StatusPill status={incident.status} />
        <TierPill tier={incident.tier} />
      </div>
    </Link>
  );
}

export function useIncidentActivity(
  incidents: Incident[] | null,
  evolution: LearningEvolutionItem[] | null,
) {
  if (!incidents || !evolution) return new Map();
  return incidentActivity(incidents, evolution);
}

/* ---------------------------------------------------------------- run tag -- */

export function RunTag({ run }: { run: RunSummary }) {
  return (
    <>
      <Pill tone="info">run #{run.id}</Pill>
      <Pill>{kindLabel(run.kind)}</Pill>
      <StatusPill status={run.status} />
      {run.used_fallback ? (
        <Pill tone="warn" dot>
          fallback
        </Pill>
      ) : run.engine ? (
        <Pill tone="evd" dot>
          live LLM
        </Pill>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- counter -- */

export function CounterCaseNote() {
  return (
    <Note tone="evd" title="Current evidence overrides memory">
      Long-term memory is a prior, never a mandate. When live telemetry contradicts a recalled
      lesson, the contradiction gate discards the stale prior and re-ranks on the current signal.
    </Note>
  );
}

export { fmtRelative };
