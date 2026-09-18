/**
 * Recompute both identities for rows already in the table.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/backfill-fingerprints.ts [--dry-run]
 *
 * posting_fingerprint arrived after the table did, so existing rows have none.
 * fingerprint is recomputed at the same time: it is cheap, and it corrects any
 * row written before a change to the normalizer.
 *
 * The hashes are built in TypeScript rather than SQL so there is exactly one
 * definition of what a fingerprint is — reimplementing the normalizer in
 * plpgsql would be a second one, free to drift.
 */
import { pool } from "../src/db.js";
import { makeFingerprint, makePostingFingerprint } from "../src/types.js";

const BATCH = 1000;

type Row = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  fingerprint: string;
  posting_fingerprint: string | null;
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const { rows } = await pool.query<Row>(
    `select id::text, company, title, location, fingerprint, posting_fingerprint from jobs order by id`,
  );
  console.log(`${rows.length} rows to check`);

  const updates: Array<[string, string, string]> = [];
  let missingPosting = 0;
  let staleFingerprint = 0;

  for (const row of rows) {
    const fingerprint = makeFingerprint(row.company, row.title);
    const postingFingerprint = makePostingFingerprint(row.company, row.title, row.location);

    if (row.posting_fingerprint === null) missingPosting += 1;
    if (row.fingerprint !== fingerprint) staleFingerprint += 1;

    if (row.fingerprint !== fingerprint || row.posting_fingerprint !== postingFingerprint) {
      updates.push([row.id, fingerprint, postingFingerprint]);
    }
  }

  console.log(`  ${missingPosting} without a posting_fingerprint`);
  console.log(`  ${staleFingerprint} whose fingerprint no longer matches the normalizer`);
  console.log(`  ${updates.length} rows to write`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    await pool.end();
    return;
  }

  // one statement per batch, joined against the values list
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const params: string[] = [];
    const tuples = batch.map(([id, fingerprint, postingFingerprint], row) => {
      params.push(id, fingerprint, postingFingerprint);
      const offset = row * 3;
      return `($${offset + 1}::bigint, $${offset + 2}::text, $${offset + 3}::text)`;
    });

    await pool.query(
      `update jobs
          set fingerprint = v.fingerprint,
              posting_fingerprint = v.posting_fingerprint
         from (values ${tuples.join(", ")}) as v(id, fingerprint, posting_fingerprint)
        where jobs.id = v.id`,
      params,
    );
  }

  const { rows: after } = await pool.query<{ remaining: string }>(
    `select count(*)::text as remaining from jobs where posting_fingerprint is null`,
  );
  console.log(`\nwrote ${updates.length} rows; ${after[0]?.remaining ?? "?"} still without a posting_fingerprint`);

  await pool.end();
}

await main();
