"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decide, setStatus, undecide } from "../../actions";

/**
 * Save and Apply. Both write a real decision; Apply also opens the posting,
 * because you cannot apply anywhere but on the board itself — the button
 * records that you went, it does not pretend to submit anything.
 *
 * The window is opened before the await so it is still inside the click
 * gesture and does not trip the popup blocker.
 */
export function HeaderActions({
  fingerprint,
  url,
  decision,
  status,
}: {
  fingerprint: string;
  url: string;
  decision: string | null;
  status: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const saved = decision === "interested";
  const applied = saved && status !== null && status !== "interested";

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
    <div className="job-head-acts">
      <button
        className="btn ghost"
        disabled={pending}
        onClick={() => run(() => (saved ? undecide(fingerprint) : decide(fingerprint, "interested")))}
      >
        {saved ? "★ Saved" : "☆ Save"}
      </button>

      <a className="btn ghost" href={url} target="_blank" rel="noreferrer">
        Original ↗
      </a>

      <button
        className="btn primary"
        disabled={pending || applied}
        onClick={() => {
          window.open(url, "_blank", "noopener,noreferrer");
          run(async () => {
            const first = await decide(fingerprint, "interested");
            if (!first.ok) return first;
            return setStatus(fingerprint, "applying");
          });
        }}
      >
        {applied ? "In your pipeline" : "Apply now"}
      </button>

      {error ? <span className="pill danger">{error}</span> : null}
    </div>
  );
}
