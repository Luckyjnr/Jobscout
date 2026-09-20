import "dotenv/config";
import pg from "pg";
import type { Status } from "./pipeline";

export { STATUSES, STATUS_LABELS, STATUS_META, type Status } from "./pipeline";

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

/**
 * Matched signals are the only ones shown or filtered on; drop the rest here.
 * Generic so callers that select extra columns keep them.
 */
function trim<T extends Row>(row: T): T {
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

// ------------------------------------------------------------------ pipeline

export type Application = Row & {
  status: Status;
  applied_at: string | null;
};

/** Every job marked interested, with where it sits in the pipeline. */
export async function applications(): Promise<Application[]> {
  const { rows } = await pool().query<Application>(
    `select ${GROUPED_COLUMNS},
            (array_agg(d.note) filter (where d.note is not null and d.note <> ''))[1] as note,
            max(d.decided_at) as decided_at,
            (array_agg(d.status order by d.decided_at desc))[1] as status,
            max(d.applied_at) as applied_at
       from jobs j
       join decisions d on d.job_id = j.id and d.decision = 'interested'
      group by j.fingerprint
      order by max(d.decided_at) desc`,
  );
  return rows.map(trim);
}

// -------------------------------------------------------------- job detail

export type JobDetail = Row & {
  description: string;
  fit: number | null;
  reasons: string[] | null;
  concerns: string[] | null;
  all_signals: Signal[];
  decision: string | null;
  status: Status | null;
  /** when jobscout first saw it, as distinct from when the board posted it */
  discovered_at: string | null;
  /**
   * Only Lever and Jobicy publish these. Greenhouse — 1,300 of the 2,500
   * postings in the corpus — publishes neither, so both are frequently null
   * and the header simply leaves the chip out rather than guessing.
   */
  employment_type: string | null;
  seniority: string | null;
  postings_detail: Array<{ location: string | null; url: string; source: string; posted_at: string | null }>;
};

/** One role, with everything we know about it — the full description included. */
export async function jobDetail(fingerprint: string): Promise<JobDetail | null> {
  const { rows } = await pool().query<JobDetail>(
    `select ${GROUPED_COLUMNS},
            (array_agg(d.note) filter (where d.note is not null and d.note <> ''))[1] as note,
            max(d.decided_at) as decided_at,
            (array_agg(j.description order by length(j.description) desc))[1] as description,
            (array_agg(j.score_signals order by j.score desc nulls last, j.id))[1] as all_signals,
            (array_agg(j.reasons) filter (where j.reasons is not null))[1] as reasons,
            (array_agg(j.concerns) filter (where j.concerns is not null))[1] as concerns,
            (array_agg(d.decision) filter (where d.decision is not null))[1] as decision,
            (array_agg(d.status) filter (where d.status is not null))[1] as status,
            min(j.created_at) as discovered_at,
            -- Lever calls it commitment, Jobicy calls it jobType and stores it
            -- as a one-element array; nobody else publishes it at all
            (array_agg(coalesce(j.raw#>>'{jobType,0}', j.raw#>>'{categories,commitment}')
                       order by (coalesce(j.raw#>>'{jobType,0}', j.raw#>>'{categories,commitment}') is null), j.id))[1]
              as employment_type,
            (array_agg(j.raw->>'jobLevel'
                       order by (j.raw->>'jobLevel' is null), j.id))[1] as seniority,
            json_agg(json_build_object(
              'location', j.location, 'url', j.url,
              'source', j.source, 'posted_at', j.posted_at
            ) order by j.posted_at desc nulls last) as postings_detail
       from jobs j
       left join decisions d on d.job_id = j.id
      where j.fingerprint = $1 and not j.closed
      group by j.fingerprint`,
    [fingerprint],
  );

  const row = rows[0];
  if (!row) return null;
  return { ...trim(row), all_signals: (row.all_signals ?? []).filter((s) => s.matched) };
}

// --------------------------------------------------------------- dashboard

export type Dashboard = {
  queue: number;
  aboveFifty: number;
  decidedToday: number;
  interested: number;
  rejected: number;
  openJobs: number;
  closedJobs: number;
  companies: number;
  feeds: number;
  newThisWeek: number;
  withSalary: number;
  byStatus: Array<{ status: Status; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  lastRun: { id: string; started_at: string; finished_at: string | null; ok: number | null; failed: number | null } | null;
  top: Row[];
};

export async function dashboard(): Promise<Dashboard> {
  const [counts, byStatus, bySource, lastRun, top] = await Promise.all([
    pool().query<Record<string, string>>(
      `select
         (select count(distinct fingerprint) from jobs
           where score is not null and not closed
             and not exists (select 1 from decisions d where d.job_id = jobs.id)) as queue,
         (select count(distinct fingerprint) from jobs
           where score > 50 and not closed
             and not exists (select 1 from decisions d where d.job_id = jobs.id)) as above_fifty,
         (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id
           where d.decided_at >= date_trunc('day', now())) as decided_today,
         (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id
           where d.decision = 'interested') as interested,
         (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id
           where d.decision = 'rejected') as rejected,
         (select count(*) from jobs where not closed) as open_jobs,
         (select count(*) from jobs where closed) as closed_jobs,
         (select count(*) from companies where active) as companies,
         (select count(*) from sources where active) as feeds,
         (select count(*) from jobs where not closed and created_at >= now() - interval '7 days') as new_this_week,
         (select count(*) from jobs where not closed and salary_text is not null) as with_salary`,
    ),
    pool().query<{ status: Status; count: string }>(
      `select d.status, count(distinct j.fingerprint)::text as count
         from decisions d join jobs j on j.id = d.job_id
        where d.decision = 'interested' group by d.status`,
    ),
    pool().query<{ source: string; count: string }>(
      `select source, count(distinct fingerprint)::text as count from jobs
        where not closed and score is not null group by source order by 2 desc`,
    ),
    pool().query(
      `select id::text, started_at, finished_at, ok, failed from runs order by id desc limit 1`,
    ),
    pool().query<Row>(
      `select ${GROUPED_COLUMNS}, null::text as note, null::timestamptz as decided_at
         from jobs j
        where j.score is not null and not j.closed
          and not exists (select 1 from decisions d where d.job_id = j.id)
        group by j.fingerprint
        order by max(j.score) desc limit 5`,
    ),
  ]);

  const c = counts.rows[0] ?? {};
  const n = (key: string) => Number(c[key] ?? 0);

  return {
    queue: n("queue"),
    aboveFifty: n("above_fifty"),
    decidedToday: n("decided_today"),
    interested: n("interested"),
    rejected: n("rejected"),
    openJobs: n("open_jobs"),
    closedJobs: n("closed_jobs"),
    companies: n("companies"),
    feeds: n("feeds"),
    newThisWeek: n("new_this_week"),
    withSalary: n("with_salary"),
    byStatus: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
    bySource: bySource.rows.map((r) => ({ source: r.source, count: Number(r.count) })),
    lastRun: (lastRun.rows[0] as Dashboard["lastRun"]) ?? null,
    top: top.rows.map(trim),
  };
}

// ---------------------------------------------------------------- analytics

/** The raw score above which a job counts as a strong match on the charts. */
export const STRONG_SCORE = 50;

export type Analytics = {
  /** one row per day for the last 30, zero-filled so the line has no gaps */
  discovered: Array<{ day: string; discovered: number; matched: number }>;
  /** buckets of ten across the whole observed score range */
  scoreHistogram: Array<{ floor: number; label: string; count: number; strong: boolean }>;
  /** applications sent per ISO week for the last eight */
  applicationsByWeek: Array<{ week: string; label: string; count: number }>;
  /**
   * Of the applications actually sent, how many reached an interview, and how
   * many drew any answer at all. "Rejected" is the only signal the schema has
   * for a negative answer, and it is a state you set by hand — so a role you
   * closed yourself counts the same as one they closed on you. There is no
   * column that tells the two apart.
   */
  rates: { applied: number; interviewed: number; answered: number };
  decisionsByDay: Array<{ day: string; interested: number; rejected: number }>;
  runs: Array<{
    id: string;
    started_at: string;
    finished_at: string | null;
    ok: number | null;
    failed: number | null;
    inserted: number | null;
    updated: number | null;
  }>;
  scoreBuckets: Array<{ bucket: string; count: number; floor: number }>;
  topCompanies: Array<{ company: string; jobs: number; best: number }>;
  bySource: Array<{ source: string; jobs: number; median: number; withSalary: number }>;
  signalRates: Array<{ name: string; weight: number; matched: number; pct: number }>;
  funnel: { seen: number; queued: number; decided: number; interested: number; applied: number };
};

export async function analytics(): Promise<Analytics> {
  const [byDay, runs, buckets, companies, sources, signals, funnel, discovered, histogram, byWeek, rates] =
    await Promise.all([
    pool().query<{ day: string; interested: string; rejected: string }>(
      `select to_char(date_trunc('day', d.decided_at), 'YYYY-MM-DD') as day,
              count(*) filter (where d.decision = 'interested')::text as interested,
              count(*) filter (where d.decision = 'rejected')::text as rejected
         from decisions d
        where d.decided_at >= now() - interval '30 days'
        group by 1 order by 1`,
    ),
    pool().query(
      `select id::text, started_at, finished_at, ok, failed, inserted, updated
         from runs order by id desc limit 14`,
    ),
    pool().query<{ bucket: string; count: string; floor: string }>(
      `select case
                when score >= 80 then '80+'
                when score >= 60 then '60-79'
                when score >= 40 then '40-59'
                when score >= 20 then '20-39'
                when score >= 0  then '0-19'
                else 'below 0' end as bucket,
              count(*)::text as count,
              (case when score >= 80 then 80 when score >= 60 then 60 when score >= 40 then 40
                    when score >= 20 then 20 when score >= 0 then 0 else -100 end)::text as floor
         from jobs where score is not null and not closed
        group by 1, 3 order by 3 desc`,
    ),
    pool().query<{ company: string; jobs: string; best: string }>(
      `select company, count(distinct fingerprint)::text as jobs, max(score)::text as best
         from jobs where not closed and score is not null
        group by company order by max(score) desc, 2 desc limit 12`,
    ),
    pool().query<{ source: string; jobs: string; median: string; withsalary: string }>(
      `select source, count(*)::text as jobs,
              percentile_cont(0.5) within group (order by score)::int::text as median,
              count(*) filter (where salary_text is not null)::text as withsalary
         from jobs where not closed and score is not null
        group by source order by 2 desc`,
    ),
    pool().query<{ name: string; weight: string; matched: string; pct: string }>(
      `select s->>'name' as name,
              coalesce(
                round(avg((s->>'weight')::int) filter (where (s->>'matched')::boolean)),
                round(avg((s->>'weight')::int))
              )::int::text as weight,
              count(*) filter (where (s->>'matched')::boolean)::text as matched,
              round(100.0 * count(*) filter (where (s->>'matched')::boolean) / nullif(count(*), 0), 1)::text as pct
         from jobs, lateral jsonb_array_elements(score_signals) s
        where not closed
        group by 1 order by 4 desc nulls last`,
    ),
    pool().query<Record<string, string>>(
      `select
         (select count(*) from jobs)::text as seen,
         (select count(distinct fingerprint) from jobs where score is not null and not closed)::text as queued,
         (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id)::text as decided,
         (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id
           where d.decision = 'interested')::text as interested,
         (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id
           where d.decision = 'interested' and d.applied_at is not null)::text as applied`,
    ),

    // every day of the last 30, whether or not anything landed on it, so the
    // line is continuous rather than skipping quiet days
    pool().query<{ day: string; discovered: string; matched: string }>(
      `select to_char(d.day, 'YYYY-MM-DD') as day,
              count(j.id)::text as discovered,
              count(j.id) filter (where j.score > $1)::text as matched
         from generate_series(
                date_trunc('day', now()) - interval '29 days',
                date_trunc('day', now()),
                interval '1 day') as d(day)
         left join jobs j on date_trunc('day', j.created_at) = d.day
        group by d.day order by d.day`,
      [STRONG_SCORE],
    ),

    // zero-filled across the observed range: a histogram that omits its empty
    // buckets puts 70 next to 90 and implies there is nothing between them
    pool().query<{ floor: string; count: string }>(
      `with scored as (
         select (floor(score / 10.0) * 10)::int as bucket
           from jobs where score is not null and not closed
       ), bounds as (
         select min(bucket) as lo, max(bucket) as hi from scored
       )
       select g.bucket::text as floor, count(s.bucket)::text as count
         from bounds, generate_series(bounds.lo, bounds.hi, 10) as g(bucket)
         left join scored s on s.bucket = g.bucket
        group by g.bucket order by g.bucket`,
    ),

    pool().query<{ week: string; count: string }>(
      `select to_char(w.week, 'YYYY-MM-DD') as week,
              count(d.id)::text as count
         from generate_series(
                date_trunc('week', now()) - interval '7 weeks',
                date_trunc('week', now()),
                interval '1 week') as w(week)
         left join decisions d
           on d.applied_at is not null and date_trunc('week', d.applied_at) = w.week
        group by w.week order by w.week`,
    ),

    pool().query<Record<string, string>>(
      `select
         count(*) filter (where applied_at is not null)::text as applied,
         count(*) filter (where applied_at is not null
                            and status in ('interview', 'offer'))::text as interviewed,
         count(*) filter (where applied_at is not null
                            and status in ('interview', 'offer', 'rejected'))::text as answered
         from decisions`,
    ),
  ]);

  const f = funnel.rows[0] ?? {};
  const r = rates.rows[0] ?? {};

  return {
    discovered: discovered.rows.map((row) => ({
      day: row.day,
      discovered: Number(row.discovered),
      matched: Number(row.matched),
    })),
    scoreHistogram: histogram.rows.map((row) => {
      const floor = Number(row.floor);
      return {
        floor,
        label: `${floor}`,
        count: Number(row.count),
        strong: floor >= STRONG_SCORE,
      };
    }),
    applicationsByWeek: byWeek.rows.map((row) => ({
      week: row.week,
      label: `W${isoWeek(new Date(row.week))}`,
      count: Number(row.count),
    })),
    rates: {
      applied: Number(r["applied"] ?? 0),
      interviewed: Number(r["interviewed"] ?? 0),
      answered: Number(r["answered"] ?? 0),
    },
    decisionsByDay: byDay.rows.map((r) => ({
      day: r.day,
      interested: Number(r.interested),
      rejected: Number(r.rejected),
    })),
    runs: runs.rows as Analytics["runs"],
    scoreBuckets: buckets.rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count),
      floor: Number(r.floor),
    })),
    topCompanies: companies.rows.map((r) => ({
      company: r.company,
      jobs: Number(r.jobs),
      best: Number(r.best),
    })),
    bySource: sources.rows.map((r) => ({
      source: r.source,
      jobs: Number(r.jobs),
      median: Number(r.median ?? 0),
      withSalary: Number(r.withsalary),
    })),
    signalRates: signals.rows.map((r) => ({
      name: r.name,
      weight: Number(r.weight),
      matched: Number(r.matched),
      pct: Number(r.pct ?? 0),
    })),
    funnel: {
      seen: Number(f["seen"] ?? 0),
      queued: Number(f["queued"] ?? 0),
      decided: Number(f["decided"] ?? 0),
      interested: Number(f["interested"] ?? 0),
      applied: Number(f["applied"] ?? 0),
    },
  };
}

// -------------------------------------------------------------------- scout

export type ScanStep = {
  id: string;
  stage: string;
  label: string | null;
  status: string;
  detail: string | null;
  fetched: number | null;
  inserted: number | null;
  closed: number | null;
  at: string;
};

export type Scout = {
  run: {
    id: string;
    started_at: string;
    finished_at: string | null;
    companies: number | null;
    ok: number | null;
    failed: number | null;
    inserted: number | null;
    updated: number | null;
  } | null;
  steps: ScanStep[];
  running: boolean;
  targets: Array<{
    label: string;
    kind: string;
    interval: number;
    last_ok_at: string | null;
    last_error: string | null;
    due: boolean;
  }>;
};

export async function scout(): Promise<Scout> {
  const [runRows, targets] = await Promise.all([
    pool().query(
      `select id::text, started_at, finished_at, companies, ok, failed, inserted, updated
         from runs order by id desc limit 1`,
    ),
    pool().query(
      `select ats || '/' || token as label, 'ats' as kind, min_interval_minutes as interval,
              last_ok_at, last_error,
              (last_ok_at is null or last_ok_at < now() - make_interval(mins => min_interval_minutes)) as due
         from companies where active
        union all
       select 'feed/' || name, 'feed', min_interval_minutes, last_ok_at, last_error,
              (last_ok_at is null or last_ok_at < now() - make_interval(mins => min_interval_minutes))
         from sources where active
        order by 1`,
    ),
  ]);

  const run = (runRows.rows[0] as Scout["run"]) ?? null;
  const steps = run
    ? (
        await pool().query<ScanStep>(
          `select id::text, stage, label, status, detail, fetched, inserted, closed, at
             from scan_progress where run_id = $1 order by id`,
          [run.id],
        )
      ).rows
    : [];

  return {
    run,
    steps,
    running: !!run && run.finished_at === null,
    targets: targets.rows as Scout["targets"],
  };
}

// ----------------------------------------------------------------- shell

export type NavCounts = {
  queue: number;
  applications: number;
  scoutRunning: boolean;
  scoutLabel: string;
  scoutDone: number;
  scoutTotal: number;
  scoutState: "running" | "ok" | "failed" | "idle";
  lastRunAt: string | null;
  failing: number;
};

/** Everything the shell needs: nav badges plus the live scout block. */
export async function navCounts(): Promise<NavCounts> {
  const { rows } = await pool().query<Record<string, string | null>>(
    `select
       (select count(distinct fingerprint) from jobs
         where score is not null and not closed
           and not exists (select 1 from decisions d where d.job_id = jobs.id))::text as queue,
       (select count(distinct j.fingerprint) from jobs j join decisions d on d.job_id = j.id
         where d.decision = 'interested')::text as applications,
       (select (count(*) filter (where active and last_error is not null)) from companies)::text as failing_a,
       (select (count(*) filter (where active and last_error is not null)) from sources)::text as failing_b,
       (select id::text from runs order by id desc limit 1) as run_id,
       (select started_at::text from runs order by id desc limit 1) as started_at,
       (select finished_at::text from runs order by id desc limit 1) as finished_at,
       (select companies::text from runs order by id desc limit 1) as targets`,
  );

  const r = rows[0] ?? {};
  const runId = r["run_id"];
  const finished = r["finished_at"];

  let done = 0;
  let total = Number(r["targets"] ?? 0);
  let label = "Idle";
  let state: NavCounts["scoutState"] = "idle";

  if (runId) {
    const { rows: steps } = await pool().query<{ stage: string; status: string; label: string | null }>(
      `select stage, status, label from scan_progress where run_id = $1 order by id`,
      [runId],
    );
    done = steps.filter((s) => s.stage === "target" && s.status !== "running").length;
    if (total === 0) total = Math.max(done, steps.filter((s) => s.stage === "target").length);

    const running = !finished;
    const last = steps.at(-1);
    state = running ? "running" : steps.some((s) => s.status === "failed") ? "failed" : "ok";
    label = running
      ? last?.label
        ? `Scanning ${last.label}`
        : "Scanning"
      : state === "failed"
        ? "Last scan had failures"
        : "Last scan clean";
  }

  return {
    queue: Number(r["queue"] ?? 0),
    applications: Number(r["applications"] ?? 0),
    scoutRunning: !!runId && !finished,
    scoutLabel: label,
    scoutDone: done,
    scoutTotal: total,
    scoutState: state,
    lastRunAt: finished ?? r["started_at"] ?? null,
    failing: Number(r["failing_a"] ?? 0) + Number(r["failing_b"] ?? 0),
  };
}

// ------------------------------------------------------------------ settings

export type SettingsData = {
  companies: Array<{ name: string; ats: string; token: string; active: boolean; interval: number; last_error: string | null }>;
  sources: Array<{ name: string; kind: string; url: string; active: boolean; interval: number; attribution: string | null }>;
  profileChars: number;
};

export async function settings(): Promise<SettingsData> {
  const [companies, sources] = await Promise.all([
    pool().query(
      `select name, ats, token, active, min_interval_minutes as interval, last_error
         from companies order by name limit 200`,
    ),
    pool().query(
      `select name, kind, url, active, min_interval_minutes as interval,
              case when attribution_required then attribution_text else null end as attribution
         from sources order by name`,
    ),
  ]);

  return {
    companies: companies.rows as SettingsData["companies"],
    sources: sources.rows as SettingsData["sources"],
    profileChars: 0,
  };
}

/**
 * ISO-8601 week number, for the W31 labels on the applications chart.
 * Postgres could give this directly, but the week has to be derived from the
 * same bucket boundary the query grouped on, so it is done here from the
 * bucket's own start date.
 */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks run Monday to Sunday and are numbered by the Thursday they contain
  const dayNumber = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

// ------------------------------------------------------------ home screen

export type StageName = "Searching" | "Analyzing" | "Matching" | "Ranking" | "Notifying";

export type Stage = {
  name: StageName;
  /** "done" and "running" are observed; "waiting" has not started yet */
  state: "done" | "running" | "waiting" | "unavailable";
  detail: string;
};

export type NextStep =
  | { kind: "apply"; fingerprint: string; title: string; company: string; score: number }
  | { kind: "interview"; fingerprint: string; title: string; company: string; since: string | null }
  | { kind: "review"; fingerprint: string; title: string; company: string; since: string | null };

export type Home = {
  /** jobs first seen since the timestamp the caller passed, or in the last day */
  sinceLastVisit: number;
  sinceIsFallback: boolean;

  stats: {
    newToday: number;
    newYesterday: number;
    strongOpen: number;
    strongThisWeek: number;
    saved: number;
    needAction: number;
    applications: number;
    interviews: number;
  };

  scout: {
    runId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    running: boolean;
    activity: string;
    stages: Stage[];
    sourcesScanned: number;
    jobsAnalyzed: number;
    relevantMatches: number;
  };

  nextSteps: NextStep[];
  recommended: Row[];
  pipeline: Array<{ status: Status; count: number }>;
  pipelineTotal: number;
  feed: Array<{ at: string; label: string; detail: string; state: string }>;
};

/**
 * Everything the home screen shows, in one round trip's worth of parallel
 * queries. `since` is the timestamp of the viewer's last visit, read from a
 * cookie; with no cookie there is no "since", so the count falls back to the
 * last 24 hours and says so.
 */
export async function home(since: Date | null): Promise<Home> {
  const sinceOrDay = since ?? new Date(Date.now() - 86_400_000);

  const [visit, stats, run, progress, steps, recommended, pipeline, feed] = await Promise.all([
    pool().query<{ n: string }>(
      `select count(*)::text as n from jobs where created_at > $1 and not closed`,
      [sinceOrDay],
    ),

    pool().query<Record<string, string>>(
      `select
         (select count(*) from jobs
           where created_at >= date_trunc('day', now()) and not closed)::text as new_today,
         (select count(*) from jobs
           where created_at >= date_trunc('day', now()) - interval '1 day'
             and created_at < date_trunc('day', now()) and not closed)::text as new_yesterday,
         (select count(distinct fingerprint) from jobs
           where score > $1 and not closed)::text as strong_open,
         (select count(distinct fingerprint) from jobs
           where score > $1 and not closed
             and created_at >= date_trunc('week', now()))::text as strong_this_week,
         (select count(*) from decisions where decision = 'interested')::text as saved,
         -- saved three days ago or more and still not sent
         (select count(*) from decisions
           where decision = 'interested' and applied_at is null
             and decided_at < now() - interval '3 days')::text as need_action,
         (select count(*) from decisions where applied_at is not null)::text as applications,
         (select count(*) from decisions where status = 'interview')::text as interviews`,
      [STRONG_SCORE],
    ),

    pool().query<{
      id: string; started_at: string; finished_at: string | null;
      companies: number | null; ok: number | null; failed: number | null;
      fetched: number | null; inserted: number | null;
    }>(
      `select id::text, started_at, finished_at, companies, ok, failed, fetched, inserted
         from runs order by id desc limit 1`,
    ),

    pool().query<{ stage: string; status: string; label: string | null; detail: string | null; at: string }>(
      `select stage, status, label, detail, at
         from scan_progress
        where run_id = (select max(id) from runs)
        order by id desc`,
    ),

    // the three "what to do next" candidates, each the single best of its kind
    pool().query<{ kind: string; fingerprint: string; title: string; company: string; score: number; since: string | null }>(
      `(select 'apply' as kind, j.fingerprint, j.title, j.company, j.score, null::timestamptz as since
          from jobs j
         where j.score is not null and not j.closed
           and not exists (select 1 from decisions d where d.job_id = j.id)
         order by j.score desc limit 1)
       union all
       (select 'interview', j.fingerprint, j.title, j.company, j.score, d.applied_at
          from jobs j join decisions d on d.job_id = j.id
         where d.status = 'interview'
         order by d.applied_at desc nulls last limit 1)
       union all
       (select 'review', j.fingerprint, j.title, j.company, j.score, d.decided_at
          from jobs j join decisions d on d.job_id = j.id
         where d.decision = 'interested' and d.applied_at is null
           and d.decided_at < now() - interval '3 days'
         order by d.decided_at asc limit 1)`,
    ),

    pool().query<Row>(
      `select ${GROUPED_COLUMNS}, null::text as note, null::timestamptz as decided_at
         from jobs j
        where j.score is not null and not j.closed
          and not exists (select 1 from decisions d where d.job_id = j.id)
        group by j.fingerprint
        order by max(j.score) desc, max(j.posted_at) desc nulls last
        limit 3`,
    ),

    pool().query<{ status: Status; count: string }>(
      `select status, count(*)::text as count
         from decisions where decision = 'interested' group by status`,
    ),

    // The activity feed. A target writes a "running" row and then an "ok" or
    // "failed" one, so distinct on (stage, label) keeps only where each board
    // ended up — otherwise every board appears twice.
    pool().query<{ at: string; label: string; detail: string; state: string }>(
      `(select at, label, detail, state from (
          select distinct on (stage, label)
                 at, coalesce(label, stage) as label,
                 coalesce(detail, '') as detail, status as state
            from scan_progress
           order by stage, label, id desc
        ) latest order by at desc limit 8)
        union all
       (select coalesce(finished_at, started_at) as at,
               'run #' || id::text as label,
               coalesce(inserted, 0)::text || ' new, ' || coalesce(updated, 0)::text || ' refreshed' as detail,
               case when finished_at is null then 'running'
                    when coalesce(failed, 0) > 0 then 'failed' else 'ok' end as state
          from runs order by id desc limit 4)
        order by at desc`,
    ),
  ]);

  const s = stats.rows[0] ?? {};
  const n = (key: string) => Number(s[key] ?? 0);

  const latest = run.rows[0] ?? null;
  const running = latest !== null && latest.finished_at === null;
  const targets = progress.rows.filter((row) => row.stage === "target");
  const finishedTargets = targets.filter((row) => row.status !== "running");
  const doneRow = progress.rows.find((row) => row.stage === "done");

  const jobsAnalyzed = Number(latest?.fetched ?? 0);
  const inserted = Number(latest?.inserted ?? 0);

  const searching: Stage = doneRow
    ? { name: "Searching", state: "done", detail: `${finishedTargets.length} boards scanned` }
    : running
      ? { name: "Searching", state: "running", detail: `${finishedTargets.length} of ${targets.length} boards` }
      : { name: "Searching", state: "waiting", detail: "idle" };

  /**
   * Scoring runs as its own script and writes no progress rows, so these three
   * are derived from the jobs themselves rather than from a stage the crawler
   * reports. They complete together because scoring is a single pass.
   */
  const scoredAll = inserted === 0 || !running;
  const scoringStage = (name: StageName, detail: string): Stage => ({
    name,
    state: doneRow || scoredAll ? "done" : "running",
    detail,
  });

  const stages: Stage[] = [
    searching,
    scoringStage("Analyzing", `${jobsAnalyzed.toLocaleString()} postings read`),
    scoringStage("Matching", "signals matched per posting"),
    scoringStage("Ranking", "ordered by score"),
    // there is no notifier in this codebase — no table, no sender, no schedule
    { name: "Notifying", state: "unavailable", detail: "not built" },
  ];

  const activity = running
    ? (progress.rows.find((row) => row.status === "running")?.label ?? "scanning")
    : latest
      ? `last scan finished · ${inserted} new, ${Number(latest.ok ?? 0)} boards ok`
      : "no scan has run yet";

  return {
    sinceLastVisit: Number(visit.rows[0]?.n ?? 0),
    sinceIsFallback: since === null,
    stats: {
      newToday: n("new_today"),
      newYesterday: n("new_yesterday"),
      strongOpen: n("strong_open"),
      strongThisWeek: n("strong_this_week"),
      saved: n("saved"),
      needAction: n("need_action"),
      applications: n("applications"),
      interviews: n("interviews"),
    },
    scout: {
      runId: latest?.id ?? null,
      startedAt: latest?.started_at ?? null,
      finishedAt: latest?.finished_at ?? null,
      running,
      activity,
      stages,
      sourcesScanned: Number(latest?.companies ?? targets.length),
      jobsAnalyzed,
      relevantMatches: n("strong_open"),
    },
    nextSteps: steps.rows.map((row) =>
      row.kind === "apply"
        ? { kind: "apply", fingerprint: row.fingerprint, title: row.title, company: row.company, score: row.score }
        : {
            kind: row.kind as "interview" | "review",
            fingerprint: row.fingerprint,
            title: row.title,
            company: row.company,
            since: row.since,
          },
    ),
    recommended: recommended.rows.map(trim),
    pipeline: pipeline.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    pipelineTotal: pipeline.rows.reduce((sum, row) => sum + Number(row.count), 0),
    feed: feed.rows,
  };
}

/**
 * The crawl workflow's cron, mirrored here so the home screen can say when the
 * next one is due. If .github/workflows/crawl.yml changes, this changes with it.
 */
export const CRAWL_EVERY_HOURS = 6;

/** Minutes until the next scheduled crawl, on a "0 star/6" hourly cron. */
export function minutesToNextScan(now = new Date()): number {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  const hour = now.getUTCHours();
  next.setUTCHours((Math.floor(hour / CRAWL_EVERY_HOURS) + 1) * CRAWL_EVERY_HOURS);
  return Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
}
