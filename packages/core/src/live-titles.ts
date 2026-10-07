/**
 * The Live tab's titles from TMDB (docs/features/live.md, 2026-10-02, Entertainment mode: "File show-named channels by their show" and
 * "A Now-on strip"): a channel named after one series ("Are We There Yet?", "Below Deck"), or the program a channel has on, looked up on
 * TMDB by its exact name. What comes back is a named source's word, shown as such: the show's poster, year and TMDB's rating on the
 * Now-on strip, and - for a channel the service gave no category - a Live type from TMDB's first genre for the show, labelled "by TMDB's
 * genre for <show>". Prism's own rules on the name stand where TMDB names nothing.
 *
 * Pure: which names are looked up, how a search answer is accepted, and the genre-to-type mapping. The orchestrator asks TMDB (one
 * search at a time, the answers kept on the device for a week), the runtime applies the answers, the host draws.
 */

/** A show as TMDB answered for a name: `none` when the search found no exact match. */
export interface LiveTitle {
  kind: "movie" | "tv";
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  rating: number | null;
  genres: string[];
  overview: string | null;
  /** TMDB's US rating for the title (TV-Y7, PG-13), null when TMDB lists none; absent until asked (a second call) */
  cert?: string | null;
}

/** TMDB's US rating from its content_ratings (tv) or release_dates (movie) answer; null when none is listed. */
export function certificationOf(kind: "movie" | "tv", answer: unknown): string | null {
  const results = (answer as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;
  const us = (results as Array<Record<string, unknown>>).find((r) => r && r.iso_3166_1 === "US");
  if (!us) return null;
  if (kind === "tv") return typeof us.rating === "string" && us.rating.trim() ? us.rating.trim().slice(0, 8) : null;
  const dates = Array.isArray(us.release_dates) ? (us.release_dates as Array<Record<string, unknown>>) : [];
  const c = dates.map((d) => (typeof d.certification === "string" ? d.certification.trim() : "")).find((x) => x.length > 0);
  return c ? c.slice(0, 8) : null;
}
/** Whether a US rating is one for children on their own (Kids mode's word on a poster, 2026-10-02). */
export function isKidsRating(cert: string | null | undefined): boolean | null {
  if (!cert) return null;
  return /^(TV-Y|TV-Y7|TV-Y7-FV|TV-G|G)$/i.test(cert);
}
export interface LiveTitleEntry { at: number; title: LiveTitle | null }

/** A week: a name's answer stands this long before TMDB is asked again. */
export const LIVE_TITLE_KEEP_MS = 7 * 24 * 3_600_000;

/** Words that make a channel's name a channel's, not a show's: such a name is not looked up (a named rule). */
const CHANNEL_WORDS = /\b(news|tv|channel|network|24\/7|sports?|movies?|films?|classics?|hits|sitcoms?|comedy|comedies|dramas|favou?rites|central|universe|corner|vault|all day|español|espanol|deportes|noticias|ahora|al dia|presents|collection|marathon|binge|essentials|rewind|throwbacks?|the best of|stories|mysteries|laughs|voices|variety|showcase|cinema|theater|theatre|station|radio|music)\b|\bby\b(?! the)/i;

/** Whether a channel's name reads as one show's name, worth a lookup. */
export function isShowName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (CHANNEL_WORDS.test(n)) return false;
  if (/^\d+s\b/.test(n)) return false;   // "80s Sitcoms", "90s" decades
  return true;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** A match needs this many votes on TMDB: a network's name ("ION", "REELZ") matches an obscure title by letter alone (2026-10-02). */
export const LIVE_TITLE_MIN_VOTES = 20;
/** TMDB's search answer accepted only when its title is the name itself (folded) and the title has votes; the first such result, as TMDB orders them. */
export function acceptSearch(name: string, results: unknown): LiveTitle | null {
  if (!Array.isArray(results)) return null;
  const want = fold(name);
  if (!want) return null;
  for (const r0 of results as Array<Record<string, unknown>>) {
    if (!r0 || typeof r0 !== "object") continue;
    const kind = r0.media_type === "tv" ? "tv" : r0.media_type === "movie" ? "movie" : null;
    if (!kind || typeof r0.id !== "number") continue;
    const title = typeof r0.name === "string" ? r0.name : typeof r0.title === "string" ? r0.title : "";
    const original = typeof r0.original_name === "string" ? r0.original_name : typeof r0.original_title === "string" ? r0.original_title : "";
    if (fold(title) !== want && fold(original) !== want) continue;
    if (!(typeof r0.vote_count === "number" && r0.vote_count >= LIVE_TITLE_MIN_VOTES)) continue;
    const date = typeof r0.first_air_date === "string" ? r0.first_air_date : typeof r0.release_date === "string" ? r0.release_date : "";
    const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
    const pic = (p: unknown, size: string) => typeof p === "string" && p.startsWith("/") ? `https://image.tmdb.org/t/p/${size}${p}` : null;
    const genres = Array.isArray(r0.genre_ids) ? (r0.genre_ids as unknown[]).map((g) => (typeof g === "number" ? TMDB_GENRE_NAMES[g] : undefined)).filter((n): n is string => typeof n === "string") : [];
    const rating = typeof r0.vote_average === "number" && r0.vote_average > 0 && typeof r0.vote_count === "number" && r0.vote_count >= 10 ? Math.round(r0.vote_average * 10) / 10 : null;
    return { kind, id: r0.id, title: title || name, year, poster: pic(r0.poster_path, "w342"), backdrop: pic(r0.backdrop_path, "w780"), rating, genres, overview: typeof r0.overview === "string" ? r0.overview.slice(0, 400) : null };
  }
  return null;
}

/** TMDB's genre ids by name (the same table catalog-search carries; kept here so this file stands alone). */
const TMDB_GENRE_NAMES: Readonly<Record<number, string>> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

/** The Live type TMDB's genres name, from the first genre that maps; null when none does (the tab's own rule on the name stands). */
export function typeFromGenres(genres: readonly string[]): string | null {
  for (const g of genres) {
    switch (g) {
      case "Comedy": return "Comedy";
      case "Drama": case "Crime": case "Mystery": case "Soap": case "Thriller": case "Action & Adventure": case "Sci-Fi & Fantasy": case "Western": return "Drama";
      case "Reality": case "Talk": return "Reality";
      case "Kids": case "Family": case "Animation": return "Kids";
      case "News": return "News";
      case "Documentary": return "Documentary";
      default: continue;
    }
  }
  return null;
}
