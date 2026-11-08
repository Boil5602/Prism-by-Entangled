import { describe, it, expect } from "vitest";
import { Orchestrator } from "../src/orchestrator";
import type { Drivers } from "../src/drivers";

// The music search's suggestions (2026-11-04): Deezer's public search as the words are typed, the words and nothing else; off by the switch.
const surface = { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {} };

function deezer(asked: string[]) {
  return async (url: string): Promise<string> => {
    asked.push(url);
    const u = new URL(url);
    const q = u.searchParams.get("q") ?? "";
    if (u.pathname === "/search") return JSON.stringify({ data: [
      { id: 1, title: "Hyperactive", isrc: "US3SS1100008", duration: 182, artist: { name: "Forrest Day" }, album: { title: "Forrest Day", cover_small: "https://cdn-images.dzcdn.net/s.jpg", cover_medium: "https://cdn-images.dzcdn.net/m.jpg" } },
      { id: 2, title: "Hyperactive!", artist: { name: "Thomas Dolby" }, album: { title: "The Flat Earth" } },
      { id: 3, title: "", artist: { name: "nobody" } },
    ], total: 3 });
    if (u.pathname === "/search/album") return JSON.stringify({ data: [{ id: 9, title: "Forrest Day", artist: { name: "Forrest Day" }, cover_small: "https://cdn-images.dzcdn.net/a.jpg" }] });
    if (u.pathname === "/search/artist") return JSON.stringify({ data: [{ id: 7, name: "Forrest Day " + q.length, picture_small: "https://cdn-images.dzcdn.net/p.jpg" }] });
    return "{}";
  };
}

function make(store: Record<string, string>, asked: string[]) {
  return new Orchestrator({ surface, store: { get: (k: string) => store[k] ?? null, set: (k: string, v: string) => { store[k] = v; } }, net: { fetchStatic: async () => { throw new Error("no"); }, fetchKeyed: deezer(asked) } } as unknown as Drivers);
}

describe("music suggestions (Deezer)", () => {
  it("asks with the words and nothing else, and gives songs, albums and artists", async () => {
    const asked: string[] = [];
    const o = make({}, asked);
    await o.musicSuggest("  hyperactive forrest day ");
    const s = o.musicSuggestState();
    expect(s.q).toBe("hyperactive forrest day");
    expect(s.working).toBe(false);
    expect(asked.length).toBe(3);
    for (const u of asked) { const p = new URL(u); expect(p.host).toBe("api.deezer.com"); expect([...p.searchParams.keys()].sort()).toEqual(["limit", "q"]); expect(p.searchParams.get("q")).toBe("hyperactive forrest day"); }
    expect(s.songs.map((x) => x.title)).toEqual(["Hyperactive", "Hyperactive!"]);   // the empty title dropped
    expect(s.songs[0]).toMatchObject({ artist: "Forrest Day", album: "Forrest Day", artwork: "https://cdn-images.dzcdn.net/m.jpg", isrc: "US3SS1100008", duration: 182 });
    expect(s.songs[1].artwork).toBeUndefined();
    expect(s.albums).toEqual([{ title: "Forrest Day", artist: "Forrest Day", artwork: "https://cdn-images.dzcdn.net/a.jpg" }]);
    expect(s.artists[0].name.startsWith("Forrest Day")).toBe(true);
  });
  it("one letter is nothing; the switch off asks no one and says so", async () => {
    const asked: string[] = [];
    const o = make({}, asked);
    await o.musicSuggest("h");
    expect(o.musicSuggestState().songs).toEqual([]);
    expect(asked.length).toBe(0);
    await o.musicSetSuggestions(false);
    await o.musicSuggest("hyperactive");
    expect(o.musicSuggestState()).toMatchObject({ q: "hyperactive", off: true, songs: [] });
    expect(asked.length).toBe(0);
    await o.musicSetSuggestions(true);
    await o.musicSuggest("hyperactive");
    expect(asked.length).toBe(3);
  });
  it("the newer words win; a refusal is an error the panel can show", async () => {
    const asked: string[] = [];
    const o = make({}, asked);
    const first = o.musicSuggest("hyper");
    await o.musicSuggest("hyperactive");
    await first;
    expect(o.musicSuggestState().q).toBe("hyperactive");
    const bad = new Orchestrator({ surface, store: { get: () => null, set: () => {} }, net: { fetchStatic: async () => { throw new Error("no"); }, fetchKeyed: async () => { throw new Error("429"); } } } as unknown as Drivers);
    await bad.musicSuggest("hyperactive");
    expect(bad.musicSuggestState()).toMatchObject({ working: false, error: "429", songs: [] });
  });
  it("the order is one stated rule: match to the words, then A to Z", () => {
    const r = (q: string, t: string, a = "", b = "") => Orchestrator.musicMatchRank(q, t, a, b);
    expect(r("hyperactive", "Hyperactive", "Forrest Day")).toBe(0);
    expect(r("hyperactive forrest day", "Hyperactive", "Forrest Day")).toBe(0);
    expect(r("forrest day", "Sleepwalk", "Forrest Day")).toBe(0);   // the artist named exactly
    expect(r("hyper", "Hyperactive!", "Thomas Dolby")).toBe(1);
    expect(r("day forrest", "Hyperactive", "Forrest Day")).toBe(2);
    expect(r("hyperactive", "Hyperactive!", "Thomas Dolby")).toBe(0);   // punctuation is not a difference
    expect(r("hyperactive forrest", "Hyperactive!", "Thomas Dolby")).toBe(3);
    const rows = Orchestrator.musicOrder("day", [["Zebra", "Day"], ["Day", "Someone"], ["A Day Off", "Anyone"], ["Day", "Another"]], (x) => [x[0], x[1], ""]);
    // the artist named exactly ranks with the titles named exactly (rank 0), A to Z among them; "A Day Off" only contains the word
    expect(rows).toEqual([["Day", "Another"], ["Day", "Someone"], ["Zebra", "Day"], ["A Day Off", "Anyone"]]);
  });
  it("an artist named exactly leads the songs", async () => {
    const asked: string[] = [];
    const o = make({}, asked);
    await o.musicSuggest("Forrest Day 14");   // the mock names the artist "Forrest Day " + the words' length
    expect(o.musicSuggestState().lead).toBe("artists");
    await o.musicSuggest("hyperactive forrest day");
    expect(o.musicSuggestState().lead).toBeUndefined();
  });
});
