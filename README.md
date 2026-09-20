# jobscout

A job-finding agent. It crawls remote and ATS job boards, stores postings in
Postgres, scores them against a profile, and serves a review queue you can work
through in twenty minutes.

## Requirements

- Node 20+
- PostgreSQL 14+

## Setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL
npm run migrate
```

`profile.md` at the repo root describes the candidate. It is read at runtime, so
edit it freely — scoring changes without touching code.

## Commands

| Command | What it does |
| --- | --- |
| `npm run migrate` | Applies `src/schema.sql`. Idempotent; safe against a live database. |
| `npm run seed-sources` | Reconciles the feed definitions in `src/sources/feeds.ts` into the `sources` table. Idempotent. |
| `npm run seed` | Probes candidate board tokens against Greenhouse, Lever and Ashby, seeds the ones that answer. `--dry-run`, `--group core\|africa\|emerging`. |
| `npm run crawl` | Fetches every active board and upserts the postings. Exits non-zero if more than 20% of boards fail (`--max-failure-rate`). |
| `npm run score` | Rescores every job with the local keyword scorer. `--dry-run`, `--top N`. |
| `npm run report` | Prints what the latest crawl changed. `--markdown` for a GitHub job summary. |
| `npm run llm-score` | Sends the top locally-scored jobs to Claude for a judged fit score. Costs money; needs `ANTHROPIC_API_KEY`. `--dry-run`, `--top N`, `--force`. |
| `npm run dev` | One-off Remote OK fetch. |
| `npm test` / `npm run typecheck` | Vitest, and `tsc` over `src`, `tests` and `scripts`. |

The review UI is a separate app in [`web/`](web/):

```bash
cd web && DATABASE_URL=... npm run dev     # http://localhost:3111
```

## Scheduled crawling

[`.github/workflows/crawl.yml`](.github/workflows/crawl.yml) runs every 6 hours
and on manual dispatch. It migrates, crawls, scores, and writes the report into
the run summary. The crawl step fails the run when more than 20% of boards
error, so a job that collects nothing is loud rather than green.

### This needs a hosted database

**A local Postgres — including the Docker container used in development — is not
reachable from GitHub Actions.** The runner is an ephemeral VM on GitHub's
network with no route back to your machine. Pointing `DATABASE_URL` at
`localhost:5432` will not fail in an obvious way at setup time; it will fail on
every scheduled run with a connection timeout.

So the workflow needs Postgres somewhere with a public hostname. Any of these
work: Neon, Supabase, Railway, Render, Fly Postgres, RDS, or your own server.
What matters is that it accepts connections from GitHub's IP ranges — which are
broad and change, so either allow them, allow all and rely on TLS plus a strong
password, or use a provider whose connection string is scoped to one database.

Then add the connection string as a repository secret named `DATABASE_URL`:

> Settings → Secrets and variables → Actions → New repository secret

The workflow checks the secret is present before doing anything and fails with a
clear message if it is missing, rather than running a crawl into nowhere.

Most hosted providers require TLS. `pg` reads `sslmode` from the connection
string, so append `?sslmode=require` if your provider expects it:

```
postgres://user:password@host.neon.tech/jobscout?sslmode=require
```

### Running the same thing locally

Development uses a throwaway container:

```bash
docker run -d --name jobscout-pg \
  -e POSTGRES_PASSWORD=jobscout -e POSTGRES_DB=jobscout \
  -p 55433:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:jobscout@127.0.0.1:55433/jobscout"
npm run migrate && npm run crawl && npm run score && npm run report
```

That container is for your machine only. It is not what the workflow talks to.

## How scoring works

Two layers:

1. **Local** (`src/scoring/local.ts`) — keyword signals with weights, run over
   every job. Cheap, deterministic, and every score comes with the list of
   signals that produced it, including the exact text that matched. Read a score
   you disagree with and the wrong signal is visible on sight.
2. **LLM** (`src/scoring/llm.ts`) — Claude judges the top locally-scored jobs on
   the things keywords cannot: whether a "backend" title is really backend,
   whether the seniority matches, and whether there are hidden blockers.

Jobs carry two identities. `fingerprint` is the **role** (company + title), so
one job advertised in twenty cities is one fingerprint. `posting_fingerprint`
adds the location and identifies a single listing. The review UI groups by the
former, which is why one row can cover twenty postings and one decision closes
all of them.

## Data sources

Two kinds. **ATS boards** are per-company and live in the `companies` table;
**feeds** are whole job boards and live in `sources`, defined in code at
[`src/sources/feeds.ts`](src/sources/feeds.ts).

| Source | Kind | Auth | Notes |
| --- | --- | --- | --- |
| Greenhouse | ATS | none | Per-company board token. Descriptions are double-escaped HTML. No salary. |
| Ashby | ATS | none | Per-company slug. Best data: complete plaintext descriptions and structured pay via `includeCompensation=true`. |
| Lever | ATS | none | Per-company site. `descriptionPlain` is intro-only; the adapter reassembles the full text. |
| Remote OK | feed | none | Single feed, ~99 jobs. Element 0 is a legal notice, not a job. Attribution required. |
| MyJobMag | feed | none | `aggregate_feed.xml`, ~100 jobs. Richest structure of any feed: company, location, contract, working hours, expiry. The `salary` field exists but is empty on every item so far. |
| HotNigerianJobs | feed | none | `/feed/rss`, ~600 jobs. **Not `/rss.xml`** — that URL is a stub with one item dated 2021. No employer field; it comes out of the title. |
| Jobzilla | feed | none | `/feed`, ~200 jobs. No employer or location field; employer comes out of the title. |
| Jobicy | feed | none | `/api/v2/remote-jobs`, ~200 remote jobs. **Polled at most every 240 minutes and credited visibly** — see below. |

All four feeds go through one adapter, [`src/sources/rss.ts`](src/sources/rss.ts):
they carry the same handful of facts under different names, so the difference
between them is a field map, not four adapters. It reads RSS/Atom XML and JSON
through the same mapping.

### Poll intervals and attribution

Both `companies` and `sources` carry `min_interval_minutes`, and the crawl only
visits a target whose last success is older than its own interval. Jobicy's feed
asks in its own legal notice for "a few times daily", so its row is 240 minutes
and a 6-hourly cron skips it roughly half the time; everything else is 15.

`sources` also carries `attribution_required`, `attribution_text` and
`attribution_url`. Where a feed's terms require visible credit — Jobicy asks for
"clear credit with a direct link to the source" — the review UI renders that
credit on every row from that feed and links job titles to the original posting.

### Staleness

A posting older than **7 days** is stored but never counted as new in the
report. Feeds backfill and reorder, and ATS boards carry long-lived postings:
on a first crawl, 153 of Moniepoint's 193 Greenhouse listings were more than a
week old. Without the guard every one of those is "new" the first time you look,
and the report becomes noise. Age is judged on the posting date, not on when we
first saw it.

`NOTES.md` records the findings behind these adapters — the parts that are not
obvious from the code.
