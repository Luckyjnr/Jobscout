import { createHash } from "node:crypto";

export type Job = {
  // where it came from
  source: string;          // "remotive", "weworkremotely"
  sourceId: string;        // the board's own id for this posting
  url: string;

  // the job
  title: string;
  company: string;
  description: string;     // plain text, HTML stripped
  location: string | null; // as the board states it
  remote: boolean;
  salaryText: string | null;  // raw text, we do not parse it yet

  // timing
  postedAt: Date | null;
  fetchedAt: Date;

  // identity across boards: the role, wherever it is listed
  fingerprint: string;
  // identity of this specific listing: the role in one place
  postingFingerprint: string;

  // keep the original
  raw: unknown;
};

// dropped from the end of a company name, repeatedly: "Acme Co, Ltd." -> "acme"
const COMPANY_SUFFIXES = new Set(["inc", "llc", "ltd", "gmbh", "co", "corp"]);

// dropped from anywhere in a title
const TITLE_NOISE = new Set([
  "senior",
  "sr",
  "junior",
  "jr",
  "staff",
  "lead",
  "principal",
  "i",
  "ii",
  "iii",
  "remote",
  "contract",
]);

// multi-word noise, removed before punctuation goes away and the
// hyphen in "full-time" turns into a word boundary
const TITLE_NOISE_PHRASES = [/\bfull[\s_-]?time\b/g, /\bpart[\s_-]?time\b/g];

// anything the board tacked on in brackets: "(Senior)", "[Remote]"
const BRACKETED = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;

// lowercase, fold accents, drop punctuation, collapse whitespace
function tokenize(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeCompany(company: string): string {
  const tokens = tokenize(company);
  while (tokens.length > 0 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(" ");
}

function normalizeTitle(title: string): string {
  let cleaned = title.toLowerCase().replace(BRACKETED, " ");
  for (const phrase of TITLE_NOISE_PHRASES) {
    cleaned = cleaned.replace(phrase, " ");
  }
  return tokenize(cleaned)
    .filter((token) => !TITLE_NOISE.has(token))
    .join(" ");
}

/**
 * A location as written by a board, reduced to something comparable.
 *
 * Segments are split on commas and slashes, deduplicated and sorted, so
 * "Remote, Bangalore" and "Bangalore, Remote" agree and "New York, New York"
 * collapses to one segment. Nothing can reconcile "NY" with "New York", so
 * this normalizes spelling, not geography.
 */
function normalizeLocation(location: string | null | undefined): string {
  if (!location) return "";
  const segments = location
    .toLowerCase()
    .replace(BRACKETED, " ") // "New York, NY (HQ)"
    .split(/[,/;|]+/)
    .map((segment) => tokenize(segment).join(" "))
    .filter(Boolean);
  return [...new Set(segments)].sort().join("|");
}

/**
 * Stable identity for a role across boards: the same role listed twice, with
 * different decoration, hashes to the same hex digest.
 *
 * Deliberately blind to location, so one role advertised in twelve cities is
 * one fingerprint. Use {@link makePostingFingerprint} to tell those apart.
 */
export function makeFingerprint(company: string, title: string): string {
  const key = `${normalizeCompany(company)}:${normalizeTitle(title)}`;
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Identity of a single listing: the same role in the same place, however many
 * boards carry it. Postings with no location share the empty segment, which is
 * the closest thing to "unspecified" we can compare.
 */
export function makePostingFingerprint(
  company: string,
  title: string,
  location: string | null | undefined,
): string {
  const key = `${normalizeCompany(company)}:${normalizeTitle(title)}:${normalizeLocation(location)}`;
  return createHash("sha256").update(key).digest("hex");
}
