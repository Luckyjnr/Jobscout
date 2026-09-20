/**
 * Crawl every active company board and record the run.
 *
 * Run:  DATABASE_URL=... npm run crawl [-- --max-failure-rate 0.2]
 *
 * Exits non-zero when too large a share of boards failed. One dead board is
 * ordinary — a company closed its account, a token changed. Half of them
 * failing means something is wrong at our end, and a scheduled job that
 * reports success while collecting nothing is worse than one that fails.
 */
import { crawl } from "../src/crawl.js";
import { pool } from "../src/db.js";

const DEFAULT_MAX_FAILURE_RATE = 0.2;

function parseRate(): number {
  const index = process.argv.indexOf("--max-failure-rate");
  if (index === -1) return DEFAULT_MAX_FAILURE_RATE;

  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`--max-failure-rate must be between 0 and 1, got ${process.argv[index + 1]}`);
  }
  return value;
}

const maxFailureRate = parseRate();

const { rows } = await pool.query<{ id: string }>(
  `insert into runs (started_at) values (now()) returning id::text`,
);
const runId = rows[0]!.id;

let failed = true;
try {
  const summary = await crawl();

  await pool.query(
    `update runs
        set finished_at = now(), companies = $2, ok = $3, failed = $4,
            fetched = $5, skipped = $6, inserted = $7, updated = $8
      where id = $1`,
    [
      runId,
      summary.companies,
      summary.ok,
      summary.failed,
      summary.fetched,
      summary.skipped,
      summary.inserted,
      summary.updated,
    ],
  );

  const rate = summary.companies === 0 ? 0 : summary.failed / summary.companies;
  console.log(
    `\n${summary.ok}/${summary.companies} targets ok, ${summary.inserted} new, ${summary.updated} refreshed` +
      (summary.waiting > 0 ? `, ${summary.waiting} waiting on their poll interval` : ""),
  );

  if (rate > maxFailureRate) {
    console.error(
      `\nFAIL: ${summary.failed} of ${summary.companies} targets failed ` +
        `(${(rate * 100).toFixed(0)}%, limit ${(maxFailureRate * 100).toFixed(0)}%)`,
    );
    for (const outcome of summary.outcomes.filter((o) => !o.ok)) {
      console.error(`  ${outcome.label}: ${outcome.error}`);
    }
    process.exitCode = 1;
  }
  failed = false;
} finally {
  if (failed) {
    // leave finished_at null so the report can see the run died
    await pool.query(`update runs set finished_at = now(), failed = -1 where id = $1`, [runId]);
  }
  await pool.end();
}
