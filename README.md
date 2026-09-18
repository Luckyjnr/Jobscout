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

| Source | Auth | Notes |
| --- | --- | --- |
| Greenhouse | none | Per-company board token. Descriptions are double-escaped HTML. No salary. |
| Ashby | none | Per-company slug. Best data: complete plaintext descriptions and structured pay via `includeCompensation=true`. |
| Lever | none | Per-company site. `descriptionPlain` is intro-only; the adapter reassembles the full text. |
| Remote OK | none | Single feed, ~99 jobs. Element 0 is a legal notice, not a job. Attribution required. |

`NOTES.md` records the findings behind these adapters — the parts that are not
obvious from the code.
