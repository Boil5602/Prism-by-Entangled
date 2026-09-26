import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { titlesFromSearch } from "../src/catalog-search.js";
import { searchWorks } from "../src/search-view.js";
import type { Drivers } from "../src/drivers.js";

// 2026-09-24: TMDB's rating on every title ("Would prefer to see these on every title"), and Watch's catalog rows kept on the device
// across a relaunch ("It seems like it doesnt retain any history on close and relaunch").

function drivers(kv = new Map<string, string>()): Drivers {
  return {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("TMDB's rating on every title", () => {
  it("a search answer's title carries TMDB's rating as the cards show it; none without votes", () => {
    const t = titlesFromSearch([
      { media_type: "movie", id: 1, title: "Serenity", release_date: "2005-09-30", vote_average: 7.4, vote_count: 4312 },
      { media_type: "movie", id: 2, title: "Brand New", release_date: "2026-09-20", vote_average: 0, vote_count: 0 },
    ]);
    expect(t[0]!.rating).toBe("★ 7.4 · TMDB · 4.3k votes");
    expect(t[1]!.rating).toBeUndefined();
  });

  it("a search work takes the rating of the first answer that has one", () => {
    const works = searchWorks("firefly", [
      { app: "hulu", name: "Hulu", facet: "h", candidate: { id: "tmdb:tv:1437", title: "Firefly", kind: "series" } },
      { app: "disney", name: "Disney+", facet: "d", candidate: { id: "tmdb:tv:1437", title: "Firefly", kind: "series", rating: "★ 8.3 · TMDB · 2.6k votes" } },
    ]);
    expect(works[0]!.rating).toBe("★ 8.3 · TMDB · 2.6k votes");
    expect(searchWorks("x", [{ app: "a", name: "A", facet: "a", candidate: { id: "q", title: "X" } }])[0]!.rating).toBeNull();
  });
});

describe("Watch's catalog rows kept on the device", () => {
  const services = [{ app: "hulu", name: "Hulu", facet: "h", adapter: "hulu", status: "signed-in" }];
  const card = (id: string, title: string) => ({ id, kind: "movie", title, value: "1k reads · Wikipedia · 7 days", reads: 1000, services: [{ app: "hulu", name: "Hulu", facet: "h", offer: "Included" }] });
  const setup = (kv: Map<string, string>) => {
    const o = new Orchestrator(drivers(kv));
    o.setAdapters({ hulu: { id: "hulu", match: ["www.hulu.com"], tmdbProviders: [15] } as never });
    o.lensSetTmdbKey("test-key");
    return o;
  };

  it("a relaunch opens with the last Most read row, read back from the store; Watch is 'warming' until it is in", async () => {
    const kv = new Map<string, string>();
    kv.set(Orchestrator.ROWS_CACHE_KEY, JSON.stringify({ mr: { "included|15|hulu": { at: Date.now(), done: true, cards: [card("tmdb:movie:1", "Serenity"), card("tmdb:movie:2", "Slither")], through: "2026-09-23", read: 58 } }, fr: {} }));
    const o = setup(kv);
    expect(o.videoMostRead(services, "included", [])).toBeNull();   // the store is being read
    expect(o.videoWarming()).toBe(true);
    await tick(); await tick();
    expect(o.videoWarming()).toBe(false);
    const e = o.videoMostRead(services, "included", []);
    expect(e?.cards.map((c) => c.title)).toEqual(["Serenity", "Slither"]);
    expect(e?.done).toBe(true);
  });

  it("a row kept mid-read (a restart while it was being read) comes back shown and due - read again, not counted as finished for a day", async () => {
    const kv = new Map<string, string>();
    kv.set(Orchestrator.ROWS_CACHE_KEY, JSON.stringify({ mr: { "included|15|hulu": { at: Date.now(), done: false, cards: [card("tmdb:movie:1", "Serenity")], through: "2026-09-23", read: 12 } }, fr: {} }));
    const o = setup(kv);
    o.videoMostRead(services, "included", []);
    await tick(); await tick();
    const e = o.videoMostRead(services, "included", []);
    expect(e?.cards.map((c) => c.title)).toEqual(["Serenity"]);   // the half row shows at once
    expect(e?.done).toBe(false);                                   // and a read is under way again
  });

  it("nothing kept: an empty store is a fresh start, not an error", async () => {
    const o = setup(new Map());
    expect(o.videoMostRead(services, "included", [])).toBeNull();
    await tick(); await tick();
    expect(o.videoWarming()).toBe(false);
  });

  it("a kept row that is unreadable is ignored", async () => {
    const kv = new Map<string, string>([[Orchestrator.ROWS_CACHE_KEY, "{not json"]]);
    const o = setup(kv);
    o.videoMostRead(services, "included", []);
    await tick(); await tick();
    expect(o.videoWarming()).toBe(false);
  });
});
