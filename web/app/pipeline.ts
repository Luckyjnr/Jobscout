/**
 * Shared pipeline vocabulary, kept out of db.ts so client components can
 * import it without dragging `pg` into the browser bundle.
 */
export const STATUSES = ["interested", "applying", "applied", "interview", "offer", "rejected"] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_META: Record<Status, { label: string; colour: string; blurb: string }> = {
  interested: { label: "Interested", colour: "#94A3B8", blurb: "Jobs you are thinking about." },
  applying: { label: "Applying", colour: "#3D8BFF", blurb: "Getting your application ready." },
  applied: { label: "Applied", colour: "#A78BFA", blurb: "Sent and waiting to hear back." },
  interview: { label: "Interview", colour: "#22D3EE", blurb: "You made it to interviews." },
  offer: { label: "Offer", colour: "#34D399", blurb: "Offers on the table." },
  rejected: { label: "Rejected", colour: "#F87171", blurb: "Closed opportunities." },
};

export const STATUS_LABELS: Record<Status, string> = Object.fromEntries(
  (Object.keys(STATUS_META) as Status[]).map((key) => [key, STATUS_META[key].label]),
) as Record<Status, string>;
