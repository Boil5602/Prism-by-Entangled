import { describe, expect, it } from "vitest";
import { atHomeFrom, catalogRows, isCatalogId, offerLabel, offersFromProviders, ownedIsThis, ownedYear, providersOf, titlesFromSearch, type CatalogService } from "../src/catalog-search.js";

// "maybe we should just use TMDB's results then link those results up to the service if linked to us (discard if not
// part of a service we've configured). So if I search for Stranger Things, TMDB returns the link on Netflix and nothing
// else" (2026-09-21). Fixtures: TMDB's titles in TMDB's order, the title that IS the words first; one card per household
// service that carries it, with the offer; a title on none of the household's services is discarded.

const services: CatalogService[] = [
  { app: "netflix", name: "Netflix", facet: "nf", adapter: "netflix", status: "signed-in", providers: [8] },
  { app: "peacock", name: "Peacock", facet: "pk", adapter: "peacock", status: "signed-in", providers: [386, 387] },
  { app: "fandango", name: "Fandango at Home", facet: "fa", adapter: "fandango", status: "signed-in", providers: [7] },
  { app: "hbomax", name: "HBO Max", facet: "hb", adapter: "hbomax", status: "needs-attention", providers: [1899] },
  { app: "twitch", name: "Twitch", facet: "tw", adapter: "twitch", status: "signed-in", providers: [] },
];

describe("the catalog search", () => {
  it("reduces TMDB's search to movies and shows in TMDB's order, with the year and the poster", () => {
    const t = titlesFromSearch([
      { media_type: "person", id: 1, name: "Winona Ryder" },
      { media_type: "tv", id: 66732, name: "Stranger Things", first_air_date: "2016-07-15", poster_path: "/x.jpg" },
      { media_type: "movie", id: 9, title: "Stranger Than Fiction", release_date: "2006-10-21" },
      { media_type: "tv", id: 10, name: "" },
    ]);
    expect(t).toEqual([
      { kind: "tv", id: 66732, title: "Stranger Things", year: 2016, released: "2016-07-15", poster: "https://image.tmdb.org/t/p/w342/x.jpg" },
      { kind: "movie", id: 9, title: "Stranger Than Fiction", year: 2006, released: "2006-10-21" },
    ]);
    expect(titlesFromSearch(null)).toEqual([]);
    // a person the words named contributes the titles TMDB knows them for, marked with the name; a title is listed once
    const p = titlesFromSearch([
      { media_type: "person", id: 500, name: "Tom Cruise", known_for: [{ media_type: "movie", id: 361743, title: "Top Gun: Maverick", release_date: "2022-05-24", overview: "After thirty years..." }, { media_type: "movie", id: 744, title: "Top Gun", release_date: "1986-05-16" }] },
      { media_type: "movie", id: 744, title: "Top Gun", release_date: "1986-05-16" },
    ]);
    expect(p).toEqual([
      { kind: "movie", id: 361743, title: "Top Gun: Maverick", year: 2022, released: "2022-05-24", overview: "After thirty years...", via: "Tom Cruise" },
      { kind: "movie", id: 744, title: "Top Gun", year: 1986, released: "1986-05-16", via: "Tom Cruise" },
    ]);
  });

  it("reads a region's providers by offer, and words the offer as a person would rather have it", () => {
    const o = offersFromProviders({ flatrate: [{ provider_id: 8, provider_name: "Netflix" }], rent: [{ provider_id: 7 }, { provider_id: 2 }], buy: [{ provider_id: 7 }], link: "https://..." });
    expect(o).toEqual({ subscription: [8], rent: [7, 2], buy: [7] });
    expect(offersFromProviders(null)).toEqual({});
    expect(offerLabel(["subscription", "rent"])).toBe("Subscription");
    expect(offerLabel(["ads"])).toBe("Free with ads");
    expect(offerLabel(["rent", "buy"])).toBe("Rent / Buy");
    expect(offerLabel(["buy"])).toBe("Buy");
    expect(offerLabel([])).toBe("");
    expect(providersOf({ id: "x", tmdbProviders: [8, -1, 2.5, "9" as never] } as never)).toEqual([8]);
    expect(providersOf(undefined)).toEqual([]);
  });

  it("one card per household service that carries a title, the title that IS the words first, the rest discarded", () => {
    const titles = [
      { kind: "movie" as const, id: 1, title: "Stranger Than Fiction", year: 2006, offers: { rent: [7, 2], buy: [7] } },          // Fandango rents and sells it; Apple's store is nobody's here
      { kind: "tv" as const, id: 2, title: "Stranger Things", year: 2016, offers: { subscription: [8] } },                        // Netflix
      { kind: "tv" as const, id: 3, title: "Strangers", offers: { subscription: [1899], free: [73] } },                          // HBO Max (not signed in), Tubi (not configured): discarded
      { kind: "movie" as const, id: 4, title: "The Stranger", offers: { subscription: [386, 8], ads: [387] } },                    // Peacock and Netflix
    ];
    const rows = catalogRows("stranger things", titles, services);
    expect(rows.map((r) => [r.candidate.title, r.name, r.offer, r.exact])).toEqual([
      ["Stranger Things", "Netflix", "Subscription", true],
      ["Stranger Than Fiction", "Fandango at Home", "Rent / Buy", false],
      ["The Stranger", "Netflix", "Subscription", false],
      ["The Stranger", "Peacock", "Subscription", false],
    ]);
    expect(rows[0]!.candidate).toEqual({ id: "tmdb:tv:2", title: "Stranger Things", kind: "series", year: 2016 });
    expect(rows.every((r) => isCatalogId(r.candidate.id))).toBe(true);
    expect(isCatalogId("81724633")).toBe(false);
    expect(catalogRows("x", titles, [])).toEqual([]);
  });
});

describe("an owned title is the catalog's title only when it is the same work (2026-09-22)", () => {
  const today = "2026-09-22";
  const re2026 = { kind: "movie" as const, id: 1234, title: "Resident Evil", year: 2026, released: "2026-09-18" };
  const re2002 = { kind: "movie" as const, id: 1576, title: "Resident Evil", year: 2002, released: "2002-03-15" };
  it("a title not yet released is owned by nobody, whatever its name", () => {
    expect(ownedIsThis({ title: "Resident Evil" }, { ...re2026, released: "2026-10-30" }, null, today)).toBe(false);
    expect(ownedIsThis({ title: "Resident Evil" }, { ...re2026, released: undefined, year: 2027 }, null, today)).toBe(false);
  });
  it("the TMDB work the wall matched the owned title to must be this one", () => {
    expect(ownedIsThis({ title: "Resident Evil" }, re2026, { kind: "movie", id: 1576 }, today)).toBe(false);
    expect(ownedIsThis({ title: "Resident Evil" }, re2002, { kind: "movie", id: 1576 }, today)).toBe(true);
  });
  it("a year the owned item carries itself must agree within a year", () => {
    expect(ownedYear({ title: "A Real Pain", url: "https://moviesanywhere.com/movie/a-real-pain-2024" })).toBe(2024);
    expect(ownedYear({ title: "The Garfield Movie (2024)" })).toBe(2024);
    expect(ownedYear({ title: "Holes", subtitle: "2003 · PG" })).toBe(2003);
    expect(ownedYear({ title: "Resident Evil", url: "https://moviesanywhere.com/movie/resident-evil" })).toBe(null);
    expect(ownedIsThis({ title: "Resident Evil", url: "https://moviesanywhere.com/movie/resident-evil-2002" }, re2026, null, today)).toBe(false);
    expect(ownedIsThis({ title: "The Garfield Movie (2024)" }, { kind: "movie", id: 9, title: "The Garfield Movie", year: 2024, released: "2024-05-01" }, null, today)).toBe(true);
  });
  it("a different name is never the work", () => {
    expect(ownedIsThis({ title: "Resident Evil: Apocalypse" }, re2002, null, today)).toBe(false);
  });
});

describe("a film is sold to own once TMDB lists its home release (2026-09-22)", () => {
  const today = "2026-09-22";
  const us = (...d: Array<[number, string]>) => ({ results: [{ iso_3166_1: "US", release_dates: d.map(([type, date]) => ({ type, release_date: date + "T00:00:00.000Z" })) }] });
  it("Resident Evil (2026): a premiere and a theatrical date only, days ago - in theaters, owned by nobody", () => {
    expect(atHomeFrom(us([1, "2026-09-17"], [3, "2026-09-18"]), today)).toBe(false);
    expect(ownedIsThis({ title: "Resident Evil" }, { kind: "movie", id: 1423191, title: "Resident Evil", year: 2026, released: "2026-09-16" }, null, today, false)).toBe(false);
  });
  it("Resident Evil (2002): its physical release is listed and past - at home", () => {
    expect(atHomeFrom(us([1, "2002-03-12"], [3, "2002-03-15"], [5, "2002-06-04"]), today)).toBe(true);
  });
  it("a home release dated later is not yet at home; digital or TV counts as home", () => {
    expect(atHomeFrom(us([3, "2026-08-01"], [4, "2026-10-14"]), today)).toBe(false);
    expect(atHomeFrom(us([3, "2026-08-01"], [4, "2026-09-02"]), today)).toBe(true);
    expect(atHomeFrom(us([6, "2026-09-01"]), today)).toBe(true);
  });
  it("an older film with no home date on TMDB is taken as at home; nothing listed for the US is unknown", () => {
    expect(atHomeFrom(us([3, "1985-12-13"]), today)).toBe(true);
    expect(atHomeFrom({ results: [{ iso_3166_1: "GB", release_dates: [{ type: 3, release_date: "2026-09-18" }] }] }, today)).toBe(null);
    expect(atHomeFrom(null, today)).toBe(null);
  });
});
