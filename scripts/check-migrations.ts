/**
 * Prove the current schema upgrades every database it has ever produced.
 *
 * Run:  DATABASE_URL=postgres://.../any_db npx tsx scripts/check-migrations.ts
 *
 * The connection needs rights to create and drop databases; each check runs in
 * a throwaway database of its own and nothing touches the one named in the URL.
 *
 * `create table if not exists` is skipped whole when the table exists, so a
 * column added inside one never reaches a database that already had the table.
 * That is invisible on a fresh database and fatal on the hosted one: the crawl
 * failed with `column "closes_missing" does not exist`. So for every version
 * src/schema.sql has had in git, this:
 *
 *   1. builds a database from that version of the schema,
 *   2. inserts rows, since an alter that works on an empty table can still
 *      fail on a populated one,
 *   3. runs the current migrate exactly as CI does, in a child process,
 *   4. requires the resulting columns, constraints and indexes to match a
 *      database built fresh from the current schema, and the rows to survive.
 *
 * Checking only the first commit is not enough. `sources` did not exist then,
 * so migrate creates it whole and the missing-column bug never shows; it only
 * appears on a database built after `sources` was introduced and before
 * `closes_missing` was.
 */
import { execFileSync } from "node:child_process";
import pg from "pg";

const base = process.env["DATABASE_URL"];
if (!base) throw new Error("DATABASE_URL is not set");

const PREFIX = "jobscout_migcheck_";

function urlFor(database: string): string {
  const url = new URL(base!);
  url.pathname = `/${database}`;
  return url.toString();
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

async function withClient<T>(database: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: base });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function recreate(database: string): Promise<void> {
  await admin(`drop database if exists ${database} with (force)`);
  await admin(`create database ${database}`);
}

/** The current migrate, run the way the workflow runs it. */
function migrate(database: string): { ok: true } | { ok: false; error: string } {
  try {
    execFileSync("npx", ["tsx", "scripts/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: urlFor(database) },
      encoding: "utf8",
      stdio: "pipe",
    });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    const text = `${e.stderr ?? ""}${e.stdout ?? ""}` || e.message;
    const line = text.split("\n").find((l) => /error|does not exist/i.test(l)) ?? text.split("\n")[0];
    return { ok: false, error: (line ?? "").trim() };
  }
}

type Shape = { columns: string[]; constraints: string[]; indexes: string[] };

async function shape(database: string): Promise<Shape> {
  return withClient(database, async (client) => {
    const columns = await client.query<{ line: string }>(
      `select table_name || '.' || column_name || ' ' || data_type
              || case when is_nullable = 'NO' then ' not null' else '' end
              || coalesce(' default ' || column_default, '') as line
         from information_schema.columns
        where table_schema = 'public'
        order by 1`,
    );
    const constraints = await client.query<{ line: string }>(
      `select conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) as line
         from pg_constraint
        where connamespace = 'public'::regnamespace
        order by 1`,
    );
    const indexes = await client.query<{ line: string }>(
      `select indexdef as line from pg_indexes where schemaname = 'public' order by 1`,
    );
    return {
      columns: columns.rows.map((r) => r.line),
      constraints: constraints.rows.map((r) => r.line),
      indexes: indexes.rows.map((r) => r.line),
    };
  });
}

async function tables(client: pg.Client): Promise<Set<string>> {
  const { rows } = await client.query<{ t: string }>(
    `select table_name as t from information_schema.tables where table_schema = 'public'`,
  );
  return new Set(rows.map((r) => r.t));
}

/**
 * A few rows in every table that version had, using only columns that have
 * existed since the table was created — so the same inserts work against
 * every version, and every later column has to be back-filled by an alter.
 */
async function populate(client: pg.Client): Promise<Record<string, number>> {
  const present = await tables(client);

  await client.query(
    `insert into jobs (source, source_id, url, title, company, description, fingerprint, raw)
     select 'greenhouse', 'old-' || g, 'https://example.com/' || g, 'Backend Engineer ' || g,
            'Acme', 'Node and Postgres.', 'fp-' || g, '{}'::jsonb
       from generate_series(1, 3) g`,
  );
  await client.query(`insert into companies (name, ats, token) values ('Acme', 'greenhouse', 'acme')`);
  await client.query(
    `insert into decisions (job_id, decision) select id, 'interested' from jobs order by id limit 2`,
  );
  await client.query(`insert into runs (started_at) values (now() - interval '1 day')`);

  if (present.has("sources")) {
    await client.query(
      `insert into sources (name, kind, url) values ('oldfeed', 'rss', 'https://example.com/feed')`,
    );
  }
  if (present.has("scan_progress")) {
    await client.query(
      `insert into scan_progress (run_id, stage, status) select max(id), 'done', 'ok' from runs`,
    );
  }

  return counts(client);
}

async function counts(client: pg.Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of [...(await tables(client))].sort()) {
    const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from ${table}`);
    out[table] = Number(rows[0]!.n);
  }
  return out;
}

function diff(label: string, expected: string[], actual: string[]): string[] {
  const have = new Set(actual);
  const want = new Set(expected);
  return [
    ...expected.filter((line) => !have.has(line)).map((line) => `  missing ${label}: ${line}`),
    ...actual.filter((line) => !want.has(line)).map((line) => `  unexpected ${label}: ${line}`),
  ];
}

async function main(): Promise<void> {
  const versions = git("log", "--reverse", "--format=%h %s", "--", "src/schema.sql")
    .trim()
    .split("\n")
    .map((line) => {
      const [rev, ...subject] = line.split(" ");
      return { rev: rev!, subject: subject.join(" ") };
    });

  // what a brand-new database looks like under the current schema
  const reference = `${PREFIX}reference`;
  await recreate(reference);
  const fresh = migrate(reference);
  if (!fresh.ok) throw new Error(`current schema fails on an empty database: ${fresh.error}`);
  const expected = await shape(reference);
  console.log(
    `reference: ${expected.columns.length} columns, ${expected.constraints.length} constraints, ` +
      `${expected.indexes.length} indexes\n`,
  );

  let failures = 0;
  const made = [reference];

  for (const { rev, subject } of versions) {
    const database = `${PREFIX}${rev}`;
    made.push(database);
    await recreate(database);

    const old = git("show", `${rev}:src/schema.sql`);
    const before = await withClient(database, async (client) => {
      await client.query(old);
      return populate(client);
    });

    const result = migrate(database);
    const problems: string[] = [];

    if (!result.ok) {
      problems.push(`  migrate failed: ${result.error}`);
    } else {
      const actual = await shape(database);
      problems.push(
        ...diff("column", expected.columns, actual.columns),
        ...diff("constraint", expected.constraints, actual.constraints),
        ...diff("index", expected.indexes, actual.indexes),
      );

      // a second run must be a no-op, which is what every scheduled crawl does
      const again = migrate(database);
      if (!again.ok) problems.push(`  second migrate failed: ${again.error}`);

      const after = await withClient(database, counts);
      for (const [table, n] of Object.entries(before)) {
        if (after[table] !== n) problems.push(`  ${table}: ${n} rows before, ${after[table]} after`);
      }
    }

    const rows = Object.values(before).reduce((sum, n) => sum + n, 0);
    const status = problems.length === 0 ? "ok  " : "FAIL";
    console.log(`${status} ${rev}  ${rows} rows  ${subject.slice(0, 62)}`);
    for (const problem of problems) console.log(problem);
    failures += problems.length === 0 ? 0 : 1;
  }

  for (const database of made) await admin(`drop database if exists ${database} with (force)`);

  console.log(
    failures === 0
      ? `\nevery historical schema upgrades cleanly to the current one`
      : `\n${failures} of ${versions.length} historical schemas do not upgrade cleanly`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
