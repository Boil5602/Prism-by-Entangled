import { describe, expect, it } from "vitest";
import { episodeHealth, fillFromTmdb, type TmdbSeason } from "../src/episode-health.js";
import type { EpisodesSeason } from "../src/orchestrator.js";

// A service's episode list measured against TMDB's aired episodes (2026-09-25: Apple TV had read 6 of Foundation's 30).

const tm = (season: number, count: number, airedUpTo = count): TmdbSeason => ({
  season, label: "Season " + season,
  episodes: Array.from({ length: count }, (_, i) => ({ episode: i + 1, title: `T${season}.${i + 1}`, synopsis: `about ${season}.${i + 1}`, still: `s${season}e${i + 1}.jpg`, airDate: i < airedUpTo ? "2024-01-01" : "2099-01-01", runtime: 50 })),
});
const svc = (season: number, eps: number[]): EpisodesSeason => ({
  season, label: "Season " + season,
  episodes: eps.map((e) => ({ season, episode: e, title: `S${season}E${e}`, id: `id${season}.${e}`, url: `u${season}.${e}`, synopsis: null, still: null, duration: null })),
});
const TODAY = "2026-09-25";

describe("an episode list's health", () => {
  it("finds a season read short, and says a whole list is whole", () => {
    const tmdb = [tm(1, 10), tm(2, 10), tm(3, 10)];
    const short = episodeHealth([svc(1, [1, 2, 3, 4, 5, 6])], tmdb, TODAY);
    expect(short.ok).toBe(false);
    expect(short.short).toEqual([{ season: 1, have: 6, aired: 10 }]);
    expect(short.beyond).toEqual([2, 3]);   // not a fault on its own: the service may not carry them
    const whole = episodeHealth([svc(1, range(10)), svc(2, range(10)), svc(3, range(10))], tmdb, TODAY);
    expect(whole.ok).toBe(true);
    expect(whole.have).toBe(30); expect(whole.aired).toBe(30);
  });

  it("counts only aired episodes, leaves Specials out, and finds a season missing between two", () => {
    const tmdb = [tm(0, 3), tm(1, 8), tm(2, 8), tm(3, 8, 2)];
    const h = episodeHealth([svc(1, range(8)), svc(3, [1, 2])], tmdb, TODAY);
    expect(h.gaps).toEqual([2]);
    expect(h.short).toEqual([]);   // season 3 has aired 2 of its 8
    expect(h.ok).toBe(false);
  });

  it("takes a season or two carried, and an episode or two held back, as the service's own choice (48 Hours, It's Always Sunny)", () => {
    const tmdb = [tm(36, 30), tm(37, 33), tm(38, 33)];
    const h = episodeHealth([svc(37, range(33)), svc(38, range(33))], tmdb, TODAY);
    expect(h.ok).toBe(true); expect(h.beyond).toEqual([36]);
    expect(episodeHealth([svc(4, range(12))], [tm(4, 13)], TODAY).ok).toBe(true);
    expect(episodeHealth([svc(2, range(22))], [tm(1, 22), tm(2, 22)], TODAY).ok).toBe(true);   // Georgie & Mandy: Paramount+ carries season 2 alone
    expect(episodeHealth([svc(4, range(9))], [tm(4, 13)], TODAY).short).toEqual([{ season: 4, have: 9, aired: 13 }]);
  });

  it("fills what the service did not show from TMDB, without ids, and keeps the service's own entries", () => {
    const tmdb = [tm(1, 10), tm(2, 10), tm(3, 10)];
    const out = fillFromTmdb([svc(1, [1, 2, 3, 4, 5, 6])], tmdb, TODAY);
    expect(out).toHaveLength(1);   // seasons after the service's last are not added
    expect(out[0]!.episodes.map((e) => e.episode)).toEqual(range(10));
    expect(out[0]!.episodes[0]).toMatchObject({ id: "id1.1", title: "S1E1", still: "s1e1.jpg", synopsis: "about 1.1" });   // its own, pictured from TMDB
    expect(out[0]!.episodes[9]).toMatchObject({ id: null, url: null, title: "T1.10", fromTmdb: true });
    const gap = fillFromTmdb([svc(1, range(8)), svc(3, [1])], [tm(1, 8), tm(2, 8), tm(3, 8, 1)], TODAY);
    expect(gap.map((s) => s.season)).toEqual([1, 2, 3]);
    expect(gap[1]!.episodes.every((e) => e.fromTmdb && e.id === null)).toBe(true);
  });
});

function range(n: number): number[] { return Array.from({ length: n }, (_, i) => i + 1); }
