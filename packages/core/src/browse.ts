/**
 * Browse by genre (2026-09-22, "We need to come up with a way to let people browse by genre, need to use only transparent
 * algorithms though, that's the rule").
 *
 * A genre chip, then rows. Every row is ONE visible number or date from a named source, with its formula, source, region
 * and data date on the row - never a blend, never TMDB's "popularity" (a mix TMDB does not fully publish), never trending,
 * never "for you". The genre a title is in is TMDB's own classification, and the page says so. "On your services" is
 * JustWatch's US listing (through TMDB) matched to the providers the household's adapters claim, under the offer filter
 * (Included by default: a subscription, free, free with ads, or owned; Anything adds rent and buy) - printed on each row, and
 * each card says which offer it is.
 *
 * Pure: the genre table, the rows' definitions, the discover queries, the merge of TMDB's movie and series answers, the
 * value each card shows. The orchestrator does the reads; the host draws. Fixture: browse.test.ts.
 */
import { titlesFromSearch, type CatalogTitle } from "./catalog-search.js";

/** A browse genre: one chip. TMDB keeps separate movie and series genre lists; a chip names the ids of both it covers
 *  (joined with OR), and the genre NAMES (as a title's details list them) that put a household title in its Yours row. */
export interface BrowseGenre { id: string; name: string; movie: readonly number[]; tv: readonly number[]; names: readonly string[] }

export const BROWSE_GENRES: readonly BrowseGenre[] = [
  { id: "action", name: "Action & Adventure", movie: [28, 12], tv: [10759], names: ["Action", "Adventure", "Action & Adventure"] },
  { id: "animation", name: "Animation", movie: [16], tv: [16], names: ["Animation"] },
  { id: "comedy", name: "Comedy", movie: [35], tv: [35], names: ["Comedy"] },
  { id: "crime", name: "Crime", movie: [80], tv: [80], names: ["Crime"] },
  { id: "documentary", name: "Documentary", movie: [99], tv: [99], names: ["Documentary"] },
  { id: "drama", name: "Drama", movie: [18], tv: [18], names: ["Drama"] },
  { id: "family", name: "Family & Kids", movie: [10751], tv: [10751, 10762], names: ["Family", "Kids"] },
  { id: "history", name: "History", movie: [36], tv: [], names: ["History"] },
  { id: "horror", name: "Horror", movie: [27], tv: [], names: ["Horror"] },
  { id: "music", name: "Music", movie: [10402], tv: [], names: ["Music"] },
  { id: "mystery", name: "Mystery", movie: [9648], tv: [9648], names: ["Mystery"] },
  { id: "reality", name: "Reality", movie: [], tv: [10764], names: ["Reality"] },
  { id: "romance", name: "Romance", movie: [10749], tv: [], names: ["Romance"] },
  { id: "scifi", name: "Sci-Fi & Fantasy", movie: [878, 14], tv: [10765], names: ["Science Fiction", "Fantasy", "Sci-Fi & Fantasy"] },
  { id: "thriller", name: "Thriller", movie: [53], tv: [], names: ["Thriller"] },
  { id: "war", name: "War & Politics", movie: [10752], tv: [10768], names: ["War", "War & Politics"] },
  { id: "western", name: "Western", movie: [37], tv: [37], names: ["Western"] },
];
export function browseGenre(id: unknown): BrowseGenre | null { return BROWSE_GENRES.find((g) => g.id === id) ?? null; }

export const BROWSE_REGION = "US";
/** Top rated: a mean over fewer votes than this says little; the floor is printed on the row. */
export const BROWSE_VOTE_FLOOR = 200;
/** Newest: a title nobody has rated yet is mostly a placeholder entry; the floor is printed on the row. */
export const BROWSE_NEWEST_FLOOR = 10;
export const BROWSE_ROW_SIZE = 20;
/**
 * How many /discover pages a row may read to fill itself (2026-09-22). TMDB's offer filter is on the TITLE - it passes a title any
 * provider streams, not only the household's - so a row can come up short once each card is matched to the household's own services.
 * The next page is then read, up to this many, and the row says how many it holds.
 */
export const BROWSE_MAX_PAGES = 3;
/** How far down the merged order the cards are built from before another page is read (a title's providers are read once, kept a day). */
export const BROWSE_LOOKAHEAD = 4;
/** A row opened in full (2026-09-22): how many titles it may hold, and how many pages per kind it may read to get them. */
export const BROWSE_FULL_SIZE = 300;
export const BROWSE_FULL_PAGES = 12;

/**
 * Which offers count as "on your services" (2026-09-22: Fandango at Home rents or sells almost everything, so "any offer" is close to
 * "anywhere"). Included: with a subscription, free, free with ads - or owned, since an owned title plays without paying. Anything: rent and
 * buy too. Printed on every row it narrows.
 */
export type BrowseOffer = "included" | "any";
export const BROWSE_OFFERS: ReadonlyArray<{ id: BrowseOffer; label: string; hint: string; words: string }> = [
  { id: "included", label: "Included", hint: "Titles you can watch without paying more: with a subscription, free, free with ads, or owned.", words: "included with a subscription, free or owned" },
  { id: "any", label: "Anything", hint: "Also titles your services rent or sell.", words: "any offer: subscription, free, rent or buy" },
];
export function browseOfferOf(v: unknown): BrowseOffer { return v === "any" ? "any" : "included"; }
/** TMDB's monetization types for the offer (JustWatch's words: flatrate is a subscription). */
const MONETIZATION: Record<BrowseOffer, string | null> = { included: "flatrate|free|ads", any: null };
/** An offer a card keeps under the filter: Owned always; else one of the offer's kinds. */
export function offerCounts(offer: BrowseOffer, kinds: readonly string[], owned: boolean): boolean {
  return offer === "any" || owned || kinds.some((k) => k === "subscription" || k === "free" || k === "ads");
}

export type BrowseRowId = "yours" | "top" | "newest" | "voted";
export type DiscoverRowId = Exclude<BrowseRowId, "yours">;

/** A row's three-layer disclosure, as the lens rows carry it. `{genre}` and `{date}` are filled by the runtime. */
export interface BrowseRowDef { id: BrowseRowId; name: string; counted: string; who: string; decides: string; source: string; sourceUrl: string; formula: string }

const ON_SERVICES = `JustWatch's ${BROWSE_REGION} listing, through TMDB, of a service you have set up, under the offer shown on the row`;
export const BROWSE_ROWS: readonly BrowseRowDef[] = [
  { id: "yours", name: "Yours", counted: "Your titles in Continue watching, My list and the Library that TMDB files under the genre",
    who: "You: the titles are the ones your services list for you", decides: "TMDB's genre list for each title, in alphabetical order",
    source: "TMDB API, the title's genres", sourceUrl: "https://developer.themoviedb.org/reference/movie-details",
    formula: "Your titles that TMDB files under {genre}, A to Z." },
  { id: "top", name: "Top rated on your services", counted: `TMDB members' mean vote, among titles with at least ${BROWSE_VOTE_FLOOR} votes`,
    who: "TMDB members who rated the title", decides: `TMDB's catalog and its members; availability is ${ON_SERVICES}`,
    source: "TMDB API /discover, vote_average and vote_count; availability by JustWatch", sourceUrl: "https://developer.themoviedb.org/reference/discover-movie",
    formula: `TMDB's {genre} titles on your services (${BROWSE_REGION}, {offer}) with at least ${BROWSE_VOTE_FLOOR} votes, highest mean vote first, as of {date}.` },
  { id: "newest", name: "Newest on your services", counted: "The film's release date, or the series' first air date",
    who: "Nobody votes: the date as TMDB records it", decides: `TMDB's catalog; availability is ${ON_SERVICES}`,
    source: "TMDB API /discover, primary_release_date and first_air_date; availability by JustWatch", sourceUrl: "https://developer.themoviedb.org/reference/discover-tv",
    formula: `TMDB's {genre} titles on your services (${BROWSE_REGION}, {offer}) dated on or before {date} with at least ${BROWSE_NEWEST_FLOOR} votes, newest first.` },
  { id: "voted", name: "Most voted on your services", counted: "How many TMDB members rated the title",
    who: "TMDB members who rated the title", decides: `TMDB's catalog and its members; availability is ${ON_SERVICES}`,
    source: "TMDB API /discover, vote_count; availability by JustWatch", sourceUrl: "https://developer.themoviedb.org/reference/discover-movie",
    formula: `TMDB's {genre} titles on your services (${BROWSE_REGION}, {offer}); the most votes first, as of {date}.` },
];

/**
 * The /discover query for one row, one kind: the genre's ids (OR), the household's provider ids (OR), the region, the
 * row's one sort and its printed floor. Null when the genre has no ids for the kind or the household no providers.
 */
export function discoverQuery(kind: "movie" | "tv", genre: BrowseGenre, row: DiscoverRowId, providers: readonly number[], today: string, offer: BrowseOffer = "any"): string | null {
  const ids = kind === "movie" ? genre.movie : genre.tv;
  if (!ids.length || !providers.length) return null;
  const q: string[] = [
    `with_genres=${encodeURIComponent(ids.join("|"))}`,
    `with_watch_providers=${encodeURIComponent([...new Set(providers)].join("|"))}`,
    `watch_region=${BROWSE_REGION}`,
    "include_adult=false",
  ];
  const m = MONETIZATION[offer];
  if (m) q.push(`with_watch_monetization_types=${encodeURIComponent(m)}`);
  const date = kind === "movie" ? "primary_release_date" : "first_air_date";
  if (row === "top") q.push("sort_by=vote_average.desc", `vote_count.gte=${BROWSE_VOTE_FLOOR}`);
  else if (row === "newest") q.push(`sort_by=${date}.desc`, `${date}.lte=${today}`, `vote_count.gte=${BROWSE_NEWEST_FLOOR}`);
  else q.push("sort_by=vote_count.desc");
  return q.join("&");
}

/** A title of a discover row, with the numbers its row is sorted by. */
export interface BrowseTitle extends Omit<CatalogTitle, "offers"> { mean: number | null; votes: number | null; date: string | null }

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** One kind's discover answer, reduced: TMDB's order kept, the numbers kept (the results carry no media_type; it is set here). */
export function discoverTitles(kind: "movie" | "tv", results: unknown): BrowseTitle[] {
  if (!Array.isArray(results)) return [];
  const raw = results.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const base = titlesFromSearch(raw.map((r) => ({ ...r, media_type: kind })), raw.length);
  return base.map((t) => {
    const r = raw.find((x) => x.id === t.id)!;
    return { ...t, mean: num(r.vote_average), votes: num(r.vote_count), date: day(kind === "movie" ? r.release_date : r.first_air_date) };
  });
}

/**
 * The row: the movie and series answers merged by the row's one key (each answer is already sorted by it at TMDB), ties
 * kept in the order they came, films before series on an exact tie; the first `max`. Pure.
 */
export function mergeDiscover(row: DiscoverRowId, movies: readonly BrowseTitle[], series: readonly BrowseTitle[], max = BROWSE_ROW_SIZE): BrowseTitle[] {
  const all = [...movies, ...series].map((t, i) => ({ t, i }));
  const key = (t: BrowseTitle): number | string | null => (row === "top" ? t.mean : row === "voted" ? t.votes : t.date);
  return all.filter((x) => key(x.t) !== null).sort((a, b) => {
    const ka = key(a.t)!, kb = key(b.t)!;
    if (ka !== kb) return typeof ka === "number" ? (kb as number) - ka : String(kb) < String(ka) ? -1 : 1;
    if (row === "top" && a.t.votes !== b.t.votes) return (b.t.votes ?? 0) - (a.t.votes ?? 0);   // the equal mean: more votes first, the row's second printed number
    return a.i - b.i;
  }).slice(0, max).map((x) => x.t);
}

/** A discover row's card as the host draws it: the title, the row's value, and every household service that carries it
 *  (with the offer; "Owned" where the household owns it) - one service plays on press, several offer the choice. */
export interface BrowseCard {
  id: string; kind: "movie" | "series"; title: string;
  year?: number | undefined; poster?: string | undefined; backdrop?: string | undefined; overview?: string | undefined; genres?: string[] | undefined;
  value: string;
  /** TMDB's rating as every card shows it (star, mean, TMDB, votes), when TMDB has votes (2026-09-24, "Would prefer to see these on every title") */
  rating?: string | undefined;
  services: Array<{ app: string; name: string; facet: string; offer: string }>;
}

/** The number a card shows under its title: the row's own value, with its source, never bare. */
export function browseValue(row: DiscoverRowId, t: BrowseTitle): string {
  const votes = (n: number) => (n >= 1000 ? (n >= 10_000 ? Math.round(n / 1000) : Math.round(n / 100) / 10) + "k" : String(n));
  if (row === "top") return t.mean !== null && t.votes ? `★ ${t.mean.toFixed(1)} · TMDB · ${votes(t.votes)} votes` : "";
  if (row === "voted") return t.votes !== null ? `${votes(t.votes)} votes · TMDB` : "";
  return t.date ? `${t.date} · TMDB` : "";
}

/** A household title is in the genre's Yours row when TMDB's genres for it include one of the chip's names. */
export function inGenre(genres: readonly string[] | null | undefined, genre: BrowseGenre): boolean {
  return !!genres && genres.some((g) => genre.names.includes(g));
}
