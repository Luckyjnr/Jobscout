import { decide, saveNote, undecide } from "./actions";
import { counts, interestedRows, queueRows, type Row, type Signal } from "./db";

export const dynamic = "force-dynamic";

const MAX_LOCATIONS = 4;

function day(value: Date | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

function locations(row: Row): string {
  if (row.locations.length === 0) return "location not stated";
  const shown = row.locations.slice(0, MAX_LOCATIONS).join(" · ");
  const rest = row.locations.length - MAX_LOCATIONS;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

function Signals({ signals }: { signals: Signal[] | null }) {
  const matched = (signals ?? []).filter((signal) => signal.matched);
  if (matched.length === 0) return null;

  return (
    <div className="signals">
      {matched.map((signal, index) => (
        <span key={signal.name} className={signal.weight < 0 ? "neg" : undefined}>
          {index > 0 ? "  " : ""}
          {signal.weight >= 0 ? "+" : ""}
          {signal.weight} {signal.name}
          {signal.evidence ? ` (${signal.evidence})` : ""}
        </span>
      ))}
    </div>
  );
}

function JobRow({ row, tab }: { row: Row; tab: "queue" | "interested" }) {
  return (
    <div className="row">
      <div className="score">
        {row.score}
        {row.fit === null ? null : <span className="fit">fit {row.fit}</span>}
      </div>

      <div>
        <div className="title">
          <a href={row.url} target="_blank" rel="noreferrer">
            {row.title}
          </a>{" "}
          <span className="company">· {row.company}</span>
        </div>

        <div className="sub">
          <span className="locs">{locations(row)}</span>
          {row.postings > 1 ? <span className="locs"> ({row.postings} postings)</span> : null}
          <span className="sep">|</span>
          {row.salary_text ? <span className="salary">{row.salary_text}</span> : <span>no salary</span>}
          <span className="sep">|</span>
          <span>posted {day(row.posted_at)}</span>
          <span className="sep">|</span>
          <span>{row.source}</span>
        </div>

        <Signals signals={row.signals} />
      </div>

      <div className="actions">
        {tab === "queue" ? (
          <form action={decide}>
            <input type="hidden" name="fingerprint" value={row.fingerprint} />
            <button className="yes" name="decision" value="interested" type="submit">
              Interested
            </button>{" "}
            <button className="no" name="decision" value="rejected" type="submit">
              Not for me
            </button>
          </form>
        ) : (
          <form action={undecide}>
            <input type="hidden" name="fingerprint" value={row.fingerprint} />
            <span className="locs">{day(row.decided_at)}</span>{" "}
            <button className="link" type="submit">
              undo
            </button>
          </form>
        )}
      </div>

      {tab === "interested" ? (
        <form className="note" action={saveNote}>
          <input type="hidden" name="fingerprint" value={row.fingerprint} />
          <textarea name="note" rows={1} placeholder="note…" defaultValue={row.note ?? ""} />
          <button type="submit">Save</button>
        </form>
      ) : null}
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: requested } = await searchParams;
  const tab = requested === "interested" ? "interested" : "queue";

  const [rows, tally] = await Promise.all([
    tab === "queue" ? queueRows() : interestedRows(),
    counts(),
  ]);

  return (
    <>
      <header>
        <h1>jobscout</h1>
        <nav>
          <a href="/?tab=queue" className={tab === "queue" ? "on" : undefined}>
            Queue <span className="count">{tally.queue}</span>
          </a>
          <a href="/?tab=interested" className={tab === "interested" ? "on" : undefined}>
            Interested <span className="count">{tally.interested}</span>
          </a>
        </nav>
        <span className="meta">{tally.rejected} rejected</span>
      </header>

      {rows.length === 0 ? (
        <p className="empty">
          {tab === "queue"
            ? "Queue is empty. Run the crawler and scorer, or everything here is decided."
            : "Nothing marked interested yet."}
        </p>
      ) : (
        rows.map((row) => <JobRow key={row.fingerprint} row={row} tab={tab} />)
      )}
    </>
  );
}
