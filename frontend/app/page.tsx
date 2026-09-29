"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./lib/icons";
import { ThemeToggle, useRevealRoot } from "./lib/theme";

/* ============================================================== nav data == */

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "#how", label: "How it works" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#evidence", label: "Evidence" },
  { href: "#architecture", label: "Architecture" },
];

const FOOTER_COLS: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: "Product",
    links: [
      { label: "Open the console", href: "/console" },
      { label: "How it works", href: "#how" },
      { label: "Capabilities", href: "#capabilities" },
      { label: "Evidence", href: "#evidence" },
    ],
  },
  {
    title: "Workspace",
    links: [
      { label: "Overview", href: "/console" },
      { label: "Incident catalog", href: "/console/incidents" },
      { label: "Baseline vs memory", href: "/console/compare" },
      { label: "Learning evolution", href: "/console/learning" },
    ],
  },
  {
    title: "Reference",
    links: [
      { label: "Architecture", href: "#architecture" },
      { label: "Guardrails", href: "#guardrails" },
      {
        label: "Source repository",
        href: "https://github.com/kiranmayi-ops/incidentpilot",
        external: true,
      },
    ],
  },
];

/* ================================================================ hooks === */

function useStuck() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return stuck;
}

/* ============================================================== sections == */

function Hero() {
  return (
    <section className="mkt-hero">
      <div className="mkt-hero-mesh" aria-hidden="true" />
      <div className="mkt-hero-grid" aria-hidden="true" />
      <div className="mkt-hero-inner">
        <div>
          <span className="kicker brand">
            Memory-first incident response
            <span className="cs-pill mem" style={{ marginLeft: 4 }}>
              <i /> Hindsight-powered
            </span>
          </span>
          <h1 className="mkt-h1">
            Stop paying the same
            <br />
            <em>ten minutes</em> twice.
          </h1>
          <p className="mkt-lede">
            IncidentPilot is an SRE investigation agent with long-term memory. It recalls what your
            engineers already learned, challenges that memory against live telemetry, and opens the
            next investigation at the layer that actually broke — before the clock starts.
          </p>
          <div className="mkt-hero-actions">
            <Link href="/console" className="mkt-btn mkt-btn-primary mkt-btn-lg">
              Launch live demo
              <Icon name="arrow-right" />
            </Link>
            <Link href="/console/compare" className="mkt-btn mkt-btn-ghost mkt-btn-lg">
              <Icon name="scale" />
              See memory change a plan
            </Link>
          </div>
          <div className="mkt-hero-note">
            <span>
              <Icon name="check" /> Real recall, real feedback retention
            </span>
            <span>
              <Icon name="check" /> No mocked strategies
            </span>
            <span>
              <Icon name="check" /> Runs against your telemetry tools
            </span>
          </div>
        </div>

        <div className="mkt-shot" aria-label="Preview of the IncidentPilot investigation console">
          <div className="mkt-shot-bar">
            <div className="mkt-shot-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="mkt-shot-title mono">incidentpilot · INC-2001 · checkout-api</span>
          </div>
          <div className="mkt-shot-body">
            <div className="mkt-shot-row hi">
              <div>
                <div className="mkt-shot-row-t">checkout latency increased · 5xx</div>
                <div className="mkt-shot-row-s">
                  p99 1919ms · errors 4.98% · db pool 79%
                </div>
              </div>
              <span className="cs-pill bad">SEV1</span>
            </div>
            <div className="mkt-shot-row">
              <div>
                <div className="mkt-shot-row-t">Recalled from long-term memory</div>
                <div className="mkt-shot-row-s">3 experiences · 2 prior checkout-api incidents</div>
              </div>
              <span className="mkt-shot-step">3 recalled</span>
            </div>
            <div className="mkt-shot-row">
              <div>
                <div className="mkt-shot-row-t">Planned strategy</div>
                <div className="mkt-shot-row-s">memory-ranked, evidence-constrained</div>
              </div>
              <span className="mkt-shot-step">1. check_redis</span>
            </div>
            <div className="mkt-shot-row">
              <div>
                <div className="mkt-shot-row-t">Executed · check_redis</div>
                <div className="mkt-shot-row-s">pool 97% · 208 timeouts · 1094ms avg</div>
              </div>
              <span className="cs-pill bad">degraded</span>
            </div>
            <div className="mkt-shot-foot">
              <span>
                Engineer correction retained → next incident opens at{" "}
                <b>check_redis</b>
              </span>
              <Icon name="sparkles" size={16} style={{ color: "var(--memory)" }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    { n: "34", l: "Synthetic incidents across 4 evaluation tiers" },
    { n: "5", l: "Deterministic telemetry tools the agent can call" },
    { n: "2", l: "Memory channels: recalled prior vs live evidence" },
    { n: "0", l: "Hard-coded strategies or leaked ground truth" },
  ];
  return (
    <section className="mkt-strip">
      <div className="mkt-strip-inner">
        {items.map((s) => (
          <div className="mkt-strip-item" key={s.l}>
            <div className="mkt-strip-n">
              {s.n === "0" ? <em>0</em> : s.n}
            </div>
            <div className="mkt-strip-l">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const PIPELINE: Array<{ t: string; d: string; ch?: "memory" | "evidence"; code?: string }> = [
  {
    t: "Incident arrives",
    d: "Symptoms and live telemetry enter the workspace with service, environment and severity.",
    ch: "evidence",
  },
  {
    t: "Recall",
    d: "A query is drafted from the evidence and the memory bank is searched for past experience.",
    ch: "memory",
    code: "recall(top=n)",
  },
  {
    t: "Strategy",
    d: "Recalled memory, current signals and LLM reasoning are folded into one ranked tool order.",
  },
  {
    t: "Execute + review",
    d: "Tools run in order; the agent proposes a root cause and an engineer accepts or corrects it.",
  },
  {
    t: "Retain",
    d: "The episode — including the correction — is written back to long-term memory for next time.",
    ch: "memory",
  },
];

function HowItWorks() {
  return (
    <section className="mkt-section" id="how">
      <div className="mkt-section-head" data-reveal>
        <span className="kicker">The loop</span>
        <h2 className="mkt-h2">Five steps, and only one of them is new code</h2>
        <p className="mkt-sub">
          Every investigation runs the same loop. The only variable is what memory contributed to
          step three — which is precisely the point.
        </p>
      </div>
      <div className="mkt-steps" data-reveal>
        {PIPELINE.map((s, i) => (
          <div className="mkt-step" key={s.t} data-channel={s.ch}>
            <div className="mkt-step-n">{String(i + 1).padStart(2, "0")}</div>
            <h4>{s.t}</h4>
            <p>
              {s.d}
              {s.code ? (
                <>
                  {" "}
                  <code>{s.code}</code>
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProblemSolution() {
  return (
    <section className="mkt-section tight">
      <div className="mkt-section-head center" data-reveal>
        <span className="kicker">Why it matters</span>
        <h2 className="mkt-h2">Runbooks rot. Memory doesn&apos;t — if it can be questioned.</h2>
      </div>
      <div className="mkt-split" data-reveal>
        <article className="mkt-card bad">
          <div className="mkt-card-tag">
            <Icon name="clock" />
            Without memory
          </div>
          <h3>The first ten minutes are guesswork</h3>
          <p>
            On-call engineers re-run the same top-down checklist on every incident. The wiki page was
            written after an incident two years ago, the runbook has not been updated since, and
            nobody remembers that Redis was the culprit last Tuesday.
          </p>
          <ul>
            <li>
              <Icon name="x-circle" />
              The right answer lives in three engineers&apos; heads and one dead Slack thread
            </li>
            <li>
              <Icon name="x-circle" />
              The same five checks burn the window before anyone touches the actual failure
            </li>
            <li>
              <Icon name="x-circle" />
              Every incident response starts from zero, so nothing compounds
            </li>
          </ul>
        </article>
        <article className="mkt-card good">
          <div className="mkt-card-tag">
            <Icon name="brain" />
            With IncidentPilot
          </div>
          <h3>The next incident starts where the last one ended</h3>
          <p>
            Each resolved incident — and each engineer correction — is retained as an experience
            narrative in vectorised long-term memory. The next similar incident recalls it, ranks it
            against fresh telemetry, and reorders the plan accordingly.
          </p>
          <ul>
            <li>
              <Icon name="check-circle" />
              Recall is automatic and similarity-based, not a checklist someone maintains
            </li>
            <li>
              <Icon name="check-circle" />
              Live evidence is always a ranking input, so stale memory is demoted automatically
            </li>
            <li>
              <Icon name="check-circle" />
              Every correction is a training signal that lands in memory the same day
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}

const BENTO: Array<{
  span: 2 | 3 | 6;
  icon: IconName;
  ic: "brand" | "mem" | "evd";
  t: string;
  d: string;
  mini?: { v: string; l: string };
}> = [
  {
    span: 3,
    icon: "brain",
    ic: "mem",
    t: "Long-term memory, not a rules table",
    d: "Experience narratives — symptoms taken, steps that paid off, steps that were dead ends, the final root cause and the engineer's own correction — are embedded and recalled by similarity. Nothing is a hard-coded per-service order.",
    mini: { v: "top(n)", l: "similarity recall per investigation" },
  },
  {
    span: 3,
    icon: "scale",
    ic: "evd",
    t: "A contradiction gate, not a rubber stamp",
    d: "Memory is a prior, never a mandate. When live telemetry contradicts a recalled lesson, the engine zeroes the stale prior and re-ranks on evidence — the failure mode that makes most memory-driven agents dangerous in production.",
  },
  {
    span: 3,
    icon: "terminal",
    ic: "evd",
    t: "Tools that report telemetry, not answers",
    d: "check_metrics, query_logs, check_database, check_redis, check_recent_deployments. Deterministic, allowlisted and scoped per incident — the same tool returns opposite evidence for two incidents on the same service.",
  },
  {
    span: 3,
    icon: "plug",
    ic: "evd",
    t: "LLM reasoning with a deterministic fallback",
    d: "Strategy is produced as validated structural JSON, constrained to the tool allowlist with cited incident ids cross-checked against real recall output. If the provider is down, memory + evidence ranking still produces a plan.",
  },
  {
    span: 6,
    icon: "git-branch",
    ic: "mem",
    t: "Every run is reproducible: run it with memory, run it without, diff the two",
    d: "The Baseline vs Memory view executes the same incident twice — once with recall disabled, once enabled — and shows you the first check each run opened at, the plan behind it, and the tool output that followed. When the first check differs, you are looking at memory doing real work.",
    mini: { v: "2×", l: "same incident, same tools, different opening move" },
  },
];

function Capabilities() {
  return (
    <section className="mkt-section" id="capabilities">
      <div className="mkt-section-head" data-reveal>
        <span className="kicker">Capabilities</span>
        <h2 className="mkt-h2">Built to be inspected, not just believed</h2>
        <p className="mkt-sub">
          A memory-driven agent is only trustworthy if you can open the box. Every claim on this
          page is rendered from a real API response in the console.
        </p>
      </div>
      <div className="mkt-bento" data-reveal>
        {BENTO.map((c) => (
          <article
            className={`mkt-bento-card ${c.span === 3 ? "span-3" : c.span === 6 ? "span-6" : ""}`}
            key={c.t}
          >
            <div className={`mkt-bento-ic ${c.ic === "mem" ? "mem" : c.ic === "evd" ? "evd" : ""}`}>
              <Icon name={c.icon} />
            </div>
            <h3>{c.t}</h3>
            <p>{c.d}</p>
            {c.mini && (
              <div className="mkt-mini">
                <b>{c.mini.v}</b>
                <span>{c.mini.l}</span>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Evidence() {
  return (
    <section className="mkt-section" id="evidence">
      <div className="mkt-section-head center" data-reveal>
        <span className="kicker">Evidence, not adjectives</span>
        <h2 className="mkt-h2">Run it twice. Watch the opening move change.</h2>
        <p className="mkt-sub">
          The console runs both variants against the real engine. No screenshots, no fixtures — these
          are the two strategies the agent actually produced.
        </p>
      </div>
      <div className="mkt-compare" data-reveal>
        <div className="mkt-compare-side">
          <div className="mkt-compare-label">Baseline · recall disabled</div>
          <div className="mkt-compare-step">check_recent_deployments</div>
          <div className="mkt-compare-meta">
            Generic top-down evidence order. Healthy, then healthy, then degraded — the cause is
            found third.
          </div>
        </div>
        <div className="mkt-compare-rail" aria-hidden="true">
          <span>VS</span>
        </div>
        <div className="mkt-compare-side mem">
          <div className="mkt-compare-label">With memory · recall enabled</div>
          <div className="mkt-compare-step">check_redis</div>
          <div className="mkt-compare-meta">
            Two prior checkout-api episodes and an engineer correction were recalled, so the agent
            opened at the layer that actually broke.
          </div>
        </div>
      </div>
      <div className="mkt-hero-actions" style={{ justifyContent: "center", marginTop: 32 }} data-reveal>
        <Link href="/console/compare" className="mkt-btn mkt-btn-primary">
          Reproduce this comparison
          <Icon name="arrow-right" />
        </Link>
      </div>
    </section>
  );
}

function Guardrails() {
  return (
    <section className="mkt-section" id="guardrails">
      <div className="mkt-guard" data-reveal>
        <div>
          <div className="mkt-guard-ic">
            <Icon name="shield" />
          </div>
          <h3>Current evidence overrides memory. Always.</h3>
          <p>
            A memory system that cannot be wrong is a liability. IncidentPilot ranks recalled
            experience <em>alongside</em> live telemetry, and when the two disagree the contradiction
            gate discards the stale prior instead of following it. The evaluation set deliberately
            contains incidents where the recalled lesson is the wrong move.
          </p>
          <div className="mkt-stack" style={{ marginTop: 24 }}>
            <span>Contradiction gate</span>
            <span>Tool allowlist</span>
            <span>Cited-id cross-check</span>
            <span>Grounded JSON strategies</span>
          </div>
        </div>
        <div className="mkt-guard-demo">
          <h4>Counter-case in the eval set</h4>
          <div className="mkt-guard-line">
            <span>redis healthy</span>
            <span style={{ color: "var(--text-4)" }}>·</span>
            <span>postgres 96%</span>
            <span className="tag">db first</span>
          </div>
          <div className="mkt-guard-line">
            <span>redis degraded</span>
            <span style={{ color: "var(--text-4)" }}>·</span>
            <span>pool 97%</span>
            <span className="tag">redis first</span>
          </div>
          <div className="mkt-guard-line suppressed">
            <span>recalled &ldquo;always check Redis&rdquo;</span>
            <span className="tag">suppressed</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const ARCH: Array<{ tag: string; t: string; d: string; kind?: "memory" | "evidence" }> = [
  { tag: "client", t: "Next.js 15 console", d: "Marketing site, incident catalog, investigation workspace, comparison and learning views." },
  { tag: "api", t: "FastAPI", d: "Typed endpoints for health, catalog, investigate, feedback, resolve, demo and learning." },
  { tag: "agent", t: "Investigation agent", d: "Owns one incident: recall → strategy → execute → hypothesis → propose root cause." },
  { tag: "memory", t: "Hindsight memory", d: "Vector long-term store of experience narratives. Owns extraction, embedding and similarity recall.", kind: "memory" },
  { tag: "evidence", t: "Strategy engine", d: "Ranks recalled memory against current signals, with LLM reasoning and a deterministic fallback.", kind: "evidence" },
  { tag: "tools", t: "Telemetry tools", d: "Five deterministic, allowlisted, incident-scoped tools. Raw telemetry only — never the answer.", kind: "evidence" },
  { tag: "state", t: "PostgreSQL", d: "Application state only: catalog mirror, runs, steps, feedback. Never strategy knowledge." },
  { tag: "human", t: "Engineer", d: "Accept, reject or correct. The correction is the highest-value memory the system ever stores." },
];

function Architecture() {
  return (
    <section className="mkt-section" id="architecture">
      <div className="mkt-section-head" data-reveal>
        <span className="kicker">Architecture</span>
        <h2 className="mkt-h2">Memory in one place, state in another</h2>
        <p className="mkt-sub">
          The relational database stores what happened. The memory bank stores what was learned. The
          strategy engine only ever reads knowledge from memory — never from the catalog.
        </p>
      </div>
      <div className="mkt-arch" data-reveal>
        {ARCH.map((n) => (
          <article className="mkt-arch-node" data-kind={n.kind} key={n.t}>
            <span className="mkt-arch-tag">{n.tag}</span>
            <h4>{n.t}</h4>
            <p>{n.d}</p>
          </article>
        ))}
      </div>
      <div className="mkt-stack" style={{ marginTop: 34 }} data-reveal>
        {[
          "Python 3.12",
          "FastAPI",
          "SQLAlchemy 2 (async)",
          "Pydantic v2",
          "Hindsight",
          "Next.js 15",
          "TypeScript",
          "React 19",
          "Vitest",
          "PostgreSQL",
          "Docker Compose",
        ].map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mkt-cta">
      <div className="mkt-cta-box" data-reveal>
        <span className="kicker brand" style={{ justifyContent: "center" }}>
          Open the console
        </span>
        <h2>Give the next incident a head start.</h2>
        <p>
          The demo bank is pre-warmed with tier-1 knowledge and a scripted replay, so you land on a
          console that already has a memory story to tell — and every button runs the real pipeline.
        </p>
        <div className="mkt-cta-actions">
          <Link href="/console" className="mkt-btn mkt-btn-primary mkt-btn-lg">
            Launch live demo
            <Icon name="arrow-right" />
          </Link>
          <Link href="/console/incidents" className="mkt-btn mkt-btn-ghost mkt-btn-lg">
            Browse the incident catalog
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-footer-inner">
        <div className="mkt-footer-brand">
          <Link href="/" className="mkt-logo">
            <span className="mkt-logo-mark" aria-hidden="true">
              IP
            </span>
            <span className="mkt-logo-name">
              IncidentPilot
              <span className="mkt-logo-sub">Memory-first SRE</span>
            </span>
          </Link>
          <p>
            An investigation agent that recalls your past incidents, challenges them against live
            telemetry, and learns from every engineer correction.
          </p>
        </div>
        {FOOTER_COLS.map((c) => (
          <div className="mkt-footer-col" key={c.title}>
            <h4>{c.title}</h4>
            <ul>
              {c.links.map((l) =>
                l.external ? (
                  <li key={l.label}>
                    <a href={l.href} target="_blank" rel="noreferrer noopener">
                      {l.label}
                      <Icon
                        name="external"
                        size={11}
                        style={{ display: "inline", verticalAlign: "-1px", marginLeft: 5 }}
                      />
                    </a>
                  </li>
                ) : (
                  <li key={l.label}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="mkt-footer-bottom">
        <span>IncidentPilot — synthetic telemetry, real pipeline, honest numbers.</span>
        <span>All data in this demo is synthetic and generated for evaluation.</span>
      </div>
    </footer>
  );
}

/* ================================================================== page == */

export default function MarketingHome() {
  const stuck = useStuck();
  const [open, setOpen] = useState(false);
  useRevealRoot();

  return (
    <div className="mkt">
      <div className="mkt-announce">
        <div className="mkt-announce-inner">
          <span className="mkt-announce-badge">New</span>
          <span>
            Baseline vs Memory now runs both strategies live —{" "}
            <Link href="/console/compare">try the comparison</Link>
          </span>
        </div>
      </div>

      <header className="mkt-nav" data-stuck={stuck}>
        <div className="mkt-nav-inner">
          <Link href="/" className="mkt-logo" aria-label="IncidentPilot home">
            <span className="mkt-logo-mark" aria-hidden="true">
              IP
            </span>
            <span className="mkt-logo-name">
              IncidentPilot
              <span className="mkt-logo-sub">Memory-first SRE</span>
            </span>
          </Link>
          <nav className="mkt-nav-links" aria-label="Marketing">
            {NAV_LINKS.map((l) => (
              <a className="mkt-nav-link" href={l.href} key={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mkt-nav-actions">
            <ThemeToggle />
            <Link href="/console" className="mkt-btn mkt-btn-primary">
              Open console
              <Icon name="arrow-up-right" />
            </Link>
            <button
              type="button"
              className="mkt-nav-toggle"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label="Toggle navigation"
            >
              <Icon name={open ? "x-circle" : "panel-left"} size={17} />
            </button>
          </div>
        </div>
        <div className="mkt-mobile" data-open={open}>
          {NAV_LINKS.map((l) => (
            <a href={l.href} key={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <Link href="/console" className="mkt-btn mkt-btn-primary" onClick={() => setOpen(false)}>
            Open console
            <Icon name="arrow-right" />
          </Link>
        </div>
      </header>

      <main>
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <ProblemSolution />
        <Capabilities />
        <Evidence />
        <Guardrails />
        <Architecture />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
