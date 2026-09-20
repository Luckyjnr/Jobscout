import { analytics, STRONG_SCORE } from "../db";
import { ApplicationsOverTime, DiscoveredOverTime, ScoreDistribution } from "./charts";

export const dynamic = "force-dynamic";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function AnalyticsPage() {
  const a = await analytics();
  const maxDay = Math.max(...a.decisionsByDay.map((d) => d.interested + d.rejected), 1);
  const scored = a.scoreHistogram.reduce((sum, bucket) => sum + bucket.count, 0);

  // both rates are shares of the applications actually sent, so a pipeline
  // with nothing sent shows a dash rather than a division by zero
  const pct = (part: number) =>
    a.rates.applied === 0 ? null : Math.round((part / a.rates.applied) * 100);
  const interviewRate = pct(a.rates.interviewed);
  const responseRate = pct(a.rates.answered);
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

      <div className="grid cols-4">
        <div className="stat">
          <span className="value">{a.funnel.applied.toLocaleString()}</span>
          <span className="label">Applications sent</span>
          <span className="foot">of {a.funnel.interested.toLocaleString()} saved</span>
        </div>
        <div className="stat rate">
          <span className="value">
            {interviewRate === null ? "—" : `${interviewRate}%`}
            {interviewRate === null ? null : <small>{a.rates.interviewed}/{a.rates.applied}</small>}
          </span>
          <span className="label">Interview rate</span>
          <span className="foot">reached interview or offer</span>
        </div>
        <div className="stat rate">
          <span className="value">
            {responseRate === null ? "—" : `${responseRate}%`}
            {responseRate === null ? null : <small>{a.rates.answered}/{a.rates.applied}</small>}
          </span>
          <span className="label">Response rate</span>
          <span className="foot">moved past Applied either way</span>
        </div>
        <div className="stat">
          <span className="value">{scored.toLocaleString()}</span>
          <span className="label">Scored and open</span>
          <span className="foot">above {STRONG_SCORE} counts as strong</span>
        </div>
      </div>

      <section className="panel">
        <header>
          <h3>Discovered over time</h3>
          <span className="sub">last 30 days · matched means scoring above {STRONG_SCORE}</span>
        </header>
        <DiscoveredOverTime data={a.discovered} />
      </section>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Score distribution</h3>
            <span className="sub">buckets of ten</span>
          </header>
          <ScoreDistribution data={a.scoreHistogram} total={scored} />
        </section>

        <section className="panel">
          <header>
            <h3>Applications over time</h3>
            <span className="sub">last 8 weeks</span>
          </header>
          <ApplicationsOverTime data={a.applicationsByWeek} />
        </section>
      </div>

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
      </div>

      <div className="grid cols-2">
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
