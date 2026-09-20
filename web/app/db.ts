import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// dev reloads re-evaluate modules; keep one pool on the global so we do not
// leak a connection pool per hot reload
const globalForPg = globalThis as unknown as { jobscoutPool?: pg.Pool };

export function pool(): pg.Pool {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — run the app from a shell that has it, or add web/.env");
  }
  globalForPg.jobscoutPool ??= new Pool({ connectionString });
  return globalForPg.jobscoutPool;
}

export type Signal = {
  name: string;
  weight: number;
  matched: boolean;
  evidence?: string;
};

/** One role, however many postings carry it. */
export type Row = {
  fingerprint: string;
  title: string;
  company: string;
  url: string;
  source: string;
  sources: string[];
  salary_text: string | null;
  posted_at: string | null;
  remote: boolean;
  score: number;
  fit: number | null;
  locations: string[];
  postings: number;
  signals: Signal[];
  note: string | null;
  decided_at: string | null;
};

/**
 * The client filters in memory so counts stay live without a round trip per
 * keystroke. That only works while the queue fits in a payload — 2000 grouped
 * roles with matched signals only is roughly 1.5 MB, which it does.
 */
const QUEUE_LIMIT = 2000;

/**
 * One row per fingerprint — the role identity — so a job listed in twelve
 * cities is one line with twelve locations, not twelve lines. The representative
 * title/company/url is taken from the highest-scoring posting in the group.
 */
const GROUPED_COLUMNS = `
  j.fingerprint,
  (array_agg(j.title order by j.score desc nulls last, j.id))[1] as title,
  (array_agg(j.company order by j.score desc nulls last, j.id))[1] as company,
  (array_agg(j.url order by j.score desc nulls last, j.id))[1] as url,
  (array_agg(j.source order by j.score desc nulls last, j.id))[1] as source,
  (array_agg(j.score_signals order by j.score desc nulls last, j.id))[1] as signals,
  coalesce(array_agg(distinct j.source), '{}') as sources,
  -- one posting of the role being remote makes the role remote
  bool_or(j.remote) as remote,
  -- prefer a posting that actually states pay
  (array_agg(j.salary_text order by (j.salary_text is null), j.id))[1] as salary_text,
  max(j.score)::int as score,
  max(j.fit)::int as fit,
  max(j.posted_at) as posted_at,
  coalesce(array_agg(distinct j.location) filter (where j.location is not null), '{}') as locations,
  count(*)::int as postings
`;

/** Matched signals are the only ones shown or filtered on; drop the rest here. */
function trim(row: Row): Row {
  return { ...row, signals: (row.signals ?? []).filter((signal) => signal.matched) };
}

export async function queueRows(limit = QUEUE_LIMIT): Promise<Row[]> {
  const { rows } = await pool().query<Row>(
    `select ${GROUPED_COLUMNS}, null::text as note, null::timestamptz as decided_at
       from jobs j
      where j.score is not null
        and not j.closed
        and not exists (select 1 from decisions d where d.job_id = j.id)
      group by j.fingerprint
      order by max(j.score) desc, max(j.posted_at) desc nulls last
      limit $1`,
    [limit],
  );
  return rows.map(trim);
}

export async function interestedRows(): Promise<Row[]> {
  const { rows } = await pool().query<Row>(
    `select ${GROUPED_COLUMNS},
            (array_agg(d.note) filter (where d.note is not null and d.note <> ''))[1] as note,
            max(d.decided_at) as decided_at
       from jobs j
       join decisions d on d.job_id = j.id and d.decision = 'interested'
      group by j.fingerprint
      order by max(d.decided_at) desc`,
  );
  return rows.map(trim);
}

export type Attribution = {
  source: string;
  text: string;
  url: string;
};

/**
 * Feeds whose terms require visible credit wherever their jobs appear. Jobicy's
 * notice asks for "clear credit with a direct link to the source", so the UI
 * shows it on every row from that source and links the row title to the
 * original posting.
 */
export async function attributions(): Promise<Attribution[]> {
  const { rows } = await pool().query<Attribution>(
    `select name as source, coalesce(attribution_text, name) as text,
            coalesce(attribution_url, '') as url
       from sources
      where attribution_required
      order by name`,
  );
  return rows;
}

export type Totals = {
  queue: number;
  interested: number;
  rejected: number;
  decidedToday: number;
  bySource: Array<{ source: string; count: number }>;
};

export async function totals(): Promise<Totals> {
  const [summary, bySource] = await Promise.all([
    pool().query<{ queue: string; interested: string; rejected: string; today: string }>(
      `select
         (select count(distinct j.fingerprint) from jobs j
           where j.score is not null and not j.closed
             and not exists (select 1 from decisions d where d.job_id = j.id)) as queue,
         (select count(distinct j.fingerprint) from jobs j
            join decisions d on d.job_id = j.id where d.decision = 'interested') as interested,
         (select count(distinct j.fingerprint) from jobs j
            join decisions d on d.job_id = j.id where d.decision = 'rejected') as rejected,
         (select count(distinct j.fingerprint) from jobs j
            join decisions d on d.job_id = j.id
           where d.decided_at >= date_trunc('day', now())) as today`,
    ),
    pool().query<{ source: string; count: string }>(
      `select j.source, count(distinct j.fingerprint)::text as count
         from jobs j
        where j.score is not null and not j.closed
          and not exists (select 1 from decisions d where d.job_id = j.id)
        group by j.source order by 2 desc`,
    ),
  ]);

  const row = summary.rows[0];
  return {
    queue: Number(row?.queue ?? 0),
    interested: Number(row?.interested ?? 0),
    rejected: Number(row?.rejected ?? 0),
    decidedToday: Number(row?.today ?? 0),
    bySource: bySource.rows.map((r) => ({ source: r.source, count: Number(r.count) })),
  };
}
