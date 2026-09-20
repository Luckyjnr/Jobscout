import type { Row } from "./db";

export type Salary = "any" | "yes" | "no";
export type Posted = "any" | "24h" | "week" | "month";

export type Filters = {
  /** free-text match over location strings */
  q: string;
  chips: string[];
  companies: string[];
  sources: string[];
  scoreMin: number;
  scoreMax: number;
  salary: Salary;
  posted: Posted;
  signals: string[];
  /** lift the default score floor and show the whole corpus */
  showAll: boolean;
};

export const SCORE_FLOOR = -60;
export const SCORE_CEILING = 130;

/**
 * Below this a job is stored but kept out of the queue. Most of the corpus is
 * general job-board noise that will never be worth reading; hiding it by
 * default is the difference between a queue and a list. "Show everything"
 * lifts the floor when you want to audit what is being dropped.
 */
export const QUEUE_FLOOR = 20;

export const EMPTY: Filters = {
  q: "",
  chips: [],
  companies: [],
  sources: [],
  scoreMin: SCORE_FLOOR,
  scoreMax: SCORE_CEILING,
  salary: "any",
  posted: "any",
  signals: [],
  showAll: false,
};

/**
 * Quick location chips. Each is a predicate over a role's locations, not a
 * substring test, because "Remote, Bangalore" is remote and "Bangalore" is not,
 * and neither contains the word Europe.
 */
export const CHIPS: Array<{ id: string; label: string; match: (locations: string[]) => boolean }> = [
  { id: "remote", label: "Remote", match: (l) => l.some((x) => /\bremote\b/i.test(x)) },
  {
    id: "global",
    label: "Global",
    match: (l) => l.some((x) => /\b(global|worldwide|anywhere in the world)\b/i.test(x)),
  },
  {
    id: "europe",
    label: "Europe",
    match: (l) =>
      l.some((x) =>
        /\b(europe|emea|eu|uk|united kingdom|england|ireland|germany|france|spain|portugal|netherlands|poland|sweden|norway|denmark|finland|italy|switzerland|austria|belgium|czech|romania|greece|london|berlin|paris|amsterdam|madrid|lisbon|dublin|warsaw|stockholm|munich|zurich)\b/i.test(
          x,
        ),
      ),
  },
  {
    id: "namerica",
    label: "North America",
    match: (l) =>
      l.some((x) =>
        /\b(usa|u\.s\.|united states|us|canada|mexico|amer|americas|new york|nyc|san francisco|seattle|austin|boston|chicago|denver|toronto|vancouver|montreal|los angeles|atlanta|miami)\b/i.test(
          x,
        ),
      ),
  },
  {
    id: "africa",
    label: "Africa",
    match: (l) =>
      l.some((x) =>
        /\b(africa|nigeria|kenya|ghana|egypt|south africa|lagos|abuja|nairobi|accra|cairo|cape town|johannesburg|rwanda|uganda|tanzania|senegal|ivory coast|zambia|morocco)\b/i.test(
          x,
        ),
      ),
  },
  {
    id: "anywhere",
    label: "Anywhere",
    match: (l) => l.length === 0 || l.some((x) => /\b(anywhere|any location|flexible)\b/i.test(x)),
  },
];

const CHIP_BY_ID = new Map(CHIPS.map((chip) => [chip.id, chip]));

export const POSTED_OPTIONS: Array<{ id: Posted; label: string; hours: number | null }> = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "week", label: "Last week", hours: 24 * 7 },
  { id: "month", label: "Last month", hours: 24 * 30 },
  { id: "any", label: "Any time", hours: null },
];

// ---------------------------------------------------------------- url state

const LIST_KEYS = ["chips", "companies", "sources", "signals"] as const;

const PARAM: Record<string, string> = {
  q: "q",
  chips: "loc",
  companies: "co",
  sources: "src",
  scoreMin: "smin",
  scoreMax: "smax",
  salary: "sal",
  posted: "posted",
  signals: "sig",
  showAll: "all",
};

/** Only non-default values reach the URL, so a clean queue has a clean address. */
export function toParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set(PARAM["q"]!, filters.q.trim());
  for (const key of LIST_KEYS) {
    const value = filters[key];
    if (value.length > 0) params.set(PARAM[key]!, value.join(","));
  }
  if (filters.scoreMin !== EMPTY.scoreMin) params.set(PARAM["scoreMin"]!, String(filters.scoreMin));
  if (filters.scoreMax !== EMPTY.scoreMax) params.set(PARAM["scoreMax"]!, String(filters.scoreMax));
  if (filters.salary !== "any") params.set(PARAM["salary"]!, filters.salary);
  if (filters.posted !== "any") params.set(PARAM["posted"]!, filters.posted);
  if (filters.showAll) params.set(PARAM["showAll"]!, "1");
  return params;
}

function list(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function fromParams(params: URLSearchParams): Filters {
  const salary = params.get(PARAM["salary"]!);
  const posted = params.get(PARAM["posted"]!);

  return {
    q: params.get(PARAM["q"]!) ?? "",
    chips: list(params, PARAM["chips"]!).filter((id) => CHIP_BY_ID.has(id)),
    companies: list(params, PARAM["companies"]!),
    sources: list(params, PARAM["sources"]!),
    scoreMin: num(params, PARAM["scoreMin"]!, EMPTY.scoreMin),
    scoreMax: num(params, PARAM["scoreMax"]!, EMPTY.scoreMax),
    salary: salary === "yes" || salary === "no" ? salary : "any",
    posted: posted === "24h" || posted === "week" || posted === "month" ? posted : "any",
    signals: list(params, PARAM["signals"]!),
    showAll: params.get(PARAM["showAll"]!) === "1",
  };
}

export function isEmpty(filters: Filters): boolean {
  return toParams(filters).toString() === "";
}

export function countActive(filters: Filters): number {
  let active = 0;
  if (filters.q.trim()) active += 1;
  for (const key of LIST_KEYS) active += filters[key].length;
  if (filters.scoreMin !== EMPTY.scoreMin || filters.scoreMax !== EMPTY.scoreMax) active += 1;
  if (filters.salary !== "any") active += 1;
  if (filters.posted !== "any") active += 1;
  // showAll removes a filter rather than adding one, so it is not counted here
  return active;
}

// ------------------------------------------------------------------ matching

type Predicate = (row: Row) => boolean;

function locationText(row: Row): string {
  return row.locations.join(" | ");
}

function postedWithin(row: Row, posted: Posted, now: number): boolean {
  const option = POSTED_OPTIONS.find((o) => o.id === posted);
  if (!option?.hours) return true;
  if (!row.posted_at) return false;
  const at = new Date(row.posted_at).getTime();
  return Number.isFinite(at) && now - at <= option.hours * 3600_000;
}

/**
 * One predicate per filter group, kept separate so facet counts can re-run the
 * set minus the group being counted.
 */
export function predicates(filters: Filters, now = Date.now()): Record<string, Predicate> {
  return {
    q: (row) => {
      const q = filters.q.trim().toLowerCase();
      if (!q) return true;
      return (
        locationText(row).toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q) ||
        row.company.toLowerCase().includes(q)
      );
    },
    chips: (row) => {
      if (filters.chips.length === 0) return true;
      // several chips read as "any of these places"
      return filters.chips.some((id) => CHIP_BY_ID.get(id)?.match(row.locations) ?? false);
    },
    companies: (row) => filters.companies.length === 0 || filters.companies.includes(row.company),
    sources: (row) =>
      filters.sources.length === 0 || row.sources.some((source) => filters.sources.includes(source)),
    score: (row) => row.score >= filters.scoreMin && row.score <= filters.scoreMax,
    floor: (row) => filters.showAll || row.score >= QUEUE_FLOOR,
    salary: (row) =>
      filters.salary === "any" ||
      (filters.salary === "yes" ? row.salary_text !== null : row.salary_text === null),
    posted: (row) => postedWithin(row, filters.posted, now),
    signals: (row) =>
      filters.signals.length === 0 ||
      // every chosen signal must be present, so signals narrow rather than widen
      filters.signals.every((name) => row.signals.some((signal) => signal.name === name)),
  };
}

export function apply(rows: Row[], filters: Filters, now = Date.now()): Row[] {
  const checks = Object.values(predicates(filters, now));
  return rows.filter((row) => checks.every((check) => check(row)));
}

/** Rows passing every filter group except the named one. */
function passingExcept(rows: Row[], filters: Filters, except: string, now: number): Row[] {
  const checks = Object.entries(predicates(filters, now))
    .filter(([key]) => key !== except)
    .map(([, check]) => check);
  return rows.filter((row) => checks.every((check) => check(row)));
}

export type Facets = {
  /** how many jobs the default floor is keeping out of the queue */
  belowFloor: number;
  companies: Array<{ value: string; count: number }>;
  sources: Array<{ value: string; count: number }>;
  signals: Array<{ value: string; count: number }>;
  chips: Array<{ value: string; count: number }>;
  salary: { yes: number; no: number };
  posted: Array<{ value: Posted; count: number }>;
  total: number;
};

/**
 * Counts shown beside each option are "what you would get if you picked this",
 * so each group is counted against the other groups only. Counting against all
 * filters including itself would show 0 next to every unselected option.
 */
export function facets(rows: Row[], filters: Filters, now = Date.now()): Facets {
  const forCompanies = passingExcept(rows, filters, "companies", now);
  const forSources = passingExcept(rows, filters, "sources", now);
  const forSignals = passingExcept(rows, filters, "signals", now);
  const forChips = passingExcept(rows, filters, "chips", now);
  const forSalary = passingExcept(rows, filters, "salary", now);
  const forPosted = passingExcept(rows, filters, "posted", now);
  // what the floor alone is hiding, with every other filter applied
  const forFloor = passingExcept(rows, filters, "floor", now);

  const tally = (source: Row[], pick: (row: Row) => string[]) => {
    const counts = new Map<string, number>();
    for (const row of source) {
      for (const value of new Set(pick(row))) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count }));
  };

  return {
    belowFloor: forFloor.filter((row) => row.score < QUEUE_FLOOR).length,
    companies: tally(forCompanies, (row) => [row.company]).sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    ),
    sources: tally(forSources, (row) => row.sources).sort((a, b) => b.count - a.count),
    signals: tally(forSignals, (row) => row.signals.map((s) => s.name)).sort(
      (a, b) => b.count - a.count,
    ),
    chips: CHIPS.map((chip) => ({
      value: chip.id,
      count: forChips.filter((row) => chip.match(row.locations)).length,
    })),
    salary: {
      yes: forSalary.filter((row) => row.salary_text !== null).length,
      no: forSalary.filter((row) => row.salary_text === null).length,
    },
    posted: POSTED_OPTIONS.map((option) => ({
      value: option.id,
      count: forPosted.filter((row) => postedWithin(row, option.id, now)).length,
    })),
    total: apply(rows, filters, now).length,
  };
}
