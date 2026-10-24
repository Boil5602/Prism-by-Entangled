import { describe, expect, it } from "vitest";
import { CATEGORY_RULES, cleanCategory, cleanTag, creatorTags, keywordsOf, matches, orderCategory, pageInfoOf, poolWords, popularTags, publishedAt, recordingAsLive, withinDays, wordsOf, type CategoryCard } from "../src/categories.js";
import { topArticles } from "../src/most-read.js";

// Categories of the person's own (2026-10-11): hashtags and one clear rule, across services, from what Prism already lists.
describe("categories by hashtags, with a clear rule (categories.ts)", () => {
  const item = (title: string, subtitle: string | null = null, extra: Partial<CategoryCard["item"]> = {}) => ({ id: title, title, kind: "video", url: null, artwork: null, subtitle, progress: null, ...extra });
  const card = (app: string, title: string, subtitle: string | null = null): CategoryCard => ({ app, service: app, facet: app + "-f", item: item(title, subtitle) });

  it("a past video still being recorded (the service's processing picture) is the channel live now, not a card without a picture", () => {
    const mark = "/_404/404_processing";
    const rec: CategoryCard = { app: "twitch", service: "Twitch", facet: "twitch-f", readAt: 1, item: item("Ship Happens!", "k1ng", { id: "29", kind: "video", url: "https://www.twitch.tv/k1ng/video/29", artwork: "https://vod-secure.twitch.tv/_404/404_processing_214x120.png", channel: "k1ng", channelUrl: "https://www.twitch.tv/k1ng" }) };
    const live = recordingAsLive(rec, mark);
    expect(live.item).toMatchObject({ kind: "live", badge: "LIVE", title: "k1ng", subtitle: "Ship Happens!", url: "https://www.twitch.tv/k1ng", artwork: null });
    expect(live.readAt).toBe(1);
    // a finished video keeps its card; a service with no mark changes nothing
    const done: CategoryCard = { ...rec, item: { ...rec.item, artwork: "https://static-cdn.jtvnw.net/cf_vods/x/thumb/thumb0-214x120.jpg" } };
    expect(recordingAsLive(done, mark)).toBe(done);
    expect(recordingAsLive(rec, undefined)).toBe(rec);
    // a household card only when the service's rows say it is still on (a broadcast that ended keeps the picture on Twitch)
    const own: CategoryCard = { ...rec, readAt: undefined };
    expect(recordingAsLive(own, mark)).toBe(own);
    expect(recordingAsLive({ ...own, item: { ...own.item, live: true } }, mark).item.kind).toBe("live");
  });

  it("a #tag keeps its # and a plain word has none, lowercase; a category needs at least one; one saved before 2026-10-12 is read as #tags", () => {
    expect(cleanTag(" #Space ")).toBe("#space");
    expect(cleanTag("#F1!")).toBe("#f1");
    expect(cleanTag("Star Trek")).toBe("startrek");
    expect(cleanTag("")).toBe("");
    expect(cleanCategory({ id: "space", name: " Space  stuff ", tags: ["#Space", "nasa", "", "#space"], rule: "newest", v: 2 })).toEqual({ id: "space", name: "Space stuff", tags: ["#space", "nasa"], rule: "newest", pool: false, v: 2 });
    expect(cleanCategory({ id: "old", tags: ["startrek", "#funny"], rule: "newest" })!.tags).toEqual(["#startrek", "#funny"]);
    expect(cleanCategory({ id: "x", tags: [] })).toBeNull();
    expect(cleanCategory({ id: "Bad Id", tags: ["a"] })).toBeNull();
    expect(cleanCategory({ id: "unnamed", tags: ["cooking"], rule: "nonsense", v: 2 })).toEqual({ id: "unnamed", name: "cooking", tags: ["cooking"], rule: "newest", pool: false, v: 2 });
  });

  it("a plain word matches the words of a name or its line under, as a whole word; a #tag matches only what creators tagged (2026-10-12)", () => {
    expect(wordsOf(item("NASA's SpaceX Crew-13 Mission #space", "NASA · 1:02 · 11d ago"))).toContain("space");
    expect(wordsOf(item("NASA's SpaceX Crew-13 Mission #space", "NASA · 1:02"))).toContain("nasa's");
    const c = { tags: ["space", "cooking"] };
    expect(matches(c, item("A Quiet Orchard", "Food Network · cooking show"))).toBe(true);
    expect(matches(c, item("Spacewalk highlights", "NASA"))).toBe(false);   // "spacewalk" is not the word "space"
    expect(matches(c, item("The #Space Report", null))).toBe(true);
    expect(matches({ tags: [] }, item("anything"))).toBe(false);
    // Paramount+ writes no hashtags: a #startrek category takes a Twitch stream its creator tagged, not a show named Star Trek
    const st = { tags: ["#startrek"] };
    expect(matches(st, item("Star Trek: Lower Decks", "Paramount+"))).toBe(false);
    expect(matches(st, item("Fleet Command night", "Twitch", { tags: ["StarTrek", "English"] }))).toBe(true);
    expect(matches(st, item("The #StarTrek watch party", null))).toBe(true);
    expect(matches({ tags: ["startrek"] }, item("Star Trek: Lower Decks", "Paramount+"))).toBe(true);   // the plain word takes the name
  });

  it("the service's own 'N ago' is read as a time", () => {
    const now = Date.UTC(2026, 9, 11, 12);
    expect(publishedAt("NASA · 3 days ago", now)).toBe(now - 3 * 86_400_000);
    expect(publishedAt("2 weeks ago", now)).toBe(now - 14 * 86_400_000);
    expect(publishedAt("schmoyoho · 6y ago", now)).toBe(now - 6 * 365 * 86_400_000);
    expect(publishedAt("Streamed 4 hours ago", now)).toBe(now - 4 * 3_600_000);
    expect(publishedAt("3:59", now)).toBeNull();
  });

  it("newest first by the date beside each, undated last; watched by this PC's own log; A to Z by name; the service's order kept", () => {
    const now = Date.UTC(2026, 9, 11, 12);
    const cards = [card("yt", "Old one", "1 year ago"), card("yt", "Undated"), card("tw", "Fresh one", "2 hours ago"), card("yt", "Middle", "3 days ago")];
    expect(orderCategory("newest", cards, [], now).map((c) => c.item.title)).toEqual(["Fresh one", "Middle", "Old one", "Undated"]);
    expect(orderCategory("newest", cards, [], now)[0]!.lens).toEqual({ label: "Content creator \u00b7 2 hours ago" });   // the helper's items are videos
    // across services (2026-10-12): a live stream is now and says so; a creator's title says what it is beside its date; a series says no more
    const mixed = [{ ...card("paramountplus", "Lower Decks"), item: { ...card("paramountplus", "Lower Decks").item, kind: "series", subtitle: "S5 E1 \u00b7 3 days ago" } }, { ...card("youtube", "A video", "Chan \u00b7 12:00 \u00b7 5 hours ago"), item: { ...card("youtube", "A video").item, kind: "video", subtitle: "Chan \u00b7 12:00 \u00b7 5 hours ago" } }, { ...card("twitch", "A stream"), item: { ...card("twitch", "A stream").item, kind: "live", subtitle: "Live \u00b7 Science & Technology" } }];
    const o = orderCategory("newest", mixed, [], now);
    expect(o.map((c) => c.item.title)).toEqual(["A stream", "A video", "Lower Decks"]);
    expect(o.map((c) => c.lens?.label ?? null)).toEqual(["Content creator \u00b7 Live now", "Content creator \u00b7 5 hours ago", "3 days ago"]);
    // a pool stream read three hours ago is not said to be live any more (2026-10-13, "if they're not actually live, they shouldn't show up in that
    // list"): its word says so, and it orders as of its read; one read a minute ago is live
    const stale = { ...card("twitch", "Old stream"), readAt: now - 3 * 3_600_000, item: { ...card("twitch", "Old stream").item, kind: "live" } };
    const fresh = { ...card("twitch", "New stream"), readAt: now - 60_000, item: { ...card("twitch", "New stream").item, kind: "live" } };
    const o2 = orderCategory("newest", [stale, card("yt", "A video", "2 hours ago"), fresh], [], now);
    expect(o2.map((c) => c.item.title)).toEqual(["New stream", "A video", "Old stream"]);
    expect(o2.map((c) => c.lens?.label ?? null)).toEqual(["Content creator \u00b7 Live now", "Content creator \u00b7 2 hours ago", "Content creator \u00b7 was live"]);
    const log = [{ app: "yt", id: "Middle", title: "Middle", at: now - 60_000 }, { app: "yt", title: "Old one", at: now - 86_400_000 }];
    expect(orderCategory("watched", cards, log, now).map((c) => c.item.title)).toEqual(["Middle", "Old one", "Undated", "Fresh one"]);
    expect(orderCategory("watched", cards, log, now)[2]!.lens).toBeNull();
    expect(orderCategory("az", cards, [], now).map((c) => c.item.title)).toEqual(["Fresh one", "Middle", "Old one", "Undated"]);
    expect(orderCategory("service", cards, [], now).map((c) => c.item.title)).toEqual(["Old one", "Undated", "Fresh one", "Middle"]);
    expect(CATEGORY_RULES.map((r) => r.id)).toEqual(["newest", "watched", "az", "service"]);
    for (const r of CATEGORY_RULES) for (const k of ["counted", "who", "decides", "source", "formula", "simple", "sourceShort"] as const) expect(r[k].length).toBeGreaterThan(10);
  });

  it("popular hashtags are the words that recur across the household's own rows, a literal #hashtag counting double, no stop words", () => {
    const items = [item("Cooking with fire #cooking"), item("Slow cooking Sunday", "Food Network"), item("The new episode", "Food Network"), item("Rocket cooking? #space"), item("Space station tour", "NASA")];
    const tags = popularTags(items);
    expect(tags[0]).toEqual({ tag: "cooking", n: 4 });
    expect(tags.find((t) => t.tag === "space")).toEqual({ tag: "space", n: 3 });
    expect(tags.find((t) => t.tag === "food")).toEqual({ tag: "food", n: 2 });
    expect(tags.some((t) => t.tag === "the" || t.tag === "new" || t.tag === "episode")).toBe(false);
    expect(tags.some((t) => t.tag === "fire")).toBe(false);   // once is not popular
    expect(popularTags([item("One", "TV-14 \u00B7 2023"), item("Two", "TV-14 \u00B7 2021"), item("Three", "PG-13")]).some((t) => t.tag === "tv-14")).toBe(false);   // a rating is not a subject
  });

  // the open pool (2026-10-11, "I don't want to promote the online echo chambers")
  it("a hashtag has no spaces, so two or three words in a row carry it too; a pool category is kept; the pool row's lines take the hashtags", () => {
    expect(wordsOf(item("Taylor Swift: The Eras Tour", "Disney+"))).toContain("taylorswift");
    expect(wordsOf(item("The James Webb Space Telescope", null))).toContain("jameswebbspace");
    expect(matches({ tags: ["erastour"] }, item("Taylor Swift: The Eras Tour"))).toBe(true);
    expect(cleanCategory({ id: "p", tags: ["space"], pool: true })!.pool).toBe(true);
    expect(cleanCategory({ id: "p", tags: ["space"], pool: "yes" })!.pool).toBe(false);
    const w = poolWords({ name: "new on YouTube", counted: "The videos listed for {tags}.", who: "Everyone.", decides: "YouTube.", source: "Its page." }, ["space", "#nasa"]);
    expect(w.counted).toBe("The videos listed for #space #nasa.");
    expect(w.name).toBe("new on YouTube");
  });

  // tags creators wrote (2026-10-11, "Follow recommendations")
  it("a creator's tags are words of the title, counted one a title; a title's public page gives its keywords; the window counts dated titles only", () => {
    const tagged = { ...item("Late stream", "hasanabi · Just Chatting"), tags: ["politics", "English", "Just Chatting", "DropsEnabled"] };
    expect(wordsOf(tagged)).toContain("justchatting");
    expect(matches({ tags: ["politics"] }, tagged)).toBe(true);
    const counted = creatorTags([tagged, { ...item("Other #Politics"), tags: ["space", "60", "TV-14"] }, item("Untagged"), item("A dad joke #funny #dad #60")]);
    expect(counted[0]).toEqual({ tag: "politics", n: 2 });
    expect(counted.some((t) => t.tag === "english")).toBe(true);
    expect(counted.find((t) => t.tag === "funny")).toEqual({ tag: "funny", n: 1 });   // a hashtag the creator wrote in the title counts as theirs
    expect(counted.some((t) => t.tag === "60" || t.tag === "tv-14")).toBe(false);   // a number or a rating is not a tag
    expect(keywordsOf('<html><head><meta name="keywords" content="the moon, nasa, NASA Artemis, Tom &amp; Jerry, x"></head></html>')).toEqual(["themoon", "nasa", "nasaartemis", "tomjerry"]);
    expect(keywordsOf("<html></html>")).toEqual([]);
    expect(keywordsOf('<meta name="keywords" content="video, sharing, camera phone, video phone, free, upload">')).toEqual([]);   // YouTube's words for a video with no tags
    const now = Date.UTC(2026, 9, 11, 12);
    expect(withinDays(item("New", "NASA · 3 days ago"), 30, now)).toBe(true);
    expect(withinDays(item("Old", "NASA · 2 months ago"), 30, now)).toBe(false);
    expect(withinDays(item("Undated", "NASA"), 30, now)).toBe(false);
  });

  it("a video's public page says its channel, its address, its words, its length and its date (2026-10-11)", () => {
    const html = '<html><head><meta name="description" content="Why are two nations racing &amp; landing?"><meta name="keywords" content="the moon, nasa"><link itemprop="name" content="The Space Race"></head>'
      + '<body><script>{"lengthSeconds":"1232","ownerProfileUrl":"http://www.youtube.com/@TheSpaceRaceYT","publishDate":"2026-10-10T12:00:37-07:00"}</script></body></html>';
    expect(pageInfoOf(html)).toEqual({ tags: ["themoon", "nasa"], channel: "The Space Race", channelUrl: "https://www.youtube.com/@TheSpaceRaceYT", description: "Why are two nations racing & landing?", length: 1232, published: "2026-10-10" });
    expect(pageInfoOf("<html></html>")).toEqual({ tags: [], channel: null, channelUrl: null, description: null, length: null, published: null });
  });

  it("the topics the world read: a day's top list as readable names, the pages that are never a subject left out", () => {
    const json = { items: [{ articles: [{ article: "Main_Page", rank: 1 }, { article: "Special:Search", rank: 2 }, { article: "Sinners_(2025_film)", rank: 3 }, { article: "Taylor_Swift", rank: 4 }, { article: "XNXX", rank: 5 }, { article: "List_of_highest-grossing_films", rank: 6 }, { article: "Deaths_in_2026", rank: 7 }, { article: "Diane_Keaton", rank: 8 }] }] };
    expect(topArticles(json)).toEqual(["Sinners", "Taylor Swift", "Diane Keaton"]);
    expect(topArticles(json, 2)).toEqual(["Sinners", "Taylor Swift"]);
    expect(topArticles(null)).toEqual([]);
  });
});
