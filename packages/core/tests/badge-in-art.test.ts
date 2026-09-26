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
