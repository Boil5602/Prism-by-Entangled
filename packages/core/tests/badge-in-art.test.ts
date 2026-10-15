import { describe, expect, it } from "vitest";
import { cleanLibrary } from "../src/video.js";

// 2026-09-24 ("Yes fix em!"): Netflix draws a card's badge into its box art; the adapter says so, and the badge still orders My List
// while the host does not draw it a second time.
describe("a badge drawn in the service's own picture", () => {
  it("is kept with the badge, and only with one", () => {
    const lib = cleanLibrary({ list: [
      { id: "1", title: "DANG!", badge: "Recently Added", badgeInArt: true },
      { id: "2", title: "Futurama", badge: "New Season" },
      { id: "3", title: "Plain", badgeInArt: true },
    ] });
    expect(lib.list[0]).toMatchObject({ badge: "Recently Added", badgeInArt: true });
    expect(lib.list[1]!.badgeInArt).toBeUndefined();
    expect(lib.list[2]!.badgeInArt).toBeUndefined();
  });
});

describe("a service's own count of what is new (YouTube TV's '7 new episodes this week', 2026-10-14)", () => {
  it("keeps badgeFrom count through the library cleaner, and nothing else as a source", () => {
    const lib = cleanLibrary({ own: [{ title: "New in your library", items: [
      { id: "a", title: "Good Morning America", kind: "series", subtitle: "7 new episodes this week", badge: "7 New", badgeFrom: "count" },
      { id: "b", title: "Nightline", kind: "series", badge: "New Season", badgeFrom: "tmdb" },
    ] }] });
    expect(lib.own[0]!.items[0]).toMatchObject({ badge: "7 New", badgeFrom: "count" });
    expect(lib.own[0]!.items[1]!.badgeFrom).toBeUndefined();   // only core marks TMDB's ribbons
  });
});
