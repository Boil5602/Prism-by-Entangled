import { describe, expect, it } from "vitest";
import { creditsAsResults, libraryHits, matchScore, normSearch, peopleFromSearch, searchWorks } from "../src/search-view.js";

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
