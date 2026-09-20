import Link from "next/link";
import { notFound } from "next/navigation";
import { seniorityFromTitle } from "../../match";
import { jobDetail } from "../../db";
import { describe } from "../../description";
import { STATUS_LABELS, type Status } from "../../pipeline";
import { DetailActions } from "./actions-client";
import { Analysis } from "./analysis";
import { HeaderActions } from "./header-actions";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function when(iso: string | null): string {
  if (!iso) return "not stated";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** A stable colour per company, so the same avatar is the same colour everywhere. */
function hue(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i += 1) hash = (hash * 31 + company.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 45%)`;
}

function isNew(iso: string | null): boolean {
  return iso !== null && Date.now() - new Date(iso).getTime() < 2 * DAY;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ fingerprint: string }>;
}) {
  const { fingerprint } = await params;
  const job = await jobDetail(fingerprint);
  if (!job) notFound();

  const presentable = {
    score: job.score,
    signals: job.all_signals,
    remote: job.remote,
    fit: job.fit,
    reasons: job.reasons,
    concerns: job.concerns,
    title: job.title,
  };

  const blocks = describe(job.description);
  const seniority = job.seniority ?? seniorityFromTitle(job.title);

  // every chip here is a fact the posting carries; the ones a board does not
  // publish are left out rather than defaulted
  const chips = [
    job.locations[0] ?? null,
    job.salary_text,
    job.employment_type,
    seniority,
    job.posted_at ? `Posted ${when(job.posted_at)}` : null,
  ].filter((chip): chip is string => chip !== null && chip !== "");

  const positives = job.all_signals.filter((s) => s.weight > 0);
  const negatives = job.all_signals.filter((s) => s.weight < 0);

  return (
    <div className="page">
      <section className="panel job-head">
        <span className="job-avatar" style={{ background: hue(job.company) }} aria-hidden="true">
          {job.company.trim().charAt(0).toUpperCase()}
        </span>

        <div className="job-head-body">
          <div className="job-badges">
            <span className="badge-ai">AI MATCH</span>
            {isNew(job.posted_at) ? <span className="badge-new">New</span> : null}
            {job.remote ? <span className="tag remote">Remote</span> : null}
          </div>

          <h1 className="job-title">{job.title}</h1>
          <p className="job-company">{job.company}</p>

          <div className="job-chips">
            {chips.map((chip) => (
              <span className="tag" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        </div>

        <HeaderActions
          fingerprint={job.fingerprint}
          url={job.url}
          decision={job.decision}
          status={job.status}
        />
      </section>

      <div className="detail">
        <div className="grid" style={{ gap: 12 }}>
          <section className="panel">
            <header>
              <h3>Description</h3>
              <span className="sub">{job.description.length.toLocaleString()} characters</span>
            </header>

            {blocks.length === 0 ? (
              <p style={{ color: "var(--slate)", margin: 0 }}>This source carries no description.</p>
            ) : (
              <div className="jd">
                {blocks.map((block, index) =>
                  block.kind === "heading" ? (
                    <h4 className="jd-h" data-section={block.section} key={index}>
                      {block.text}
                    </h4>
                  ) : block.kind === "list" ? (
                    <ul className="jd-list" key={index}>
                      {block.items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={index}>{block.text}</p>
                  ),
                )}
              </div>
            )}
          </section>

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
        </div>

        <div className="side">
          <Analysis job={presentable} />

          <section className="panel">
            <header>
              <h3>Source</h3>
              <span className="sub">{job.postings} posting{job.postings === 1 ? "" : "s"}</span>
            </header>

            <div className="kv">
              <b>Board</b>
              <span className="mono">{job.sources.join(", ")}</span>
            </div>
            <div className="kv">
              <b>Discovered</b>
              <span>{when(job.discovered_at)}</span>
            </div>
            <div className="kv">
              <b>Posted</b>
              <span>{when(job.posted_at)}</span>
            </div>

            <a
              className="btn ghost"
              style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
              href={job.url}
              target="_blank"
              rel="noreferrer"
            >
              View Original Job ↗
            </a>

            {job.postings_detail.length > 1 ? (
              <div className="src-more">
                {job.postings_detail.slice(0, 8).map((posting, index) => (
                  <a
                    key={`${posting.url}-${index}`}
                    href={posting.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {posting.location ?? posting.source}
                  </a>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel">
            <header>
              <h3>Pipeline</h3>
              {job.status ? <span className="sub">{STATUS_LABELS[job.status as Status]}</span> : null}
            </header>
            <div className="acts" style={{ flexWrap: "wrap" }}>
              <DetailActions
                fingerprint={job.fingerprint}
                decision={job.decision}
                status={job.status}
                note={job.note}
              />
            </div>
            {job.status ? (
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                <Link href="/applications" style={{ color: "var(--brand-ink)", fontSize: 12 }}>
                  Open the board →
                </Link>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
