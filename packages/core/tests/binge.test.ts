import { describe, expect, it } from "vitest";
import { BINGE_DEFAULTS, KIDS_AGES, bingeChecks, bingeDay, bingeEligible, bingeGenreRows, bingeSettingsOf, bingeWords, kidsAllows, seededShuffle, selectBinge, type BingeCandidate } from "../src/binge.js";

// The Binge (docs/features/the-binge.md): ordering is pure over its inputs; same seed = same order; no title without a signed-in provider;
// each age shows only its mapped ratings; unrated excluded in Kids mode.

const svc = [{ app: "hulu", name: "Hulu", facet: "h", offer: "Included" }];
const cand = (id: number, o: Partial<BingeCandidate> & { title?: string } = {}): BingeCandidate => ({
  card: { id: "tmdb:tv:" + id, kind: "series", title: o.title ?? "Show " + id, value: "", services: svc },
  genres: ["Comedy"], mean: 8, votes: 1000, runtime: 22, episodes: 120, type: "Scripted", keywords: [], certification: "TV-PG",
  ...o,
});

describe("The Binge - eligibility", () => {
  it("every criterion must hold, at the default thresholds", () => {
    expect(bingeEligible(cand(1))).toBe(true);
    expect(bingeEligible(cand(2, { runtime: 45 }))).toBe(false);          // an hour-long drama
    expect(bingeEligible(cand(3, { runtime: null }))).toBe(false);        // no runtime known: not counted as short
    expect(bingeEligible(cand(4, { episodes: 40 }))).toBe(false);
    expect(bingeEligible(cand(5, { type: "Miniseries" }))).toBe(false);
    expect(bingeEligible(cand(6, { type: "Reality" }))).toBe(false);
    expect(bingeEligible(cand(7, { type: "Reality", genres: ["Animation"] }))).toBe(true);   // animated counts as scripted-or-animated
    expect(bingeEligible(cand(8, { keywords: ["serialized"] }))).toBe(false);
    expect(bingeEligible(cand(9, { mean: 6.9 }))).toBe(false);
    expect(bingeEligible(cand(10, { votes: 499 }))).toBe(false);
  });
  it("nothing that cannot be played here: a title on none of the signed-in services is never eligible", () => {
    const c = cand(11, {});
    c.card = { ...c.card, services: [] };
    expect(bingeChecks(c).available).toBe(false);
    expect(selectBinge([c], { day: "2026-09-24" })).toEqual([]);
  });
  it("the thresholds are the household's", () => {
    expect(bingeEligible(cand(12, { runtime: 45 }), { ...BINGE_DEFAULTS, maxRuntime: 60 })).toBe(true);
    expect(bingeWords({ ...BINGE_DEFAULTS, maxRuntime: 25, minEpisodes: 100 }).label).toContain("≤25-min, 100+ episode");
  });
});

describe("The Binge - kids mode", () => {
  it("each age shows only its mapped ratings; off shows all, TV-MA included", () => {
    const allowed = (age: string) => ["TV-Y", "TV-G", "TV-Y7", "TV-PG", "TV-14", "TV-MA"].filter((r) => kidsAllows(r, { on: true, age: age as never }));
    expect(allowed("under7")).toEqual(["TV-Y", "TV-G"]);
    expect(allowed("under10")).toEqual(["TV-Y", "TV-G", "TV-Y7"]);
    expect(allowed("under14")).toEqual(["TV-Y", "TV-G", "TV-Y7", "TV-PG"]);
    expect(allowed("under17")).toEqual(["TV-Y", "TV-G", "TV-Y7", "TV-PG", "TV-14"]);
    expect(kidsAllows("TV-MA", { on: false, age: "under7" })).toBe(true);
    expect(KIDS_AGES.map((a) => a.label)).toEqual(["Under 7", "Under 10", "Under 14", "Under 17"]);
  });
  it("an unrated title is hidden while kids mode is on", () => {
    expect(kidsAllows(null, { on: true, age: "under17" })).toBe(false);
    expect(kidsAllows(null, { on: false, age: "under17" })).toBe(true);
    const list = [cand(1, { certification: null }), cand(2, { certification: "TV-Y" })];
    expect(selectBinge(list, { day: "d", kids: { on: true, age: "under7" } }).map((c) => c.card.id)).toEqual(["tmdb:tv:2"]);
  });
});

describe("The Binge - order", () => {
  const many = Array.from({ length: 80 }, (_, i) => cand(i + 1, { mean: 7 + (i % 30) / 10, votes: 500 + i }));
  it("every eligible series, shuffled - the same seed gives the same order, another day another (no limit since 2026-09-24)", () => {
    const a = selectBinge(many, { day: "2026-09-24" });
    const b = selectBinge(many, { day: "2026-09-24" });
    const c = selectBinge(many, { day: "2026-09-25" });
    expect(a.length).toBe(80);
    expect(selectBinge(many, { day: "2026-09-24", thresholds: { ...BINGE_DEFAULTS, top: 50 } }).length).toBe(50);   // a limit still cuts by rating when one is given
    expect(a.map((x) => x.card.id)).toEqual(b.map((x) => x.card.id));
    expect(a.map((x) => x.card.id)).not.toEqual(c.map((x) => x.card.id));
    const minTop = Math.min(...a.map((x) => x.mean!));
    expect(many.filter((x) => x.mean! > minTop).every((x) => a.includes(x))).toBe(true);   // nothing better was left out
  });
  it("a hidden title (or one found missing on its service) is left out", () => {
    const out = selectBinge([cand(1), cand(2)], { day: "d", hidden: new Set(["tmdb:tv:1"]) });
    expect(out.map((c) => c.card.id)).toEqual(["tmdb:tv:2"]);
  });
  it("the full view: one row per genre present, each its own shuffle, empty genres left out", () => {
    const list = [cand(1, { genres: ["Comedy", "Animation"] }), cand(2, { genres: ["Comedy"] }), cand(3, { genres: ["Drama"], runtime: 50 })];
    const rows = bingeGenreRows(list, { day: "d" });
    expect(rows.map((r) => r.genre)).toEqual(["Animation", "Comedy"]);   // Drama's only title is too long: its row is empty and hidden
    expect(rows.find((r) => r.genre === "Comedy")!.items.length).toBe(2);
  });
  it("the shuffle itself is pure", () => {
    expect(seededShuffle([1, 2, 3, 4, 5], "x")).toEqual(seededShuffle([1, 2, 3, 4, 5], "x"));
    expect(bingeDay(new Date(2026, 8, 24, 23, 59).getTime())).toBe("2026-09-24");
  });
});

describe("The Binge - settings", () => {
  it("kept thresholds and kids mode are checked; a bad field falls back to its default", () => {
    expect(bingeSettingsOf(null)).toEqual({ thresholds: BINGE_DEFAULTS, kids: { on: false, age: "under10" }, animation: true });
    expect(bingeSettingsOf({ animation: false }).animation).toBe(false);
    const s = bingeSettingsOf({ thresholds: { maxRuntime: 25, minEpisodes: "lots", top: 9999 }, kids: { on: true, age: "under14" } });
    expect(s.thresholds).toEqual({ ...BINGE_DEFAULTS, maxRuntime: 25 });
    expect(s.kids).toEqual({ on: true, age: "under14" });
  });
});

// ---- the reads and the kept state (runtime + orchestrator)
import { afterEach, beforeEach, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const surface = { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {} };

// TMDB as the mock answers it: two short long-running comedies on Hulu (15), one on a service the household has not got (8)
function tmdb(keyed: string[]) {
  return async (url: string): Promise<string> => {
    keyed.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/discover/tv")) return JSON.stringify({ total_pages: 1, results: [
      { id: 1, name: "Parks", first_air_date: "2009-04-09", vote_average: 8.0, vote_count: 3000, genre_ids: [35] },
      { id: 2, name: "Elsewhere", first_air_date: "2005-01-01", vote_average: 8.5, vote_count: 3000, genre_ids: [35] },
      { id: 3, name: "Toons", first_air_date: "1999-01-01", vote_average: 7.5, vote_count: 900, genre_ids: [16] },
    ] });
    const prov = /\/tv\/(\d+)\/watch\/providers$/.exec(u.pathname);
    if (prov) return JSON.stringify({ results: { US: { flatrate: [{ provider_id: prov[1] === "2" ? 8 : 15 }] } } });
    const det = /\/tv\/(\d+)$/.exec(u.pathname);
    if (det) {
      const id = Number(det[1]);
      return JSON.stringify({ id, vote_average: id === 3 ? 7.5 : 8, vote_count: 3000, episode_run_time: [22], number_of_episodes: 125, type: id === 3 ? "Animation" : "Scripted",
        genres: [{ id: id === 3 ? 16 : 35, name: id === 3 ? "Animation" : "Comedy" }], keywords: { results: [{ name: "sitcom" }] },
        content_ratings: { results: [{ iso_3166_1: "US", rating: id === 3 ? "TV-Y7" : "TV-14" }] } });
    }
    return "{}";
  };
}

describe("The Binge - the read", () => {
  const services = [{ app: "hulu", name: "Hulu", facet: "h", adapter: "hulu", status: "signed-in" }];
  it("no TMDB call at all when no key is set", async () => {
    const keyed: string[] = [];
    const o = new Orchestrator({ surface, store: { get: () => null, set: () => {} }, net: { fetchStatic: async () => { throw new Error("no"); }, fetchKeyed: tmdb(keyed) } } as Drivers);
    o.setAdapters({ hulu: { id: "hulu", match: ["www.hulu.com"], tmdbProviders: [15] } as never });
    expect(o.videoBinge(services, "included", BINGE_DEFAULTS)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(keyed).toEqual([]);
  });
  it("with a key: each series' details read, and only the titles on a signed-in service kept", async () => {
    const keyed: string[] = [];
    const o = new Orchestrator({ surface, store: { get: () => null, set: () => {} }, net: { fetchStatic: async () => { throw new Error("no"); }, fetchKeyed: tmdb(keyed) } } as Drivers);
    o.setAdapters({ hulu: { id: "hulu", match: ["www.hulu.com"], tmdbProviders: [15] } as never });
    o.lensSetTmdbKey("test-key");
    o.videoBinge(services, "included", BINGE_DEFAULTS);   // the kept rows are read first
    await new Promise((r) => setTimeout(r, 5));
    const e = o.videoBinge(services, "included", BINGE_DEFAULTS)!;
    for (let i = 0; i < 50 && !e.done; i++) await new Promise((r) => setTimeout(r, 5));
    expect(e.done).toBe(true);
    expect(keyed.some((u) => u.includes("/discover/tv") && u.includes("with_runtime.lte=30") && u.includes("vote_count.gte=500"))).toBe(true);
    expect(e.cands.map((c) => c.card.title).sort()).toEqual(["Parks", "Toons"]);   // Elsewhere is on no service here
    const toons = e.cands.find((c) => c.card.title === "Toons")!;
    expect(toons).toMatchObject({ runtime: 22, episodes: 125, certification: "TV-Y7", genres: ["Animation"], keywords: ["sitcom"] });
    expect(selectBinge(e.cands, { day: "d", kids: { on: true, age: "under10" } }).map((c) => c.card.title)).toEqual(["Toons"]);
  });
});

describe("The Binge - kept on the device", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const boot = async (kv: Map<string, string>, keyed: string[]) => {
    const rt = createRuntime({ surface, store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) }, net: { fetchStatic: async () => { throw new Error("no"); }, fetchKeyed: tmdb(keyed) } } as Drivers);
    rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {} }));
    await vi.advanceTimersByTimeAsync(50);
    return rt;
  };
  it("kids mode and the thresholds persist across a restart", async () => {
    const kv = new Map<string, string>();
    const a = await boot(kv, []);
    expect(JSON.parse(a.videoBingeSet(JSON.stringify({ maxRuntime: 25 }), JSON.stringify({ on: true, age: "under7" })))).toMatchObject({ ok: true, kids: { on: true, age: "under7" } });
    const b = await boot(kv, []);
    const v = JSON.parse(b.videoBingeView());
    expect(v.kids).toEqual({ on: true, age: "under7" });
    expect(v.head.thresholds.maxRuntime).toBe(25);
    expect(v.head.label).toContain("≤25-min");
    expect(v.caveat).toContain("TV-PG has no official age");
  });
  it("without a key: the menu has no Binge row and TMDB is never asked", async () => {
    const keyed: string[] = [];
    const rt = await boot(new Map(), keyed);
    const m = JSON.parse(rt.videoMenu());
    expect(m.lensRows.some((r: { id: string }) => r.id === "the-binge")).toBe(false);
    expect(JSON.parse(rt.videoBingeView()).genres).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(keyed).toEqual([]);
  });
  it("a hidden title is kept hidden, and shown again on ask", async () => {
    const kv = new Map<string, string>();
    const rt = await boot(kv, []);
    rt.videoBingeHide("tmdb:tv:1", true);
    expect(JSON.parse(kv.get("video:binge-hidden")!)).toMatchObject([{ id: "tmdb:tv:1", why: "hidden" }]);
    rt.videoBingeHide("tmdb:tv:1", false);
    expect(JSON.parse(kv.get("video:binge-hidden")!)).toEqual([]);
  });
  it("the hidden list names each title, newest first, and a title shown again leaves it", async () => {
    const rt = await boot(new Map(), []);
    rt.videoBingeHide("tmdb:tv:1", true, "Parks and Recreation");
    await vi.advanceTimersByTimeAsync(10);
    rt.videoBingeHide("tmdb:tv:2", true, "Seinfeld");
    expect(JSON.parse(rt.videoBingeHidden()).items).toMatchObject([{ id: "tmdb:tv:2", title: "Seinfeld", why: "hidden", until: null }, { id: "tmdb:tv:1", title: "Parks and Recreation" }]);
    rt.videoBingeHide("tmdb:tv:2", false);
    expect(JSON.parse(rt.videoBingeHidden()).items.map((i: { title: string }) => i.title)).toEqual(["Parks and Recreation"]);
  });
});

describe("The Binge - runtime from TMDB's details", () => {
  it("season 1's median episode, not a double-length finale; episode_run_time, then the latest episode, only when no season is listed", async () => {
    const { bingeCandidateOf } = await import("../src/orchestrator.js");
    const card = cand(1).card;
    const t = { mean: 8.6, votes: 5500 };
    const office = { episode_run_time: [], last_episode_to_air: { runtime: 45 }, number_of_episodes: 186, type: "Scripted", "season/1": { episodes: [{ runtime: 23 }, { runtime: 22 }, { runtime: 22 }, { runtime: 22 }, { runtime: 22 }, { runtime: 22 }] } };
    expect(bingeCandidateOf(card, t, office).runtime).toBe(22);
    expect(bingeCandidateOf(card, t, { episode_run_time: [24], last_episode_to_air: { runtime: 45 } }).runtime).toBe(24);
    expect(bingeCandidateOf(card, t, { episode_run_time: [], last_episode_to_air: { runtime: 30 } }).runtime).toBe(30);
  });
});

describe("The Binge - Include animation (2026-09-24)", () => {
  it("left out: no animated series in the row or the full view; included by default", () => {
    const list = [cand(1, { title: "Toon", genres: ["Animation", "Comedy"] }), cand(2, { title: "Sitcom", genres: ["Comedy"] })];
    expect(selectBinge(list, { day: "d" }).length).toBe(2);
    expect(selectBinge(list, { day: "d", animation: false }).map((c) => c.card.title)).toEqual(["Sitcom"]);
    expect(bingeGenreRows(list, { day: "d", animation: false }).map((r) => r.genre)).toEqual(["Comedy"]);
  });
});
