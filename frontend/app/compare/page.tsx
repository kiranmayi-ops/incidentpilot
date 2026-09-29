"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EngineAPI,
  type Incident,
  type InvestigateResponse,
  type StrategyStep,
} from "@/lib/api";
import { kindLabel } from "@/lib/transforms";
import {
  Badge,
  Button,
  ContextTag,
  CounterCaseCard,
  Empty,
  ErrorBox,
  Icon,
  Notice,
  Spinner,
  StepChips,
  StatusBadge,
} from "../components";

type Side = InvestigateResponse | null;

const firstStep = (s: StrategyStep[] | undefined) => s?.[0]?.step ?? null;

function Panel({
  title,
  tag,
  active,
  side,
  highlightFirst,
}: {
  title: string;
  tag: string;
  active: boolean;
  side: Side;
  highlightFirst?: boolean;
}) {
  return (
    <div className={`compare-panel ${active ? "active-memory" : ""}`}>
      <div className="compare-panel-head">
        <span className="panel-title" style={{ fontWeight: 650, fontSize: 14 }}>{title}</span>
        <ContextTag kind={active ? "memory" : "now"} />
      </div>
      <div className="compare-panel-body">
        {!side ? (
          <Empty title="Not run yet">
            {active ? 'Click "Run with Hindsight" to recall long-term memory.' : 'Click "Run baseline" (recall disabled).'}
          </Empty>
        ) : (
          <div className="stack-12 reveal" key={`run-${side.run_id}`}>
            <div className="row" style={{ gap: 6 }}>
              <Badge tone="info">Run #{side.run_id}</Badge>
              <Badge tone="neutral">{kindLabel(side.kind)}</Badge>
              <StatusBadge status={side.status} />
              {side.used_fallback ? (
                <Badge tone="warning" dot>fallback strategy</Badge>
              ) : (
                <Badge tone="neutral">live LLM</Badge>
              )}
            </div>

            {/* FIRST STEP FOCUS */}
            <div className={`first-step-highlight ${highlightFirst ? "changed" : ""}`}>
              <div className="label">{active ? "Memory-Informed First Step" : "Baseline First Step"}</div>
              <div className="mono-big">{firstStep(side.strategy) ?? "—"}</div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
                {active ? "Guided by recalled investigation history" : "Default top-down evidence order"}
              </div>
            </div>

            <div>
              <div className="section-title" style={{ fontSize: 12.5, marginBottom: 6 }}>
                Planned strategy
              </div>
              <StepChips steps={side.strategy} highlightFirst={highlightFirst} />
            </div>

            <div>
              <div className="section-title" style={{ fontSize: 12.5, marginBottom: 6 }}>
                Memory Recall Status
              </div>
              <div className="stack-8">
                <div className="row">
                  <Badge tone={side.recall.count > 0 ? "info" : "neutral"}>
                    {side.recall.count} recalled memory snippet{side.recall.count === 1 ? "" : "s"}
                  </Badge>
                  {side.recall.memory_ready ? (
                    <Badge tone="info" dot>memory ready</Badge>
                  ) : (
                    <Badge tone="warning" dot>not ready</Badge>
                  )}
                </div>
                {side.recall.incident_ids.length > 0 && (
                  <div>
                    <div className="faint" style={{ fontSize: 11.5, marginBottom: 4 }}>Evidenced by Incident IDs:</div>
                    <div className="chips">
                      {side.recall.incident_ids.slice(0, 8).map((iid) => (
                        <span key={iid} className="chip highlight">{iid}</span>
                      ))}
                      {side.recall.incident_ids.length > 8 && (
                        <span className="chip ghost">+{side.recall.incident_ids.length - 8}</span>
                      )}
                    </div>
                  </div>
                )}
                {side.memory_summary && (
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px" }}>
                    {side.memory_summary}
                  </div>
                )}
              </div>
            </div>

            {side.steps.length > 0 && (
              <div>
                <div className="section-title" style={{ fontSize: 12.5, marginBottom: 6 }}>
                  Executed Tool Steps
                </div>
                <div className="chips">
                  {side.steps.map((s) => (
                    <span
                      key={s.id}
                      className={`chip ${s.result_status === "degraded" ? "highlight" : ""}`}
                      title={`${s.tool} — ${s.result_status ?? "healthy"}`}
                    >
                      {s.tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {side.root_cause_candidate && (
              <div className="feature" style={{ marginTop: 8 }}>
                <div className="feature-title">
                  Proposed Root Cause ·{" "}
                  <span className="mono">{String(side.root_cause_candidate.layer)}</span>
                </div>
                <p style={{ fontWeight: 500 }}>{String(side.root_cause_candidate.root_cause)}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [selected, setSelected] = useState<string>("INC-2001");
  const [baseline, setBaseline] = useState<Side>(null);
  const [memoryRun, setMemoryRun] = useState<Side>(null);
  const [busyKind, setBusyKind] = useState<"baseline" | "memory" | null>(null);
  const [recallStage, setRecallStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await EngineAPI.incidents();
      setIncidents(list.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(kind: "baseline" | "memory") {
    setBusyKind(kind);
    setError(null);
    if (kind === "memory") {
      setRecallStage("Recalling previous experiences...");
    }
    try {
      if (kind === "memory") {
        await new Promise((r) => setTimeout(r, 250));
        setRecallStage("Hindsight memories retrieved — matching patterns found...");
        await new Promise((r) => setTimeout(r, 250));
        setRecallStage("Building memory-informed strategy...");
      }
      const resp = await EngineAPI.investigate(selected, kind);
      if (kind === "baseline") setBaseline(resp);
      else setMemoryRun(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKind(null);
      setRecallStage(null);
    }
  }

  if (error && !incidents)
    return (
      <div>
        <PageHeader />
        <ErrorBox message={error} onRetry={() => void load()} />
      </div>
    );
  if (!incidents)
    return (
      <div>
        <PageHeader />
        <Spinner />
      </div>
    );

  const before = firstStep(baseline?.strategy);
  const after = firstStep(memoryRun?.strategy);
  const changed = before != null && after != null && before !== after;

  const selectedIncidentObj = incidents.find((i) => i.incident_id === selected);

  return (
    <div>
      <PageHeader />

      {/* Incident Selection & Trigger Toolbar */}
      <div className="compare-toolbar">
        <div className="compare-toolbar-field">
          <label className="field-label" htmlFor="incident-select">Target Incident</label>
          <select
            id="incident-select"
            className="input"
            style={{ width: "100%" }}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setBaseline(null);
              setMemoryRun(null);
            }}
          >
            {incidents.map((i) => (
              <option key={i.incident_id} value={i.incident_id}>
                {i.incident_id} — {i.service} ({i.symptoms[0] ?? "incident"})
              </option>
            ))}
          </select>
          {selectedIncidentObj && (
            <div className="muted mt-8" style={{ fontSize: 12.5 }}>
              <span className="mono" style={{ color: "var(--text)" }}>{selectedIncidentObj.service}</span>{" "}
              · {selectedIncidentObj.symptoms[0]}
            </div>
          )}
        </div>

        <div className="compare-toolbar-actions">
          <Button
            variant="secondary"
            disabled={busyKind !== null}
            loading={busyKind === "baseline"}
            onClick={() => void run("baseline")}
          >
            {busyKind === "baseline" ? "Running Baseline…" : "Run Baseline (No Memory)"}
          </Button>
          <Button
            variant="memory-btn"
            disabled={busyKind !== null}
            loading={busyKind === "memory"}
            onClick={() => void run("memory")}
          >
            {busyKind === "memory" ? "Running with Hindsight…" : "Run with Hindsight"}
          </Button>
        </div>
      </div>

      {/* Memory Recall Sequence Animation Toast */}
      {recallStage && (
        <div className="notice info mb-24">
          <div className="row" style={{ gap: 10 }}>
            <span className="spin" style={{ borderColor: "var(--memory-accent)", borderTopColor: "transparent" }} />
            <div>
              <div className="notice-title" style={{ color: "var(--memory-text)" }}>Memory Recall Sequence</div>
              <div className="mono" style={{ fontSize: 12.5 }}>{recallStage}</div>
            </div>
          </div>
        </div>
      )}

      {error ? <ErrorBox message={error} /> : null}

      {/* Outcome Highlight Banners */}
      {changed ? (
        <Notice tone="success" title="FIRST STEP CHANGED — Long-term memory altered investigation order">
          <p>
            Baseline opened at <span className="mono" style={{ fontWeight: 700 }}>{before}</span>. The memory-informed agent opened at <span className="mono" style={{ fontWeight: 700 }}>{after}</span>. This shift occurs because Hindsight recalled prior engineer corrections for this symptom pattern.
          </p>
        </Notice>
      ) : baseline && memoryRun ? (
        <Notice tone="info" title="NO STRATEGY CHANGE for this incident">
          <p>
            Both runs opened with <span className="mono">{before}</span>. To experience the memory shift, run <span className="mono">/demo/replay</span> on the dashboard and select <span className="mono">INC-2001</span>.
          </p>
        </Notice>
      ) : null}

      {/* Side-by-side Comparison Areas */}
      <div className="compare-grid">
        <div>
          <Panel
            title="BASELINE"
            tag="No long-term memory"
            active={false}
            side={baseline}
          />
        </div>
        <div>
          <Panel
            title="WITH HINDSIGHT"
            tag="Long-term memory enabled"
            active
            side={memoryRun}
            highlightFirst={changed}
          />
        </div>
      </div>

      {/* Counter-case Interactive Concept Block */}
      <div className="mt-24">
        <CounterCaseCard />
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <header className="page-header">
      <div className="eyebrow">Hero Interaction</div>
      <h1>Baseline vs Memory</h1>
      <p className="lead">
        Compare how the SRE investigation agent operates before and after recalling long-term memories from Hindsight. Real execution data straight from the engine pipeline.
      </p>
    </header>
  );
}