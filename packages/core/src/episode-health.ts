// A service's episode list checked against TMDB's (2026-09-25, "Check the health of all episode lists and remember if we have TMDB connected, we
// have another resource to improve the process"): Apple TV's read had stopped at 6 of Foundation's 30 episodes and nothing noticed. TMDB knows
// every season and each episode's air date, so a service list can be measured against the episodes that have aired: a season that came back
// short, or a season missing between two the service shows, is a read that went wrong (a service not carrying a show's later seasons is not).
import type { EpisodeItem, EpisodesSeason } from "./orchestrator.js";

/** TMDB's seasons as lenses.tvSeasons gives them. */
export interface TmdbSeason { season: number; label: string; episodes: Array<{ episode: number; title: string; synopsis: string | null; still: string | null; airDate: string | null; runtime: number | null }> }

export interface EpisodeHealth {
  /** Nothing short and no gap: the list is whole as far as TMDB knows. */
  ok: boolean;
  /** Seasons the service shows with fewer episodes than TMDB says have aired. */
  short: Array<{ season: number; have: number; aired: number }>;
  /** Seasons TMDB has (aired) that are missing between the service's first and last season. */
  gaps: number[];
  /** Aired seasons before the service's first or after its last: likely not carried by the service, not a fault. */
  beyond: number[];
  /** Episode totals, regular seasons only: the service's, and TMDB's aired. */
  have: number;
  aired: number;
}

const aired = (s: TmdbSeason, today: string): TmdbSeason["episodes"] => s.episodes.filter((e) => !!e.airDate && e.airDate <= today && e.episode > 0);

/** The service's list measured against TMDB's aired episodes (regular seasons only; Specials are left out on both sides). */
export function episodeHealth(service: readonly EpisodesSeason[], tmdb: readonly TmdbSeason[], today: string): EpisodeHealth {
  const mine = new Map<number, number>();
  for (const s of service) if (s.season > 0) mine.set(s.season, (mine.get(s.season) ?? 0) + s.episodes.length);
  const nums = [...mine.keys()];
  const first = nums.length ? Math.min(...nums) : 0, last = nums.length ? Math.max(...nums) : 0;
  const out: EpisodeHealth = { ok: true, short: [], gaps: [], beyond: [], have: 0, aired: 0 };
  for (const n of nums) out.have += mine.get(n)!;
  for (const t of tmdb) {
    if (t.season <= 0) continue;
    const a = aired(t, today).length;
    if (a === 0) continue;
    out.aired += a;
    const have = mine.get(t.season);
    if (have === undefined) {
      if (nums.length && t.season > first && t.season < last) out.gaps.push(t.season);
      // before its first or after its last: a service carrying some seasons only - Netflix's 48 Hours (37 and 38), Paramount+'s Georgie & Mandy
      // (its season picker offers season 2 alone)
      else if (nums.length) out.beyond.push(t.season);
    } else if (a - have >= 2 && have < a * 0.8) out.short.push({ season: t.season, have, aired: a });
    // one missing, or a fifth: the service's own choice more often than a read gone wrong (Hulu's It's Always Sunny: five episodes pulled in 2020; South Park's banned ones on Paramount+)
  }
  out.ok = out.short.length === 0 && out.gaps.length === 0;
  return out;
}

/** The episode count of a list (regular seasons), to keep the better of two reads. */
export function episodeCount(seasons: readonly EpisodesSeason[]): number {
  return seasons.filter((s) => s.season > 0).reduce((n, s) => n + s.episodes.length, 0);
}

/**
 * A service's list completed from TMDB's: in a season that came back short, or one missing between the service's own, TMDB's aired episodes the
 * service did not show are added - named, pictured, described, with no service id (pressed, one opens the series on the service instead of playing
 * it); and a service episode without a picture, a description or an air date takes TMDB's. Seasons after the service's last one are not added
 * (the service may not carry them). The service's own entries are never replaced or reordered.
 */
export function fillFromTmdb(service: readonly EpisodesSeason[], tmdb: readonly TmdbSeason[], today: string): EpisodesSeason[] {
  const h = episodeHealth(service, tmdb, today);
  const fill = new Set<number>([...h.short.map((x) => x.season), ...h.gaps]);
  const byNum = new Map(tmdb.map((t) => [t.season, t]));
  const out: EpisodesSeason[] = service.map((s) => {
    const t = byNum.get(s.season);
    if (!t) return { ...s, episodes: s.episodes.slice() };
    const tEp = new Map(t.episodes.map((e) => [e.episode, e]));
    const episodes: EpisodeItem[] = s.episodes.map((e) => {
      const x = tEp.get(e.episode);
      if (!x) return e;
      return { ...e, still: e.still ?? x.still, synopsis: e.synopsis ?? x.synopsis, airDate: e.airDate ?? x.airDate };
    });
    if (fill.has(s.season)) {
      const have = new Set(episodes.map((e) => e.episode));
      for (const x of aired(t, today)) if (!have.has(x.episode)) episodes.push(tmdbEpisode(s.season, x));
      episodes.sort((a, b) => a.episode - b.episode);
    }
    return { ...s, episodes };
  });
  for (const n of h.gaps) {
    const t = byNum.get(n);
    if (t) out.push({ season: n, label: t.label, episodes: aired(t, today).map((x) => tmdbEpisode(n, x)) });
  }
  out.sort((a, b) => (a.season === 0 ? 1 : b.season === 0 ? -1 : a.season - b.season));
  return out;
}

function tmdbEpisode(season: number, x: TmdbSeason["episodes"][number]): EpisodeItem {
  return { season, episode: x.episode, title: x.title || "Episode " + x.episode, id: null, url: null, synopsis: x.synopsis, still: x.still, duration: x.runtime ? x.runtime + "m" : null, airDate: x.airDate, fromTmdb: true };
}
