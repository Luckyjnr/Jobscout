/**
 * Turning a score into something a person can read.
 *
 * `scoreLocal` produces a number and a list of signals, which is the right
 * shape for ranking and the wrong shape for a job page: nobody wants to be
 * told a role scored 83, or that "backend/full-stack title" fired with
 * evidence "backend". This module is the presentation layer over that — a
 * percentage, a band, skill chips, reasons, gaps and a summary.
 *
 * Nothing here calls a model. Every string is assembled from a template and
 * the evidence the scorer already recorded, so the same job always reads the
 * same way and a wrong line can be traced to the rule that caused it.
 *
 * Where the LLM has scored a job, its own fit, reasons and concerns are
 * better than anything derivable here and are used instead. This is the
 * fallback, not a replacement, and `analysisSource` says which you are
 * looking at.
 */
import type { Signal } from "./local.js";

/**
 * The minimum a job needs to carry to be presentable. Deliberately structural
 * rather than the full `Job`: the web app reads rows out of Postgres that are
 * not `Job`s, and this is everything either side actually has.
 */
export type Presentable = {
  score: number | null;
  /** as stored in jobs.score_signals; may be only the matched ones */
  signals: Signal[];
  remote?: boolean | null;
  /** the LLM's verdict, when it has run */
  fit?: number | null;
  reasons?: string[] | null;
  concerns?: string[] | null;
};

export type MatchBand = "strong" | "good" | "fair" | "weak";

// ------------------------------------------------------------------ percent

/**
 * The raw score is an open-ended sum of rule weights, so its useful range is
 * a fact about the corpus rather than about the arithmetic. Measured over
 * 2,520 real postings (four Nigerian feeds, RemoteOK and ten ATS boards) on
 * 2026-09-20: range -100..113, median 0, p75 15, p95 25, p99 50. The mass
 * sits in two lumps — around -50, where the "not engineering" penalty lands,
 * and around 10, where a job scores nothing but its own freshness.
 *
 * A straight linear map over that range puts a 90 at 79%, which understates
 * it: a 90 was ClickUp's Staff Backend Engineer, and it should read strong.
 * So the curve is piecewise linear through anchors instead — anchors, not an
 * exponent, because a reader can check them, and 90 raw is 90% by
 * construction rather than by coincidence.
 *
 * Against that corpus these anchors put the top posting (113, a full-stack
 * Node role) at 96%, the 60-78 band of real backend roles at 73-83%, and
 * everything the queue floor already hides below 43%.
 *
 * See scripts/calibrate.ts, which prints the live distribution against these.
 */
const CURVE: Array<[raw: number, pct: number]> = [
  [-60, 0],
  [0, 30],
  [30, 50],
  [55, 70],
  [90, 90],
  [130, 100],
];

/** Normalise a raw score to 0-100, clamping outside the curve's range. */
export function matchPercent(score: number | null | undefined): number {
  if (score === null || score === undefined || Number.isNaN(score)) return 0;

  const first = CURVE[0]!;
  const last = CURVE[CURVE.length - 1]!;
  if (score <= first[0]) return first[1];
  if (score >= last[0]) return last[1];

  for (let i = 0; i < CURVE.length - 1; i += 1) {
    const [rawLow, pctLow] = CURVE[i]!;
    const [rawHigh, pctHigh] = CURVE[i + 1]!;
    if (score <= rawHigh) {
      const t = (score - rawLow) / (rawHigh - rawLow);
      return Math.round(pctLow + t * (pctHigh - pctLow));
    }
  }
  return last[1];
}

export function matchBand(pct: number): MatchBand {
  if (pct >= 85) return "strong";
  if (pct >= 70) return "good";
  if (pct >= 50) return "fair";
  return "weak";
}

export const BAND_LABELS: Record<MatchBand, string> = {
  strong: "Strong match",
  good: "Good match",
  fair: "Fair match",
  weak: "Weak match",
};

/**
 * Which analysis a job page is showing. The LLM's is preferred wherever it
 * exists; the page says so rather than passing derived text off as live.
 */
export function analysisSource(job: Presentable): "llm" | "derived" {
  return job.fit === null || job.fit === undefined ? "derived" : "llm";
}

/** The headline percentage: the LLM's fit where it ran, else the curve. */
export function matchScore(job: Presentable): number {
  if (job.fit !== null && job.fit !== undefined) {
    return Math.max(0, Math.min(100, Math.round(job.fit)));
  }
  return matchPercent(job.score);
}

// ------------------------------------------------------------------- chips

/**
 * Evidence arrives as the literal text that matched — "node", "postgres",
 * "payments + fintech + ledgers" — sometimes with a note the scorer appended.
 * These strip back to the terms and give each one the spelling a person would
 * write. Anything not listed is title-cased and shown as found, so a new rule
 * produces a slightly plain chip rather than no chip at all.
 */
const SKILL_NAMES: Record<string, string> = {
  node: "Node.js",
  "node.js": "Node.js",
  typescript: "TypeScript",
  nestjs: "NestJS",
  "nest.js": "NestJS",
  python: "Python",
  rust: "Rust",
  go: "Go",
  golang: "Go",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  payment: "Payments",
  payments: "Payments",
  fintech: "Fintech",
  ledger: "Ledgers",
  ledgers: "Ledgers",
  escrow: "Escrow",
  stripe: "Stripe",
  billing: "Billing",
  sdk: "SDKs",
  sdks: "SDKs",
  devtool: "Developer Tools",
  devtools: "Developer Tools",
  "developer tool": "Developer Tools",
  "developer tools": "Developer Tools",
  "developer tooling": "Developer Tools",
  "developer platform": "Developer Platform",
  "api platform": "API Platform",
  backend: "Backend",
  "back end": "Backend",
  "back-end": "Backend",
  fullstack: "Full-Stack",
  "full stack": "Full-Stack",
  "full-stack": "Full-Stack",
  globally: "Global",
  "hiring anywhere": "Global",
  "anywhere in the world": "Global",
  "work from anywhere": "Global",
  eor: "Global",
  "employer of record": "Global",
};

/** Signals whose evidence is a skill. Salary and recency are facts, not skills. */
const SKILL_SIGNALS = new Set([
  "stack in title",
  "stack in description",
  "postgres",
  "payments domain",
  "devtools domain",
  "backend/full-stack title",
  "hires globally",
]);

/**
 * The positive signals a job is measured against, for "N of M key skills".
 * A constant rather than a count of the array, because a stored signal list
 * is often filtered down to the matched ones and would make M equal N.
 */
const KEY_SIGNALS = [...SKILL_SIGNALS];

/** Evidence text back to the bare terms that matched. */
function terms(evidence: string | undefined): string[] {
  if (!evidence) return [];
  return evidence
    // the scorer appends " — no engineering signal" / " — but reads as engineering"
    .split("—")[0]!
    // and " (in lead)" / " (3d)"
    .replace(/\([^)]*\)/g, "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function titleCase(term: string): string {
  return term.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function skillName(term: string): string {
  return SKILL_NAMES[term] ?? titleCase(term);
}

const MAX_CHIPS = 6;

/**
 * The skills this posting evidences, most heavily weighted first, deduped.
 * "Remote" comes from the posting's own flag rather than a rule, because
 * that is where the fact lives.
 */
export function skillChips(job: Presentable): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();

  const push = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    chips.push(name);
  };

  const matched = job.signals
    .filter((signal) => signal.matched && signal.weight > 0 && SKILL_SIGNALS.has(signal.name))
    .sort((a, b) => b.weight - a.weight);

  for (const signal of matched) {
    for (const term of terms(signal.evidence)) push(skillName(term));
  }

  if (job.remote) push("Remote");

  return chips.slice(0, MAX_CHIPS);
}

export function skillsMatchedCount(job: Presentable): { matched: number; total: number } {
  const hit = new Set(
    job.signals.filter((s) => s.matched && s.weight > 0).map((s) => s.name),
  );
  return {
    matched: KEY_SIGNALS.filter((name) => hit.has(name)).length,
    total: KEY_SIGNALS.length,
  };
}

// --------------------------------------------------------- reasons and gaps

/** A list of skill names read as prose: "Node.js, PostgreSQL and Go". */
function sentenceList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function reasonFor(signal: Signal): string | null {
  const found = terms(signal.evidence).map(skillName);
  const list = sentenceList(found);

  switch (signal.name) {
    case "stack in title":
      return list ? `${list} is in the job title.` : null;
    case "stack in description":
      return list ? `${list} is named in the description.` : null;
    case "postgres":
      return "Runs on PostgreSQL.";
    case "payments domain":
      return list ? `Works in ${sentenceList(found.map((f) => f.toLowerCase()))}.` : null;
    case "devtools domain":
      return "Builds developer tooling.";
    case "backend/full-stack title":
      return list ? `Titled as a ${list.toLowerCase()} role.` : null;
    case "hires globally":
      return "Hires globally.";
    case "salary published":
      return signal.evidence ? `Pay is published: ${signal.evidence}.` : "Pay is published.";
    case "recency":
      if (signal.weight >= 15) return "Posted within the last week.";
      if (signal.weight > 0) return "Posted within the last month.";
      return null;
    default:
      return null;
  }
}

function gapFor(signal: Signal): string | null {
  const found = terms(signal.evidence).map(skillName);
  const list = sentenceList(found);

  switch (signal.name) {
    case "not engineering":
      // the scorer softens this one when the title also says engineer
      if (signal.weight > -60) {
        return list ? `Title mentions ${list.toLowerCase()}, though it reads as engineering.` : null;
      }
      return list ? `Reads as a ${list.toLowerCase()} role rather than engineering.` : null;
    case "other primary stack":
      return list ? `Primary stack is ${list}, not yours.` : null;
    case "residency/clearance required":
      return "Asks for work authorisation or residency.";
    case "junior/intern/graduate title":
      return list ? `Pitched at ${list.toLowerCase()} level.` : null;
    case "recency":
      if (signal.weight <= -40) return "Posted over a year ago.";
      if (signal.weight < 0) return "Posted over six months ago.";
      return null;
    default:
      return null;
  }
}

/** Why this matches. The LLM's own reasons win where it has run. */
export function matchReasons(job: Presentable): string[] {
  if (job.reasons && job.reasons.length > 0) return job.reasons;

  return job.signals
    .filter((signal) => signal.matched && signal.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map(reasonFor)
    .filter((line): line is string => line !== null);
}

/** What counts against it. The LLM's own concerns win where it has run. */
export function matchGaps(job: Presentable): string[] {
  if (job.concerns && job.concerns.length > 0) return job.concerns;

  return job.signals
    .filter((signal) => signal.matched && signal.weight < 0)
    .sort((a, b) => a.weight - b.weight)
    .map(gapFor)
    .filter((line): line is string => line !== null);
}

// ----------------------------------------------------------------- summary

/**
 * Two sentences: what carries it, and what to watch. Built from the three
 * strongest signals by absolute weight, so the summary agrees with the score
 * rather than restating the whole list.
 */
export function matchSummary(job: Presentable): string {
  const pct = matchScore(job);
  const band = matchBand(pct);

  const strongest = [...job.signals]
    .filter((signal) => signal.matched)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3);

  const carries = strongest
    .filter((signal) => signal.weight > 0 && SKILL_SIGNALS.has(signal.name))
    .flatMap((signal) => terms(signal.evidence).map(skillName));

  const distinct = [...new Set(carries)];

  // "carried by" is right for a job the signals lift and wrong for one they
  // barely touch, so the verb follows the band rather than the other way round
  const lifted = band === "strong" || band === "good";
  const opening =
    distinct.length > 0
      ? lifted
        ? `${BAND_LABELS[band]} at ${pct}%, carried by ${sentenceList(distinct.slice(0, 3))}.`
        : `${BAND_LABELS[band]} at ${pct}%, with ${sentenceList(distinct.slice(0, 3))} in its favour.`
      : `${BAND_LABELS[band]} at ${pct}%, with little in the posting that matches your profile.`;

  const gaps = matchGaps(job);
  const closing =
    gaps.length === 0
      ? "Nothing in the posting counts against it."
      : gaps.length === 1
        ? `The one thing to weigh: ${lowerFirst(gaps[0]!)}`
        : `Worth weighing: ${lowerFirst(gaps[0]!)}`;

  return `${opening} ${closing}`;
}

function lowerFirst(line: string): string {
  // acronyms and proper nouns keep their capital
  if (/^[A-Z]{2,}/.test(line)) return line;
  return line.charAt(0).toLowerCase() + line.slice(1);
}

// ------------------------------------------------------------- job facts

/**
 * Seniority levels, most specific first so "Senior Staff Engineer" reads as
 * Staff rather than Senior.
 */
const SENIORITY: Array<[RegExp, string]> = [
  [/\bprincipal\b/i, "Principal"],
  [/\bdistinguished\b/i, "Distinguished"],
  [/\bstaff\b/i, "Staff"],
  [/\b(lead|leader)\b/i, "Lead"],
  [/\b(head of|director of engineering)\b/i, "Head of"],
  [/\b(sr\.?|senior)\b/i, "Senior"],
  [/\b(mid[\s-]level|intermediate)\b/i, "Mid-level"],
  [/\b(jr\.?|junior)\b/i, "Junior"],
  [/\b(graduate|new grad|entry[\s-]level)\b/i, "Entry-level"],
  [/\bintern(ship)?\b/i, "Intern"],
];

/**
 * The seniority a title states. Reading the title is not the same as guessing:
 * a title that says nothing returns null and the chip is left off, rather than
 * a "Mid-level" appearing that the posting never claimed.
 */
export function seniorityFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  for (const [pattern, label] of SENIORITY) {
    if (pattern.test(title)) return label;
  }
  return null;
}
