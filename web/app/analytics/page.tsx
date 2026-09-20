import { analytics } from "../db";

export const dynamic = "force-dynamic";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function AnalyticsPage() {
  const a = await analytics();
  const maxDay = Math.max(...a.decisionsByDay.map((d) => d.interested + d.rejected), 1);
  const maxBucket = Math.max(...a.scoreBuckets.map((b) => b.count), 1);
  const funnel = [
    { label: "Seen", value: a.funnel.seen },
    { label: "Scored and open", value: a.funnel.queued },
    { label: "Decided", value: a.funnel.decided },
    { label: "Interested", value: a.funnel.interested },
    { label: "Applied onward", value: a.funnel.applied },
  ];

  if (a.funnel.seen === 0) {
    return (
      <div className="page">
        <div className="empty">
          <span className="glyph">◧</span>
          <b>No data yet</b>
          <p>Analytics are aggregates over the jobs, runs and decisions tables. Run a crawl first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page grid" style={{ gap: 16 }}>
      <section className="panel">
        <header>
          <h3>Funnel</h3>
          <span className="sub">every row counted, not sampled</span>
        </header>
        <div className="bars">
          {funnel.map((step) => (
            <div className="bar-row" key={step.label}>
              <span>{step.label}</span>
              <span className="track">
                <span style={{ width: `${(step.value / Math.max(funnel[0]!.value, 1)) * 100}%` }} />
              </span>
              <span className="n mono">{step.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Decisions, last 30 days</h3>
            <span className="sub">interested vs not</span>
          </header>
          {a.decisionsByDay.length === 0 ? (
            <p style={{ color: "var(--slate)", margin: 0 }}>Nothing decided yet.</p>
          ) : (
            <div className="columns">
              {a.decisionsByDay.map((entry) => (
                <div className="col" key={entry.day} title={`${entry.day}: ${entry.interested} in, ${entry.rejected} out`}>
                  <i className="neg" style={{ height: `${(entry.rejected / maxDay) * 90}px` }} />
                  <i style={{ height: `${(entry.interested / maxDay) * 90}px` }} />
                  <small>{day(entry.day)}</small>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <header>
            <h3>Score distribution</h3>
            <span className="sub">open jobs</span>
          </header>
          <div className="bars">
            {a.scoreBuckets.map((bucket) => (
              <div className="bar-row" key={bucket.bucket} >
                <span className="mono">{bucket.bucket}</span>
                <span className="track">
                  <span style={{ width: `${(bucket.count / maxBucket) * 100}%` }} />
                </span>
                <span className="n mono">{bucket.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Signal fire rates</h3>
            <span className="sub">a signal firing on everything is a constant</span>
          </header>
          <div className="bars">
            {a.signalRates.map((signal) => (
              <div className={`bar-row ${signal.weight < 0 ? "neg" : "pos"}`} key={signal.name}>
                <span title={signal.name}>{signal.name}</span>
                <span className="track">
                  <span style={{ width: `${signal.pct}%` }} />
                </span>
                <span className="n mono">{signal.pct}%</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <header>
            <h3>By source</h3>
            <span className="sub">median score and salary coverage</span>
          </header>
          {a.bySource.map((source) => (
            <div className="kv" key={source.source}>
              <b className="mono">{source.source}</b>
              <span>
                <span className="pill mono">{source.jobs} jobs</span>{" "}
                <span className="pill mono">median {source.median}</span>{" "}
                <span className="pill mono">{source.withSalary} paid</span>
              </span>
            </div>
          ))}
        </section>
      </div>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Recent runs</h3>
            <span className="sub">from the runs table</span>
          </header>
          {a.runs.length === 0 ? (
            <p style={{ color: "var(--slate)", margin: 0 }}>No runs recorded.</p>
          ) : (
            a.runs.map((run) => (
              <div className="kv" key={run.id}>
                <b className="mono">
                  #{run.id} · {day(run.started_at)}
                </b>
                <span>
                  {run.finished_at === null ? (
                    <span className="pill brand">running</span>
                  ) : (run.failed ?? 0) > 0 ? (
                    <span className="pill danger">{run.failed} failed</span>
                  ) : (
                    <span className="pill good">{run.ok} ok</span>
                  )}{" "}
                  <span className="pill mono">+{run.inserted ?? 0}</span>
                </span>
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <header>
            <h3>Best companies</h3>
            <span className="sub">by top score</span>
          </header>
          {a.topCompanies.map((company) => (
            <div className="kv" key={company.company}>
              <b>{company.company}</b>
              <span>
                <span className="pill mono">{company.jobs} open</span>{" "}
                <span className="pill brand mono">best {company.best}</span>
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
