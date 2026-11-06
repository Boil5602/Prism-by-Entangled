import { describe, expect, it } from "vitest";
import { pickTitleHit } from "../src/video-lookup.js";

// 2026-10-09: Star Trek: Strange New Worlds dropped on a window from the watchlist. Paramount+'s search named two results so - its live
// Star Trek channel, airing the show, and the series - and the first was played: a channel tune that timed out on the service's page.
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() && a.length > 0;
const live = { id: "/live-tv/stream/channels/star-trek/x/", title: "Star Trek: Strange New Worlds", kind: "live" };
const series = { id: "/shows/star-trek-strange-new-worlds/", title: "Star Trek: Strange New Worlds", kind: "series" };

describe("which search result is the title a card names", () => {
  it("a series is the series, not the live channel of its name, whichever the service lists first", () => {
    expect(pickTitleHit([live, series], "Star Trek: Strange New Worlds", "series", same)).toBe(series);
    expect(pickTitleHit([series, live], "star trek: strange new worlds", "tv", same)).toBe(series);
  });
  it("a film is the film before a series of its name, and a result of no stated kind is as good as either", () => {
    const film = { id: "m1", title: "Dark", kind: "movie" }, show = { id: "s1", title: "Dark", kind: "series" }, plain = { id: "t1", title: "Dark", kind: "title" };
    expect(pickTitleHit([show, film], "Dark", "movie", same)).toBe(film);
    expect(pickTitleHit([plain, film], "Dark", "movie", same)).toBe(plain);
    expect(pickTitleHit([show, film], "Dark", undefined, same)).toBe(show);   // no kind asked for: the service's own order
  });
  it("only a live channel carries the name: it is what there is; nothing named so: an episode of that series, else nothing", () => {
    expect(pickTitleHit([live], "Star Trek: Strange New Worlds", "series", same)).toBe(live);
    const ep = { id: "e1", title: "Pilot", kind: "episode", series: "Severance" };
    expect(pickTitleHit([ep], "Severance", "series", same)).toBe(ep);
    expect(pickTitleHit([ep], "Dark", "series", same)).toBeNull();
  });
});
