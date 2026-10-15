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

// ---- the words every screen draws (2026-10-14, "make the search and details screens on the companion app tied to it in the app so as
// changes are made they come to both"): the offer word, a card's line, a library hit's line, the status line and the layout of the
// results are decided here once; the PC's Search and the phone's draw them as given, so a change lands on both.

/** The offer as a card says it: a subscription is "Included"; the rest as the service said. */
export function offerWord(offer: string | null | undefined): string {
  const o = offer ?? "";
  return o.length === 0 ? "" : o.startsWith("Sub") ? "Included" : o;
}
export function kindWord(kind: string | null | undefined): string {
  switch (kind) { case "movie": return "Movie"; case "series": return "Series"; case "episode": return "Episode"; case "live": return "Live"; default: return ""; }
}
export interface SearchWorkCard {
  /** the offer the card leads with: Owned, else the first Included or Free, else the first service's */
  offer: string;
  /** "Included  ·  2019  ·  Series  ·  with Disney+" */
  line: string;
  /** the line in amber when the title costs (not owned, included or free) */
  amber: boolean;
  /** "Netflix: Included" per service, for a tooltip or a list */
  services: string[];
  /** "Play on Netflix  ·  Included" per service, in the rows' order */
  plays: string[];
  /** the top result's facts: "2019  ·  Series  ·  Drama  ·  Comedy" (three genres at most) */
  facts: string;
}
export function workCard(w: Pick<SearchWork, "owned" | "services" | "year" | "kind" | "via" | "genres">): SearchWorkCard {
  const offers = w.services.map((s) => offerWord(s.offer));
  const offer = w.owned ? "Owned" : offers.find((o) => o === "Included" || o.startsWith("Free")) ?? offers[0] ?? "";
  const amber = !(w.owned || offer === "Included" || offer.startsWith("Free"));
  const year = w.year === null ? "" : String(w.year);
  const line = [offer, year, kindWord(w.kind), w.via ? "with " + w.via : ""].filter((x) => x.length > 0).join("  ·  ");
  const facts = [year, kindWord(w.kind), ...w.genres.slice(0, 3)].filter((x) => x.length > 0).join("  ·  ");
  const playOffer = (s: SearchWork["services"][number]) => (w.owned && s.offer === "Owned" ? "Owned" : offerWord(s.offer));
  return { offer, line, amber, services: w.services.map((s) => s.name + (offerWord(s.offer) ? ": " + offerWord(s.offer) : "")), plays: w.services.map((s) => "Play on " + s.name + (playOffer(s) ? "  ·  " + playOffer(s) : "")), facts };
}
export function fromWord(from: string | null | undefined): string {
  switch (from) { case "continue": return "Continue Watching"; case "list": return "My List"; case "owned": return "Owned"; default: return ""; }
}
/** "Continue Watching on Netflix  ·  +1 more", and "Play on Netflix  ·  Continue Watching" per service. */
export function libraryLine(h: Pick<LibraryHit, "services">): { line: string; plays: string[] } {
  const first = h.services[0];
  if (!first) return { line: "", plays: [] };
  return { line: fromWord(first.from) + " on " + first.name + (h.services.length > 1 ? "  ·  +" + (h.services.length - 1) + " more" : ""), plays: h.services.map((s) => "Play on " + s.name + (fromWord(s.from) ? "  ·  " + fromWord(s.from) : "")) };
}

export interface SearchLayoutIn {
  q: string; done: boolean; source?: string | null;
  services: ReadonlyArray<{ name: string; status: string; reason?: string | null }>;
  works: ReadonlyArray<Pick<SearchWork, "key" | "exact" | "score">>;
  library: ReadonlyArray<unknown>;
  people: ReadonlyArray<{ name: string }>;
  person?: { name: string } | null;
  elsewhere?: ReadonlyArray<string> | null;
  attribution?: string | null;
  /** a filter is on and left nothing of `all` rows */
  filtered: boolean; all: number;
}
export interface SearchLayout {
  /** the words are a person's name: their face first, their work one press away */
  personFirst: boolean;
  /** the key of the work shown large at the top, when the words name it (or a person's best-known work) */
  top: string | null;
  /** the heading over the rest of the works ("On your services", "More on your services", "<Name> on your services"); null with no works */
  restHeading: string | null;
  /** the heading over the household's own titles */
  libraryHeading: string;
  /** what to say when there are no works: the filter's miss, nothing found, or null while still searching */
  empty: string | null;
  /** the status line under the title: who is still looking, who had nothing, who could not, the attribution; null when there is nothing to say */
  status: string | null;
  /** "Searching for" or "Results for" */
  heading: string;
}
const normWords = (x: string): string => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** The results' layout and words, from the state (the PC's rules as they stood in C# until 2026-10-14). */
export function searchLayout(v: SearchLayoutIn): SearchLayout {
  const works = v.works;
  const first = v.people[0];
  const personFirst = !v.person && !!first && normWords(first.name) === normWords(v.q) && !(works.length > 0 && works[0]!.exact);   // a title that IS the words stays first ("Firefly" the show, not a person of that name)
  const top = works[0];
  const strong = !!top && (!!v.person || top.exact || top.score >= 90);
  const rest = strong ? works.length - 1 : works.length;
  const restHeading = rest > 0 ? (v.person ? v.person.name + " on your services" : strong ? "More on your services" : "On your services") : null;
  const searching = v.services.filter((s) => s.status === "searching").map((s) => s.name);
  const empty = v.services.filter((s) => s.status === "empty").map((s) => s.name);
  const cannot = v.services.filter((s) => s.status !== "searching" && s.status !== "empty" && s.status !== "ok").map((s) => s.name + ": " + (s.reason || s.status));
  const catalog = v.source === "catalog";
  const parts: string[] = [];
  if (catalog) { if (!v.done) parts.push("asking TMDB"); if (cannot.length) parts.push(cannot.join("  ·  ")); }   // a catalog search: the services carrying nothing are simply absent from the row
  else {
    if (searching.length) parts.push("still searching " + searching.join(", "));
    if (empty.length) parts.push("nothing on " + empty.join(", "));
    if (cannot.length) parts.push(cannot.join("  ·  "));
  }
  if (v.attribution) parts.push(v.attribution);
  let none: string | null = null;
  if (works.length === 0) {
    if (v.filtered && v.all > 0) none = "None of the " + v.all + " results match the filter.";
    else if (v.done && searching.length === 0 && v.library.length === 0) {
      const elsewhere = (v.elsewhere ?? []).filter((x) => x.length > 0);
      none = v.person ? "TMDB lists none of " + v.person.name + "'s work on your services." : catalog ? (elsewhere.length ? "Not on any of your services  ·  elsewhere on " + elsewhere.join(", ") : "TMDB knows no title by that name on any of your services.") : "No service had it.";
    }
  }
  return { personFirst, top: strong ? top!.key : null, restHeading, libraryHeading: "In your lists", empty: none, status: parts.length ? parts.join("  ·  ") : null, heading: v.done ? "Results for" : "Searching for" };
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
