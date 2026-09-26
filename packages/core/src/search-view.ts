/**
 * Search, one card per work (2026-09-23, "all the streaming services searches suck. Time to give them a powerful upgrade"; "Should work PRETTY
 * well cross-service without TMDB, should work VERY well with TMDB connected"; "show a symbol for that streaming service, and show a stack of
 * cards for multiple"). Pure: the rows the search already has in, the view the Watch page draws out.
 *  - the household's own titles first, matched as they type: Continue Watching, My List, what they own - no network at all;
 *  - one card per work, every service that carries it on the card (TMDB's work id with a key, else the title and year the services named);
 *  - the people TMDB matched, whose work on the household's services is one press away.
 * Every match is by words the person typed against the title the service or TMDB gave - nothing ranked by Prism beyond how well the words match.
 */
import { isCatalogId, TMDB_POSTER } from "./catalog-search.js";

/** The words as compared: lower case, accents off, "&" as "and", punctuation as space, a leading "the" dropped. */
export function normSearch(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
}

function within1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * How well the words match a title, 0..100: the title itself 100; the title starting with the words 90; every word the start of one of the
 * title's words 75; the words inside the title 60; every word of four letters or more one letter off one of the title's words 45; else 0.
 */
export function matchScore(q: string, title: string): number {
  const nq = normSearch(q), nt = normSearch(title);
  if (nq.length < 2 || !nt) return 0;
  if (nt === nq) return 100;
  if (nt.startsWith(nq)) return 90;
  const qw = nq.split(" "), tw = nt.split(" ");
  if (qw.every((w) => tw.some((t) => t.startsWith(w)))) return 75;
  if (nq.length >= 4 && nt.includes(nq)) return 60;   // a short word only at the start of a word ("lee" is not in "Bleed", 2026-09-23)
  if (qw.every((w) => (w.length >= 4 ? tw.some((t) => within1(w, t) || (t.length > w.length && within1(w, t.slice(0, w.length)))) : tw.some((t) => t.startsWith(w))))) return 45;
  return 0;
}

export interface LibraryEntry {
  app: string; name: string; facet: string;
  from: "continue" | "list" | "owned";
  item: { id: string; title: string; kind?: string | null; url?: string | null; artwork?: string | null; subtitle?: string | null; series?: string | null };
}
export interface LibraryHit {
  title: string; kind: string; artwork: string | null; score: number;
  /** each service it is on for the household, and which of their lists holds it there */
  services: Array<{ app: string; name: string; facet: string; from: LibraryEntry["from"]; item: LibraryEntry["item"] }>;
}
const FROM_ORDER: Record<LibraryEntry["from"], number> = { continue: 0, list: 1, owned: 2 };

/** The household's own titles the words match, one per title, best match first (then Continue Watching before My List before owned). */
export function libraryHits(q: string, entries: readonly LibraryEntry[], max = 16): LibraryHit[] {
  const by = new Map<string, LibraryHit>();
  for (const e of entries) {
    const title = (e.item.series && e.item.series.trim()) || e.item.title;
    const score = matchScore(q, title);
    if (score < 45) continue;
    const key = normSearch(title);
    const hit = by.get(key) ?? { title, kind: e.item.series ? "series" : e.item.kind ?? "title", artwork: null, score, services: [] };
    if (!hit.artwork && e.item.artwork) hit.artwork = e.item.artwork;
    if (!hit.services.some((s) => s.app === e.app)) hit.services.push({ app: e.app, name: e.name, facet: e.facet, from: e.from, item: e.item });
    by.set(key, hit);
  }
  const out = [...by.values()];
  for (const h of out) h.services.sort((a, b) => FROM_ORDER[a.from] - FROM_ORDER[b.from]);
  return out.sort((a, b) => b.score - a.score || FROM_ORDER[a.services[0]!.from] - FROM_ORDER[b.services[0]!.from] || a.title.localeCompare(b.title)).slice(0, max);
}

/** The household's own titles that ARE works a search found (a person's work, a title TMDB matched to other words), after the word matches, once each. */
export function libraryForWorks(q: string, entries: readonly LibraryEntry[], works: readonly { title: string }[], max = 16): LibraryHit[] {
  const out = libraryHits(q, entries, max);
  const have = new Set(out.map((h) => normSearch(h.title)));
  for (const w of works.slice(0, 24)) {
    if (out.length >= max) break;
    const n = normSearch(w.title);
    if (have.has(n)) continue;
    const hit = libraryHits(w.title, entries, 1)[0];
    if (hit && hit.score === 100) { out.push({ ...hit, score: 70 }); have.add(n); }
  }
  return out;
}

export interface SearchRowIn {
  app: string; name: string; facet: string; exact?: boolean; offer?: string; offers?: string[];
  candidate: { id: string; title: string; kind?: string; year?: number; poster?: string; backdrop?: string; overview?: string; genres?: string[]; via?: string; series?: string; [k: string]: unknown };
}
export interface SearchWork {
  key: string; title: string; kind: string; year: number | null; poster: string | null; backdrop: string | null; overview: string | null;
  genres: string[]; via: string | null; exact: boolean; score: number; owned: boolean;
  /** TMDB's rating as the cards show it, when the catalog gave one (2026-09-24) */
  rating: string | null;
  /** every service that carries it, in the rows' order - the card's symbols, a stack when more than one */
  services: Array<{ app: string; name: string; facet: string; offer: string; candidate: SearchRowIn["candidate"] }>;
}

/** The rows as works: a catalog id is one work; a service's own answer groups by its title and year (a title with no year joins the one year of that title). */
export function searchWorks(q: string, rows: readonly SearchRowIn[]): SearchWork[] {
  const works: SearchWork[] = [];
  const byKey = new Map<string, SearchWork>();
  const yearsOf = new Map<string, Set<number>>();
  for (const r of rows) if (!isCatalogId(r.candidate.id) && typeof r.candidate.year === "number") { const n = normSearch(r.candidate.title); (yearsOf.get(n) ?? yearsOf.set(n, new Set()).get(n)!).add(r.candidate.year); }
  for (const r of rows) {
    const c = r.candidate;
    let key: string;
    if (isCatalogId(c.id)) key = c.id;
    else {
      const n = normSearch(c.title);
      const years = yearsOf.get(n);
      const y = typeof c.year === "number" ? c.year : years && years.size === 1 ? [...years][0]! : null;
      key = "t:" + n + "|" + (y ?? "") + "|" + (c.kind === "movie" ? "m" : c.kind === "series" || c.kind === "episode" ? "s" : "");
    }
    let w = byKey.get(key);
    if (!w) {
      w = { key, title: c.title, kind: c.kind ?? "title", year: typeof c.year === "number" ? c.year : null, poster: c.poster ?? null, backdrop: c.backdrop ?? null, overview: c.overview ?? null, genres: c.genres ?? [], via: c.via ?? null, exact: !!r.exact, score: matchScore(q, c.title), owned: false, rating: typeof c.rating === "string" ? c.rating : null, services: [] };
      byKey.set(key, w); works.push(w);
    }
    w.poster ??= c.poster ?? null; w.backdrop ??= c.backdrop ?? null; w.overview ??= c.overview ?? null;
    if (w.rating === null && typeof c.rating === "string") w.rating = c.rating;
    if (w.year === null && typeof c.year === "number") w.year = c.year;
    if (!w.genres.length && c.genres?.length) w.genres = c.genres;
    w.exact ||= !!r.exact;
    if (r.offer === "Owned") w.owned = true;
    if (!w.services.some((s) => s.app === r.app)) w.services.push({ app: r.app, name: r.name, facet: r.facet, offer: r.offer ?? "", candidate: c });
  }
  // the title that IS the words first, then how well the words match; otherwise the order the rows came in (TMDB's, or the services')
  return works.map((w, i) => ({ w, i })).sort((a, b) => Number(b.w.exact || b.w.score === 100) - Number(a.w.exact || a.w.score === 100) || (b.w.score >= 75 ? 1 : 0) - (a.w.score >= 75 ? 1 : 0) || a.i - b.i).map((x) => x.w);
}

export interface SearchPerson { id: number; name: string; photo: string | null; known: string; knownFor: string[] }
/** The people in TMDB's search results, as TMDB names them: their department and the titles TMDB knows them for. */
export function peopleFromSearch(results: unknown, max = 8): SearchPerson[] {
  if (!Array.isArray(results)) return [];
  const out: SearchPerson[] = [];
  for (const r of results as Array<Record<string, unknown>>) {
    if (!r || r.media_type !== "person" || typeof r.id !== "number" || typeof r.name !== "string" || !r.name.trim()) continue;
    const kf = Array.isArray(r.known_for) ? (r.known_for as Array<Record<string, unknown>>).map((k) => (typeof k.title === "string" ? k.title : typeof k.name === "string" ? k.name : "")).filter((t) => t) : [];
    out.push({ id: r.id, name: r.name.trim(), photo: typeof r.profile_path === "string" && r.profile_path.startsWith("/") ? TMDB_POSTER.replace("w342", "w185") + r.profile_path : null, known: typeof r.known_for_department === "string" ? r.known_for_department : "", knownFor: kf.slice(0, 3) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A person's credits (TMDB combined_credits) as search results in the shape titlesFromSearch reads, their real work first: each credit
 * weighed by the part - a series by its episodes (10+ a regular, under 3 a guest), a film by billing (the top five leads), directing or
 * creating in full - times TMDB's popularity; a talk show's "Himself" left out. Once each, the larger part kept.
 */
export function creditsAsResults(credits: unknown): Array<Record<string, unknown>> {
  const c = (credits && typeof credits === "object" ? credits : {}) as Record<string, unknown>;
  const weight = (r: Record<string, unknown>, crew: boolean): number => {
    if (crew) return /^(Director|Creator|Screenplay|Writer|Novel|Showrunner)$/.test(String(r.job)) ? 1 : 0.4;
    if (r.media_type === "tv") { const n = Number(r.episode_count) || 0; return n >= 10 ? 1 : n >= 3 ? 0.35 : 0.08; }
    const o = typeof r.order === "number" ? r.order : 99; return o <= 4 ? 1 : o <= 12 ? 0.45 : 0.15;
  };
  const best = new Map<string, { r: Record<string, unknown>; score: number }>();
  const take = (list: unknown, crew: boolean) => {
    for (const r of (Array.isArray(list) ? list : []) as Array<Record<string, unknown>>) {
      if (r.media_type !== "movie" && r.media_type !== "tv") continue;
      if (!crew && r.media_type === "tv" && typeof r.character === "string" && /\b(himself|herself|themselves|self)\b/i.test(r.character) && (Number(r.episode_count) || 0) < 10) continue;
      const k = String(r.media_type) + ":" + String(r.id);
      const score = weight(r, crew) * Math.max(1, Number(r.popularity) || 0);
      const had = best.get(k);
      if (!had || score > had.score) best.set(k, { r, score });
    }
  };
  take(c.cast, false); take(c.crew, true);
  return [...best.values()].sort((a, b) => b.score - a.score).map((x) => x.r);
}
