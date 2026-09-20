# Jobscout notes

- TypeScript 7 doesn't auto-include @types/node. Needs "types": ["node"] in tsconfig.
- Fingerprint: company suffixes stripped trailing-only, or "Co-op Systems" becomes "op Systems"
- Title normalization order matters: bracketed spans, then hyphenated phrases, then punctuation
- Loosest rule: stripping "i" as a seniority token. Strips a stray "I" anywhere.
- Remote OK: salary_min/max are 0 when unknown, not missing. 86/99 rows.
- Postgres caps a statement at 65535 bind params. Chunk large inserts.
- `returning (xmax = 0) as inserted` splits inserts from updates in one statement.
- Remote OK descriptions contain mojibake at source. Stored faithfully, don't try to repair.
- Greenhouse content is double-escaped. Order must be decode -> strip -> decode.
  Decoding twice first turns escaped &amp;lt; into a phantom tag.
- Ashby is the 2nd ATS for remote-first dev tools, not Lever.
  11 of 14 misses were on Ashby. Lever gave 13 jobs of 4,491.
- fingerprint(company,title) is ROLE identity. One company x 20 cities = 1 fingerprint.
  MongoDB had one role listed 20 times. Need a separate posting identity.
- Greenhouse doordash/notion are 404, not empty. Empty boards do exist (lever/voleon).
- "remote" token has 2 jobs, "remotecom" has 182. Same company, pick the fuller board.
- verifyToken: a 404 is a verdict, a 429/502 is not. Retry non-404s or boards
  silently vanish from the seed (lost Wise this way).
- Ashby salary needs ?includeCompensation=true. 246/400 jobs have it. Greenhouse: 0.
- Zero cross-board duplicates in 4,892 jobs. Companies use ONE ATS.
  All duplicate pressure is multi-city listings, not cross-board.
- 3,555 roles vs 4,565 postings across the corpus.
- A signal firing on 89% of rows is a constant, not a signal.
  "infrastructure" and "platform" alone matched 950/1422.
- Title beats description. Descriptions are written by marketing.
- "go" in a title needs a guard or every Go-to-Market role scores +15.
- "support" only penalised when NOT followed by "engineer".
- Corpus is skewed: Stripe is 654 of 1,422 jobs. Read distributions with that in mind.
- Local scorer on 5,001 ATS jobs: top 25 are all genuine backend roles.
  Grafana, Linear, Ramp, Resend, Supabase, Replit, Stripe.
  No LLM layer needed to get a usable queue.
- A board answering on a token does NOT mean it's the right company.
  greenhouse/carbon = 3D printing in Sunnyvale, not Carbon the Lagos lender.
  greenhouse/grey = ad agency. ashby/sabi = neurotech startup.
  Always read company_name and locations off the board before seeding.
- "hq" suffix variants: zero hits across 70 companies. Stop trying them.
- African hit rate 9%, LatAm 40%. Local-hiring African startups use
  their own careers pages, Workable or Zoho, not the US ATS trio.
- Piping a command into tail makes $? the pipe's status, not the command's.
  Nearly shipped a failure gate that never fired.
- fetched_at is rewritten on every upsert, so it can't answer "what's new".
  created_at must be excluded from the upsert's update list.
- Failure-rate threshold scales with board count. At 5 boards one flake is 20%.
- Supabase direct connection is IPv6-only. GitHub Actions has no IPv6.
  Must use the pooler (port 6543, host contains pooler.supabase.com).
- First real scheduled run: 52 boards, 5,407 jobs, 74 scoring above 50.
- Feeds != boards for closing. Jobicy/MyJobMag/RemoteOK return only the
  latest N of a larger set, so absence does not mean delisted.
  ATS boards close on absence, feeds do not.
- scripts/score.ts was building Job with postedAt: null. Harmless until a
  rule read it, then silently dead. Same shortcut still in llm-score.ts.
- Recency bands moved median score 0 -> 15.
