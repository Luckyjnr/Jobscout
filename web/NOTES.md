- HotNigerianJobs: /rss.xml is a dead 2021 stub, /feed/rss has 600 fresh items.
  Site returns 200 with identical body for ALL unknown paths. Status codes useless.
- MyJobMag /feeds/ lists five feeds; URLs are in copy-buttons, not links.
  aggregate_feed.xml has the richest structure of any source found.
- BrighterMonday terms forbid data mining/screen scraping. Careers24 robots.txt
  names SimplePie (an RSS library) and disallows all. Both excluded.
- Jobicy asks for a few polls daily max, credit with direct link, apply links
  to original URL.
- OUR BUG: crawler treats anything not in the DB as new. A feed backfill or
  reorder surfaces stale jobs as fresh. Need a max-age guard.
