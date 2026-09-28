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
  if (kind === "replay") return "scripted replay";
  return "memory plan";
}