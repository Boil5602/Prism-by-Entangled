import { describe, expect, it } from "vitest";
import { fillItemAddress } from "../src/adapters.js";

describe("fillItemAddress", () => {
  const ep = "https://tv.apple.com/us/episode/pilot/umc.cmc.ep1?showId=umc.cmc.show9";
  it("fills {id}, {url} and a query parameter of the card's address", () => {
    expect(fillItemAddress("https://www.hulu.com/series/{id}", "a b", null)).toBe("https://www.hulu.com/series/a%20b");
    expect(fillItemAddress("{url}", "x", ep)).toBe(ep);
    expect(fillItemAddress("https://tv.apple.com/us/show/x/{param:showId}", "umc.cmc.ep1", ep)).toBe("https://tv.apple.com/us/show/x/umc.cmc.show9");
  });
  it("is null when the card lacks what the template names, so the next template is tried", () => {
    expect(fillItemAddress("{url}", "x", null)).toBeNull();
    expect(fillItemAddress("https://tv.apple.com/us/show/x/{param:showId}", "m", "https://tv.apple.com/us/movie/eternity/umc.cmc.m1")).toBeNull();
    expect(fillItemAddress("https://tv.apple.com/us/show/x/{param:showId}", "m", null)).toBeNull();
  });
  it("leaves a plain address alone", () => {
    expect(fillItemAddress("https://tv.apple.com/us/shelf/continue", "x", null)).toBe("https://tv.apple.com/us/shelf/continue");
  });
});
