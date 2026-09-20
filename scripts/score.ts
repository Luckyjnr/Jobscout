/**
 * Score every job in the table and store the result.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/score.ts [--dry-run] [--top N]
 *
 * Scoring is pure and cheap, so every row is rescored on every run: the rules
 * change more often than the jobs do, and a stale score is worse than no score.
 */
import { pool } from "../src/db.js";
import { scoreLocal, type Signal } from "../src/scoring/local.js";
import type { Job } from "../src/types.js";

const BATCH = 500;

type Row = {
  id: string;
  source: string;
  company: string;
  title: string;
  description: string;
  location: string | null;
  salary_text: string | null;
  url: string;
  posted_at: Date | null;
};

/** The scorer reads five fields; the rest are filled to satisfy the type. */
function toJob(row: Row): Job {
  return {
    source: row.source,
    sourceId: row.id,
    url: row.url,
    title: row.title,
    company: row.company,
    description: row.description,
    location: row.location,
    remote: false,
    salaryText: row.salary_text,
    // the recency signal needs this; it was null here until that rule existed
    postedAt: row.posted_at,
    fetchedAt: new Date(),
    fingerprint: "",
    postingFingerprint: "",
    raw: null,
  };
}

function formatSignals(signals: Signal[]): string {
  return signals
    .filter((signal) => signal.matched)
    .map((signal) => {
      const sign = signal.weight >= 0 ? "+" : "";
      const evidence = signal.evidence ? ` (${signal.evidence})` : "";
      return `${sign}${signal.weight} ${signal.name}${evidence}`;
    })
    .join(", ");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const topIndex = process.argv.indexOf("--top");
  const top = topIndex === -1 ? 25 : Number(process.argv[topIndex + 1] ?? 25);

  const { rows } = await pool.query<Row>(
    `select id::text, source, company, title, description, location, salary_text, url, posted_at
       from jobs order by id`,
  );
  console.log(`scoring ${rows.length} jobs`);

  const scored = rows.map((row) => ({ row, score: scoreLocal(toJob(row)) }));

  if (!dryRun) {
    for (let i = 0; i < scored.length; i += BATCH) {
      const batch = scored.slice(i, i + BATCH);
      const params: unknown[] = [];
      const tuples = batch.map(({ row, score }, index) => {
        params.push(row.id, score.total, JSON.stringify(score.signals));
        const offset = index * 3;
        return `($${offset + 1}::bigint, $${offset + 2}::integer, $${offset + 3}::jsonb)`;
      });

      await pool.query(
        `update jobs
            set score = v.score,
                score_signals = v.signals,
                scored_at = now()
           from (values ${tuples.join(", ")}) as v(id, score, signals)
          where jobs.id = v.id`,
        params,
      );
    }
  }

  const ranked = [...scored].sort(
    (a, b) => b.score.total - a.score.total || a.row.company.localeCompare(b.row.company),
  );

  console.log(`\ntop ${top}:`);
  for (const [index, { row, score }] of ranked.slice(0, top).entries()) {
    console.log(
      `\n${String(index + 1).padStart(2)}. ${score.total.toString().padStart(4)}  ${row.company} — ${row.title}`,
    );
    console.log(`     ${row.source}${row.location ? ` · ${row.location}` : ""} · ${row.url}`);
    console.log(`     ${formatSignals(score.signals)}`);
  }

  const totals = ranked.map((s) => s.score.total);
  const positive = totals.filter((t) => t > 0).length;
  console.log(
    `\n${rows.length} scored · ${positive} above zero · median ${totals[Math.floor(totals.length / 2)] ?? 0} · range ${Math.min(...totals)}..${Math.max(...totals)}`,
  );
  if (dryRun) console.log("--dry-run: nothing written");

  await pool.end();
}

await main();
