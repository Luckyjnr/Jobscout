import Link from "next/link";
import { dashboard } from "./db";
import { STATUS_META, type Status } from "./pipeline";

export const dynamic = "force-dynamic";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export default async function DashboardPage() {
  const d = await dashboard();
  const pipelineTotal = d.byStatus.reduce((sum, entry) => sum + entry.count, 0);

  if (d.openJobs === 0) {
    return (
      <div className="page">
        <div className="empty">
          <span className="glyph">◈</span>
          <b>Nothing crawled yet</b>
          <p>
            Run <code className="mono">npm run crawl</code> to fill the database, then{" "}
            <code className="mono">npm run score</code>. The scheduled workflow does both every six
            hours.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page grid" style={{ gap: 16 }}>
      <div className="grid cols-4">
        {[
          { label: "In queue", value: d.queue, cls: "", foot: `${d.aboveFifty} above 50` },
          { label: "Decided today", value: d.decidedToday, cls: "brand", foot: `${d.interested} interested overall` },
          { label: "Open roles", value: d.openJobs, cls: "", foot: `${d.closedJobs} closed` },
          { label: "New this week", value: d.newThisWeek, cls: "good", foot: `${d.withSalary} with salary` },
        ].map((stat, index) => (
          <div className={`stat ${stat.cls}`} key={stat.label} style={{ animationDelay: `${index * 40}ms` }}>
            <span className="value mono">{stat.value.toLocaleString()}</span>
            <span className="label">{stat.label}</span>
            <span className="foot">{stat.foot}</span>
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Best in the queue</h3>
            <Link className="sub" href="/jobs">
              See all →
            </Link>
          </header>

          {d.top.length === 0 ? (
            <p style={{ color: "var(--slate)", margin: 0 }}>Everything is decided.</p>
          ) : (
            <div className="grid" style={{ gap: 8 }}>
              {d.top.map((row) => (
                <Link
                  key={row.fingerprint}
                  href={`/jobs/${row.fingerprint}`}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span className="score-pill mono" style={{ minWidth: 38, padding: "4px 9px", fontSize: 12 }}>
                    {row.score}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{row.title}</b>
                    <span style={{ color: "var(--slate)", fontSize: 11.5 }}>{row.company}</span>
                  </span>
                  {row.salary_text ? <span className="pill brand">{row.salary_text}</span> : null}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <header>
            <h3>Pipeline</h3>
            <Link className="sub" href="/applications">
              Board →
            </Link>
          </header>

          {pipelineTotal === 0 ? (
            <p style={{ color: "var(--slate)", margin: 0 }}>
              Nothing marked interested yet. Press <kbd>i</kbd> on a job.
            </p>
          ) : (
            <div className="bars">
              {(Object.keys(STATUS_META) as Status[]).map((status) => {
                const count = d.byStatus.find((entry) => entry.status === status)?.count ?? 0;
                return (
                  <div
                    className="bar-row"
                    key={status}
                    style={{ "--state": STATUS_META[status].colour } as React.CSSProperties}
                    title={STATUS_META[status].blurb}
                  >
                    <span>{STATUS_META[status].label}</span>
                    <span className="track">
                      <span style={{ width: `${pipelineTotal ? (count / pipelineTotal) * 100 : 0}%` }} />
                    </span>
                    <span className="n mono">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Where the jobs come from</h3>
            <span className="sub">
              {d.companies} boards · {d.feeds} feeds
            </span>
          </header>
          <div className="bars">
            {d.bySource.map((entry) => {
              const max = Math.max(...d.bySource.map((s) => s.count), 1);
              return (
                <div className="bar-row" key={entry.source}>
                  <span className="mono">{entry.source}</span>
                  <span className="track">
                    <span style={{ width: `${(entry.count / max) * 100}%` }} />
                  </span>
                  <span className="n mono">{entry.count}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <header>
            <h3>Last scan</h3>
            <Link className="sub" href="/scout">
              Details →
            </Link>
          </header>
          {d.lastRun ? (
            <>
              <div className="kv">
                <b>Started</b>
                <span className="mono">{ago(d.lastRun.started_at)}</span>
              </div>
              <div className="kv">
                <b>State</b>
                <span>
                  {d.lastRun.finished_at ? (
                    (d.lastRun.failed ?? 0) > 0 ? (
                      <span className="pill danger">{d.lastRun.failed} failed</span>
                    ) : (
                      <span className="pill good">clean</span>
                    )
                  ) : (
                    <span className="pill brand">running</span>
                  )}
                </span>
              </div>
              <div className="kv">
                <b>Boards ok</b>
                <span className="mono">{d.lastRun.ok ?? 0}</span>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--slate)", margin: 0 }}>No scan recorded yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
