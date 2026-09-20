create table if not exists jobs (
  id            bigserial primary key,
  source        text not null,
  source_id     text not null,
  url           text not null,
  title         text not null,
  company       text not null,
  description   text not null,
  location      text,
  remote        boolean not null default true,
  salary_text   text,
  posted_at     timestamptz,
  fetched_at    timestamptz not null default now(),
  fingerprint   text not null,
  posting_fingerprint text,
  raw           jsonb not null,
  unique (source, source_id)
);

-- added after the table shipped, so existing databases get it here; nullable
-- because rows already in the table have nothing to put in it until backfill
alter table jobs add column if not exists posting_fingerprint text;

-- local scoring output: the total, and the signal list that explains it
alter table jobs add column if not exists score integer;
alter table jobs add column if not exists score_signals jsonb;
alter table jobs add column if not exists scored_at timestamptz;

-- when the row first arrived. fetched_at is rewritten by every upsert, so it
-- cannot answer "what is new"; this column is never in the update list.
alter table jobs add column if not exists created_at timestamptz;
update jobs set created_at = fetched_at where created_at is null;
alter table jobs alter column created_at set default now();

-- which crawl target produced this row, e.g. 'greenhouse/moniepoint'.
-- Closing needs to know the exact board a job came from: `source` alone is
-- not enough, since one Greenhouse board is not all of Greenhouse.
alter table jobs add column if not exists board text;

-- a posting the board has stopped listing. Stored, never queued.
alter table jobs add column if not exists closed boolean not null default false;
alter table jobs add column if not exists closed_at timestamptz;

-- llm judgement: the fit score and the model's own reasoning
alter table jobs add column if not exists fit integer;
alter table jobs add column if not exists reasons jsonb;
alter table jobs add column if not exists concerns jsonb;
alter table jobs add column if not exists llm_scored_at timestamptz;

create index if not exists jobs_fingerprint_idx on jobs (fingerprint);
create index if not exists jobs_posting_fingerprint_idx on jobs (posting_fingerprint);
create index if not exists jobs_posted_at_idx on jobs (posted_at desc);
create index if not exists jobs_score_idx on jobs (score desc nulls last);
create index if not exists jobs_fit_idx on jobs (fit desc nulls last);
create index if not exists jobs_created_at_idx on jobs (created_at desc);
create index if not exists jobs_board_idx on jobs (board) where not closed;
create index if not exists jobs_open_idx on jobs (closed) where not closed;

create table if not exists companies (
  id          bigserial primary key,
  name        text not null,
  ats         text not null,          -- 'greenhouse' | 'lever'
  token       text not null,          -- board token / site slug
  website     text,
  notes       text,
  active      boolean not null default true,
  last_ok_at  timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  unique (ats, token)
);

create table if not exists decisions (
  id          bigserial primary key,
  job_id      bigint not null references jobs(id),
  decision    text not null,     -- 'interested' | 'rejected'
  note        text,
  decided_at  timestamptz not null default now(),
  unique (job_id)
);

create index if not exists decisions_decision_idx on decisions (decision);

-- feed sources that are not per-company ATS boards: RSS and JSON job feeds.
-- min_interval_minutes is a floor the crawler respects, because some feeds ask
-- to be polled far less often than others (Jobicy: "a few times daily").
create table if not exists sources (
  id                   bigserial primary key,
  name                 text not null,
  kind                 text not null,          -- 'rss' | 'json'
  url                  text not null,
  active               boolean not null default true,
  min_interval_minutes integer not null default 15,
  -- what the feed's own terms require of anyone republishing it
  attribution_required boolean not null default false,
  attribution_text     text,
  attribution_url      text,
  -- whether a response is the whole board or just the newest slice. RSS feeds
  -- hand back a rolling window (Jobicy 200, MyJobMag 100), so a job missing
  -- from one is usually just older, not gone — closing on those would wipe the
  -- corpus every run. ATS boards return everything and are closed on.
  closes_missing       boolean not null default false,
  last_ok_at           timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  unique (name)
);

-- ATS boards get the same courtesy floor
alter table companies add column if not exists min_interval_minutes integer not null default 15;

-- one row per crawl, so a report can say what changed since the last one
create table if not exists runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  companies    integer,
  ok           integer,
  failed       integer,
  fetched      integer,
  skipped      integer,
  inserted     integer,
  updated      integer
);
