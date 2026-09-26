import { describe, it, expect } from "vitest";
import { HUB_SORTS, hubSortOf, sortCards, releaseOf, filterLookupRows } from "../src/hub-sort.js";
import { factsKey, type TitleFacts } from "../src/lenses.js";
import { titlesFromSearch } from "../src/catalog-search.js";

const card = (title: string, kind: string | null = "movie") => ({ item: { title, kind, id: title } });
const facts = (): Map<string, TitleFacts> => {
  const m = new Map<string, TitleFacts>();
  const put = (title: string, f: Partial<TitleFacts>) => m.set(factsKey(title, "movie"), { at: {}, ...f } as TitleFacts);
  put("Old", { year: 1999, first: "1999-03-31", rating: { mean: 8.7, votes: 20000, at: 0 } });
  put("New", { year: 2024, first: "2024-06-01", rating: { mean: 6.1, votes: 900, at: 0 } });
  put("Mid", { year: 2010, rating: { mean: 9.9, votes: 12, at: 0 } });   // a bare year; a rating under fifty votes
  put("Dated", { released: "2010-12-25", first: "2010-01-01" });   // Wikidata's date over TMDB's
  return m;
};

describe("the Library tab's sort (2026-09-22): one rule over each genre row - the Watch tab's rows keep their own order", () => {
  it("four sorts, own order the default; an unknown word is own order", () => {
    expect(HUB_SORTS.map((s) => s.id)).toEqual(["own", "newest", "oldest", "rated"]);
    expect(hubSortOf("rated")).toBe("rated"); expect(hubSortOf("sideways")).toBe("own"); expect(hubSortOf(null)).toBe("own");
  });
  it("A to Z (own) is the cards as they came", () => {
    const cards = [card("New"), card("Old"), card("Unknown"), card("Mid")];
    expect(sortCards(cards, "own", facts()).map((c) => c.item.title)).toEqual(["New", "Old", "Unknown", "Mid"]);
  });
  it("newest / oldest by release date, a bare year as its first day, the undated after in their order", () => {
    const cards = [card("Unknown"), card("New"), card("Nobody"), card("Old"), card("Mid"), card("Dated")];
    expect(sortCards(cards, "newest", facts()).map((c) => c.item.title)).toEqual(["New", "Dated", "Mid", "Old", "Unknown", "Nobody"]);
    expect(sortCards(cards, "oldest", facts()).map((c) => c.item.title)).toEqual(["Old", "Mid", "Dated", "New", "Unknown", "Nobody"]);
  });
  it("top rated by the mean, under fifty votes after the rest, the unrated last in their order", () => {
    const cards = [card("Unknown"), card("Mid"), card("New"), card("Old"), card("Dated")];
    expect(sortCards(cards, "rated", facts()).map((c) => c.item.title)).toEqual(["Old", "New", "Mid", "Unknown", "Dated"]);
  });
  it("the release date: Wikidata's, else TMDB's, else the year", () => {
    const f = facts();
    expect(releaseOf(f.get(factsKey("Dated", "movie")))).toBe("2010-12-25");
    expect(releaseOf(f.get(factsKey("Old", "movie")))).toBe("1999-03-31");
    expect(releaseOf(f.get(factsKey("Mid", "movie")))).toBe("2010");
    expect(releaseOf(undefined)).toBeNull();
  });
});

describe("the search's filters (2026-09-22): by genre and by service", () => {
  const rows = [
    { app: "netflix", name: "Netflix", candidate: { id: "tmdb:tv:1", genres: ["Drama", "Mystery"] } },
    { app: "hulu", name: "Hulu", candidate: { id: "tmdb:tv:1", genres: ["Drama", "Mystery"] } },
    { app: "netflix", name: "Netflix", candidate: { id: "tmdb:movie:2", genres: ["Comedy"] } },
    { app: "peacock", name: "Peacock", candidate: { id: "p:3" } },
  ];
  it("the chips are every genre and service of the UNFILTERED rows; the rows are those matching both", () => {
    const all = filterLookupRows(rows, {});
    expect(all.rows.length).toBe(4);
    expect(all.genres).toEqual(["Comedy", "Drama", "Mystery"]);
    expect(all.services).toEqual([{ app: "netflix", name: "Netflix" }, { app: "hulu", name: "Hulu" }, { app: "peacock", name: "Peacock" }]);
    const drama = filterLookupRows(rows, { genre: "Drama" });
    expect(drama.rows.map((r) => r.app)).toEqual(["netflix", "hulu"]);
    expect(drama.genres).toEqual(["Comedy", "Drama", "Mystery"]);   // the other chips stay offered
    const both = filterLookupRows(rows, { genre: "Drama", app: "hulu" });
    expect(both.rows.map((r) => r.app)).toEqual(["hulu"]);
    expect(filterLookupRows(rows, { app: "peacock" }).rows.length).toBe(1);
    expect(filterLookupRows(rows, { genre: "Western" }).rows).toEqual([]);   // a genre no row has: nothing, not everything
  });
  it("TMDB's genre ids are named on the catalog's titles", () => {
    const t = titlesFromSearch([{ id: 66732, media_type: "tv", name: "Stranger Things", first_air_date: "2016-07-15", genre_ids: [18, 10765, 9648, 424242] }]);
    expect(t[0]?.genres).toEqual(["Drama", "Sci-Fi & Fantasy", "Mystery"]);
  });
});
