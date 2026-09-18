/**
 * Probe candidate board tokens against every ATS and seed the ones that answer.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/seed-companies.ts [--dry-run] [--group core|africa|emerging]
 *
 * The full list is ~450 probes at one second apart, so --group keeps a run to
 * the slice you are actually working on.
 *
 * You cannot tell from outside which ATS a company runs, so every guess is tried
 * against all of them. A 404 means the token is wrong, not that the request
 * failed, so it is reported rather than thrown.
 */
import { CRAWL_DELAY_MS, sleep } from "../src/http.js";
import { verifyToken, type Ats, type VerifyResult } from "../src/verifyToken.js";

type Group = "core" | "africa" | "emerging";

type Candidate = {
  name: string;
  /** token guesses, tried in order against every ATS */
  tokens: string[];
  website?: string;
  /** why a company is here at all, when no board answers for it */
  note?: string;
  /**
   * Tokens that DO answer, but belong to somebody else. Short company names
   * collide hard: greenhouse/carbon is Carbon Inc, the 3D printing company in
   * Sunnyvale, not Carbon the Lagos lender. Verified by reading company_name
   * and the job locations off the board. Probed and reported, never seeded.
   */
  namesakes?: Record<string, string>;
  group: Group;
};

/**
 * Base token plus the "hq" suffix several of these companies use on their board
 * (moniepointhq, paystackhq), plus any hand-known variants.
 */
function hq(name: string, ...extra: string[]): string[] {
  return [name, `${name}hq`, ...extra];
}

const ATS_LIST: readonly Ats[] = ["greenhouse", "lever", "ashby"];

/**
 * Tokens marked verified answered on 2026-09-17. The rest are kept in the list
 * on purpose: they are guesses that currently 404, and a company that migrates
 * onto Greenhouse or Lever will start answering without anyone editing this file.
 *
 * Every guess is tried against all three boards, because a company's ATS is not
 * visible from outside. The ones still marked with a `note` answer on none of
 * them.
 */
const CANDIDATES: Candidate[] = [
  // --- the starting list ---
  { name: "Vercel", tokens: ["vercel"], website: "https://vercel.com", group: "core" }, // verified: greenhouse
  { name: "Supabase", tokens: ["supabase"], website: "https://supabase.com", group: "core" },
  { name: "Railway", tokens: ["railway"], website: "https://railway.com", group: "core" },
  { name: "Render", tokens: ["render"], website: "https://render.com", group: "core" },
  { name: "PlanetScale", tokens: ["planetscale"], website: "https://planetscale.com", group: "core" }, // verified: greenhouse
  { name: "Neon", tokens: ["neon"], website: "https://neon.com", group: "core" }, // verified: lever
  { name: "Clerk", tokens: ["clerk"], website: "https://clerk.com", group: "core" },
  { name: "Resend", tokens: ["resend"], website: "https://resend.com", group: "core" },
  { name: "Linear", tokens: ["linear"], website: "https://linear.app", group: "core" },
  { name: "PostHog", tokens: ["posthog"], website: "https://posthog.com", group: "core" },
  { name: "Cal.com", tokens: ["cal", "calcom"], website: "https://cal.com", note: "on neither; no ashby board found", group: "core" },
  { name: "Hashnode", tokens: ["hashnode"], website: "https://hashnode.com", note: "on neither; no ashby board found", group: "core" },
  { name: "GitLab", tokens: ["gitlab"], website: "https://about.gitlab.com", group: "core" }, // verified: greenhouse
  { name: "Stripe", tokens: ["stripe"], website: "https://stripe.com", group: "core" }, // verified: greenhouse
  { name: "Mercury", tokens: ["mercury"], website: "https://mercury.com", group: "core" }, // verified: greenhouse
  { name: "Wise", tokens: ["wise"], website: "https://wise.com", group: "core" }, // verified: greenhouse
  { name: "Monzo", tokens: ["monzo"], website: "https://monzo.com", group: "core" }, // verified: greenhouse
  { name: "Ramp", tokens: ["ramp"], website: "https://ramp.com", group: "core" },
  { name: "Deel", tokens: ["deel"], website: "https://deel.com", group: "core" },
  { name: "Remote", tokens: ["remote", "remotecom"], website: "https://remote.com", group: "core" }, // verified: greenhouse/remotecom
  { name: "Oyster", tokens: ["oyster"], website: "https://oysterhr.com", group: "core" },
  { name: "Papaya Global", tokens: ["papaya"], website: "https://papayaglobal.com", group: "core" }, // verified: greenhouse, empty today
  { name: "Sourcegraph", tokens: ["sourcegraph"], website: "https://sourcegraph.com", note: "on neither; no ashby board found", group: "core" },
  { name: "Replit", tokens: ["replit"], website: "https://replit.com", group: "core" },
  { name: "Fly.io", tokens: ["fly"], website: "https://fly.io", group: "core" }, // verified: lever

  // --- added after probing, all verified ---
  { name: "Cloudflare", tokens: ["cloudflare"], website: "https://cloudflare.com", group: "core" },
  { name: "Datadog", tokens: ["datadog"], website: "https://datadoghq.com", group: "core" },
  { name: "MongoDB", tokens: ["mongodb"], website: "https://mongodb.com", group: "core" },
  { name: "Elastic", tokens: ["elastic"], website: "https://elastic.co", group: "core" },
  { name: "Grafana Labs", tokens: ["grafanalabs"], website: "https://grafana.com", group: "core" },
  { name: "Cockroach Labs", tokens: ["cockroachlabs"], website: "https://cockroachlabs.com", group: "core" },
  { name: "JetBrains", tokens: ["jetbrains"], website: "https://jetbrains.com", group: "core" },
  { name: "CircleCI", tokens: ["circleci"], website: "https://circleci.com", group: "core" },
  { name: "Algolia", tokens: ["algolia"], website: "https://algolia.com", group: "core" },
  { name: "Fastly", tokens: ["fastly"], website: "https://fastly.com", group: "core" },
  { name: "Twilio", tokens: ["twilio"], website: "https://twilio.com", group: "core" },
  { name: "Netlify", tokens: ["netlify"], website: "https://netlify.com", group: "core" },
  { name: "Figma", tokens: ["figma"], website: "https://figma.com", group: "core" },
  { name: "Discord", tokens: ["discord"], website: "https://discord.com", group: "core" },
  { name: "Reddit", tokens: ["reddit"], website: "https://reddit.com", group: "core" },
  { name: "Coinbase", tokens: ["coinbase"], website: "https://coinbase.com", group: "core" },
  { name: "Robinhood", tokens: ["robinhood"], website: "https://robinhood.com", group: "core" },
  { name: "Airbnb", tokens: ["airbnb"], website: "https://airbnb.com", group: "core" },
  { name: "Brex", tokens: ["brex"], website: "https://brex.com", group: "core" },

  // --- Nigeria and West Africa ---
  { name: "Flutterwave", tokens: hq("flutterwave", "flutterwavetech"), website: "https://flutterwave.com", group: "africa" },
  { name: "Paystack", tokens: hq("paystack"), website: "https://paystack.com", group: "africa" },
  { name: "Moniepoint", tokens: hq("moniepoint"), website: "https://moniepoint.com", group: "africa" },
  { name: "Kuda", tokens: hq("kuda", "kudabank"), website: "https://kuda.com", group: "africa" },
  { name: "Interswitch", tokens: hq("interswitch"), website: "https://interswitchgroup.com", group: "africa" },
  { name: "OPay", tokens: hq("opay"), website: "https://opayweb.com", group: "africa" },
  { name: "PalmPay", tokens: hq("palmpay"), website: "https://palmpay.com", group: "africa" },
  { name: "Carbon", namesakes: { "carbon": "Carbon Inc, 3D printing, Sunnyvale CA" }, tokens: hq("carbon"), website: "https://getcarbon.co", group: "africa" },
  { name: "Cowrywise", tokens: hq("cowrywise"), website: "https://cowrywise.com", group: "africa" },
  { name: "Risevest", tokens: hq("risevest"), website: "https://risevest.com", group: "africa" },
  { name: "Bamboo", tokens: hq("bamboo"), website: "https://investbamboo.com", group: "africa" },
  { name: "PiggyVest", tokens: hq("piggyvest"), website: "https://piggyvest.com", group: "africa" },
  { name: "Mono", tokens: hq("mono"), website: "https://mono.co", group: "africa" },
  { name: "Okra", tokens: hq("okra"), website: "https://okra.ng", group: "africa" },
  { name: "Termii", tokens: hq("termii"), website: "https://termii.com", group: "africa" },
  { name: "Seamfix", tokens: hq("seamfix"), website: "https://seamfix.com", group: "africa" },
  { name: "Softcom", tokens: hq("softcom"), website: "https://softcom.ng", group: "africa" },
  { name: "TeamApt", tokens: hq("teamapt"), website: "https://teamapt.com", group: "africa" },
  { name: "Sabi", namesakes: { "sabi": "a neurotech wearable startup in SF" }, tokens: hq("sabi"), website: "https://sabi.am", group: "africa" },
  { name: "Eden", tokens: hq("eden"), website: "https://edenlife.ng", group: "africa" },
  { name: "Vendease", tokens: hq("vendease"), website: "https://vendease.com", group: "africa" },
  { name: "Thepeer", tokens: hq("thepeer"), website: "https://thepeer.co", group: "africa" },
  { name: "Brass", tokens: hq("brass"), website: "https://trybrass.com", group: "africa" },
  { name: "Anchor", tokens: hq("anchor"), website: "https://getanchor.co", group: "africa" },
  { name: "LemFi", tokens: hq("lemfi"), website: "https://lemfi.com", group: "africa" },
  { name: "Grey", namesakes: { "grey": "GREY, the advertising agency" }, tokens: hq("grey"), website: "https://grey.co", group: "africa" },
  { name: "Nomba", tokens: hq("nomba"), website: "https://nomba.com", group: "africa" },
  { name: "Bumpa", tokens: hq("bumpa"), website: "https://getbumpa.com", group: "africa" },
  { name: "Thrive", namesakes: { "thrive": "THRIVE, a design firm in Atlanta" }, tokens: hq("thrive"), website: "https://thriveagric.com", group: "africa" },
  { name: "Klasha", tokens: hq("klasha"), website: "https://klasha.com", group: "africa" },
  { name: "Duplo", tokens: hq("duplo"), website: "https://tryduplo.com", group: "africa" },
  { name: "Bloc", tokens: hq("bloc"), website: "https://blochq.io", group: "africa" },
  { name: "Flex", namesakes: { "flex": "Flex, NYC rent-payments fintech" }, tokens: hq("flex"), website: "https://flexfinance.io", group: "africa" },
  { name: "Prospa", namesakes: { "prospa": "Prospa, Australian SME lender in Sydney" }, tokens: hq("prospa"), website: "https://prospa.in", group: "africa" },

  // --- Pan-African and East Africa ---
  { name: "Chipper Cash", tokens: hq("chippercash", "chipper"), website: "https://chippercash.com", group: "africa" },
  { name: "Yellow Card", tokens: hq("yellowcard"), website: "https://yellowcard.io", group: "africa" },
  { name: "Wave", tokens: hq("wave", "wavemobilemoney"), website: "https://wave.com", group: "africa" },
  { name: "M-Pesa", tokens: hq("mpesa"), website: "https://m-pesa.com", group: "africa" },
  { name: "Safaricom", tokens: hq("safaricom"), website: "https://safaricom.co.ke", group: "africa" },
  { name: "Andela", tokens: hq("andela"), website: "https://andela.com", group: "africa" },
  { name: "Jumia", tokens: hq("jumia"), website: "https://jumia.com", group: "africa" },
  { name: "TymeBank", tokens: hq("tymebank", "tyme"), website: "https://tymebank.co.za", group: "africa" },
  { name: "MFS Africa", tokens: hq("mfs", "mfsafrica"), website: "https://mfsafrica.com", group: "africa" },
  { name: "Onafriq", tokens: hq("onafriq"), website: "https://onafriq.com", group: "africa" },
  { name: "Cellulant", tokens: hq("cellulant"), website: "https://cellulant.io", group: "africa" },
  { name: "MNT-Halan", tokens: hq("mnt", "mnthalan"), website: "https://halan.com", group: "africa" },
  { name: "Pula", tokens: hq("pula"), website: "https://pula.io", group: "africa" },
  { name: "Turaco", tokens: hq("turaco"), website: "https://turaco.insure", group: "africa" },
  { name: "Apollo Agriculture", tokens: hq("apollo", "apolloagriculture"), website: "https://apolloagriculture.com", group: "africa" },
  { name: "Twiga Foods", tokens: hq("twiga"), website: "https://twiga.com", group: "africa" },
  { name: "Kobo360", tokens: hq("kobo360", "kobo"), website: "https://kobo360.com", group: "africa" },
  { name: "Sendy", tokens: hq("sendy"), website: "https://sendyit.com", group: "africa" },
  { name: "Gro Intelligence", tokens: hq("gro", "grointelligence"), website: "https://gro-intelligence.com", group: "africa" },
  { name: "Zepz", tokens: hq("zepz"), website: "https://zepz.io", group: "africa" },
  { name: "Sendwave", tokens: hq("sendwave"), website: "https://sendwave.com", group: "africa" },

  // --- emerging-market fintech, same profile ---
  { name: "dLocal", tokens: hq("dlocal"), website: "https://dlocal.com", group: "emerging" },
  { name: "EBANX", tokens: hq("ebanx"), website: "https://ebanx.com", group: "emerging" },
  { name: "Nubank", tokens: hq("nubank"), website: "https://nubank.com.br", group: "emerging" },
  { name: "Rappi", tokens: hq("rappi"), website: "https://rappi.com", group: "emerging" },
  { name: "Kavak", tokens: hq("kavak"), website: "https://kavak.com", group: "emerging" },
  { name: "Xendit", tokens: hq("xendit"), website: "https://xendit.co", group: "emerging" },
  { name: "Coda Payments", tokens: hq("coda", "codapayments"), website: "https://codapayments.com", group: "emerging" },
  { name: "Stitch", tokens: hq("stitch"), website: "https://stitch.money", group: "emerging" },
  { name: "Yoco", tokens: hq("yoco"), website: "https://yoco.com", group: "emerging" },
  { name: "Ozow", tokens: hq("ozow"), website: "https://ozow.com", group: "emerging" },
  { name: "Peach Payments", tokens: hq("peach", "peachpayments"), website: "https://peachpayments.com", group: "emerging" },
  { name: "Revio", tokens: hq("revio"), website: "https://revio.co.za", group: "emerging" },
  { name: "Fincra", tokens: hq("fincra"), website: "https://fincra.com", group: "emerging" },
  { name: "Waza", tokens: hq("waza"), website: "https://waza.co", group: "emerging" },
  { name: "Juicyway", tokens: hq("juicyway"), website: "https://juicyway.com", group: "emerging" },
];

type Probe = {
  name: string;
  ats: Ats;
  token: string;
  ok: boolean;
  count?: number;
  error?: string;
  /** true when the board never gave us a verdict, only transport trouble */
  unchecked?: boolean;
};

/** verifyToken says "no board" for a 404 and "request failed" for anything else. */
function isTransient(error: string | undefined): boolean {
  return !!error?.startsWith("request failed");
}

/**
 * A 404 is a verdict and needs no second look. Anything else — a 429, a 502, a
 * dropped connection — is not, and treating it as one silently drops a company
 * that does have a board. Seen in practice: greenhouse/wise failed once mid-run
 * and verified fine on its own a minute later.
 */
async function verifyWithRetry(ats: Ats, token: string, attempts = 3): Promise<VerifyResult> {
  let last = await verifyToken(ats, token);
  for (let attempt = 1; attempt < attempts && !last.ok && isTransient(last.error); attempt += 1) {
    await sleep(CRAWL_DELAY_MS * (attempt + 1));
    process.stderr.write(`  retry ${ats}/${token} (${last.error})\n`);
    last = await verifyToken(ats, token);
  }
  return last;
}

async function probeAll(candidates: Candidate[]): Promise<Probe[]> {
  const probes: Probe[] = [];
  let first = true;

  for (const candidate of candidates) {
    for (const token of candidate.tokens) {
      for (const ats of ATS_LIST) {
        // one request per probe, spaced out; the boards declare Crawl-delay: 1
        if (!first) await sleep(CRAWL_DELAY_MS);
        first = false;

        const result = await verifyWithRetry(ats, token);
        const unchecked = !result.ok && isTransient(result.error);
        probes.push({ name: candidate.name, ats, token, ...result, unchecked });
        process.stderr.write(
          result.ok
            ? `  hit  ${ats}/${token} (${result.count} jobs)\n`
            : `  ${unchecked ? "FAIL" : "miss"} ${ats}/${token}\n`,
        );
      }
    }
  }

  return probes;
}

/** A company can have a stale board alongside a live one; keep the fullest. */
function pickBoards(probes: Probe[], candidates: Candidate[]): Probe[] {
  const namesakes = new Map<string, string>();
  for (const candidate of candidates) {
    for (const [token, who] of Object.entries(candidate.namesakes ?? {})) {
      namesakes.set(`${candidate.name}|${token}`, who);
    }
  }

  const byCompany = new Map<string, Probe[]>();
  for (const probe of probes.filter((p) => p.ok)) {
    const who = namesakes.get(`${probe.name}|${probe.token}`);
    if (who) {
      console.warn(`namesake: ${probe.ats}/${probe.token} answers but is ${who} — not seeded`);
      continue;
    }
    byCompany.set(probe.name, [...(byCompany.get(probe.name) ?? []), probe]);
  }

  const chosen: Probe[] = [];
  for (const [name, hits] of byCompany) {
    const ranked = [...hits].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    const best = ranked[0]!;
    chosen.push(best);
    for (const other of ranked.slice(1)) {
      console.warn(
        `note: ${name} also answers on ${other.ats}/${other.token} (${other.count} jobs) — not seeded`,
      );
    }
  }
  return chosen;
}

async function seed(boards: Probe[]): Promise<{ inserted: number; existing: number }> {
  // imported lazily so --dry-run needs no DATABASE_URL
  const { pool } = await import("../src/db.js");
  const websites = new Map(CANDIDATES.map((c) => [c.name, c.website ?? null]));
  const seededOn = new Date().toISOString().slice(0, 10);

  let inserted = 0;
  let existing = 0;

  for (const board of boards) {
    const { rowCount } = await pool.query(
      `insert into companies (name, ats, token, website, notes)
       values ($1, $2, $3, $4, $5)
       on conflict (ats, token) do nothing`,
      [
        board.name,
        board.ats,
        board.token,
        websites.get(board.name) ?? null,
        `seeded ${seededOn}; ${board.count} jobs at seed time`,
      ],
    );
    if (rowCount === 1) inserted += 1;
    else existing += 1;
  }

  await pool.end();
  return { inserted, existing };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const groupIndex = process.argv.indexOf("--group");
  const group = groupIndex === -1 ? null : process.argv[groupIndex + 1];

  if (group && !["core", "africa", "emerging"].includes(group)) {
    throw new Error(`--group must be core, africa or emerging, got "${group}"`);
  }

  const candidates = group ? CANDIDATES.filter((c) => c.group === group) : CANDIDATES;
  const probeCount = candidates.reduce((sum, c) => sum + c.tokens.length * ATS_LIST.length, 0);

  console.error(
    `probing ${candidates.length} companies${group ? ` in "${group}"` : ""} — ${probeCount} requests, about ${Math.ceil((probeCount * CRAWL_DELAY_MS) / 60000)} min`,
  );
  const probes = await probeAll(candidates);
  const boards = pickBoards(probes, candidates);

  const verified = new Set(boards.map((b) => b.name));
  console.log("\nprobe results");
  console.table(
    probes.map((p) => ({
      company: p.name,
      ats: p.ats,
      token: p.token,
      result: p.ok
        ? (CANDIDATES.find((c) => c.name === p.name)?.namesakes?.[p.token] ? "namesake" : "ok")
        : p.unchecked
          ? "unchecked"
          : "404",
      jobs: p.count ?? "",
      detail: p.ok ? "" : (p.error ?? "").replace(/^no \w+ board for token "[^"]*" /, ""),
    })),
  );

  console.log("\nper company");
  console.table(
    candidates.map((c) => {
      const hit = boards.find((b) => b.name === c.name);
      return {
        company: c.name,
        tokens_tried: c.tokens.join(", "),
        found: hit ? `${hit.ats}/${hit.token}` : "—",
        jobs: hit?.count ?? "",
        note: hit ? "" : (c.note ?? ""),
      };
    }),
  );

  const hits = probes.filter((p) => p.ok).length;
  const unchecked = probes.filter((p) => p.unchecked);
  console.log(
    [
      "",
      `companies:      ${verified.size} of ${candidates.length} verified (${Math.round((verified.size / candidates.length) * 100)}%)`,
      `probes:         ${hits} hits of ${probes.length} (${Math.round((hits / probes.length) * 100)}%)`,
      `boards to seed: ${boards.length}`,
    ].join("\n"),
  );

  if (unchecked.length > 0) {
    console.warn(
      `\n${unchecked.length} probe(s) never got a verdict and are NOT a 404 — rerun to settle them:`,
    );
    for (const probe of unchecked) console.warn(`  ${probe.ats}/${probe.token}: ${probe.error}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    return;
  }

  const { inserted, existing } = await seed(boards);
  console.log(`\ninserted ${inserted}, already present ${existing}`);
}

await main();
