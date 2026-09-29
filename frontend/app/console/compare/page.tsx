"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import {
  EngineAPI,
  type Incident,
  type InvestigateResponse,
  type LearningEvolutionItem,
} from "@/lib/api";
import {
  beforeAfter,
  efficiencyFromEvolution,
  kindLabel,
  savingsEstimate,
  severityKey,
} from "@/lib/transforms";
import { ConsoleShell } from "../../console-shell";
import {
  Button,
  CounterCaseNote,
  Empty,
  Kpi,
  Loading,
  Note,
  Panel,
  Pill,
  SeverityPill,
  StatusPill,
  StepChips,
  TierPill,
} from "../../console-ui";
import { Icon } from "../../lib/icons";

type Side = "baseline" | "memory";

interface RunView {
  runId: number;
  kind: Side;
  status: string;
  recallCount: number;
  memoryReady: boolean;
  strategy: InvestigateResponse["strategy"];
  firstStep: string | null;
  stepsExecuted: number;
  degraded: number;
  usedFallback: boolean;
  candidate: Record<string, unknown> | null;
  memorySummary: string | null;
  rootCause: string | null;
  events: Array<{ label: string; detail: string; tone: "ok" | "warn" | "bad" | "info" }>;
}

function CompareBody() {
  const params = useSearchParams();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [evolution, setEvolution] = useState<LearningEvolutionItem[] | null>(null);
  const [selected, setSelected] = useState<string>(params.get("incident") ?? "");
  const [sides, setSides] = useState<Record<Side, RunView | null>>({ baseline: null, memory: null });
  const [busy, setBusy] = useState<Side | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inc, evo] = await Promise.all([
        EngineAPI.incidents(),
        EngineAPI.learningEvolution(),
      ]);
      setIncidents(inc.items);
      setEvolution(evo.items);
      setSelected((prev) => prev || inc.items[0]?.incident_id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A different incident means the two live runs on screen no longer apply.
  useEffect(() => {
    setSides({ baseline: null, memory: null });
    setNotice(null);
  }, [selected]);

  const runSide = useCallback(
    async (kind: Side) => {
      if (!selected) return;
      setBusy(kind);
      setError(null);
      setNotice(null);
      try {
        const out = await EngineAPI.investigate(selected, kind);
        const degraded = out.steps.filter((s) => s.result_status === "degraded").length;
        setSides((prev) => ({
          ...prev,
          [kind]: {
            runId: out.run_id,
            kind,
            status: out.status,
            recallCount: out.recall.count,
            memoryReady: out.recall.memory_ready,
            strategy: out.strategy,
            firstStep: out.strategy[0]?.step ?? null,
            stepsExecuted: out.steps.length,
            degraded,
            usedFallback: out.used_fallback,
            candidate: out.root_cause_candidate,
            memorySummary: out.memory_summary,
            rootCause: null,
            events: [
              {
                label: "Recall",
                detail: out.recall.memory_ready
                  ? `${out.recall.count} memories for “${out.recall.query}”`
                  : `skipped — ${out.recall.note ?? "memory unavailable"}`,
                tone: out.recall.memory_ready ? "info" : "warn",
              },
              {
                label: "Plan",
                detail: `${out.strategy.length} checks, opening on ${out.strategy[0]?.step ?? "nothing"}`,
                tone: "ok",
              },
              {
                label: "Execute",
                detail: `${out.steps.length} tool calls${degraded ? `, ${degraded} degraded` : ""}${
                  out.used_fallback ? ", deterministic fallback used" : ""
                }`,
                tone: degraded > 0 ? "warn" : "ok",
              },
            ],
          },
        }));
        setNotice(
          `${kindLabel(kind === "baseline" ? "baseline" : "memory")} run #${out.run_id} recorded. ` +
            `Run the other side to compare.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [selected],
  );

  const runBoth = useCallback(async () => {
    await runSide("baseline");
    // Small gap so the two runs are visibly distinct records, not a merged view.
    await new Promise((r) => setTimeout(r, 60));
    await runSide("memory");
  }, [runSide]);

  const eff = useMemo(() => (evolution ? efficiencyFromEvolution(evolution) : null), [evolution]);
  const ba = useMemo(() => (evolution ? beforeAfter(evolution) : null), [evolution]);

  const saving = useMemo(
    () => savingsEstimate(sides.baseline?.strategy, sides.memory?.strategy),
    [sides],
  );

  const base = sides.baseline;
  const mem = sides.memory;
  const sameOpening = base?.firstStep === mem?.firstStep;
  const incident = incidents?.find((i) => i.incident_id === selected) ?? null;

  if (error && !incidents) {
    return (
      <>
        <Note tone="bad" title="Could not load the comparison data">
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

  if (!incidents || !evolution) return <Loading rows={6} />;

  return (
    <div className="cs-stack">
      {/* ------------------------------------------------------ incident picker */}
      <Panel
        title="Pick an incident to race"
        icon="target"
        meta={
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {incidents.length} in the catalog
          </span>
        }
      >
        <div className="cs-stack-sm">
          <div className="cs-field" style={{ maxWidth: 420 }}>
            <label htmlFor="incident-pick">Incident</label>
            <select
              id="incident-pick"
              className="cs-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {incidents.map((i) => (
                <option key={i.incident_id} value={i.incident_id}>
                  {i.incident_id} — {i.service} — {severityKey(i.severity)}
                </option>
              ))}
            </select>
          </div>

          {incident && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
              <SeverityPill severity={incident.severity} />
              <StatusPill status={incident.status} />
              <TierPill tier={incident.tier} />
              <Pill>{incident.environment}</Pill>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {incident.symptoms[0]}
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="primary"
              icon="play"
              disabled={!selected || busy !== null}
              loading={busy !== null}
              onClick={() => void runBoth()}
            >
              Run both sides
            </Button>
            <Button
              variant="ghost"
              icon="flask"
              disabled={!selected || busy !== null}
              loading={busy === "baseline"}
              onClick={() => void runSide("baseline")}
            >
              Baseline only
            </Button>
            <Button
              variant="memory"
              icon="brain"
              disabled={!selected || busy !== null}
              loading={busy === "memory"}
              onClick={() => void runSide("memory")}
            >
              Memory only
            </Button>
            {incident && (
              <Link href={`/console/incidents/${incident.incident_id}`} className="cs-btn cs-btn-ghost">
                Open workspace
                <Icon name="arrow-right" size={13} />
              </Link>
            )}
          </div>

          <Note tone="info" title="Both sides are the same agent">
            The only difference is whether long-term memory is consulted before planning. Same
            tools, same backend, same persistence — so the difference in outcome is attributable to
            memory alone.
          </Note>

          {notice && <Note tone="ok">{notice}</Note>}
          {error && <Note tone="bad" title="Run failed">{error}</Note>}
        </div>
      </Panel>

      {/* ------------------------------------------------------------- KPIs */}
      {base && mem ? (
        <div className="cs-grid-2" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
          <Kpi
            label="Opening check"
            value={base.firstStep ?? "—"}
            hint="baseline opened on step 1"
            tone="evd"
          />
          <Kpi
            label="Memory-informed opening"
            value={mem.firstStep ?? "—"}
            hint={
              saving?.baselineRank && saving.baselineRank > 1
                ? `baseline had it at position ${saving.baselineRank}`
                : "already the baseline's first pick"
            }
            tone="mem"
          />
          <Kpi
            label="Tool calls"
            value={`${base.stepsExecuted} → ${mem.stepsExecuted}`}
            hint={
              saving && saving.checksSkipped > 0
                ? `${saving.checksSkipped} check${saving.checksSkipped === 1 ? "" : "s"} skipped by starting smarter`
                : "same depth on both sides"
            }
            tone={mem.stepsExecuted < base.stepsExecuted ? "ok" : "evd"}
          />
          <Kpi
            label="Recalled memories"
            value={mem.recallCount}
            hint="baseline recalled 0 by design"
            tone="mem"
          />
        </div>
      ) : (
        <Panel title="The race" icon="scale">
          <Empty title="No comparison on screen yet">
            Run both sides above. Each press creates a real investigation run in PostgreSQL — the
            page then reads those two runs back.
          </Empty>
        </Panel>
      )}

      {/* --------------------------------------------------------- vs layout */}
      {base && mem ? (
        <>
          <div className="cs-vs">
            <div className="cs-vs-side">
              <div className="cs-vs-head">
                <span>Baseline · no memory</span>
                <span className="mono" style={{ letterSpacing: 0, textTransform: "none" }}>
                  run #{base.runId}
                </span>
              </div>
              <div className="cs-vs-body">
                <div className="cs-vs-hero">
                  <div className="l">First check</div>
                  <div className="v">{base.firstStep ?? "—"}</div>
                  <div className="m">
                    {base.strategy.length} planned · {base.stepsExecuted} executed
                  </div>
                </div>
                <SideBody view={base} />
              </div>
            </div>

            <div className="cs-vs-mid">
              <span>VS</span>
            </div>

            <div className="cs-vs-side mem">
              <div className="cs-vs-head">
                <span>With long-term memory</span>
                <span className="mono" style={{ letterSpacing: 0, textTransform: "none" }}>
                  run #{mem.runId}
                </span>
              </div>
              <div className="cs-vs-body">
                <div className="cs-vs-hero">
                  <div className="l">First check</div>
                  <div className="v">{mem.firstStep ?? "—"}</div>
                  <div className="m">
                    {mem.strategy.length} planned · {mem.stepsExecuted} executed
                  </div>
                </div>
                <SideBody view={mem} />
              </div>
            </div>
          </div>

          <div className={`cs-verdict${sameOpening ? " neutral" : ""}`}>
            <div className="cs-verdict-ic">
              <Icon
                name={sameOpening ? "minus" : mem.stepsExecuted < base.stepsExecuted ? "zap" : "check"}
                size={18}
              />
            </div>
            <div>
              <div className="cs-verdict-t">
                {sameOpening
                  ? "Same opening move"
                  : saving && saving.checksSkipped > 0
                    ? `Memory skipped ${saving.checksSkipped} check${saving.checksSkipped === 1 ? "" : "s"}`
                    : "Memory reordered the plan"}
              </div>
              <div className="cs-verdict-s">
                {sameOpening ? (
                  <>
                    Both runs opened on <b className="mono">{base.firstStep ?? "nothing"}</b> — the
                    recalled lesson agreed with the default heuristic. Run this incident on a service
                    with no history to see the plans genuinely diverge.
                  </>
                ) : saving && saving.checksSkipped > 0 ? (
                  <>
                    Baseline reached <b className="mono">{mem.firstStep}</b> only at position{" "}
                    <b>{saving.baselineRank}</b>. With memory it is step 1, so{" "}
                    <b>{saving.checksSkipped}</b> tool call
                    {saving.checksSkipped === 1 ? "" : "s"} earlier in the incident.
                  </>
                ) : (
                  <>
                    The opening checks differ: baseline chose{" "}
                    <b className="mono">{base.firstStep ?? "—"}</b>, memory chose{" "}
                    <b className="mono">{mem.firstStep ?? "—"}</b>. Both are recorded runs you can
                    open in the workspace.
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* ----------------------------------------------- historical record */}
      <Panel
        title="Recorded before/after, straight from the run log"
        icon="book"
        meta={
          eff ? (
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {eff.completed_runs} runs · {eff.retained_runs} retained
            </span>
          ) : null
        }
      >
        {ba ? (
          <div className="cs-grid-3">
            <div className="cs-evidence" style={{ marginTop: 0 }}>
              <div className="cs-evidence-row">
                <span>Incident</span>
                <b>{ba.incident_id}</b>
              </div>
              <div className="cs-evidence-row">
                <span>Baseline first check</span>
                <b>{ba.before ?? "—"}</b>
              </div>
            </div>
            <div className="cs-evidence" style={{ marginTop: 0, borderColor: "var(--memory-line)" }}>
              <div className="cs-evidence-row">
                <span>After memory</span>
                <b style={{ color: "var(--memory)" }}>{ba.after ?? "—"}</b>
              </div>
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div className="cs-kv">
                <div className="cs-kv-row">
                  <span>Completed runs</span>
                  <b>{eff?.completed_runs ?? 0}</b>
                </div>
                <div className="cs-kv-row">
                  <span>Retention rate</span>
                  <b>{eff?.retention_rate === null || eff === null ? "—" : `${eff.retention_rate}%`}</b>
                </div>
                <div className="cs-kv-row">
                  <span>Avg checks per run</span>
                  <b>{eff?.avg_steps ?? "—"}</b>
                </div>
              </div>
              <Link
                href={`/console/incidents/${ba.incident_id}`}
                className="cs-btn cs-btn-sm cs-btn-ghost"
                style={{ justifySelf: "start" }}
              >
                Open {ba.incident_id}
                <Icon name="arrow-right" size={13} />
              </Link>
            </div>
          </div>
        ) : (
          <Empty title="No before/after pair recorded yet">
            An incident needs at least one baseline run and one memory (or live) run before the loop
            shows a shift.
          </Empty>
        )}
      </Panel>

      <CounterCaseNote />
    </div>
  );
}

function SideBody({ view }: { view: RunView }) {
  return (
    <>
      <div>
        <div className="cs-label">Planned order</div>
        <StepChips steps={view.strategy} highlightFirst={view.kind === "memory"} />
      </div>

      <div>
        <div className="cs-label">Pipeline</div>
        <div className="cs-kv">
          {view.events.map((e) => (
            <div className="cs-kv-row" key={e.label}>
              <span>{e.label}</span>
              <b
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 400,
                  fontSize: 12,
                  textAlign: "right",
                  maxWidth: "34ch",
                  color: `var(--${e.tone === "info" ? "evidence" : e.tone})`,
                }}
              >
                {e.detail}
              </b>
            </div>
          ))}
          <div className="cs-kv-row">
            <span>Run status</span>
            <b>{view.status}</b>
          </div>
        </div>
      </div>

      {view.candidate && Object.keys(view.candidate).length > 0 && (
        <div>
          <div className="cs-label">Root-cause candidate</div>
          <div className="cs-evidence">
            {Object.entries(view.candidate)
              .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
              .slice(0, 6)
              .map(([k, v]) => (
                <div className="cs-evidence-row" key={k}>
                  <span>{k}</span>
                  <b>{String(v)}</b>
                </div>
              ))}
          </div>
        </div>
      )}

      {view.memorySummary && (
        <div>
          <div className="cs-label">Memory summary</div>
          <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>{view.memorySummary}</p>
        </div>
      )}
    </>
  );
}

export default function ComparePage() {
  return (
    <ConsoleShell
      title="Baseline vs memory"
      lede="The same agent, the same tools, one difference: whether long-term memory is consulted before the plan is made."
    >
      <Suspense fallback={<Loading rows={6} />}>
        <CompareBody />
      </Suspense>
    </ConsoleShell>
  );
}
