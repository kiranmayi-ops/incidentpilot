"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  EngineAPI,
  type Incident,
  type MemoryPanel,
  type Timeline,
} from "@/lib/api";
import {
  formatMetrics,
  fmtShortDate,
  kindLabel,
} from "@/lib/transforms";
import {
  Badge,
  Button,
  ContextTag,
  Empty,
  ErrorBox,
  FactRow,
  Icon,
  MemoryCard,
  Metric,
  Notice,
  Section,
  SeverityBadge,
  Spinner,
  StatusBadge,
  StepChips,
  TierBadge,
} from "../../components";

const FEEDBACK_META: Record<string, { label: string; tone: "success" | "danger" | "warning" | "info" }> = {
  accept: { label: "Accepted", tone: "success" },
  reject: { label: "Rejected", tone: "danger" },
  correct: { label: "Corrected", tone: "warning" },
};

function stepMarker(status?: string | null): "ok" | "bad" | "warn" | "neutral" {
  if (status === "degraded") return "bad";
  if (status === "unknown") return "warn";
  if (status === "healthy") return "ok";
  return "neutral";
}

function fmtConfidence(c: number | null | undefined): string {
  if (c == null) return "";
  return ` · confidence ${(c * 100).toFixed(0)}%`;
}

export default function IncidentPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [memory, setMemory] = useState<MemoryPanel | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [correctText, setCorrectText] = useState<string>("");
  const [resolution, setResolution] = useState<string>("increase_connection_pool_size");

  const loadDetail = useCallback(async () => {
    setError(null);
    try {
      const inc = await EngineAPI.incident(id);
      setIncident(inc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    EngineAPI.incidentTimeline(id)
      .then(setTimeline)
      .catch(() => setTimeline(null));
    EngineAPI.memory(id)
      .then(setMemory)
      .catch(() => setMemory(null));
  }, [id]);

  useEffect(() => {
    setIncident(null);
    setTimeline(null);
    setMemory(null);
    setError(null);
    void loadDetail();
  }, [loadDetail, id]);

  async function runInvestigation(kind: "baseline" | "memory" | "live") {
    const action = `run:${kind}`;
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      await EngineAPI.investigate(id, kind);
      const tl = await EngineAPI.incidentTimeline(id);
      setTimeline(tl);
      setNotice(
        `${kind === "baseline" ? "Baseline (no memory)" : kind === "memory" ? "Memory-informed" : "Live LLM"} investigation run completed successfully.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function sendFeedback(kind: "accept" | "reject" | "correct") {
    setBusyAction(`fb:${kind}`);
    setError(null);
    setNotice(null);
    try {
      const text = kind === "correct" ? correctText : undefined;
      await EngineAPI.feedback(id, kind, text, timeline?.run.id);
      setNotice(
        `Feedback "${kind}" recorded — ${kind === "reject" ? "run closed without retention" : "retained experience to Hindsight long-term memory"}.`,
      );
      const tl = await EngineAPI.incidentTimeline(id);
      setTimeline(tl);
      void EngineAPI.memory(id).then(setMemory);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function resolveIncident() {
    setBusyAction("resolve");
    setError(null);
    setNotice(null);
    try {
      await EngineAPI.resolve(id, resolution, timeline?.run.id);
      setNotice(`Resolution recorded for run #${timeline?.run.id}.`);
      setTimeline(await EngineAPI.incidentTimeline(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }

  if (!incident)
    return (
      <div>
        <PageHeader id={id} incident={null} />
        {error ? <ErrorBox message={error} onRetry={() => void loadDetail()} /> : <Spinner />}
      </div>
    );

  const active = timeline?.run;
  const steps = timeline?.steps ?? [];
  const canFeedback = active?.status === "feedback";
  const canResolve = active?.status === "feedback" || active?.status === "completed";
  const feedbackMeta = active?.feedback_kind ? FEEDBACK_META[active.feedback_kind] : null;
  const metrics = formatMetrics(incident.metrics ?? {});

  return (
    <div>
      <PageHeader id={id} incident={incident} />

      {error ? <ErrorBox message={error} /> : null}
      {notice ? <Notice tone="success" title={notice} /> : null}

      <div className="detail-grid">
        {/* LEFT COLUMN: CURRENT EVIDENCE & INVESTIGATION TIMELINE */}
        <div>
          {/* ---------- CURRENT EVIDENCE ---------- */}
          <Section
            eyebrow={<ContextTag kind="now" />}
            title="Current Evidence"
            description="Live symptoms, telemetry signals, and environment state reported for this incident right now."
          >
            <div className="card">
              <div className="card-body stack-12">
                <div>
                  <div className="field-label" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>Reported Symptoms</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--text)" }}>
                    {incident.symptoms.map((s) => (
                      <li key={s} style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {metrics.length > 0 && (
                  <div>
                    <div className="field-label" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Telemetry Snapshot</div>
                    <div className="row" style={{ gap: 10 }}>
                      {metrics.map((m) => (
                        <Metric key={m.key} label={m.label} value={m.value} tone={m.tone} />
                      ))}
                    </div>
                  </div>
                )}

                {incident.root_cause && (
                  <div className="feature" style={{ background: "var(--bg-subtle)" }}>
                    <div className="feature-title">Ground-truth root cause</div>
                    <p className="mono" style={{ fontWeight: 650 }}>{incident.root_cause}</p>
                    {incident.lesson && <div className="meta">Lesson: {incident.lesson}</div>}
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* ---------- INVESTIGATION TIMELINE ---------- */}
          <Section
            eyebrow="Agent Execution"
            title="Investigation timeline"
            description="The agent's unfolding investigation plan and tool execution steps."
            actions={
              <div className="row" style={{ gap: 8 }}>
                {(["baseline", "memory", "live"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="small"
                    variant={kind === "memory" ? "memory-btn" : kind === "baseline" ? "secondary" : "ghost"}
                    disabled={busyAction !== null}
                    loading={busyAction === `run:${kind}`}
                    onClick={() => void runInvestigation(kind)}
                  >
                    {kind === "baseline"
                      ? "Run baseline (no memory)"
                      : kind === "memory"
                        ? "Run with memory"
                        : "Run live LLM"}
                  </Button>
                ))}
              </div>
            }
          >
            {active ? (
              <div className="card">
                <div className="card-body">
                  <div className="row" style={{ gap: 8, marginBottom: 20 }}>
                    <Badge tone="info">Run #{active.id}</Badge>
                    <Badge tone="neutral">{kindLabel(active.kind)}</Badge>
                    <StatusBadge status={active.status} />
                    {active.memory_ready && <Badge tone="info" dot>memory ready</Badge>}
                    {active.used_fallback ? (
                      <Badge tone="warning" dot>fallback strategy</Badge>
                    ) : (
                      active.engine && <Badge tone="neutral">live LLM</Badge>
                    )}
                    {active.llm_model && !active.used_fallback && (
                      <span className="muted mono" style={{ fontSize: 11.5 }}>
                        {active.llm_model}
                      </span>
                    )}
                  </div>

                  {active.used_fallback && (
                    <Notice tone="warn" title="Fallback strategy applied">
                      <p>
                        The tool order was generated by memory-driven fallback scoring because the primary LLM provider was unavailable. Results remain empirical.
                      </p>
                    </Notice>
                  )}

                  <div className="timeline">
                    {/* Step 00: Incident Detection */}
                    <div className="timeline-item">
                      <div className="timeline-marker warn">!</div>
                      <div className="timeline-title">Incident detected</div>
                      <div className="timeline-meta">
                        {incident.service} ({incident.environment}) · detection feed ·{" "}
                        {fmtShortDate(incident.created_at)}
                      </div>
                      <div className="timeline-body">
                        {incident.symptoms[0] ?? "Symptom reported"} — the agent drafted a recall
                        query from symptoms and telemetry to plan the investigation.
                      </div>
                    </div>

                    {/* Step 01: Investigation Plan */}
                    <div className="timeline-item">
                      <div className={`timeline-marker ${active.kind === "memory" ? "memory" : "neutral"}`}>01</div>
                      <div className="timeline-title">
                        <span>Investigation plan</span>
                        <Badge tone={active.kind === "memory" ? "info" : "neutral"}>
                          {active.kind === "memory" ? "Memory-informed" : "Baseline top-down"}
                        </Badge>
                      </div>
                      <div className="timeline-meta">
                        Agent selected tool execution sequence based on {active.kind === "memory" ? "recalled Hindsight memories + live evidence" : "generic evidence ranking"}.
                      </div>
                      <div className="timeline-body">
                        <StepChips steps={active.strategy} highlightFirst />
                      </div>
                    </div>

                    {/* Steps 02..N: Tool Execution */}
                    {steps.map((s, i) => {
                      const stepNum = String(i + 2).padStart(2, "0");
                      return (
                        <div className="timeline-item" key={s.id} style={{ animationDelay: `${i * 60}ms` }}>
                          <div className={`timeline-marker ${stepMarker(s.result_status)}`}>
                            {stepNum}
                          </div>
                          <div className="timeline-title">
                            <span className="mono" style={{ fontWeight: 700 }}>{s.tool}</span>
                            <Badge
                              tone={s.result_status === "degraded" ? "danger" : s.result_status === "unknown" ? "warning" : "success"}
                              dot
                            >
                              {s.result_status === "degraded" ? "DEGRADED" : s.result_status === "healthy" ? "HEALTHY" : s.result_status ?? "executed"}
                            </Badge>
                          </div>
                          <div className="timeline-meta">step {s.order}{fmtConfidence(s.confidence)}</div>
                          {s.hypothesis && (
                            <div className="timeline-body" style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                              Hypothesis: {s.hypothesis}
                            </div>
                          )}
                          {Object.keys(s.evidence ?? {}).length > 0 && (
                            <div className="tool-result mt-8">
                              {Object.entries(s.evidence).map(([k, v]) => (
                                <FactRow
                                  key={k}
                                  label={k.replace(/_/g, " ")}
                                  value={String(v)}
                                  tone={s.result_status === "degraded" ? "bad" : undefined}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Step N+1: Root Cause Hypothesis */}
                    {active.root_cause_candidate ? (
                      <div className="timeline-item" style={{ animationDelay: `${steps.length * 60}ms` }}>
                        <div className="timeline-marker warn">!</div>
                        <div className="timeline-title">Root-cause hypothesis proposed</div>
                        <div className="timeline-meta">
                          Layer: <span className="mono">{String(active.root_cause_candidate.layer)}</span>
                          {active.root_cause_candidate.confidence != null
                            ? ` · confidence ${(Number(active.root_cause_candidate.confidence) * 100).toFixed(0)}%`
                            : ""}
                        </div>
                        <div className="timeline-body">
                          <div style={{ fontWeight: 650, color: "var(--text)", fontSize: 13.5 }}>
                            {String(active.root_cause_candidate.root_cause)}
                          </div>
                          {active.root_cause_candidate.resolution != null && (
                            <div className="muted mt-4">
                              Suggested resolution: <span className="mono">{String(active.root_cause_candidate.resolution)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {/* Retained / Feedback Item */}
                    {active.retained_at && (
                      <div className="timeline-item">
                        <div className="timeline-marker ok">✓</div>
                        <div className="timeline-title">Retained to Hindsight long-term memory</div>
                        <div className="timeline-meta">Experience narrative ingested at {active.retained_at}</div>
                      </div>
                    )}

                    {active.feedback_kind && feedbackMeta && (
                      <div className="timeline-item">
                        <div className="timeline-marker ok">★</div>
                        <div className="timeline-title">Engineer feedback: {feedbackMeta.label}</div>
                        {active.feedback_text && <div className="timeline-body">{active.feedback_text}</div>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Empty title="No investigation run yet">
                Select "Run with memory" or "Run baseline" above to launch an investigation.
              </Empty>
            )}
          </Section>

          {/* ---------- ENGINEER FEEDBACK & LEARNING LOOP ---------- */}
          <Section
            eyebrow="Human-in-the-loop"
            title="Engineer feedback & learning"
            description="Your feedback directly teaches Hindsight. Corrections change future investigation strategies."
          >
            {canFeedback ? (
              <div className="card">
                <div className="card-body stack-12">
                  <div className="row" style={{ gap: 10 }}>
                    <Button
                      variant="success"
                      disabled={busyAction !== null}
                      loading={busyAction === "fb:accept"}
                      onClick={() => void sendFeedback("accept")}
                    >
                      Accept &amp; Retain
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busyAction !== null}
                      loading={busyAction === "fb:reject"}
                      onClick={() => void sendFeedback("reject")}
                    >
                      Reject Strategy
                    </Button>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    <label className="field-label" htmlFor="correction">
                      Engineer Correction (Teaches Hindsight)
                    </label>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        id="correction"
                        className="input"
                        style={{ flex: 1, minWidth: 200 }}
                        placeholder="e.g. For checkout-api latency with 5xx, check Redis earlier."
                        value={correctText}
                        onChange={(e) => setCorrectText(e.target.value)}
                      />
                      <Button
                        variant="memory-btn"
                        disabled={busyAction !== null || correctText.trim().length < 3}
                        loading={busyAction === "fb:correct"}
                        onClick={() => void sendFeedback("correct")}
                      >
                        Submit Correction
                      </Button>
                    </div>
                  </div>

                  {/* Visual Learning Loop Ribbon */}
                  <div className="notice info" style={{ marginBottom: 0, marginTop: 4 }}>
                    <div style={{ fontSize: 12.5 }}>
                      <div className="notice-title" style={{ fontSize: 13 }}>Learning Event Loop</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                        <span className="badge warning">Engineer Correction</span>
                        <span>→</span>
                        <span className="badge info">Hindsight Retention</span>
                        <span>→</span>
                        <span className="badge success">Future Strategy Shift</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : active ? (
              <Notice tone="neutral">
                Feedback is available when an investigation run is completed and awaiting review.
              </Notice>
            ) : null}
          </Section>
        </div>

        {/* RIGHT COLUMN: LONG-TERM MEMORY & RESOLUTION */}
        <div>
          {/* ---------- HINDSIGHT LONG-TERM MEMORY ---------- */}
          <Section
            eyebrow={<ContextTag kind="memory" />}
            title="Hindsight Memory"
            description="Historical investigation experience recalled for this symptom pattern."
          >
            {memory ? (
              <div className="stack-12">
                <div className="card" style={{ borderLeft: "3px solid var(--memory-accent)" }}>
                  <div className="card-body stack-8" style={{ padding: "14px 16px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="badge info" style={{ fontWeight: 700 }}>
                        <Icon kind="memory" size={12} />
                        {memory.ready ? "Hindsight Memory Ready" : "Memory Seeding"}
                      </span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--memory-text)" }}>
                        {memory.recalled_count} experiences recalled
                      </span>
                    </div>

                    {memory.query && (
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        <span className="faint" style={{ fontWeight: 600 }}>Recall Query:</span>
                        <div className="mono mt-4" style={{ color: "var(--text)", fontSize: 11.5, wordBreak: "break-word" }}>
                          {memory.query}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {memory.incident_ids.length > 0 && (
                  <div>
                    <div className="faint" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                      Recalled Incident IDs:
                    </div>
                    <div className="chips">
                      {memory.incident_ids.slice(0, 8).map((iid) => (
                        <span key={iid} className="chip highlight">{iid}</span>
                      ))}
                      {memory.incident_ids.length > 8 && (
                        <span className="chip ghost">+{memory.incident_ids.length - 8}</span>
                      )}
                    </div>
                  </div>
                )}

                {memory.memories.length > 0 && (
                  <div className="stack-8">
                    <div className="faint" style={{ fontSize: 12, fontWeight: 600 }}>Recalled Experiences:</div>
                    {memory.memories.slice(0, 3).map((m, i) => (
                      <MemoryCard
                        key={m.memory_id ?? i}
                        title={
                          m.incident_ids.length
                            ? `Historical Incident · ${m.incident_ids.join(", ")}`
                            : `Past Experience ${i + 1}`
                        }
                        text={m.text}
                      />
                    ))}
                  </div>
                )}

                {memory.lessons.length > 0 && (
                  <div className="stack-8">
                    <div className="faint" style={{ fontSize: 12, fontWeight: 600 }}>Replayed Lessons:</div>
                    {memory.lessons.slice(0, 2).map((l, i) => (
                      <MemoryCard key={i} title={`Lesson ${i + 1}`} text={l} />
                    ))}
                  </div>
                )}

                {memory.memories.length === 0 && memory.lessons.length === 0 && (
                  <Empty title="No past memories recalled">
                    No matching history for this symptom pattern. Run tier-1 seed / replay on the dashboard to populate memory.
                  </Empty>
                )}
              </div>
            ) : (
              <Spinner label="Recalling memory..." />
            )}
          </Section>

          {/* ---------- RESOLUTION ---------- */}
          <Section
            eyebrow="Incident Resolution"
            title="Resolution"
            description="Record the fix to close out the run."
          >
            <div className="card">
              <div className="card-body stack-12">
                {active?.resolution ? (
                  <div className="notice success" style={{ marginBottom: 0 }}>
                    <div>
                      <div className="notice-title">Resolved</div>
                      <p className="mono">{active.resolution}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="field-label" htmlFor="resolution">Resolution fix applied</label>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        id="resolution"
                        className="input"
                        style={{ flex: 1, minWidth: 160 }}
                        aria-label="resolution"
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                      />
                      <Button
                        variant="primary"
                        disabled={busyAction !== null || !canResolve || resolution.trim().length < 3}
                        loading={busyAction === "resolve"}
                        onClick={() => void resolveIncident()}
                      >
                        Apply Fix
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function PageHeader({
  id,
  incident,
}: {
  id: string;
  incident: Incident | null;
}) {
  const mainSymptom = incident?.symptoms[0] ?? "Investigation Workspace";
  return (
    <header className="page-header">
      <div className="eyebrow">Investigation Workspace</div>
      <div className="header-row">
        <div>
          <h1>
            <span className="mono" style={{ color: "var(--accent)" }}>{id}</span>
            {incident ? ` · ${mainSymptom}` : ""}
          </h1>
          <p className="lead">
            {incident
              ? `${incident.service} (${incident.environment}) · opened ${fmtShortDate(incident.timestamp)}`
              : "Loading incident workspace…"}
          </p>
        </div>
        <div className="header-actions">
          {incident ? (
            <>
              <SeverityBadge severity={incident.severity} />
              <TierBadge tier={incident.tier} />
              <StatusBadge status={incident.status} />
              <Badge tone="neutral">{incident.service}</Badge>
            </>
          ) : (
            <Badge tone="neutral">…</Badge>
          )}
        </div>
      </div>
    </header>
  );
}