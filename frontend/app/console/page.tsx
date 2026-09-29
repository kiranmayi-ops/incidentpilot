"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "../console-shell";
import {
  Bars,
  Button,
  CounterCaseNote,
  Empty,
  IncidentRow,
  Kpi,
  Loading,
  Note,
  Panel,
  Pill,
  StepChips,
} from "../console-ui";
import { Icon } from "../lib/icons";
import {
  EngineAPI,
  type Health,
  type Incident,
  type LearningEvolutionItem,
  type LearningStrategy,
} from "@/lib/api";
import {
  bySeverityThenRecency,
  dashboardStats,
  efficiencyFromEvolution,
  engineSummary,
  firstStepDistribution,
  incidentActivity,
  learnedOverview,
  serviceRollups,
  severityKey,
} from "@/lib/transforms";

const normSev = (s: string) => severityKey(s);

type DemoBusy = "reset" | "seed" | "replay" | null;

function DashboardBody() {
  const [health, setHealth] = useState<Health | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [strategy, setStrategy] = useState<LearningStrategy | null>(null);
  const [evolution, setEvolution] = useState<LearningEvolutionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<DemoBusy>(null);
  const [demoMsg, setDemoMsg] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [h, inc, strat, evo] = await Promise.all([
        EngineAPI.health(),
        EngineAPI.incidents(),
        EngineAPI.learningStrategy(),
        EngineAPI.learningEvolution(),
      ]);
      setHealth(h);
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

  async function demoAction(kind: Exclude<DemoBusy, null>) {
    setDemoBusy(kind);
    setDemoMsg(null);
    setError(null);
    try {
      if (kind === "reset") {
        const out = await EngineAPI.demoReset();
        setHealth(await EngineAPI.health());
        setDemoMsg({
          tone: "ok",
          text: `Fresh memory bank "${out.bank_id}" (phase ${out.phase}). Seed tier-1 knowledge, then replay the scripted history to rebuild the story.`,
        });
      } else if (kind === "seed") {
        const out = await EngineAPI.demoSeed();
        const failed = out.failures.length ? ` Failures: ${out.failures.join(", ")}.` : "";
        setDemoMsg({
          tone: out.failures.length ? "bad" : "ok",
          text: `Seeded ${out.seeded.length} tier-1 experiences into long-term memory.${failed}`,
        });
      } else {
        const out = await EngineAPI.demoReplay();
        const kept = out.replayed.filter((r) => r.retained).length;
        const failed = out.failures.length ? ` Failures: ${out.failures.join(", ")}.` : "";
        setDemoMsg({
          tone: out.failures.length ? "bad" : "ok",
          text: `Replayed ${kept}/${out.replayed.length} scripted checkout incidents through the real pipeline — recall, strategy, execution, scripted feedback, retention.${failed}`,
        });
      }
      const [evo, strat] = await Promise.all([
        EngineAPI.learningEvolution(),
        EngineAPI.learningStrategy(),
      ]);
      setEvolution(evo.items);
      setStrategy(strat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoBusy(null);
    }
  }

  const stats = useMemo(() => (incidents ? dashboardStats(incidents) : null), [incidents]);
  const eff = useMemo(() => (evolution ? efficiencyFromEvolution(evolution) : null), [evolution]);
  const learn = useMemo(
    () => (strategy ? learnedOverview(strategy, evolution?.length ?? 0) : null),
    [strategy, evolution],
  );
  const engine = useMemo(() => engineSummary(health as never), [health]);
  const rollups = useMemo(
    () => (incidents ? serviceRollups(incidents, evolution ?? []) : []),
    [incidents, evolution],
  );
  const activity = useMemo(
    () => (incidents && evolution ? incidentActivity(incidents, evolution) : new Map()),
    [incidents, evolution],
  );
  const distribution = useMemo(
    () => (evolution ? firstStepDistribution(evolution).slice(0, 6) : []),
    [evolution],
  );

  const ranked = useMemo(() => (incidents ? bySeverityThenRecency(incidents) : []), [incidents]);
  const sevCounts = useMemo(() => {
    const out: Record<string, number> = { SEV1: 0, SEV2: 0, SEV3: 0 };
    for (const i of incidents ?? []) {
      const k = normSev(i.severity);
      if (k in out) out[k] += 1;
    }
    return out;
  }, [incidents]);

  if (error && !incidents) {
    return (
      <>
        <Note tone="bad" title="Engine unreachable">
          {error}
        </Note>
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" icon="rotate" onClick={() => void load()}>
            Retry connection
          </Button>
        </div>
      </>
    );
  }

  if (!incidents || !stats || !eff || !evolution || !strategy) {
    return <Loading rows={6} />;
  }

  return (
    <div className="cs-stack">
      {engine.state === "degraded" && (
        <Note tone="warn" title="Engine is running degraded">
          Hindsight reports <b>{engine.memory}</b> and the database reports{" "}
          <b>{engine.database}</b>. Recall and retention may be limited until both are healthy.
        </Note>
      )}

      {/* ---------------------------------------------------------- KPI row */}
      <div className="cs-grid-2" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <Kpi
          label="Incidents tracked"
          value={stats.total}
          hint={`${stats.services.length} services · ${rollups.filter((r) => r.active > 0).length} with active incidents`}
          tone="evd"
        />
        <Kpi
          label="Active now"
          value={stats.active}
          hint={`${sevCounts.SEV1} SEV1 · ${sevCounts.SEV2} SEV2 · ${sevCounts.SEV3} SEV3`}
          tone={stats.active > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="Experience retained"
          value={eff.retention_rate === null ? "—" : `${eff.retention_rate}%`}
          hint={`${eff.retained_runs} of ${eff.completed_runs} completed runs written to memory`}
          tone="mem"
        />
        <Kpi
          label="Avg tool calls / run"
          value={eff.avg_steps ?? "—"}
          hint={`Long-term memory ${engine.memory}`}
          tone={engine.memory === "ok" ? "ok" : "warn"}
        />
      </div>

      {/* --------------------------------------------------- main split grid */}
      <div className="cs-split">
        <div className="cs-stack">
          <Panel
            title="On-call queue"
            icon="pulse"
            meta={
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {ranked.length} incidents · worst severity first
              </span>
            }
            flush
            action={
              <Link href="/console/incidents" className="cs-btn cs-btn-sm cs-btn-ghost">
                Open catalog
                <Icon name="arrow-right" size={13} />
              </Link>
            }
          >
            {ranked.length === 0 ? (
              <Empty title="No incidents in the catalog" />
            ) : (
              <div>
                {ranked.slice(0, 8).map((inc) => (
                  <IncidentRow key={inc.incident_id} incident={inc} activity={activity.get(inc.incident_id)} />
                ))}
              </div>
            )}
            {ranked.length > 8 && (
              <div className="cs-panel-note">
                Showing the 8 highest-severity incidents of {ranked.length}.{" "}
                <Link href="/console/incidents" style={{ color: "var(--brand)" }}>
                  View all {ranked.length}
                </Link>
              </div>
            )}
          </Panel>

          <Panel
            title="Services and their learned opening move"
            icon="layers"
            flush
            meta={
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                derived from {eff.completed_runs} runs
              </span>
            }
          >
            {rollups.length === 0 ? (
              <Empty title="No services in the catalog yet" />
            ) : (
              <div className="cs-table-wrap">
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Worst</th>
                      <th>Active</th>
                      <th>Learned first check</th>
                      <th>Environments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollups.map((r) => (
                      <tr key={r.service}>
                        <td>
                          <Link href={`/console/incidents?q=${encodeURIComponent(r.service)}`} className="mono">
                            {r.service}
                          </Link>
                        </td>
                        <td>
                          <Pill tone={r.worst === "SEV1" ? "sev1" : r.worst === "SEV2" ? "sev2" : "sev3"}>
                            {r.worst}
                          </Pill>
                        </td>
                        <td className="num">
                          {r.active}
                          <span style={{ color: "var(--text-4)" }}> / {r.total}</span>
                        </td>
                        <td>
                          {r.first_step ? (
                            <span className="cs-chip mem">
                              <b>1</b>
                              {r.first_step}
                              {r.first_step_count > 1 && <span style={{ opacity: 0.7 }}>·{r.first_step_count}×</span>}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-4)" }}>not yet learned</span>
                          )}
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {r.environments.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="cs-stack">
          <Panel title="What the agent learned" icon="brain">
            {learn && learn.strategy.length > 0 ? (
              <div className="cs-stack-sm">
                <div>
                  <div className="cs-label">Next investigation opens with</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {learn.strategy.slice(0, 3).map((s) => (
                      <span key={s.step} className="cs-chip mem">
                        <b>{s.priority}</b>
                        {s.step}
                      </span>
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                  {learn.strategy[0].reason ?? "No rationale recorded for the current top step."}
                </p>
                <div className="cs-kv">
                  <div className="cs-kv-row">
                    <span>Chosen as first check</span>
                    <b>{learn.strategy[0].first_choice_count}×</b>
                  </div>
                  <div className="cs-kv-row">
                    <span>Confirmed by engineers</span>
                    <b>{learn.strategy[0].engineer_confirmations}×</b>
                  </div>
                  <div className="cs-kv-row">
                    <span>Low-yield runs</span>
                    <b>{learn.strategy[0].low_yield_count}×</b>
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>
                  computed from {learn.computed_from}
                </div>
              </div>
            ) : (
              <Empty title="No completed investigation runs yet">
                Open an incident and run an investigation to seed the learned strategy.
              </Empty>
            )}
          </Panel>

          <Panel title="First-check distribution" icon="trend">
            {distribution.length > 0 ? (
              <Bars data={distribution} memoryFirst />
            ) : (
              <Empty title="No distribution yet">Run an investigation to populate this chart.</Empty>
            )}
          </Panel>

          <Panel
            title="Demo controls"
            icon="flask"
            meta={
              <span className="cs-pill mem" title="All three run the real pipeline">
                <i />
                real pipeline
              </span>
            }
          >
            <div className="cs-stack-sm">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="rotate"
                  disabled={demoBusy !== null}
                  loading={demoBusy === "reset"}
                  onClick={() => void demoAction("reset")}
                >
                  Reset bank
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="seed"
                  disabled={demoBusy !== null}
                  loading={demoBusy === "seed"}
                  onClick={() => void demoAction("seed")}
                >
                  Seed tier-1
                </Button>
                <Button
                  size="sm"
                  variant="memory"
                  icon="play"
                  disabled={demoBusy !== null}
                  loading={demoBusy === "replay"}
                  onClick={() => void demoAction("replay")}
                >
                  Replay history
                </Button>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>
                Reset creates a fresh memory bank. Seed loads tier-1 catalog knowledge. Replay pushes
                three scripted checkout episodes through the real recall → strategy → investigate →
                feedback → retain loop. Nothing here stubs the engine.
              </p>
              {demoMsg && (
                <Note tone={demoMsg.tone === "ok" ? "ok" : demoMsg.tone === "bad" ? "bad" : "info"}>
                  {demoMsg.text}
                </Note>
              )}
              {error && (
                <Note tone="bad" title="Demo action failed">
                  {error}
                </Note>
              )}
            </div>
          </Panel>

          <CounterCaseNote />
        </div>
      </div>
    </div>
  );
}

export default function ConsoleOverviewPage() {
  return (
    <ConsoleShell
      title="Overview"
      lede="Live engine state, the on-call queue, and what long-term memory has taught the investigation agent so far."
    >
      <DashboardBody />
    </ConsoleShell>
  );
}
