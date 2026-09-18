import { z } from "zod";
import { fetchJson } from "../http.js";
import { makeFingerprint, makePostingFingerprint, type Job } from "../types.js";

const SOURCE = "ashby";

/**
 * `includeCompensation=true` is the only way to get pay out of this API, and it
 * costs nothing extra: the board only fills `compensation` in for postings whose
 * company has turned on `shouldDisplayCompensationOnJobPostings`, so asking for
 * it never surfaces what an employer chose to keep back.
 */
export function ashbyUrl(slug: string, includeCompensation = true): string {
  const board = encodeURIComponent(slug);
  return `https://api.ashbyhq.com/posting-api/job-board/${board}${
    includeCompensation ? "?includeCompensation=true" : ""
  }`;
}

/** One line of a compensation tier: salary, equity, bonus, commission. */
const CompensationComponent = z.object({
  compensationType: z.string().nullish(),
  interval: z.string().nullish(),
  currencyCode: z.string().nullish(),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
});

const AshbyPosting = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  jobUrl: z.string().trim().min(1),
  // plain text already, and complete — no HTML to strip
  descriptionPlain: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z
    .array(z.object({ location: z.string().nullish() }).loose())
    .nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  employmentType: z.string().nullish(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  compensation: z
    .object({
      scrapeableCompensationSalarySummary: z.string().nullish(),
      compensationTierSummary: z.string().nullish(),
      summaryComponents: z.array(CompensationComponent).nullish(),
    })
    .nullish(),
});

type AshbyPosting = z.infer<typeof AshbyPosting>;

export const AshbyResponse = z.object({
  jobs: z.array(z.unknown()),
  apiVersion: z.string().nullish(),
});

const INTERVALS: Record<string, string> = {
  "1 YEAR": "per year",
  "1 MONTH": "per month",
  "2 WEEKS": "biweekly",
  "1 WEEK": "per week",
  "1 DAY": "per day",
  "1 HOUR": "per hour",
  NONE: "",
};

/**
 * Prefer the structured salary component so the text matches the other sources;
 * fall back to the board's own summary string when only that is filled in.
 */
function formatSalary(compensation: AshbyPosting["compensation"]): string | null {
  const salary = compensation?.summaryComponents?.find(
    (component) => component.compensationType === "Salary",
  );

  const min = typeof salary?.minValue === "number" && salary.minValue > 0 ? salary.minValue : null;
  const max = typeof salary?.maxValue === "number" && salary.maxValue > 0 ? salary.maxValue : null;

  if (min === null && max === null) {
    const summary =
      compensation?.scrapeableCompensationSalarySummary?.trim() ||
      compensation?.compensationTierSummary?.trim();
    return summary || null;
  }

  const amount = (n: number) => n.toLocaleString("en-US");
  const money =
    min !== null && max !== null
      ? min === max
        ? amount(min)
        : `${amount(min)} - ${amount(max)}`
      : min !== null
        ? `${amount(min)}+`
        : `up to ${amount(max as number)}`;

  const currency = salary?.currencyCode?.trim();
  const interval = salary?.interval ? (INTERVALS[salary.interval] ?? salary.interval) : "";

  return [currency, money, interval].filter(Boolean).join(" ");
}

function toLocation(row: AshbyPosting): string | null {
  const primary = row.location?.trim();
  if (primary) return primary;
  const secondary = row.secondaryLocations?.map((l) => l.location?.trim()).find(Boolean);
  return secondary ?? null;
}

function isRemote(row: AshbyPosting, location: string | null): boolean {
  // isRemote is null on roughly a tenth of postings, workplaceType with it
  if (typeof row.isRemote === "boolean") return row.isRemote;
  const workplace = row.workplaceType?.trim().toLowerCase();
  if (workplace) return workplace === "remote";
  return location ? /\bremote\b/i.test(location) : false;
}

function toJob(row: AshbyPosting, raw: unknown, company: string, fetchedAt: Date): Job {
  const location = toLocation(row);
  const postedAt = row.publishedAt ? new Date(row.publishedAt) : null;

  return {
    source: SOURCE,
    sourceId: row.id,
    url: row.jobUrl,
    title: row.title,
    company,
    description: (row.descriptionPlain ?? "").trim(),
    location,
    remote: isRemote(row, location),
    salaryText: formatSalary(row.compensation),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    fetchedAt,
    fingerprint: makeFingerprint(company, row.title),
    postingFingerprint: makePostingFingerprint(company, row.title, location),
    raw,
  };
}

/** "acme-corp" -> "Acme Corp", for boards where we have no better name. */
function nameFromSlug(slug: string): string {
  return slug
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
 * Like Lever, an Ashby board carries no company name, so the caller supplies it
 * and the slug is the fallback.
 */
export async function fetchAshbyWithStats(slug: string, companyName?: string): Promise<FetchResult> {
  const body = AshbyResponse.parse(await fetchJson(ashbyUrl(slug)));
  const fetchedAt = new Date();
  const company = companyName?.trim() || nameFromSlug(slug);

  const jobs: Job[] = [];
  let skipped = 0;

  for (const raw of body.jobs) {
    const parsed = AshbyPosting.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.warn(`${SOURCE}/${slug}: skipped a row — ${reason}`);
      continue;
    }
    // the board can carry unlisted postings; they are not public openings
    if (parsed.data.isListed === false) {
      skipped += 1;
      continue;
    }
    jobs.push(toJob(parsed.data, raw, company, fetchedAt));
  }

  if (skipped > 0) {
    console.warn(`${SOURCE}/${slug}: skipped ${skipped} of ${body.jobs.length} rows`);
  }

  return { jobs, fetched: body.jobs.length, skipped };
}

export async function fetchAshby(slug: string, companyName?: string): Promise<Job[]> {
  const { jobs } = await fetchAshbyWithStats(slug, companyName);
  return jobs;
}
