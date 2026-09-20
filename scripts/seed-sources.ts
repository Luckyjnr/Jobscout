/**
 * Put the feed definitions in src/sources/feeds.ts into the sources table.
 *
 * Run:  DATABASE_URL=... npm run seed-sources
 *
 * The code is the source of truth for URL, kind and attribution; the table is
 * the source of truth for whether a feed is active and when it last ran. On a
 * rerun the first three are refreshed and the rest is left alone.
 */
import { pool } from "../src/db.js";
import { FEEDS } from "../src/sources/feeds.js";

for (const feed of FEEDS) {
  const { rows } = await pool.query<{ id: string; inserted: boolean }>(
    `insert into sources (name, kind, url, min_interval_minutes,
                          attribution_required, attribution_text, attribution_url)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (name) do update
        set kind = excluded.kind,
            url = excluded.url,
            min_interval_minutes = excluded.min_interval_minutes,
            attribution_required = excluded.attribution_required,
            attribution_text = excluded.attribution_text,
            attribution_url = excluded.attribution_url
     returning id::text, (xmax = 0) as inserted`,
    [
      feed.source,
      feed.kind,
      feed.url,
      feed.minIntervalMinutes,
      feed.attribution?.required ?? false,
      feed.attribution?.text ?? null,
      feed.attribution?.url ?? null,
    ],
  );

  const row = rows[0];
  console.log(
    `${row?.inserted ? "added  " : "updated"} ${feed.source.padEnd(16)} every ${String(feed.minIntervalMinutes).padStart(3)} min` +
      (feed.attribution?.required ? `  attribution: "${feed.attribution.text}"` : ""),
  );
}

await pool.end();
