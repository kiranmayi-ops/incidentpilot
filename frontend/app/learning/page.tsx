"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EngineAPI,
  type LearningEvolution,
  type LearningStrategy,
} from "@/lib/api";
import { pathToStepsLabel } from "@/lib/transforms";
import { Empty, ErrorBox, Section, Spinner } from "../components";

export default function LearningPage() {
  const [evolution, setEvolution] = useState<LearningEvolution | null>(null);
  const [strategy, setStrategy] = useState<LearningStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [evo, strat] = await Promise.all([
        EngineAPI.learningEvolution(),
        EngineAPI.learningStrategy(),
      ]);
      setEvolution(evo);
      setStrategy(strat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !evolution) return <ErrorBox message={error} />;
  if (!evolution || !strategy) return <Spinner />;

  const items = evolution.items;

  return (
    <div>
      <h1>Learning evolution</h1>
      <p className="sub">
        Historical investigation paths and the CURRENT LEARNED STRATEGY — both computed from
        real <span className="mono">investigation_runs</span> /{" "}
        <span className="mono">investigation_steps</span> rows ({strategy.computed_from}) plus
        today&apos;s Hindsight recall. Nothing here is static.
      </p>

      <div className="two-col">
        <Section title="CURRENT LEARNED STRATEGY">
          {strategy.strategy.length === 0 ? (
            <Empty title="No completed investigation runs yet. Investigate an incident (with memory) and confirm feedback to see the strategy evolve." />
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {strategy.strategy.map((s) => (
                <li key={s.step} style={{ margin: "6px 0" }}>
                  <div className="mono">{s.step}</div>
                  <div className="small muted">{s.reason}</div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="WHY? (evidence)">
          {strategy.strategy.length === 0 ? (
            <Empty title="Evidence appears once runs are confirmed." />
          ) : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                {strategy.why?.["totals"]?.["completed_runs"] ?? 0} completed investigation
                runs
              </li>
              <li>
                {strategy.why?.["totals"]?.["retained_runs"] ?? 0} experiences retained to
                Hindsight
              </li>
              <li>
                {strategy.why?.["totals"]?.["engineer_confirmations"] ?? 0} engineer
                confirmations
              </li>
              {strategy.strategy.map((s) => (
                <li key={s.step}>
                  {s.step}: first choice {s.first_choice_count}× · confirmed{" "}
                  {s.engineer_confirmations}× · low-yield {s.low_yield_count}×
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Investigation paths over time">
        {items.length === 0 ? (
          <Empty title="No runs recorded yet." />
        ) : (
          items.map((it) => (
            <div key={`${it.incident_id}-${it.created_at}`} className="arrow-step small">
              <a
                href={`/incidents/${it.incident_id}`}
                className="mono"
                style={{ color: "var(--accent)" }}
              >
                {it.incident_id}
              </a>
              <span className={it.path[0] === "check_redis" ? "step-degraded" : "muted"}>
                [{pathToStepsLabel(it.kind)}]
              </span>
              <span className="muted">
                {it.path.join(" → ")}
                {it.feedback_kind ? ` · ${it.feedback_kind}` : ""}
                {it.retained ? " · retained" : ""}
              </span>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}