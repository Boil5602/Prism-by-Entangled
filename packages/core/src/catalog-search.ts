/**
 * Catalog search (2026-09-21, "maybe we should just use TMDB's results then link those results up to the service if
 * linked to us ... the services do some ugly wildcard search and give you way too many results"):
 *
 * With the household's own TMDB key, the words go to TMDB's title search and each of its top titles is looked up in
 * TMDB's watch-providers data (JustWatch's, for the household's region): which services carry it, and how - a
 * subscription, free with ads, a rental or a purchase. A title is kept only where one of the household's OWN signed-in
 * services carries it; the rest is discarded. What is pure lives here: the provider ids each adapter claims, the
 * offer's word, and the rows in TMDB's own order (the title that IS the words first). Prism ranks nothing else.
 *
 * A press asks that one service's own search for the title in the background and plays the exact match the service
 * itself answers with - the "only what the service gave" guard of video-lookup.ts stands. Without a key, or when TMDB
 * does not answer, the page-side search everywhere (video-lookup.ts) runs as before.
 */

import type { AdapterSpec } from "./adapters.js";
import { normalizeTrackText } from "./music-lookup.js";
import type { LookupCandidate } from "./video-lookup.js";
import { ratingLabel } from "./lenses.js";

/** How many of TMDB's titles are looked up for providers - its own top, in its own order. */
export const CATALOG_TITLES = 8;
/** TMDB's image host for posters (the w342 size fits the menu's cards). */
export const TMDB_POSTER = "https://image.tmdb.org/t/p/w342";
/** TMDB's image host for backdrops - the landscape still a 16:9 card shows whole (a portrait poster lost its top and bottom there, 2026-09-22). */
export const TMDB_BACKDROP = "https://image.tmdb.org/t/p/w780";
/** TMDB's genre ids as its /genre lists name them (stable for years; a search result carries ids, not names). */
export const TMDB_GENRES: Readonly<Record<number, string>> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};
/** The wording on the row, as TMDB's terms ask (attribution) and as JustWatch's data requires. */
export const CATALOG_ATTRIBUTION = "Titles from TMDB · availability by JustWatch";

export type OfferKind = "subscription" | "free" | "ads" | "rent" | "buy";

/** A title as TMDB's search names it, with the providers (TMDB ids) that carry it, by offer. */
export interface CatalogTitle {
  kind: "movie" | "tv";
  id: number;
  title: string;
  year?: number | undefined;
  poster?: string | undefined;
  /** TMDB's landscape backdrop, for a 16:9 card */
  backdrop?: string | undefined;
  /** TMDB's synopsis, for the card's hover */
  overview?: string | undefined;
  /** the person the words named, when the title came through one (TMDB's known_for): "with <name>" */
  via?: string | undefined;
  /** TMDB's genres, named - the search's genre filter (2026-09-22) */
  genres?: string[] | undefined;
  /** TMDB's rating as the cards show it, when it has votes (2026-09-24) */
  rating?: string | undefined;
  /** the release date (a film) or first air date (a series), yyyy-mm-dd, as TMDB records it - an unreleased title is owned by nobody */
  released?: string | undefined;
  offers: Partial<Record<OfferKind, number[]>>;
}

/**
 * Is this owned title the catalog's title (2026-09-22, "It says I own Resident Evil ... this is a 2026 one that isnt even out yet")? A name
 * is not a work: the household owned the 2002 film, and the 2026 one of the same name - on preorder - was carded Owned. Pure. The owned
 * item is the work when its name matches AND nothing says otherwise: a title not yet released is owned by nobody; a year the owned item
 * carries itself (its address' slug "...-2024", its subtitle, a "(2024)" in its name) must agree with the catalog's within a year; and
 * the TMDB work the wall already matched the owned title to, when it has one, must be this one.
 */
export function ownedIsThis(owned: { title: string; url?: string | null; subtitle?: string | null }, t: { kind: "movie" | "tv"; id: number; title: string; year?: number | undefined; released?: string | undefined }, ownedRef: { kind: "movie" | "tv"; id: number } | null | undefined, today: string, atHome?: boolean): boolean {
  if (normalizeTitle(owned.title) !== normalizeTitle(t.title)) return false;
  if (t.released ? t.released > today : t.year !== undefined && t.year > Number(today.slice(0, 4))) return false;
  if (atHome === false) return false;   // in theaters, not yet sold to own (homeRelease)
  const y = ownedYear(owned);
  if (y !== null && t.year !== undefined && Math.abs(y - t.year) > 1) return false;
  if (ownedRef && (ownedRef.kind !== t.kind || ownedRef.id !== t.id)) return false;
  return true;
}
/**
 * A film is at home - sold to own - once TMDB's US release dates list a digital (4), physical (5) or TV (6) release on or before today
 * ("Resident Evil" 2026 listed a premiere and a theatrical date only, while both stores took preorders, 2026-09-22). Older films often
 * carry no home date on TMDB, so a missing one counts against a film only while its first US date is within the last year. Null when
 * TMDB lists no US dates at all (nothing known; the release-date rule stands). Pure.
 */
export function atHomeFrom(releaseDates: unknown, today: string, region = "US"): boolean | null {
  const results = (releaseDates as { results?: Array<{ iso_3166_1?: unknown; release_dates?: Array<{ type?: unknown; release_date?: unknown }> }> } | null)?.results;
  const dates = (Array.isArray(results) ? results : []).filter((r) => r?.iso_3166_1 === region).flatMap((r) => (Array.isArray(r.release_dates) ? r.release_dates : []))
    .map((d) => ({ type: typeof d?.type === "number" ? d.type : 0, date: typeof d?.release_date === "string" ? d.release_date.slice(0, 10) : "" })).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  if (!dates.length) return null;
  const home = dates.filter((d) => d.type >= 4 && d.type <= 6).map((d) => d.date).sort();
  if (home.length) return home[0]! <= today;
  const first = dates.map((d) => d.date).sort()[0]!;
  const yearAgo = new Date(Date.parse(today + "T00:00:00Z") - 365 * 24 * 3_600_000).toISOString().slice(0, 10);
  return first < yearAgo;
}
function normalizeTitle(s: string): string { return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s*\((19|20)\d{2}\)\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim(); }
/** The year an owned item carries itself, or null: "(2024)" in its name, a slug ending in the year, a year in its subtitle. */
export function ownedYear(owned: { title: string; url?: string | null; subtitle?: string | null }): number | null {
  const m = /\(((?:19|20)\d{2})\)\s*$/.exec(owned.title) ?? /[-_]((?:19|20)\d{2})(?:[/?#]|$)/.exec(owned.url ?? "") ?? /\b((?:19|20)\d{2})\b/.exec(owned.subtitle ?? "");
  return m ? Number(m[1]) : null;
}

/** A household service, as the runtime names it, with the provider ids its adapter claims. */
export interface CatalogService { app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }

/** The provider ids an adapter claims (its `tmdbProviders`), cleaned. */
export function providersOf(spec: AdapterSpec | undefined): number[] {
  const raw = (spec as { tmdbProviders?: unknown } | undefined)?.tmdbProviders;
  return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0) : [];
}

/** The offer's word on a card, in the order a person would rather have it. */
export const OFFER_ORDER: readonly OfferKind[] = ["subscription", "free", "ads", "rent", "buy"];
export function offerLabel(kinds: readonly OfferKind[]): string {
  const has = new Set(kinds);
  if (has.has("subscription")) return "Subscription";
  if (has.has("free")) return "Free";
  if (has.has("ads")) return "Free with ads";
  if (has.has("rent") && has.has("buy")) return "Rent / Buy";
  if (has.has("rent")) return "Rent";
  if (has.has("buy")) return "Buy";
  return "";
}

/** TMDB's watch/providers answer for one region, reduced to provider ids by offer (its keys: flatrate, free, ads, rent, buy). */
export function offersFromProviders(region: unknown): CatalogTitle["offers"] {
  const r = region && typeof region === "object" ? (region as Record<string, unknown>) : {};
  const ids = (k: string): number[] => (Array.isArray(r[k]) ? (r[k] as Array<{ provider_id?: unknown }>).map((p) => p?.provider_id).filter((n): n is number => typeof n === "number") : []);
  const out: CatalogTitle["offers"] = {};
  const pairs: Array<[string, OfferKind]> = [["flatrate", "subscription"], ["free", "free"], ["ads", "ads"], ["rent", "rent"], ["buy", "buy"]];
  for (const [k, o] of pairs) { const l = ids(k); if (l.length) out[o] = l; }
  return out;
}

/**
 * TMDB's search/multi results, reduced to the movies and shows, its order kept. A PERSON in the results (an actor, a director
 * the words named) contributes the titles TMDB knows them for, marked `via` - so "Tom Cruise" lists Top Gun on the services
 * that carry it (2026-09-22, "make TMDB a major part of search"). A title is listed once, under its first appearance.
 */
export function titlesFromSearch(results: unknown, max = CATALOG_TITLES): Array<Omit<CatalogTitle, "offers">> {
  if (!Array.isArray(results)) return [];
  const out: Array<Omit<CatalogTitle, "offers">> = [];
  const seen = new Set<string>();
  const one = (r: Record<string, unknown>, via?: string): void => {
    if (!r || typeof r !== "object") return;
    const kind = r.media_type === "movie" ? "movie" : r.media_type === "tv" ? "tv" : null;
    const id = typeof r.id === "number" ? r.id : null;
    const title = typeof (kind === "movie" ? r.title : r.name) === "string" ? String(kind === "movie" ? r.title : r.name).trim() : "";
    if (!kind || id === null || !title || seen.has(kind + ":" + id)) return;
    seen.add(kind + ":" + id);
    const date = typeof (kind === "movie" ? r.release_date : r.first_air_date) === "string" ? String(kind === "movie" ? r.release_date : r.first_air_date) : "";
    const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined;
    const poster = typeof r.poster_path === "string" && r.poster_path.startsWith("/") ? TMDB_POSTER + r.poster_path : undefined;
    const backdrop = typeof r.backdrop_path === "string" && r.backdrop_path.startsWith("/") ? TMDB_BACKDROP + r.backdrop_path : undefined;
    const overview = typeof r.overview === "string" && r.overview.trim() ? r.overview.trim() : undefined;
    const genres = Array.isArray(r.genre_ids) ? (r.genre_ids as unknown[]).map((g) => (typeof g === "number" ? TMDB_GENRES[g] : undefined)).filter((n): n is string => typeof n === "string") : [];
    const released = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
    // TMDB's rating on every title (2026-09-24): the search answer carries it
    const rating = typeof r.vote_average === "number" && typeof r.vote_count === "number" ? ratingLabel({ mean: r.vote_average, votes: r.vote_count }) : null;
    out.push({ ...(rating ? { rating } : {}), kind, id, title, ...(year !== undefined ? { year } : {}), ...(released ? { released } : {}), ...(poster ? { poster } : {}), ...(backdrop ? { backdrop } : {}), ...(overview ? { overview } : {}), ...(via ? { via } : {}), ...(genres.length ? { genres } : {}) });
  };
  for (const r of results as Array<Record<string, unknown>>) {
    if (out.length >= max) break;
    if (r && r.media_type === "person" && typeof r.name === "string" && Array.isArray(r.known_for)) { for (const k of r.known_for as Array<Record<string, unknown>>) { if (out.length >= max) break; one(k, r.name.trim()); } }
    else one(r);
  }
  return out;
}

export interface CatalogRow { app: string; name: string; facet: string; candidate: LookupCandidate; exact: boolean; offer: string; offers: OfferKind[] }

/**
 * The rows: TMDB's titles in TMDB's order, the title that IS the words first; under each title one card per household
 * service that carries it (in the household's order), with the offer. A title no configured service carries is discarded.
 * Pure over (q, titles, services).
 */
export function catalogRows(q: string, titles: readonly CatalogTitle[], services: readonly CatalogService[]): CatalogRow[] {
  const want = normalizeTrackText(q);
  const ordered = [...titles].sort((a, b) => Number(normalizeTrackText(b.title) === want) - Number(normalizeTrackText(a.title) === want));
  const rows: CatalogRow[] = [];
  for (const t of ordered) {
    const exact = !!want && normalizeTrackText(t.title) === want;
    for (const s of services) {
      if (s.status !== "signed-in" || !s.providers.length) continue;
      const offers = OFFER_ORDER.filter((o) => (t.offers[o] ?? []).some((id) => s.providers.includes(id)));
      if (!offers.length) continue;
      const candidate: LookupCandidate = { id: `tmdb:${t.kind}:${t.id}`, title: t.title, kind: t.kind === "tv" ? "series" : "movie", ...(t.year !== undefined ? { year: t.year } : {}), ...(t.poster ? { poster: t.poster } : {}), ...(t.backdrop ? { backdrop: t.backdrop } : {}), ...(t.overview ? { overview: t.overview } : {}), ...(t.via ? { via: t.via } : {}), ...(t.genres?.length ? { genres: t.genres } : {}), ...(t.rating ? { rating: t.rating } : {}) };
      rows.push({ app: s.app, name: s.name, facet: s.facet, candidate, exact, offer: offerLabel(offers), offers });
    }
  }
  return rows;
}

/** A candidate id the catalog made (never a service's own id). */
export function isCatalogId(id: string): boolean { return /^tmdb:(movie|tv):\d+$/.test(id); }
