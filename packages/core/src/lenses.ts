/**
 * Lenses and ratings (docs/video-menu-spec.md §4a, 2026-09-20).
 *
 * A lens is a named, open source of numbers a person may lay over the menu's rows - never on by default; the default
 * view is the person's own history and lists (§4). Each lens says, on itself, what is counted, who is counted, who
 * decides, where the numbers come from, the one-sentence formula, and the date of the data. The order a lens gives is
 * a pure function of the rows and that source's data (orderByLens); Prism adds no weight of its own.
 *
 * Everything is fetched on the device under the person's own key where a key is needed, cached in the wall's own store,
 * and routed through nobody (§22). Sources, in the order they were built: Wikimedia pageviews and Wikidata (open, no
 * key), then TMDB behind a key the person supplies (attribution required), Trakt as a later option.
 *
 * NEVER SURFACED - by decision in §4a, and not to be added later: IMDb's score, Rotten Tomatoes, Metacritic, and
 * Wikidata's mirrored review-score property (P444). Their numbers are either licensed for redistribution by nobody but
 * their owners, or aggregate other people's licensed numbers, and none of them can say who was counted. IMDb and
 * Letterboxd appear here only as outbound links a person may follow. See the spec before touching this list.
 */

import type { MenuCard } from "./menu-order.js";
import { TITLE_DETAILS_APPEND, shapePerson, shapeTitleDetails, type PersonPage, type TitleDetails } from "./title-details.js";
import { sortTitle } from "./menu-order.js";

export interface LensDef {
  id: string;
  /** Never the word "trending": a lens is named for what it counts (fixture). */
  name: string;
  /** Layer 1: what is counted. */
  counted: string;
  /** Layer 2: who is counted. */
  who: string;
  /** Layer 3: who decides. */
  decides: string;
  source: string;
  sourceUrl: string;
  /** One sentence; {date} is the data date. */
  formula: string;
  /** the key this lens needs, if any */
  needsKey?: "tmdb";
  /** what the resolver must have for this lens */
  needs: Array<"wiki" | "views" | "wikidata" | "tmdb">;
  attribution?: string;
}

export const TMDB_ATTRIBUTION = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export const LENSES: readonly LensDef[] = [
  {
    id: "wiki-reads", name: "Most read on Wikipedia",
    counted: "Views of each title's English Wikipedia article over the last seven full days.",
    who: "Everyone who opened the article, in any country, on any device; Wikimedia's own filter leaves automated traffic out.",
    decides: "Nobody. It is a count of readers, not a judgement.",
    source: "Wikimedia REST API, pageviews per article", sourceUrl: "https://wikimedia.org/api/rest_v1/",
    formula: "Sum of daily article views over the seven days ending {date}; more views sort first.",
    needs: ["wiki", "views"],
  },
  {
    id: "wd-awards", name: "Award winners on Wikidata",
    counted: "Awards recorded on each title's Wikidata item (the 'award received' statements).",
    who: "The juries, academies and guilds that gave the awards, as Wikidata's volunteer editors recorded them.",
    decides: "Those award bodies. The editors only record them, and an award nobody entered on Wikidata isn't counted.",
    source: "Wikidata, property P166 (award received)", sourceUrl: "https://www.wikidata.org/",
    formula: "Count of 'award received' statements on the item as of {date}; more awards sort first.",
    needs: ["wiki", "wikidata"],
  },
  {
    id: "wd-newest", name: "First released, on Wikidata",
    counted: "Each title's earliest publication date on its Wikidata item, meaning a series' premiere or a film's release.",
    who: "Nobody is counted: it is a date.",
    decides: "The studio or network that released it, as Wikidata's editors recorded the date.",
    source: "Wikidata, property P577 (publication date)", sourceUrl: "https://www.wikidata.org/",
    formula: "The earliest 'publication date' statement as of {date}; the newest sort first.",
    needs: ["wiki", "wikidata"],
  },
  {
    id: "tmdb-rating", name: "TMDB community rating",
    counted: "The votes TMDB members cast for each title, one to ten.",
    who: "Only the TMDB members who chose to vote on that title.",
    decides: "Each voter, equally. TMDB takes the mean.",
    source: "TMDB API, vote_average with vote_count", sourceUrl: "https://www.themoviedb.org/",
    formula: "TMDB's mean vote as of {date}, shown with the vote count. Titles with under fifty votes sort after the rest.",
    needsKey: "tmdb", needs: ["wiki", "wikidata", "tmdb"], attribution: TMDB_ATTRIBUTION,
  },
  {
    id: "tmdb-latest", name: "Newest episodes and releases on TMDB",
    counted: "As TMDB records them: for a series, the date its latest episode aired, and for a film, its release date.",
    who: "Nobody is counted: it is a date.",
    decides: "The network or studio that aired or released it. TMDB's contributors record the date.",
    source: "TMDB API, last_air_date and release_date", sourceUrl: "https://www.themoviedb.org/",
    formula: "The latest episode's air date (a series) or the release date (a film) as of {date}; the newest sort first.",
    needsKey: "tmdb", needs: ["tmdb"], attribution: TMDB_ATTRIBUTION,
  },
  {
    id: "tmdb-votes", name: "Most voted on TMDB",
    counted: "How many TMDB members voted on each title.",
    who: "Only the TMDB members who chose to vote.",
    decides: "Nobody. It is a count of voters, not a judgement.",
    source: "TMDB API, vote_count", sourceUrl: "https://www.themoviedb.org/",
    formula: "TMDB's vote count as of {date}; more votes sort first.",
    needsKey: "tmdb", needs: ["wiki", "wikidata", "tmdb"], attribution: TMDB_ATTRIBUTION,
  },
];

export function lensById(id: string | null | undefined): LensDef | null {
  return id ? LENSES.find((l) => l.id === id) ?? null : null;
}

/** What the wall has learned about a title, from the open sources above; every field is missing until read. */
/** The next episode of a series as TMDB names it (the stage bar's card). */
export interface NextEpisode { season: number; episode: number; name: string; still: string | null; airDate: string | null; overview: string | null }

export interface TitleFacts {
  key: string;
  /** the English Wikipedia article's canonical name, or null when none matched */
  article?: string | null;
  qid?: string | null;
  imdb?: string | null;
  letterboxd?: string | null;
  tmdb?: { kind: "movie" | "tv"; id: number } | null;
  /** the work's kind as the card said it, and its year as TMDB knows it (under a key) - what tells a remake from its namesake */
  kind?: WorkKind | null;
  year?: number | null;
  /** TMDB's poster for the work (from the title search), for a card the service gave none (2026-09-22) */
  poster?: string | null;
  /** TMDB's landscape backdrop (2026-09-23): the Library's cards in the same shape as every other tab's */
  backdrop?: string | null;
  /** TMDB's genres for the work, with the rating (the Library tab's rows, 2026-09-22) */
  genres?: string[];
  awards?: number;
  released?: string | null;
  views7?: { views: number; through: string };
  rating?: { mean: number; votes: number; at: number } | null;
  /** the latest episode's air date (a series) or the release date (a film), as TMDB records it */
  latest?: { date: string; what: "episode" | "release" } | null;
  /** the release date (a film) or first air date (a series) as TMDB records it - the sort's date when Wikidata has none (2026-09-22) */
  first?: string | null;
  /** when each part was read (ms) */
  at: { wiki?: number; views?: number; wikidata?: number; tmdb?: number };
}

/** The title's key in the facts: the same text a card sorts by (case, diacritics and a leading article set aside). */
export function titleKey(title: string): string { return sortTitle(title); }
const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
/**
 * A store's name for a work against TMDB's, loosely (2026-09-22): '&' is 'and', a roman numeral is its number ('Ghostbusters II'),
 * a studio's possessive prefix goes ("Marvel Studios' Ant-Man", "Dr. Seuss' The Grinch", "Stephen King's It"), so does ': The Movie'.
 * Used only after the exact key missed, and only against TMDB's own titles and alternative titles - never a guess at the top result.
 */
export function looseKey(title: string): string {
  const t = title.replace(/^(marvel studios'?|marvel'?s|dr'?\.? seuss'?|stephen king'?s|national lampoon'?s|saban'?s|illumination presents:?|disney'?s|pixar'?s|dreamworks'?|tyler perry'?s|dcu:|live die repeat:)\s+/i, "").replace(/\s*:?\s*the movie$/i, "");
  return sortTitle(t.replace(/&/g, " and ")).split(" ").map((w) => ROMAN[w] ?? w).join(" ").replace(/\bse7en\b/, "seven");
}
/** A card's kind as the sources know it: a film or a show - or nothing, when the service only said "title". */
export type WorkKind = "movie" | "tv";
export function workKind(kind: string | undefined | null): WorkKind | null { return kind === "movie" ? "movie" : kind === "series" || kind === "episode" || kind === "tv" ? "tv" : null; }
/** The facts key: the title, and the kind when known - a film and a series of one name are two works with two dates (2026-09-22). */
export function factsKey(title: string, kind?: string | null): string { const k = workKind(kind); return titleKey(title) + (k ? "|" + k : ""); }
/** The facts for a card: by title and kind, else by title alone (a service that named no kind), else any work of that title. */
export function factsFor(facts: ReadonlyMap<string, TitleFacts>, title: string, kind?: string | null): TitleFacts | undefined {
  const exact = facts.get(factsKey(title, kind)); if (exact) return exact;
  const plain = facts.get(titleKey(title)); if (plain) return plain;
  const prefix = titleKey(title) + "|";
  for (const [k, f] of facts) if (k.startsWith(prefix)) return f;
  return undefined;
}

export interface LensValue { value: number; label: string; date: string }

/** The number a lens reads for a title, with the words a card shows for it; null when the source has nothing. */
export function lensValue(lens: LensDef, f: TitleFacts | undefined): LensValue | null {
  if (!f) return null;
  switch (lens.id) {
    case "wiki-reads": return f.views7 ? { value: f.views7.views, label: `${compact(f.views7.views)} reads · Wikipedia · 7 days`, date: f.views7.through } : null;
    case "wd-awards": return typeof f.awards === "number" && f.at.wikidata ? { value: f.awards, label: `${f.awards} award${f.awards === 1 ? "" : "s"} · Wikidata`, date: isoDay(f.at.wikidata) } : null;
    case "wd-newest": return f.released && f.at.wikidata ? { value: Date.parse(f.released.replace(/-00-00$/, "-01-01").replace(/-00$/, "-01")) || 0, label: `${f.released.slice(0, 10).replace(/-00-00$/, "").replace(/-00$/, "")} · Wikidata`, date: isoDay(f.at.wikidata) } : null;
    case "tmdb-rating": return f.rating && f.rating.votes > 0 ? { value: (f.rating.votes >= 50 ? 100 : 0) + f.rating.mean, label: ratingLabel(f.rating)!, date: isoDay(f.rating.at) } : null;
    case "tmdb-votes": return f.rating && f.rating.votes > 0 ? { value: f.rating.votes, label: `${compact(f.rating.votes)} votes · TMDB`, date: isoDay(f.rating.at) } : null;
    case "tmdb-latest": return f.latest && f.at.tmdb ? { value: Date.parse(f.latest.date) || 0, label: `${f.latest.what === "episode" ? "latest episode " : "released "}${f.latest.date} · TMDB`, date: isoDay(f.at.tmdb) } : null;
    default: return null;
  }
}

/** "★ 7.8 · TMDB · 14k votes" - never a bare number: the source and the vote count always ride along (fixture). */
export function ratingLabel(r: { mean: number; votes: number } | null | undefined): string | null {
  if (!r || !(r.votes > 0) || !isFinite(r.mean)) return null;
  return `★ ${r.mean.toFixed(1)} · TMDB · ${compact(r.votes)} votes`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}
function isoDay(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

export interface LensedCard extends MenuCard { lens?: LensValue | null; rating?: string | null }

/**
 * The rows under a lens: sorted by the lens's value, highest first; titles the source has nothing for follow, in the
 * order they had. Pure over (cards, lens, facts): same inputs, same order (fixture). No lens: the cards as they came.
 */
export function orderByLens(cards: readonly MenuCard[], lens: LensDef | null, facts: ReadonlyMap<string, TitleFacts>): LensedCard[] {
  const rated = (c: MenuCard): LensedCard => ({ ...c, rating: ratingLabel(factsFor(facts, c.item.title, c.item.kind)?.rating) });
  if (!lens) return cards.map(rated);
  const scored = cards.map((c, i) => ({ c: { ...rated(c), lens: lensValue(lens, factsFor(facts, c.item.title, c.item.kind)) }, i }));
  return scored.sort((a, b) => {
    const av = a.c.lens?.value, bv = b.c.lens?.value;
    if (av === undefined && bv === undefined) return a.i - b.i;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return bv - av || a.i - b.i;
  }).map((x) => x.c);
}

/** The lens's data date over a set of cards: the newest date any of them carries, or null before anything is read. */
export function lensDataDate(cards: readonly LensedCard[]): string | null {
  let best: string | null = null;
  for (const c of cards) if (c.lens?.date && (!best || c.lens.date > best)) best = c.lens.date;
  return best;
}

// ------------------------------------------------------------------ the resolver: open sources, on-device cache
export interface LensHooks {
  /** an unparameterized https address, nothing appended (the host's static fetch) */
  fetchStatic(url: string): Promise<string>;
  /** the person's own keyed call (TMDB): their key, their address; absent on a shell without it */
  fetchKeyed?(url: string, headers: Record<string, string>): Promise<string>;
  /** the least time between two open-source reads, ms (default STATIC_GAP_MS; a test's mock may say 0) */
  paceMs?: number;
  store(): { get(key: string): string | null | Promise<string | null>; set(key: string, value: string): void | Promise<void> } | undefined;
  dashId(): string | null;
  now(): number;
}

const DAY = 24 * 3600_000;
const TTL = { wiki: 7 * DAY, views: DAY, wikidata: 7 * DAY, tmdb: 3 * DAY };   // tmdb: three days since the owned library joined (2026-09-22) - two thousand titles, three calls each, a daily pass was too much
/** an unanswered TMDB ask is tried again after this, not a day */
const RETRY_MS = 5 * 60_000;
/** a series' last aired episode is asked again after six hours */
const AIRS_TTL_MS = 6 * 3_600_000;
const KINDS_RE = /\b(film|movie|series|television|tv|show|sitcom|documentary|miniseries|anime|drama|comedy)\b/i;
const CONCURRENCY = 3;
/** the TMDB-only lane's width (TMDB allows some fifty calls a second; four titles at a time is gentle) */
const TMDB_CONCURRENCY = 4;
/** a read that has not answered in this long is given up (its slot freed; the title stays unread until the next open) */
const FETCH_TIMEOUT_MS = 25_000;
/** the open sources are read this far apart at most (Wikimedia asks for a gentle pace of an anonymous client) */
const STATIC_GAP_MS = 1000;   // three a second still drew 429s (2026-09-22); one a second, and under a key most titles need two reads
/** after a 429, no open-source read for this long */
const BACKOFF_MS = 15_000;
function withTimeout<T>(p: Promise<T>, what: string): Promise<T> { return new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + what)), FETCH_TIMEOUT_MS); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); }); }

export class LensResolver {
  private readonly facts = new Map<string, TitleFacts>();
  private readonly loading = new Set<string>();
  private tmdbKey: string | null = null;
  private keyLoaded = false;
  private inFlight = 0;
  private queue: Array<() => Promise<void>> = [];
  /** the TMDB-only lane (2026-09-22): a read that touches no open source runs beside the paced ones instead of queuing behind them - the owned library's two thousand ratings had crawled at the open sources' one a second */
  private inFlightT = 0;
  private queueT: Array<() => Promise<void>> = [];
  /** how many reads are queued or running - a shell polls the menu while this is above zero */
  pending = 0;

  constructor(private readonly hooks: LensHooks) {}

  factsOf(): ReadonlyMap<string, TitleFacts> { return this.facts; }

  // ---- the TMDB key: the person's own, kept in the wall's store, never sent anywhere but TMDB
  async key(): Promise<string | null> {
    if (!this.keyLoaded) {
      const dash = this.hooks.dashId(); const store = this.hooks.store();
      if (dash && store) {   // no dashboard yet: ask again later (the key had been marked read before the document was known, 2026-09-21)
        this.keyLoaded = true;
        try { const raw = await store.get(`lens:tmdb:key:${dash}`); if (raw) this.tmdbKey = raw; } catch { /* none */ }
      }
    }
    return this.tmdbKey;
  }
  setKey(key: string | null): void {
    this.tmdbKey = key && key.trim() ? key.trim() : null; this.keyLoaded = true;
    const dash = this.hooks.dashId(); const store = this.hooks.store();
    if (dash && store) { try { void store.set(`lens:tmdb:key:${dash}`, this.tmdbKey ?? ""); } catch { /* best effort */ } }
    if (!this.tmdbKey) for (const f of this.facts.values()) { f.rating = null; delete f.at.tmdb; }
  }
  hasKey(): boolean { return !!this.tmdbKey; }

  /**
   * Make sure the facts these titles need are read (or being read): the lens's needs, plus TMDB's rating for every title
   * when a key is set. Idempotent; the cache answers first; the network only for what is missing or stale.
   */
  ensure(titles: ReadonlyArray<string | { title: string; kind?: string | null; providers?: readonly number[] }>, needs: ReadonlyArray<"wiki" | "views" | "wikidata" | "tmdb" | "poster">, withRatings: boolean): void {
    const want = new Set<string>(needs);
    if (want.has("poster") && !this.tmdbKey) want.delete("poster");   // a poster is TMDB's: no key, no ask
    if (withRatings && this.tmdbKey) { want.add("wiki"); want.add("wikidata"); want.add("tmdb"); }
    if (want.has("tmdb") && !this.tmdbKey) want.delete("tmdb");   // no key: no TMDB call, ever (fixture)
    if (!want.size) return;
    for (const it of titles) {
      const t = typeof it === "string" ? it : it.title;
      const kind = typeof it === "string" ? null : workKind(it.kind);
      const providers = typeof it === "string" ? [] : it.providers ?? [];
      const key = factsKey(t, kind);
      if (!titleKey(t) || this.loading.has(key)) continue;
      const f = this.facts.get(key);
      const stale = (part: string) => part === "poster" ? f?.poster === undefined || f?.backdrop === undefined : !f?.at[part as keyof typeof TTL] || this.hooks.now() - (f.at[part as keyof typeof TTL] ?? 0) > TTL[part as keyof typeof TTL];
      const missing = [...want].filter((p) => stale(p));
      if (!missing.length) continue;
      this.loading.add(key);
      this.pending++;
      const tmdbOnly = missing.every((m) => m === "tmdb" || m === "poster");
      (tmdbOnly ? this.queueT : this.queue).push(async () => { try { await this.read(key, t, kind, providers, new Set(missing)); } finally { this.loading.delete(key); this.pending--; } });
    }
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!;
      this.inFlight++;
      void job().catch(() => { /* the title stays unread */ }).then(() => { this.inFlight--; this.pump(); });
    }
    while (this.inFlightT < TMDB_CONCURRENCY && this.queueT.length) {
      const job = this.queueT.shift()!;
      this.inFlightT++;
      void job().catch(() => { /* the title stays unread */ }).then(() => { this.inFlightT--; this.pump(); });
    }
  }

  private cacheKey(part: string, key: string): string | null { const dash = this.hooks.dashId(); return dash ? `lens:${part}:${dash}:${key}` : null; }
  private async cached<T>(part: string, key: string): Promise<T | null> {
    const ck = this.cacheKey(part, key); const store = this.hooks.store();
    if (!ck || !store) return null;
    try { const raw = await store.get(ck); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
  }
  private remember(part: string, key: string, value: unknown): void {
    const ck = this.cacheKey(part, key); const store = this.hooks.store();
    if (ck && store) { try { void store.set(ck, JSON.stringify(value)); } catch { /* best effort */ } }
  }

  private async read(key: string, title: string, kind: WorkKind | null, providers: readonly number[], want: Set<string>): Promise<void> {
    const f: TitleFacts = this.facts.get(key) ?? { key, at: {} };
    this.facts.set(key, f);
    f.kind = kind;
    const now = this.hooks.now();
    // 0. under a key, TMDB's word on which work this is - its kind and year - before any article is looked for: the plain
    //    name on Wikipedia is the older namesake (The Naked Gun 1988 for the 2025 film, 2026-09-22)
    if (this.tmdbKey && this.hooks.fetchKeyed && (f.year === undefined || f.backdrop === undefined)) {   // (a title matched before the backdrop was kept is asked once more)
      const c = await this.cached<{ kind: WorkKind; id: number; year: number | null; qid?: string | null; poster?: string | null; backdrop?: string | null; at: number }>("tmdbref4", key);   // (3: the ref carries the Wikidata item since 2026-09-22; 4: the backdrop, 2026-09-23)
      if (c && now - c.at <= TTL.wiki) { f.tmdb = { kind: c.kind, id: c.id }; f.year = c.year; if (c.qid) f.qid = c.qid; f.poster = c.poster ?? null; f.backdrop = c.backdrop ?? null; }
      else {
        const r = await this.tmdbRef(title, kind, providers);
        f.year = r?.year ?? null; f.poster = r?.poster ?? null; f.backdrop = r?.backdrop ?? null; if (r) { f.tmdb = { kind: r.kind, id: r.id }; if (r.qid) f.qid = r.qid; this.remember("tmdbref4", key, { ...r, at: now }); }
      }
    }
    if (want.size === 1 && want.has("poster")) return;   // the poster alone: the ref step above was all
    const tmdbOnly = [...want].every((w) => w === "tmdb" || w === "poster");   // the owned library's ratings: no open source, no guessing of page names (2026-09-22)
    // 1. the Wikipedia article and its Wikidata item (everything else hangs off these). Under a key TMDB named the item
    //    outright (tmdbRef), and the item names its English article (its sitelink, read with the item below): no guessing
    //    of page names at all - the guessing, five names a title, had been most of the load on Wikipedia (2026-09-22)
    if (f.qid && !f.article && (!f.at.wiki || now - f.at.wiki > TTL.wiki)) { f.at.wiki = now; }
    if ((want.has("wiki") || want.has("views") || want.has("wikidata") || want.has("tmdb")) && !f.qid && !tmdbOnly) {
      if (!f.at.wiki || now - f.at.wiki > TTL.wiki) {
        const c = await this.cached<{ article: string | null; qid: string | null; at: number }>("wiki3", key + (f.year ? ":" + f.year : ""));
        // a find is believed for a week; a MISS for an hour only - a stalled or rate-limited read had been remembered as "no article" for seven days (2026-09-22)
        if (c && now - c.at <= (c.article ? TTL.wiki : RETRY_MS)) { f.article = c.article; f.qid = c.qid; f.at.wiki = c.at; }
        else {
          let found: { article: string; qid: string | null } | null = null;
          try { found = await this.findArticle(title, kind ?? f.tmdb?.kind ?? null, f.year ?? null); }
          catch { f.at.wiki = now - TTL.wiki + RETRY_MS; return; }   // refused or timed out: nothing remembered, asked again in a while
          f.article = found?.article ?? null; f.qid = found?.qid ?? null; f.at.wiki = found ? now : now - TTL.wiki + RETRY_MS;   // a miss is asked again in a while
          this.remember("wiki3", key + (f.year ? ":" + f.year : ""), { article: f.article, qid: f.qid, at: now });
        }
      }
    }
    // 3. the Wikidata item: awards, release date, the ids other sources use
    if ((want.has("wikidata") || want.has("views") || want.has("wiki") || (want.has("tmdb") && !f.tmdb)) && f.qid && (!f.at.wikidata || now - f.at.wikidata > TTL.wikidata)) {   // a ratings-only ask reads no Wikidata once TMDB named the work (two thousand owned titles, 2026-09-22)
      const c = await this.cached<{ awards: number; released: string | null; imdb: string | null; tmdb: TitleFacts["tmdb"]; letterboxd: string | null; article?: string | null; at: number }>("wikidata", key + ":" + f.qid);   // the item's own facts
      if (c && now - c.at <= TTL.wikidata) { Object.assign(f, { awards: c.awards, released: c.released, imdb: c.imdb, tmdb: f.tmdb ?? c.tmdb ?? null, letterboxd: c.letterboxd }); if (c.article) f.article = c.article; f.at.wikidata = c.at; }
      else {
        const w = await this.wikidata(f.qid);
        if (w) { const { article, ...rest } = w; Object.assign(f, rest); if (article) f.article = article; if (!f.tmdb) f.tmdb = rest.tmdb ?? null; f.at.wikidata = now; this.remember("wikidata", key + ":" + f.qid, { ...w, at: now }); }
      }
    }
    // 2. seven days of reads
    if (want.has("views") && f.article && (!f.at.views || now - f.at.views > TTL.views)) {
      const c = await this.cached<{ views: number; through: string; at: number }>("views", key + ":" + f.article);   // the article's own reads (the article may change with the kind and year the work is known by)
      if (c && now - c.at <= TTL.views) { f.views7 = { views: c.views, through: c.through }; f.at.views = c.at; }
      else {
        const v = await this.pageviews(f.article);
        if (v) { f.views7 = v; f.at.views = now; this.remember("views", key + ":" + f.article, { ...v, at: now }); }
      }
    }
    // 4. TMDB, under the person's own key
    if (want.has("tmdb") && this.tmdbKey && this.hooks.fetchKeyed && (!f.at.tmdb || now - f.at.tmdb > TTL.tmdb)) {
      const c = await this.cached<{ rating: TitleFacts["rating"]; tmdb: TitleFacts["tmdb"]; imdb: string | null; latest?: TitleFacts["latest"]; genres?: string[]; first?: string | null; at: number }>("tmdb", key);
      // a cached answer WITH a rating is believed for a day; one without is asked again (a call that failed - the shell had
      // refused the keyed fetch on 2026-09-21 - had been cached as "no rating" for a day)
      // an entry from before the latest-date field (2026-09-22) is read again
      if (c && c.rating && c.latest !== undefined && c.genres !== undefined && c.first !== undefined && now - c.at <= TTL.tmdb) { f.rating = c.rating; f.tmdb = f.tmdb ?? c.tmdb ?? null; f.imdb = f.imdb ?? c.imdb ?? null; f.latest = c.latest ?? null; f.genres = c.genres; f.first = c.first; f.at.tmdb = c.at; }
      else {
        const r = await this.tmdb(f, title);
        f.rating = r?.rating ?? null; if (r?.tmdb) f.tmdb = r.tmdb; if (r?.imdb) f.imdb = r.imdb; f.latest = r?.latest ?? null; f.genres = r?.genres ?? []; f.first = r?.first ?? null;
        if (r?.rating) { f.at.tmdb = now; this.remember("tmdb", key, { rating: f.rating, tmdb: f.tmdb ?? null, imdb: f.imdb ?? null, latest: f.latest, genres: f.genres, first: f.first, at: now }); }
        else f.at.tmdb = now - TTL.tmdb + RETRY_MS;   // nothing usable: ask again in a while, keep nothing
      }
    }
  }

  /**
   * The English Wikipedia article for a work: the disambiguations that fit its kind and year first (a series looks for
   * "(TV series)" before the plain name, which is usually the older film; a 2025 film for "(2025 film)"), then the plain
   * name and the rest; a match must read as a film or a show, and a plain-name page that names another year is passed over.
   */
  private async findArticle(title: string, kind: WorkKind | null, year: number | null): Promise<{ article: string; qid: string | null } | null> {
    const base = title.replace(/\s+/g, " ").trim();
    const tv = [`${base} (TV series)`, `${base} (American TV series)`, `${base} (miniseries)`];
    const film = [`${base} (film)`];
    const cands: string[] = [];
    if (year && kind === "movie") cands.push(`${base} (${year} film)`);
    if (year && kind === "tv") cands.push(`${base} (${year} TV series)`, `${base} (${year} American TV series)`);
    if (kind === "tv") cands.push(...tv, base, ...film);
    else if (kind === "movie") cands.push(...film, base, ...tv);
    else cands.push(base, ...film, ...tv);
    for (const cand of cands) {
      try {
        this.lastFetch = "summary:" + cand;
        const raw = await withTimeout(this.fetchStaticPaced(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cand.replace(/ /g, "_"))}`), "summary");
        const j = JSON.parse(raw) as { type?: string; description?: string; extract?: string; titles?: { canonical?: string }; wikibase_item?: string };
        if (j.type !== "standard") continue;
        const about = `${j.description ?? ""} ${(j.extract ?? "").slice(0, 300)}`;
        if (!KINDS_RE.test(about)) continue;
        const desc = j.description ?? "";
        if (kind === "tv" && !/series|show|sitcom|miniseries|anime|television|TV/i.test(desc)) continue;   // a show's page says so in its description (the 1353 book had been taken for Netflix's series)
        if (kind === "movie" && !/\bfilm\b|\bmovie\b/i.test(desc)) continue;
        const said = /\b(19|20)\d\d\b/.exec(j.description ?? "");
        if (year && said && Number(said[0]) !== year && cand === base) continue;   // the plain name is another year's work
        return { article: j.titles?.canonical ?? cand.replace(/ /g, "_"), qid: j.wikibase_item ?? null };
      } catch (e) { if (/\b429\b|Too Many|timeout/i.test(String(e))) throw e; /* else: not that one */ }
    }
    return null;
  }

  /**
   * TMDB's word on which work a title is, by its name and kind: the titles of that name in TMDB's order (its popularity), the
   * kind's first. When the card's service named no kind and several works share the name, the one JustWatch says THAT service
   * carries is the work (Better Things on Hulu is the 2016 series, not the 2008 film, 2026-09-22) - one providers read per
   * candidate, at most three.
   */
  private async tmdbRef(title: string, kind: WorkKind | null, providers: readonly number[] = []): Promise<{ kind: WorkKind; id: number; year: number | null; qid: string | null; poster: string | null; backdrop: string | null } | null> {
    // a store's edition is not the work's name: 'American Psycho (Uncut Version)', 'Are You Afraid of the Dark? [TV Series]', 'Hook - Anniversary Edition'.
    // The full name is asked first; on a miss the trailing bracketed group goes, then a trailing ' - ' / ': ' edition phrase (2026-09-22)
    const tries = [title];
    const noGroup = title.replace(/\s*[(\[][^()\[\]]*[)\]]\s*$/, "").trim();
    if (noGroup && noGroup !== title) tries.push(noGroup);
    const noEdition = noGroup.replace(/\s*[-:–]\s*(the )?(director'?s|unrated|uncut|extended|theatrical|remastered|special|collector'?s|anniversary|ultimate|final|complete|limited|deluxe|\d+(st|nd|rd|th)|\d{4}|4k|digital|bonus|season \d+|series \d+)[^-:]*$/i, "").trim();
    if (noEdition && noEdition !== noGroup) tries.push(noEdition);
    for (const v of storeTitleVariants(noEdition || noGroup || title)) if (!tries.includes(v)) tries.push(v);
    let named: Array<{ id: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string; backdrop_path?: string }> = [];
    const pool: typeof named = [];
    for (const q of tries) {
      const j = await this.tmdbGet("/search/multi", `query=${encodeURIComponent(q)}&include_adult=false`);
      const rs = ((j?.results as typeof named | undefined) ?? []).filter((r) => r.media_type === "movie" || r.media_type === "tv");
      const wantKey = titleKey(q);
      named = rs.filter((r) => titleKey(r.title ?? r.name ?? "") === wantKey);
      if (named.length) break;
      for (const r of rs.slice(0, 5)) if (!pool.some((x) => x.id === r.id && x.media_type === r.media_type)) pool.push(r);
    }
    if (!named.length && pool.length) {
      // the store's spelling against TMDB's, loosely ('Ghostbusters 2' / 'Ghostbusters II', 'Tango and Cash' / 'Tango & Cash')
      const loose = new Set(tries.map(looseKey));
      named = pool.filter((r) => loose.has(looseKey(r.title ?? r.name ?? "")));
    }
    if (!named.length && pool.length) {
      // TMDB's alternative titles for the first three ('Star Wars: A New Hope', 'Harry Potter and the Sorcerer's Stone'): an exact word, not the top result taken on faith
      const loose = new Set(tries.map(looseKey));
      for (const r of pool.slice(0, 3)) {
        const a = await this.tmdbGet(`/${r.media_type}/${r.id}/alternative_titles`);
        const alts = ((a?.titles ?? a?.results) as Array<{ title?: string; name?: string }> | undefined) ?? [];
        if (alts.some((x) => loose.has(looseKey(x.title ?? x.name ?? "")))) { named = [r]; break; }
      }
    }
    let hit = named.find((r) => !kind || r.media_type === kind) ?? named[0];
    if (!kind && named.length > 1 && providers.length) {
      for (const r of named.slice(0, 3)) {
        const p = await this.tmdbGet(`/${r.media_type}/${r.id}/watch/providers`);
        const us = (p?.results as Record<string, Record<string, Array<{ provider_id?: number }>>> | undefined)?.US;
        const ids = us ? ["flatrate", "free", "ads", "rent", "buy"].flatMap((k) => (us[k] ?? []).map((x) => x.provider_id)) : [];
        if (ids.some((id) => typeof id === "number" && providers.includes(id))) { hit = r; break; }
      }
    }
    if (!hit) return null;
    const date = hit.media_type === "movie" ? hit.release_date : hit.first_air_date;
    const ext = await this.tmdbGet(`/${hit.media_type}/${hit.id}/external_ids`);
    const qid = typeof ext?.wikidata_id === "string" && /^Q\d+$/.test(ext.wikidata_id) ? ext.wikidata_id : null;
    const poster = typeof hit.poster_path === "string" && hit.poster_path.startsWith("/") ? "https://image.tmdb.org/t/p/w342" + hit.poster_path : null;
    const backdrop = typeof hit.backdrop_path === "string" && hit.backdrop_path.startsWith("/") ? "https://image.tmdb.org/t/p/w780" + hit.backdrop_path : null;
    return { kind: hit.media_type === "tv" ? "tv" : "movie", id: hit.id, year: date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null, qid, poster, backdrop };
  }

  private async pageviews(article: string): Promise<{ views: number; through: string } | null> {
    const end = new Date(this.hooks.now() - DAY); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 6 * DAY);
    const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "") + "00";
    try {
      this.lastFetch = "views:" + article;
      const raw = await withTimeout(this.fetchStaticPaced(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article)}/daily/${stamp(start)}/${stamp(end)}`), "views");
      const j = JSON.parse(raw) as { items?: Array<{ views?: number }> };
      const views = (j.items ?? []).reduce((s, i) => s + (typeof i.views === "number" ? i.views : 0), 0);
      return { views, through: end.toISOString().slice(0, 10) };
    } catch { return null; }
  }

  private async wikidata(qid: string): Promise<{ awards: number; released: string | null; imdb: string | null; tmdb: TitleFacts["tmdb"]; letterboxd: string | null; article?: string | null } | null> {
    try {
      this.lastFetch = "wikidata:" + qid;
      const raw = await withTimeout(this.fetchStaticPaced(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`), "wikidata");
      const j = JSON.parse(raw) as { entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>; sitelinks?: Record<string, { title?: string }> }> };
      const claims = j.entities?.[qid]?.claims ?? {};
      const article = j.entities?.[qid]?.sitelinks?.enwiki?.title?.replace(/ /g, "_") ?? null;
      const str = (p: string): string | null => { const v = claims[p]?.[0]?.mainsnak?.datavalue?.value; return typeof v === "string" ? v : null; };
      const dates = (claims.P577 ?? []).map((c) => (c.mainsnak?.datavalue?.value as { time?: string } | undefined)?.time).filter((t): t is string => typeof t === "string").map((t) => t.replace(/^\+/, "").slice(0, 10)).sort();
      const movie = str("P4947"); const tv = str("P4983");
      return { awards: (claims.P166 ?? []).length, released: dates[0] ?? null, imdb: str("P345"), tmdb: movie ? { kind: "movie", id: Number(movie) } : tv ? { kind: "tv", id: Number(tv) } : null, letterboxd: str("P6127"), article };
    } catch { return null; }
  }

  /** TMDB under the person's own key: by the id Wikidata knows, else by the IMDb id, else by title. */
  /**
   * One TMDB read under the person's own key (a v3 key on the query, a v4 token as the bearer), through the shell's keyed
   * fetch; null when there is no key or TMDB did not answer. The catalog search (catalog-search.ts) reads through here too.
   */
  /** what the resolver is doing right now (a diagnostic: the queue had stalled with three reads that never answered, 2026-09-22) */
  diag(): { pending: number; inFlight: number; queued: number; inFlightT: number; queuedT: number; loading: string[]; last: string | null } { return { pending: this.pending, inFlight: this.inFlight, queued: this.queue.length, inFlightT: this.inFlightT, queuedT: this.queueT.length, loading: [...this.loading].slice(0, 6), last: this.lastFetch }; }
  private lastFetch: string | null = null;

  /**
   * The next episode of a series, as TMDB knows it (2026-09-22, "if a tv series, can we show below them a clickable link
   * with image for the next episode on that service?"): the episode after the one playing, else the next season's first;
   * its name, still and air date. Under the household's key only; answered from a day's cache, read once in the background
   * otherwise (null meanwhile - the wall asks again). The press itself is the service's own Next episode, never TMDB's.
   */
  private readonly nextEp = new Map<string, { at: number; value: NextEpisode | null }>();
  private readonly nextEpLoading = new Set<string>();
  nextEpisode(series: string, season: number, episode: number, providers: readonly number[] = []): { ready: boolean; next: NextEpisode | null } {
    if (!this.tmdbKey) return { ready: true, next: null };
    const key = `${titleKey(series)}:${season}:${episode}`;
    const c = this.nextEp.get(key);
    if (c && this.hooks.now() - c.at <= TTL.tmdb) return { ready: true, next: c.value };
    if (!this.nextEpLoading.has(key)) {
      this.nextEpLoading.add(key);
      void (async () => {
        try {
          const ref = factsFor(this.facts, series, "tv")?.tmdb ?? (await this.tmdbRef(series, "tv", providers));
          let value: NextEpisode | null = null;
          if (ref && ref.kind === "tv") {
            const read = async (s: number, e: number): Promise<NextEpisode | null> => {
              const d = await this.tmdbGet(`/tv/${ref.id}/season/${s}/episode/${e}`);
              if (!d || typeof d.name !== "string") return null;
              return { season: s, episode: e, name: d.name, still: typeof d.still_path === "string" && d.still_path.startsWith("/") ? "https://image.tmdb.org/t/p/w300" + d.still_path : null, airDate: typeof d.air_date === "string" ? d.air_date : null, overview: typeof d.overview === "string" ? d.overview.slice(0, 400) : null };
            };
            value = (await read(season, episode + 1)) ?? (await read(season + 1, 1));
          }
          this.nextEp.set(key, { at: this.hooks.now(), value });
        } catch { this.nextEp.set(key, { at: this.hooks.now() - TTL.tmdb + RETRY_MS, value: null }); }
        finally { this.nextEpLoading.delete(key); }
      })();
    }
    return { ready: false, next: null };
  }
  // Wikimedia's pace (2026-09-22): the resolver had fired some three hundred summary reads in a second (three slots, five names a
  // title) and Wikipedia answered 429 for all but the first few - which were then remembered as "no article". The open sources
  // are read a few times a second at most, one after another, and a 429 rests every read for a while.
  private staticChain: Promise<void> = Promise.resolve();
  private staticAt = 0;
  private backoffUntil = 0;
  private fetchStaticPaced(url: string): Promise<string> {
    const run = async (): Promise<string> => {
      const wait = Math.max(this.staticAt + (this.hooks.paceMs ?? STATIC_GAP_MS), this.backoffUntil) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.staticAt = Date.now();
      try { return await this.hooks.fetchStatic(url); }
      catch (e) { if (/\b429\b|Too Many/i.test(String(e))) this.backoffUntil = Date.now() + BACKOFF_MS; throw e; }
    };
    const p = this.staticChain.then(run, run);
    this.staticChain = p.then(() => undefined, () => undefined);
    return p;
  }
  // ---- a series' seasons and episodes as TMDB lists them (the Episodes menu's list for a service that cannot list its own, 2026-09-22)
  // ---- a new episode this week (2026-09-23): TMDB's last aired episode for a My List series, kept six hours, read one at a time
  // Kept on the device (2026-09-24, "So frequently i notice My List losing its new episode banners and banner sorting"): the dates had lived
  // in memory only, so every relaunch drew My List bare and the banners came back one series at a time, the cards moving as they did;
  // and a TMDB call that failed wrote null over a known date for six hours. Now a relaunch opens with the last dates, and a failed read
  // keeps the date and asks again in five minutes.
  private readonly airs = new Map<string, { at: number; last: string | null; working: boolean }>();
  private airChain: Promise<void> = Promise.resolve();
  private airsLoaded = false;
  private airsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private airsKey(): string | null { const dash = this.hooks.dashId(); return dash ? `lens:airs:${dash}` : null; }
  private loadAirs(): void {
    if (this.airsLoaded) return;
    const key = this.airsKey(); const store = this.hooks.store();
    if (!key || !store) return;
    this.airsLoaded = true;
    const take = (raw: string | null) => {
      try {
        const j = raw ? JSON.parse(raw) as Record<string, { at?: unknown; last?: unknown }> : {};
        for (const [k, v] of Object.entries(j)) if (!this.airs.has(k) && typeof v?.at === "number") this.airs.set(k, { at: v.at, last: typeof v.last === "string" ? v.last : null, working: false });
      } catch { /* a fresh start */ }
    };
    try { const r = store.get(key); if (r instanceof Promise) void r.then(take, () => {}); else take(r); } catch { /* none */ }
  }
  private saveAirsSoon(): void {
    if (this.airsSaveTimer) return;
    this.airsSaveTimer = setTimeout(() => {
      this.airsSaveTimer = null;
      const key = this.airsKey(); const store = this.hooks.store();
      if (!key || !store) return;
      const out: Record<string, { at: number; last: string | null }> = {};
      for (const [k, v] of this.airs) if (!v.working) out[k] = { at: v.at, last: v.last };
      try { void store.set(key, JSON.stringify(out)); } catch { /* best effort */ }
    }, 3000);
  }
  /** TMDB's last_episode_to_air.air_date for a series, or null (not known yet, not a series, no key) - asked in the background. */
  lastAired(title: string, kind: string | null, providers: readonly number[] = []): string | null {
    if (!this.tmdbKey) return null;
    this.loadAirs();
    const wk = workKind(kind);
    if (wk === "movie") return null;
    const k = factsKey(title, kind);
    const now = this.hooks.now();
    const have = this.airs.get(k);
    if (have && (have.working || now - have.at < AIRS_TTL_MS)) return have.last;
    const e = { at: now, last: have?.last ?? null, working: true };
    this.airs.set(k, e);
    this.airChain = this.airChain.then(async () => {
      let answered = false;
      try {
        const ref = factsFor(this.facts, title, kind)?.tmdb ?? (await this.tmdbRef(title, wk, providers));
        if (ref && ref.kind === "tv") {
          const d = await this.tmdbGet(`/tv/${ref.id}`);
          if (d) {
            const l = d.last_episode_to_air as Record<string, unknown> | undefined;
            e.last = typeof l?.air_date === "string" ? l.air_date : null;
            answered = true;
          }
        } else if (ref) { e.last = null; answered = true; }   // a film under a series' name
        else if (e.last === null) answered = true;   // no match (or no answer) and nothing known: asked again in six hours
      } catch { /* kept as it was */ } finally {
        e.working = false;
        // no answer: the known date stays, asked again in five minutes
        e.at = answered ? this.hooks.now() : this.hooks.now() - AIRS_TTL_MS + RETRY_MS;
        this.saveAirsSoon();
      }
    });
    return e.last;
  }

  async tvSeasons(series: string, providers: readonly number[] = []): Promise<Array<{ season: number; label: string; episodes: Array<{ episode: number; title: string; synopsis: string | null; still: string | null; airDate: string | null; runtime: number | null }> }> | null> {
    if (!this.tmdbKey) return null;
    const ref = factsFor(this.facts, series, "tv")?.tmdb ?? (await this.tmdbRef(series, "tv", providers));
    if (!ref || ref.kind !== "tv") return null;
    const show = await this.tmdbGet(`/tv/${ref.id}`);
    const list = Array.isArray(show?.seasons) ? (show!.seasons as Array<{ season_number?: number; name?: string }>) : [];
    const nums = list.map((x) => ({ n: typeof x.season_number === "number" ? x.season_number : -1, name: typeof x.name === "string" ? x.name : "" })).filter((x) => x.n >= 0);
    nums.sort((a, b) => (a.n === 0 ? 1 : b.n === 0 ? -1 : a.n - b.n));   // Specials last
    const out: Array<{ season: number; label: string; episodes: Array<{ episode: number; title: string; synopsis: string | null; still: string | null; airDate: string | null; runtime: number | null }> }> = [];
    for (const x of nums.slice(0, 60)) {
      const d = await this.tmdbGet(`/tv/${ref.id}/season/${x.n}`);
      const eps = Array.isArray(d?.episodes) ? (d!.episodes as Array<Record<string, unknown>>) : [];
      out.push({ season: x.n, label: x.n === 0 ? "Specials" : "Season " + x.n, episodes: eps.map((e) => ({
        episode: typeof e.episode_number === "number" ? e.episode_number : 0,
        title: typeof e.name === "string" ? e.name : "",
        synopsis: typeof e.overview === "string" && e.overview.trim() ? e.overview.trim().slice(0, 600) : null,
        still: typeof e.still_path === "string" && e.still_path.startsWith("/") ? "https://image.tmdb.org/t/p/w500" + e.still_path : null,
        airDate: typeof e.air_date === "string" ? e.air_date : null,
        runtime: typeof e.runtime === "number" ? e.runtime : null,
      })) });
    }
    return out;
  }

  // ---- the most-read catalog row's reads (most-read.ts, 2026-09-22): the open sources through the same pace, cached in the wall's store
  /** An open source's JSON, reduced by the caller and kept `ttlMs` in the store (a past day's list never changes); null when it did not answer. */
  async openJson<T>(part: string, key: string, url: string, ttlMs: number, reduce: (json: unknown) => T): Promise<T | null> {
    const c = await this.cached<{ at: number; value: T }>(part, key);
    if (c && this.hooks.now() - c.at <= ttlMs) return c.value;
    try {
      this.lastFetch = part + ":" + key;
      const value = reduce(JSON.parse(await withTimeout(this.fetchStaticPaced(url), part)));
      this.remember(part, key, { at: this.hooks.now(), value });
      return value;
    } catch { return c ? c.value : null; }
  }
  /** An article's Wikidata item and short description, from its page summary (a month in the store; neither moves). */
  async articleItem(article: string): Promise<{ qid: string | null; description: string | null } | null> {
    return this.openJson("mritem2", article, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}`, 30 * DAY,
      (j) => { const o = j as { wikibase_item?: unknown; description?: unknown } | null; const q = o?.wikibase_item; return { qid: typeof q === "string" && /^Q\d+$/.test(q) ? q : null, description: typeof o?.description === "string" ? o.description : null }; });
  }
  /** An article's reads over the last seven full days, as the lens counts them (a day in the store). */
  async articleReads(article: string): Promise<{ views: number; through: string } | null> {
    const c = await this.cached<{ at: number; views: number; through: string }>("mrreads", article);
    if (c && this.hooks.now() - c.at <= TTL.views) return { views: c.views, through: c.through };
    const r = await this.pageviews(article);
    if (r) this.remember("mrreads", article, { at: this.hooks.now(), ...r });
    return r ?? (c ? { views: c.views, through: c.through } : null);
  }

  // ---- the details card (2026-09-23): one appended TMDB request per work, kept six hours; asked and answered by polling (the host's calls are sync)
  private readonly details = new Map<string, { status: "working" | "ready" | "none"; at: number; details?: TitleDetails; why?: string }>();
  titleDetails(title: string, kind: string | null, providers: readonly number[] = []): { status: "working" | "ready" | "none"; details?: TitleDetails; why?: string } {
    const k = factsKey(title, kind);
    const now = this.hooks.now();
    const have = this.details.get(k);
    if (have && (have.status === "working" ? now - have.at < 30_000 : now - have.at < 6 * 3_600_000)) return have;
    const entry: { status: "working" | "ready" | "none"; at: number; details?: TitleDetails; why?: string } = { status: "working", at: now };
    this.details.set(k, entry);
    void (async () => {
      try {
        if (!(await this.key())) { entry.status = "none"; entry.why = "add your TMDB key under Watch's settings"; return; }
        const ref = factsFor(this.facts, title, kind)?.tmdb ?? (await this.tmdbRef(title, workKind(kind), providers));
        if (!ref) { entry.status = "none"; entry.why = "TMDB has no match for this title"; return; }
        const d = await this.tmdbGet(`/${ref.kind}/${ref.id}`, TITLE_DETAILS_APPEND);
        if (!d) { entry.status = "none"; entry.why = "TMDB did not answer"; return; }
        entry.details = shapeTitleDetails(ref.kind, d);
        entry.status = "ready";
      } catch (e) { entry.status = "none"; entry.why = String(e); } finally { entry.at = this.hooks.now(); }
    })();
    return entry;
  }

  /** A work's details by TMDB's own id (a person's credit, 2026-09-23): the same card, no title search. */
  titleDetailsById(kind: "movie" | "tv", id: number): { status: "working" | "ready" | "none"; details?: TitleDetails; why?: string } {
    const k = "id:" + kind + ":" + id;
    const now = this.hooks.now();
    const have = this.details.get(k);
    if (have && (have.status === "working" ? now - have.at < 30_000 : now - have.at < 6 * 3_600_000)) return have;
    const entry: { status: "working" | "ready" | "none"; at: number; details?: TitleDetails; why?: string } = { status: "working", at: now };
    this.details.set(k, entry);
    void (async () => {
      try {
        if (!(await this.key())) { entry.status = "none"; entry.why = "add your TMDB key under Watch's settings"; return; }
        const d = await this.tmdbGet(`/${kind}/${id}`, TITLE_DETAILS_APPEND);
        if (!d) { entry.status = "none"; entry.why = "TMDB did not answer"; return; }
        entry.details = shapeTitleDetails(kind, d);
        entry.status = "ready";
      } catch (e) { entry.status = "none"; entry.why = String(e); } finally { entry.at = this.hooks.now(); }
    })();
    return entry;
  }
  private readonly persons = new Map<number, { status: "working" | "ready" | "none"; at: number; person?: PersonPage; why?: string }>();
  /** A person's page: TMDB's person and their combined credits, kept six hours. */
  personPage(id: number): { status: "working" | "ready" | "none"; person?: PersonPage; why?: string } {
    const now = this.hooks.now();
    const have = this.persons.get(id);
    if (have && (have.status === "working" ? now - have.at < 30_000 : now - have.at < 6 * 3_600_000)) return have;
    const entry: { status: "working" | "ready" | "none"; at: number; person?: PersonPage; why?: string } = { status: "working", at: now };
    this.persons.set(id, entry);
    void (async () => {
      try {
        if (!(await this.key())) { entry.status = "none"; entry.why = "no TMDB key"; return; }
        const d = await this.tmdbGet(`/person/${id}`, "append_to_response=combined_credits");
        if (!d) { entry.status = "none"; entry.why = "TMDB did not answer"; return; }
        entry.person = shapePerson(d);
        entry.status = "ready";
      } catch (e) { entry.status = "none"; entry.why = String(e); } finally { entry.at = this.hooks.now(); }
    })();
    return entry;
  }

  async tmdbGet(path: string, query = ""): Promise<Record<string, unknown> | null> {
    const key = await this.key(); const fetchKeyed = this.hooks.fetchKeyed;
    if (!key || !fetchKeyed) return null;
    const v3 = /^[0-9a-f]{32}$/i.test(key);
    const url = `https://api.themoviedb.org/3${path}${query ? "?" + query + (v3 ? "&" : "") : v3 ? "?" : ""}${v3 ? "api_key=" + encodeURIComponent(key) : ""}`;
    this.lastFetch = path;
    try { return JSON.parse(await withTimeout(fetchKeyed(url, v3 ? {} : { Authorization: `Bearer ${key}` }), path)) as Record<string, unknown>; } catch { return null; }
  }
  private async tmdb(f: TitleFacts, title: string): Promise<{ rating: TitleFacts["rating"]; tmdb: TitleFacts["tmdb"]; imdb: string | null; latest?: TitleFacts["latest"]; genres?: string[]; first?: string | null } | null> {
    if (!this.tmdbKey || !this.hooks.fetchKeyed) return null;
    const get = (path: string, query = "") => this.tmdbGet(path, query);
    let ref = f.tmdb ?? null;
    if (!ref && f.imdb) {
      const j = await get(`/find/${encodeURIComponent(f.imdb)}`, "external_source=imdb_id");
      const m = (j?.movie_results as Array<{ id: number }> | undefined)?.[0]; const t = (j?.tv_results as Array<{ id: number }> | undefined)?.[0];
      ref = m ? { kind: "movie", id: m.id } : t ? { kind: "tv", id: t.id } : null;
    }
    if (!ref && f.year === undefined) {   // the title search ran already as tmdbRef when read() had a key (f.year set, null when it found nothing)
      const j = await get("/search/multi", `query=${encodeURIComponent(title)}&include_adult=false`);
      const hit = (j?.results as Array<{ id: number; media_type?: string; title?: string; name?: string }> | undefined)?.find((r) => (r.media_type === "movie" || r.media_type === "tv") && titleKey(r.title ?? r.name ?? "") === titleKey(title));
      ref = hit ? { kind: hit.media_type === "tv" ? "tv" : "movie", id: hit.id } : null;
    }
    if (!ref) return { rating: null, tmdb: null, imdb: f.imdb ?? null };
    const d = await get(`/${ref.kind}/${ref.id}`, "append_to_response=external_ids");
    if (!d) return { rating: null, tmdb: ref, imdb: f.imdb ?? null };
    const mean = Number(d.vote_average); const votes = Number(d.vote_count);
    const imdb = (d.external_ids as { imdb_id?: string } | undefined)?.imdb_id ?? (typeof d.imdb_id === "string" ? d.imdb_id : null);
    const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const latest: TitleFacts["latest"] = ref.kind === "tv" ? (day(d.last_air_date) ? { date: day(d.last_air_date)!, what: "episode" } : day(d.first_air_date) ? { date: day(d.first_air_date)!, what: "episode" } : null) : day(d.release_date) ? { date: day(d.release_date)!, what: "release" } : null;
    const genres = Array.isArray(d.genres) ? (d.genres as Array<{ name?: unknown }>).map((g) => g?.name).filter((n): n is string => typeof n === "string").slice(0, 4) : [];
    const first = day(ref.kind === "tv" ? d.first_air_date : d.release_date);
    return { rating: isFinite(mean) && isFinite(votes) && votes > 0 ? { mean, votes, at: this.hooks.now() } : null, tmdb: ref, imdb: imdb ?? f.imdb ?? null, latest, genres, first };
  }
}

/**
 * A store's name for a title spelled the way TMDB names the work, tried in turn when the name as given finds nothing (2026-09-24: seven
 * Movies Anywhere titles had no picture) - a studio's label in front ('DCU: ...', 'Illumination Presents: Dr. Seuss' The Grinch'), a
 * library's inverted article ('WOLFMAN, THE'), a sequel number before the subtitle ('Mad Max 3: Beyond Thunderdome'), the subtitle's
 * missing article ('Pirates of the Caribbean: Curse of the Black Pearl'), a bundle's extras ('... Plus 6 Disney Tales'), ': The Movie'.
 * Pure; each variant once, the most faithful first.
 */
export function storeTitleVariants(title: string): string[] {
  const out: string[] = [];
  const add = (t: string) => { const v = t.replace(/\s+/g, " ").trim(); if (v && v !== title && !out.includes(v)) out.push(v); };
  let t = title.trim();
  // 'WOLFMAN, THE' -> 'THE WOLFMAN'
  const inv = /^(.*),\s*(the|a|an)$/i.exec(t);
  if (inv) { t = inv[2] + " " + inv[1]; add(t); }
  // a bundle's extras
  const bundle = t.replace(/\s+(plus|with|\+)\s+\d+\s+.*$/i, "");
  if (bundle !== t) { t = bundle; add(t); }
  // studio labels in front, as many as there are
  const LABEL = /^(dcu|dc|dceu|illumination presents|illumination'?s|disney'?s|disney|pixar'?s|dreamworks'?|marvel'?s|marvel studios'?|dr\.? seuss'?|walt disney'?s)\s*:?\s+/i;
  let stripped = t;
  while (LABEL.test(stripped)) stripped = stripped.replace(LABEL, "");
  if (stripped !== t && stripped.length > 2) { t = stripped; add(t); }
  // ': The Movie'
  const movie = t.replace(/\s*:\s*the movie$/i, "");
  if (movie !== t) add(movie);
  // a sequel number before the subtitle: 'Mad Max 3: Beyond Thunderdome' -> 'Mad Max Beyond Thunderdome'
  const seq = /^(.+?)\s+\d+\s*:\s*(.+)$/.exec(t);
  if (seq) add(seq[1] + " " + seq[2]);
  // the subtitle's missing article
  const sub = /^(.+?):\s+(?!the\b|a\b|an\b)(.+)$/i.exec(t);
  if (sub) add(sub[1] + ": The " + sub[2]);
  return out;
}

/** The outbound links a rating's disclosure offers - navigation only, nothing fetched from them. */
export function outboundLinks(f: TitleFacts | undefined): Array<{ name: "IMDb" | "Letterboxd"; url: string }> {
  const out: Array<{ name: "IMDb" | "Letterboxd"; url: string }> = [];
  if (f?.imdb) out.push({ name: "IMDb", url: `https://www.imdb.com/title/${encodeURIComponent(f.imdb)}/` });
  if (f?.letterboxd) out.push({ name: "Letterboxd", url: `https://letterboxd.com/film/${encodeURIComponent(f.letterboxd)}/` });
  else if (f?.tmdb?.kind === "movie") out.push({ name: "Letterboxd", url: `https://letterboxd.com/tmdb/${f.tmdb.id}/` });
  return out;
}
