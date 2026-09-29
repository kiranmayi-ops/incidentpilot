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
  warn?: number;
  bad?: number;
}

const METRIC_DEFS: MetricDef[] = [
  { key: "latency_p99_ms", label: "p99 latency", unit: " ms", warn: 300, bad: 1000 },
  { key: "error_rate_pct", label: "Error rate", unit: "%", warn: 2, bad: 5 },
  { key: "throughput_rps", label: "Throughput", unit: " rps", warn: 300, bad: 100 },
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