/**
 * Send the best locally-scored jobs to the model for a real judgement.
 *
 * Run:  ANTHROPIC_API_KEY=... DATABASE_URL=... npx tsx scripts/llm-score.ts [options]
 *
 *   --top N      how many jobs to score, by local score (default 100)
 *   --force      rescore jobs that already have a fit
 *   --dry-run    show what would be sent, and the token estimate, without calling
 *
 * This one costs money, so it prints the bill at the end and refuses to run on
 * more than it was asked for.
 */
import { pool } from "../src/db.js";
import {
  costOf,
  MODEL,
  readProfile,
  scoreWithLlm,
  type Usage,
} from "../src/scoring/llm.js";
import type { Job } from "../src/types.js";

const CONCURRENCY = 5;

type Row = {
  id: string;
  source: string;
  source_id: string;
  company: string;
  title: string;
  description: string;
  location: string | null;
  salary_text: string | null;
  url: string;
  remote: boolean;
  score: number | null;
};

function toJob(row: Row): Job {
  return {
    source: row.source,
    sourceId: row.source_id,
    url: row.url,
    title: row.title,
    company: row.company,
    description: row.description,
    location: row.location,
    remote: row.remote,
    salaryText: row.salary_text,
    postedAt: null,
    fetchedAt: new Date(),
    fingerprint: "",
    postingFingerprint: "",
    raw: null,
  };
}

/** Run tasks `limit` at a time, keeping the pool full rather than in lockstep batches. */
async function pooled<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const dryRun = argv.includes("--dry-run");
  const topIndex = argv.indexOf("--top");
  const top = topIndex === -1 ? 100 : Number(argv[topIndex + 1] ?? 100);

  if (!Number.isInteger(top) || top < 1) {
    throw new Error(`--top must be a positive integer, got ${argv[topIndex + 1]}`);
  }

  const profile = readProfile();

  const { rows } = await pool.query<Row>(
    `select id::text, source, source_id, company, title, description, location,
            salary_text, url, remote, score
       from jobs
      where score is not null
        ${force ? "" : "and fit is null"}
      order by score desc, id
      limit $1`,
    [top],
  );

  const alreadyScored = await pool.query<{ n: string }>(
    `select count(*)::text as n from jobs where fit is not null`,
  );

  console.log(`model      ${MODEL}`);
  console.log(`profile    ${profile.length} chars`);
  console.log(`to score   ${rows.length}${force ? " (--force: including already scored)" : ""}`);
  console.log(`already    ${alreadyScored.rows[0]?.n ?? 0} scored${force ? "" : " (skipped)"}`);

  if (rows.length === 0) {
    console.log("\nnothing to do");
    await pool.end();
    return;
  }

  if (dryRun) {
    const chars = rows.reduce((sum, row) => sum + row.description.length, 0) + profile.length * rows.length;
    console.log(`\n--dry-run: would send ~${Math.round(chars / 4).toLocaleString()} input tokens, nothing called`);
    for (const row of rows.slice(0, 5)) {
      console.log(`  ${String(row.score).padStart(4)}  ${row.company} — ${row.title}`);
    }
    await pool.end();
    return;
  }

  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  let done = 0;
  let failed = 0;
  let retried = 0;
  const started = Date.now();

  await pooled(rows, CONCURRENCY, async (row) => {
    try {
      const result = await scoreWithLlm(toJob(row), profile);

      usage = {
        inputTokens: usage.inputTokens + result.usage.inputTokens,
        outputTokens: usage.outputTokens + result.usage.outputTokens,
        cacheWriteTokens: usage.cacheWriteTokens + result.usage.cacheWriteTokens,
        cacheReadTokens: usage.cacheReadTokens + result.usage.cacheReadTokens,
      };
      if (result.retried) retried += 1;

      await pool.query(
        `update jobs
            set fit = $2, reasons = $3::jsonb, concerns = $4::jsonb, llm_scored_at = now()
          where id = $1`,
        [row.id, result.fit, JSON.stringify(result.reasons), JSON.stringify(result.concerns)],
      );

      done += 1;
      console.log(
        `  fit ${String(result.fit).padStart(3)} (local ${String(row.score).padStart(3)})  ${row.company} — ${row.title}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`  FAILED  ${row.company} — ${row.title}: ${err instanceof Error ? err.message : err}`);
    }
  });

  const elapsed = (Date.now() - started) / 1000;
  const cost = costOf(usage);

  console.log(
    [
      "",
      `scored     ${done}${failed ? `, failed ${failed}` : ""}${retried ? `, retried ${retried}` : ""} in ${elapsed.toFixed(0)}s`,
      `input      ${usage.inputTokens.toLocaleString()} tokens`,
      `output     ${usage.outputTokens.toLocaleString()} tokens`,
      `cache      ${usage.cacheWriteTokens.toLocaleString()} written, ${usage.cacheReadTokens.toLocaleString()} read`,
      `cost       $${cost.toFixed(4)}${done ? ` ($${(cost / done).toFixed(4)} per job)` : ""}`,
    ].join("\n"),
  );

  await pool.end();
}

await main();
