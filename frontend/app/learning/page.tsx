"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  EngineAPI,
  type LearningEvolution,
  type LearningStrategy,
} from "@/lib/api";
import {
  beforeAfter,
  firstStepDistribution,
  fmtShortDate,
  kindLabel,
} from "@/lib/transforms";
import {
  Badge,
  BarList,
  ContextTag,
  CounterCaseCard,
  Empty,
  ErrorBox,
  Hero,
  Icon,
  Section,
  Spinner,
  StepChips,
} from "../components";

const LOOP = [
  {
    title: "Incident",
    desc: "Symptoms & live telemetry trigger investigation.",
    tone: "evidence" as const,
  },
  { title: "Investigation", desc: "Agent walks the plan, checking layers.", tone: undefined },
  { title: "Engineer Feedback", desc: "Engineer accepts or submits a correction.", tone: undefined },
  {
    title: "Hindsight Memory",
    desc: "Experience narrative retained to the memory bank.",
    tone: "memory" as const,
  },
  {
    title: "Future Investigation",
    desc: "Next recall incorporates the past lesson.",
    tone: "memory" as const,
  },
];

const FEEDBACK_META: Record<
  string,
  { label: string; tone: "success" | "danger" | "warning" | "info" }
> = {
  accept: { label: "Accepted", tone: "success" },
  reject: { label: "Rejected", tone: "danger" },
  correct: { label: "Corrected", tone: "warning" },
};

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

  if (error && !evolution)
    return (
      <div>
        <Hero
          eyebrow="Insight"
          title="Learning"
          highlight="evolution"
          sub="How engineer feedback becomes Hindsight long-term memory and changes future SRE investigation paths."
        />
        <ErrorBox message={error} onRetry={() => void load()} />
      </div>
    );

  if (!evolution || !strategy)
    return (
      <div>
        <Hero
          eyebrow="Insight"
          title="Learning"
          highlight="evolution"
          sub="How engineer feedback becomes Hindsight long-term memory and changes future SRE investigation paths."
        />
        <Spinner />
      </div>
    );

  const items = evolution.items;
  const ba = beforeAfter(items);
  const distribution = firstStepDistribution(items).slice(0, 6);
  const totals = strategy.why?.["totals"];

  return (
    <div>
      <Hero
        eyebrow="Insight"
        title="Learning"
        highlight="evolution"
        sub="How engineer feedback becomes Hindsight long-term memory and changes future SRE investigation paths."
      />

      {/* ==================== THE LEARNING LOOP ==================== */}
      <Section
        eyebrow="Architecture Core"
        title="The SRE Learning Loop"
        description="How engineer corrections transform into long-term memory to optimize future investigations."
      >
        <div className="loop">
          {LOOP.map((step, i) => (
            <div
              className={`loop-step ${step.tone ?? ""}`}
              key={step.title}
            >
              <div className="loop-dot">{i + 1}</div>
              <div className="loop-title">{step.title}</div>
              <div className="loop-desc">{step.desc}</div>
              <div className="loop-link" />
            </div>
          ))}
        </div>
      </Section>

      {/* ==================== STRATEGY SHIFT ==================== */}
      {ba && (
        <Section
          eyebrow="Strategy Shift"
          title={`Incident ${ba.incident_id}: first step shift after learning`}
          description="Comparison of the first check executed before and after Hindsight memory retention."
        >
          <div className="grid-2">
            <div className="card">
              <div className="card-body">
                <div
                  className="faint"
                  style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}
                >
                  Before learning
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--text)",
                    marginTop: 4,
                  }}
                >
                  {ba.before ?? "—"}
                </div>
                <div className="muted mt-4" style={{ fontSize: 12 }}>
                  First check in baseline top-down strategy
                </div>
              </div>
            </div>
            <div
              className="card"
              style={{
                borderColor: "var(--memory-border)",
                borderLeft: "3px solid var(--memory-accent)",
              }}
            >
              <div className="card-body">
                <div
                  className="faint"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: "var(--memory-text)",
                  }}
                >
                  After learning
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--memory-text)",
                    marginTop: 4,
                  }}
                >
                  {ba.after ?? "—"}
                </div>
                <div className="muted mt-4" style={{ fontSize: 12 }}>
                  First check after Hindsight recalled a past correction
                </div>
              </div>
            </div>
          </div>
          {ba.before && ba.after && ba.before !== ba.after && (
            <div className="notice info mt-16" style={{ marginBottom: 0 }}>
              <div>
                <div className="notice-title">Investigation strategy adapted</div>
                <p>
                  When this symptom pattern recurs, the agent opens directly at{" "}
                  <span className="mono" style={{ fontWeight: 700 }}>
                    {ba.after}
                  </span>{" "}
                  instead of <span className="mono">{ba.before}</span> — saving critical response
                  time.
                </p>
              </div>
            </div>
          )}
        </Section>
      )}

      <div className="grid-2">
        <div>
          {/* ==================== LEARNED STRATEGY ==================== */}
          <Section
            eyebrow={<ContextTag kind="memory" />}
            title="Current Learned Strategy"
            description="Recommended tool order for upcoming investigations."
          >
            {strategy.strategy.length === 0 ? (
              <Empty title="No completed runs yet">
                Investigate an incident and confirm engineer feedback to see the strategy evolve.
              </Empty>
            ) : (
              <div className="stack-8">
                {strategy.strategy.map((s, i) => (
                  <div className="feature" key={s.step}>
                    <div className="feature-title">
                      <span className="chip highlight">
                        <span className="n">{i + 1}</span>
                        {s.step}
                      </span>
                    </div>
                    <p>{s.reason ?? "No recorded rationale."}</p>
                    <div className="keyval mt-8">
                      <div className="keyval-row">
                        <span className="keyval-key">Chosen first</span>
                        <span className="keyval-val">{s.first_choice_count}×</span>
                      </div>
                      <div className="keyval-row">
                        <span className="keyval-key">Confirmed by engineers</span>
                        <span className="keyval-val">{s.engineer_confirmations}×</span>
                      </div>
                      <div className="keyval-row">
                        <span className="keyval-key">Low-yield runs</span>
                        <span className="keyval-val">{s.low_yield_count}×</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div>
          {/* ==================== EMPIRICAL EVIDENCE ==================== */}
          <Section
            eyebrow={<ContextTag kind="now" />}
            title="Empirical Run Evidence"
            description="Metrics computed directly from PostgreSQL run history."
          >
            {strategy.strategy.length === 0 ? (
              <Empty title="Evidence appears once runs complete." />
            ) : (
              <div className="stack-12">
                <div className="card">
                  <div className="card-body">
                    <div className="keyval">
                      <div className="keyval-row">
                        <span className="keyval-key">Completed investigation runs</span>
                        <span className="keyval-val">{totals?.completed_runs ?? 0}</span>
                      </div>
                      <div className="keyval-row">
                        <span className="keyval-key">Experiences retained to Hindsight</span>
                        <span className="keyval-val">{totals?.retained_runs ?? 0}</span>
                      </div>
                      <div className="keyval-row">
                        <span className="keyval-key">Engineer confirmations</span>
                        <span className="keyval-val">{totals?.engineer_confirmations ?? 0}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {distribution.length > 0 && (
                  <div>
                    <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                      First-step execution distribution
                    </div>
                    <BarList data={distribution} />
                  </div>
                )}

                <CounterCaseCard />
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ==================== PATHS OVER TIME ==================== */}
      <Section
        eyebrow="Historical Trajectory"
        title="Investigation paths over time"
        description="Chronological record of recorded investigation paths."
      >
        {items.length === 0 ? (
          <Empty title="No runs recorded yet." />
        ) : (
          <div className="card">
            <div className="card-body">
              <div className="timeline">
                {items.map((it, i) => {
                  const fb = it.feedback_kind ? FEEDBACK_META[it.feedback_kind] : null;
                  return (
                    <div
                      className="timeline-item"
                      key={`${it.incident_id}-${it.created_at}`}
                      style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}
                    >
                      <div className="timeline-marker neutral" />
                      <div className="timeline-title">
                        <Link
                          href={`/incidents/${it.incident_id}`}
                          className="mono"
                          style={{ fontWeight: 700 }}
                        >
                          {it.incident_id}
                        </Link>
                        <Badge tone="neutral">{kindLabel(it.kind)}</Badge>
                        {fb && <Badge tone={fb.tone}>{fb.label}</Badge>}
                        {it.retained && <Badge tone="info">retained</Badge>}
                      </div>
                      <div className="timeline-meta">{fmtShortDate(it.created_at)}</div>
                      <div className="timeline-body">
                        <StepChips steps={it.path} highlightFirst />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
