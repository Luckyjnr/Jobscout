import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { stripHtml } from "../html.js";
import { fetchJson, fetchText } from "../http.js";
import { makeFingerprint, makePostingFingerprint, type Job } from "../types.js";

/**
 * A generic adapter for job feeds. Four of our feeds carry the same handful of
 * facts under different names — MyJobMag calls the employer `company`, Jobicy
 * calls it `companyName`, and Jobzilla does not name it at all — so the
 * difference between them is a field map, not four adapters.
 */
export type FeedMapping = {
  /** stored in Job.source */
  source: string;
  url: string;
  /** RSS/Atom XML, or a JSON document */
  kind: "rss" | "json";
  /** for JSON feeds: dotted path to the array of items, e.g. "jobs" */
  itemsPath?: string;
  /** minutes the feed asks to be left alone between polls */
  minIntervalMinutes: number;
  attribution?: Attribution;
  fields: FieldMap;
  /** feed-wide default when no field carries it */
  remote?: boolean;
};

export type Attribution = {
  /** the feed's terms require visible credit wherever its jobs are shown */
  required: boolean;
  text: string;
  url: string;
};

/**
 * Each entry names the field(s) to read, in order of preference. The first one
 * present and non-empty wins, so a feed can spell a fact two ways.
 */
export type FieldMap = {
  sourceId: string[];
  title: string[];
  url: string[];
  company?: string[];
  location?: string[];
  description?: string[];
  /** appended after description when a feed splits the text across fields */
  descriptionExtra?: string[];
  postedAt?: string[];
  salary?: string[];
  remote?: string[];
  /** extra fields to keep verbatim in raw, beyond the whole item */
  employmentType?: string[];
  /** when the employer is only recoverable from the title, e.g. "Analyst at Acme" */
  companyFromTitle?: boolean;
  /** description arrives as HTML and needs stripping */
  descriptionIsHtml?: boolean;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
  // every element as text unless it has children; keeps <salary>0</salary> a string
  parseTagValue: false,
  parseAttributeValue: false,
  cdataPropName: "__cdata",
});

/** fast-xml-parser gives a bare value, an object with __cdata, or an array. */
function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = scalar(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("__cdata" in record) return scalar(record["__cdata"]);
    if ("#text" in record) return scalar(record["#text"]);
    // <link href="..."/> in Atom
    if ("@href" in record) return scalar(record["@href"]);
  }
  return null;
}

function pick(item: Record<string, unknown>, names: string[] | undefined): string | null {
  if (!names) return null;
  for (const name of names) {
    const found = scalar(item[name]);
    if (found) return found;
  }
  return null;
}

function at(root: unknown, path: string | undefined): unknown {
  if (!path) return root;
  let cursor: unknown = root;
  for (const part of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/** RSS puts <item> under channel; Atom puts <entry> at the root. */
function itemsFromXml(document: Record<string, unknown>): Record<string, unknown>[] {
  const rss = at(document, "rss.channel.item") ?? at(document, "channel.item");
  const atom = at(document, "feed.entry");
  const found = rss ?? atom;
  if (!found) return [];
  const list = Array.isArray(found) ? found : [found];
  return list.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

const JsonItems = z.array(z.unknown());

/**
 * "Investment Analyst at Rising Tide Africa" -> title and company.
 * Only used for feeds that carry no employer field at all; the last " at " is
 * the split point because job titles contain the word more often than
 * company names do ("Data Analyst at Acme" vs "Head of Growth at X at Y").
 */
export function splitTitleAtCompany(raw: string): { title: string; company: string | null } {
  const match = /^(.*?)\s+at\s+(.+)$/i.exec(raw.trim());
  if (!match?.[1] || !match[2]) return { title: raw.trim(), company: null };

  const title = match[1].trim();
  // strip a trailing "(3 Openings)" style count from the employer
  const company = match[2].replace(/\s*\((?:\d+\s+)?(?:opening|position|slot|role)s?\)\s*$/i, "").trim();
  return title && company ? { title, company } : { title: raw.trim(), company: null };
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  // epoch seconds or ms, as some feeds use
  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return new Date(Number(value));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function looksRemote(text: string | null): boolean {
  return !!text && /\bremote\b|\banywhere\b|\bworldwide\b/i.test(text);
}

export type FetchResult = {
  jobs: Job[];
  fetched: number;
  skipped: number;
};

function toJob(
  item: Record<string, unknown>,
  mapping: FeedMapping,
  fetchedAt: Date,
): Job | null {
  const rawTitle = pick(item, mapping.fields.title);
  const url = pick(item, mapping.fields.url);
  if (!rawTitle || !url) return null;

  let title = rawTitle;
  let company = pick(item, mapping.fields.company);

  if (!company && mapping.fields.companyFromTitle) {
    const split = splitTitleAtCompany(rawTitle);
    title = split.title;
    company = split.company;
  }
  // a posting with no employer is still a posting; name it for the board
  if (!company) company = mapping.source;

  const sourceId = pick(item, mapping.fields.sourceId) ?? url;
  const location = pick(item, mapping.fields.location);
  const parts = [pick(item, mapping.fields.description), pick(item, mapping.fields.descriptionExtra)]
    .filter((part): part is string => !!part)
    .map((part) => (mapping.fields.descriptionIsHtml ? stripHtml(part) : part.trim()));
  // de-duplicate: some feeds repeat the blurb in both fields
  const description = [...new Set(parts)].join("\n\n").trim();

  const remoteField = pick(item, mapping.fields.remote);
  const remote =
    remoteField !== null
      ? looksRemote(remoteField) || remoteField.toLowerCase() === "true"
      : (mapping.remote ?? (looksRemote(location) || looksRemote(title)));

  return {
    source: mapping.source,
    sourceId,
    url,
    title,
    company,
    description,
    location: location ?? null,
    remote,
    salaryText: pick(item, mapping.fields.salary),
    postedAt: toDate(pick(item, mapping.fields.postedAt)),
    fetchedAt,
    fingerprint: makeFingerprint(company, title),
    postingFingerprint: makePostingFingerprint(company, title, location),
    raw: item,
  };
}

export async function fetchFeedWithStats(mapping: FeedMapping): Promise<FetchResult> {
  let items: Record<string, unknown>[];

  if (mapping.kind === "json") {
    const body = await fetchJson(mapping.url);
    const list = JsonItems.parse(at(body, mapping.itemsPath) ?? []);
    items = list.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  } else {
    const xml = await fetchText(mapping.url);
    items = itemsFromXml(parser.parse(xml) as Record<string, unknown>);
  }

  const fetchedAt = new Date();
  const jobs: Job[] = [];
  let skipped = 0;

  for (const item of items) {
    const job = toJob(item, mapping, fetchedAt);
    if (!job) {
      skipped += 1;
      continue;
    }
    jobs.push(job);
  }

  if (skipped > 0) {
    console.warn(`${mapping.source}: skipped ${skipped} of ${items.length} items with no title or link`);
  }

  return { jobs, fetched: items.length, skipped };
}

export async function fetchFeed(mapping: FeedMapping): Promise<Job[]> {
  const { jobs } = await fetchFeedWithStats(mapping);
  return jobs;
}
