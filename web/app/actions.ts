"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";

const DECISIONS = new Set(["interested", "rejected"]);

/**
 * A decision is made on the role, so it lands on every posting in the group —
 * otherwise the same job reappears in the queue under a different city.
 */
export async function decide(formData: FormData): Promise<void> {
  const fingerprint = String(formData.get("fingerprint") ?? "");
  const decision = String(formData.get("decision") ?? "");

  if (!fingerprint) throw new Error("no fingerprint");
  if (!DECISIONS.has(decision)) throw new Error(`unknown decision "${decision}"`);

  await pool().query(
    `insert into decisions (job_id, decision)
     select id, $2 from jobs where fingerprint = $1
     on conflict (job_id) do update
        set decision = excluded.decision, decided_at = now()`,
    [fingerprint, decision],
  );

  revalidatePath("/");
}

/** Undo — drops the decision on every posting of the role, back to the queue. */
export async function undecide(formData: FormData): Promise<void> {
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!fingerprint) throw new Error("no fingerprint");

  await pool().query(
    `delete from decisions
      where job_id in (select id from jobs where fingerprint = $1)`,
    [fingerprint],
  );

  revalidatePath("/");
}

export async function saveNote(formData: FormData): Promise<void> {
  const fingerprint = String(formData.get("fingerprint") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!fingerprint) throw new Error("no fingerprint");

  await pool().query(
    `update decisions set note = $2
      where job_id in (select id from jobs where fingerprint = $1)`,
    [fingerprint, note === "" ? null : note],
  );

  revalidatePath("/");
}
