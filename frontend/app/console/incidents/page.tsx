"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ConsoleShell } from "../../console-shell";
import {
  Button,
  Empty,
  IncidentRow,
  Kpi,
  Loading,
  Note,
  Panel,
  SeverityPill,
  StatusPill,
  TierPill,
} from "../../console-ui";
import { Icon } from "../../lib/icons";
import {
  EngineAPI,
  type Incident,
  type LearningEvolutionItem,
} from "@/lib/api";
import {
  bySeverityThenRecency,
  dashboardStats,
  fmtRelative,
  incidentActivity,
  severityKey,
  SEVERITY_ORDER,
} from "@/lib/transforms";

type SevFilter = "all" | "SEV1" | "SEV2" | "SEV3";
type SortKey = "severity" | "recent" | "service";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "severity", label: "Severity" },
  { key: "recent", label: "Newest" },
  { key: "service", label: "Service" },
];

function CatalogBody() {
  const params = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const initialService = params.get("service") ?? "all";

  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [evolution, setEvolution] = useState<LearningEvolutionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [sev, setSev] = useState<SevFilter>("all");
  const [service, setService] = useState(initialService);
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState<SortKey>("severity");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inc, evo] = await Promise.all([
        EngineAPI.incidents(),
        EngineAPI.learningEvolution(),
      ]);
      setIncidents(inc.items);
      setEvolution(evo.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activity = useMemo(
    () => (incidents && evolution ? incidentActivity(incidents, evolution) : new Map()),
    [incidents, evolution],
  );

  const services = useMemo(() => {
    const set = new Set((incidents ?? []).map((i) => i.service));
    return [...set].sort();
  }, [incidents]);

  const tiers = useMemo(() => {
    const set = new Set((incidents ?? []).map((i) => i.tier));
    return [...set].sort();
  }, [incidents]);

  const sevCounts = useMemo(() => {
    const out: Record<string, number> = { SEV1: 0, SEV2: 0, SEV3: 0 };
    for (const i of incidents ?? []) {
      const k = severityKey(i.severity);
      if (k in out) out[k] += 1;
    }
    return out;
  }, [incidents]);

  const filtered = useMemo(() => {
    let list = incidents ?? [];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        [
          i.incident_id,
          i.service,
          i.environment,
          i.severity,
          i.status,
          i.root_cause ?? "",
          i.resolution ?? "",
          ...i.symptoms,
          activity.get(i.incident_id)?.first_step ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (sev !== "all") list = list.filter((i) => severityKey(i.severity) === sev);
    if (service !== "all") list = list.filter((i) => i.service === service);
    if (tier !== "all") list = list.filter((i) => i.tier === tier);

    if (sort === "severity") return bySeverityThenRecency(list);
    if (sort === "recent") {
      return [...list].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    return [...list].sort(
      (a, b) => a.service.localeCompare(b.service) || b.timestamp.localeCompare(a.timestamp),
    );
  }, [incidents, query, sev, service, tier, sort, activity]);

  const stats = useMemo(() => (incidents ? dashboardStats(incidents) : null), [incidents]);
  const activeFilters = (sev !== "all" ? 1 : 0) + (service !== "all" ? 1 : 0) + (tier !== "all" ? 1 : 0) + (query.trim() ? 1 : 0);

  function reset() {
    setQuery("");
    setSev("all");
    setService("all");
    setTier("all");
  }

  if (error && !incidents) {
    return (
      <>
        <Note tone="bad" title="Could not load the incident catalog">
          {error}
        </Note>
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" icon="rotate" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  if (!incidents || !stats || !evolution) return <Loading rows={8} />;

  return (
    <div className="cs-stack">
      <div className="cs-grid-2" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <Kpi
          label="In catalog"
          value={stats.total}
          hint={`${services.length} services · ${tiers.length} ${tiers.length === 1 ? "tier" : "tiers"}`}
          tone="evd"
        />
        <Kpi
          label="SEV1 open"
          value={incidents.filter((i) => severityKey(i.severity) === "SEV1" && i.status !== "resolved").length}
          hint={`${sevCounts.SEV1} total SEV1`}
          tone={sevCounts.SEV1 > 0 ? "bad" : "ok"}
        />
        <Kpi
          label="Awaiting review"
          value={incidents.filter((i) => i.status === "feedback").length}
          hint="Runs waiting on an engineer verdict"
          tone="warn"
        />
        <Kpi
          label="Resolved"
          value={stats.resolved}
          hint={`${stats.active} still active`}
          tone="ok"
        />
      </div>

      <Panel
        title="Incident catalog"
        icon="pulse"
        meta={
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {filtered.length} of {incidents.length} shown
          </span>
        }
        flush
        action={
          activeFilters > 0 ? (
            <Button size="sm" variant="ghost" icon="x-circle" onClick={reset}>
              Clear {activeFilters} filter{activeFilters > 1 ? "s" : ""}
            </Button>
          ) : null
        }
      >
        <div className="cs-toolbar" style={{ background: "var(--panel)" }}>
          <div className="cs-search">
            <Icon name="search" />
            <input
              type="search"
              value={query}
              placeholder="Search id, service, symptom, root cause…"
              aria-label="Search incidents"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="cs-seg" role="group" aria-label="Filter by severity">
            <button type="button" aria-pressed={sev === "all"} onClick={() => setSev("all")}>
              All<span className="n">{incidents.length}</span>
            </button>
            {SEVERITY_ORDER.map((k) => (
              <button key={k} type="button" aria-pressed={sev === k} onClick={() => setSev(k)}>
                {k}
                <span className="n">{sevCounts[k]}</span>
              </button>
            ))}
          </div>

          <select
            className="cs-select"
            style={{ width: "auto", minWidth: 150 }}
            value={service}
            aria-label="Filter by service"
            onChange={(e) => setService(e.target.value)}
          >
            <option value="all">All services</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="cs-select"
            style={{ width: "auto", minWidth: 120 }}
            value={tier}
            aria-label="Filter by tier"
            onChange={(e) => setTier(e.target.value)}
          >
            <option value="all">All tiers</option>
            {tiers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="cs-seg" role="group" aria-label="Sort incidents" style={{ marginLeft: "auto" }}>
            {SORTS.map((s) => (
              <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty title="No incidents match these filters">
            Widen the severity or service filter, or clear the search box.
          </Empty>
        ) : (
          <div>
            {filtered.map((inc) => (
              <IncidentRow key={inc.incident_id} incident={inc} activity={activity.get(inc.incident_id)} />
            ))}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="cs-panel-note">
            Showing {filtered.length} incident{filtered.length === 1 ? "" : "s"}
            {sort === "severity" && " ordered worst-severity first, then most recent"}
            {sort === "recent" && " ordered newest first"}
            {sort === "service" && " ordered by service name"}.
          </div>
        )}
      </Panel>

      <Panel title="What each row tells you" icon="book">
        <div className="cs-grid-3">
          <div>
            <div className="cs-label">Memory chip</div>
            <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
              The first tool the agent actually opened this incident with, lifted from the
              investigation run. It is the clearest sign memory changed the plan.
            </p>
          </div>
          <div>
            <div className="cs-label">Verdict</div>
            <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
              <FeedbackLegend /> Whether the engineer accepted, corrected, or rejected the run&apos;s
              diagnosis. Rejected runs are deliberately not written back to memory.
            </p>
          </div>
          <div>
            <div className="cs-label">Freshness</div>
            <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
              Severity, lifecycle status and knowledge tier are read straight from the incident
              record in PostgreSQL —{" "}
              {incidents[0] ? `most recent observed ${fmtRelative(incidents[0].created_at)}` : "no rows yet"}.
            </p>
          </div>
        </div>
        <div className="cs-stack-sm" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SeverityPill severity="SEV-1" />
          <SeverityPill severity="SEV-2" />
          <SeverityPill severity="SEV-3" />
          <StatusPill status="detected" />
          <StatusPill status="investigating" />
          <StatusPill status="feedback" />
          <StatusPill status="resolved" />
          <TierPill tier="tier1" />
          <TierPill tier="demo" />
        </div>
      </Panel>
    </div>
  );
}

function FeedbackLegend() {
  return (
    <span style={{ display: "inline-flex", gap: 5, verticalAlign: "middle" }}>
      <span className="cs-pill ok">Accepted</span>
      <span className="cs-pill warn">Corrected</span>
      <span className="cs-pill bad">Rejected</span>
    </span>
  );
}

export default function IncidentsPage() {
  return (
    <ConsoleShell
      title="Incidents"
      lede="Every incident in the catalog, searchable, filterable, and annotated with what the investigation agent actually did."
    >
      <Suspense fallback={<Loading rows={8} />}>
        <CatalogBody />
      </Suspense>
    </ConsoleShell>
  );
}
