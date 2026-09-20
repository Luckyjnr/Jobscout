import { attributions, interestedRows, queueRows, totals } from "../db";
import { Review } from "../review";

export const dynamic = "force-dynamic";

/**
 * The server reads; the client filters. Both lists load once and all filtering,
 * counting and deciding happens in the browser, so a keystroke never waits on
 * Postgres. Decisions write back through server actions.
 */
export default async function Page() {
  const [queue, interested, tally, credits] = await Promise.all([
    queueRows(),
    interestedRows(),
    totals(),
    attributions(),
  ]);

  return <Review queue={queue} interested={interested} totals={tally} attributions={credits} />;
}
