import { describe, expect, it } from "vitest";
import { watchlistMissing } from "../src/video.js";

// 2026-10-09: with a TMDB account linked the Watch page kept offering "Add 4 titles from your services' My Lists" after the copy had run
// ("added 0, already there 23"). The four were Netflix films: Netflix's list calls everything "title", the offer read that as a series,
// and the watchlist holds them as films.
describe("the watchlist's offer: the services' My List titles not on the TMDB watchlist", () => {
  const cards = [
    { title: "Europa Report", kind: "movie" },
    { title: "I Lost My Body", kind: "movie" },
    { title: "Severance", kind: "series" },
    { title: "Dark", kind: "series" },
  ];
  it("a title whose service does not say what it is, is matched by its name alone", () => {
    const list = [
      { service: "Netflix", app: "netflix", item: { title: "Europa Report", kind: "title" } },
      { service: "Netflix", app: "netflix", item: { title: "I Lost My Body" } },
      { service: "Apple TV", app: "appletv", item: { title: "Severance", kind: "series" } },
    ];
    expect(watchlistMissing(list, cards)).toEqual([]);
  });
  it("a film and a series of one name are two titles where the service says which", () => {
    const list = [
      { service: "Netflix", app: "netflix", item: { title: "Dark", kind: "movie" } },
      { service: "Netflix", app: "netflix", item: { title: "Dark", kind: "series" } },
    ];
    expect(watchlistMissing(list, cards)).toEqual([{ title: "Dark", service: "Netflix" }]);
  });
  it("what is missing is named once, with the service that lists it", () => {
    const list = [
      { service: "Tubi", app: "tubi", item: { title: "Blue Eye Samurai", kind: "series" } },
      { service: "Netflix", app: "netflix", item: { title: "BLUE EYE SAMURAI", kind: "series" } },
      { app: "hulu", item: { title: "Animal Control", kind: "title" } },
    ];
    expect(watchlistMissing(list, cards)).toEqual([{ title: "Blue Eye Samurai", service: "Tubi" }, { title: "Animal Control", service: "hulu" }]);
  });
});
