import { describe, expect, it } from "vitest";
import { creditsAsResults, libraryHits, libraryLine, matchScore, normSearch, peopleFromSearch, searchLayout, searchWorks, workCard } from "../src/search-view.js";

// the words and the layout both screens draw (2026-10-14): decided once here, read by the PC's Search and the phone
describe("workCard", () => {
  const svc = (name: string, offer: string) => ({ app: name.toLowerCase(), name, facet: name + "-f", offer, candidate: { id: "x", title: "T" } });
  it("leads with Owned, else Included or Free, else the first offer; amber when the title costs", () => {
    expect(workCard({ owned: false, services: [svc("Netflix", "Subscription")], year: 2019, kind: "series", via: null, genres: ["Drama", "Comedy", "Crime", "War"] })).toEqual({ offer: "Included", line: "Included  ·  2019  ·  Series", amber: false, services: ["Netflix: Included"], plays: ["Play on Netflix  ·  Included"], facts: "2019  ·  Series  ·  Drama  ·  Comedy  ·  Crime" });
    expect(workCard({ owned: false, services: [svc("Amazon", "Rent $3.99"), svc("Tubi", "Free with ads")], year: null, kind: "movie", via: "Disney+", genres: [] }).line).toBe("Free with ads  ·  Movie  ·  with Disney+");
    expect(workCard({ owned: false, services: [svc("Amazon", "Rent $3.99")], year: 2001, kind: "movie", via: null, genres: [] })).toMatchObject({ offer: "Rent $3.99", amber: true, facts: "2001  ·  Movie" });
    expect(workCard({ owned: true, services: [svc("Fandango", "Owned")], year: 2001, kind: "movie", via: null, genres: [] })).toMatchObject({ offer: "Owned", amber: false, plays: ["Play on Fandango  ·  Owned"] });
  });
});

describe("libraryLine", () => {
  it("names the first service's list and how many more", () => {
    const s = (name: string, from: "continue" | "list" | "owned") => ({ app: name, name, facet: name, from, item: { id: "1", title: "T" } });
    expect(libraryLine({ services: [s("Netflix", "continue"), s("Hulu", "list")] })).toEqual({ line: "Continue Watching on Netflix  ·  +1 more", plays: ["Play on Netflix  ·  Continue Watching", "Play on Hulu  ·  My List"] });
    expect(libraryLine({ services: [] })).toEqual({ line: "", plays: [] });
  });
});

describe("searchLayout", () => {
  const base = { q: "firefly", done: true, source: "catalog", services: [], library: [], people: [], person: null, elsewhere: [], attribution: "TMDB", filtered: false, all: 0 };
  const w = (key: string, exact: boolean, score: number) => ({ key, exact, score });
  it("puts a person first when the words are their name, unless a title IS the words", () => {
    expect(searchLayout({ ...base, people: [{ name: "Fire Fly" }], works: [w("a", false, 60)] }).personFirst).toBe(true);
    expect(searchLayout({ ...base, people: [{ name: "Fire Fly" }], works: [w("a", true, 100)] }).personFirst).toBe(false);
    expect(searchLayout({ ...base, people: [{ name: "Someone Else" }], works: [] }).personFirst).toBe(false);
  });
  it("shows a top result for the title the words name, a strong match, or a person's work, and heads the rest", () => {
    expect(searchLayout({ ...base, works: [w("a", true, 100), w("b", false, 60)] })).toMatchObject({ top: "a", restHeading: "More on your services" });
    expect(searchLayout({ ...base, works: [w("a", false, 90)] })).toMatchObject({ top: "a", restHeading: null });
    expect(searchLayout({ ...base, works: [w("a", false, 75), w("b", false, 60)] })).toMatchObject({ top: null, restHeading: "On your services" });
    expect(searchLayout({ ...base, person: { name: "Nathan Fillion" }, works: [w("a", false, 10), w("b", false, 5)] })).toMatchObject({ top: "a", restHeading: "Nathan Fillion on your services" });
  });
  it("says what there is to say under the heading, and why there is nothing", () => {
    const svcs = [{ name: "Netflix", status: "searching" }, { name: "Hulu", status: "empty" }, { name: "Tubi", status: "blocked", reason: "sign in first" }];
    expect(searchLayout({ ...base, source: "services", done: false, services: svcs, works: [] })).toMatchObject({ heading: "Searching for", status: "still searching Netflix  ·  nothing on Hulu  ·  Tubi: sign in first  ·  TMDB", empty: null });
    expect(searchLayout({ ...base, source: "catalog", done: false, services: svcs, works: [] }).status).toBe("asking TMDB  ·  Tubi: sign in first  ·  TMDB");
    expect(searchLayout({ ...base, attribution: null, works: [] }).status).toBeNull();
    expect(searchLayout({ ...base, works: [], elsewhere: ["Max"] }).empty).toBe("Not on any of your services  ·  elsewhere on Max");
    expect(searchLayout({ ...base, works: [] }).empty).toBe("TMDB knows no title by that name on any of your services.");
    expect(searchLayout({ ...base, source: "services", works: [] }).empty).toBe("No service had it.");
    expect(searchLayout({ ...base, person: { name: "Nathan Fillion" }, works: [] }).empty).toBe("TMDB lists none of Nathan Fillion's work on your services.");
    expect(searchLayout({ ...base, works: [], filtered: true, all: 7 }).empty).toBe("None of the 7 results match the filter.");
    expect(searchLayout({ ...base, works: [], library: [{}] }).empty).toBeNull();
  });
});

describe("matchScore", () => {
  it("ranks the title itself, its start, its words, inside it, one letter off", () => {
    expect(normSearch("The Office (U.S.)")).toBe("office u s");
    expect(matchScore("the rookie", "The Rookie")).toBe(100);
    expect(matchScore("rookie", "The Rookie")).toBe(100);          // a leading "the" is dropped on both sides
    expect(matchScore("star trek", "Star Trek: Discovery")).toBe(90);
    expect(matchScore("trek disc", "Star Trek: Discovery")).toBe(75);
    expect(matchScore("sunny", "It's Always Sunny in Philadelphia")).toBe(75);
    expect(matchScore("discovary", "Star Trek: Discovery")).toBe(45);   // one letter off
    expect(matchScore("cafe", "Café Society")).toBe(90);             // accents off
    expect(matchScore("zzz", "The Rookie")).toBe(0);
    expect(matchScore("r", "The Rookie")).toBe(0);                   // one letter is not a search
    expect(matchScore("lee", "Bleed For This")).toBe(0);             // a short word is not matched inside another
    expect(matchScore("lee", "Dragon: The Bruce Lee Story")).toBe(75);
  });
});

describe("libraryHits", () => {
  const e = (app: string, from: "continue" | "list" | "owned", title: string, series?: string) => ({ app, name: app.toUpperCase(), facet: app + "-f", from, item: { id: app + title, title, ...(series ? { series } : {}), artwork: app + ".jpg" } });
  it("finds the household's titles, one per title, all its services, Continue Watching first", () => {
    const hits = libraryHits("south", [e("paramount", "list", "South Park"), e("hulu", "continue", "Twisted Christian", "South Park"), e("netflix", "list", "Dark")]);
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toBe("South Park");
    expect(hits[0]!.services.map((s) => s.app)).toEqual(["hulu", "paramount"]);
  });
});

describe("searchWorks", () => {
  it("makes one work per catalog id with every service on it, the exact title first", () => {
    const c = (id: string, title: string) => ({ id, title, kind: "series", year: 2018 });
    const works = searchWorks("the rookie", [
      { app: "hulu", name: "Hulu", facet: "h", offer: "Subscription", candidate: c("tmdb:movie:1", "Rookie of the Year") },
      { app: "hulu", name: "Hulu", facet: "h", offer: "Subscription", exact: true, candidate: c("tmdb:tv:79744", "The Rookie") },
      { app: "disney", name: "Disney+", facet: "d", offer: "Subscription", exact: true, candidate: c("tmdb:tv:79744", "The Rookie") },
    ]);
    expect(works.map((w) => w.title)).toEqual(["The Rookie", "Rookie of the Year"]);
    expect(works[0]!.services.map((s) => s.app)).toEqual(["hulu", "disney"]);
  });
  it("groups the services' own answers by title and year", () => {
    const works = searchWorks("dune", [
      { app: "a", name: "A", facet: "a", candidate: { id: "x1", title: "Dune", kind: "movie", year: 2021 } },
      { app: "b", name: "B", facet: "b", candidate: { id: "y9", title: "DUNE", kind: "movie" } },
      { app: "c", name: "C", facet: "c", candidate: { id: "z3", title: "Dune: Part Two", kind: "movie", year: 2024 } },
    ]);
    expect(works.length).toBe(2);   // the yearless DUNE joins the one year of that title; with two years it would stay apart
    expect(works[0]!.services.map((s) => s.app)).toEqual(["a", "b"]);
  });
});

describe("people", () => {
  it("reads TMDB's people and a person's credits, a talk-show guest spot left out", () => {
    const p = peopleFromSearch([{ media_type: "person", id: 5, name: "Nathan Fillion", known_for_department: "Acting", profile_path: "/n.jpg", known_for: [{ name: "The Rookie" }, { title: "Serenity" }] }, { media_type: "tv", id: 1, name: "X" }]);
    expect(p).toEqual([{ id: 5, name: "Nathan Fillion", photo: "https://image.tmdb.org/t/p/w185/n.jpg", known: "Acting", knownFor: ["The Rookie", "Serenity"] }]);
    const r = creditsAsResults({ cast: [{ media_type: "tv", id: 1, name: "Late Show", episode_count: 1, character: "Himself", popularity: 90 }, { media_type: "tv", id: 2, name: "The Rookie", popularity: 50 }, { media_type: "movie", id: 3, title: "Serenity", popularity: 70 }], crew: [{ media_type: "movie", id: 3, title: "Serenity" }] });
    expect(r.map((x) => x.id)).toEqual([3, 2]);
  });
});
