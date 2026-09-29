"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EngineAPI,
  type Incident,
  type InvestigateResponse,
  type MemoryPanel,
  type RunSummary,
  type StepResult,
  type Timeline,
} from "@/lib/api";
import {
  fmtRelative,
  fmtShortDate,
  formatMetrics,
  kindLabel,
  runProgress,
  severityKey,
} from "@/lib/transforms";
import { ConsoleShell } from "../../../console-shell";
import {
  Button,
  ChannelPill,
  CounterCaseNote,
  Empty,
  FeedbackPill,
  Gauge,
  Loading,
  Note,
  Panel,
  Pill,
  RunTag,
  SeverityPill,
  StatusPill,
  StepChips,
  TierPill,
} from "../../../console-ui";
import { Icon } from "../../../lib/icons";

type RunKind = "baseline" | "memory" | "live";
type Action =
  | { kind: "run"; runKind: RunKind }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "correct" }
  | { kind: "resolve" }
  | null;

const RUN_KINDS: Array<{ kind: RunKind; label: string; icon: "flask" | "brain" | "cpu"; help: string }> = [
  {
    kind: "baseline",
    label: "Run baseline",
    icon: "flask",
    help: "Memory recall is switched off. This is the cold-start plan.",
  },
  {
    kind: "memory",
    label: "Run with memory",
    icon: "brain",
    help: "Recall runs first, then the plan is re-ranked against live evidence.",
  },
  {
    kind: "live",
    label: "Run live LLM",
    icon: "cpu",
    help: "Uses the configured LLM when present, otherwise the deterministic fallback.",
  },
];

const MARKER: Record<string, "ok" | "bad" | "warn" | "neutral"> = {
  healthy: "ok",
  degraded: "bad",
  unknown: "warn",
};

function confidence(c: number | null | undefined): string | null {
  if (c == null) return null;
  return `${Math.round(c * 100)}% confidence`;
}

/** Flatten a tool's evidence/records into scannable key → value rows. */
function evidenceRows(step: StepResult): Array<{ key: string; value: string; tone?: "ok" | "warn" | "bad" }> {
  const out: Array<{ key: string; value: string; tone?: "ok" | "warn" | "bad" }> = [];

  for (const [k, v] of Object.entries(step.evidence ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out.push({ key: k, value: String(v) });
  }

  for (const rec of step.records ?? []) {
    if (rec === null || typeof rec !== "object") continue;
    for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
      if (v === null || v === undefined || typeof v === "object") continue;
      out.push({ key: k, value: String(v) });
    }
  }

  return out.slice(0, 10);
}

function candidateRows(candidate: Record<string, unknown> | null): Array<{ k: string; v: string }> {
  if (!candidate) return [];
  return Object.entries(candidate)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => ({ k, v: String(v) }));
}

function Workspace() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [memory, setMemory] = useState<MemoryPanel | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "warn" | "info"; text: string } | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [correctText, setCorrectText] = useState("");
  const [resolution, setResolution] = useState("");

  useEffect(() => {
    let active = true;
    setIncident(null);
    setTimeline(null);
    setMemory(null);
    setRuns(null);
    setNotice(null);
    setError(null);

    (async () => {
      try {
        const inc = await EngineAPI.incident(id);
        if (!active) return;
        setIncident(inc);
        // The timeline endpoint 404s until a run exists — that is a real state,
        // not a failure, so these settle independently.
        const [tl, mem, rs] = await Promise.allSettled([
          EngineAPI.incidentTimeline(id),
          EngineAPI.memory(id),
          EngineAPI.incidentRuns(id),
        ]);
        if (!active) return;
        setTimeline(tl.status === "fulfilled" ? tl.value : null);
        setMemory(mem.status === "fulfilled" ? mem.value : null);
        setRuns(rs.status === "fulfilled" ? rs.value : null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  const reloadRun = useCallback(async () => {
    const [tl, rs] = await Promise.all([
      EngineAPI.incidentTimeline(id).catch(() => null),
      EngineAPI.incidentRuns(id).catch(() => null),
    ]);
    setTimeline(tl);
    setRuns(rs);
  }, [id]);

  const run = useCallback(
    async (kind: RunKind) => {
      setAction({ kind: "run", runKind: kind });
      setNotice(null);
      setError(null);
      try {
        const out: InvestigateResponse = await EngineAPI.investigate(id, kind);
        const done = out.steps.length;
        setNotice({
          tone: out.recall.memory_ready ? "info" : "warn",
          text:
            `Run #${out.run_id} (${kindLabel(out.kind).toLowerCase()}) planned ${out.strategy.length} checks ` +
            `and executed ${done}. Recall returned ${out.recall.count} memories` +
            (out.recall.memory_ready ? "." : ` — ${out.recall.note ?? "memory unavailable"}.`),
        });
        setTimeline({ run: runFromInvestigate(out), steps: out.steps, feedback: [] });
        setRuns(await EngineAPI.incidentRuns(id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAction(null);
      }
    },
    [id],
  );

  const applyFeedback = useCallback(
    async (kind: "accept" | "reject" | "correct") => {
      if (!timeline) return;
      setAction({ kind });
      setNotice(null);
      setError(null);
      try {
        const out = await EngineAPI.feedback(
          id,
          kind,
          kind === "correct" ? correctText.trim() || undefined : undefined,
          timeline.run.id,
        );
        setNotice({
          tone: out.retained ? "ok" : "warn",
          text: out.retained
            ? `Accepted and retained in long-term memory${out.retained_at ? ` at ${fmtShortDate(out.retained_at)}` : ""}. The next incident on this service starts from this experience.`
            : `Not retained.${out.reason ? ` ${out.reason}` : ""} Run #${out.run_id} is ${out.status}.`,
        });
        setCorrectText("");
        setTimeline(await EngineAPI.runTimeline(timeline.run.id));
        setRuns(await EngineAPI.incidentRuns(id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAction(null);
      }
    },
    [id, timeline, correctText],
  );

  const resolve = useCallback(async () => {
    const text = resolution.trim();
    if (!text) return;
    setAction({ kind: "resolve" });
    setNotice(null);
    setError(null);
    try {
      const out = await EngineAPI.resolve(id, text);
      setNotice({
        tone: "ok",
        text: `Incident resolved. Run #${out.run_id} is ${out.status} and was ${out.retained ? "retained as experience" : "not retained"}.`,
      });
      setResolution("");
      setIncident(await EngineAPI.incident(id));
      await reloadRun();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAction(null);
    }
  }, [id, resolution, reloadRun]);

  const progress = useMemo(
    () => runProgress(timeline?.run.strategy ?? [], timeline?.steps ?? []),
    [timeline],
  );
  const metrics = useMemo(
    () => (incident ? formatMetrics(incident.metrics) : []),
    [incident],
  );
  const candidate = useMemo(
    () => timeline?.run.root_cause_candidate ?? null,
    [timeline],
  );

  if (error && !incident) {
    return (
      <>
        <Note tone="bad" title={`Could not load ${id}`}>
          {error}
        </Note>
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <Link href="/console/incidents" className="cs-btn cs-btn-ghost">
            <Icon name="chevron-left" size={14} />
            Back to catalog
          </Link>
        </div>
      </>
    );
  }

  if (!incident) return <Loading rows={7} />;

  const runId = timeline?.run.id;
  const isBusy = action !== null;

  return (
    <div className="cs-stack">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/console/incidents" className="cs-btn cs-btn-sm cs-btn-ghost">
          <Icon name="chevron-left" size={13} />
          Catalog
        </Link>
        <SeverityPill severity={incident.severity} />
        <StatusPill status={incident.status} />
        <TierPill tier={incident.tier} />
        <Pill>{incident.environment}</Pill>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-4)" }}>
          observed {fmtShortDate(incident.timestamp)} · created {fmtRelative(incident.created_at)}
        </span>
      </div>

      {error && (
        <Note tone="bad" title="Request failed">
          {error}
        </Note>
      )}
      {notice && (
        <Note tone={notice.tone === "bad" ? "bad" : notice.tone === "ok" ? "ok" : notice.tone === "warn" ? "warn" : "info"}>
          {notice.text}
        </Note>
      )}

      <div className="cs-split">
        <div className="cs-stack">
          {/* ------------------------------------------------ symptom header */}
          <Panel
            title={incident.symptoms[0] ?? `${incident.service} incident`}
            icon="pulse"
            meta={
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {incident.incident_id} · {incident.service}
              </span>
            }
          >
            <div className="cs-stack-sm">
              {incident.symptoms.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {incident.symptoms.slice(1).map((s) => (
                    <Pill key={s}>{s}</Pill>
                  ))}
                </div>
              )}

              {metrics.length > 0 && (
                <>
                  <div className="cs-label">Signal at detection</div>
                  <div className="cs-grid-3">
                    {metrics.map((m) => (
                      <div
                        key={m.key}
                        className="cs-metric"
                        style={
                          m.tone
                            ? { borderColor: `var(--${m.tone}-line)`, background: `var(--${m.tone}-soft)` }
                            : undefined
                        }
                      >
                        <Gauge
                          pct={m.tone === "bad" || m.tone === "warn" ? 100 : 40}
                          label={m.label}
                          tone={m.tone ?? "evd"}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div className="cs-metric-l">{m.label}</div>
                          <div
                            className="cs-metric-v"
                            style={
                              m.tone ? { color: `var(--${m.tone})` } : undefined
                            }
                          >
                            {m.value}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="cs-label">What we ultimately know</div>
              <div className="cs-kv">
                <div className="cs-kv-row">
                  <span>Root cause</span>
                  <b style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                    {incident.root_cause ?? "not established yet"}
                  </b>
                </div>
                <div className="cs-kv-row">
                  <span>Resolution</span>
                  <b style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>
                    {incident.resolution ?? "not applied yet"}
                  </b>
                </div>
                {incident.lesson && (
                  <div className="cs-kv-row">
                    <span>Lesson retained</span>
                    <b style={{ fontFamily: "var(--font-sans)", fontWeight: 500, textAlign: "right", maxWidth: "60ch" }}>
                      {incident.lesson}
                    </b>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          {/* --------------------------------------------------- run triggers */}
          <Panel
            title="Run an investigation"
            icon="play"
            meta={
              timeline ? (
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <RunTag run={timeline.run} />
                </span>
              ) : (
                <Pill>no run yet</Pill>
              )
            }
          >
            <div className="cs-stack-sm">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {RUN_KINDS.map((k) => (
                  <Button
                    key={k.kind}
                    variant={k.kind === "memory" ? "memory" : k.kind === "live" ? "primary" : "ghost"}
                    icon={k.icon}
                    loading={action?.kind === "run" && action.runKind === k.kind}
                    disabled={isBusy}
                    onClick={() => void run(k.kind)}
                  >
                    {k.label}
                  </Button>
                ))}
              </div>
              <div className="cs-kv">
                {RUN_KINDS.map((k) => (
                  <div className="cs-kv-row" key={k.kind}>
                    <span>{k.label}</span>
                    <b style={{ fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: 12, textAlign: "right", maxWidth: "48ch" }}>
                      {k.help}
                    </b>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>
                All three paths hit the same backend: recall, strategy, tool execution and run
                persistence. Nothing is pre-baked. Running baseline after a memory run is how you
                watch the opening check change.
              </p>
            </div>
          </Panel>

          {/* ------------------------------------------------- execution stream */}
          <Panel
            title="Execution timeline"
            icon="terminal"
            flush
            action={
              timeline ? (
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                  {progress.executed}/{progress.planned} checks · {progress.pct}%
                </span>
              ) : null
            }
          >
            {!timeline ? (
              <Empty title="No investigation run yet">
                Pick a run above — the timeline, the evidence and the memory recall all come from the
                real run record.
              </Empty>
            ) : timeline.steps.length === 0 ? (
              <Empty title="This run produced no step results">The plan was recorded but no tool executed.</Empty>
            ) : (
              <div className="cs-stream" style={{ padding: "16px 16px 16px 42px" }}>
                {timeline.steps.map((s) => {
                  const mark = MARKER[s.result_status ?? ""] ?? "neutral";
                  return (
                    <div className="cs-stream-item" key={s.id}>
                      <span className={`cs-stream-mark ${mark}`}>{s.order}</span>
                      <div className="cs-stream-t">
                        <span className="mono">{s.tool}</span>
                        {s.result_status && (
                          <Pill tone={mark === "ok" ? "ok" : mark === "bad" ? "bad" : mark === "warn" ? "warn" : "neutral"}>
                            {s.result_status}
                          </Pill>
                        )}
                        {s.confidence != null && <Pill>{Math.round(s.confidence * 100)}% conf</Pill>}
                        {s.useful === true && <Pill tone="ok">useful</Pill>}
                        {s.useful === false && <Pill tone="bad">not useful</Pill>}
                        <span style={{ fontSize: 11.5, color: "var(--text-4)", marginLeft: "auto" }}>
                          {fmtRelative(s.created_at)}
                        </span>
                      </div>
                      {s.hypothesis && <div className="cs-stream-b">{s.hypothesis}</div>}
                      {s.reason && (
                        <div className="cs-stream-m">
                          why: {s.reason}
                          {confidence(s.confidence) ? ` · ${confidence(s.confidence)}` : ""}
                        </div>
                      )}
                      {evidenceRows(s).length > 0 && (
                        <div className="cs-evidence">
                          {evidenceRows(s).map((r) => (
                            <div className="cs-evidence-row" key={`${s.id}-${r.key}`} data-tone={r.tone}>
                              <span>{r.key}</span>
                              <b>{r.value}</b>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* ------------------------------------------- plan, verdict, review */}
          {timeline && (
            <Panel title="Plan, diagnosis and review" icon="target">
              <div className="cs-stack-sm">
                <div>
                  <div className="cs-label">Planned strategy</div>
                  <StepChips steps={timeline.run.strategy} highlightFirst />
                </div>

                {timeline.run.memory_summary && (
                  <div>
                    <div className="cs-label">Memory summary fed into the plan</div>
                    <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
                      {timeline.run.memory_summary}
                    </p>
                  </div>
                )}

                {candidateRows(candidate).length > 0 && (
                  <div>
                    <div className="cs-label">Root-cause candidate</div>
                    <div className="cs-evidence">
                      {candidateRows(candidate).map((r) => (
                        <div className="cs-evidence-row" key={r.k}>
                          <span>{r.k}</span>
                          <b>{r.v}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {timeline.run.feedback_kind && (
                  <div>
                    <div className="cs-label">Engineer verdict</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <FeedbackPill kind={timeline.run.feedback_kind} />
                      {timeline.run.feedback_text && (
                        <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                          “{timeline.run.feedback_text}”
                        </span>
                      )}
                      {timeline.run.retained_at && (
                        <Pill tone="mem" dot>
                          retained {fmtRelative(timeline.run.retained_at)}
                        </Pill>
                      )}
                    </div>
                  </div>
                )}

                {timeline.feedback.length > 0 && (
                  <div className="cs-evidence">
                    {timeline.feedback.map((f) => (
                      <div className="cs-evidence-row" key={f.id}>
                        <span>
                          {f.kind} · {fmtRelative(f.created_at)}
                        </span>
                        <b style={{ fontFamily: "var(--font-sans)", fontWeight: 500, whiteSpace: "normal", textAlign: "right" }}>
                          {f.text ?? "—"}
                        </b>
                      </div>
                    ))}
                  </div>
                )}

                <div className="cs-label">Give feedback on this run</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    variant="ok"
                    icon="check"
                    disabled={isBusy}
                    loading={action?.kind === "accept"}
                    onClick={() => void applyFeedback("accept")}
                  >
                    Accept — it was right
                  </Button>
                  <Button
                    variant="bad"
                    icon="x-circle"
                    disabled={isBusy}
                    loading={action?.kind === "reject"}
                    onClick={() => void applyFeedback("reject")}
                  >
                    Reject — wrong
                  </Button>
                </div>

                <div className="cs-field">
                  <label htmlFor="correction">Or correct it in your own words</label>
                  <textarea
                    id="correction"
                    className="cs-textarea"
                    value={correctText}
                    placeholder="e.g. It was the Redis connection pool, not Postgres — drain the pool first."
                    onChange={(e) => setCorrectText(e.target.value)}
                  />
                  <div>
                    <Button
                      variant="primary"
                      icon="sparkles"
                      disabled={isBusy || correctText.trim().length === 0}
                      loading={action?.kind === "correct"}
                      onClick={() => void applyFeedback("correct")}
                    >
                      Submit correction
                    </Button>
                  </div>
                </div>

                <Note tone="mem" title="Why a correction counts more than an acceptance">
                  An acceptance confirms the existing prior. A correction writes a new one — the
                  lesson stored is your text, so the next investigation on this service starts from
                  what you actually said.
                </Note>
              </div>
            </Panel>
          )}
        </div>

        {/* ------------------------------------------------------------ rail */}
        <div className="cs-stack">
          <Panel title="Long-term memory" icon="brain">
            {!memory ? (
              <Empty title="Recall unavailable">The memory service did not answer for this incident.</Empty>
            ) : (
              <div className="cs-stack-sm">
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <ChannelPill channel="memory" />
                  <Pill tone={memory.recalled_count > 0 ? "mem" : "neutral"}>
                    {memory.recalled_count} recalled
                  </Pill>
                  {!memory.ready && <Pill tone="warn">not ready</Pill>}
                </div>

                <div>
                  <div className="cs-label">Recall query</div>
                  <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>{memory.query}</p>
                </div>

                {memory.incident_ids.length > 0 && (
                  <div>
                    <div className="cs-label">Recalled from</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {memory.incident_ids.map((mid) => (
                        <Link key={mid} href={`/console/incidents/${mid}`}>
                          <Pill tone="mem">{mid}</Pill>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {memory.memories.length > 0 ? (
                  <div className="cs-stack-sm">
                    {memory.memories.slice(0, 4).map((m) => (
                      <div className="cs-evidence" key={m.memory_id}>
                        <div className="cs-evidence-row">
                          <span className="mono">{m.memory_id}</span>
                          <b>{m.incident_ids.join(", ") || "catalog"}</b>
                        </div>
                        <div
                          className="cs-evidence-row"
                          style={{ alignItems: "flex-start" }}
                        >
                          <span
                            style={{
                              whiteSpace: "normal",
                              color: "var(--text-2)",
                              fontFamily: "var(--font-sans)",
                              lineHeight: 1.55,
                            }}
                          >
                            {m.text}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="Nothing recalled yet">
                    Run an investigation with memory, or seed the bank from the overview page.
                  </Empty>
                )}

                {memory.lessons.length > 0 && (
                  <div>
                    <div className="cs-label">Lessons behind those memories</div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                      {memory.lessons.slice(0, 4).map((l) => (
                        <li key={l} style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Resolve this incident" icon="check-circle">
            <div className="cs-stack-sm">
              <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
                Applying a resolution closes the open run and, when the diagnosis held, retains the
                experience so the next incident on {incident.service} starts ahead.
              </p>
              <div className="cs-field">
                <label htmlFor="resolution">Resolution</label>
                <input
                  id="resolution"
                  className="cs-input"
                  value={resolution}
                  placeholder={incident.resolution ?? "e.g. drain_redis_pool"}
                  onChange={(e) => setResolution(e.target.value)}
                />
              </div>
              <div>
                <Button
                  variant="ok"
                  icon="check"
                  disabled={isBusy || resolution.trim().length === 0}
                  loading={action?.kind === "resolve"}
                  onClick={() => void resolve()}
                >
                  Mark resolved
                </Button>
              </div>
            </div>
          </Panel>

          {runs && runs.length > 0 && (
            <Panel title={`Run history (${runs.length})`} icon="clock" flush>
              <div className="cs-panel-body flush">
                {runs.map((r) => (
                  <div
                    key={r.id}
                    className="cs-evidence-row"
                    style={{
                      borderBottom: "1px solid var(--line-soft)",
                      background: r.id === runId ? "var(--memory-soft)" : undefined,
                    }}
                  >
                    <span className="mono" style={{ flex: "none" }}>
                      #{r.id} {kindLabel(r.kind)}
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <StatusPill status={r.status} />
                      <FeedbackPill kind={r.feedback_kind} />
                      <span style={{ fontSize: 11, color: "var(--text-4)" }}>{fmtRelative(r.created_at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <CounterCaseNote />

          <Panel title="Cross-links" icon="layers">
            <div className="cs-stack-sm">
              <Link href={`/console/compare?incident=${encodeURIComponent(incident.incident_id)}`} className="cs-btn cs-btn-sm cs-btn-ghost">
                <Icon name="scale" size={13} />
                Compare baseline vs memory
              </Link>
              <Link href="/console/learning" className="cs-btn cs-btn-sm cs-btn-ghost">
                <Icon name="trend" size={13} />
                See the learning evolution
              </Link>
              <Link href={`/console/incidents?q=${encodeURIComponent(incident.service)}`} className="cs-btn cs-btn-sm cs-btn-ghost">
                <Icon name="pulse" size={13} />
                Other {incident.service} incidents
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Build a RunSummary-shaped record from an investigate response. */
function runFromInvestigate(out: InvestigateResponse): RunSummary {
  return {
    id: out.run_id,
    incident_id: out.incident_id,
    kind: out.kind,
    status: out.status,
    engine: null,
    used_fallback: out.used_fallback,
    llm_model: null,
    recall_query: out.recall.query,
    recalled_count: out.recall.count,
    memory_ready: out.recall.memory_ready,
    strategy: out.strategy,
    memory_summary: out.memory_summary,
    feedback_kind: null,
    feedback_text: null,
    outcome_resolved: null,
    root_cause_candidate: out.root_cause_candidate,
    resolution: null,
    retained_at: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
}

export default function IncidentWorkspacePage() {
  return (
    <ConsoleShell title="Investigation workspace" lede="Recall, plan, execute, and decide what the agent should remember.">
      <Workspace />
    </ConsoleShell>
  );
}
