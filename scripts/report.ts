/**
 * What changed in the most recent crawl.
 *
 * Run:  DATABASE_URL=... npm run report [-- --markdown]
 *
 * The window is the latest row in `runs`: everything inserted since that run
 * started is what that run brought in. With --markdown the output is written
 * for a GitHub Actions job summary.
 */
import { pool } from "../src/db.js";

const GOOD_SCORE = 50;
const LIST_LIMIT = 15;

type Run = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  companies: number | null;
  ok: number | null;
  failed: number | null;
  inserted: number | null;
  updated: number | null;
};

type NewJob = {
  company: string;
  title: string;
  score: number | null;
  url: string;
  salary_text: string | null;
  location: string | null;
};

type Failure = {
  name: string;
  ats: string;
  token: string;
  last_error: string;
  last_ok_at: Date | null;
};

const markdown = process.argv.includes("--markdown");

function h(text: string): string {
  return markdown ? `## ${text}` : `\n${text}\n${"-".repeat(text.length)}`;
}

function link(title: string, url: string): string {
  return markdown ? `[${title}](${url})` : title;
}

const { rows: runs } = await pool.query<Run>(
  `select id::text, started_at, finished_at, companies, ok, failed, inserted, updated
     from runs order by id desc limit 1`,
);

const run = runs[0];
if (!run) {
  console.log("No crawl has been recorded yet — run `npm run crawl` first.");
  await pool.end();
  process.exit(0);
}

const since = run.started_at;

const [{ rows: newJobs }, { rows: failures }, { rows: totals }] = await Promise.all([
  pool.query<NewJob>(
    `select company, title, score, url, salary_text, location
       from jobs where created_at >= $1
      order by score desc nulls last, company
      limit 500`,
    [since],
  ),
  pool.query<Failure>(
    `select name, ats, token, last_error, last_ok_at
       from companies
      where active and last_error is not null
      order by name`,
  ),
  pool.query<{ jobs: string; companies: string }>(
    `select (select count(*) from jobs)::text as jobs,
            (select count(*) from companies where active)::text as companies`,
  ),
]);

const good = newJobs.filter((job) => (job.score ?? 0) > GOOD_SCORE);
const lines: string[] = [];

lines.push(
  markdown ? "# Crawl report" : "Crawl report",
  "",
  `Run ${run.id} started ${since.toISOString().replace("T", " ").slice(0, 19)}Z` +
    (run.finished_at ? "" : "  **(did not finish)**"),
  "",
  `- boards: ${run.ok ?? "?"} ok, ${run.failed ?? "?"} failed of ${run.companies ?? "?"}`,
  `- jobs: ${run.inserted ?? 0} new, ${run.updated ?? 0} refreshed`,
  `- corpus now: ${totals[0]?.jobs ?? "?"} jobs across ${totals[0]?.companies ?? "?"} active boards`,
  "",
);

lines.push(h(`New jobs scoring above ${GOOD_SCORE} (${good.length})`), "");
if (good.length === 0) {
  lines.push("_None this run._", "");
} else {
  for (const job of good.slice(0, LIST_LIMIT)) {
    const bits = [job.location, job.salary_text].filter(Boolean).join(" · ");
    lines.push(`- **${job.score}** ${link(job.title, job.url)} — ${job.company}${bits ? ` (${bits})` : ""}`);
  }
  if (good.length > LIST_LIMIT) lines.push(`- _…and ${good.length - LIST_LIMIT} more_`);
  lines.push("");
}

lines.push(h(`New jobs (${newJobs.length})`), "");
if (newJobs.length === 0) {
  lines.push("_Nothing new — every posting was already known._", "");
} else {
  const byCompany = new Map<string, number>();
  for (const job of newJobs) byCompany.set(job.company, (byCompany.get(job.company) ?? 0) + 1);
  const ranked = [...byCompany].sort((a, b) => b[1] - a[1]).slice(0, LIST_LIMIT);
  for (const [company, count] of ranked) lines.push(`- ${company}: ${count}`);
  if (byCompany.size > LIST_LIMIT) lines.push(`- _…and ${byCompany.size - LIST_LIMIT} more companies_`);
  lines.push("");
}

lines.push(h(`Boards failing (${failures.length})`), "");
if (failures.length === 0) {
  lines.push("_All active boards answered._", "");
} else {
  for (const failure of failures) {
    const lastOk = failure.last_ok_at ? failure.last_ok_at.toISOString().slice(0, 10) : "never";
    lines.push(`- \`${failure.ats}/${failure.token}\` (${failure.name}) — last ok ${lastOk} — ${failure.last_error}`);
  }
  lines.push("");
}

console.log(lines.join("\n"));
await pool.end();
