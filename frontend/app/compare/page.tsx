"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EngineAPI,
  type Incident,
  type InvestigateResponse,
  type StrategyStep,
} from "@/lib/api";
import { Empty, ErrorBox, Section, Spinner, StepChips } from "../components";

type Side = InvestigateResponse | null;

export default function ComparePage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [selected, setSelected] = useState<string>("INC-2001");
  const [baseline, setBaseline] = useState<Side>(null);
  const [memoryRun, setMemoryRun] = useState<Side>(null);
  const [busyKind, setBusyKind] = useState<"baseline" | "memory" | null>(null);
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
    try {
      const resp = await EngineAPI.investigate(selected, kind);
      if (kind === "baseline") setBaseline(resp);
      else setMemoryRun(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKind(null);
    }
  }

  if (error && !incidents) return <ErrorBox message={error} />;
  if (!incidents) return <Spinner />;

  const first = (s: StrategyStep[] | undefined) => s?.[0]?.step ?? null;
  const changed = ((): boolean => {
    const a = first(baseline?.strategy);
    const b = first(memoryRun?.strategy);
    return a != null && b != null && a !== b;
  })();

  return (
    <div>
      <h1>Baseline vs Memory</h1>
      <p className="sub">
        Run the same incident twice on the real pipeline: once with recall disabled and once
        with Hindsight recall switched on. The tables below are the actual planned +
        executed strategies.
      </p>

      <div className="row" style={{ alignItems: "center" }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {incidents.map((i) => (
            <option key={i.incident_id} value={i.incident_id}>
              {i.incident_id} — {i.service}
            </option>
          ))}
        </select>
        <button
          className="btn ghost"
          disabled={busyKind !== null}
          onClick={() => void run("baseline")}
        >
          {busyKind === "baseline" ? "Running…" : "Run baseline (no memory)"}
        </button>
        <button
          className="btn"
          disabled={busyKind !== null}
          onClick={() => void run("memory")}
        >
          {busyKind === "memory" ? "Running…" : "Run with memory"}
        </button>
      </div>

      {error ? (
        <div style={{ marginTop: 12 }}>
          <ErrorBox message={error} />
        </div>
      ) : null}

      {changed ? (
        <div className="ok-box" style={{ marginTop: 12 }}>
          First step changed: baseline started with <b>{first(baseline?.strategy)}</b>, the
          memory-enabled agent started with <b>{first(memoryRun?.strategy)}</b>.
        </div>
      ) : baseline && memoryRun ? (
        <div className="error-box" style={{ marginTop: 12 }}>
          No first-step difference for this incident. Try the demo incident INC-2001 after
          memcached history has been recalled.
        </div>
      ) : null}

      <div className="two-col">
        <Section title="Baseline (recall disabled)">
          {baseline ? <CompareCard run={baseline} /> : <Empty title="Not run yet." />}
        </Section>
        <Section title="With Hindsight memory">
          {memoryRun ? <CompareCard run={memoryRun} /> : <Empty title="Not run yet." />}
        </Section>
      </div>
    </div>
  );
}

function CompareCard({ run }: { run: InvestigateResponse }) {
  return (
    <div>
      <div className="small muted">
        run #{run.run_id} · {run.kind} · status {run.status}
        {run.used_fallback ? " (fallback strategy)" : " (live LLM)"}
      </div>
      <StepChips steps={run.strategy} />
      <div className="small muted" style={{ marginTop: 8 }}>
        Recall: {run.recall.count} memory(-ies)
        {run.recall.incident_ids.length ? ` from ${run.recall.incident_ids.join(", ")}` : ""}
        {run.recall.note ? ` — ${run.recall.note}` : ""}
      </div>
      {run.memory_summary ? (
        <div className="small" style={{ marginTop: 6 }}>
          {run.memory_summary}
        </div>
      ) : null}
      {run.root_cause_candidate ? (
        <div className="small" style={{ marginTop: 6 }}>
          Candidate layer: <b>{String(run.root_cause_candidate.layer)}</b>
        </div>
      ) : null}
    </div>
  );
}