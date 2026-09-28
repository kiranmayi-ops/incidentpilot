"use client";

import type { ReactNode } from "react";
import type { StrategyStep, Incident, StepResult, RecalledMemory } from "@/lib/api";

export function StepChips({ steps }: { steps: StrategyStep[] }) {
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <span key={`${s.step}-${i}`} className={`step-chip${i === 0 ? " first" : ""}`}>
          {i + 1}. {s.step}
        </span>
      ))}
    </div>
  );
}

export function tierBadge(tier: string): string {
  if (tier === "tier1") return "badge tier1";
  return "badge tier_demo";
}

export function IncidentRow({ inc }: { inc: Incident }) {
  return (
    <tr>
      <td>
        <a
          href={`/incidents/${inc.incident_id}`}
          className="mono"
          style={{ color: "var(--accent)" }}
        >
          {inc.incident_id}
        </a>
      </td>
      <td>
        <span className={tierBadge(inc.tier)}>{inc.tier}</span>
      </td>
      <td>{inc.service}</td>
      <td>
        <span className={`badge ${inc.status}`}>{inc.status}</span>
      </td>
      <td className="muted small">{inc.timestamp}</td>
    </tr>
  );
}

export function ToolResultLine({ step }: { step: StepResult }) {
  const cls =
    step.result_status === "degraded"
      ? "step-degraded"
      : step.result_status === "healthy"
        ? "step-healthy"
        : "step-informational";
  return (
    <div className="tool-result">
      <span className="mono">
        {step.order}. {step.tool}
      </span>{" "}
      <span className={cls}>{step.result_status ?? "pending"}</span>
      {step.hypothesis ? <div className="muted small">{step.hypothesis}</div> : null}
      {Object.keys(step.evidence ?? {}).length > 0 ? (
        <div className="mono small muted">
          {Object.entries(step.evidence)
            .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
            .join("  ")}
        </div>
      ) : null}
    </div>
  );
}

export function MemoryCard({ mem, idx }: { mem: RecalledMemory; idx: number }) {
  return (
    <div className="card" key={mem.memory_id ?? idx}>
      <div className="small muted">
        memory {mem.memory_id ?? idx + 1}
        {mem.incident_ids?.length ? ` · incidents: ${mem.incident_ids.join(", ")}` : ""}
        {mem.confidence != null ? ` · confidence ${mem.confidence}` : ""}
      </div>
      <div className="small" style={{ marginTop: 4 }}>
        {mem.text}
      </div>
    </div>
  );
}

export function Empty({ title }: { title: string }) {
  return <div className="muted small">{title}</div>;
}

export function Spinner() {
  return <div className="spinner">Loading…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error-box">{message}</div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {children}
    </div>
  );
}