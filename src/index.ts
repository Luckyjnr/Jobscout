import { migrate, pool, upsertJobs } from "./db.js";
import { fetchRemoteOkWithStats } from "./sources/remoteok.js";

async function main(): Promise<void> {
  await migrate();

  const { jobs, fetched, skipped } = await fetchRemoteOkWithStats();
  const { inserted, updated } = await upsertJobs(jobs);

  console.log(`fetched   ${fetched}`);
  console.log(`skipped   ${skipped}`);
  console.log(`inserted  ${inserted}`);
  console.log(`updated   ${updated}`);
}

try {
  await main();
} finally {
  await pool.end();
}
