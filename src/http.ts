// Identify the client to every board we call. Remote OK's terms ask for it
// outright, and it is the courteous default everywhere else.
// Put a real contact URL or address in here before running this often.
export const USER_AGENT = "jobscout/0.1 (job search agent; contact: set-me@example.com)";

/** Both ATS boards declare Crawl-delay: 1 in robots.txt. */
export const CRAWL_DELAY_MS = 1000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A request that came back, but not with a 2xx. Carries the status for callers. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly statusText: string,
  ) {
    super(`GET ${url} returned ${status} ${statusText}`);
    this.name = "HttpError";
  }
}

/** Same rules as fetchJson, for feeds that serve XML. */
export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml, text/xml" },
  });

  if (!response.ok) {
    throw new HttpError(response.status, url, response.statusText);
  }

  return response.text();
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });

  if (!response.ok) {
    throw new HttpError(response.status, url, response.statusText);
  }

  return response.json();
}
