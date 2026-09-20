import type { Job } from "../types.js";

export type Signal = {
  name: string;
  weight: number;
  matched: boolean;
  /**
   * What actually matched, for reading a score back and arguing with it.
   * Optional so a Signal can still be written by hand.
   */
  evidence?: string;
};

export type LocalScore = {
  total: number;
  signals: Signal[];
};

/**
 * How far into a description counts as "what this job is about". Past this, a
 * word is usually boilerplate: the benefits list, the legal footer, the stack
 * the company happens to run somewhere.
 */
const LEAD_CHARS = 600;

/**
 * Patterns are anchored, not substrings. The difference matters more than it
 * looks: a bare /java/ matches "JavaScript", /\.net/ matches "sonnet" without
 * the escaped dot, and /api/ matches "capital". Each pattern below is written
 * so the word it claims to find is the word it finds.
 */
type Rule = {
  name: string;
  weight: number;
  /** which text to read; title-only rules never fire on description prose */
  field: "description" | "title";
  patterns: RegExp[];
  /**
   * "any" — one hit anywhere is enough (the default).
   * "twiceOrEarly" — one passing mention proves nothing, so require either two
   * distinct terms or a single one inside the opening LEAD_CHARS.
   */
  strategy?: "any" | "twiceOrEarly";
  /**
   * Names of rules, at least one of which must also have matched for this one
   * to count. Domain knowledge is only a signal in an engineering role: an
   * accountant works with payments and ledgers all day, and a Junior Accountant
   * matching "payments" tells us nothing about fit.
   */
  requiresAnyOf?: string[];
  /**
   * Softens the penalty when the same text also looks like the opposite thing.
   * "Software Engineer, Bill Pay & Procurement" is a backend job whose product
   * area happens to be procurement; "Sales Engineer" is not an engineering job
   * however the words are arranged, which is what `unless` is for.
   */
  soften?: { when: RegExp[]; unless: RegExp[]; weight: number };
};

/** The rules that say "this is an engineering job", used to gate the domains. */
const ENGINEERING = ["stack in title", "stack in description", "backend/full-stack title"];

const RULES: Rule[] = [
  {
    name: "stack in title",
    weight: 15,
    field: "title",
    // "go" is the hazard here: "Go-to-Market Manager" is not a Go job
    patterns: [
      /\bnode(\.js)?\b/i,
      /\btypescript\b/i,
      /\bpython\b/i,
      /\brust\b/i,
      /\bgolang\b/i,
      /\bgo\b(?![\s-]*to[\s-]*market)/i,
    ],
  },
  {
    name: "stack in description",
    weight: 20,
    field: "description",
    // "node.js" and "node" both hit; "nodes" does not
    patterns: [/\bnode(\.js)?\b/i, /\btypescript\b/i, /\bnest(\.?js)\b/i],
  },
  {
    name: "postgres",
    weight: 25,
    field: "description",
    patterns: [/\bpostgres(ql)?\b/i],
  },
  {
    name: "payments domain",
    weight: 8,
    field: "description",
    // one "Stripe" in an integrations list is not a payments job
    strategy: "twiceOrEarly",
    requiresAnyOf: ENGINEERING,
    patterns: [
      /\bpayments?\b/i,
      /\bfintech\b/i,
      /\bledgers?\b/i,
      /\bescrow\b/i,
      /\bstripe\b/i,
      /\bbilling\b/i,
    ],
  },
  {
    name: "devtools domain",
    weight: 8,
    field: "description",
    requiresAnyOf: ENGINEERING,
    // "infrastructure" and "platform" alone fired on 89% of the corpus, so the
    // terms here are the ones a company only writes when it means them
    patterns: [
      /\bdeveloper tool(s|ing)?\b/i,
      /\bdevtools?\b/i,
      /\bdeveloper platform\b/i,
      /\bapi platform\b/i,
      /\bsdks?\b/i,
    ],
  },
  {
    name: "backend/full-stack title",
    weight: 30,
    field: "title",
    patterns: [/\bback[\s-]?end\b/i, /\bfull[\s-]?stack\b/i],
  },
  {
    name: "hires globally",
    weight: 10,
    field: "description",
    patterns: [
      /\bhiring anywhere\b/i,
      /\banywhere in the world\b/i,
      /\bwork from anywhere\b/i,
      /\beor\b/i,
      /\bemployer of record\b/i,
      /\bglobally\b/i,
      /\bany(where|) country\b/i,
    ],
  },
  {
    name: "not engineering",
    weight: -60,
    field: "title",
    patterns: [
      // finance and accounting
      /\baccountants?\b/i,
      /\bauditors?\b/i,
      /\bbookkeep(er|ing)\b/i,
      /\bfinance officer\b/i,
      /\baccount officer\b/i,
      // commercial. The two "engineer" titles are here as whole phrases so they
      // are penalised on their own, not only when another word happens to hit —
      // "Solutions Engineer" matches nothing else in this list.
      /\bsales\b/i,
      /\bsales engineers?\b/i,
      /\bsolutions engineers?\b/i,
      /\baccount executive\b/i,
      /\bbusiness development\b/i,
      // people
      /\brecruit(er|ing|ment)\b/i,
      /\btalent\b/i,
      /\bpeople ops\b/i,
      /\bhr\b/i,
      // marketing and content
      /\bmarketing\b/i,
      /\bdesigners?\b/i,
      /\bcontent\b/i,
      /\bcopywriters?\b/i,
      // service and admin
      /\bcustomer success\b/i,
      /\badministrative\b/i,
      /\breceptionists?\b/i,
      // "Device Driver Engineer" is an engineer; a Driver is not
      /(?<!device\s)(?<!kernel\s)\bdrivers?\b(?!\s+(engineer|developer|development))/i,
      /\bprocurement\b/i,
      // management titles that are not engineering roles
      /\boperations manager\b/i,
      /\bproject manager\b/i,
      /\bproduct manager\b/i,
      // "Customer Support" yes, "Support Engineer" no — that is an engineer
      /\bsupport\b(?!\s+engineer)/i,
    ],
    soften: {
      // note \bengineers?\b does not match "Engineering", so a title like
      // "Technical Recruiter | Engineering" keeps the full penalty
      when: [/\bengineers?\b/i, /\bdevelopers?\b/i],
      unless: [/\bsales engineer\b/i, /\bsolutions engineer\b/i],
      weight: -15,
    },
  },
  {
    name: "residency/clearance required",
    weight: -20,
    field: "description",
    patterns: [
      /\b(us|u\.s\.|united states|eu|european union)\s+(citizen|citizenship|resident|residency|residence)\b/i,
      /\bmust (be (a )?(us|u\.s\.|eu)|reside|be located|be based|live)\b[^.]{0,60}\b(us|u\.s\.|united states|eu|european union)\b/i,
      /\bwork authoriz(ation|ed)\b/i,
      /\bauthorized to work\b/i,
      /\bsecurity clearance\b/i,
      /\b(ts\/sci|top secret)\b/i,
      /\bgreen card\b/i,
      /\bvisa sponsorship is not\b/i,
    ],
  },
  {
    name: "other primary stack",
    weight: -15,
    field: "description",
    // \bjava\b cannot match "javascript". ".NET" is fussier: it has to catch
    // "ASP.NET" and ".NET Core" while leaving the domain in "example.net" alone,
    // so the bare form is the one that requires no word character in front.
    patterns: [
      /\bjava\b/i,
      /\b(asp|vb)\.net\b/i,
      /\.net\s+(core|framework|developer|stack)\b/i,
      /\bdotnet\b/i,
      /(?<![\w.])\.net\b/i,
      /\bphp\b/i,
      /\bruby\b/i,
      /(?<![a-z0-9+#.])c#/i,
    ],
  },
  {
    name: "junior/intern/graduate title",
    weight: -10,
    field: "title",
    patterns: [
      /\bintern(ship)?\b/i,
      /\bgraduate\b/i,
      /\bnew grad\b/i,
      /\bjunior\b/i,
      /\bjr\.?\b/i,
    ],
  },
];

const SALARY_SIGNAL = { name: "salary published", weight: 5 } as const;

/** Every distinct pattern that hits, with where the first hit landed. */
function allMatches(text: string, patterns: RegExp[]): Array<{ term: string; index: number }> {
  const hits: Array<{ term: string; index: number }> = [];
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) hits.push({ term: found[0].toLowerCase(), index: found.index });
  }
  return hits;
}

function evaluate(rule: Rule, text: string): string | null {
  const hits = allMatches(text, rule.patterns);
  if (hits.length === 0) return null;

  if (rule.strategy !== "twiceOrEarly") return hits[0]!.term;

  const distinct = [...new Set(hits.map((hit) => hit.term))];
  if (distinct.length >= 2) return `${distinct.slice(0, 3).join(" + ")}`;

  const early = hits.find((hit) => hit.index < LEAD_CHARS);
  return early ? `${early.term} (in lead)` : null;
}

/**
 * Score a job from its own text alone — no model, no network.
 *
 * Every rule is reported whether or not it fired, because the list is meant to
 * be read and disagreed with: a job scoring 85 should show which five signals
 * got it there, and a wrong one should be obvious on sight.
 *
 * The title outweighs the description on purpose. A description is written to
 * attract applicants; the title is the job.
 */
export function scoreLocal(job: Job): LocalScore {
  const fields = {
    description: job.description ?? "",
    title: job.title ?? "",
  };

  // first pass: what each rule finds on its own
  const found = new Map<string, string | null>();
  for (const rule of RULES) found.set(rule.name, evaluate(rule, fields[rule.field]));

  const satisfied = (names: string[]) => names.some((name) => found.get(name) != null);

  // second pass: a gated rule only counts when its prerequisite also matched,
  // and a softenable one may carry a reduced weight
  const signals: Signal[] = RULES.map((rule) => {
    const evidence = found.get(rule.name) ?? null;
    const gatedOff = evidence !== null && !!rule.requiresAnyOf && !satisfied(rule.requiresAnyOf);

    const text = fields[rule.field];
    const softened =
      evidence !== null &&
      !!rule.soften &&
      rule.soften.when.some((pattern) => pattern.test(text)) &&
      !rule.soften.unless.some((pattern) => pattern.test(text));

    const weight = softened ? rule.soften!.weight : rule.weight;
    const note = gatedOff ? " — no engineering signal" : softened ? " — but reads as engineering" : "";

    return {
      name: rule.name,
      weight,
      matched: evidence !== null && !gatedOff,
      // keep the term and the reason, so a surprising score explains itself
      ...(evidence === null ? {} : { evidence: `${evidence}${note}` }),
    };
  });

  const salary = job.salaryText?.trim();
  signals.push({
    name: SALARY_SIGNAL.name,
    weight: SALARY_SIGNAL.weight,
    matched: !!salary,
    ...(salary ? { evidence: salary } : {}),
  });

  const total = signals.reduce((sum, signal) => (signal.matched ? sum + signal.weight : sum), 0);

  return { total, signals };
}
