import { describe, it, expect } from "vitest";
import { currentEpisode, seasonsFrom, seriesKey } from "../src/orchestrator.js";

// the shape Netflix's show page gave on 2026-09-22 (Grace and Frankie, "See All Episodes")
const listed = [
  { season: "Season 1", episode: "1", title: "The End", id: 80017360, url: "https://www.netflix.com/watch/80017360", synopsis: "Grace and Frankie are stunned...", duration: "35m" },
  { season: "Season 1", episode: "2", title: "The Credit Cards", id: 80017361, url: "https://www.netflix.com/watch/80017361" },
  { season: "Season 7", episode: "10", title: "The Panic Attacks", id: 81198219 },
  { season: "Season 7", episode: "9", title: "The Prediction", id: 81198218 },
  { season: "Season 1", episode: "2", title: "The Credit Cards", id: 80017361 },   // the list scrolled twice over the same card: once
  { season: "Season 1", episode: "3", title: "", id: 80017362 },                    // no title: not an episode anyone can pick
];

describe("the Episodes menu (2026-09-22)", () => {
  it("groups the service's own list into seasons, in order, each episode once with the service's own id", () => {
    const s = seasonsFrom(listed);
    expect(s.map((x) => x.label)).toEqual(["Season 1", "Season 7"]);
    expect(s[0]!.episodes.map((e) => [e.episode, e.title, e.id])).toEqual([[1, "The End", "80017360"], [2, "The Credit Cards", "80017361"]]);
    expect(s[1]!.episodes.map((e) => e.episode)).toEqual([9, 10]);
    expect(s[0]!.episodes[0]).toMatchObject({ synopsis: "Grace and Frankie are stunned...", duration: "35m", url: "https://www.netflix.com/watch/80017360" });
    expect(seasonsFrom(null)).toEqual([]);
  });
  it("Specials come last; a season given as a number is labeled", () => {
    const s = seasonsFrom([{ season: "Specials", episode: 1, title: "Behind", id: "a" }, { season: 2, episode: 1, title: "Two", id: "b" }]);
    expect(s.map((x) => [x.season, x.label])).toEqual([[2, "Season 2"], [0, "Specials"]]);
  });
  it("the star goes to the episode playing: the service's own id first, then the season and episode the page names", () => {
    const s = seasonsFrom(listed);
    expect(currentEpisode(s, { id: "81198218" })).toEqual({ season: 7, episode: 9 });
    expect(currentEpisode(s, { id: "nope", season: 1, episode: 2 })).toEqual({ season: 1, episode: 2 });
    expect(currentEpisode(s, { episode: 10, title: "The Panic Attacks" })).toEqual({ season: 7, episode: 10 });   // Netflix names the episode alone
    expect(currentEpisode(s, {})).toBe(null);
  });
  it("a series is matched by its name as the service writes it - Hulu's search result alt text included", () => {
    expect(seriesKey("Cover art for The Rookie.")).toBe(seriesKey("The Rookie"));
    expect(seriesKey("Law & Order")).toBe(seriesKey("Law and Order"));
    expect(seriesKey("Rookie Cops")).not.toBe(seriesKey("The Rookie"));
  });
});
