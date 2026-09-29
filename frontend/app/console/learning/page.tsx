"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EngineAPI,
  type Incident,
  type LearningEvolutionItem,
  type LearningStrategy,
} from "@/lib/api";
import {
  beforeAfter,
  dashboardStats,
  efficiencyFromEvolution,
  feedbackLabel,
  feedbackTone,
  firstStepDistribution,
  kindLabel,
  learnedOverview,
  servicePatterns,
  severityKey,
} from "@/lib/transforms";
import { ConsoleShell } from "../../console-shell";
import {
  Bars,
  Button,
  CounterCaseNote,
  Empty,
  Kpi,
  Loading,
  Note,
  Panel,
  Pill,
  StepChips,
  StatusPill,
  TierPill,
} from "../../console-ui";
import { Icon } from "../../lib/icons";

const LOOP = [
  {
    t: "Incident",
    d: "A signal lands in the catalog with symptoms, metrics and a severity.",
    ch: undefined as undefined | "mem" | "evd",
  },
  {
    t: "Recall",
    d: "Long-term memory returns similar past episodes and their lessons.",
    ch: "mem" as const,
  },
  {
    t: "Plan",
    d: "The agent re-ranks the diagnostic ladder, memory first, evidence to confirm.",
    ch: "mem" as const,
  },
  {
    t: "Execute",
    d: "Live tools run and contradict or confirm each recalled prior.",
    ch: "evd" as const,
  },
  {
    t: "Retain",
    d: "Only accepted or corrected experience is written back for next time.",
    ch: "evd" as const,
  },
];

function LearningBody() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [strategy, setStrategy] = useState<LearningStrategy | null>(null);
  const [evolution, setEvolution] = useState<LearningEvolutionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"replay" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inc, strat, evo] = await Promise.all([
        EngineAPI.incidents(),
        EngineAPI.learningStrategy(),
        EngineAPI.learningEvolution(),
      ]);
      setIncidents(inc.items);
      setStrategy(strat);
      setEvolution(evo.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replay = useCallback(async () => {
    setBusy("replay");
    setError(null);
    setNotice(null);
    try {
      const out = await EngineAPI.demoReplay();
      const kept = out.replayed.filter((r) => r.retained).length;
      setNotice({
        tone: out.failures.length ? "bad" : "ok",
        text:
          `Replayed ${out.replayed.length} scripted episodes through the real pipeline — ` +
          `${kept} retained, ${out.replayed.length - kept} deliberately dropped. ` +
          (out.failures.length ? `Failures: ${out.failures.join(", ")}` : "No failures."),
      });
      const [strat, evo] = await Promise.all([
        EngineAPI.learningStrategy(),
        EngineAPI.learningEvolution(),
      ]);
      setStrategy(strat);
      setEvolution(evo.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const stats = useMemo(() => (incidents ? dashboardStats(incidents) : null), [incidents]);
  const eff = useMemo(() => (evolution ? efficiencyFromEvolution(evolution) : null), [evolution]);
  const learn = useMemo(
    () => (strategy ? learnedOverview(strategy, evolution?.length ?? 0) : null),
    [strategy, evolution],
  );
  const distribution = useMemo(
    () => (evolution ? firstStepDistribution(evolution).slice(0, 8) : []),
    [evolution],
  );
  const patterns = useMemo(
    () => (incidents && evolution ? servicePatterns(incidents, evolution).slice(0, 8) : []),
    [incidents, evolution],
  );
  const coveredServices = useMemo(
    () => new Set(patterns.map((p) => p.service)).size,
    [patterns],
  );
  const ba = useMemo(() => (evolution ? beforeAfter(evolution) : null), [evolution]);

  const timeline = useMemo(() => {
    if (!evolution || !incidents) return [];
    const serviceById = new Map(incidents.map((i) => [i.incident_id, i]));
    return [...evolution]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((it) => ({
        ...it,
        service: serviceById.get(it.incident_id)?.service ?? "—",
        severity: serviceById.get(it.incident_id)?.severity ?? "",
      }));
  }, [evolution, incidents]);

  if (error && !incidents) {
    return (
      <>
        <Note tone="bad" title="Could not load the learning data">
          {error}
        </Note>
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" icon="rotate" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  if (!incidents || !strategy || !evolution || !stats || !eff || !learn) return <Loading rows={7} />;

  return (
    <div className="cs-stack">
      <div className="cs-grid-2" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <Kpi
          label="Experience retained"
          value={eff.retention_rate === null ? "—" : `${eff.retention_rate}%`}
          hint={`${eff.retained_runs} of ${eff.completed_runs} completed runs kept`}
          tone="mem"
        />
        <Kpi
          label="Avg checks per run"
          value={eff.avg_steps ?? "—"}
          hint="Deeper plans cost more; memory should shorten them"
          tone="evd"
        />
        <Kpi
          label="Distinct opening moves"
          value={distribution.length}
          hint="The agent has learned more than one first move"
          tone="evd"
        />
        <Kpi
          label="Services with a pattern"
          value={coveredServices}
          hint={`of ${stats.services.length} services in the catalog`}
          tone="warn"
        />
      </div>

      {/* ------------------------------------------------------------- loop */}
      <Panel
        title="The learning loop"
        icon="git-branch"
        meta={
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            every arrow is a real backend call
          </span>
        }
      >
        <div className="cs-loop">
          {LOOP.map((n, i) => (
            <div className="cs-loop-n" key={n.t} data-ch={n.ch}>
              <div className="cs-loop-b">{i + 1}</div>
              <div className="cs-loop-t">{n.t}</div>
              <div className="cs-loop-d">{n.d}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <CounterCaseNote />
        </div>
      </Panel>

      {/* ------------------------------------------------- before / after */}
      <Panel
        title="Where the opening check moved"
        icon="scale"
        meta={
          ba ? (
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {ba.incident_id}
            </span>
          ) : null
        }
      >
        {ba ? (
          <div className="cs-vs">
            <div className="cs-vs-side">
              <div className="cs-vs-head">
                <span>Before · no recall</span>
              </div>
              <div className="cs-vs-body">
                <div className="cs-vs-hero">
                  <div className="l">Opened on</div>
                  <div className="v">{ba.before ?? "—"}</div>
                  <div className="m">from the baseline run in the log</div>
                </div>
              </div>
            </div>
            <div className="cs-vs-mid">
              <span>→</span>
            </div>
            <div className="cs-vs-side mem">
              <div className="cs-vs-head">
                <span>After · memory recalled</span>
              </div>
              <div className="cs-vs-body">
                <div className="cs-vs-hero">
                  <div className="l">Opened on</div>
                  <div className="v">{ba.after ?? "—"}</div>
                  <div className="m">same incident, same tools</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Empty title="No incident has both a baseline and a memory run yet">
            Open an incident from the catalog and run both a baseline and a memory investigation.
          </Empty>
        )}
      </Panel>

      <div className="cs-split">
        <div className="cs-stack">
          {/* ------------------------------------------- learned strategy */}
          <Panel
            title="The strategy memory has produced"
            icon="brain"
            meta={
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                computed from {learn.computed_from}
              </span>
            }
          >
            {learn.strategy.length === 0 ? (
              <Empty title="Nothing learned yet">
                Complete a few investigation runs and this table fills itself from the run log.
              </Empty>
            ) : (
              <div className="cs-table-wrap">
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Check</th>
                      <th>First</th>
                      <th>Confirmed</th>
                      <th>Low yield</th>
                    </tr>
                  </thead>
                  <tbody>
                    {learn.strategy.map((s) => (
                      <tr key={s.step}>
                        <td className="num">
                          <span className="cs-chip mem">
                            <b>{s.priority}</b>
                          </span>
                        </td>
                        <td className="mono">{s.step}</td>
                        <td className="num">{s.first_choice_count}×</td>
                        <td className="num" style={{ color: "var(--ok)" }}>
                          {s.engineer_confirmations}×
                        </td>
                        <td className="num" style={{ color: s.low_yield_count > 0 ? "var(--bad)" : undefined }}>
                          {s.low_yield_count}×
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {learn.strategy[0] && (
              <div className="cs-panel-note">
                <b style={{ color: "var(--text)" }}>Why {learn.strategy[0].step} leads:</b>{" "}
                {learn.strategy[0].reason}
              </div>
            )}
          </Panel>

          {/* ------------------------------------------ per-service patterns */}
          <Panel
            title="Service → learned first move"
            icon="layers"
            meta={
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {patterns.length} patterns
              </span>
            }
            flush
          >
            {patterns.length === 0 ? (
              <Empty title="No per-service patterns yet">Run an investigation on a service to see its opening move recorded here.</Empty>
            ) : (
              <div className="cs-table-wrap">
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Opens on</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns.map((p) => (
                      <tr key={`${p.service}-${p.first_step}`}>
                        <td>
                          <Link href={`/console/incidents?q=${encodeURIComponent(p.service)}`} className="mono">
                            {p.service}
                          </Link>
                        </td>
                        <td>
                          <span className="cs-chip mem">
                            <b>1</b>
                            {p.first_step}
                          </span>
                        </td>
                        <td className="num">{p.count} runs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* ------------------------------------------------ run evolution */}
          <Panel
            title="Run-by-run evolution"
            icon="clock"
            flush
            meta={
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {timeline.length} recorded runs
              </span>
            }
            action={
              <Button
                size="sm"
                variant="memory"
                icon="play"
                loading={busy === "replay"}
                disabled={busy !== null}
                onClick={() => void replay()}
              >
                Replay history
              </Button>
            }
          >
            {timeline.length === 0 ? (
              <Empty title="No runs recorded yet">
                Run an investigation, or press Replay history to push the scripted episodes through
                the real pipeline.
              </Empty>
            ) : (
              <div className="cs-table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>Incident</th>
                      <th>Mode</th>
                      <th>Path</th>
                      <th>Verdict</th>
                      <th>Kept</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...timeline].reverse().map((it) => (
                      <tr key={`${it.incident_id}-${it.kind}-${it.created_at}`}>
                        <td>
                          <Link href={`/console/incidents/${it.incident_id}`} className="mono">
                            {it.incident_id}
                          </Link>
                          <div style={{ fontSize: 11, color: "var(--text-4)" }}>
                            {it.service} · {severityKey(it.severity || "SEV-3")}
                          </div>
                        </td>
                        <td>
                          <Pill tone={it.kind === "baseline" ? "neutral" : "info"}>{kindLabel(it.kind)}</Pill>
                        </td>
                        <td>
                          <StepChips steps={it.path} highlightFirst />
                        </td>
                        <td>
                          {it.feedback_kind ? (
                            <Pill tone={feedbackTone(it.feedback_kind) ?? "neutral"}>
                              {feedbackLabel(it.feedback_kind)}
                            </Pill>
                          ) : (
                            <span style={{ color: "var(--text-4)" }}>—</span>
                          )}
                        </td>
                        <td>
                          {it.retained ? (
                            <Pill tone="mem" dot>
                              retained
                            </Pill>
                          ) : (
                            <Pill tone="bad">dropped</Pill>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {notice && (
              <div className="cs-panel-note">
                <Note tone={notice.tone}>{notice.text}</Note>
              </div>
            )}
            {error && (
              <div className="cs-panel-note">
                <Note tone="bad" title="Replay failed">
                  {error}
                </Note>
              </div>
            )}
          </Panel>
        </div>

        <div className="cs-stack">
          {/* ------------------------------------------ first-step distribution */}
          <Panel title="First-check distribution" icon="trend">
            {distribution.length > 0 ? (
              <>
                <Bars data={distribution} memoryFirst />
                <div className="cs-panel-note">
                  A wide spread means the agent is not blindly repeating one move — it is routing by
                  service and symptom.
                </div>
              </>
            ) : (
              <Empty title="No distribution yet">Complete a run to populate this chart.</Empty>
            )}
          </Panel>

          {/* --------------------------------------------- guardrail summary */}
          <Panel title="What guards the loop" icon="shield">
            <div className="cs-kv">
              <div className="cs-kv-row">
                <span>Rejected runs kept in memory</span>
                <b style={{ color: "var(--bad)" }}>never</b>
              </div>
              <div className="cs-kv-row">
                <span>Corrections stored as written</span>
                <b>yes</b>
              </div>
              <div className="cs-kv-row">
                <span>Recall outranks live evidence</span>
                <b style={{ color: "var(--bad)" }}>never</b>
              </div>
              <div className="cs-kv-row">
                <span>Retention rate</span>
                <b>{eff.retention_rate === null ? "—" : `${eff.retention_rate}%`}</b>
              </div>
              <div className="cs-kv-row">
                <span>Source of truth</span>
                <b style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>PostgreSQL run log</b>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <Note tone="warn" title="Rejected experience is the point">
                If a bad diagnosis were written to memory, the next investigation would inherit it.
                Rejections exist to prune the memory, not to decorate the chart.
              </Note>
            </div>
          </Panel>

          {/* ------------------------------------------------- catalog tail */}
          <Panel title="Everything in the catalog" icon="inbox" flush>
            <div className="cs-panel-body flush">
              {incidents.slice(0, 6).map((i) => (
                <Link
                  key={i.incident_id}
                  href={`/console/incidents/${i.incident_id}`}
                  className="cs-evidence-row"
                  style={{ textDecoration: "none" }}
                >
                  <span className="mono" style={{ color: "var(--text-2)" }}>
                    {i.incident_id} · {i.service}
                  </span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <StatusPill status={i.status} />
                    <TierPill tier={i.tier} />
                    <Icon name="chevron-right" size={13} />
                  </span>
                </Link>
              ))}
              {incidents.length > 6 && (
                <div className="cs-panel-note">
                  <Link href="/console/incidents" style={{ color: "var(--brand)" }}>
                    Open the full catalog ({incidents.length})
                  </Link>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default function LearningPage() {
  return (
    <ConsoleShell
      title="Learning evolution"
      lede="How every run teaches the next one — the plan it chose, the engineer verdict it got, and whether it was worth keeping."
    >
      <LearningBody />
    </ConsoleShell>
  );
}
