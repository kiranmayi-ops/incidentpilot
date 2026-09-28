"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  EngineAPI,
  type Incident,
  type MemoryPanel,
  type Timeline,
} from "@/lib/api";
import {
  Empty,
  ErrorBox,
  MemoryCard,
  Section,
  Spinner,
  StepChips,
  ToolResultLine,
  tierBadge,
} from "../../components";

export default function IncidentPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [memory, setMemory] = useState<MemoryPanel | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [correctText, setCorrectText] = useState<string>("");
  const [resolution, setResolution] = useState<string>("increase_connection_pool_size");

  const loadDetail = useCallback(async () => {
    setError(null);
    try {
      const inc = await EngineAPI.incident(id);
      setIncident(inc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    EngineAPI.incidentTimeline(id)
      .then(setTimeline)
      .catch(() => setTimeline(null));
    EngineAPI.memory(id)
      .then(setMemory)
      .catch(() => setMemory(null));
  }, [id]);

  useEffect(() => {
    setIncident(null);
    setTimeline(null);
    setMemory(null);
    setError(null);
    void loadDetail();
  }, [loadDetail, id]);

  async function runInvestigation(kind: "baseline" | "memory" | "live") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await EngineAPI.investigate(id, kind);
      const tl = await EngineAPI.incidentTimeline(id);
      setTimeline(tl);
      setNotice(
        `${kind === "baseline" ? "Baseline" : kind === "memory" ? "Memory" : "Live LLM"} investigation recorded.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback(kind: "accept" | "reject" | "correct") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const text = kind === "correct" ? correctText : undefined;
      const resp = await EngineAPI.feedback(id, kind, text, timeline?.run.id);
      setNotice(
        `Feedback "${kind}" recorded — run ${kind === "reject" ? "closed without retention" : "retained to Hindsight"}.`,
      );
      const tl = await EngineAPI.incidentTimeline(id);
      setTimeline(tl);
      void EngineAPI.memory(id).then(setMemory);
      return resp;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function resolveIncident() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await EngineAPI.resolve(id, resolution, timeline?.run.id);
      setNotice(`Resolution applied to run ${timeline?.run.id}.`);
      setTimeline(await EngineAPI.incidentTimeline(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !incident) return <ErrorBox message={error} />;
  if (!incident) return <Spinner />;

  const active = timeline?.run;
  const steps = timeline?.steps ?? [];
  const canFeedback = active?.status === "feedback";
  const canResolve =
    active?.status === "feedback" || active?.status === "completed";

  return (
    <div>
      <h1>
        <span className="mono">{incident.incident_id}</span> · {incident.service}
      </h1>
      <p className="sub">
        Tier <span className={tierBadge(incident.tier)}>{incident.tier}</span> ·{" "}
        {incident.severity} · {incident.environment} · {incident.timestamp}
      </p>

      {error ? <ErrorBox message={error} /> : null}
      {notice ? <div className="ok-box">{notice}</div> : null}

      <div className="two-col">
        <Section title="Symptoms & evidence">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {incident.symptoms.map((s) => (
              <li key={s} className="small">
                {s}
              </li>
            ))}
          </ul>
          <div className="small muted" style={{ marginTop: 8 }}>
            Live metrics
          </div>
          <div className="mono small">
            {Object.entries(incident.metrics ?? {})
              .map(([k, v]) => `${k}=${String(v)}`)
              .join("  ")}
          </div>
          {incident.root_cause ? (
            <div className="small" style={{ marginTop: 8 }}>
              Known root cause: <span className="mono">{incident.root_cause}</span>
            </div>
          ) : null}
          {incident.lesson ? (
            <div className="small muted" style={{ marginTop: 4 }}>
              Lesson: {incident.lesson}
            </div>
          ) : null}
        </Section>

        <Section title="Hindsight memory (recall)">
          {memory ? (
            <>
              <div className="small muted">
                Recall query: <span className="mono">{memory.query}</span>
              </div>
              <div className="small">
                Ready: {memory.ready ? "yes" : "no"} · recalled {memory.recalled_count} ·{" "}
                {memory.incident_ids.length ? memory.incident_ids.join(", ") : "no incident refs"}
              </div>
              {memory.memories.length > 0 ? (
                <div className="row" style={{ marginTop: 8 }}>
                  {memory.memories.slice(0, 3).map((m, i) => (
                    <MemoryCard key={m.memory_id ?? i} mem={m} idx={i} />
                  ))}
                </div>
              ) : (
                <Empty title="No recalled memories yet." />
              )}
              {memory.lessons.length > 0 ? (
                <div className="small" style={{ marginTop: 8 }}>
                  <span className="muted">Lessons: </span>
                  {memory.lessons.slice(0, 2).join(" — ")}
                </div>
              ) : null}
            </>
          ) : (
            <Spinner />
          )}
        </Section>
      </div>

      <Section title="Investigation">
        <div className="row" style={{ alignItems: "center" }}>
          {(["baseline", "memory", "live"] as const).map((kind) => (
            <button
              key={kind}
              className={`btn${kind === "baseline" ? " ghost" : ""}`}
              disabled={busy}
              onClick={() => void runInvestigation(kind)}
            >
              {kind === "baseline"
                ? "Run baseline (no memory)"
                : kind === "memory"
                  ? "Run with memory"
                  : "Run live LLM"}
            </button>
          ))}
        </div>

        {active ? (
          <>
            <div className="small muted" style={{ marginTop: 12 }}>
              Run #{active.id} · {active.kind} · status <b>{active.status}</b>
              {active.engine ? ` · engine ${active.engine}` : ""} (
              {active.used_fallback ? "fallback" : active.llm_model ?? "live"})
            </div>

            <h2 style={{ marginTop: 14 }}>Planned strategy</h2>
            <StepChips steps={active.strategy} />

            {active.recall_query ? (
              <div className="small muted" style={{ marginTop: 6 }}>
                Recall: {active.recalled_count} memories ·{" "}
                <span className="mono">{active.recall_query}</span>
                {active.memory_summary ? (
                  <div className="small" style={{ marginTop: 4 }}>
                    {active.memory_summary}
                  </div>
                ) : null}
              </div>
            ) : null}

            {active.root_cause_candidate ? (
              <div className="ok-box" style={{ marginTop: 10 }}>
                Root-cause candidate:{" "}
                <b>{String(active.root_cause_candidate.layer)}</b>
                {active.root_cause_candidate.confidence != null
                  ? ` (confidence ${String(active.root_cause_candidate.confidence)})`
                  : ""}
              </div>
            ) : null}

            <h2 style={{ marginTop: 14 }}>Agent actions & tool results</h2>
            {steps.length ? steps.map((s) => <ToolResultLine key={s.id} step={s} />) : <Spinner />}

            {active.retained_at ? (
              <div className="ok-box" style={{ marginTop: 10 }}>
                Experience retained to Hindsight at {active.retained_at}.
              </div>
            ) : null}
            {active.resolution ? (
              <div className="small" style={{ marginTop: 8 }}>
                Resolution: <span className="mono">{active.resolution}</span>
              </div>
            ) : null}
            {active.feedback_kind ? (
              <div className="small muted" style={{ marginTop: 4 }}>
                Engineer feedback: {active.feedback_kind}
                {active.feedback_text ? ` — ${active.feedback_text}` : ""}
              </div>
            ) : null}
          </>
        ) : (
          <Empty title="No investigation run yet — hit an investigate button to plan and execute one." />
        )}

        <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
          <button
            className="btn green"
            disabled={busy || !canFeedback}
            title={canFeedback ? "Accept the investigation and retain the experience" : ""}
            onClick={() => void sendFeedback("accept")}
          >
            Accept &amp; retain
          </button>
          <button
            className="btn red"
            disabled={busy || !canFeedback}
            onClick={() => void sendFeedback("reject")}
          >
            Reject
          </button>
          <input
            placeholder="Correction (e.g. 'check Redis earlier')"
            value={correctText}
            onChange={(e) => setCorrectText(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: 8,
              padding: 8,
            }}
          />
          <button
            className="btn"
            disabled={busy || !canFeedback || correctText.trim().length < 3}
            onClick={() => void sendFeedback("correct")}
          >
            Submit correction
          </button>
        </div>
        {!canFeedback && active ? (
          <div className="muted small" style={{ marginTop: 8 }}>
            Feedback is only available while a run awaits review.
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
          <input
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: 8,
              padding: 8,
            }}
            aria-label="resolution"
          />
          <button
            className="btn ghost"
            disabled={busy || !canResolve || resolution.trim().length < 3}
            onClick={() => void resolveIncident()}
          >
            Apply resolution
          </button>
        </div>
      </Section>
    </div>
  );
}