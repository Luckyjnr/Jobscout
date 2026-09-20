import { readFileSync } from "node:fs";
import { settings } from "../db";

export const dynamic = "force-dynamic";

function profileText(): string {
  try {
    // profile.md lives at the repo root, one level above web/
    return readFileSync(new URL("../../../profile.md", import.meta.url), "utf8");
  } catch {
    return "";
  }
}

export default async function SettingsPage() {
  const data = await settings();
  const profile = profileText();
  const active = data.companies.filter((c) => c.active).length;

  return (
    <div className="page grid" style={{ gap: 16 }}>
      <section className="panel">
        <header>
          <h3>Profile</h3>
          <span className="sub">read at runtime from profile.md</span>
        </header>
        {profile ? (
          <>
            <p style={{ color: "var(--slate)", marginTop: 0 }}>
              Scoring and the LLM judge both read this file on every run, so editing it changes the
              results without touching code.
            </p>
            <div className="prose" style={{ maxHeight: 220, background: "var(--raised)", padding: 12, borderRadius: 10 }}>
              {profile}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--slate)", margin: 0 }}>
            No profile.md found at the repository root.
          </p>
        )}
      </section>

      <section className="panel">
        <header>
          <h3>Notifications</h3>
          <span className="sub">what the bell shows</span>
        </header>
        {[
          { title: "Board failures", body: "A source whose last fetch errored." },
          { title: "Scan in progress", body: "Shown while a crawl is running." },
          { title: "Queue waiting", body: "Roles scored above the floor and not yet decided." },
          { title: "Last scan", body: "When the crawler last finished." },
        ].map((item) => (
          <div className="setting" key={item.title}>
            <div className="body">
              <b>{item.title}</b>
              <span>{item.body}</span>
            </div>
            <span className="pill good">on</span>
          </div>
        ))}
        <p style={{ color: "var(--faint)", fontSize: 11.5, marginBottom: 0 }}>
          These are derived from live state rather than stored, so there is nothing to switch off
          yet — turning them into per-user preferences needs a table to keep them in.
        </p>
      </section>

      <div className="grid cols-2">
        <section className="panel">
          <header>
            <h3>Feeds</h3>
            <span className="sub">{data.sources.length} configured</span>
          </header>
          {data.sources.map((source) => (
            <div className="setting" key={source.name}>
              <div className="body">
                <b className="mono">{source.name}</b>
                <span>
                  {source.kind} · every {source.interval}m
                  {source.attribution ? ` · credits "${source.attribution}"` : ""}
                </span>
              </div>
              <span className={`pill ${source.active ? "good" : ""}`}>{source.active ? "active" : "off"}</span>
            </div>
          ))}
        </section>

        <section className="panel">
          <header>
            <h3>Company boards</h3>
            <span className="sub">
              {active} of {data.companies.length} active
            </span>
          </header>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {data.companies.map((company) => (
              <div className="setting" key={`${company.ats}/${company.token}`}>
                <div className="body">
                  <b>{company.name}</b>
                  <span className="mono">
                    {company.ats}/{company.token} · every {company.interval}m
                  </span>
                </div>
                {company.last_error ? (
                  <span className="pill danger">failing</span>
                ) : (
                  <span className={`pill ${company.active ? "good" : ""}`}>
                    {company.active ? "active" : "off"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
