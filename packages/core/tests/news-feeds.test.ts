import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { leftOutWhy, pairFeeds, parseFeed, storiesOf, type NewsFeedSpec, type NewsGuideRow } from "../src/news-feeds.js";

// what a live news show reported (docs/features/live.md, 2026-10-01): the networks' own feeds of the segments their shows aired, paired
// with the channel that carries the show; fixtures are the real feeds as read on 2026-10-01
const fx = (name: string) => readFileSync(new URL(`./fixtures/news/${name}`, import.meta.url), "utf8");

describe("what a live news show reported (news-feeds)", () => {
  it("CBS's Daily Report clips feed: a story a segment, each with its time and the network's own description", () => {
    const items = parseFeed(fx("cbs-daily-report-clips.xml"));
    expect(items.length).toBe(30);
    expect(items[0]!.title).toBe("Why Senate Democrats blocked a bill to limit lawmakers' stock trades");
    expect(items[0]!.link).toBe("https://www.cbsnews.com/video/why-senate-democrats-blocked-a-bill-to-limit-lawmakers-stock-trades/");
    expect(items[0]!.at).toBe(Date.parse("Wed, 30 Sep 2026 20:35:00 -0400"));
    expect(items[0]!.desc).toMatch(/^A bill that would have prohibited lawmakers/);
    expect(items.every((i) => leftOutWhy(i, {}) === null)).toBe(true);
  });

  it("a shopping segment and a full episode are left out by name; nothing else is", () => {
    const items = parseFeed(fx("cbs-mornings-clips.xml"));
    const deals = items.find((i) => /Deals/.test(i.title))!;
    expect(deals).toBeTruthy();
    expect(leftOutWhy(deals, {})).toBe("a shopping segment");
    expect(leftOutWhy({ title: "9/30: The Takeout with Major Garrett", link: "https://www.cbsnews.com/video/093026-the-takeout/", at: null, desc: "" }, {})).toBe("a full episode, not a story");
    expect(leftOutWhy({ title: "Senate reaches budget deal to avert shutdown", link: "https://www.cbsnews.com/video/x/", at: null, desc: "" }, {})).toBeNull();   // a story with the word in it stands (review 2026-10-02)
    expect(leftOutWhy({ title: "An argument", link: "https://www.nbcnews.com/think/opinion/x", at: null, desc: "" }, {})).toBe("an opinion piece");
    const stories = storiesOf(items, {});
    expect(stories.some((i) => /Deals/.test(i.title))).toBe(false);
    expect(stories.length).toBe(12);
    for (let k = 1; k < stories.length; k++) expect((stories[k - 1]!.at ?? 0) >= (stories[k]!.at ?? 0)).toBe(true);   // newest first
  });

  it("NBC's feed: only the NBC News Now segments (the '/now/video/' path) stand; the written articles are not the stream's", () => {
    const items = parseFeed(fx("nbc-news.xml"));
    expect(items.length).toBeGreaterThan(10);
    const spec = { only: "/now/video/" };
    const stories = storiesOf(items, spec);
    expect(stories.length).toBeGreaterThan(0);
    expect(stories.every((i) => i.link.includes("/now/video/"))).toBe(true);
    const article = items.find((i) => i.link.includes("/news/us-news/"))!;
    expect(leftOutWhy(article, spec)).toBe("not the stream's own segment");
  });

  it("a feed is paired with its channel by name, and with its show by the program on now; a show not on gives no group", () => {
    const specs: NewsFeedSpec[] = [
      { channel: "CBS News 24/7", show: "The Daily Report", feed: "https://www.cbsnews.com/latest/rss/daily-report-clips" },
      { channel: "CBS News 24/7", show: "CBS Evening News", feed: "https://www.cbsnews.com/latest/rss/evening-news" },
      { channel: "48 Hours", feed: "https://www.cbsnews.com/latest/rss/48-hours" },   // a pairing without a show: the channel's feed stands whatever is on (not shipped for CBS's rerun channels)
      { channel: "NBC News Now", feed: "https://feeds.nbcnews.com/nbcnews/public/news", only: "/now/video/" },
      { channel: "Sky News", feed: "http://insecure.example/feed" },
    ];
    const rows: NewsGuideRow[] = [
      { id: "cbsn", name: "CBS News 24/7", service: "Paramount+", app: "paramountplus", facet: "p", now: "The Daily Report" },
      { id: "48h", name: "48 Hours", service: "Paramount+", app: "paramountplus", facet: "p", now: "48 Hours on ID" },
      { id: "nbcnow", name: "NBC NEWS NOW", service: "Peacock", app: "peacock", facet: "q", now: null },
      { id: "sky", name: "Sky News", service: "Peacock", app: "peacock", facet: "q", now: null },
    ];
    const p = pairFeeds(specs, rows);
    expect(p.map((x) => [x.name, x.row.id])).toEqual([["The Daily Report", "cbsn"], ["48 Hours", "48h"], ["NBC NEWS NOW", "nbcnow"]]);
    // the Evening News on now instead: its feed, not the Daily Report's
    const later = pairFeeds(specs, rows.map((r) => (r.id === "cbsn" ? { ...r, now: "CBS Evening News with John Dickerson" } : r)));
    expect(later.map((x) => x.name)).toEqual(["CBS Evening News", "48 Hours", "NBC NEWS NOW"]);
    // a channel not in the guide (its service not signed in): no group
    expect(pairFeeds(specs, rows.filter((r) => r.app !== "peacock")).map((x) => x.name)).toEqual(["The Daily Report", "48 Hours"]);
  });
});

describe("a station's feed (Local mode, 2026-10-02)", () => {
  it("NBC Boston's local feed parses (its <item > tags carry a space; its dates are 'Fri, Oct 02 2026 06:33:27 -0400'), and only its local stories stand", () => {
    const items = parseFeed(fx("nbc-boston-local.xml"));
    expect(items.length).toBe(50);
    expect(items[0]!.at).not.toBeNull();
    const stories = storiesOf(items, { only: "/news/local/" });
    expect(stories.length).toBeGreaterThan(5);
    expect(stories.every((i) => i.link.includes("/news/local/"))).toBe(true);
    expect(items.some((i) => i.link.includes("/news/sports/"))).toBe(true);   // in the feed, left out of the strip
  });
});
