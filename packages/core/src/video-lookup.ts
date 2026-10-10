/**
 * Cross-service video search (docs/video-menu-spec.md §2 row 5, the "later option" taken 2026-09-19: "All the services
 * get searched but the app returns the results straight to the screen").
 *
 * One query, every signed-in service asked at once on its own hidden surface (the service's own search page, the
 * person's own session, its own words - never a private endpoint), each answer read page-side by the adapter's
 * videoLookup script, and the answers laid out as ONE labeled row on the wall's menu. What is pure lives here: the shape
 * a service's answer is cleaned to, and the order the merged row takes - a function of the query, the services in the
 * household's order and their own answers, and nothing else (the transparency rule of §4 holds for search too: Prism
 * ranks nothing beyond "the title you typed, then each service's own order, one card per service in turn").
 */

import { normalizeTrackText } from "./music-lookup.js";

export interface LookupCandidate {
  /** the service's own id (a path id, an asset id) - what its play or open takes */
  id: string;
  title: string;
  kind: "movie" | "series" | "episode" | "title" | "live";
  year?: number | undefined;
  /** the title's own address on the service; absent when the service reaches it only from its search page (Peacock) */
  url?: string | undefined;
  poster?: string | undefined;
  /** TMDB's landscape backdrop (a catalog card), shown whole on the 16:9 card */
  backdrop?: string | undefined;
  /** TMDB's rating as the cards show it (a catalog card, 2026-09-24) */
  rating?: string | undefined;
  series?: string | undefined;
  /** false when the address opens a details page rather than playing (a person presses Play there) */
  play?: boolean | undefined;
  /** the title's own synopsis as the catalog gives it (TMDB's overview) - on the card's hover, never in its place */
  overview?: string | undefined;
  /** a catalog title reached through a person the words named (an actor, a director): "with <name>" on the card */
  via?: string | undefined;
  /** TMDB's genres for a catalog title, named - the search's genre filter (2026-09-22) */
  genres?: string[] | undefined;
}

export type LookupServiceStatus = "searching" | "ok" | "empty" | "error" | "unavailable" | "needs-profile";

export interface LookupServiceState {
  app: string;
  name: string;
  facet: string;
  status: LookupServiceStatus;
  candidates: LookupCandidate[];
  reason?: string | undefined;
  at: number;
}

export interface LookupState {
  q: string;
  token: string;
  startedAt: number;
  /** every service has answered, failed or been skipped */
  done: boolean;
  services: LookupServiceState[];
  /** "catalog": TMDB's titles matched to the household's services (catalog-search.ts); "services": each service's own search page */
  source?: "catalog" | "services";
  /** the wording the row carries for a catalog search (TMDB's terms) */
  attribution?: string;
  /** a catalog search's rows, already ordered (catalog-search.ts catalogRows); a services search orders through orderLookup */
  catalog?: import("./catalog-search.js").CatalogRow[];
  /** a catalog search that found titles on none of the household's services: the provider names TMDB listed, for the status line */
  elsewhere?: string[];
  /** the providers TMDB listed that no adapter claims, name -> TMDB id: how an adapter's tmdbProviders is checked against the live data (data, never drawn) */
  unmapped?: Record<string, number>;
  /** the people TMDB matched the words to (2026-09-23): a press lists their work */
  people?: import("./search-view.js").SearchPerson[];
  /** a person's work: whose (the words are their name) */
  person?: { id: number; name: string };
}

/** How many of a service's answers the row carries - its own top, in its own order. */
export const LOOKUP_PER_SERVICE = 12;

const KINDS = new Set(["movie", "series", "episode", "title", "live"]);

/** A service's raw answer as its page posted it, cleaned to the shape above; anything unnamed or without an id is dropped. */
export function cleanCandidates(raw: unknown, max = LOOKUP_PER_SERVICE): LookupCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: LookupCandidate[] = [];
  const seen = new Set<string>();
  for (const c of raw as Array<Record<string, unknown>>) {
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    const title = typeof c.title === "string" ? c.title.replace(/\s+/g, " ").trim() : "";
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const kind = typeof c.kind === "string" && KINDS.has(c.kind) ? (c.kind as LookupCandidate["kind"]) : "title";
    const year = typeof c.year === "number" && c.year > 1800 && c.year < 2200 ? Math.round(c.year) : typeof c.year === "string" && /^\d{4}$/.test(c.year) ? Number(c.year) : undefined;
    const url = typeof c.url === "string" && /^https?:\/\//.test(c.url) ? c.url : undefined;
    const poster = typeof c.poster === "string" && /^https?:\/\//.test(c.poster) ? c.poster : undefined;
    const series = typeof c.series === "string" && c.series.trim() ? c.series.trim() : undefined;
    const overview = typeof c.overview === "string" && c.overview.trim() ? c.overview.trim().slice(0, 600) : undefined;
    const via = typeof c.via === "string" && c.via.trim() ? c.via.trim() : undefined;
    out.push({ id, title, kind, ...(year !== undefined ? { year } : {}), ...(url ? { url } : {}), ...(poster ? { poster } : {}), ...(series ? { series } : {}), ...(overview ? { overview } : {}), ...(via ? { via } : {}), ...(c.play === false ? { play: false } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

export interface LookupRow { app: string; name: string; facet: string; candidate: LookupCandidate; exact: boolean }

/**
 * The merged row, pure over (q, services in the household's order, each service's own answers): the titles that ARE the
 * words typed first (one per service, in the household's order), then the rest one card per service in turn, each
 * service's own order kept. Nothing else weighs in - no popularity, no history, no Prism preference.
 */
export function orderLookup(q: string, services: readonly LookupServiceState[]): LookupRow[] {
  const want = normalizeTrackText(q);
  const rows: LookupRow[] = [];
  const queues = services.map((s) => ({ s, list: [...s.candidates] }));
  if (want) {
    for (const qu of queues) {
      const i = qu.list.findIndex((c) => normalizeTrackText(c.title) === want);
      if (i >= 0) { rows.push({ app: qu.s.app, name: qu.s.name, facet: qu.s.facet, candidate: qu.list[i]!, exact: true }); qu.list.splice(i, 1); }
    }
  }
  let any = true;
  while (any) {
    any = false;
    for (const qu of queues) {
      const c = qu.list.shift();
      if (!c) continue;
      any = true;
      rows.push({ app: qu.s.app, name: qu.s.name, facet: qu.s.facet, candidate: c, exact: false });
    }
  }
  return rows;
}

/**
 * Which of a service's search results is the title a card names (2026-10-09, "it is showing the paramount page in the big window
 * instead of the stream I dropped on it": Paramount+ answered Star Trek: Strange New Worlds with two results of that name, its live
 * Star Trek channel - airing the show just then - and the series; the first was taken, the channel's tune timed out, and the window
 * sat on the service's page). Among the results named as the title: the card's own kind first (a series for a series, a film for a
 * film), then any title that is not a live channel, a live channel last. `same` says two names are one (the caller's folding).
 */
export function pickTitleHit<C extends { title: string; kind: string; series?: string | undefined }>(candidates: ReadonlyArray<C>, title: string, kind: string | undefined, same: (a: string, b: string) => boolean): C | null {
  const want = kind === "tv" || kind === "series" ? "series" : kind === "movie" ? "movie" : "";
  const rank = (c: C): number => (c.kind === "live" ? 2 : want && c.kind !== want && c.kind !== "title" ? 1 : 0);
  const named = candidates.filter((c) => same(c.title, title));
  const pool = named.length ? named : candidates.filter((c) => same(c.series ?? "", title));
  let best: C | null = null;
  for (const c of pool) if (!best || rank(c) < rank(best)) best = c;   // the service's own order within a rank
  return best;
}
