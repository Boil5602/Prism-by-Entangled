/**
 * The Watch page's sort and the search's filters (2026-09-22, "Let's create sort options for the watch and library
 * screens. Sort options should include release date (desc/asc), average rating (desc). When searching, should be able to
 * filter by genre and service").
 *
 * One rule for the Library tab's rows (and the search's filters), pure over (cards, sort, facts): same inputs, same order.
 * The Watch tab's rows keep their own order always (§4 for the two rows, each lens's own for its row): a global sort there
 * made every lens row look the same ("Maybe we should only do that in the library", 2026-09-22). "own" is A to Z in the Library;
 * the others are TMDB's dates and ratings through the lens resolver's facts - a title the facts have nothing for keeps
 * its place after the ones that have, in the order it had. The host draws the chips and asks; it never orders.
 */
import { factsFor, type TitleFacts } from "./lenses.js";

export type HubSort = "own" | "newest" | "oldest" | "rated";

/** The chips, in the order they are drawn; `own` is the default and the only one that needs no TMDB key. */
export const HUB_SORTS: ReadonlyArray<{ id: HubSort; label: string; hint: string }> = [
  { id: "own", label: "A to Z", hint: "Each genre row alphabetical." },
  { id: "newest", label: "Newest", hint: "Release date, newest first (TMDB). Titles without a date follow." },
  { id: "oldest", label: "Oldest", hint: "Release date, oldest first (TMDB). Titles without a date follow." },
  { id: "rated", label: "Top rated", hint: "Average rating, highest first (TMDB); under fifty votes sorts after the rest. Unrated titles follow." },
];

export function hubSortOf(v: unknown): HubSort { return v === "newest" || v === "oldest" || v === "rated" ? v : "own"; }

/** The title's release date as the facts know it: Wikidata's publication date, else TMDB's release / first-air date, else its year. */
export function releaseOf(f: TitleFacts | null | undefined): string | null {
  if (!f) return null;
  if (f.released) return f.released;
  if (f.first) return f.first;
  return typeof f.year === "number" ? String(f.year) : null;
}

/** A rating's rank: under fifty votes sorts after the rest (the same rule as the lens), the mean within. */
function ratingRank(f: TitleFacts | null | undefined): number | null {
  const r = f?.rating;
  if (!r || !(r.votes > 0) || !isFinite(r.mean)) return null;
  return (r.votes >= 50 ? 100 : 0) + r.mean;
}

/**
 * The cards under the sort. Stable: ties and the unknown keep the order they had, the unknown after the known.
 */
export function sortCards<T extends { item: { title: string; kind?: string | null | undefined } }>(cards: readonly T[], sort: HubSort, facts: ReadonlyMap<string, TitleFacts>): T[] {
  if (sort === "own") return [...cards];
  const keyed = cards.map((c, i) => {
    const f = factsFor(facts, c.item.title, c.item.kind);
    const v = sort === "rated" ? ratingRank(f) : releaseOf(f);
    return { c, i, v };
  });
  return keyed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    if (sort === "rated") return (b.v as number) - (a.v as number) || a.i - b.i;
    // a date sorts as text ("2019-05-03" against "2019"): a bare year sorts as its first day
    const av = String(a.v), bv = String(b.v);
    const d = sort === "newest" ? (bv < av ? -1 : bv > av ? 1 : 0) : (av < bv ? -1 : av > bv ? 1 : 0);
    return d || a.i - b.i;
  }).map((x) => x.c);
}

/** The search's filter: a genre (as TMDB names it on the card) and / or a service (its App id). Empty = all. */
export interface LookupFilter { genre?: string | null | undefined; app?: string | null | undefined }

/**
 * The result rows under the filter, and the choices the rows offer (every genre and service present in the unfiltered
 * rows, so a chip never empties the other group's chips). Pure.
 */
export function filterLookupRows<T extends { app: string; name: string; candidate: { genres?: readonly string[] | undefined } }>(rows: readonly T[], filter: LookupFilter): { rows: T[]; genres: string[]; services: Array<{ app: string; name: string }> } {
  const genres = [...new Set(rows.flatMap((r) => r.candidate.genres ?? []))].sort((a, b) => a.localeCompare(b));
  const services: Array<{ app: string; name: string }> = [];
  for (const r of rows) if (!services.some((s) => s.app === r.app)) services.push({ app: r.app, name: r.name });
  const g = filter.genre ?? null; const a = filter.app ?? null;
  const kept = rows.filter((r) => (!g || (r.candidate.genres ?? []).includes(g)) && (!a || r.app === a));
  return { rows: kept, genres, services };
}
