/**
 * A title's details card (2026-09-23, "Let's not show the IMDb link at all. We should be able to avoid using it. Let's instead just show info from
 * TMDB in a structured formatted intuitive useful modal"). One TMDB request under the person's own key - the work with its credits, trailers,
 * watch providers and certification appended - shaped here into what the card shows. Pure: TMDB's answer in, the card's facts out. Every fact
 * is TMDB's (the card says so, with TMDB's required notice); "where to watch" is TMDB's JustWatch data and the card credits JustWatch.
 */

export const TMDB_IMG = "https://image.tmdb.org/t/p/";
export const TMDB_NOTICE = "This product uses the TMDB API but is not endorsed or certified by TMDB.";
export const JUSTWATCH_NOTICE = "Where to watch: data by JustWatch, through TMDB.";

export interface TitleDetails {
  kind: "movie" | "tv";
  id: number;
  title: string;
  year: number | null;
  tagline: string | null;
  overview: string | null;
  /** the US certification (TV-MA, PG-13) as TMDB records it */
  certification: string | null;
  /** minutes: a film's runtime, a series' usual episode length */
  runtime: number | null;
  seasons: number | null;
  episodes: number | null;
  /** TMDB's status ("Returning Series", "Ended", "Released") */
  status: string | null;
  genres: string[];
  /** "Created by" (a series) or "Directed by" (a film), with the names */
  by: { label: string; names: string[] } | null;
  writers: string[];
  /** a series' networks, a film's studios */
  makers: string[];
  /** each with TMDB's person id - the face opens their films and series (2026-09-23) */
  cast: Array<{ id: number | null; name: string; character: string | null; photo: string | null }>;
  rating: { mean: number; votes: number } | null;
  /** US offers by kind, each provider's name and logo */
  providers: { stream: ProviderOffer[]; free: ProviderOffer[]; rent: ProviderOffer[]; buy: ProviderOffer[] };
  trailer: { name: string; youtube: string } | null;
  poster: string | null;
  backdrop: string | null;
  first: string | null;
  last: string | null;
  next: { season: number; episode: number; date: string | null; name: string | null } | null;
}
export interface ProviderOffer {
  name: string; logo: string | null;
  /** TMDB's provider id (JustWatch's) - what matches the offer to one of the household's services */
  id?: number;
  /** the household's service that carries it, when one does (2026-09-23, "the ability any 'Where to watch' icons to take me to watch that video in
   *  the big screen main window"): the logo plays the title there - filled by the runtime, never by TMDB */
  play?: { app: string; name: string };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const img = (size: string, path: unknown): string | null => (typeof path === "string" && path.startsWith("/") ? TMDB_IMG + size + path : null);
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>) : []);

export function shapeTitleDetails(kind: "movie" | "tv", d: Record<string, unknown>, region = "US"): TitleDetails {
  const tv = kind === "tv";
  const first = day(tv ? d.first_air_date : d.release_date);
  const credits = (d.credits && typeof d.credits === "object" ? d.credits : {}) as Record<string, unknown>;
  const agg = (d.aggregate_credits && typeof d.aggregate_credits === "object" ? d.aggregate_credits : null) as Record<string, unknown> | null;
  // a series' cast across its run (aggregate_credits, most episodes first) reads truer than one season's; a film's credits as they are
  const castSrc = tv && agg ? arr(agg.cast) : arr(credits.cast);
  const cast = castSrc.slice(0, 16).map((c) => {
    const roles = arr(c.roles);
    return { id: num(c.id), name: str(c.name) ?? "", character: str(c.character) ?? (roles.length ? str(roles[0]!.character) : null), photo: img("w185", c.profile_path) };
  }).filter((c) => c.name);
  const crew = arr(credits.crew);
  const directors = crew.filter((c) => c.job === "Director").map((c) => str(c.name)).filter((n): n is string => !!n);
  const writers = crew.filter((c) => c.department === "Writing").map((c) => str(c.name)).filter((n): n is string => !!n);
  const creators = arr(d.created_by).map((c) => str(c.name)).filter((n): n is string => !!n);
  const by = tv ? (creators.length ? { label: "Created by", names: creators.slice(0, 4) } : null) : directors.length ? { label: "Directed by", names: [...new Set(directors)].slice(0, 3) } : null;
  // the certification: a series' content_ratings, a film's theatrical/digital release_dates, for the region
  let certification: string | null = null;
  if (tv) certification = str(arr((d.content_ratings as Record<string, unknown> | undefined)?.results).find((r) => r.iso_3166_1 === region)?.rating);
  else {
    const rel = arr(arr((d.release_dates as Record<string, unknown> | undefined)?.results).find((r) => r.iso_3166_1 === region)?.release_dates);
    certification = str(rel.find((r) => str(r.certification))?.certification);
  }
  const runtime = tv ? num((d.episode_run_time as unknown[] | undefined)?.[0]) ?? num((d.last_episode_to_air as Record<string, unknown> | undefined)?.runtime) : num(d.runtime);
  const watch = ((d["watch/providers"] as Record<string, unknown> | undefined)?.results as Record<string, unknown> | undefined)?.[region] as Record<string, unknown> | undefined;
  const offers = (key: string): ProviderOffer[] => arr(watch?.[key]).map((p) => ({ name: str(p.provider_name) ?? "", logo: img("w92", p.logo_path), ...(num(p.provider_id) !== null ? { id: num(p.provider_id)! } : {}) })).filter((p) => p.name);
  const vids = arr((d.videos as Record<string, unknown> | undefined)?.results).filter((v) => v.site === "YouTube" && typeof v.key === "string");
  const tr = vids.find((v) => v.type === "Trailer" && v.official === true) ?? vids.find((v) => v.type === "Trailer") ?? vids.find((v) => v.type === "Teaser") ?? null;
  const nx = (d.next_episode_to_air && typeof d.next_episode_to_air === "object" ? d.next_episode_to_air : null) as Record<string, unknown> | null;
  const mean = num(d.vote_average), votes = num(d.vote_count);
  return {
    kind, id: num(d.id) ?? 0,
    title: str(tv ? d.name : d.title) ?? str(d.original_name) ?? str(d.original_title) ?? "",
    year: first ? Number(first.slice(0, 4)) : null,
    tagline: str(d.tagline), overview: str(d.overview), certification, runtime: runtime ?? null,
    seasons: tv ? num(d.number_of_seasons) : null, episodes: tv ? num(d.number_of_episodes) : null, status: str(d.status),
    genres: arr(d.genres).map((g) => str(g.name)).filter((n): n is string => !!n),
    by, writers: [...new Set(writers)].slice(0, 4),
    makers: arr(tv ? d.networks : d.production_companies).map((m) => str(m.name)).filter((n): n is string => !!n).slice(0, 4),
    cast,
    rating: mean !== null && votes !== null && votes > 0 ? { mean, votes } : null,
    providers: { stream: offers("flatrate"), free: [...offers("free"), ...offers("ads")], rent: offers("rent"), buy: offers("buy") },
    trailer: tr ? { name: str(tr.name) ?? "Trailer", youtube: String(tr.key) } : null,
    poster: img("w342", d.poster_path), backdrop: img("w1280", d.backdrop_path),
    first, last: day(tv ? d.last_air_date : null),
    next: nx ? { season: num(nx.season_number) ?? 0, episode: num(nx.episode_number) ?? 0, date: day(nx.air_date), name: str(nx.name) } : null,
  };
}

/**
 * A person's page (2026-09-23, "When I go into details for a show and find actors listed at the bottom, I want to be able to see a list of their
 * films/series with pictures, titles, and sorted by release date by default but name should be an option"): TMDB's person with their combined
 * credits - each work once (their parts on it joined), a talk show's guest spot as themselves left out. Pure.
 */
export interface PersonCredit { kind: "movie" | "tv"; id: number; title: string; date: string | null; year: number | null; poster: string | null; backdrop: string | null; role: string | null }
export interface PersonPage { id: number; name: string; photo: string | null; known: string | null; born: string | null; bio: string | null; credits: PersonCredit[] }
export function shapePerson(d: Record<string, unknown>): PersonPage {
  const cc = (d.combined_credits && typeof d.combined_credits === "object" ? d.combined_credits : {}) as Record<string, unknown>;
  const by = new Map<string, PersonCredit>();
  const add = (r: Record<string, unknown>, role: string | null) => {
    const kind = r.media_type === "movie" ? "movie" : r.media_type === "tv" ? "tv" : null;
    const id = num(r.id);
    if (!kind || id === null) return;
    // a talk or game show's guest spot as themselves is not their work
    if (kind === "tv" && typeof r.character === "string" && /\b(himself|herself|themselves|self)\b/i.test(r.character) && (num(r.episode_count) ?? 0) < 10) return;
    const date = day(kind === "movie" ? r.release_date : r.first_air_date);
    const k = kind + ":" + id;
    const had = by.get(k);
    if (had) { if (role && !(had.role ?? "").split(", ").includes(role)) had.role = had.role ? had.role + ", " + role : role; return; }
    by.set(k, { kind, id, title: str(kind === "movie" ? r.title : r.name) ?? str(r.original_title) ?? str(r.original_name) ?? "", date, year: date ? Number(date.slice(0, 4)) : null, poster: img("w342", r.poster_path), backdrop: img("w780", r.backdrop_path), role });
  };
  for (const r of arr(cc.cast)) add(r, str(r.character));
  for (const r of arr(cc.crew)) add(r, str(r.job));
  const bio = str(d.biography);
  return {
    id: num(d.id) ?? 0, name: str(d.name) ?? "", photo: img("h632", d.profile_path), known: str(d.known_for_department), born: day(d.birthday),
    bio: bio ? (bio.length > 700 ? bio.slice(0, 700).replace(/\s+\S*$/, "") + "\u2026" : bio) : null,
    credits: [...by.values()].filter((c) => c.title),
  };
}

/** The appended request for one work - everything the card shows in one call. */
export const TITLE_DETAILS_APPEND = "append_to_response=credits,aggregate_credits,videos,watch/providers,content_ratings,release_dates";
