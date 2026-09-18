import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";
import type { Job } from "./types.js";

const { Pool } = pg;

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set (copy .env.example to .env and fill it in)");
}

export const pool = new Pool({ connectionString });

// the compiled module sits in dist/, where schema.sql was never copied,
// so fall back to the copy next to the source
const SCHEMA_CANDIDATES = [
  new URL("./schema.sql", import.meta.url),
  new URL("../src/schema.sql", import.meta.url),
];

function readSchema(): string {
  const tried: string[] = [];
  for (const candidate of SCHEMA_CANDIDATES) {
    const path = fileURLToPath(candidate);
    tried.push(path);
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`schema.sql not found, looked in:\n  ${tried.join("\n  ")}`);
}

export async function migrate(): Promise<void> {
  await pool.query(readSchema());
}

export type UpsertResult = {
  inserted: number;
  updated: number;
};

// every column we write, in the order the placeholders are built
const COLUMNS = [
  "source",
  "source_id",
  "url",
  "title",
  "company",
  "description",
  "location",
  "remote",
  "salary_text",
  "posted_at",
  "fetched_at",
  "fingerprint",
  "posting_fingerprint",
  "raw",
] as const;

// everything except the conflict key; id is never written, so it stays put
const MUTABLE = COLUMNS.filter((c) => c !== "source" && c !== "source_id");

// postgres caps a statement at 65535 bind parameters; 14 columns per row
// leaves room for ~4600, so chunk well under that
const MAX_ROWS_PER_STATEMENT = 1000;

function values(job: Job): unknown[] {
  return [
    job.source,
    job.sourceId,
    job.url,
    job.title,
    job.company,
    job.description,
    job.location,
    job.remote,
    job.salaryText,
    job.postedAt,
    job.fetchedAt,
    job.fingerprint,
    job.postingFingerprint,
    // jsonb: stringify ourselves so a raw string or null round-trips as json
    JSON.stringify(job.raw ?? null),
  ];
}

// a batch may carry the same posting twice (two pages of one feed overlapping);
// postgres refuses to update a row twice in one statement, so keep the last
function dedupe(jobs: Job[]): Job[] {
  const byKey = new Map<string, Job>();
  for (const job of jobs) {
    byKey.set(JSON.stringify([job.source, job.sourceId]), job);
  }
  return [...byKey.values()];
}

async function upsertChunk(chunk: Job[]): Promise<UpsertResult> {
  const params: unknown[] = [];
  const rows = chunk.map((job, row) => {
    params.push(...values(job));
    const offset = row * COLUMNS.length;
    const placeholders = COLUMNS.map((_, col) => `$${offset + col + 1}`);
    return `(${placeholders.join(", ")})`;
  });

  const sql = `
    insert into jobs (${COLUMNS.join(", ")})
    values ${rows.join(", ")}
    on conflict (source, source_id) do update set
      ${MUTABLE.map((c) => `${c} = excluded.${c}`).join(",\n      ")}
    returning (xmax = 0) as inserted
  `;

  const result = await pool.query<{ inserted: boolean }>(sql, params);
  const inserted = result.rows.filter((r) => r.inserted).length;
  return { inserted, updated: result.rows.length - inserted };
}

/**
 * Insert jobs, refreshing the mutable columns of any posting we already hold.
 * The row's id survives an update, so anything referencing it stays valid.
 */
export async function upsertJobs(jobs: Job[]): Promise<UpsertResult> {
  const pending = dedupe(jobs);
  const total: UpsertResult = { inserted: 0, updated: 0 };

  for (let i = 0; i < pending.length; i += MAX_ROWS_PER_STATEMENT) {
    const chunk = pending.slice(i, i + MAX_ROWS_PER_STATEMENT);
    const result = await upsertChunk(chunk);
    total.inserted += result.inserted;
    total.updated += result.updated;
  }

  return total;
}
