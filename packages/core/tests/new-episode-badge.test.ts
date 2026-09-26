import { describe, expect, it } from "vitest";
import { bannerDay, newEpisodeBadge, orderAlphabetical } from "../src/menu-order.js";

describe("newEpisodeBadge", () => {
  const now = new Date(2026, 8, 23, 19, 0).getTime();   // Sep 23 2026, evening
  it("names an episode aired in the last ten days (2026-09-24, was seven), and its source", () => {
    expect(newEpisodeBadge("2026-09-23", now)).toBe("New Sep 23");
    expect(newEpisodeBadge("2026-09-16", now)).toBe("New Sep 16");
    expect(newEpisodeBadge("2026-09-13", now)).toBe("New Sep 13");
  });
  it("says nothing for an older one, a future date or no date", () => {
    expect(newEpisodeBadge("2026-09-12", now)).toBeNull();
    expect(newEpisodeBadge("2026-09-30", now)).toBeNull();
    expect(newEpisodeBadge(null, now)).toBeNull();
    expect(newEpisodeBadge("soon", now)).toBeNull();
  });
  it("sorts a TMDB-bannered card with the service-bannered ones", () => {
    const row = { app: "a", name: "A", facet: "f", items: [
      { id: "1", title: "Alpha", kind: "series", url: null, artwork: null, subtitle: null, progress: null },
      { id: "2", title: "Zulu", kind: "series", url: null, artwork: null, subtitle: null, progress: null, badge: "New Sep 21", badgeFrom: "tmdb" as const },
    ] };
    expect(orderAlphabetical([row], [], {}, now).map((c) => c.item.title)).toEqual(["Zulu", "Alpha"]);
  });
  it("TMDB's new episodes first, the one aired longest ago first; then the services' banners A to Z; then the rest (2026-09-24)", () => {
    const it = (id: string, title: string, badge?: string, tmdb = false) => ({ id, title, kind: "series", url: null, artwork: null, subtitle: null, progress: null, ...(badge ? { badge } : {}), ...(tmdb ? { badgeFrom: "tmdb" as const } : {}) });
    const row = { app: "a", name: "A", facet: "f", items: [
      it("1", "Alpha"), it("2", "Beta", "New Sep 22", true), it("3", "Gamma", "New Season"), it("4", "Delta", "New Sep 14", true), it("5", "Aardvark", "Leaving Soon"),
    ] };
    expect(orderAlphabetical([row], [], {}, now).map((c) => c.item.title)).toEqual(["Delta", "Beta", "Aardvark", "Gamma", "Alpha"]);
  });
});

import { isAwardBadge } from "../src/menu-order.js";
describe("isAwardBadge", () => {
  it("knows an awards banner from news", () => {
    expect(isAwardBadge("Emmy Winner")).toBe(true);
    expect(isAwardBadge("Oscar Nominee")).toBe(true);
    expect(isAwardBadge("Golden Globe Nominated")).toBe(true);
    expect(isAwardBadge("New Season Coming Soon")).toBe(false);
    expect(isAwardBadge("Expires Sun")).toBe(false);
    expect(isAwardBadge("Top 10")).toBe(false);
  });
});

import { foldSameTitle } from "../src/menu-order.js";
describe("foldSameTitle", () => {
  it("makes one card per title, the other services as choices, a banner carried over", () => {
    const it = (id: string, title: string, badge?: string) => ({ id, title, kind: "series", url: null, artwork: null, subtitle: null, progress: null, ...(badge ? { badge } : {}) });
    const c = (app: string, item: ReturnType<typeof it>) => ({ app, service: app.toUpperCase(), facet: app + "-f", item, recency: { kind: "none" as const } });
    const out = foldSameTitle([c("paramount", it("1", "South Park")), c("hbo", it("2", "The Wire")), c("hulu", it("3", "South Park", "New Sep 16"))] as never);
    expect(out.map((x) => x.item.title)).toEqual(["South Park", "The Wire"]);
    expect(out[0]!.also?.map((a) => a.app)).toEqual(["hulu"]);
    expect(out[0]!.item.badge).toBe("New Sep 16");
  });
});

describe("bannerDay", () => {
  it("reads the day a TMDB banner names, the most recent one on or before today", () => {
    const jan3 = new Date(2027, 0, 3, 9).getTime();
    expect(new Date(bannerDay("New Dec 30", jan3)!).getFullYear()).toBe(2026);
    expect(new Date(bannerDay("New Jan 2", jan3)!).getDate()).toBe(2);
    expect(bannerDay("New Season", jan3)).toBeNull();
    expect(bannerDay(undefined, jan3)).toBeNull();
  });
});
