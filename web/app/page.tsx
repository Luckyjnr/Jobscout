import { cookies } from "next/headers";
import Link from "next/link";
import { home, minutesToNextScan, STATUS_META, STRONG_SCORE, type Status } from "./db";
import { greeting, readName } from "./greeting";
import { matchScore, skillChips, skillsMatchedCount, matchSummary } from "./match";
import { StampVisit } from "./visit";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function hue(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i += 1) hash = (hash * 31 + company.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 45%)`;
}

/** A delta line that reads as a change, with no sign where there is no change. */
function delta(value: number, label: string): string {
  if (value === 0) return `none ${label}`;
  return `+${value.toLocaleString()} ${label}`;
}

export default async function DashboardPage() {
  const jar = await cookies();
  const seen = jar.get("jobscout_seen")?.value;
  const since = seen && /^\d+$/.test(seen) ? new Date(Number(seen)) : null;

  const data = await home(since);
  const name = readName();
  const nextScan = minutesToNextScan();

  const stats = [
    {
      value: data.stats.newToday,
      label: "New jobs",
      foot: delta(data.stats.newYesterday, "yesterday"),
      cls: "",
    },
    {
      value: data.stats.strongOpen,
      label: "Strong matches",
      foot: delta(data.stats.strongThisWeek, "this week"),
      cls: "good",
    },
    {
      value: data.stats.saved,
      label: "Saved",
      foot:
        data.stats.needAction === 0
          ? "none waiting on you"
          : `${data.stats.needAction} need action`,
      cls: "",
    },
    {
      value: data.stats.applications,
      label: "Applications",
      foot:
        data.stats.interviews === 0
          ? "no interviews yet"
          : `${data.stats.interviews} interview${data.stats.interviews === 1 ? "" : "s"}`,
      cls: "brand",
    },
  ];

  return (
    <div className="page grid" style={{ gap: 16 }}>
      <StampVisit />

      <section className="hello">
        <h2>{greeting(name)}</h2>
        <p>
          Your AI scout found <b>{data.sinceLastVisit.toLocaleString()}</b>{" "}
          {data.sinceLastVisit === 1 ? "new opportunity" : "new opportunities"}{" "}
          {data.sinceIsFallback ? "in the last 24 hours." : "since your last visit."}
        </p>
      </section>

      <div className="grid cols-4">
        {stats.map((stat, index) => (
          <div className={`stat ${stat.cls}`} key={stat.label} style={{ animationDelay: `${index * 40}ms` }}>
            <span className="value">{stat.value.toLocaleString()}</span>
            <span className="label">{stat.label}</span>
            <span className="foot">{stat.foot}</span>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------------------ scout */}

      <section className="panel scout-panel">
        <header>
          <span className="dot" data-state={data.scout.running ? "running" : "ok"} />
          <h3>AI Scout</h3>
          <span className="sub">
            {data.scout.running ? "scanning now" : `next scan in ${nextScan} min`}
          </span>
        </header>

        <div className="term mono">
          <span className="prompt">›</span>
          {data.scout.activity}
          <span className="caret" aria-hidden="true">_</span>
        </div>

        <div className="stages">
          {data.scout.stages.map((stage) => (
            <span className="stage-pill" data-state={stage.state} key={stage.name} title={stage.detail}>
              {stage.state === "done" ? <span className="tick">✓</span> : null}
              {stage.name}
            </span>
          ))}
        </div>

        <div className="grid cols-4" style={{ marginTop: 14 }}>
          <div className="mini">
            <b>{data.scout.sourcesScanned.toLocaleString()}</b>
            <span>Sources scanned</span>
          </div>
          <div className="mini">
            <b>{data.scout.jobsAnalyzed.toLocaleString()}</b>
            <span>Jobs analyzed</span>
          </div>
          <div className="mini">
            <b>{data.scout.relevantMatches.toLocaleString()}</b>
            <span>Relevant matches</span>
          </div>
          <div className="mini">
            <b>{ago(data.scout.finishedAt ?? data.scout.startedAt)}</b>
            <span>Last scan</span>
          </div>
        </div>

        <div className="acts" style={{ marginTop: 14 }}>
          <Link className="btn primary" href="/scout">
            View Scout Activity
          </Link>
          <Link className="btn ghost" href="/settings">
            Configure Scout
          </Link>
        </div>

        <p className="c-caption">
          Searching is reported by the crawler. Analyzing, Matching and Ranking are the scoring
          pass, which runs as its own script and writes no progress rows, so they are derived from
          the jobs themselves. Nothing sends notifications yet.
        </p>
      </section>

      {/* ---------------------------------------------------- what to do next */}

      {data.nextSteps.length > 0 ? (
        <section className="panel">
          <header>
            <h3>What to do next</h3>
            <span className="sub">only what actually applies</span>
          </header>

          {data.nextSteps.map((step) => (
            <div className="todo" key={`${step.kind}-${step.fingerprint}`}>
              <span className="todo-mark" data-kind={step.kind} aria-hidden="true">
                {step.kind === "apply" ? "→" : step.kind === "interview" ? "◆" : "!"}
              </span>
              <span className="todo-body">
                <b>
                  {step.kind === "apply"
                    ? "Your highest scoring undecided role"
                    : step.kind === "interview"
                      ? "You have an interview in progress"
                      : "Saved three days ago and not sent"}
                </b>
                <span>
                  {step.title} · {step.company}
                  {step.kind === "apply" ? ` · scores ${step.score}` : null}
                  {step.kind !== "apply" && step.since ? ` · ${ago(step.since)}` : null}
                </span>
              </span>
              <Link className="btn ghost" href={`/jobs/${step.fingerprint}`}>
                {step.kind === "apply" ? "Apply" : step.kind === "interview" ? "Open" : "Review"}
              </Link>
            </div>
          ))}
        </section>
      ) : null}

      {/* -------------------------------------------------------- recommended */}

      <section className="panel">
        <header>
          <h3>Recommended for you</h3>
          <Link className="sub" href="/jobs">
            View all {data.stats.strongOpen.toLocaleString()} ›
          </Link>
        </header>

        {data.recommended.length === 0 ? (
          <p style={{ color: "var(--slate)", margin: 0 }}>
            Nothing undecided in the queue. Run a crawl, or clear some decisions.
          </p>
        ) : (
          <div className="grid cols-3">
            {data.recommended.map((row) => {
              const pct = matchScore(row);
              const chips = skillChips(row);
              const skills = skillsMatchedCount(row);
              return (
                <article className="rec" key={row.fingerprint}>
                  <div className="rec-top">
                    <span className="rec-avatar" style={{ background: hue(row.company) }} aria-hidden="true">
                      {row.company.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="badge-ai">AI MATCH</span>
                    <span className="rec-pct mono">{pct}%</span>
                  </div>

                  <span className="rec-src mono">
                    {row.source} · {ago(row.posted_at)}
                  </span>

                  <Link className="rec-title" href={`/jobs/${row.fingerprint}`}>
                    {row.title}
                  </Link>
                  <span className="rec-co">{row.company}</span>

                  <span className="rec-meta">
                    {[row.locations[0], row.remote ? "Remote" : null, row.salary_text]
                      .filter(Boolean)
                      .join(" · ") || "No location or pay stated"}
                  </span>

                  {chips.length > 0 ? (
                    <div className="tags">
                      {chips.slice(0, 4).map((chip) => (
                        <span className="tag" key={chip}>
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <p className="rec-sum">{matchSummary(row)}</p>

                  <span className="rec-skills">
                    {skills.matched} of your skills match
                  </span>

                  <div className="rec-acts">
                    <Link className="btn ghost" href={`/jobs/${row.fingerprint}`}>
                      View Job
                    </Link>
                    <a className="btn ghost" href={row.url} target="_blank" rel="noreferrer">
                      Open ↗
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- two panels */}

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Application progress</h3>
            <Link className="sub" href="/applications">
              Open tracker ›
            </Link>
          </header>

          <p style={{ color: "var(--slate)", marginTop: 0 }}>
            <b style={{ color: "var(--ink)" }}>{data.pipelineTotal.toLocaleString()}</b>{" "}
            {data.pipelineTotal === 1 ? "job" : "jobs"} in your pipeline
          </p>

          <div className="mini-cols">
            {(Object.keys(STATUS_META) as Status[])
              .filter((status) => status !== "rejected")
              .map((status) => {
                const count = data.pipeline.find((entry) => entry.status === status)?.count ?? 0;
                return (
                  <div
                    className="mini-col"
                    key={status}
                    style={{ "--state": STATUS_META[status].colour } as React.CSSProperties}
                  >
                    <b>{count}</b>
                    <span>{STATUS_META[status].label}</span>
                  </div>
                );
              })}
          </div>
        </section>

        <section className="panel">
          <header>
            <h3>Scout activity</h3>
            <Link className="sub" href="/scout">
              View all ›
            </Link>
          </header>

          {data.feed.length === 0 ? (
            <p style={{ color: "var(--slate)", margin: 0 }}>No scans recorded yet.</p>
          ) : (
            <div className="feed">
              {data.feed.slice(0, 8).map((entry, index) => (
                <div className="feed-row" key={`${entry.at}-${index}`}>
                  <span className="dot" data-state={entry.state === "ok" ? "ok" : entry.state} />
                  <span className="feed-body">
                    <b className="mono">{entry.label}</b>
                    {entry.detail ? <span>{entry.detail}</span> : null}
                  </span>
                  <span className="feed-at mono">{ago(entry.at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="c-caption" style={{ textAlign: "center" }}>
        Every figure here is a count over the jobs, decisions, runs and scan_progress tables.
        A strong match is a raw score above {STRONG_SCORE}.
      </p>
    </div>
  );
}
