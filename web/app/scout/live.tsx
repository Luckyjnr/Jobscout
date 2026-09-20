"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Scout } from "../db";

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/**
 * The crawl writes scan_progress as it goes, so while a run is in flight this
 * page refreshes itself every few seconds. When nothing is running it sits
 * still rather than polling a database for no reason.
 */
export function Live({ initial }: { initial: Scout }) {
  const router = useRouter();
  const { run, steps, running, targets } = initial;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  const targetSteps = steps.filter((step) => step.stage === "target");
  const done = targetSteps.filter((step) => step.status !== "running").length;
  const total = run?.companies ?? targetSteps.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const failing = targets.filter((target) => target.last_error);

  return (
    <div className="page grid" style={{ gap: 16 }}>
      <section className="panel">
        <header>
          <h3>
            <span className="dot" data-state={running ? "running" : run ? "ok" : "idle"} style={{ display: "inline-block", marginRight: 8 }} />
            {running ? "Scan in progress" : run ? "Last scan" : "No scan yet"}
          </h3>
          <span className="sub">{run ? `run #${run.id} · started ${ago(run.started_at)}` : ""}</span>
        </header>

        {run ? (
          <>
            <div className="scout-block" style={{ marginTop: 0, background: "var(--raised)" }}>
              <div className="bar">
                <span style={{ width: `${running ? progress : 100}%` }} />
              </div>
              <div className="line mono">
                {done} / {total} boards{running ? "" : " · finished"}
              </div>
            </div>

            <div className="grid cols-4" style={{ marginTop: 14 }}>
              {[
                { label: "Boards ok", value: run.ok ?? 0 },
                { label: "Failed", value: run.failed ?? 0 },
                { label: "New jobs", value: run.inserted ?? 0 },
                { label: "Refreshed", value: run.updated ?? 0 },
              ].map((stat) => (
                <div className="stat" key={stat.label} style={{ boxShadow: "none", background: "var(--raised)" }}>
                  <span className="value mono" style={{ fontSize: 20 }}>
                    {stat.value.toLocaleString()}
                  </span>
                  <span className="label">{stat.label}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--slate)", margin: 0 }}>
            Run <code className="mono">npm run crawl</code> and this page will fill in as it goes.
          </p>
        )}
      </section>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Stage by stage</h3>
            <span className="sub">{steps.length} events</span>
          </header>

          {steps.length === 0 ? (
            <p style={{ color: "var(--slate)", margin: 0 }}>No progress recorded for this run.</p>
          ) : (
            <div className="steps">
              {steps.map((step, index) => (
                <div className="step" key={step.id} style={{ animationDelay: `${Math.min(index, 12) * 20}ms` }}>
                  <span className="dot" data-state={step.status} />
                  <span className="label">{step.label ?? step.stage}</span>
                  <span className="detail mono">
                    {step.status === "running"
                      ? "working…"
                      : step.detail
                        ? step.detail
                        : [
                            step.fetched !== null ? `${step.fetched} fetched` : null,
                            step.inserted ? `+${step.inserted}` : null,
                            step.closed ? `−${step.closed}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    {"  "}
                    {clock(step.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <header>
            <h3>Sources</h3>
            <span className="sub">
              {targets.filter((t) => t.due).length} due · {failing.length} failing
            </span>
          </header>

          {failing.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              {failing.map((target) => (
                <div className="kv" key={target.label}>
                  <b className="mono">{target.label}</b>
                  <span className="pill danger" title={target.last_error ?? ""}>
                    {(target.last_error ?? "").slice(0, 34)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="steps">
            {targets.map((target) => (
              <div className="step" key={target.label}>
                <span className="dot" data-state={target.last_error ? "failed" : target.last_ok_at ? "ok" : "idle"} />
                <span className="label mono">{target.label}</span>
                <span className="detail mono">
                  every {target.interval}m · {ago(target.last_ok_at)}
                  {target.due ? " · due" : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
