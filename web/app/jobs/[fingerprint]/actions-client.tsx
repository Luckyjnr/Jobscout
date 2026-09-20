"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decide, saveNote, setStatus, undecide } from "../../actions";
import { STATUSES, STATUS_LABELS, type Status } from "../../pipeline";

/**
 * The only interactive part of the detail page, so the page itself stays a
 * server component and the description never reaches the client bundle twice.
 */
export function DetailActions({
  fingerprint,
  decision,
  status,
  note,
}: {
  fingerprint: string;
  decision: string | null;
  status: Status | null;
  note: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? "failed");
      else {
        setError(null);
        router.refresh();
      }
    });

  return (
    <>
      {decision === "interested" ? (
        <>
          <select
            className="field mono"
            style={{ width: "auto" }}
            value={status ?? "interested"}
            disabled={pending}
            onChange={(event) => run(() => setStatus(fingerprint, event.target.value))}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <button className="btn quiet" disabled={pending} onClick={() => run(() => undecide(fingerprint))}>
            Undo
          </button>
        </>
      ) : (
        <>
          <button className="btn quiet" disabled={pending} onClick={() => run(() => decide(fingerprint, "rejected"))}>
            Not for me
          </button>
          <button
            className="btn primary"
            disabled={pending}
            onClick={() => run(() => decide(fingerprint, "interested"))}
          >
            Interested
          </button>
        </>
      )}

      {decision === "interested" ? (
        <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 10 }}>
          <input
            className="field"
            placeholder="Add a note…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            className="btn ghost"
            disabled={pending || text === (note ?? "")}
            onClick={() => run(() => saveNote(fingerprint, text))}
          >
            Save
          </button>
        </div>
      ) : null}

      {error ? <span className="pill danger">{error}</span> : null}
    </>
  );
}
