import { describe, it, expect } from "vitest";
import { BROWSE_GENRES, BROWSE_ROWS, BROWSE_OFFERS, BROWSE_VOTE_FLOOR, BROWSE_NEWEST_FLOOR, browseGenre, browseOfferOf, BROWSE_MAX_PAGES, BROWSE_LOOKAHEAD, BROWSE_ROW_SIZE, discoverQuery, discoverTitles, mergeDiscover, browseValue, inGenre, offerCounts } from "../src/browse.js";
import { dedupeKey } from "../src/menu-order.js";

const q = (s: string | null) => new URLSearchParams(s ?? "");

describe("Browse by genre (2026-09-22): transparent rows only", () => {
  it("every row names what is counted, who, who decides, its source and a one-sentence formula; no row is TMDB's popularity, trending or 'for you'", () => {
    expect(BROWSE_ROWS.map((r) => r.id)).toEqual(["yours", "top", "newest", "voted"]);
    for (const r of BROWSE_ROWS) {
      for (const k of ["name", "counted", "who", "decides", "source", "sourceUrl", "formula"] as const) expect(r[k].length).toBeGreaterThan(0);
      expect(r.formula).toContain("{genre}");
      expect(`${r.name} ${r.formula} ${r.source}`).not.toMatch(/popular|trending|for you|recommend/i);
    }
    // the floors are printed on the rows that use them
    expect(BROWSE_ROWS.find((r) => r.id === "top")!.formula).toContain(String(BROWSE_VOTE_FLOOR));
    expect(BROWSE_ROWS.find((r) => r.id === "newest")!.formula).toContain(String(BROWSE_NEWEST_FLOOR));
  });
  it("each genre chip covers TMDB's movie and series ids for it, and a genre with ids on neither side does not exist", () => {
    for (const g of BROWSE_GENRES) { expect(g.movie.length + g.tv.length).toBeGreaterThan(0); expect(g.names.length).toBeGreaterThan(0); }
    expect(new Set(BROWSE_GENRES.map((g) => g.id)).size).toBe(BROWSE_GENRES.length);
    expect(browseGenre("scifi")?.movie).toEqual([878, 14]);
    expect(browseGenre("nonsense")).toBeNull();
  });
  it("the discover query: the genre's ids OR'd, the household's providers OR'd, the region, the row's ONE sort and its printed floor - never popularity", () => {
    const scifi = browseGenre("scifi")!;
    const top = q(discoverQuery("movie", scifi, "top", [8, 15, 8], "2026-09-22"));
    expect(top.get("with_genres")).toBe("878|14");
    expect(top.get("with_watch_providers")).toBe("8|15");
    expect(top.get("watch_region")).toBe("US");
    expect(top.get("sort_by")).toBe("vote_average.desc");
    expect(top.get("vote_count.gte")).toBe(String(BROWSE_VOTE_FLOOR));
    const newest = q(discoverQuery("tv", scifi, "newest", [8], "2026-09-22"));
    expect(newest.get("with_genres")).toBe("10765");
    expect(newest.get("sort_by")).toBe("first_air_date.desc");
    expect(newest.get("first_air_date.lte")).toBe("2026-09-22");   // nothing dated in the future
    expect(newest.get("vote_count.gte")).toBe(String(BROWSE_NEWEST_FLOOR));
    expect(q(discoverQuery("movie", scifi, "newest", [8], "2026-09-22")).get("sort_by")).toBe("primary_release_date.desc");
    expect(q(discoverQuery("movie", scifi, "voted", [8], "2026-09-22")).get("sort_by")).toBe("vote_count.desc");
    for (const row of ["top", "newest", "voted"] as const) for (const kind of ["movie", "tv"] as const) expect(discoverQuery(kind, scifi, row, [8], "2026-09-22")).not.toMatch(/popularity/);
    // a genre with no series ids asks nothing of the series catalog; no providers, nothing at all
    expect(discoverQuery("tv", browseGenre("horror")!, "top", [8], "2026-09-22")).toBeNull();
    expect(discoverQuery("movie", scifi, "top", [], "2026-09-22")).toBeNull();
  });
  it("the offer filter: Included (the default) asks TMDB for subscription / free / ads titles and keeps owned; Anything adds rent and buy - and the rows print it", () => {
    const scifi = browseGenre("scifi")!;
    expect(browseOfferOf(undefined)).toBe("included"); expect(browseOfferOf("any")).toBe("any"); expect(browseOfferOf("nonsense")).toBe("included");
    expect(q(discoverQuery("movie", scifi, "top", [8], "2026-09-22", "included")).get("with_watch_monetization_types")).toBe("flatrate|free|ads");
    expect(q(discoverQuery("movie", scifi, "top", [8], "2026-09-22", "any")).get("with_watch_monetization_types")).toBeNull();
    // a service's offer under the filter: a rent-only service is not "included"; owned always is
    expect(offerCounts("included", ["rent", "buy"], false)).toBe(false);
    expect(offerCounts("included", ["rent", "buy"], true)).toBe(true);
    expect(offerCounts("included", ["ads"], false)).toBe(true);
    expect(offerCounts("any", ["buy"], false)).toBe(true);
    for (const r of BROWSE_ROWS.filter((x) => x.id !== "yours")) expect(r.formula).toContain("{offer}");
    expect(BROWSE_OFFERS.map((o) => o.id)).toEqual(["included", "any"]);
  });
  it("a row reads more than one page when its own services leave it short, and looks ahead far enough to refill it", () => {
    expect(BROWSE_MAX_PAGES).toBeGreaterThan(1);
    expect(BROWSE_ROW_SIZE * BROWSE_LOOKAHEAD).toBeGreaterThanOrEqual(BROWSE_ROW_SIZE * 2);   // the merged order goes deeper than the row it fills
  });
  it("films and series merge by the row's one key; an equal mean puts more votes first; the undated or unrated are dropped, not guessed", () => {
    const movies = discoverTitles("movie", [
      { id: 1, title: "Arrival", release_date: "2016-11-10", vote_average: 7.6, vote_count: 18000, genre_ids: [878] },
      { id: 2, title: "Dune", release_date: "2021-09-15", vote_average: 7.8, vote_count: 13000, genre_ids: [878] },
      { id: 3, title: "Undated", vote_average: 9.9, vote_count: 300 },
    ]);
    const series = discoverTitles("tv", [
      { id: 10, name: "Severance", first_air_date: "2022-02-17", vote_average: 8.4, vote_count: 2500, genre_ids: [10765] },
      { id: 11, name: "Dark", first_air_date: "2017-12-01", vote_average: 8.4, vote_count: 7900, genre_ids: [10765] },
    ]);
    expect(movies[0]).toMatchObject({ kind: "movie", id: 1, title: "Arrival", year: 2016, mean: 7.6, votes: 18000, date: "2016-11-10" });
    expect(series[1]!.genres).toEqual(["Sci-Fi & Fantasy"]);
    expect(mergeDiscover("top", movies, series).map((t) => t.title)).toEqual(["Undated", "Dark", "Severance", "Dune", "Arrival"]);
    expect(mergeDiscover("newest", movies, series).map((t) => t.title)).toEqual(["Severance", "Dune", "Dark", "Arrival"]);
    expect(mergeDiscover("voted", movies, series).map((t) => t.title)).toEqual(["Arrival", "Dune", "Dark", "Severance", "Undated"]);
    expect(mergeDiscover("voted", movies, series, 2).length).toBe(2);
  });
  it("a card's number is the row's own, with its source, never bare", () => {
    const [t] = discoverTitles("tv", [{ id: 11, name: "Dark", first_air_date: "2017-12-01", vote_average: 8.4, vote_count: 7900 }]);
    expect(browseValue("top", t!)).toBe("★ 8.4 · TMDB · 7.9k votes");
    expect(browseValue("voted", t!)).toBe("7.9k votes · TMDB");
    expect(browseValue("newest", t!)).toBe("2017-12-01 · TMDB");
  });
  it("a household title is in the genre when TMDB's genres for it name the chip's genre", () => {
    const scifi = browseGenre("scifi")!;
    expect(inGenre(["Drama", "Science Fiction"], scifi)).toBe(true);
    expect(inGenre(["Sci-Fi & Fantasy"], scifi)).toBe(true);
    expect(inGenre(["Drama"], scifi)).toBe(false);
    expect(inGenre(undefined, scifi)).toBe(false);
  });
});

describe("one title across services (2026-09-22)", () => {
  it("the dedupe key drops case, punctuation and a leading article - one film, two services' spellings", () => {
    expect(dedupeKey("Meg 2: The Trench")).toBe(dedupeKey("The Meg 2: The Trench"));
    expect(dedupeKey("10,000 B.C.")).toBe(dedupeKey("10000 BC"));
    expect(dedupeKey("A Quiet Place")).toBe(dedupeKey("Quiet Place"));
    expect(dedupeKey("The Batman")).not.toBe(dedupeKey("Batman Begins"));
  });
});
