import { describe, it, expect } from "vitest";
import { MOST_READ_CATALOG, MOST_READ_UNTAGGED_RANK, isScreenArticle, isScreenDescription, mostReadDays, orderMostRead, readsValue, topListCandidates } from "../src/most-read.js";

describe("Most read on Wikipedia across the household's services (2026-09-22)", () => {
  it("reads the last seven full days, newest first", () => {
    const now = Date.parse("2026-09-22T15:00:00Z");
    expect(mostReadDays(now)).toEqual(["2026/09/21", "2026/09/20", "2026/09/19", "2026/09/18", "2026/09/17", "2026/09/16", "2026/09/15"]);
    expect(mostReadDays(Date.parse("2026-09-01T00:30:00Z"))[0]).toBe("2026/08/31");
  });
  it("an article is tagged a film or series only when its name says so", () => {
    for (const a of ["Sinners_(2025_film)", "The_Bear_(TV_series)", "Shogun_(2024_TV_series)", "The_Penguin_(miniseries)", "Squid_Game_(South_Korean_TV_series)", "Wicked_(film)"]) expect(isScreenArticle(a)).toBe(true);
    for (const a of ["Main_Page", "Taylor_Swift", "Stranger_Things", "List_of_Netflix_original_films", "Stranger_Things_season_5", "Pedro_Pascal_filmography"]) expect(isScreenArticle(a)).toBe(false);
  });
  it("a day's top list gives the tagged articles, and the untagged ones near the top to be weighed by description - never a special page, a list or a year", () => {
    const json = { items: [{ articles: [
      { article: "Main_Page", views: 5_000_000, rank: 1 }, { article: "Special:Search", views: 800_000, rank: 2 },
      { article: "Sinners_(2025_film)", views: 90_000, rank: 3 }, { article: "Stranger_Things", views: 85_000, rank: 4 },
      { article: "Deaths_in_2026", views: 80_000, rank: 5 }, { article: "List_of_Pixar_films", views: 70_000, rank: 6 },
      { article: "2026", views: 60_000, rank: 7 }, { article: "Wikipedia:Featured_pictures", views: 50_000, rank: 8 },
      { article: "Taylor_Swift", views: 40_000, rank: 9 },
      { article: "The_Bear_(TV_series)", views: 9_000, rank: 900 }, { article: "Some_Person", views: 8_000, rank: MOST_READ_UNTAGGED_RANK + 1 },
    ] }] };
    expect(topListCandidates(json)).toEqual({ tagged: ["Sinners_(2025_film)", "The_Bear_(TV_series)"], untagged: ["Stranger_Things", "Taylor_Swift"] });
    expect(topListCandidates(null)).toEqual({ tagged: [], untagged: [] });
    expect(topListCandidates({ items: [] })).toEqual({ tagged: [], untagged: [] });
  });
  it("an untagged article counts when its summary's description reads as a film or series; TMDB's find by its Wikidata item decides", () => {
    expect(isScreenDescription("2025 film directed by Ryan Coogler")).toBe(true);
    expect(isScreenDescription("American science fiction horror television series")).toBe(true);
    expect(isScreenDescription("American singer-songwriter")).toBe(false);
    expect(isScreenDescription(null)).toBe(false);
  });
  it("orders by the one number, most reads first, an equal count keeping the order found; the value names its source and window", () => {
    const cards = [{ id: "a", reads: 10 }, { id: "b", reads: 300 }, { id: "c", reads: 10 }, { id: "d", reads: 2_400_000 }];
    expect(orderMostRead(cards).map((c) => c.id)).toEqual(["d", "b", "a", "c"]);
    expect(readsValue(2_400_000)).toBe("2.4M reads · Wikipedia · 7 days");
    expect(readsValue(812)).toBe("812 reads · Wikipedia · 7 days");
  });
  it("the row says what is counted, who, who decides, its sources and a one-sentence formula with the offer and the date - never 'trending'", () => {
    for (const k of ["counted", "who", "decides", "source", "formula"] as const) expect(MOST_READ_CATALOG[k].length).toBeGreaterThan(0);
    expect(MOST_READ_CATALOG.formula).toContain("{offer}");
    expect(MOST_READ_CATALOG.formula).toContain("{date}");
    expect(Object.values(MOST_READ_CATALOG).join(" ")).not.toMatch(/trending|popular|for you|recommend/i);
  });
});
