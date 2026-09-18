import { z } from "zod";
import { decodeEntities, stripHtml } from "../html.js";
import { fetchJson } from "../http.js";
import { makeFingerprint, makePostingFingerprint, type Job } from "../types.js";

const SOURCE = "greenhouse";

export function greenhouseUrl(token: string, content = true): string {
  const board = encodeURIComponent(token);
  return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs${content ? "?content=true" : ""}`;
}

const GreenhouseJob = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string().trim().min(1),
  absolute_url: z.string().trim().min(1),
  content: z.string().nullish(),
  company_name: z.string().trim().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
});

type GreenhouseJob = z.infer<typeof GreenhouseJob>;

export const GreenhouseResponse = z.object({
  jobs: z.array(z.unknown()),
  meta: z.object({ total: z.number().nullish() }).nullish(),
});

/**
 * `content` arrives escaped: the JSON string holds "&lt;div&gt;", not "<div>".
 * One decode gives back real HTML whose *text* still holds entities (an
 * "&amp;nbsp;" in the payload is a "&nbsp;" in the HTML), so stripHtml's own
 * trailing decode is the second pass. Verified against gitlab's board: all 220
 * rows change on a second decode.
 */
function contentToText(content: string): string {
  return stripHtml(decodeEntities(content));
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toJob(row: GreenhouseJob, raw: unknown, token: string, fetchedAt: Date): Job {
  const location = row.location?.name?.trim() || null;
  const company = row.company_name?.trim() || token;

  return {
    source: SOURCE,
    sourceId: row.id,
    url: row.absolute_url,
    title: row.title,
    company,
    description: contentToText(row.content ?? ""),
    location,
    // no remote flag in the payload; the location string is all we have
    remote: location ? /\bremote\b/i.test(location) : false,
    // Greenhouse exposes no compensation on the public board
    salaryText: null,
    postedAt: toDate(row.first_published) ?? toDate(row.updated_at),
    fetchedAt,
    fingerprint: makeFingerprint(company, row.title),
    postingFingerprint: makePostingFingerprint(company, row.title, location),
    raw,
  };
}

export type FetchResult = {
  jobs: Job[];
  fetched: number;
  skipped: number;
};

export async function fetchGreenhouseWithStats(token: string): Promise<FetchResult> {
  const body = GreenhouseResponse.parse(await fetchJson(greenhouseUrl(token)));
  const fetchedAt = new Date();

  const jobs: Job[] = [];
  let skipped = 0;

  for (const raw of body.jobs) {
    const parsed = GreenhouseJob.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.warn(`${SOURCE}/${token}: skipped a row — ${reason}`);
      continue;
    }
    jobs.push(toJob(parsed.data, raw, token, fetchedAt));
  }

  if (skipped > 0) {
    console.warn(`${SOURCE}/${token}: skipped ${skipped} of ${body.jobs.length} rows`);
  }

  return { jobs, fetched: body.jobs.length, skipped };
}

export async function fetchGreenhouse(token: string): Promise<Job[]> {
  const { jobs } = await fetchGreenhouseWithStats(token);
  return jobs;
}
