import { z } from "zod";
import { stripHtml } from "../html.js";
import { fetchJson, HttpError } from "../http.js";
import { makeFingerprint, makePostingFingerprint, type Job } from "../types.js";

const SOURCE = "remoteok";
const ENDPOINT = "https://remoteok.com/api";

// Remote OK's terms ask that we identify ourselves (see USER_AGENT in http.ts),
// link back to the URL on their site (which we keep in Job.url) and name them as
// the source. Their robots.txt declares Crawl-delay: 1 — this endpoint is one
// request, so a run stays well inside it.

/**
 * A row as Remote OK actually serves it. Only the four fields we cannot build a
 * Job without are required; everything else the feed has dropped before.
 */
const RemoteOkRow = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  company: z.string().trim().min(1),
  position: z.string().trim().min(1),
  url: z.string().trim().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),
  // present on every row, but 0 stands for "unknown", not "unpaid"
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  epoch: z.number().nullish(),
  date: z.string().nullish(),
});

type RemoteOkRow = z.infer<typeof RemoteOkRow>;

const RemoteOkResponse = z.array(z.unknown());

function formatSalary(min: number | null | undefined, max: number | null | undefined): string | null {
  // 0 is how the feed spells "we don't know", so it is not a real bound
  const low = min && min > 0 ? min : null;
  const high = max && max > 0 ? max : null;
  // currency is not in the payload; Remote OK quotes USD
  const money = (n: number) => `$${n.toLocaleString("en-US")}`;

  if (low !== null && high !== null) return low === high ? money(low) : `${money(low)} - ${money(high)}`;
  if (low !== null) return `${money(low)}+`;
  if (high !== null) return `Up to ${money(high)}`;
  return null;
}

function toDate(row: RemoteOkRow): Date | null {
  if (typeof row.epoch === "number" && Number.isFinite(row.epoch) && row.epoch > 0) {
    const fromEpoch = new Date(row.epoch * 1000); // seconds, not milliseconds
    if (!Number.isNaN(fromEpoch.getTime())) return fromEpoch;
  }
  if (row.date) {
    const parsed = new Date(row.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function toJob(row: RemoteOkRow, raw: unknown, fetchedAt: Date): Job {
  const location = row.location?.trim() || null;
  return {
    source: SOURCE,
    sourceId: row.id,
    url: row.url,
    title: row.position,
    company: row.company,
    description: stripHtml(row.description ?? ""),
    location,
    remote: true, // the whole board is remote
    salaryText: formatSalary(row.salary_min, row.salary_max),
    postedAt: toDate(row),
    fetchedAt,
    fingerprint: makeFingerprint(row.company, row.position),
    postingFingerprint: makePostingFingerprint(row.company, row.position, location),
    raw,
  };
}

export type FetchResult = {
  jobs: Job[];
  /** rows the feed served, excluding the legal notice */
  fetched: number;
  /** rows that failed validation and were dropped */
  skipped: number;
};

/**
 * Fetch the board and report what was dropped, for callers that want to print
 * the tally. {@link fetchRemoteOk} is the plain version.
 */
export async function fetchRemoteOkWithStats(): Promise<FetchResult> {
  let body: unknown[];
  try {
    body = RemoteOkResponse.parse(await fetchJson(ENDPOINT));
  } catch (err) {
    throw err instanceof HttpError ? new Error(`${SOURCE}: ${err.message}`) : err;
  }
  const fetchedAt = new Date();

  // element 0 is Remote OK's legal notice, never a posting
  const [notice, ...rows] = body;
  if (!(notice && typeof notice === "object" && "legal" in notice)) {
    console.warn(`${SOURCE}: element 0 was not the usual legal notice — skipped it anyway`);
  }

  const jobs: Job[] = [];
  let skipped = 0;

  for (const raw of rows) {
    const parsed = RemoteOkRow.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.warn(`${SOURCE}: skipped a row — ${reason}`);
      continue;
    }
    jobs.push(toJob(parsed.data, raw, fetchedAt));
  }

  if (skipped > 0) {
    console.warn(`${SOURCE}: skipped ${skipped} of ${rows.length} rows`);
  }

  return { jobs, fetched: rows.length, skipped };
}

export async function fetchRemoteOk(): Promise<Job[]> {
  const { jobs } = await fetchRemoteOkWithStats();
  return jobs;
}
