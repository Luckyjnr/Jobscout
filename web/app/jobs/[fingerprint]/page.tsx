import Link from "next/link";
import { notFound } from "next/navigation";
import { jobDetail } from "../../db";
import { STATUS_LABELS, type Status } from "../../pipeline";
import { DetailActions } from "./actions-client";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "not stated";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function hue(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i += 1) hash = (hash * 31 + company.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 45%)`;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ fingerprint: string }>;
}) {
  const { fingerprint } = await params;
  const job = await jobDetail(fingerprint);
  if (!job) notFound();

  const positives = job.all_signals.filter((s) => s.weight > 0);
  const negatives = job.all_signals.filter((s) => s.weight < 0);

  return (
    <div className="page">
      <div className="detail">
        <div className="grid" style={{ gap: 12 }}>
          <section className="panel">
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span className="logo" style={{ background: hue(job.company) }} aria-hidden="true">
                {job.company.trim().charAt(0).toUpperCase()}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>{job.title}</h2>
                <p style={{ margin: "2px 0 0", color: "var(--slate)", fontSize: 14 }}>{job.company}</p>
              </div>
              <span className="score-pill mono" style={{ fontSize: 17, padding: "9px 15px" }}>
                {job.score}
                {job.fit === null ? null : <span className="fit">fit {job.fit}</span>}
              </span>
            </div>

            <div className="tags" style={{ marginTop: 14 }}>
              {job.locations.map((location) => (
                <span className="tag" key={location}>
                  {location}
                </span>
              ))}
              {job.remote ? <span className="tag remote">Remote</span> : null}
              <span className="tag">{when(job.posted_at)}</span>
              {job.sources.map((source) => (
                <span className="tag mono" key={source}>
                  {source}
                </span>
              ))}
            </div>

            <div className="card-bottom">
              {job.salary_text ? (
                <span className="salary">{job.salary_text}</span>
              ) : (
                <span className="salary none">Salary not stated</span>
              )}
              <div className="acts">
                <a className="btn ghost" href={job.url} target="_blank" rel="noreferrer">
                  Open posting ↗
                </a>
                <DetailActions
                  fingerprint={job.fingerprint}
                  decision={job.decision}
                  status={job.status}
                  note={job.note}
                />
              </div>
            </div>
          </section>

          {job.reasons?.length || job.concerns?.length ? (
            <section className="panel">
              <header>
                <h3>What the model made of it</h3>
                <span className="sub">fit {job.fit}</span>
              </header>
              <div className="grid cols-2" style={{ gap: 16 }}>
                <div>
                  <b style={{ fontSize: 12, color: "var(--success)" }}>Reasons</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
                    {(job.reasons ?? []).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <b style={{ fontSize: 12, color: "var(--warn)" }}>Concerns</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
                    {(job.concerns ?? []).map((concern) => (
                      <li key={concern}>{concern}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <header>
              <h3>Description</h3>
              <span className="sub">{job.description.length.toLocaleString()} characters</span>
            </header>
            {job.description.trim() ? (
              <div className="prose">{job.description}</div>
            ) : (
              <p style={{ color: "var(--slate)", margin: 0 }}>This source carries no description.</p>
            )}
          </section>
        </div>

        <div className="side">
          <section className="panel">
            <header>
              <h3>Why this score</h3>
              <span className="sub mono">{job.score}</span>
            </header>
            <div className="siglist">
              {job.all_signals.length === 0 ? (
                <p style={{ color: "var(--slate)", margin: 0, fontSize: 12 }}>Nothing matched.</p>
              ) : (
                [...positives, ...negatives].map((signal) => (
                  <div className="sigrow" key={signal.name} data-neg={signal.weight < 0}>
                    <span className="w mono">
                      {signal.weight > 0 ? "+" : ""}
                      {signal.weight}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      {signal.name}
                      {signal.evidence ? <em> · {signal.evidence}</em> : null}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <header>
              <h3>Where it is listed</h3>
              <span className="sub">{job.postings} postings</span>
            </header>
            {job.postings_detail.slice(0, 12).map((posting, index) => (
              <div className="kv" key={`${posting.url}-${index}`}>
                <b>{posting.location ?? "not stated"}</b>
                <span>
                  <a href={posting.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>
                    {posting.source}
                  </a>
                </span>
              </div>
            ))}
          </section>

          {job.status ? (
            <section className="panel">
              <header>
                <h3>Pipeline</h3>
              </header>
              <span className="pill brand">{STATUS_LABELS[job.status as Status]}</span>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                <Link href="/applications" style={{ color: "var(--brand)", fontSize: 12 }}>
                  Open the board →
                </Link>
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
