import { z } from "zod";
import { stripHtml } from "../html.js";
import { fetchJson } from "../http.js";
import { makeFingerprint, makePostingFingerprint, type Job } from "../types.js";

const SOURCE = "lever";

export function leverUrl(site: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

const LeverPosting = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1), // the job title
  hostedUrl: z.string().trim().min(1),
  descriptionPlain: z.string().nullish(),
  additionalPlain: z.string().nullish(),
  lists: z
    .array(z.object({ text: z.string().nullish(), content: z.string().nullish() }))
    .nullish(),
  createdAt: z.number().nullish(), // epoch milliseconds
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      commitment: z.string().nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
    })
    .nullish(),
  salaryRange: z
    .object({
      interval: z.string().nullish(),
      currency: z.string().nullish(),
      min: z.number().nullish(),
      max: z.number().nullish(),
    })
    .nullish(),
});

type LeverPosting = z.infer<typeof LeverPosting>;

const LeverResponse = z.array(z.unknown());

const INTERVALS: Record<string, string> = {
  "per-year-salary": "per year",
  "per-month-salary": "per month",
  "per-week-salary": "per week",
  "per-day-wage": "per day",
  "per-hour-wage": "per hour",
  "one-time-payment": "one time",
};

function formatSalary(range: LeverPosting["salaryRange"]): string | null {
  if (!range) return null;

  const min = typeof range.min === "number" && range.min > 0 ? range.min : null;
  const max = typeof range.max === "number" && range.max > 0 ? range.max : null;
  if (min === null && max === null) return null;

  const amount = (n: number) => n.toLocaleString("en-US");
  const money =
    min !== null && max !== null
      ? min === max
        ? amount(min)
        : `${amount(min)} - ${amount(max)}`
      : min !== null
        ? `${amount(min)}+`
        : `up to ${amount(max as number)}`;

  const currency = range.currency?.trim();
  const interval = range.interval ? (INTERVALS[range.interval] ?? range.interval) : null;

  return [currency, money, interval].filter(Boolean).join(" ");
}

/**
 * descriptionPlain is only the opening section — on Match Group's board it
 * averages 1,435 characters while the responsibilities (`lists`, as HTML) and
 * the closing `additionalPlain` carry another ~3,000. Losing the requirements
 * would gut the text the matcher reads, so the sections are joined back up.
 */
function buildDescription(row: LeverPosting): string {
  const parts: string[] = [];

  const intro = row.descriptionPlain?.trim();
  if (intro) parts.push(intro);

  for (const list of row.lists ?? []) {
    const heading = list.text?.trim();
    const body = list.content ? stripHtml(list.content) : "";
    if (!heading && !body) continue;
    parts.push([heading, body].filter(Boolean).join("\n"));
  }

  const closing = row.additionalPlain?.trim();
  if (closing) parts.push(closing);

  return parts.join("\n\n").trim();
}

function toJob(row: LeverPosting, raw: unknown, company: string, fetchedAt: Date): Job {
  const location = row.categories?.location?.trim() || row.categories?.allLocations?.[0]?.trim() || null;
  const workplace = row.workplaceType?.trim().toLowerCase();

  const postedAt =
    typeof row.createdAt === "number" && row.createdAt > 0 ? new Date(row.createdAt) : null;

  return {
    source: SOURCE,
    sourceId: row.id,
    url: row.hostedUrl,
    title: row.text,
    company,
    description: buildDescription(row),
    location,
    remote: workplace === "remote",
    salaryText: formatSalary(row.salaryRange),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    fetchedAt,
    fingerprint: makeFingerprint(company, row.text),
    postingFingerprint: makePostingFingerprint(company, row.text, location),
    raw,
  };
}

/** "acme-corp" -> "Acme Corp", for boards where we have no better name. */
function nameFromSite(site: string): string {
  return site
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type FetchResult = {
  jobs: Job[];
  fetched: number;
  skipped: number;
};

/**
 * Lever postings carry no company name, so it comes from `companyName` when the
 * caller knows it (the crawler passes the row from `companies`) and is otherwise
 * derived from the site slug.
 */
export async function fetchLeverWithStats(site: string, companyName?: string): Promise<FetchResult> {
  const body = LeverResponse.parse(await fetchJson(leverUrl(site)));
  const fetchedAt = new Date();
  const company = companyName?.trim() || nameFromSite(site);

  const jobs: Job[] = [];
  let skipped = 0;

  for (const raw of body) {
    const parsed = LeverPosting.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.warn(`${SOURCE}/${site}: skipped a row — ${reason}`);
      continue;
    }
    jobs.push(toJob(parsed.data, raw, company, fetchedAt));
  }

  if (skipped > 0) {
    console.warn(`${SOURCE}/${site}: skipped ${skipped} of ${body.length} rows`);
  }

  return { jobs, fetched: body.length, skipped };
}

export async function fetchLever(site: string, companyName?: string): Promise<Job[]> {
  const { jobs } = await fetchLeverWithStats(site, companyName);
  return jobs;
}
