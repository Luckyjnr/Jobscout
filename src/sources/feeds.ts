import type { FeedMapping } from "./rss.js";

/**
 * The four job feeds we read, as field maps over the generic adapter.
 *
 * Field names below were read off the live feeds, not guessed. Two notes worth
 * carrying: HotNigerianJobs serves a second feed at /rss.xml that is a dead
 * stub (one item, dated 2021) — /feed/rss is the live one with ~600 items; and
 * Jobicy asks in its own legal notice to be polled only "a few times daily",
 * which is what minIntervalMinutes encodes.
 */
export const FEEDS: FeedMapping[] = [
  {
    source: "myjobmag",
    url: "https://www.myjobmag.com/aggregate_feed.xml",
    kind: "rss",
    minIntervalMinutes: 15,
    fields: {
      sourceId: ["id", "guid", "link"],
      title: ["position", "title"],
      url: ["link"],
      company: ["company"],
      location: ["location", "city_area", "region"],
      // two different texts: description is about the role (~110 chars),
      // introduction is about the employer (~390). Both are worth scoring on.
      description: ["description"],
      descriptionExtra: ["introduction"],
      descriptionIsHtml: true,
      postedAt: ["pubDate"],
      // the field is in the schema but empty on all 100 items today; mapped
      // anyway so it starts working the day they populate it
      salary: ["salary"],
      employmentType: ["contract", "working_hours"],
    },
  },
  {
    source: "hotnigerianjobs",
    // NOT /rss.xml — that one is a stub with a single 2021 item
    url: "https://www.hotnigerianjobs.com/feed/rss",
    kind: "rss",
    minIntervalMinutes: 15,
    fields: {
      sourceId: ["guid", "link"],
      title: ["title"],
      url: ["link"],
      // no employer field in this feed; titles read "<role> at <employer>".
      // <category> exists but is empty on every item, so there is no location.
      companyFromTitle: true,
      description: ["description"],
      descriptionIsHtml: true,
      postedAt: ["pubDate"],
    },
  },
  {
    source: "jobzilla",
    url: "https://www.jobzilla.ng/feed",
    kind: "rss",
    minIntervalMinutes: 15,
    fields: {
      sourceId: ["guid", "link"],
      title: ["title"],
      url: ["link"],
      companyFromTitle: true,
      description: ["description"],
      descriptionIsHtml: true,
      postedAt: ["pubDate"],
    },
  },
  {
    source: "jobicy",
    url: "https://jobicy.com/api/v2/remote-jobs",
    kind: "json",
    itemsPath: "jobs",
    // their legal notice: "a few times daily is sufficient for most
    // integrations, and excessive querying may result in temporary access
    // restrictions"
    minIntervalMinutes: 240,
    attribution: {
      required: true,
      text: "Jobs from Jobicy",
      url: "https://jobicy.com",
    },
    remote: true, // the whole board is remote
    fields: {
      sourceId: ["id"],
      title: ["jobTitle"],
      url: ["url"],
      company: ["companyName"],
      location: ["jobGeo"],
      description: ["jobDescription", "jobExcerpt"],
      descriptionIsHtml: true,
      postedAt: ["pubDate"],
      employmentType: ["jobType"],
    },
  },
];

export const FEED_BY_NAME = new Map(FEEDS.map((feed) => [feed.source, feed]));
