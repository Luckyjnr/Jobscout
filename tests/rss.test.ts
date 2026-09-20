import { describe, expect, it, vi } from "vitest";
import { splitTitleAtCompany } from "../src/sources/rss.js";

describe("splitTitleAtCompany", () => {
  it("splits a role from its employer", () => {
    expect(splitTitleAtCompany("Investment Analyst at Rising Tide Africa")).toEqual({
      title: "Investment Analyst",
      company: "Rising Tide Africa",
    });
  });

  it("drops a trailing opening count from the employer", () => {
    expect(splitTitleAtCompany("E-Commerce Managers at Genesis Group (3 Openings)")).toEqual({
      title: "E-Commerce Managers",
      company: "Genesis Group",
    });
    expect(splitTitleAtCompany("Driver at Acme (2 Positions)").company).toBe("Acme");
  });

  it("keeps the whole string when there is no employer to find", () => {
    expect(splitTitleAtCompany("Massive Recruitment Exercise")).toEqual({
      title: "Massive Recruitment Exercise",
      company: null,
    });
  });

  it("splits on the first 'at', keeping the rest as the employer", () => {
    // "Head of Data at Acme at Scale" is one employer, not two splits
    expect(splitTitleAtCompany("Head of Data at Acme at Scale")).toEqual({
      title: "Head of Data",
      company: "Acme at Scale",
    });
  });

  it("does not split inside a word", () => {
    expect(splitTitleAtCompany("Database Administrator").company).toBeNull();
  });
});

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Feed</title>
  <item>
    <id>42</id>
    <position>Backend Engineer</position>
    <title>Backend Engineer at Acme</title>
    <company>Acme Ltd</company>
    <location>Lagos</location>
    <description><![CDATA[<p>Build <b>ledgers</b>.</p>]]></description>
    <introduction><![CDATA[Acme is a payments company.]]></introduction>
    <link>https://example.com/jobs/42</link>
    <pubDate>Wed, 17 Sep 2026 09:00:00 +0000</pubDate>
    <salary></salary>
  </item>
  <item>
    <title>Remote Data Analyst at Globex</title>
    <link>https://example.com/jobs/43</link>
    <pubDate>Wed, 17 Sep 2026 10:00:00 +0000</pubDate>
  </item>
  <item>
    <title>No link here</title>
  </item>
</channel></rss>`;

const JSON_FEED = JSON.stringify({
  jobs: [
    {
      id: 7,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
      jobGeo: "Anywhere",
      url: "https://example.com/7",
      jobDescription: "<p>Work on <i>payments</i>.</p>",
      pubDate: "2026-09-17T16:15:43+00:00",
    },
  ],
});

/** Swap fetch for a canned body so the mapping is what is under test. */
function stubFetch(body: string, type: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": type } })),
  );
}

describe("fetchFeedWithStats", () => {
  it("maps an RSS feed through the field map", async () => {
    stubFetch(RSS, "application/xml");
    const { fetchFeedWithStats } = await import("../src/sources/rss.js");

    const result = await fetchFeedWithStats({
      source: "test",
      url: "https://example.com/feed",
      kind: "rss",
      minIntervalMinutes: 15,
      fields: {
        sourceId: ["id", "guid", "link"],
        title: ["position", "title"],
        url: ["link"],
        company: ["company"],
        location: ["location"],
        description: ["description"],
        descriptionExtra: ["introduction"],
        descriptionIsHtml: true,
        postedAt: ["pubDate"],
        salary: ["salary"],
        companyFromTitle: true,
      },
    });

    expect(result.fetched).toBe(3);
    expect(result.skipped).toBe(1); // the item with no link
    expect(result.jobs).toHaveLength(2);

    const [first, second] = result.jobs;
    expect(first!.sourceId).toBe("42");
    expect(first!.title).toBe("Backend Engineer");
    expect(first!.company).toBe("Acme Ltd");
    expect(first!.location).toBe("Lagos");
    // both text fields, HTML stripped, joined
    expect(first!.description).toBe("Build ledgers.\n\nAcme is a payments company.");
    expect(first!.salaryText).toBeNull();
    expect(first!.postedAt?.toISOString()).toBe("2026-09-17T09:00:00.000Z");
    expect(first!.remote).toBe(false);

    // no company field on this one, so it comes out of the title
    expect(second!.title).toBe("Remote Data Analyst");
    expect(second!.company).toBe("Globex");
    expect(second!.sourceId).toBe("https://example.com/jobs/43");
    expect(second!.remote).toBe(true); // "Remote" in the title
  });

  it("maps a JSON feed with the same mapping shape", async () => {
    stubFetch(JSON_FEED, "application/json");
    const { fetchFeedWithStats } = await import("../src/sources/rss.js");

    const result = await fetchFeedWithStats({
      source: "jobicy",
      url: "https://example.com/api",
      kind: "json",
      itemsPath: "jobs",
      minIntervalMinutes: 240,
      remote: true,
      fields: {
        sourceId: ["id"],
        title: ["jobTitle"],
        url: ["url"],
        company: ["companyName"],
        location: ["jobGeo"],
        description: ["jobDescription"],
        descriptionIsHtml: true,
        postedAt: ["pubDate"],
      },
    });

    const job = result.jobs[0]!;
    expect(job.sourceId).toBe("7");
    expect(job.company).toBe("Initech");
    expect(job.description).toBe("Work on payments.");
    expect(job.remote).toBe(true);
    expect(job.fingerprint).toHaveLength(64);
    expect(job.postingFingerprint).toHaveLength(64);
  });

  it("falls back to the board name when a feed names no employer", async () => {
    stubFetch(
      `<?xml version="1.0"?><rss><channel><item><title>Massive Recruitment</title><link>https://x/1</link></item></channel></rss>`,
      "application/xml",
    );
    const { fetchFeedWithStats } = await import("../src/sources/rss.js");

    const result = await fetchFeedWithStats({
      source: "hotnigerianjobs",
      url: "https://example.com/feed",
      kind: "rss",
      minIntervalMinutes: 15,
      fields: { sourceId: ["link"], title: ["title"], url: ["link"], companyFromTitle: true },
    });

    expect(result.jobs[0]!.company).toBe("hotnigerianjobs");
    expect(result.jobs[0]!.postedAt).toBeNull();
  });
});
