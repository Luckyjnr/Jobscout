"use server";

import { pool } from "./db";
import { STATUSES } from "./pipeline";

const DECISIONS = new Set(["interested", "rejected"]);

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * These deliberately do not call revalidatePath. The queue is held and mutated
 * on the client, optimistically; revalidating would refetch and re-render the
 * whole list on every keypress, which is the jank this rebuild exists to avoid.
 * A reload reads the server state, which is always the truth.
 */
function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * A decision is made on the role, so it lands on every posting in the group —
 * otherwise the same job reappears in the queue under a different city.
 */
export async function decide(fingerprint: string, decision: string): Promise<ActionResult> {
  if (!fingerprint) return { ok: false, error: "no fingerprint" };
  if (!DECISIONS.has(decision)) return { ok: false, error: `unknown decision "${decision}"` };

  try {
    await pool().query(
      `insert into decisions (job_id, decision)
       select id, $2 from jobs where fingerprint = $1
       on conflict (job_id) do update
          set decision = excluded.decision, decided_at = now()`,
      [fingerprint, decision],
    );
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Undo — drops the decision on every posting of the role, back to the queue. */
export async function undecide(fingerprint: string): Promise<ActionResult> {
  if (!fingerprint) return { ok: false, error: "no fingerprint" };

  try {
    await pool().query(
      `delete from decisions where job_id in (select id from jobs where fingerprint = $1)`,
      [fingerprint],
    );
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveNote(fingerprint: string, note: string): Promise<ActionResult> {
  if (!fingerprint) return { ok: false, error: "no fingerprint" };

  try {
    await pool().query(
      `update decisions set note = $2
        where job_id in (select id from jobs where fingerprint = $1)`,
      [fingerprint, note.trim() === "" ? null : note.trim()],
    );
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const VALID = new Set<string>(STATUSES);

/**
 * Move a role along the application pipeline. `applied_at` is stamped the
 * first time the role reaches "applied" and left alone afterwards, so the date
 * records when you sent it rather than when you last dragged the card.
 * "Interested" and "Applying" both sit before sending, so both clear it.
 */
export async function setStatus(fingerprint: string, status: string): Promise<ActionResult> {
  if (!fingerprint) return { ok: false, error: "no fingerprint" };
  if (!VALID.has(status)) return { ok: false, error: `unknown status "${status}"` };

  try {
    await pool().query(
      `update decisions
          set status = $2,
              applied_at = case
                when $2 in ('interested', 'applying') then null
                when applied_at is null then now()
                else applied_at
              end
        where job_id in (select id from jobs where fingerprint = $1)`,
      [fingerprint, status],
    );
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
