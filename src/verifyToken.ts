import { fetchJson, HttpError } from "./http.js";
import { AshbyResponse, ashbyUrl } from "./sources/ashby.js";
import { GreenhouseResponse, greenhouseUrl } from "./sources/greenhouse.js";
import { leverUrl } from "./sources/lever.js";

export type Ats = "greenhouse" | "lever" | "ashby";

export const SUPPORTED_ATS: readonly Ats[] = ["greenhouse", "lever", "ashby"];

export type VerifyResult = {
  ok: boolean;
  /** how many postings the board currently has, when it exists */
  count?: number;
  error?: string;
};

/** Lever answers a bad slug with 200-shaped JSON in some deployments. */
function isNotFoundBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok?: unknown }).ok === false
  );
}

/**
 * One request per call. A board that does not exist is a wrong token, reported
 * as { ok: false }, not an exception — only transport trouble and unexpected
 * shapes are surfaced as errors the caller might want to retry.
 *
 * Note an empty board is a valid one: both APIs answer 200 with zero postings
 * for a real token whose roles are all closed, so { ok: true, count: 0 }.
 */
export async function verifyToken(ats: Ats, token: string): Promise<VerifyResult> {
  const url =
    ats === "greenhouse"
      ? greenhouseUrl(token, false)
      : ats === "ashby"
        ? ashbyUrl(token, false)
        : leverUrl(token);

  let body: unknown;
  try {
    body = await fetchJson(url);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 404) {
        return { ok: false, error: `no ${ats} board for token "${token}" (404)` };
      }
      return { ok: false, error: `request failed: ${err.message}` };
    }
    return { ok: false, error: `request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (isNotFoundBody(body)) {
    const message = (body as { error?: unknown }).error;
    return {
      ok: false,
      error: `no ${ats} board for token "${token}" (${typeof message === "string" ? message : "not found"})`,
    };
  }

  if (ats === "greenhouse") {
    const parsed = GreenhouseResponse.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: "unexpected greenhouse response shape" };
    }
    return { ok: true, count: parsed.data.meta?.total ?? parsed.data.jobs.length };
  }

  if (ats === "ashby") {
    const parsed = AshbyResponse.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: "unexpected ashby response shape" };
    }
    return { ok: true, count: parsed.data.jobs.length };
  }

  if (!Array.isArray(body)) {
    return { ok: false, error: "unexpected lever response shape" };
  }
  return { ok: true, count: body.length };
}
