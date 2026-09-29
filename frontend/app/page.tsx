"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  incidentActivity,
  servicePatterns,
  firstStepDistribution,
} from "@/lib/transforms";
import {
  Badge,
  BarList,
  Button,
  CounterCaseCard,
  Empty,
  ErrorBox,
  FilterBar,
  FilterChip,
  Hero,
  Icon,
  IncidentListItem,
  Notice,
  Pipeline,
  Section,
  Spinner,
  Stat,
} from "./components";

function hindsightTone(status?: string): "ok" | "warn" | "bad" | undefined {
  if (status === "ok") return "ok";
  if (status === "unconfigured" || status === "degraded") return "warn";
  if (status) return "bad";
  return undefined;
}

type SevFilter = "all" | "SEV1" | "SEV2" | "SEV3";

const normSev = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [strategy, setStrategy] = useState<LearningStrategy | null>(null);
  const [evolution, setEvolution] = useState<LearningEvolutionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sev, setSev] = useState<SevFilter>("all");

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

  async function demoAction(kind: "reset" | "seed" | "replay") {
    setDemoBusy(kind);
    setDemoMsg(null);
    setError(null);
    try {
      if (kind === "reset") {
        const out = await EngineAPI.demoReset();
        setHealth(await EngineAPI.health());
        setDemoMsg(
          `Fresh demo memory bank "${out.bank_id}" (phase ${out.phase}). Run tier-1 seed + replay to rebuild the story.`,
        );
      } else if (kind === "seed") {
        const out = await EngineAPI.demoSeed();
        const failed = out.failures.length ? `; failures: ${out.failures.join(", ")}` : "";
        setDemoMsg(`Seeded ${out.seeded.length} tier-1 experiences into Hindsight.${failed}`);
      } else {
        const out = await EngineAPI.demoReplay();
        const ok = out.replayed.filter((r) => r.retained);
        const failed = out.failures.length ? `; failures: ${out.failures.join(", ")}` : "";
        setDemoMsg(
          `Replayed ${ok.length}/3 scripted checkout incidents through the real pipeline (recall → strategy → investigate → scripted feedback → retain).${failed}`,
        );
      }
      const evo = await EngineAPI.learningEvolution();
      setEvolution(evo.items);
      const strat = await EngineAPI.learningStrategy();
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
  const activity = useMemo(
    () => (incidents && evolution ? incidentActivity(incidents, evolution) : new Map()),
    [incidents, evolution],
  );
  const patterns = useMemo(
    () => (incidents && evolution ? servicePatterns(incidents, evolution).slice(0, 5) : []),
    [incidents, evolution],
  );
  const distribution = useMemo(
    () => (evolution ? firstStepDistribution(evolution).slice(0, 6) : []),
    [evolution],
  );

  const hindsight = String(health?.hindsight.status ?? "unknown");
  const degraded = health?.status === "degraded";

  const filtered = useMemo(() => {
    if (!incidents) return [];
    const q = query.trim().toLowerCase();
    return incidents.filter((inc) => {
      if (sev !== "all" && normSev(inc.severity) !== sev) return false;
      if (!q) return true;
      return (
        inc.incident_id.toLowerCase().includes(q) ||
        inc.service.toLowerCase().includes(q) ||
        inc.symptoms.some((s) => s.toLowerCase().includes(q)) ||
        (inc.root_cause ?? "").toLowerCase().includes(q)
      );
    });
  }, [incidents, query, sev]);

  const sevCount = useCallback(
    (s: SevFilter) =>
      !incidents
        ? 0
        : s === "all"
          ? incidents.length
          : incidents.filter((i) => normSev(i.severity) === s).length,
    [incidents],
  );

  const heroBlock = (
    <Hero
      eyebrow="SRE Platform"
      title="Incident"
      highlight="command deck"
      sub="AI-powered incident investigation that learns from every engineer correction through Hindsight long-term memory."
    />
  );

  if (error && !incidents)
    return (
      <div>
        {heroBlock}
        <ErrorBox message={`Backend unreachable: ${error}`} onRetry={() => void load()} />
      </div>
    );

  if (!stats || !eff || !health || !incidents || !evolution) {
    return (
      <div>
        {heroBlock}
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      {/* ============================== HERO ============================== */}
      <Hero
        eyebrow="SRE Platform · Live"
        title="Every incident makes the next one"
        highlight="faster to solve"
        sub="The investigation agent recalls past experience from Hindsight long-term memory, weighs it against current telemetry, and adapts its strategy with every engineer correction."
        stats={[
          { value: stats.total, label: "Incidents in catalog" },
          { value: stats.active, label: "Active now", tone: stats.active > 0 ? "gold" : "cyan" },
          { value: stats.resolved, label: "Resolved" },
          {
            value: eff.retention_rate === null ? "—" : `${eff.retention_rate}%`,
            label: `Experience retained (${eff.retained_runs}/${eff.completed_runs})`,
          },
          { value: hindsight, label: "Hindsight memory" },
        ]}
        actions={
          <Link href="/compare" className="btn memory-btn big">
            See memory change a strategy
            <Icon kind="arrow" size={15} />
          </Link>
        }
      />

      {/* ==================== THE LEARNING PIPELINE ==================== */}
      <Pipeline />

      {degraded && (
        <Notice tone="warn" title="Engine is running with degraded configuration">
          <p>
            Hindsight: <span className="mono">{hindsight}</span> · database:{" "}
            <span className="mono">{String(health.database.status ?? "unknown")}</span>. Core
            investigation features may be limited.
          </p>
        </Notice>
      )}

      {/* ======================= KPI DECK ======================= */}
      <div className="stat-strip">
        <Stat label="Incidents" value={stats.total} hint="in the catalog" tone="info" />
        <Stat
          label="Active (unresolved)"
          value={stats.active}
          tone={stats.active > 0 ? "warn" : "ok"}
        />
        <Stat label="Resolved" value={stats.resolved} tone="ok" />
        <Stat
          label="Avg steps / run"
          value={eff.avg_steps ?? "—"}
          hint="tool executions per investigation"
        />
        <Stat
          label="Hindsight"
          value={hindsight}
          tone={hindsightTone(hindsight)}
          hint="long-term memory provider"
        />
      </div>

      {/* =================== INCIDENT COMMAND LIST =================== */}
      <Section
        id="incidents"
        eyebrow="Active Catalog"
        title="Incidents"
        description="Select an incident to open the investigation workspace. The gold chip marks the agent's memory-informed first check."
        actions={
          <div className="muted" style={{ fontSize: 12.5 }}>
            {filtered.length} of {incidents.length} shown
          </div>
        }
      >
        <FilterBar query={query} onQuery={setQuery}>
          {(["all", "SEV1", "SEV2", "SEV3"] as const).map((s) => (
            <FilterChip key={s} on={sev === s} count={sevCount(s)} onClick={() => setSev(s)}>
              {s === "all" ? "All severities" : s}
            </FilterChip>
          ))}
        </FilterBar>

        <div className="incident-list-container">
          {filtered.map((inc) => {
            const act = activity.get(inc.incident_id);
            return (
              <IncidentListItem
                key={inc.incident_id}
                id={inc.incident_id}
                service={inc.service}
                severity={inc.severity}
                status={inc.status}
                symptoms={inc.symptoms}
                environment={inc.environment}
                tier={inc.tier}
                timestamp={inc.timestamp}
                agentActivity={
                  act
                    ? {
                        first_step: act.first_step,
                        feedback_kind: act.feedback_kind,
                        retained: act.retained,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
        {filtered.length === 0 && (
          <Empty title="No incidents match this filter">
            Try clearing the search box or choosing a different severity.
          </Empty>
        )}
      </Section>

      {/* ============ LEARNING + SERVICES TWO-COLUMN GRID ============ */}
      <div className="grid-2">
        <div>
          <Section
            eyebrow="Hindsight Insight"
            title="Learned patterns"
            description="How engineer feedback alters the agent's first investigation step."
          >
            {learn && learn.strategy.length > 0 ? (
              <div className="stack-12">
                <div className="feature memory-feature">
                  <div className="feature-title">
                    <Icon kind="sparkles" size={16} />
                    Next investigation starts with
                    <span className="chip highlight" style={{ fontSize: 13, padding: "4px 10px" }}>
                      {learn.strategy[0].step}
                    </span>
                  </div>
                  <p>{learn.strategy[0].reason ?? "No recorded rationale."}</p>
                  <div className="keyval mt-8">
                    <div className="keyval-row">
                      <span className="keyval-key">First-choice count</span>
                      <span className="keyval-val">{learn.strategy[0].first_choice_count}×</span>
                    </div>
                    <div className="keyval-row">
                      <span className="keyval-key">Confirmed by engineers</span>
                      <span className="keyval-val">
                        {learn.strategy[0].engineer_confirmations}×
                      </span>
                    </div>
                    <div className="keyval-row">
                      <span className="keyval-key">Low-yield runs</span>
                      <span className="keyval-val">{learn.strategy[0].low_yield_count}×</span>
                    </div>
                  </div>
                  <div className="meta">computed from {learn.computed_from}</div>
                </div>

                {distribution.length > 0 && (
                  <div>
                    <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                      First-step distribution
                    </div>
                    <BarList data={distribution} />
                  </div>
                )}
              </div>
            ) : (
              <Empty title="No completed investigation runs yet">
                Investigate an incident (e.g. INC-2001) to seed learning through the real pipeline.
              </Empty>
            )}
          </Section>

          <CounterCaseCard />
        </div>

        <div>
          <Section
            eyebrow="Services Catalog"
            title="Services"
            description="Services tracked and their learned recall priorities."
          >
            <div className="stack-8">
              {stats.services.map((s) => (
                <div className="card" key={s.service}>
                  <div className="card-body" style={{ padding: "12px 16px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="mono" style={{ fontWeight: 650, fontSize: 14 }}>
                        {s.service}
                      </span>
                      <Badge tone="neutral">
                        {s.count} incident{s.count === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="faint mono" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {s.incident_ids.slice(0, 5).join(", ")}
                      {s.incident_ids.length > 5 ? "…" : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {stats.services.length === 0 && <Empty title="No services tracked yet" />}
          </Section>

          <Section
            eyebrow="Hindsight Strategy"
            title="Recall by service"
            description="First check the agent executes per service."
          >
            {patterns.length > 0 ? (
              <div className="card">
                <div className="card-body" style={{ padding: "12px 16px" }}>
                  <table className="data compact">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>First check</th>
                        <th>Runs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.map((p) => (
                        <tr key={`${p.service}->${p.first_step}`}>
                          <td className="mono">{p.service}</td>
                          <td>
                            <span className="chip highlight">
                              <span className="n">1</span>
                              {p.first_step}
                            </span>
                          </td>
                          <td className="muted">{p.count}×</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Empty title="No service patterns learned yet" />
            )}
          </Section>
        </div>
      </div>

      {/* ==================== DEMO MISSION CONTROL ==================== */}
      <Section
        id="demo"
        eyebrow="Developer Tools"
        title="Demo controls"
        description="Reset, seed and replay the demo story through the real pipeline. Nothing here stubs the engine — feedback is retained to Hindsight for real."
      >
        <div className="card">
          <div className="card-body">
            <div className="row" style={{ gap: 12 }}>
              <Button
                size="small"
                variant="ghost"
                disabled={demoBusy !== null}
                loading={demoBusy === "reset"}
                onClick={() => void demoAction("reset")}
              >
                {demoBusy === "reset" ? "Resetting memory bank…" : "Reset memory bank"}
              </Button>
              <Button
                size="small"
                variant="ghost"
                disabled={demoBusy !== null}
                loading={demoBusy === "seed"}
                onClick={() => void demoAction("seed")}
              >
                {demoBusy === "seed" ? "Seeding knowledge…" : "Seed tier-1 knowledge"}
              </Button>
              <Button
                size="small"
                variant="memory-btn"
                disabled={demoBusy !== null}
                loading={demoBusy === "replay"}
                onClick={() => void demoAction("replay")}
              >
                {demoBusy === "replay" ? "Replaying history…" : "Replay scripted history"}
              </Button>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Tier-1: general catalog knowledge. Replay: 3 scripted checkout incidents through the
              real pipeline — labelled scripted feedback, retained to Hindsight for real.
            </div>
            {demoMsg && (
              <div className="notice success mt-12" style={{ marginBottom: 0 }}>
                <div>{demoMsg}</div>
              </div>
            )}
            {error && incidents && (
              <div className="notice error mt-12" style={{ marginBottom: 0 }}>
                <div>{error}</div>
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
