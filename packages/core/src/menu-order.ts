/**
 * The universal video menu's ordering (docs/video-menu-spec.md §4, the transparency rule; Phase 2, 2026-09-19).
 *
 * A PURE function of the four §4 inputs and nothing else: the rows each service reported (in the service's own order),
 * the household's local watch log, the first-seen record of every title, and the moment "now". No ranking or
 * recommendation logic beyond the §4 recency rule and the person's own lists; nothing Prism invents. The fixture
 * (menu-order.test.ts) holds it to that: same inputs, same order; an item with no real time carries no time.
 *
 * Recency, in priority:
 *   1. log      - the wall saw this title play (the local watch log): exact, shown ("3 days ago · Netflix").
 *   2. inferred - the title moved to a service's position 1 between two readings, or was first seen recently:
 *                 "recent", no date, never shown as one.
 *   3. rank     - the service's own position in its row, for the truly unknown.
 */
import type { VideoItem } from "./types.js";

export interface MenuLogEntry {
  /** The service's App id. */
  app: string;
  /** The title's id on that service, and/or its address (whichever the adapter gave). */
  id?: string;
  url?: string | null;
  title: string;
  series?: string;
  /** When the wall saw it play, ms since the epoch - always real. */
  at: number;
}

/** What a service reported for one row, in the service's own order. */
export interface MenuServiceRow {
  app: string;
  /** The household's name for the service, for the badge. */
  name: string;
  facet: string;
  items: VideoItem[];
}

/** The first-seen record: per App, per title id, when the wall first listed it and its rank then (§4.2). */
export type FirstSeen = Record<string, Record<string, { at: number; rank: number; movedUpAt?: number }>>;

export type Recency = { kind: "log"; at: number } | { kind: "inferred" } | { kind: "rank"; rank: number };

export interface MenuCard {
  app: string;
  service: string;
  facet: string;
  item: VideoItem;
  recency: Recency;
  /** The real time the wall saw it play, when the log has one - the only time a card ever shows. */
  lastWatched?: number;
  /** The same title on the household's other services (2026-09-23, "show a stack of cards for multiple"): one card, each service a choice. */
  also?: Array<{ app: string; service: string; facet: string; item: VideoItem }>;
}

/** One card per title in a row: a title on several services folds into its first card, the others as `also` (their order kept). Pure. */
export function foldSameTitle(cards: readonly MenuCard[]): MenuCard[] {
  const key = (c: MenuCard) => sortTitle(c.item.title);
  const first = new Map<string, MenuCard>();
  const out: MenuCard[] = [];
  for (const c of cards) {
    const k = key(c);
    const f = first.get(k);
    if (!f) { const copy = { ...c }; first.set(k, copy); out.push(copy); continue; }
    if (f.app === c.app || f.also?.some((a) => a.app === c.app)) continue;
    (f.also ??= []).push({ app: c.app, service: c.service, facet: c.facet, item: c.item });
    if (!f.item.badge && c.item.badge) f.item = { ...f.item, badge: c.item.badge, ...(c.item.badgeFrom ? { badgeFrom: c.item.badgeFrom } : {}) };
  }
  return out;
}

/** "Recent" by inference means within this window of first sight or of a move to the top (§4.2: recent vs not, no date). */
export const INFERRED_RECENT_MS = 7 * 24 * 3600_000;

const sameTitle = (e: { id?: string; url?: string | null; title: string }, x: VideoItem): boolean =>
  (e.id && x.id ? e.id === x.id : false) || (!!e.url && !!x.url && e.url === x.url) || (!e.id && !e.url && e.title === x.title);

/**
 * Merge one kind of row across services by §4. Deterministic: ties inside a recency class keep the services' own order
 * (the rows' order, then each row's order); a log time orders exact entries newest first; inferred entries keep row order.
 */
/** A title's sorting key: case folded, diacritics dropped, a leading article (the / a / an) set aside - "The Rookie" files under R. */
/**
 * One title, one key: case, accents, punctuation and a leading article dropped (2026-09-22, "Meg 2: The Trench (Fandango at Home) and
 * The Meg 2: The Trench (Movies Anywhere)" - one film, two services' spellings). Used wherever a title is matched to itself across services.
 */
export function dedupeKey(title: string): string { return sortTitle(title).replace(/[^a-z0-9]+/g, ""); }
export function sortTitle(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The My list row, A to Z ("Can you make it alphabetical, my list?", 2026-09-20): every service's list merged and sorted by
 * title alone - a person's list is a set they curate, not a history, so recency says nothing about it. Ties (the same
 * title on two services) keep the services' order. Pure, like orderMerged; no service is preferred.
 * A title whose card carries the SERVICE'S OWN banner ("New Season", "New Season Coming Soon", "Recently Added",
 * "Leaving Soon" - whatever the page shows, read by the adapter into item.badge) comes first, A to Z among those
 * ("if it says New Season ... can it be pushed to the front of My List", 2026-09-23). The banner is the service's
 * word, shown on the card; Prism ranks nothing itself.
 */
/**
 * TMDB's banner for a series with an episode out in the last week (2026-09-23, "If TMDB reports any new episodes released in the last 7 days,
 * lets add a banner to items in My List where that is true and sort them to the beginning of the list"): `aired` is TMDB's
 * last_episode_to_air.air_date (YYYY-MM-DD, the air date as TMDB records it). "New Sep 21" ("lets add a corner diagonal banner ... 'New Sep 18'
 * ... in a small red but readable banner"); the card is marked badgeFrom "tmdb" so the ribbon's tip names the source. Pure.
 */
/** An awards banner ("Emmy Winner", "Oscar Nominee") is not news about the title - it is neither shown nor moves a card (2026-09-23, "I dont think
 * awards like Emmy WInner need to move those my list items, I'd take that banner off. Dont care about awards"). Pure. */
export function isAwardBadge(badge: string): boolean { return /\b(emmy|oscar|academy award|golden globe|bafta|peabody|sag award|award|winner|nominee|nominated|nominations?)\b/i.test(badge); }

// ten days since 2026-09-24 ("Lets update the episode recency for My List to be 10 days instead of 7")
export const NEW_EPISODE_DAYS = 10;
export function newEpisodeBadge(aired: string | null | undefined, now: number, days = NEW_EPISODE_DAYS): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(aired ?? "");
  if (!m) return null;
  const air = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const ago = Math.round((today.getTime() - air.getTime()) / 86_400_000);
  if (ago < 0 || ago > days) return null;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return "New " + MON[air.getMonth()] + " " + air.getDate();   // the card's red corner ribbon; the ribbon's tip names TMDB (badgeFrom)
}

/**
 * The Continue watching row, grouped by service (2026-09-26, "Maybe trying to get continue watching to sort latest first is a bad idea for us.
 * Maybe continue watching should group items by service, and offer a quick jump to different services (only if theyre in the queue)"): the
 * merged recency order guessed across services from the local log and first-seen stamps, and a service that adds a title late (Hulu) left the
 * row reshuffling. Now each service's row is shown as the service gives it - its own order, its own idea of what is next - and the services
 * follow one another A to Z by name ("order the services and groupings the same, we should probably just pick alphabetical", 2026-09-26:
 * the same order everywhere, and one that needs no outside figure). The cards keep what orderMerged knows (lastWatched, recency), so a
 * real time still shows. Pure; no service is preferred.
 */
export function orderByService(rows: readonly MenuServiceRow[], log: readonly MenuLogEntry[], seen: FirstSeen, now: number, reverse = false): MenuCard[] {
  const merged = orderMerged(rows, log, seen, now);
  const out: MenuCard[] = [];
  const dir = reverse ? -1 : 1;   // reversed: the services Z to A, the titles in each Z to A
  const byName = rows.map((r, i) => ({ r, i, k: sortTitle(r.name) })).sort((a, b) => (a.k < b.k ? -dir : a.k > b.k ? dir : a.i - b.i)).map((x) => x.r);
  // the titles inside each service A to Z (2026-09-26, "So by service still doesnt appear to be alphanumeric within the grouping in continue
  // watching, please double check my list too"): the service's own order had been kept
  for (const row of byName) {
    const mine: MenuCard[] = [];
    for (const it of row.items) { const c = merged.find((m) => m.app === row.app && m.item === it); if (c) mine.push(c); }
    out.push(...orderContinueByTitle(mine, reverse));
  }
  return out;
}

/**
 * The rows' orders, each the person's choice and each with a reverse (2026-09-26, "now lets make an alternative ordering then, alphanumeric.
 * So make a quick switch for the continue watching sorting order", then "We also need this on My List. Except I want to keep our current OOTB
 * sort/group order as an option too (with the banner items pushed to the front), but we'll need to explain that algorithm in a tooltip", "I want
 * the default ootb behavior for continue watching to be alphanumeric, and for my list to be the banner push alogrithm ... alphanum for banner
 * items within the banner group and alphanum for the nonbanner group", "Also add a reverse order for all of these"). Titles sort by sortTitle
 * (case and accents folded, a leading the / a / an set aside); a title on two services keeps the grouped order. Reverse flips the names (Z to
 * A) and keeps what is not a name: New first keeps the bannered titles in front. By service is A to Z twice, the services and the titles in each. Pure.
 */
export type ContinueOrder = "service" | "title";
export const CONTINUE_ORDERS: ReadonlyArray<{ id: ContinueOrder; label: string; hint: string }> = [
  { id: "title", label: "A to Z", hint: "Every title A to Z by name, whatever the service. A leading The, A or An is skipped. Reversed, Z to A." },
  { id: "service", label: "By service", hint: "Each service's titles together, A to Z, with the services A to Z. Reversed, both go Z to A." },
];
export function continueOrderOf(v: unknown): ContinueOrder { return v === "service" ? "service" : "title"; }
export type ListOrder = "prism" | "service" | "title";
export const LIST_ORDERS: ReadonlyArray<{ id: ListOrder; label: string; hint: string }> = [
  { id: "prism", label: "New first", hint: "Titles with a banner come first. That's a new episode in the last " + NEW_EPISODE_DAYS + " days (from TMDB), or a banner the service put on the title itself, like New Season, Recently Added or Leaving Soon. Award banners don't count. The bannered titles go A to Z, then everything else A to Z. Reversed, each group goes Z to A and the bannered titles stay in front. A leading The, A or An is skipped." },
  { id: "title", label: "A to Z", hint: "Every title A to Z by name, whatever the service. Banners still show but don't move a title. Reversed, Z to A." },
  { id: "service", label: "By service", hint: "Each service's list together, A to Z, with the services A to Z. Banners still show but don't move a title. Reversed, both go Z to A." },
];
export function listOrderOf(v: unknown): ListOrder { return v === "service" ? "service" : v === "title" ? "title" : "prism"; }
export type RowOrders = { continue: ContinueOrder; list: ListOrder; continueReverse: boolean; listReverse: boolean };
export function reverseOf(v: unknown): boolean { return v === true || v === "1" || v === "true"; }
export function orderContinueByTitle<T extends { item: { title: string } }>(cards: readonly T[], reverse = false): T[] {
  const dir = reverse ? -1 : 1;
  return cards.map((c, i) => ({ c, i, k: sortTitle(c.item.title) })).sort((a, b) => (a.k < b.k ? -dir : a.k > b.k ? dir : a.i - b.i)).map((x) => x.c);
}

export function orderAlphabetical(rows: readonly MenuServiceRow[], log: readonly MenuLogEntry[], seen: FirstSeen, now: number, reverse = false): MenuCard[] {
  const cards = orderMerged(rows, log, seen, now);
  // New first: the bannered titles - TMDB's new episode in the last ten days, or the service's own banner - then the rest, each group A to Z
  // (2026-09-26, "alphanum for banner items within the banner group and alphanum for the nonbanner group"; until then TMDB's came first by
  // air date). Reversed, each group Z to A, the banners still in front.
  const dir = reverse ? -1 : 1;
  return cards.map((c, i) => ({ c, i, b: c.item.badge ? 0 : 1, k: sortTitle(c.item.title) })).sort((a, b) => (a.b - b.b) || (a.k < b.k ? -dir : a.k > b.k ? dir : a.i - b.i)).map((x) => x.c);
}
/** The day a TMDB banner ("New Sep 21") names, as the most recent such date on or before `now` (ms), or null. Pure. */
export function bannerDay(badge: string | null | undefined, now: number): number | null {
  const m = /^New ([A-Z][a-z]{2}) (\d{1,2})$/.exec(badge ?? "");
  if (!m) return null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1]!);
  if (mon < 0) return null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const d = new Date(today.getFullYear(), mon, Number(m[2]));
  if (d.getTime() > today.getTime()) d.setFullYear(d.getFullYear() - 1);   // 'New Dec 30' read on Jan 3
  return d.getTime();
}

export function orderMerged(rows: readonly MenuServiceRow[], log: readonly MenuLogEntry[], seen: FirstSeen, now: number): MenuCard[] {
  const cards: Array<MenuCard & { order: number; pos: number }> = [];
  let order = 0;
  for (const row of rows) {
    row.items.forEach((item, rank) => {
      const hit = log.filter((e) => e.app === row.app && sameTitle(e, item)).sort((a, b) => b.at - a.at)[0];
      let recency: Recency;
      let lastWatched: number | undefined;
      if (hit) { recency = { kind: "log", at: hit.at }; lastWatched = hit.at; }
      else {
        const rec = seen[row.app]?.[item.id];
        const recent = !!rec && ((rec.movedUpAt !== undefined && now - rec.movedUpAt < INFERRED_RECENT_MS) || now - rec.at < INFERRED_RECENT_MS);
        recency = recent ? { kind: "inferred" } : { kind: "rank", rank };
      }
      cards.push({ app: row.app, service: row.name, facet: row.facet, item, recency, ...(lastWatched !== undefined ? { lastWatched } : {}), order: order++, pos: rank });
    });
  }
  const cls = (r: Recency) => (r.kind === "log" ? 0 : r.kind === "inferred" ? 1 : 2);
  cards.sort((a, b) => {
    const ca = cls(a.recency), cb = cls(b.recency);
    if (ca !== cb) return ca - cb;
    if (a.recency.kind === "log" && b.recency.kind === "log" && a.recency.at !== b.recency.at) return b.recency.at - a.recency.at;
    if (a.recency.kind === "rank" && b.recency.kind === "rank" && a.recency.rank !== b.recency.rank) return a.recency.rank - b.recency.rank;
    // inferred ties interleave by each service's own position too (2026-09-23, "Still no apple tv items on the continue ... lines"): a service
    // read for the first time lists every title as newly seen, and in the services' order its 40 fell behind everything else's
    if (a.recency.kind === "inferred" && b.recency.kind === "inferred" && a.pos !== b.pos) return a.pos - b.pos;
    return a.order - b.order;
  });
  return cards.map(({ order: _o, pos: _p, ...c }) => c);
}

/**
 * The first-seen record, brought up to date with a fresh reading of a service's row (§4.2): a title never listed before
 * is recorded with now and its rank; a title that moved to position 1 from lower down is stamped movedUpAt. Nothing is
 * ever removed here (a title that leaves the row keeps its record; it is harmless and small). Pure: returns the new record.
 */
export function noteSeen(seen: FirstSeen, app: string, items: readonly VideoItem[], now: number): FirstSeen {
  const prev = seen[app] ?? {};
  const next: Record<string, { at: number; rank: number; movedUpAt?: number }> = { ...prev };
  items.forEach((item, rank) => {
    const had = prev[item.id];
    if (!had) next[item.id] = { at: now, rank };
    else if (rank === 0 && had.rank > 0) next[item.id] = { ...had, rank, movedUpAt: now };
    else if (had.rank !== rank) next[item.id] = { ...had, rank };
  });
  return { ...seen, [app]: next };
}

/** The log with one more play at its head, the same title's older entry dropped, kept to a length. */
export function noteLog(log: readonly MenuLogEntry[], entry: MenuLogEntry, max = 200): MenuLogEntry[] {
  const rest = log.filter((e) => !(e.app === entry.app && ((e.id && entry.id) ? e.id === entry.id : (e.url && entry.url) ? e.url === entry.url : e.title === entry.title)));
  return [entry, ...rest].slice(0, max);
}

/** "3 days ago" for a card - only ever from a real time. */
export function agoLabel(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 36) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  if (d < 14) return d + (d === 1 ? " day ago" : " days ago");
  const w = Math.round(d / 7);
  if (w < 9) return w + (w === 1 ? " week ago" : " weeks ago");
  const mo = Math.round(d / 30);
  return mo + (mo === 1 ? " month ago" : " months ago");
}
