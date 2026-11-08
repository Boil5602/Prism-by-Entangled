import { describe, expect, it } from "vitest";
import { fillItemAddress, fillHome, onServiceSite } from "../src/adapters.js";

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

describe("fillHome (a self-hosted service's pages against the App's own address, 2026-11-03)", () => {
  it("puts the home, up to its fragment, where {home} stands", () => {
    expect(fillHome("{home}#/search?query=night", "http://nas:8096/web/#/home")).toBe("http://nas:8096/web/#/search?query=night");
    expect(fillHome("{home}#/home?tab=1", "https://jf.example.org/web/")).toBe("https://jf.example.org/web/#/home?tab=1");
  });
  it("leaves a plain address alone and is null for a template with no home to fill", () => {
    expect(fillHome("https://tubitv.com/my-stuff", null)).toBe("https://tubitv.com/my-stuff");
    expect(fillHome("{home}#/search", null)).toBeNull();
  });
  it("onServiceSite takes plain http only on the very host of an http home", () => {
    expect(onServiceSite("http://nas:8096/web/#/details?id=1", ["demo.jellyfin.org", "http://nas:8096/web/#/home"])).toBe(true);
    expect(onServiceSite("http://other:8096/web/", ["demo.jellyfin.org", "http://nas:8096/web/#/home"])).toBe(false);
    expect(onServiceSite("http://www.hulu.com/", ["hulu.com", "https://www.hulu.com/hub/home"])).toBe(false);
    expect(onServiceSite("https://play.hulu.com/x", ["hulu.com", "https://www.hulu.com/hub/home"])).toBe(true);
  });
});
