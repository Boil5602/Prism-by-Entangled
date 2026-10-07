import { describe, expect, it } from "vitest";
import { acceptSearch, isShowName, typeFromGenres } from "../src/live-titles.js";
import { liveTypeOf } from "../src/live-guide.js";

// the Live tab's titles from TMDB (docs/features/live.md, 2026-10-02): a show-named channel files under TMDB's genre; the Now-on strip
describe("the Live tab's titles from TMDB (live-titles)", () => {
  it("a channel's name reads as a show's when it carries none of the channel words", () => {
    for (const n of ["Are We There Yet?", "Below Deck", "The Conners", "Top Gear", "Caso Cerrado", "Nosey", "Frasier", "Family Guy", "Night Court", "Live with Kelly and Mark", "Modern Family"]) expect(isShowName(n), n).toBe(true);   // a show's name, whatever words it holds (review 2026-10-02): TMDB's exact-name test is the judge
    for (const n of ["NBC News Now", "Black-Led Comedy", "Classic TV Comedy", "Comedy Movies", "80s Sitcoms", "CBS Sports HQ", "SNL Vault", "Dateline 24/7", "Hit Blockbuster Movies", "Confess by Nosey", "Law & Crime Network"]) expect(isShowName(n), n).toBe(false);
  });

  it("TMDB's answer is taken only when its title is the name itself; the first such result as TMDB orders them", () => {
    const results = [
      { media_type: "person", id: 1, name: "Are We" },
      { media_type: "tv", id: 32726, name: "Are We There Yet?", first_air_date: "2010-06-02", poster_path: "/p.jpg", backdrop_path: "/b.jpg", vote_average: 6.46, vote_count: 31, genre_ids: [35], overview: "A family." },
      { media_type: "movie", id: 2, title: "Are We There Yet?", release_date: "2005-01-21", genre_ids: [35, 10751] },
    ];
    const t = acceptSearch("Are We There Yet?", results)!;
    expect(t).toMatchObject({ kind: "tv", id: 32726, title: "Are We There Yet?", year: 2010, rating: 6.5, genres: ["Comedy"], poster: "https://image.tmdb.org/t/p/w342/p.jpg" });
    expect(acceptSearch("Are We There Yet", results)?.id).toBe(32726);   // punctuation folded
    expect(acceptSearch("Chrisley", [{ media_type: "tv", id: 3, name: "Chrisley Knows Best", genre_ids: [10764] }])).toBeNull();   // not the name
    expect(acceptSearch("X", [{ media_type: "tv", id: 4, name: "X", vote_average: 9, vote_count: 3 }])).toBeNull();   // too few votes to be a match at all (ION, REELZ: a network's name on an obscure title)
    expect(acceptSearch("X", [{ media_type: "tv", id: 4, name: "X", vote_average: 9, vote_count: 25 }])!.rating).toBe(9);
  });

  it("TMDB's first genre names the Live type; none maps, the tab's own rule stands", () => {
    expect(typeFromGenres(["Comedy", "Family"])).toBe("Comedy");
    expect(typeFromGenres(["Reality"])).toBe("Reality");
    expect(typeFromGenres(["Crime", "Drama"])).toBe("Drama");
    expect(typeFromGenres(["Animation", "Comedy"])).toBe("Kids");
    expect(typeFromGenres(["Romance"])).toBeNull();
    expect(typeFromGenres([])).toBeNull();
    const ch = { name: "Are We There Yet?", url: "https://www.peacocktv.com/watch/playback/live", category: null, tmdbType: "Comedy", tmdbTitle: "Are We There Yet?" };
    expect(liveTypeOf(ch)).toEqual({ type: "Comedy", source: "tmdb", title: "Are We There Yet?" });
    expect(liveTypeOf({ ...ch, category: "Kids & Family" })).toEqual({ type: "Kids", source: "service" });   // the service's own word first
    expect(liveTypeOf({ ...ch, tmdbType: null })).toEqual({ type: "Entertainment", source: "prism" });
  });
});

import { liveGuide } from "../src/live-guide.js";
describe("a channel counts in Movies for the film on it now (2026-10-02, 'Movies please')", () => {
  const NOW = Date.UTC(2026, 9, 2, 17, 30);
  const movies = { id: "mv", name: "Movies", url: "https://www.paramountplus.com/live-tv/stream/movies/", category: "Drama", schedule: [{ title: "Top Gun", start: NOW - 40 * 60_000, end: NOW + 70 * 60_000 }, { title: "Top Gun: Maverick", start: NOW + 70 * 60_000 }], nowTypes: [{ type: "Movies", title: "Top Gun" }] };
  const drama = { id: "ad", name: "All Day Drama", url: "https://www.paramountplus.com/live-tv/stream/all-day-drama/", category: "Drama", schedule: [{ title: "Lioness", start: NOW - 10 * 60_000, end: NOW + 50 * 60_000 }] };
  const later = { id: "lt", name: "Late Film", url: "https://www.paramountplus.com/live-tv/stream/late/", category: "Drama", schedule: [{ title: "Heat", start: NOW + 120 * 60_000, end: NOW + 300 * 60_000 }], nowTypes: [{ type: "Movies", title: "Heat" }] };
  const services = [{ app: "paramountplus", name: "Paramount+", facet: "p", channels: [movies, drama, later] }];
  it("the Movies chip counts it and Movies mode lists it, saying why; Drama still has it as its own", () => {
    const all = liveGuide(services, NOW, { type: null });
    expect(all.types).toEqual([{ type: "Drama", count: 3 }, { type: "Movies", count: 1 }]);
    const mv = liveGuide(services, NOW, { type: "Movies" });
    expect(mv.rows.map((r) => r.id)).toEqual(["mv"]);   // "later" has no film on NOW
    expect(mv.rows[0]!.alsoBy).toEqual({ type: "Movies", title: "Top Gun" });
    expect(mv.rows[0]!.type).toBe("Drama");
    const dr = liveGuide(services, NOW, { type: "Drama" });
    expect(dr.rows.map((r) => r.id).sort()).toEqual(["ad", "lt", "mv"]);
    expect(dr.rows.find((r) => r.id === "mv")!.alsoBy).toBeUndefined();
  });
});

import { certificationOf, isKidsRating } from "../src/live-titles.js";
describe("TMDB's US rating on a poster (Kids mode, 2026-10-02)", () => {
  it("reads the US rating from content_ratings (tv) and release_dates (movie); says which ratings are for children on their own", () => {
    expect(certificationOf("tv", { results: [{ iso_3166_1: "GB", rating: "15" }, { iso_3166_1: "US", rating: "TV-Y7" }] })).toBe("TV-Y7");
    expect(certificationOf("movie", { results: [{ iso_3166_1: "US", release_dates: [{ certification: "" }, { certification: "PG" }] }] })).toBe("PG");
    expect(certificationOf("tv", { results: [] })).toBeNull();
    expect(isKidsRating("TV-Y7")).toBe(true);
    expect(isKidsRating("TV-PG")).toBe(false);
    expect(isKidsRating(null)).toBeNull();
  });
});
