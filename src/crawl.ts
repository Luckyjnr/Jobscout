import { closeMissing, pool, upsertJobs } from "./db.js";
import { CRAWL_DELAY_MS, sleep } from "./http.js";
import { fetchAshbyWithStats } from "./sources/ashby.js";
import { FEED_BY_NAME } from "./sources/feeds.js";
import { fetchGreenhouseWithStats } from "./sources/greenhouse.js";
import { fetchLeverWithStats } from "./sources/lever.js";
import { fetchFeedWithStats } from "./sources/rss.js";
import { SUPPORTED_ATS, type Ats } from "./verifyToken.js";

export type Company = {
  id: string;
  name: string;
  ats: string;
  token: string;
};

export type Feed = {
  id: string;
  name: string;
  kind: string;
  url: string;
  closes_missing: boolean;
};

export type Target =
  | { type: "company"; company: Company }
  | { type: "feed"; feed: Feed };

export type Outcome = {
  label: string;
  ok: boolean;
  fetched: number;
  skipped: number;
  inserted: number;
  updated: number;
  /** postings this board stopped listing */
  closed: number;
  error?: string;
};

export type CrawlSummary = {
  companies: number;
  ok: number;
  failed: number;
  /** targets whose poll interval had not elapsed */
  waiting: number;
  fetched: number;
  skipped: number;
  inserted: number;
  updated: number;
  closed: number;
  outcomes: Outcome[];
};

export type CrawlOptions = {
  /** run every target regardless of its min_interval_minutes */
  ignoreIntervals?: boolean;
  /** the runs row this crawl belongs to, so progress can be attributed */
  runId?: string | null;
};

/**
 * Progress is written as the crawl goes, not summarised at the end, so a page
 * polling scan_progress sees a run in flight rather than only its result.
 * A failure to record progress must never take the crawl down with it.
 */
async function note(
  runId: string | null | undefined,
  stage: string,
  status: string,
  fields: { label?: string; detail?: string; fetched?: number; inserted?: number; closed?: number } = {},
): Promise<void> {
  if (!runId) return;
  try {
    await pool.query(
      `insert into scan_progress (run_id, stage, label, status, detail, fetched, inserted, closed)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        stage,
        fields.label ?? null,
        status,
        fields.detail ?? null,
        fields.fetched ?? null,
        fields.inserted ?? null,
        fields.closed ?? null,
      ],
    );
  } catch (err) {
    console.error(`could not record progress: ${describe(err)}`);
  }
}

/**
 * Both queries apply the same rule: a target is due when it has never
 * succeeded, or its last success is older than its own minimum interval.
 * Jobicy asks for "a few times daily", so its row carries 240 and a 6-hourly
 * cron simply skips it most of the time.
 */
const DUE = `(last_ok_at is null or last_ok_at < now() - make_interval(mins => min_interval_minutes))`;

export async function activeCompanies(ignoreIntervals = false): Promise<Company[]> {
  const { rows } = await pool.query<Company>(
    `select id::text, name, ats, token
       from companies
      where active ${ignoreIntervals ? "" : `and ${DUE}`}
      order by id`,
  );
  return rows;
}

export async function activeFeeds(ignoreIntervals = false): Promise<Feed[]> {
  const { rows } = await pool.query<Feed>(
    `select id::text, name, kind, url, closes_missing
       from sources
      where active ${ignoreIntervals ? "" : `and ${DUE}`}
      order by id`,
  );
  return rows;
}

async function countWaiting(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select ((select count(*) from companies where active and not ${DUE})
           + (select count(*) from sources   where active and not ${DUE}))::text as n`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function recordOk(table: "companies" | "sources", id: string): Promise<void> {
  await pool.query(`update ${table} set last_ok_at = now(), last_error = null where id = $1`, [id]);
}

async function recordError(table: "companies" | "sources", id: string, error: string): Promise<void> {
  await pool.query(`update ${table} set last_error = $2 where id = $1`, [id, error]);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function crawlOne(target: Target, runId?: string | null): Promise<Outcome> {
  const table = target.type === "company" ? "companies" : "sources";
  const id = target.type === "company" ? target.company.id : target.feed.id;
  const label =
    target.type === "company"
      ? `${target.company.ats}/${target.company.token}`
      : `feed/${target.feed.name}`;

  const base = { label, fetched: 0, skipped: 0, inserted: 0, updated: 0, closed: 0 };
  await note(runId, "target", "running", { label });

  try {
    if (target.type === "company") {
      const { company } = target;
      if (!(SUPPORTED_ATS as readonly string[]).includes(company.ats)) {
        throw new Error(`unsupported ats "${company.ats}"`);
      }
      const ats = company.ats as Ats;
      const fetched =
        ats === "greenhouse"
          ? await fetchGreenhouseWithStats(company.token)
          : ats === "ashby"
            ? await fetchAshbyWithStats(company.token, company.name)
            : await fetchLeverWithStats(company.token, company.name);

      const { inserted, updated } = await upsertJobs(fetched.jobs, label);
      // an ATS board returns its whole list, so anything absent is gone
      const closed = await closeMissing(label, fetched.jobs.map((job) => job.sourceId));
      await recordOk(table, id);
      await note(runId, "target", "ok", { label, fetched: fetched.fetched, inserted, closed });
      return { ...base, ok: true, fetched: fetched.fetched, skipped: fetched.skipped, inserted, updated, closed };
    }

    const mapping = FEED_BY_NAME.get(target.feed.name);
    if (!mapping) throw new Error(`no mapping for feed "${target.feed.name}"`);

    const fetched = await fetchFeedWithStats(mapping);
    const { inserted, updated } = await upsertJobs(fetched.jobs, label);
    // most feeds are a rolling window, so absence proves nothing
    const closed = target.feed.closes_missing
      ? await closeMissing(label, fetched.jobs.map((job) => job.sourceId))
      : 0;
    await recordOk(table, id);
    await note(runId, "target", "ok", { label, fetched: fetched.fetched, inserted, closed });
    return { ...base, ok: true, fetched: fetched.fetched, skipped: fetched.skipped, inserted, updated, closed };
  } catch (err) {
    const error = describe(err);
    // a failure to record the failure must not take the crawl down either
    try {
      await recordError(table, id, error);
    } catch (nested) {
      console.error(`${label}: could not store last_error — ${describe(nested)}`);
    }
    await note(runId, "target", "failed", { label, detail: error });
    return { ...base, ok: false, error };
  }
}

/**
 * Walk every due target, one at a time. A target that throws is recorded in
 * `last_error` and the crawl moves on to the next one.
 */
export async function crawl(options: CrawlOptions = {}): Promise<CrawlSummary> {
  const ignore = options.ignoreIntervals ?? false;
  const [companies, feeds, waiting] = await Promise.all([
    activeCompanies(ignore),
    activeFeeds(ignore),
    ignore ? Promise.resolve(0) : countWaiting(),
  ]);

  await note(options.runId, "start", "running", {
    detail: `${companies.length + feeds.length} targets due, ${waiting} waiting`,
  });

  const targets: Target[] = [
    ...companies.map((company): Target => ({ type: "company", company })),
    ...feeds.map((feed): Target => ({ type: "feed", feed })),
  ];

  const summary: CrawlSummary = {
    companies: targets.length,
    ok: 0,
    failed: 0,
    waiting,
    fetched: 0,
    skipped: 0,
    inserted: 0,
    updated: 0,
    closed: 0,
    outcomes: [],
  };

  for (const [index, target] of targets.entries()) {
    // the boards declare Crawl-delay: 1, so space the requests out
    if (index > 0) await sleep(CRAWL_DELAY_MS);

    const outcome = await crawlOne(target, options.runId);
    summary.outcomes.push(outcome);
    summary.fetched += outcome.fetched;
    summary.skipped += outcome.skipped;
    summary.inserted += outcome.inserted;
    summary.updated += outcome.updated;
    summary.closed += outcome.closed;

    if (outcome.ok) {
      summary.ok += 1;
      console.log(
        `${outcome.label}: fetched ${outcome.fetched}, skipped ${outcome.skipped}, inserted ${outcome.inserted}, updated ${outcome.updated}` +
          (outcome.closed > 0 ? `, closed ${outcome.closed}` : ""),
      );
    } else {
      summary.failed += 1;
      console.error(`${outcome.label}: ${outcome.error}`);
    }
  }

  if (waiting > 0) {
    console.log(`\n${waiting} target(s) not due yet (per-source poll interval)`);
  }

  await note(options.runId, "done", summary.failed > 0 ? "failed" : "ok", {
    detail: `${summary.ok} ok, ${summary.failed} failed`,
    fetched: summary.fetched,
    inserted: summary.inserted,
    closed: summary.closed,
  });

  return summary;
}
