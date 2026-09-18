import { pool, upsertJobs } from "./db.js";
import { CRAWL_DELAY_MS, sleep } from "./http.js";
import { fetchAshbyWithStats } from "./sources/ashby.js";
import { fetchGreenhouseWithStats } from "./sources/greenhouse.js";
import { fetchLeverWithStats } from "./sources/lever.js";
import { SUPPORTED_ATS, type Ats } from "./verifyToken.js";

export type Company = {
  id: string;
  name: string;
  ats: string;
  token: string;
};

export type CompanyOutcome = {
  company: Company;
  ok: boolean;
  fetched: number;
  skipped: number;
  inserted: number;
  updated: number;
  error?: string;
};

export type CrawlSummary = {
  companies: number;
  ok: number;
  failed: number;
  fetched: number;
  skipped: number;
  inserted: number;
  updated: number;
  outcomes: CompanyOutcome[];
};

export async function activeCompanies(): Promise<Company[]> {
  const { rows } = await pool.query<Company>(
    `select id::text, name, ats, token
       from companies
      where active
      order by id`,
  );
  return rows;
}

async function recordOk(company: Company): Promise<void> {
  await pool.query(`update companies set last_ok_at = now(), last_error = null where id = $1`, [
    company.id,
  ]);
}

async function recordError(company: Company, error: string): Promise<void> {
  await pool.query(`update companies set last_error = $2 where id = $1`, [company.id, error]);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function crawlCompany(company: Company): Promise<CompanyOutcome> {
  const base = { company, fetched: 0, skipped: 0, inserted: 0, updated: 0 };

  try {
    if (!(SUPPORTED_ATS as readonly string[]).includes(company.ats)) {
      throw new Error(`unsupported ats "${company.ats}"`);
    }

    const ats = company.ats as Ats;
    const { jobs, fetched, skipped } =
      ats === "greenhouse"
        ? await fetchGreenhouseWithStats(company.token)
        : ats === "ashby"
          ? await fetchAshbyWithStats(company.token, company.name)
          : await fetchLeverWithStats(company.token, company.name);

    const { inserted, updated } = await upsertJobs(jobs);
    await recordOk(company);
    return { ...base, ok: true, fetched, skipped, inserted, updated };
  } catch (err) {
    const error = describe(err);
    // a failure to record the failure must not take the crawl down either
    try {
      await recordError(company, error);
    } catch (nested) {
      console.error(`${company.ats}/${company.token}: could not store last_error — ${describe(nested)}`);
    }
    return { ...base, ok: false, error };
  }
}

/**
 * Walk every active company, one board at a time. A company that throws is
 * recorded in `last_error` and the crawl moves on to the next one.
 */
export async function crawl(): Promise<CrawlSummary> {
  const companies = await activeCompanies();

  const summary: CrawlSummary = {
    companies: companies.length,
    ok: 0,
    failed: 0,
    fetched: 0,
    skipped: 0,
    inserted: 0,
    updated: 0,
    outcomes: [],
  };

  for (const [index, company] of companies.entries()) {
    // both boards declare Crawl-delay: 1, so space the requests out
    if (index > 0) await sleep(CRAWL_DELAY_MS);

    const outcome = await crawlCompany(company);
    summary.outcomes.push(outcome);
    summary.fetched += outcome.fetched;
    summary.skipped += outcome.skipped;
    summary.inserted += outcome.inserted;
    summary.updated += outcome.updated;

    if (outcome.ok) {
      summary.ok += 1;
      console.log(
        `${company.ats}/${company.token}: fetched ${outcome.fetched}, skipped ${outcome.skipped}, inserted ${outcome.inserted}, updated ${outcome.updated}`,
      );
    } else {
      summary.failed += 1;
      console.error(`${company.ats}/${company.token}: ${outcome.error}`);
    }
  }

  return summary;
}
