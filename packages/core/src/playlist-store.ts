/**
 * Playlists (docs/features/playlists.md, 2026-09-27): user-made, ordered, service-agnostic lists of episodes and movies, kept per profile set on
 * the device. This file is the pure part - the items and their identity, adding with dedup, the views over the manual order, moving, completion,
 * the service an item plays on, the playlist filter - and nothing here reads a page, the network or the clock (callers pass `now`).
 *
 * Decisions taken with the spec (2026-09-27): no drag - items are sent from a "Send to playlist" button or right-click entry (with "New
 * playlist..."), and the order is managed on the Playlists screen; playback uses the existing play path as it is (its page presses included);
 * a title counts as played to its end within the credits window (playlist-play.ts).
 */
import { dedupeKey, sortTitle } from "./menu-order.js";

export type PlaylistView = "manual" | "show" | "added" | "released";
export interface PlService { app: string; id?: string | null; url?: string | null }
export interface PlItem {
  key: string;
  kind: "episode" | "movie";
  title: string;
  show?: string | null;
  season?: number | null;
  episode?: number | null;
  airDate?: string | null;
  year?: number | null;
  poster?: string | null;
  /** TMDB's id for the movie or the show ("movie:603", "tv:1396"), when search or details knew it */
  tmdb?: string | null;
  /** every service search or details found it on, with that service's episode or movie address when known */
  services: PlService[];
  /** played on this service whatever the playlist's order says */
  pin?: string | null;
  addedAt: number;
  completedAt?: number | null;
  /** played to its end (its credits or the player's own end) - where Play goes on from; an episode counts as watched (completedAt) at ten
   *  minutes in, long before this (2026-09-27) */
  finishedAt?: number | null;
  /** left out by the person (2026-09-27, "I can right click to exclude a specific episode if I want, but it can also be re-included down the line
   *  by right-clicking it. Just dim it and move it to the bottom of the season with a little closed eye icon"): kept, dimmed, at the bottom of
   *  its season, never played */
  excluded?: boolean;
  /** the name the service knows the show by, when the playlist names it apart by year ("Star Trek" for "Star Trek (1973)") */
  playAs?: string | null;
  /** services whose numbering of this show disagrees with this item (air date or title check failed): skipped for it, never guessed */
  mismatch?: string[];
  /** how far in the item was last seen playing (seconds), and when: the spot, kept on TMDB with the playlist (playlist-tmdb.ts, 2026-10-03) */
  at?: number | null;
  atTime?: number | null;
  /** when the item was last left out or taken back in (the change's stamp for TMDB) */
  excludedAt?: number | null;
}
/** A show the playlist follows (2026-09-27, "If I add an entire series, and more episodes/seasons come out, is it possible for those to get
 *  auto-added to the playlist?"): its new episodes are added as its service lists them. `known` is every episode key already seen for it (null
 *  = take the list as it stands the first time, adding nothing) - a removed episode is never added back. */
export interface PlFollow { show: string; app: string; services: string[]; readAs?: string | null; tmdb?: string | null; poster?: string | null; known: string[] | null; checkedAt?: number }
export interface Playlist { id: string; name: string; items: PlItem[]; view: PlaylistView; serviceOrder: string[]; createdAt: number; updatedAt: number; follows?: PlFollow[];
  /** the playlist's item last seen playing on the screen, from the playlist or not (2026-09-27, "lets flag the last episode watched, and start there or after if completed") */
  lastKey?: string | null; lastAt?: number;
  /** a public list on TMDB (2026-10-03): anyone can see it there; private is the default */
  public?: boolean }
export interface PlaylistStore { lists: Playlist[]; open: string | null; recent: string[] }

export const EMPTY_STORE: PlaylistStore = { lists: [], open: null, recent: [] };
export const LARGE_ADD = 100;

export function storeOf(v: unknown): PlaylistStore {
  const o = v as Partial<PlaylistStore> | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.lists)) return { lists: [], open: null, recent: [] };
  const lists = o.lists.filter((l): l is Playlist => !!l && typeof l.id === "string" && typeof l.name === "string" && Array.isArray(l.items))
    .map((l): Playlist => ({ ...l, view: l.view === "show" || l.view === "added" || l.view === "released" ? l.view : "manual", serviceOrder: Array.isArray(l.serviceOrder) ? l.serviceOrder.filter((a) => typeof a === "string") : [], items: l.items.filter((i) => i && typeof i.key === "string") }))
    // a sort is the playlist's own order now (2026-09-27, "The sort options on playlists need to be permanent, so when they go play the playlist, it
    // is in that order"): a playlist kept under a view comes back in that order, for good, and Manual
    .map((l) => (l.view === "manual" ? l : sortPlaylist(l, l.view, l.updatedAt)));
  const open = typeof o.open === "string" && lists.some((l) => l.id === o.open) ? o.open : null;
  const recent = Array.isArray(o.recent) ? o.recent.filter((id) => lists.some((l) => l.id === id)) : [];
  return { lists, open, recent };
}

/** The show's identity: its name, folded (case, accents, a leading The / A / An, punctuation). Cards, My List and a service's own search carry
 *  no TMDB id while search and Details do, so a key on TMDB's id would make the same show from a card and from Details two items; TMDB's id
 *  is kept on the item as data. Two different shows or films of one name are one item here - rare in a person's own list. */
export function showKeyOf(show: string, _year?: number | null, _tmdb?: string | null): string {
  return "t:" + dedupeKey(show);
}
/** An item's catalog identity - the title or episode itself, never a service's copy: a movie by its title, an episode by its show and numbers. */
export function itemKeyOf(i: { kind: "episode" | "movie"; title: string; show?: string | null; season?: number | null; episode?: number | null; year?: number | null; tmdb?: string | null }): string {
  if (i.kind === "movie") return "m:" + dedupeKey(i.title);
  return "e:" + showKeyOf(i.show ?? i.title) + ":s" + (i.season ?? 0) + "e" + (i.episode ?? 0);
}

/** An episode list (the details window's, EpisodesSeason[]) as items: a series, a season, one episode, or an episode and the rest of its season.
 *  Specials (season 0) are left out of a series add; each season in air order (the service's numbering). */
export type EpisodeScope = "all" | "season" | "episode" | "rest";
export interface EpisodeRef { season: number; episode: number; title: string; id?: string | null; url?: string | null; airDate?: string | null; still?: string | null }
export function expandEpisodes(seasons: ReadonlyArray<{ season: number; episodes: ReadonlyArray<EpisodeRef> }>, scope: EpisodeScope, season?: number | null, episode?: number | null): EpisodeRef[] {
  const sorted = [...seasons].sort((a, b) => a.season - b.season).map((s) => ({ ...s, episodes: [...s.episodes].sort((a, b) => a.episode - b.episode) }));
  if (scope === "all") return sorted.filter((s) => s.season > 0).flatMap((s) => s.episodes);
  const s = sorted.find((x) => x.season === season);
  if (!s) return [];
  if (scope === "season") return s.episodes;
  if (scope === "episode") return s.episodes.filter((e) => e.episode === episode);
  return s.episodes.filter((e) => e.episode >= (episode ?? 0));
}

/** Items added to a playlist: at `at` (a position in the manual order) or the end, as one contiguous block. A title already in the playlist is
 *  skipped (and counted) - but the services it was found on are merged into the item there, so the same show on two services is one item. */
export function addItems(list: Playlist, incoming: ReadonlyArray<PlItem>, now: number, at?: number | null): { list: Playlist; added: number; skipped: number } {
  const items = list.items.map((i) => ({ ...i, services: [...i.services] }));
  const byKey = new Map(items.map((i) => [i.key, i]));
  const fresh: PlItem[] = [];
  let skipped = 0;
  for (const n of incoming) {
    const have = byKey.get(n.key);
    if (have) {
      skipped++;
      for (const s of n.services) {
        const was = have.services.find((x) => x.app === s.app);
        if (!was) have.services.push({ ...s });
        else { if (!was.url && s.url) was.url = s.url; if (!was.id && s.id) was.id = s.id; }
      }
      if (!have.airDate && n.airDate) have.airDate = n.airDate;
      if (!have.poster && n.poster) have.poster = n.poster;
      continue;
    }
    const item = { ...n, services: n.services.map((s) => ({ ...s })), addedAt: now };
    byKey.set(item.key, item);
    fresh.push(item);
  }
  if (typeof at === "number" && at >= 0 && at <= items.length) { items.splice(at, 0, ...fresh); return { list: { ...list, items, updatedAt: fresh.length || skipped ? now : list.updatedAt }, added: fresh.length, skipped }; }
  // at the end - except an episode of a show already here, which goes among that show's own episodes in air order (2026-09-27, "Lets make sure
  // for the season/series selections that we're grouping / sorting episodes together"): a second season sent later sits after the first
  const tail: PlItem[] = [];
  const order = (i: PlItem) => (i.season ?? 0) * 100_000 + (i.episode ?? 0);
  for (const n of fresh) {
    const sk = n.kind === "episode" ? showKeyOf(n.show ?? n.title) : null;
    const mine = sk ? items.map((i, k) => ({ i, k })).filter((x) => x.i.kind === "episode" && showKeyOf(x.i.show ?? x.i.title) === sk) : [];
    if (!mine.length) { tail.push(n); continue; }
    const before = mine.filter((x) => order(x.i) < order(n));
    const pos = before.length ? before[before.length - 1]!.k + 1 : mine[0]!.k;
    items.splice(pos, 0, n);
  }
  items.push(...tail);
  return { list: { ...list, items, updatedAt: fresh.length || skipped ? now : list.updatedAt }, added: fresh.length, skipped };
}

/** The playlist as its view shows it: completed items faded and at the end (of the list, or of their group), their relative order kept. */
export interface ViewGroup { name: string | null; season?: number | null; items: PlItem[] }
export function viewOf(list: Playlist, view: PlaylistView = list.view): ViewGroup[] {
  const sink = (xs: PlItem[]) => [...xs.filter((i) => !i.completedAt && !i.excluded), ...xs.filter((i) => !!i.completedAt && !i.excluded), ...xs.filter((i) => !!i.excluded)];
  if (view === "manual") return [{ name: null, items: sink(list.items) }];
  if (view === "released") {
    // by release date (2026-09-27, "Can release date be an ordering option in the playlist as well?"): an episode's air date, a movie's release
    // date, oldest first; an episode with no date takes its show's nearest earlier dated episode (else the next one), so it stays in place
    // among its own; what has no date at all follows, in the manual order
    const dated = list.items.map((i, n) => ({ i, n, d: i.airDate ?? null }));
    const epOrder = (i: PlItem) => (i.season ?? 0) * 100_000 + (i.episode ?? 0);
    for (const x of dated) {
      if (x.d || x.i.kind !== "episode") continue;
      const sk = showKeyOf(x.i.show ?? x.i.title);
      const mine = dated.filter((y) => y.d && y.i.kind === "episode" && showKeyOf(y.i.show ?? y.i.title) === sk).sort((a, b) => epOrder(a.i) - epOrder(b.i));
      const before = mine.filter((y) => epOrder(y.i) < epOrder(x.i));
      x.d = before.length ? before[before.length - 1]!.d : mine[0]?.d ?? null;
    }
    const key = (d: string | null) => (d ? (d.length === 4 ? d + "-01-01" : d) : "\uffff");
    return [{ name: null, items: sink(dated.sort((a, b) => (key(a.d) < key(b.d) ? -1 : key(a.d) > key(b.d) ? 1 : 0) || (a.i.kind === "episode" && b.i.kind === "episode" && showKeyOf(a.i.show ?? "") === showKeyOf(b.i.show ?? "") ? epOrder(a.i) - epOrder(b.i) : 0) || (a.n - b.n)).map((x) => x.i)) }];
  }
  if (view === "added") return [{ name: null, items: sink(list.items.map((i, n) => ({ i, n })).sort((a, b) => (a.i.addedAt - b.i.addedAt) || (a.n - b.n)).map((x) => x.i)) }];
  // by show: the shows A to Z, each season under its own head in air order; the movies in their own group, last, A to Z
  const shows = new Map<string, { name: string; seasons: Map<number, PlItem[]> }>();
  const movies: PlItem[] = [];
  for (const i of list.items) {
    if (i.kind === "movie") { movies.push(i); continue; }
    const k = showKeyOf(i.show ?? i.title);
    if (!shows.has(k)) shows.set(k, { name: i.show ?? i.title, seasons: new Map() });
    const ss = shows.get(k)!.seasons;
    const sn = i.season ?? 0;
    if (!ss.has(sn)) ss.set(sn, []);
    ss.get(sn)!.push(i);
  }
  const byName = (a: string, b: string) => (sortTitle(a) < sortTitle(b) ? -1 : sortTitle(a) > sortTitle(b) ? 1 : 0);
  const out: ViewGroup[] = [];
  for (const sh of [...shows.values()].sort((a, b) => byName(a.name, b.name)))
    for (const sn of [...sh.seasons.keys()].sort((a, b) => a - b))
      out.push({ name: sh.name, season: sn, items: sink([...sh.seasons.get(sn)!].sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))) });
  if (movies.length) out.push({ name: "Movies", season: null, items: sink([...movies].sort((a, b) => byName(a.title, b.title))) });
  return out;
}
/** The playlist sorted, for good: by show (A to Z, each season in air order, movies last), by release date (oldest first) or by date added. The
 *  playlist's order becomes that order and Play follows it; completed and excluded items keep their place in it (they are shown and skipped as
 *  ever). An undo is the caller's (the order before). */
export function sortPlaylist(list: Playlist, by: "show" | "released" | "added", now: number): Playlist {
  const all = viewOf({ ...list, items: list.items.map((i) => ({ ...i, completedAt: null, excluded: false })) }, by).flatMap((g) => g.items);
  const byKey = new Map(list.items.map((i) => [i.key, i]));
  return { ...list, view: "manual", items: all.map((i) => byKey.get(i.key)!), updatedAt: now };
}
/** The play order: the current view, flattened; the first not-completed item is where Play starts. */
export function playOrder(list: Playlist): PlItem[] { return viewOf(list).flatMap((g) => g.items); }
export function firstOpen(list: Playlist): PlItem | null { return playOrder(list).find((i) => !i.completedAt && !i.excluded) ?? null; }
/** Where Play starts: the last episode watched when it is not finished, else the next not-completed one after it, else the first not-completed. */
export function resumePoint(list: Playlist): PlItem | null {
  const last = list.lastKey ? list.items.find((i) => i.key === list.lastKey) : undefined;
  // the last one watched until it has played to its end - an episode counted as watched at ten minutes in is still where Play carries on
  if (last && !last.excluded && !last.finishedAt && !(last.completedAt && last.kind === "movie")) return last;
  if (last) return nextOpen(list, last.key) ?? firstOpen(list);
  return firstOpen(list);
}
/** The next not-completed item after `key` in the play order (null at the end). */
export function nextOpen(list: Playlist, key: string): PlItem | null {
  // in the playlist's own order (a finished item is shown at the end, but the one after it is still the one after it)
  const order = list.view === "manual" ? list.items : playOrder(list);
  const at = order.findIndex((i) => i.key === key);
  return order.slice(at + 1).find((i) => !i.completedAt && !i.excluded && i.key !== key) ?? null;
}

/** Moving items in the manual order (the only view that reorders): the selected items, in their own relative order, as one block before the
 *  item now at `to` (a position in the manual order as it is; items.length = the end). */
export function moveItems(list: Playlist, keys: ReadonlyArray<string>, to: number, now: number): Playlist {
  const sel = new Set(keys);
  const moving = list.items.filter((i) => sel.has(i.key));
  if (!moving.length) return list;
  const before = list.items.slice(0, Math.max(0, Math.min(to, list.items.length))).filter((i) => sel.has(i.key)).length;
  const rest = list.items.filter((i) => !sel.has(i.key));
  const pos = Math.max(0, Math.min(rest.length, to - before));
  rest.splice(pos, 0, ...moving);
  return { ...list, items: rest, updatedAt: now };
}
/** The remote's moves: up / down one place, to the top, or to a position (1-based, as the screen numbers them). */
export function moveBy(list: Playlist, keys: ReadonlyArray<string>, how: "up" | "down" | "top" | number, now: number): Playlist {
  const idx = list.items.map((i, n) => (keys.includes(i.key) ? n : -1)).filter((n) => n >= 0);
  if (!idx.length) return list;
  const first = idx[0]!, last = idx[idx.length - 1]!;
  if (how === "top") return moveItems(list, keys, 0, now);
  if (how === "up") return first === 0 ? list : moveItems(list, keys, first - 1, now);
  if (how === "down") return last >= list.items.length - 1 ? list : moveItems(list, keys, last + 2, now);
  const target = Math.max(1, Math.min(list.items.length, Math.round(how))) - 1;   // the block's first item lands at this position
  const moving = list.items.filter((i) => keys.includes(i.key));
  const rest = list.items.filter((i) => !keys.includes(i.key));
  const at = Math.min(target, rest.length);
  return { ...list, items: [...rest.slice(0, at), ...moving, ...rest.slice(at)], updatedAt: now };
}

/** Marked completed (or not). Un-marked items go to the end of the not-completed part of the manual order. */
export function markItems(list: Playlist, keys: ReadonlyArray<string>, done: boolean, now: number, keepPlace = false): Playlist {
  const sel = new Set(keys);
  let items = list.items.map((i) => (sel.has(i.key) ? { ...i, completedAt: done ? (i.completedAt ?? now) : null, ...(done ? {} : { finishedAt: null }) } : i));
  if (!done && !keepPlace) {   // a bulk "not watched" keeps every item where it is
    const back = items.filter((i) => sel.has(i.key) && list.items.find((o) => o.key === i.key)?.completedAt);
    if (back.length) {
      const rest = items.filter((i) => !back.includes(i));
      let lastOpen = -1;
      rest.forEach((i, n) => { if (!i.completedAt) lastOpen = n; });
      rest.splice(lastOpen + 1, 0, ...back);
      items = rest;
    }
  }
  return { ...list, items, updatedAt: now };
}
export function excludeItems(list: Playlist, keys: ReadonlyArray<string>, on: boolean, now: number): Playlist {
  const sel = new Set(keys);
  return { ...list, items: list.items.map((i) => (sel.has(i.key) ? { ...i, excluded: on, excludedAt: now } : i)), updatedAt: now };
}
export function removeItems(list: Playlist, keys: ReadonlyArray<string>, now: number): Playlist {
  const sel = new Set(keys);
  return { ...list, items: list.items.filter((i) => !sel.has(i.key)), updatedAt: now };
}
/** Every item of one show (the item's show), for "remove all of this show" / "mark all of this show completed". */
export function showKeysOf(list: Playlist, key: string): string[] {
  const it = list.items.find((i) => i.key === key);
  if (!it || it.kind !== "episode") return it ? [it.key] : [];
  const k = showKeyOf(it.show ?? it.title, it.year, it.tmdb);
  return list.items.filter((i) => i.kind === "episode" && showKeyOf(i.show ?? i.title, i.year, i.tmdb) === k).map((i) => i.key);
}

/** The service an item plays on now: its pin when that service is signed in and has it; else the first service in the playlist's order that is
 *  signed in on this device and has it (the device's signed-in services, in their order, follow the playlist's own list). Null: not available here. */
export function resolveService(item: PlItem, order: ReadonlyArray<string>, signedIn: ReadonlyArray<string>): string | null {
  const has = (app: string) => signedIn.includes(app) && item.services.some((s) => s.app === app) && !(item.mismatch ?? []).includes(app);
  if (item.pin && has(item.pin)) return item.pin;
  for (const app of [...order, ...signedIn]) if (has(app)) return app;
  return null;
}

/** The playlist list filtered by name AND by the titles and shows inside; sorted by name or last updated. */
export function findPlaylists(lists: ReadonlyArray<Playlist>, q: string, sort: "name" | "updated"): Playlist[] {
  const w = sortTitle(q ?? "");
  const hit = (l: Playlist) => !w || sortTitle(l.name).includes(w) || l.items.some((i) => sortTitle(i.title).includes(w) || (!!i.show && sortTitle(i.show).includes(w)));
  const out = lists.filter(hit);
  return sort === "name" ? out.sort((a, b) => (sortTitle(a.name) < sortTitle(b.name) ? -1 : sortTitle(a.name) > sortTitle(b.name) ? 1 : 0)) : out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The Send to playlist picker: the open playlist first, then the recent ones. */
export function pickerOf(store: PlaylistStore, max = 5): Array<{ id: string; name: string; count: number; open: boolean }> {
  const ids = [...(store.open ? [store.open] : []), ...store.recent.filter((id) => id !== store.open)].slice(0, max + 1);
  return ids.map((id) => store.lists.find((l) => l.id === id)).filter((l): l is Playlist => !!l).map((l) => ({ id: l.id, name: l.name, count: l.items.length, open: l.id === store.open }));
}
export function touchRecent(store: PlaylistStore, id: string): PlaylistStore { return { ...store, recent: [id, ...store.recent.filter((x) => x !== id)].slice(0, 8) }; }
