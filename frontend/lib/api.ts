// Typed client for the IncidentPilot FastAPI backend.
// All shapes mirror the Pydantic schemas in backend/app/schemas/api.py.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`.trim() || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

// --------------------------------------------------------------- types

export interface Health {
  status: string;
  database: Record<string, unknown>;
  hindsight: Record<string, unknown>;
  demo_mode: boolean;
  version: string;
}

export interface Incident {
  incident_id: string;
  tier: string;
  timestamp: string;
  service: string;
  environment: string;
  severity: string;
  status: string;
  symptoms: string[];
  metrics: Record<string, number | string>;
  root_cause: string | null;
  resolution: string | null;
  lesson: string | null;
  created_at: string;
}

export interface IncidentList {
  total: number;
  items: Incident[];
}

export interface StrategyStep {
  step: string;
  hypothesis: string | null;
  reason: string | null;
  confidence: number | null;
  priority: number;
}

export interface RunSummary {
  id: number;
  incident_id: string;
  kind: string;
  status: string;
  engine: string | null;
  used_fallback: boolean;
  llm_model: string | null;
  recall_query: string | null;
  recalled_count: number | null;
  memory_ready: boolean;
  strategy: StrategyStep[];
  memory_summary: string | null;
  feedback_kind: string | null;
  feedback_text: string | null;
  outcome_resolved: boolean | null;
  root_cause_candidate: Record<string, unknown> | null;
  resolution: string | null;
  retained_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface StepResult {
  id: number;
  run_id: number;
  order: number;
  tool: string;
  hypothesis: string | null;
  reason: string | null;
  confidence: number | null;
  result_status: string | null;
  evidence: Record<string, unknown>;
  records: Array<Record<string, unknown>>;
  useful: boolean | null;
  created_at: string;
}

export interface FeedbackRecord {
  id: number;
  run_id: number;
  kind: string;
  text: string | null;
  created_at: string;
}

export interface Timeline {
  run: RunSummary;
  steps: StepResult[];
  feedback: FeedbackRecord[];
}

export interface RecallSummary {
  query: string;
  count: number;
  incident_ids: string[];
  memory_ready: boolean;
  note: string | null;
}

export interface InvestigateResponse {
  run_id: number;
  incident_id: string;
  kind: string;
  status: string;
  recall: RecallSummary;
  strategy: StrategyStep[];
  root_cause_candidate: Record<string, unknown> | null;
  used_fallback: boolean;
  memory_summary: string | null;
  steps: StepResult[];
}

export interface FeedbackResponse {
  run_id: number;
  status: string;
  retained: boolean;
  retained_at: string | null;
  reason: string | null;
}

export interface ResolveResponse {
  run_id: number;
  status: string;
  retained: boolean;
}

export interface RecalledMemory {
  memory_id: string;
  incident_ids: string[];
  text: string;
  confidence?: number | null;
}

export interface MemoryPanel {
  query: string;
  ready: boolean;
  recalled_count: number;
  incident_ids: string[];
  memories: RecalledMemory[];
  lessons: string[];
  stats: Record<string, unknown>;
}

export interface LearningEvolutionItem {
  incident_id: string;
  kind: string;
  path: string[];
  first_step: string | null;
  feedback_kind: string | null;
  retained: boolean;
  created_at: string;
}

export interface LearningEvolution {
  items: LearningEvolutionItem[];
}

export interface LearnedStep {
  step: string;
  priority: number;
  reason: string;
  first_choice_count: number;
  engineer_confirmations: number;
  low_yield_count: number;
}

export interface LearningStrategy {
  strategy: LearnedStep[];
  why: {
    totals?: {
      completed_runs?: number;
      retained_runs?: number;
      engineer_confirmations?: number;
    };
    [key: string]: unknown;
  };
  computed_from: string;
}

export interface DemoReset {
  bank_id: string;
  phase: string;
  status: string;
}

export interface DemoSeed {
  tier: string;
  seeded: string[];
  failures: string[];
}

// ----------------------------------------------------------------- calls

export const EngineAPI = {
  health: () => request<Health>("/health"),
  incidents: (tier?: string) =>
    request<IncidentList>(tier ? `/incidents?tier=${encodeURIComponent(tier)}` : "/incidents"),
  incident: (id: string) => request<Incident>(`/incidents/${encodeURIComponent(id)}`),
  incidentTimeline: (id: string) =>
    request<Timeline>(`/incidents/${encodeURIComponent(id)}/timeline`),
  incidentRuns: (id: string) =>
    request<RunSummary[]>(`/incidents/${encodeURIComponent(id)}/runs`),
  investigate: (id: string, kind: "live" | "memory" | "baseline" | "replay") =>
    request<InvestigateResponse>(`/incidents/${encodeURIComponent(id)}/investigate`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
  runTimeline: (runId: number) =>
    request<Timeline>(`/incidents/runs/${runId}/timeline`),
  memory: (id: string) => request<MemoryPanel>(`/incidents/${encodeURIComponent(id)}/memory`),
  feedback: (
    id: string,
    kind: "accept" | "reject" | "correct",
    text?: string,
    runId?: number,
  ) =>
    request<FeedbackResponse>(`/incidents/${encodeURIComponent(id)}/feedback`, {
      method: "POST",
      body: JSON.stringify({ kind, text, run_id: runId }),
    }),
  resolve: (id: string, resolution: string, runId?: number) =>
    request<ResolveResponse>(`/incidents/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution, run_id: runId }),
    }),
  learningStrategy: () => request<LearningStrategy>("/learning/strategy"),
  learningEvolution: () => request<LearningEvolution>("/learning/evolution"),
};