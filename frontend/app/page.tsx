"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EngineAPI,
  type Health,
  type Incident,
  type LearningStrategy,
  type LearningEvolutionItem,
} from "@/lib/api";
import {
  dashboardStats,
  efficiencyFromEvolution,
  learnedOverview,
} from "@/lib/transforms";
import { Empty, ErrorBox, IncidentRow, Section, Spinner } from "./components";

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [strategy, setStrategy] = useState<LearningStrategy | null>(null);
  const [evolution, setEvolution] = useState<LearningEvolutionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error && !incidents) return <ErrorBox message={`Backend unreachable: ${error}`} />;
  if (!incidents || !health || !evolution) return <Spinner />;

  const stats = dashboardStats(incidents);
  const eff = efficiencyFromEvolution(evolution);
  const learn = strategy ? learnedOverview(strategy, evolution.length) : null;

  return (
    <div>
      <h1>Incident dashboard</h1>
      <p className="sub">
        Live view of the synthetic catalog, agent memory and learning. Every number comes from
        real API responses — nothing is hard-coded.
      </p>

      <div className="grid">
        <div className="card">
          <div className="value">{stats.total}</div>
          <div className="label">Incidents</div>
        </div>
        <div className="card">
          <div className="value">{stats.active}</div>
          <div className="label">Active (unresolved)</div>
        </div>
        <div className="card">
          <div className="value">{stats.resolved}</div>
          <div className="label">Resolved</div>
        </div>
        <div className="card">
          <div className="value">{stats.services.length}</div>
          <div className="label">Services</div>
        </div>
        <div className="card">
          <div className="value">{health.hindsight.status as string}</div>
          <div className="label">Hindsight</div>
        </div>
        <div className="card">
          <div className="value">{health.demo_mode ? "ON" : "off"}</div>
          <div className="label">Demo mode</div>
        </div>
      </div>

      <div className="row" style={{ gap: 14 }}>
        <Section title="Learned patterns (from PostgreSQL runs)">
          {learn && learn.strategy.length > 0 ? (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {learn.strategy.slice(0, 4).map((s) => (
                <li key={s.step} className="small" style={{ margin: "4px 0" }}>
                  <span className="mono">{s.step}</span>
                  <span className="muted">
                    {" "}
                    · first {s.first_choice_count}× · confirmed {s.engineer_confirmations}× ·
                    low-yield {s.low_yield_count}×
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="No completed investigation runs yet — investigate an incident (e.g. INC-2001) to seed learning." />
          )}
        </Section>
        <Section title="Investigation efficiency">
          {eff.completed_runs === 0 ? (
            <Empty title="Stats appear once completed runs exist." />
          ) : (
            <div className="small">
              <div>Completed runs: {eff.completed_runs}</div>
              <div>Retained to Hindsight: {eff.retained_runs} ({eff.retention_rate}%)</div>
              <div>Average steps per run: {eff.avg_steps}</div>
              <div className="muted">
                First-step distribution:{" "}
                {Object.entries(eff.first_step_counts)
                  .map(([k, v]) => `${k} ${v}×`)
                  .join(", ")}
              </div>
            </div>
          )}
        </Section>
      </div>

      <Section title="Services">
        <table className="data">
          <thead>
            <tr>
              <th>Service</th>
              <th>Incidents</th>
            </tr>
          </thead>
          <tbody>
            {stats.services.map((s) => (
              <tr key={s.service}>
                <td>{s.service}</td>
                <td className="mono small">{s.incident_ids.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Incident catalog">
        <table className="data">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tier</th>
              <th>Service</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc) => (
              <IncidentRow key={inc.incident_id} inc={inc} />
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}