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
  salary_text: string | null;
  posted_at: Date | null;
  score: number;
  fit: number | null;
  locations: string[];
  postings: number;
  signals: Signal[] | null;
  note: string | null;
  decided_at: Date | null;
};

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
  -- prefer a posting that actually states pay
  (array_agg(j.salary_text order by (j.salary_text is null), j.id))[1] as salary_text,
  max(j.score)::int as score,
  max(j.fit)::int as fit,
  max(j.posted_at) as posted_at,
  coalesce(array_agg(distinct j.location) filter (where j.location is not null), '{}') as locations,
  count(*)::int as postings
`;

export async function queueRows(limit = 300): Promise<Row[]> {
  const { rows } = await pool().query<Row>(
    `select ${GROUPED_COLUMNS}, null::text as note, null::timestamptz as decided_at
       from jobs j
      where j.score is not null
        and not exists (select 1 from decisions d where d.job_id = j.id)
      group by j.fingerprint
      order by max(j.score) desc, max(j.posted_at) desc nulls last
      limit $1`,
    [limit],
  );
  return rows;
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
  return rows;
}

export async function counts(): Promise<{ queue: number; interested: number; rejected: number }> {
  const { rows } = await pool().query<{ queue: string; interested: string; rejected: string }>(
    `select
       (select count(distinct j.fingerprint) from jobs j
         where j.score is not null
           and not exists (select 1 from decisions d where d.job_id = j.id)) as queue,
       (select count(distinct j.fingerprint) from jobs j
          join decisions d on d.job_id = j.id where d.decision = 'interested') as interested,
       (select count(distinct j.fingerprint) from jobs j
          join decisions d on d.job_id = j.id where d.decision = 'rejected') as rejected`,
  );
  const row = rows[0];
  return {
    queue: Number(row?.queue ?? 0),
    interested: Number(row?.interested ?? 0),
    rejected: Number(row?.rejected ?? 0),
  };
}
