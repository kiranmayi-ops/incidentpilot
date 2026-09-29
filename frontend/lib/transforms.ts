// Pure data transforms derived from real API payloads.
// These are kept free of I/O so the learning story stays honest and testable:
// every number a screen shows comes from actual PostgreSQL rows or recall
// responses, never from hard-coded constants.

import type {
  Incident,
  LearningEvolutionItem,
  LearningStrategy,
} from "./api";

export interface ServiceStats {
  service: string;
  count: number;
  incident_ids: string[];
}

export interface DashboardStats {
  total: number;
  by_status: Record<string, number>;
  resolved: number;
  active: number;
  services: ServiceStats[];
  top_severity: string | null;
}

export function dashboardStats(items: Incident[]): DashboardStats {
  const by_status: Record<string, number> = {};
  const serviceMap = new Map<string, string[]>();
  let topSev: string | null = null;
  let topSevCount = 0;

  for (const inc of items) {
    by_status[inc.status] = (by_status[inc.status] ?? 0) + 1;
    const list = serviceMap.get(inc.service) ?? [];
    list.push(inc.incident_id);
    serviceMap.set(inc.service, list);
    const sev = inc.severity;
    const sevCount = items.filter((c) => c.severity === sev).length;
    if (sevCount > topSevCount) {
      topSevCount = sevCount;
      topSev = sev;
    }
  }

  const services: ServiceStats[] = [...serviceMap.entries()]
    .map(([service, ids]) => ({ service, count: ids.length, incident_ids: ids }))
    .sort((a, b) => b.count - a.count);

  const resolved = by_status["resolved"] ?? 0;
  const active = items.length - resolved;

  return { total: items.length, by_status, resolved, active, services, top_severity: topSev };
}

export interface Efficiency {
  completed_runs: number;
  retained_runs: number;
  retention_rate: number | null;
  avg_steps: number | null;
  first_step_counts: Record<string, number>;
}

export function efficiencyFromEvolution(items: LearningEvolutionItem[]): Efficiency {
  const completed = items.length;
  const retained = items.filter((it) => it.retained).length;
  const totalSteps = items.reduce((acc, it) => acc + it.path.length, 0);
  const first: Record<string, number> = {};
  for (const it of items) {
    if (it.path[0]) first[it.path[0]] = (first[it.path[0]] ?? 0) + 1;
  }
  return {
    completed_runs: completed,
    retained_runs: retained,
    retention_rate: completed === 0 ? null : Math.round((retained / completed) * 100),
    avg_steps: completed === 0 ? null : +((totalSteps / completed).toFixed(1)),
    first_step_counts: first,
  };
}

export interface LearnedOverview {
  total_runs: number;
  strategy: LearningStrategy["strategy"];
  why: LearningStrategy["why"];
  computed_from: string;
  top_pattern: string | null;
}

export function learnedOverview(strategy: LearningStrategy, evolutionItems: number): LearnedOverview {
  const top = strategy.strategy[0] ?? null;
  return {
    total_runs: evolutionItems,
    strategy: strategy.strategy,
    why: strategy.why,
    computed_from: strategy.computed_from,
    top_pattern: top ? `${top.step} (${top.first_choice_count}× first)` : null,
  };
}

export function pathToStepsLabel(kind: string): string {
  if (kind === "baseline") return "baseline plan";
  if (kind === "live") return "live plan";
  if (kind === "replay") return "scripted feedback";
  return "memory plan";
}

export function kindLabel(kind: string): string {
  if (kind === "baseline") return "Baseline plan";
  if (kind === "live") return "Live plan";
  if (kind === "replay") return "Scripted feedback";
  return "Memory plan";
}

/* ---------- Metric display helpers ---------- */

export interface MetricView {
  key: string;
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}

interface MetricDef {
  key: string;
  label: string;
  unit?: string;
  pct?: boolean;
  /** Tone warn when the value is at or above this threshold. */
  warn?: number;
  /** Tone bad when the value is at or above this threshold. */
  bad?: number;
  /** Tone warn when the value falls below this threshold (e.g. throughput). */
  warnBelow?: number;
  /** Tone bad when the value falls below this threshold (e.g. throughput). */
  badBelow?: number;
}

const METRIC_DEFS: MetricDef[] = [
  { key: "latency_p99_ms", label: "p99 latency", unit: " ms", warn: 300, bad: 1000 },
  { key: "error_rate_pct", label: "Error rate", unit: "%", warn: 2, bad: 5 },
  { key: "throughput_rps", label: "Throughput", unit: " rps", warnBelow: 300, badBelow: 100 },
  { key: "db_connection_utilization", label: "DB connections", pct: true, warn: 0.6, bad: 0.85 },
  { key: "postgres_connection_utilization", label: "Postgres connections", pct: true, warn: 0.6, bad: 0.85 },
  { key: "redis_connection_utilization", label: "Redis connections", pct: true, warn: 0.6, bad: 0.85 },
  { key: "memory_utilization", label: "Memory", pct: true, warn: 0.75, bad: 0.9 },
  { key: "queue_depth", label: "Queue depth", warn: 40, bad: 100 },
  { key: "replicas_restarted_last_1h", label: "Restarts (1h)", warn: 1, bad: 5 },
  { key: "k8s_restarts_last_1h", label: "Restarts (1h)", warn: 1, bad: 5 },
];

export function formatMetrics(metrics: Record<string, number | string>): MetricView[] {
  return METRIC_DEFS.filter((d) => metrics[d.key] !== undefined && metrics[d.key] !== null)
    .map((d) => {
      const raw = metrics[d.key];
      const num = typeof raw === "number" ? raw : Number(raw);
      let value: string;
      let tone: MetricView["tone"];
      let numeric: number | null = null;
      if (d.pct && Number.isFinite(num)) {
        numeric = num;
        value = `${Math.round(num * 100)}%`;
      } else if (Number.isFinite(num)) {
        numeric = num;
        value = d.unit === "%" ? `${Math.round(num)}%` : `${num}${d.unit ?? ""}`;
      } else {
        value = String(raw);
      }
      if (numeric !== null) {
        if (d.bad !== undefined && numeric >= d.bad) tone = "bad";
        else if (d.warn !== undefined && numeric >= d.warn) tone = "warn";
        else if (d.badBelow !== undefined && numeric < d.badBelow) tone = "bad";
        else if (d.warnBelow !== undefined && numeric < d.warnBelow) tone = "warn";
      }
      return { key: d.key, label: d.label, value, tone };
    });
}

export function fmtShortDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return ts;
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate(),
  ).padStart(2, "0")}`;
}

/* ---------- Agent activity on the incident list ---------- */

export interface AgentActivity {
  first_step: string | null;
  feedback_kind: string | null;
  retained: boolean | null;
}

export function incidentActivity(
  incidents: Incident[],
  evolution: LearningEvolutionItem[],
): Map<string, AgentActivity> {
  const byIncident = new Map<string, LearningEvolutionItem[]>();
  for (const it of evolution) {
    const list = byIncident.get(it.incident_id) ?? [];
    list.push(it);
    byIncident.set(it.incident_id, list);
  }
  const result = new Map<string, AgentActivity>();
  for (const inc of incidents) {
    const items = byIncident.get(inc.incident_id);
    const last = items && items.length > 0 ? items[items.length - 1] : null;
    result.set(inc.incident_id, {
      first_step: last?.first_step ?? null,
      feedback_kind: last?.feedback_kind ?? null,
      retained: last ? last.retained : null,
    });
  }
  return result;
}

/* ---------- First-step distribution ---------- */

export function firstStepDistribution(
  items: LearningEvolutionItem[],
): Array<{ label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const it of items) {
    if (!it.first_step) continue;
    counts[it.first_step] = (counts[it.first_step] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/* ---------- Baseline vs memory before/after comparison ---------- */

export interface BeforeAfter {
  incident_id: string;
  before: string | null;
  after: string | null;
}

export function beforeAfter(items: LearningEvolutionItem[]): BeforeAfter | null {
  const groups = new Map<string, LearningEvolutionItem[]>();
  for (const it of items) {
    const list = groups.get(it.incident_id) ?? [];
    list.push(it);
    groups.set(it.incident_id, list);
  }
  const candidates: Array<[string, LearningEvolutionItem[]]> = [];
  for (const [incident_id, list] of groups) {
    const baseline = list.some((it) => it.kind === "baseline");
    const memory = list.some((it) => it.kind === "memory" || it.kind === "live");
    if (baseline && memory) candidates.push([incident_id, list]);
  }
  candidates.sort((a, b) => b[1].length - a[1].length);
  if (candidates.length === 0) return null;
  const [incident_id, list] = candidates[0];
  const beforeList = list
    .filter((it) => it.kind === "baseline")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const afterList = list
    .filter((it) => it.kind === "memory" || it.kind === "live")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    incident_id,
    before: beforeList[0]?.first_step ?? null,
    after: afterList[0]?.first_step ?? null,
  };
}

/* ---------- Per-service first-step patterns ---------- */

export interface ServicePattern {
  service: string;
  first_step: string;
  count: number;
}

export function servicePatterns(
  incidents: Incident[],
  evolution: LearningEvolutionItem[],
): ServicePattern[] {
  const serviceById = new Map(incidents.map((i) => [i.incident_id, i.service]));
  const counts = new Map<string, number>();
  for (const it of evolution) {
    const service = serviceById.get(it.incident_id);
    if (!service || !it.first_step) continue;
    const key = `${service} → ${it.first_step}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [service, first_step] = key.split(" → ");
      return { service, first_step, count };
    })
    .sort((a, b) => b.count - a.count);
}

/* ============================================================================
   Presentation helpers for the v3 surfaces.
   Still pure and I/O-free: everything below is derived from API payloads.
   ========================================================================== */

/** Normalised severity: "SEV-1" / "sev1" / "1" → "SEV1". */
export function severityKey(severity: string): "SEV1" | "SEV2" | "SEV3" | "SEV4" | "SEV5" {
  const digits = severity.replace(/[^0-9]/g, "");
  if (digits === "1") return "SEV1";
  if (digits === "2") return "SEV2";
  if (digits === "3") return "SEV3";
  if (digits === "4") return "SEV4";
  return "SEV5";
}

export function severityTone(severity: string): "sev1" | "sev2" | "sev3" {
  const k = severityKey(severity);
  return k === "SEV1" ? "sev1" : k === "SEV2" ? "sev2" : "sev3";
}

export const SEVERITY_ORDER: Array<"SEV1" | "SEV2" | "SEV3"> = ["SEV1", "SEV2", "SEV3"];

/** Worst-severity-first, then most recent, then id — the on-call ordering. */
export function bySeverityThenRecency(items: Incident[]): Incident[] {
  const rank: Record<string, number> = { SEV1: 0, SEV2: 1, SEV3: 2, SEV4: 3, SEV5: 4 };
  return [...items].sort((a, b) => {
    const s = (rank[severityKey(a.severity)] ?? 9) - (rank[severityKey(b.severity)] ?? 9);
    if (s !== 0) return s;
    const t = b.timestamp.localeCompare(a.timestamp);
    if (t !== 0) return t;
    return a.incident_id.localeCompare(b.incident_id);
  });
}

export type StatusTone = "ok" | "warn" | "bad" | "info" | "neutral";

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "resolved":
    case "completed":
      return "ok";
    case "detected":
    case "open":
    case "feedback":
      return "warn";
    case "investigating":
      return "info";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "detected":
      return "Detected";
    case "investigating":
      return "Investigating";
    case "feedback":
      return "Awaiting review";
    case "completed":
      return "Completed";
    case "resolved":
      return "Resolved";
    default:
      return status;
  }
}

export function feedbackTone(kind: string | null): StatusTone | null {
  if (!kind) return null;
  if (kind === "accept") return "ok";
  if (kind === "reject") return "bad";
  if (kind === "correct") return "warn";
  return "neutral";
}

export function feedbackLabel(kind: string | null): string | null {
  if (!kind) return null;
  if (kind === "accept") return "Accepted";
  if (kind === "reject") return "Rejected";
  if (kind === "correct") return "Corrected";
  return kind;
}

/* ---------- Service catalog rollup ---------- */

export interface ServiceRollup {
  service: string;
  total: number;
  active: number;
  resolved: number;
  worst: "SEV1" | "SEV2" | "SEV3" | "SEV4" | "SEV5";
  environments: string[];
  incident_ids: string[];
  first_step: string | null;
  first_step_count: number;
}

const WORST: Record<string, number> = { SEV1: 0, SEV2: 1, SEV3: 2, SEV4: 3, SEV5: 4 };

export function serviceRollups(
  incidents: Incident[],
  evolution: LearningEvolutionItem[],
): ServiceRollup[] {
  const byService = new Map<string, Incident[]>();
  for (const inc of incidents) {
    const list = byService.get(inc.service) ?? [];
    list.push(inc);
    byService.set(inc.service, list);
  }
  const stepsByService = new Map<string, Map<string, number>>();
  for (const it of evolution) {
    const svc = incidents.find((i) => i.incident_id === it.incident_id)?.service;
    // A baseline run is the pre-memory control: recall is switched off by
    // design, so its opening step is not something the agent *learned*.
    if (!svc || !it.first_step || it.kind === "baseline") continue;
    const counts = stepsByService.get(svc) ?? new Map<string, number>();
    counts.set(it.first_step, (counts.get(it.first_step) ?? 0) + 1);
    stepsByService.set(svc, counts);
  }
  return [...byService.entries()]
    .map(([service, list]) => {
      const resolved = list.filter((i) => i.status === "resolved" || i.status === "completed").length;
      const worst = list.reduce<(typeof WORST)[string] extends never ? never : keyof typeof WORST>(
        (acc, i) => {
          const k = severityKey(i.severity);
          return (WORST[k] ?? 9) < (WORST[acc] ?? 9) ? k : acc;
        },
        severityKey(list[0].severity),
      );
      const stepCounts = stepsByService.get(service);
      const top = stepCounts ? [...stepCounts.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
      return {
        service,
        total: list.length,
        active: list.length - resolved,
        resolved,
        worst: worst as ServiceRollup["worst"],
        environments: [...new Set(list.map((i) => i.environment))].sort(),
        incident_ids: list.map((i) => i.incident_id),
        first_step: top ? top[0] : null,
        first_step_count: top ? top[1] : 0,
      };
    })
    .sort((a, b) => {
      const w = (WORST[a.worst] ?? 9) - (WORST[b.worst] ?? 9);
      if (w !== 0) return w;
      if (b.active !== a.active) return b.active - a.active;
      return b.total - a.total;
    });
}

/* ---------- Engine health summary ---------- */

export interface EngineSummary {
  state: "pending" | "ok" | "degraded" | "unreachable";
  label: string;
  memory: string;
  memoryTone: "ok" | "warn" | "bad" | "neutral";
  database: string;
  version: string;
  demo: boolean;
}

export function engineSummary(
  health: { status?: string; hindsight?: Record<string, unknown>; database?: Record<string, unknown>; version?: string; demo_mode?: boolean } | null,
): EngineSummary {
  if (!health) {
    return {
      state: "pending",
      label: "Connecting",
      memory: "…",
      memoryTone: "neutral",
      database: "…",
      version: "—",
      demo: false,
    };
  }
  const status = String(health.status ?? "unreachable");
  const memory = String(health.hindsight?.status ?? "unknown");
  const database = String(health.database?.status ?? "unknown");
  const memoryTone: EngineSummary["memoryTone"] =
    memory === "ok" ? "ok" : memory === "unconfigured" || memory === "degraded" ? "warn" : "bad";
  return {
    state: status === "ok" ? "ok" : status === "degraded" ? "degraded" : "unreachable",
    label:
      status === "ok"
        ? "All systems nominal"
        : status === "degraded"
          ? "Running degraded"
          : "Engine unreachable",
    memory,
    memoryTone,
    database,
    version: health.version ?? "—",
    demo: Boolean(health.demo_mode),
  };
}

/* ---------- Investigation progress ---------- */

export interface RunProgress {
  executed: number;
  planned: number;
  pct: number;
  degraded: number;
}

export function runProgress(
  strategy: Array<{ step: string }> | null | undefined,
  steps: Array<{ tool: string; result_status: string | null }>,
): RunProgress {
  const planned = strategy?.length ?? 0;
  const executed = steps.length;
  const degraded = steps.filter((s) => s.result_status === "degraded").length;
  return {
    executed,
    planned,
    degraded,
    pct: planned === 0 ? 0 : Math.min(100, Math.round((executed / planned) * 100)),
  };
}

/* ---------- Human-readable relative time ---------- */

export function fmtRelative(ts: string | null | undefined): string {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return ts;
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtShortDate(ts);
}

/* ---------- Investigation savings estimate ---------- */

export interface SavingsEstimate {
  /** Tool checks the agent did NOT have to run before it found the cause. */
  checksSkipped: number;
  /** Baseline order position of the memory-chosen first step (1-based). */
  baselineRank: number | null;
  /** Where the memory-informed agent placed it instead. */
  memoryRank: number;
}

export function savingsEstimate(
  baseline: Array<{ step: string }> | null | undefined,
  memory: Array<{ step: string }> | null | undefined,
): SavingsEstimate | null {
  const first = memory?.[0]?.step;
  if (!first) return null;
  const idx = (baseline ?? []).findIndex((s) => s.step === first);
  const baselineRank = idx >= 0 ? idx + 1 : null;
  return {
    checksSkipped: baselineRank && baselineRank > 1 ? baselineRank - 1 : 0,
    baselineRank,
    memoryRank: 1,
  };
}