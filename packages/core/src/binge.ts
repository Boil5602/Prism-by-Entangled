/**
 * The Binge (docs/features/the-binge.md, 2026-09-24): a carousel of highly rated, short, long-running, episodic series the household can
 * play right now on this device. Pure: the definition, the eligibility rule, the kids-mode ratings table and the order - a function of
 * (data, signed-in services, thresholds, genre, kids mode + age, day seed). The reads that fill the candidates live in the orchestrator.
 */
import type { BrowseCard } from "./browse.js";

/** The thresholds (all editable in Watch settings). */
export interface BingeThresholds { maxRuntime: number; minEpisodes: number; minRating: number; minVotes: number; top: number }
// top 0 = no limit: every eligible series (2026-09-24, "can we remove the limit and bring in all 126"; the spec had said top 50)
export const BINGE_DEFAULTS: BingeThresholds = { maxRuntime: 30, minEpisodes: 80, minRating: 7.0, minVotes: 500, top: 0 };

/** Kids mode's ages and the US TV ratings each allows (the spec's table; TV-PG has no official age - Prism's editable default). */
export type KidsAge = "under7" | "under10" | "under14" | "under17";
export const KIDS_AGES: ReadonlyArray<{ id: KidsAge; label: string; ratings: readonly string[] }> = [
  { id: "under7", label: "Under 7", ratings: ["TV-Y", "TV-G"] },
  { id: "under10", label: "Under 10", ratings: ["TV-Y", "TV-G", "TV-Y7"] },
  { id: "under14", label: "Under 14", ratings: ["TV-Y", "TV-G", "TV-Y7", "TV-PG"] },
  { id: "under17", label: "Under 17", ratings: ["TV-Y", "TV-G", "TV-Y7", "TV-PG", "TV-14"] },
];
export interface KidsMode { on: boolean; age: KidsAge }
export const KIDS_OFF: KidsMode = { on: false, age: "under10" };

/** What the reads know of one series: TMDB's details, its US rating, and the household's services that carry it. */
export interface BingeCandidate {
  card: BrowseCard;
  genres: string[];
  mean: number | null;
  votes: number | null;
  /** minutes per episode (TMDB's episode_run_time, else the latest episode's runtime); null when TMDB has none */
  runtime: number | null;
  episodes: number | null;
  /** TMDB's type: "Scripted", "Miniseries", "Reality", "Documentary", "News", "Talk Show", "Video" */
  type: string | null;
  keywords: string[];
  /** the US content rating (TV-Y ... TV-MA); null when unrated */
  certification: string | null;
}

/** The episodic heuristic's community keywords (no open data marks a show serialized; the criterion is labeled as a heuristic). */
const SERIALIZED = /\bserial(ized)?\b|\bserialised\b/i;

/** Every eligibility criterion, and whether the candidate meets it - the card's own reasons. Pure. */
export function bingeChecks(c: BingeCandidate, t: BingeThresholds = BINGE_DEFAULTS): { runtime: boolean; episodes: boolean; episodic: boolean; quality: boolean; available: boolean } {
  const animated = c.genres.some((g) => /animation/i.test(g));
  return {
    runtime: c.runtime !== null && c.runtime > 0 && c.runtime <= t.maxRuntime,
    episodes: c.episodes !== null && c.episodes >= t.minEpisodes,
    episodic: (c.type === "Scripted" || animated) && c.type !== "Miniseries" && !c.keywords.some((k) => SERIALIZED.test(k)),
    quality: c.mean !== null && c.votes !== null && c.mean >= t.minRating && c.votes >= t.minVotes,
    available: c.card.services.length > 0,
  };
}
export function bingeEligible(c: BingeCandidate, t: BingeThresholds = BINGE_DEFAULTS): boolean {
  const k = bingeChecks(c, t);
  return k.runtime && k.episodes && k.episodic && k.quality && k.available;
}

/** Kids mode: off - every rating; on - only the ratings the age allows, and an unrated title never. Pure. */
export function kidsAllows(certification: string | null, kids: KidsMode): boolean {
  if (!kids.on) return true;
  if (!certification) return false;
  const age = KIDS_AGES.find((a) => a.id === kids.age) ?? KIDS_AGES[1]!;
  return age.ratings.includes(certification.toUpperCase());
}

/** A small seeded shuffle (mulberry32 over a string hash): the same seed gives the same order, all day. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/** The local day as the seed (yyyy-mm-dd). */
export function bingeDay(now: number): string {
  const d = new Date(now);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Animated by TMDB's genre (the household's "Include animation" choice, 2026-09-24). */
export function isAnimated(c: BingeCandidate): boolean { return c.genres.some((g) => /animation/i.test(g)); }

/**
 * The order (normative): eligible and available first, kids mode applied, a title the household hid (or one a press found missing on its
 * service) left out; the top `t.top` by TMDB rating (more votes first on a tie); then shuffled by the day (and the genre, for a genre row).
 */
export function selectBinge(cands: readonly BingeCandidate[], o: { thresholds?: BingeThresholds; kids?: KidsMode; day: string; genre?: string | null; hidden?: ReadonlySet<string>; animation?: boolean }): BingeCandidate[] {
  const t = o.thresholds ?? BINGE_DEFAULTS;
  const kids = o.kids ?? KIDS_OFF;
  const pool = cands.filter((c) => bingeEligible(c, t) && kidsAllows(c.certification, kids) && !o.hidden?.has(c.card.id) && (o.animation !== false || !isAnimated(c)) && (!o.genre || c.genres.includes(o.genre)));
  const top = pool.slice().sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0) || (b.votes ?? 0) - (a.votes ?? 0) || a.card.title.localeCompare(b.card.title)).slice(0, t.top > 0 ? t.top : undefined);
  return seededShuffle(top, o.day + "|" + (o.genre ?? "all"));
}

/** The full view: one row per TMDB genre present, each its own top and shuffle; empty genres left out; genres by name. */
export function bingeGenreRows(cands: readonly BingeCandidate[], o: { thresholds?: BingeThresholds; kids?: KidsMode; day: string; hidden?: ReadonlySet<string>; animation?: boolean }): Array<{ genre: string; items: BingeCandidate[] }> {
  const genres = [...new Set(cands.flatMap((c) => c.genres))].sort((a, b) => a.localeCompare(b));
  return genres.map((genre) => ({ genre, items: selectBinge(cands, { ...o, genre }) })).filter((r) => r.items.length > 0);
}

/** The row's words: its short name, the long label (the head's tooltip), and the disclosure every catalog row carries. */
export const THE_BINGE = {
  id: "the-binge",
  name: "The Binge",
  label: "The Binge · every ≤{runtime}-min, {episodes}+ episode series on your services rated {rating}+ on TMDB · shuffled daily.",
  counted: "Series with episodes of {runtime} minutes or less, {episodes} or more episodes, scripted or animated (not a miniseries, no \"serialized\" keyword), TMDB rating {rating} or better with {votes}+ votes, streaming on a service signed in on this device.",
  who: "TMDB members' votes; the runtimes, episode counts and keywords are TMDB contributors'.",
  decides: "You set the thresholds in Watch settings. There's no reliable data on whether a show is episodic, so that check is a best guess, and you can hide any title.",
  source: "TMDB (details, keywords, ratings) · JustWatch availability, through TMDB",
  sourceUrl: "https://www.themoviedb.org/",
  formula: "Every eligible series on your services, shuffled once a day so the order stays the same all day.",
} as const;
export function bingeWords(t: BingeThresholds): { label: string; counted: string; formula: string } {
  const fill = (s: string) => s.replace("{top}", String(t.top)).replace("{runtime}", String(t.maxRuntime)).replace("{episodes}", String(t.minEpisodes)).replace("{rating}", t.minRating.toFixed(1)).replace("{votes}", String(t.minVotes));
  return { label: fill(THE_BINGE.label), counted: fill(THE_BINGE.counted), formula: fill(THE_BINGE.formula) };
}

/** Thresholds and kids mode as kept on the device, each field checked (a bad one falls back to its default). */
export function bingeSettingsOf(raw: unknown): { thresholds: BingeThresholds; kids: KidsMode; animation: boolean } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { thresholds?: Partial<Record<keyof BingeThresholds, unknown>>; kids?: { on?: unknown; age?: unknown }; animation?: unknown };
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : d);
  const t = r.thresholds ?? {};
  return {
    thresholds: {
      maxRuntime: num(t.maxRuntime, BINGE_DEFAULTS.maxRuntime, 5, 120), minEpisodes: num(t.minEpisodes, BINGE_DEFAULTS.minEpisodes, 1, 2000),
      minRating: num(t.minRating, BINGE_DEFAULTS.minRating, 0, 10), minVotes: num(t.minVotes, BINGE_DEFAULTS.minVotes, 0, 100000), top: BINGE_DEFAULTS.top,
    },
    kids: { on: r.kids?.on === true, age: KIDS_AGES.some((a) => a.id === r.kids?.age) ? (r.kids!.age as KidsAge) : KIDS_OFF.age },
    animation: r.animation !== false,   // included unless the household left it out
  };
}
