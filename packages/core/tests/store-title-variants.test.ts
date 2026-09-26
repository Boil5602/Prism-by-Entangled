import { describe, expect, it } from "vitest";
import { storeTitleVariants } from "../src/lenses.js";

// 2026-09-24: seven Movies Anywhere titles had no picture - the store's names are not TMDB's.
describe("a store's title spelled TMDB's way", () => {
  it("the library's inverted article", () => {
    expect(storeTitleVariants("WOLFMAN, THE")).toContain("THE WOLFMAN");
  });
  it("studio labels in front, as many as there are", () => {
    expect(storeTitleVariants("DCU: Batman: The Dark Knight Returns - Part 1")).toContain("Batman: The Dark Knight Returns - Part 1");
    expect(storeTitleVariants("Illumination Presents: Dr. Seuss' The Grinch")).toContain("The Grinch");
  });
  it("a bundle's extras", () => {
    expect(storeTitleVariants("Olaf's Frozen Adventure Plus 6 Disney Tales")).toContain("Olaf's Frozen Adventure");
  });
  it("a sequel number before the subtitle", () => {
    expect(storeTitleVariants("Mad Max 3: Beyond Thunderdome")).toContain("Mad Max Beyond Thunderdome");
  });
  it("the subtitle's missing article", () => {
    expect(storeTitleVariants("Pirates of the Caribbean: Curse of the Black Pearl")).toContain("Pirates of the Caribbean: The Curse of the Black Pearl");
  });
  it("': The Movie'", () => {
    expect(storeTitleVariants("Scooby-Doo: The Movie")).toContain("Scooby-Doo");
  });
  it("a plain title gives nothing to try", () => {
    expect(storeTitleVariants("Serenity")).toEqual([]);
    expect(storeTitleVariants("The Rookie")).toEqual([]);
  });
});
