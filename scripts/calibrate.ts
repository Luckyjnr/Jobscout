/**
 * Print the live score distribution against the presentation curve.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/calibrate.ts
 *
 * matchPercent maps a raw score to a percentage through anchors that were
 * chosen by looking at real scores, not by arithmetic on the rule weights.
 * When the rules change the distribution moves, and the anchors should be
 * re-checked against it; this is what to run.
 */
import { pool } from "../src/db.js";
import { matchBand, matchPercent } from "../src/scoring/present.js";

type Row = { score: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

async function main(): Promise<void> {
  const { rows } = await pool.query<Row>(
    `select score from jobs where score is not null and not closed order by score`,
  );
  const scores = rows.map((row) => row.score);

  if (scores.length === 0) {
    console.log("no scored jobs — run the crawler and scripts/score.ts first");
    await pool.end();
    return;
  }

  console.log(`${scores.length} scored, open jobs`);
  console.log(`range ${scores[0]} .. ${scores[scores.length - 1]}\n`);

  console.log("percentile   raw    pct   band");
  for (const p of [1, 5, 10, 25, 50, 75, 90, 95, 99]) {
    const raw = percentile(scores, p);
    const pct = matchPercent(raw);
    console.log(
      `  p${String(p).padStart(2)}      ${String(raw).padStart(5)}  ${String(pct).padStart(5)}   ${matchBand(pct)}`,
    );
  }

  // what the curve does to the corpus as a whole
  const bands = { strong: 0, good: 0, fair: 0, weak: 0 };
  for (const score of scores) bands[matchBand(matchPercent(score))] += 1;

  console.log("\nband spread");
  for (const [band, count] of Object.entries(bands)) {
    const share = ((count / scores.length) * 100).toFixed(1);
    const bar = "█".repeat(Math.round((count / scores.length) * 40));
    console.log(`  ${band.padEnd(7)} ${String(count).padStart(5)}  ${share.padStart(5)}%  ${bar}`);
  }

  // the property the curve exists to hold
  console.log("\nanchors");
  for (const raw of [-60, -20, 0, 30, 55, 90, 110, 130]) {
    console.log(`  raw ${String(raw).padStart(4)} -> ${String(matchPercent(raw)).padStart(3)}%`);
  }
  console.log(`\n  90+ raw reads as 90%+: ${matchPercent(90) >= 90 ? "yes" : "NO"}`);

  await pool.end();
}

await main();
