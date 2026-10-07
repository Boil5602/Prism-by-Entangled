import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { LENSES, LensResolver, orderByLens, ratingLabel, factsFor, looseKey, lensById, outboundLinks, titleCase, type TitleFacts } from "../src/lenses.js";
import type { MenuCard } from "../src/menu-order.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Lenses and ratings (docs/video-menu-spec.md §4a, 2026-09-20). Fixtures the work order names: no lens by default; the
// ordering is pure over its inputs (the rows and the lens's own data); no lens is named "trending"; a rating is never
// rendered without its source and vote count; TMDB is never called when no key is set; every lens carries its three
// layers, source, formula and data date on itself; nothing is fetched from anywhere but the named sources.

const card = (app: string, title: string): MenuCard => ({ app, service: app, facet: app, item: { id: app + ":" + title, title, kind: "title", url: null }, recency: { kind: "rank" } as MenuCard["recency"] });
const facts = (key: string, f: Partial<TitleFacts>): TitleFacts => ({ key, at: {}, ...f });

describe("the lenses themselves", () => {
  it("six (five in v1, and the newest-episodes row of 2026-09-22), none named trending, each with the three layers, a source, a one-sentence formula with the date, and only TMDB behind a key", () => {
    expect(LENSES.length).toBe(6);
    for (const l of LENSES) {
      expect(l.name.toLowerCase()).not.toContain("trending");
      expect(l.id.toLowerCase()).not.toContain("trending");
      for (const layer of [l.counted, l.who, l.decides, l.source, l.formula]) expect(layer.length).toBeGreaterThan(10);
      expect(l.formula).toContain("{date}");
      expect(l.formula.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
      expect(l.sourceUrl.startsWith("https://")).toBe(true);
      if (l.needsKey) { expect(l.needsKey).toBe("tmdb"); expect(l.attribution).toContain("TMDB"); } else expect(l.attribution).toBeUndefined();
    }
    expect(LENSES.slice(0, 3).every((l) => !l.needsKey)).toBe(true);   // the open sources first
    expect(lensById("trending")).toBeNull();
    expect(lensById(null)).toBeNull();
  });
});

describe("the order under a lens is pure over the rows and the lens's data", () => {
  const rows = [card("hulu", "Paradise"), card("netflix", "Dark"), card("tubi", "Dark Shadows"), card("hulu", "The Rookie")];
  const data = new Map<string, TitleFacts>([
    ["dark", facts("dark", { views7: { views: 120_000, through: "2026-09-19" }, awards: 3, released: "2017-12-01", at: { wikidata: 1_000, views: 1_000 }, rating: { mean: 8.7, votes: 14_213, at: 1_000 } })],
    ["rookie", facts("rookie", { views7: { views: 40_000, through: "2026-09-19" }, awards: 0, released: "2018-10-16", at: { wikidata: 1_000, views: 1_000 }, rating: { mean: 7.9, votes: 30, at: 1_000 } })],
    ["paradise", facts("paradise", { views7: { views: 40_000, through: "2026-09-18" }, at: { views: 1_000 } })],
  ]);
  it("no lens: the rows as they came (the default view is the person's own order)", () => {
    expect(orderByLens(rows, null, data).map((c) => c.item.title)).toEqual(["Paradise", "Dark", "Dark Shadows", "The Rookie"]);
  });
  it("Wikipedia reads: most first, ties in the rows' order, the unread last in their order; each card says its number, source and date", () => {
    const out = orderByLens(rows, lensById("wiki-reads"), data);
    expect(out.map((c) => c.item.title)).toEqual(["Dark", "Paradise", "The Rookie", "Dark Shadows"]);
    expect(out[0]!.lens).toEqual({ value: 120_000, label: "120k reads · Wikipedia · 7 days", date: "2026-09-19" });
    expect(out[3]!.lens).toBeNull();
    expect(orderByLens(rows, lensById("wiki-reads"), data)).toEqual(out);   // same inputs, same order
  });
  it("awards and release dates from Wikidata; TMDB's mean sorts under-fifty-vote titles after the rest; no data, no move", () => {
    expect(orderByLens(rows, lensById("wd-awards"), data).map((c) => c.item.title)).toEqual(["Dark", "The Rookie", "Paradise", "Dark Shadows"]);
    expect(orderByLens(rows, lensById("wd-newest"), data).map((c) => c.item.title)).toEqual(["The Rookie", "Dark", "Paradise", "Dark Shadows"]);
    const rated = orderByLens(rows, lensById("tmdb-rating"), data);
    expect(rated.map((c) => c.item.title)).toEqual(["Dark", "The Rookie", "Paradise", "Dark Shadows"]);
    expect(rated[0]!.lens?.label).toBe("★ 8.7 · TMDB · 14k votes");
    expect(orderByLens(rows, lensById("tmdb-votes"), data)[0]!.lens?.label).toBe("14k votes · TMDB");
    expect(orderByLens(rows, lensById("wiki-reads"), new Map()).map((c) => c.item.title)).toEqual(["Paradise", "Dark", "Dark Shadows", "The Rookie"]);
  });
  it("a rating is never a bare number: source and vote count always, or nothing", () => {
    expect(ratingLabel({ mean: 7.8, votes: 14_213 })).toBe("★ 7.8 · TMDB · 14k votes");
    expect(ratingLabel({ mean: 7.8, votes: 312 })).toBe("★ 7.8 · TMDB · 312 votes");
    expect(ratingLabel({ mean: 7.8, votes: 0 })).toBeNull();
    expect(ratingLabel(null)).toBeNull();
    const out = orderByLens(rows, null, data);
    expect(out.find((c) => c.item.title === "Dark")!.rating).toBe("★ 8.7 · TMDB · 14k votes");
    expect(out.find((c) => c.item.title === "Paradise")!.rating).toBeNull();
    for (const c of out) if (c.rating) expect(c.rating).toMatch(/^★ \d\.\d · TMDB · \S+ votes$/);
  });
  it("outbound links are navigation only: IMDb by its id, Letterboxd by its id or TMDB's; nothing without an id", () => {
    expect(outboundLinks(facts("x", { imdb: "tt5753856", letterboxd: "dark-2017" }))).toEqual([{ name: "IMDb", url: "https://www.imdb.com/title/tt5753856/" }, { name: "Letterboxd", url: "https://letterboxd.com/film/dark-2017/" }]);
    expect(outboundLinks(facts("x", { tmdb: { kind: "movie", id: 155 } }))).toEqual([{ name: "Letterboxd", url: "https://letterboxd.com/tmdb/155/" }]);
    expect(outboundLinks(undefined)).toEqual([]);
  });
});

describe("the resolver reads only the named sources, caches on the device, and never calls TMDB without a key", () => {
  const WIKI = JSON.stringify({ type: "standard", description: "German science fiction television series", titles: { canonical: "Dark_(TV_series)" }, wikibase_item: "Q23011009" });
  const VIEWS = JSON.stringify({ items: [{ views: 100 }, { views: 200 }, { views: 300 }] });
  const WD = JSON.stringify({ entities: { Q23011009: { claims: { P166: [{ mainsnak: {} }, { mainsnak: {} }], P577: [{ mainsnak: { datavalue: { value: { time: "+2017-12-01T00:00:00Z" } } } }], P345: [{ mainsnak: { datavalue: { value: "tt5753856" } } }], P4983: [{ mainsnak: { datavalue: { value: "70523" } } }] } } } });
  function rig(withKeyed: boolean) {
    const calls: string[] = []; const keyed: Array<{ url: string; headers: Record<string, string> }> = []; const store = new Map<string, string>();
    const hooks = {
      fetchStatic: async (url: string) => {
        calls.push(url);
        if (url.includes("/page/summary/Dark")) return url.includes("Dark_(TV_series)") || url.endsWith("/Dark") ? WIKI : JSON.stringify({ type: "disambiguation" });
        if (url.includes("/pageviews/")) return VIEWS;
        if (url.includes("Special:EntityData")) return WD;
        throw new Error("no such page");
      },
      ...(withKeyed ? { fetchKeyed: async (url: string, headers: Record<string, string>) => { keyed.push({ url, headers }); return JSON.stringify({ vote_average: 8.7, vote_count: 14213, external_ids: { imdb_id: "tt5753856" } }); } } : {}),
      store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
      dashId: () => "wall", now: () => Date.parse("2026-09-20T12:00:00Z"), paceMs: 0,   // the mock answers at once; a wall keeps Wikimedia's pace
    };
    return { calls, keyed, store, r: new LensResolver(hooks) };
  }
  it("a title listed in capitals is asked in title case first (2026-10-05, BLUE EYE SAMURAI and DANG! answered 404 on every candidate)", async () => {
    const { r, calls } = rig(false);
    r.ensure(["BLUE EYE SAMURAI", "DANG!"], ["wiki"], false);
    for (let i = 0; i < 100 && r.pending > 0; i++) await new Promise((res) => setTimeout(res, 20));   // real timers in this block; the mock answers at once
    const asked = calls.map((u) => decodeURIComponent(u.replace(/^.*page\/summary\//, "")));
    expect(asked[0]).toBe("Blue_Eye_Samurai");
    expect(asked.indexOf("Blue_Eye_Samurai_(TV_series)")).toBeLessThan(asked.indexOf("BLUE_EYE_SAMURAI"));   // the capitals still follow, last
    expect(asked).toContain("Dang!");
    expect(titleCase("STAR TREK: THE ORIGINAL SERIES")).toBe("Star Trek: The Original Series");
    expect(titleCase("LORD OF THE RINGS")).toBe("Lord of the Rings");
  });
  it("Wikipedia, then the pageviews and Wikidata, each cached under the wall's own keys; the second ask is answered from the cache", async () => {
    const { r, calls, store } = rig(false);
    r.ensure(["Dark"], ["wiki", "views", "wikidata"], false);
    expect(r.pending).toBe(1);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.pending).toBe(0);
    const f = r.factsOf().get("dark")!;
    expect(f).toMatchObject({ article: "Dark_(TV_series)", qid: "Q23011009", views7: { views: 600, through: "2026-09-19" }, awards: 2, released: "2017-12-01", imdb: "tt5753856", tmdb: { kind: "tv", id: 70523 } });
    expect(calls.every((u) => /^https:\/\/(en\.wikipedia\.org|wikimedia\.org|www\.wikidata\.org)\//.test(u))).toBe(true);
    expect(calls.some((u) => u.includes("?"))).toBe(false);   // static, unparameterized
    expect(calls.find((u) => u.includes("/pageviews/"))).toBe("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Dark_(TV_series)/daily/2026091300/2026091900");
    expect([...store.keys()].sort()).toEqual(["lens:views:wall:dark:Dark_(TV_series)", "lens:wiki3:wall:dark", "lens:wikidata:wall:dark:Q23011009"]);   // the reads and the item under the article / item they belong to (2026-09-22)
    const again = rig(false); for (const [k, v] of store) again.store.set(k, v);
    again.r.ensure(["Dark"], ["wiki", "views", "wikidata"], false);
    await new Promise((res) => setTimeout(res, 20));
    expect(again.calls).toEqual([]);
    expect(again.r.factsOf().get("dark")?.views7?.views).toBe(600);
  });
  it("TMDB is never called without a key; with the person's key it is called under their key alone, and the rating carries the vote count", async () => {
    const { r, keyed } = rig(true);
    r.ensure(["Dark"], ["wiki", "wikidata", "tmdb"], true);
    await new Promise((res) => setTimeout(res, 20));
    expect(keyed).toEqual([]);
    expect(r.factsOf().get("dark")?.rating ?? null).toBeNull();
    r.setKey("eyJhbGciOi.readtoken");
    r.ensure(["Dark"], [], true);
    await new Promise((res) => setTimeout(res, 20));
    // under a key: TMDB's word on which work this is first (its kind and year tell a remake from its namesake, 2026-09-22), then the details
    expect(keyed.length).toBe(2);
    expect(keyed[0]!.url).toBe("https://api.themoviedb.org/3/search/multi?query=Dark&include_adult=false");
    expect(keyed[1]!.url).toBe("https://api.themoviedb.org/3/tv/70523?append_to_response=external_ids");
    expect(keyed[1]!.headers).toEqual({ Authorization: "Bearer eyJhbGciOi.readtoken" });
    expect(ratingLabel(r.factsOf().get("dark")?.rating)).toBe("★ 8.7 · TMDB · 14k votes");
    r.setKey(null);
    expect(r.factsOf().get("dark")?.rating ?? null).toBeNull();   // the key gone, the numbers with it
  });
  it("a v3 key goes in the query string; a shell without the keyed call makes none", async () => {
    const { r, keyed } = rig(true);
    r.setKey("0123456789abcdef0123456789abcdef");
    r.ensure(["Dark"], [], true);
    await new Promise((res) => setTimeout(res, 20));
    expect(keyed[1]!.url).toBe("https://api.themoviedb.org/3/tv/70523?append_to_response=external_ids&api_key=0123456789abcdef0123456789abcdef");
    expect(keyed[1]!.headers).toEqual({});
    const bare = rig(false);
    bare.r.setKey("0123456789abcdef0123456789abcdef");
    bare.r.ensure(["Dark"], [], true);
    await new Promise((res) => setTimeout(res, 20));
    expect(bare.keyed).toEqual([]);
    expect(bare.calls.some((u) => u.includes("themoviedb"))).toBe(false);
  });
});

describe("a store's edition and a ratings-only ask (the owned library, 2026-09-22)", () => {
  function rig() {
    const calls: string[] = []; const keyed: string[] = []; const store = new Map<string, string>();
    const hooks = {
      fetchStatic: async (url: string) => { calls.push(url); throw new Error("no such page"); },
      fetchKeyed: async (url: string) => {
        keyed.push(url);
        const q = new URL(url).searchParams.get("query");
        if (q !== null) return JSON.stringify({ results: q === "American Psycho" ? [{ id: 1359, media_type: "movie", title: "American Psycho", release_date: "2000-04-13", poster_path: "/9uGHEgsiUXjCNq8wdq4r49YL8A1.jpg" }] : [] });
        if (url.includes("/external_ids")) return JSON.stringify({ wikidata_id: "Q207850" });
        return JSON.stringify({ vote_average: 7.4, vote_count: 12000, genres: [{ name: "Thriller" }], release_date: "2000-04-13", external_ids: { imdb_id: "tt0144084" } });
      },
      store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
      dashId: () => "wall", now: () => Date.parse("2026-09-22T12:00:00Z"), paceMs: 0,
    };
    const r = new LensResolver(hooks); r.setKey("eyJhbGciOi.readtoken");
    return { calls, keyed, r };
  }
  it("the full name is asked first; on a miss the trailing bracketed group goes, and the work is found - with no page guessed on open sources", async () => {
    const { r, calls, keyed } = rig();
    r.ensure([{ title: "American Psycho (Uncut Version)", kind: "movie" }], ["tmdb"], false);
    await new Promise((res) => setTimeout(res, 30));
    expect(keyed.slice(0, 2)).toEqual(["https://api.themoviedb.org/3/search/multi?query=American%20Psycho%20(Uncut%20Version)&include_adult=false", "https://api.themoviedb.org/3/search/multi?query=American%20Psycho&include_adult=false"]);
    const f = factsFor(r.factsOf(), "American Psycho (Uncut Version)", "movie")!;
    expect(f.tmdb).toEqual({ kind: "movie", id: 1359 });
    expect(f.genres).toEqual(["Thriller"]);
    expect(f.poster).toBe("https://image.tmdb.org/t/p/w342/9uGHEgsiUXjCNq8wdq4r49YL8A1.jpg");
    expect(calls).toEqual([]);   // a ratings-only ask reads nothing from Wikipedia or Wikidata: two thousand owned titles at Wikimedia's pace would take the day
  });
  it("the store's spelling against TMDB's: loosely on the results, then on TMDB's alternative titles - never the top result on faith", () => {
    expect(looseKey("Ghostbusters 2")).toBe(looseKey("Ghostbusters II"));
    expect(looseKey("Tango and Cash")).toBe(looseKey("Tango & Cash"));
    expect(looseKey("Marvel Studios' Ant-Man")).toBe(looseKey("Ant-Man"));
    expect(looseKey("Dr. Seuss' The Grinch")).toBe(looseKey("The Grinch"));
    expect(looseKey("Seven")).toBe(looseKey("Se7en"));
    expect(looseKey("Mamma Mia! The Movie")).toBe(looseKey("Mamma Mia!"));
    expect(looseKey("Star Wars: A New Hope")).not.toBe(looseKey("Star Wars"));
  });
  it("a title TMDB spells otherwise is found through its alternative titles", async () => {
    const calls: string[] = []; const store = new Map<string, string>();
    const hooks = {
      fetchStatic: async () => { throw new Error("no"); },
      fetchKeyed: async (url: string) => {
        calls.push(url);
        if (url.includes("/search/multi")) return JSON.stringify({ results: [{ id: 11, media_type: "movie", title: "Star Wars", release_date: "1977-05-25" }, { id: 1893, media_type: "movie", title: "Star Wars: Episode I - The Phantom Menace", release_date: "1999-05-19" }] });
        if (url.includes("/movie/11/alternative_titles")) return JSON.stringify({ titles: [{ title: "Star Wars: Episode IV - A New Hope" }, { title: "Star Wars: A New Hope" }] });
        if (url.includes("/external_ids")) return JSON.stringify({});
        return JSON.stringify({ vote_average: 8.2, vote_count: 20000, genres: [{ name: "Adventure" }], release_date: "1977-05-25", external_ids: {} });
      },
      store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
      dashId: () => "wall", now: () => Date.parse("2026-09-22T12:00:00Z"), paceMs: 0,
    };
    const r = new LensResolver(hooks); r.setKey("eyJhbGciOi.readtoken");
    r.ensure([{ title: "Star Wars: A New Hope", kind: "movie" }], ["tmdb"], false);
    await new Promise((res) => setTimeout(res, 30));
    expect(calls.some((u) => u.includes("/movie/11/alternative_titles"))).toBe(true);
    expect(factsFor(r.factsOf(), "Star Wars: A New Hope", "movie")?.tmdb).toEqual({ kind: "movie", id: 11 });
  });
  it("a ' - Anniversary Edition' phrase goes last", async () => {
    const { r, keyed } = rig();
    r.ensure([{ title: "Hook - Anniversary Edition", kind: "movie" }], ["tmdb"], false);
    await new Promise((res) => setTimeout(res, 30));
    expect(keyed.map((u) => new URL(u).searchParams.get("query")).filter((q) => q !== null)).toEqual(["Hook - Anniversary Edition", "Hook"]);
  });
});

describe("the menu under a lens (the runtime)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  function rig() {
    const ops: Array<Record<string, unknown>> = []; const store = new Map<string, string>(); const fetched: string[] = []; const keyed: string[] = [];
    const drivers: Drivers = {
      surface: { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: (id, _c, js) => void ops.push({ op: "inject", id, js }), freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {} },
      store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
      net: { fetchStatic: async (url: string) => { fetched.push(url); throw new Error("offline"); }, fetchKeyed: async (url: string) => { keyed.push(url); throw new Error("offline"); } },
    };
    return { ops, store, fetched, keyed, drivers };
  }
  const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
  async function setup() {
    const r = rig();
    const rt = createRuntime(r.drivers);
    rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoLibrary: "/*l*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [{ id: "1", title: "The Rookie", kind: "title", url: null }, { id: "2", title: "Dark", kind: "title", url: null }], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(50);
    return { ...r, rt };
  }
  it("every lens is a row of its own beneath the two plain rows (2026-09-21): the rows keep the person's own order, the open sources are read for every title, TMDB only under a key; no lens is named 'trending'", async () => {
    const { rt, fetched, keyed } = await setup();
    let menu = JSON.parse(rt.videoMenu());
    expect(menu.lens).toMatchObject({ active: null, tmdbKey: false, attribution: null, dataDate: null });
    expect(menu.lens.lenses.map((l: { name: string }) => l.name.toLowerCase().includes("trending"))).toEqual([false, false, false, false, false, false]);
    expect(menu.continue.map((c: { item: { title: string } }) => c.item.title)).toEqual(["Dark", "The Rookie"]);   // the person's chosen order (A to Z by default since 2026-09-26), never the lens's
    // one lens row on Watch since 2026-09-22 - Most read on Wikipedia; the other lenses re-sorted the household's own rows and Browse reads
    // the catalog by rating, date and votes. It carries its disclosure and formula; nothing counted yet offline
    expect(menu.lensRows.map((r: { id: string }) => r.id)).toEqual(["wiki-reads"]);
    for (const r of menu.lensRows) { for (const k of ["counted", "who", "decides", "source", "sourceUrl", "formula"]) expect(typeof r[k]).toBe("string"); expect(r.cards).toEqual([]); }
    await vi.advanceTimersByTimeAsync(100);
    // the open sources asked for every title at once (the cache first; offline here the articles are not found, so no further reads)
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((u) => u.startsWith("https://en.wikipedia.org/api/rest_v1/page/summary/"))).toBe(true);
    expect(keyed).toEqual([]);   // TMDB stays silent without a key
    // the old picker's verbs still answer (a lens may be named); an unknown lens is refused; the rows are unchanged by it
    expect(JSON.parse(rt.lensChoose("trending"))).toEqual({ ok: true, active: null });
    expect(JSON.parse(rt.lensChoose("wiki-reads")).active).toMatchObject({ id: "wiki-reads", name: "Most read on Wikipedia" });
    menu = JSON.parse(rt.videoMenu());
    expect(menu.continue.map((c: { item: { title: string } }) => c.item.title)).toEqual(["Dark", "The Rookie"]);
    expect(JSON.parse(rt.lensChoose(null)).active).toBeNull();
  });
  it("the TMDB key is the person's, kept on the device; set, TMDB is asked for every card's rating; cleared, nothing TMDB remains", async () => {
    const { rt, store, keyed } = await setup();
    expect(JSON.parse(rt.lensSetTmdbKey("abc.def"))).toEqual({ ok: true, set: true });
    expect(store.get("lens:tmdb:key:wall")).toBe("abc.def");
    const menu = JSON.parse(rt.videoMenu());
    expect(menu.lens.tmdbKey).toBe(true);
    expect(menu.lens.attribution).toContain("TMDB");
    await vi.advanceTimersByTimeAsync(100);
    // no article found offline: TMDB is asked by title under the person's key, and by nothing else
    expect(keyed.length).toBe(2);
    expect(keyed.every((u) => u.startsWith("https://api.themoviedb.org/3/search/multi?query="))).toBe(true);
    expect(JSON.parse(rt.lensSetTmdbKey(null))).toEqual({ ok: true, set: false });
    expect(store.get("lens:tmdb:key:wall")).toBe("");
    expect(JSON.parse(rt.videoMenu()).lens.attribution).toBeNull();
    expect(JSON.parse(rt.lensDisclosure("Dark"))).toMatchObject({ rating: null, links: [] });
  });
});
