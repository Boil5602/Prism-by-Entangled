/**
 * Playlists kept on the person's TMDB account (2026-10-03, "I want to move our playlist capability there instead of locally in PRISM. That
 * way it can propagate to other logged in devices ... give the user the option to create them as public or private lists, give them a
 * name ... I don't want to change how the playlists are interfaced with inside of Prism though"): each playlist is one of the account's
 * TMDB lists (v4, public or private), each show or film on it one entry, and the playlist's state for that entry - the episodes it covers,
 * the ones watched, the ones left out, the spot it is at - short structured text in the entry's comment ("store structured text in there,
 * include watch status, time remaining"). Order is release date across the whole playlist ("Let's just sort them by release date only for
 * now"), so no order is written.
 *
 * What was measured on TMDB (docs/features/tmdb-account.md): a comment is set through the update call after the add, once per item (a
 * later update is ignored, so a change is remove + add + comment), about one write in five is answered success and not kept (every write
 * is read back at a fresh address and done again), and 500 characters is the working ceiling. Reads are cached by address.
 *
 * Pure here: the comment's grammar, the entries a playlist makes, the items an entry makes back. The engine (createPlaylistSync) pulls,
 * diffs and pushes through the lens primitives, one call at a time at a person's pace.
 */
import { itemKeyOf, sortPlaylist, type PlItem, type Playlist, type PlFollow } from "./playlist-store.js";

export interface Range { season: number; from: number; to: number }
export interface EntryState {
  kind: "movie" | "tv";
  id: number;
  /** the episodes the entry covers: ranges per season, or "all" (every episode TMDB lists, the show followed for new ones) */
  episodes: Range[] | "all";
  /** played to the end, or marked watched; for a film, one range [0..0] means watched */
  watched: Range[] | { through: { season: number; episode: number } };
  excluded: Range[];
  /** the spot: the episode playing or last played, and how far in (seconds) when known */
  now: { season?: number; episode?: number; at?: number } | null;
  /** when this state was written (epoch seconds); 0 for an entry with no Prism comment (a list made on TMDB's site) */
  updated: number;
}

export const COMMENT_MAX = 500;
const COMMENT_SOFT = 480;
export const PRISM_MARK = "Prism:";

export function entryKey(kind: "movie" | "tv", id: number): string { return `${kind}:${id}`; }

// ---- ranges

/** Episode numbers (per season) as merged ranges, each season in order. */
export function rangesOf(eps: ReadonlyArray<{ season: number; episode: number }>): Range[] {
  const by = new Map<number, number[]>();
  for (const e of eps) { if (!by.has(e.season)) by.set(e.season, []); by.get(e.season)!.push(e.episode); }
  const out: Range[] = [];
  for (const season of [...by.keys()].sort((a, b) => a - b)) {
    const ns = [...new Set(by.get(season)!)].sort((a, b) => a - b);
    let from = ns[0]!, to = ns[0]!;
    for (const n of ns.slice(1)) { if (n === to + 1) to = n; else { out.push({ season, from, to }); from = n; to = n; } }
    out.push({ season, from, to });
  }
  return out;
}
export function inRanges(r: ReadonlyArray<Range>, season: number, episode: number): boolean { return r.some((x) => x.season === season && episode >= x.from && episode <= x.to); }
const fmtRange = (r: Range): string => (r.from === r.to ? `S${r.season}E${r.from}` : `S${r.season}E${r.from}-${r.to}`);
const fmtRanges = (rs: ReadonlyArray<Range>): string => rs.map(fmtRange).join(" ");
function parseRanges(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(/S(\d+)E(\d+)(?:-(\d+))?/g)) { const season = Number(m[1]), from = Number(m[2]), to = m[3] ? Number(m[3]) : from; if (to >= from) out.push({ season, from, to }); }
  return out;
}
const fmtClock = (s: number): string => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0"); };
function parseClock(t: string): number | null { const p = t.split(":").map(Number); if (p.some((n) => !isFinite(n))) return null; return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p.length === 2 ? p[0]! * 60 + p[1]! : null; }
const fmtStamp = (sec: number): string => { const d = new Date(sec * 1000); return d.toISOString().slice(0, 16).replace("T", " "); };
function parseStamp(t: string): number { const ms = Date.parse(t.replace(" ", "T") + ":00Z"); return isFinite(ms) ? Math.floor(ms / 1000) : 0; }

// ---- the comment

/** The comment for an entry's state: readable on TMDB's own site, within the ceiling (detail is dropped from the end first). */
export function encodeComment(e: EntryState): string {
  const build = (level: number): string => {
    const parts: string[] = [];
    if (e.kind === "tv") parts.push("episodes " + (e.episodes === "all" || level >= 3 ? "all" : fmtRanges(e.episodes)));
    const w = e.watched;
    if (e.kind === "movie") { if (Array.isArray(w) ? w.length > 0 : true) parts.push("watched"); }
    else if (!Array.isArray(w)) parts.push(`watched through S${w.through.season}E${w.through.episode}`);
    else if (w.length) {
      if (level >= 2) { const last = lastThrough(w); parts.push(last ? `watched through S${last.season}E${last.episode}` : "watched " + fmtRanges(w)); }
      else parts.push("watched " + fmtRanges(w));
    }
    if (e.excluded.length && level < 1) parts.push("excluded " + fmtRanges(e.excluded));
    if (e.now && (e.now.at !== undefined || e.now.episode !== undefined)) parts.push("now" + (e.now.season !== undefined && e.now.episode !== undefined ? ` S${e.now.season}E${e.now.episode}` : "") + (e.now.at !== undefined ? " " + fmtClock(e.now.at) : ""));
    parts.push(fmtStamp(e.updated));
    return PRISM_MARK + " " + parts.join("; ");
  };
  for (let level = 0; level <= 3; level++) { const t = build(level); if (t.length <= COMMENT_SOFT) return t; }
  return build(3).slice(0, COMMENT_MAX);
}
/** The last episode of a watched set read as "through": the end of its highest range. */
function lastThrough(w: ReadonlyArray<Range>): { season: number; episode: number } | null {
  const last = [...w].sort((a, b) => a.season - b.season || a.to - b.to).at(-1);
  return last ? { season: last.season, episode: last.to } : null;
}

/** The state in a comment; an entry without Prism's mark is the whole show (or the film), nothing watched, stamp 0. */
export function parseComment(kind: "movie" | "tv", id: number, text: string | null | undefined): EntryState {
  const blank: EntryState = { kind, id, episodes: "all", watched: [], excluded: [], now: null, updated: 0 };
  if (!text || !text.startsWith(PRISM_MARK)) return blank;
  const e: EntryState = { ...blank, episodes: kind === "tv" ? [] : "all" };
  for (const raw of text.slice(PRISM_MARK.length).split(";")) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("episodes ")) { const v = part.slice(9).trim(); e.episodes = v === "all" ? "all" : parseRanges(v); }
    else if (part === "watched") e.watched = kind === "movie" ? [{ season: 0, from: 0, to: 0 }] : [];
    else if (part.startsWith("watched through ")) { const r = parseRanges(part.slice(16))[0]; if (r) e.watched = { through: { season: r.season, episode: r.from } }; }
    else if (part.startsWith("watched ")) e.watched = parseRanges(part.slice(8));
    else if (part.startsWith("excluded ")) e.excluded = parseRanges(part.slice(9));
    else if (part.startsWith("now")) {
      const m = /^now(?:\s+S(\d+)E(\d+))?(?:\s+([\d:]+))?$/.exec(part);
      if (m) { const at = m[3] ? parseClock(m[3]) : null; e.now = { ...(m[1] ? { season: Number(m[1]), episode: Number(m[2]) } : {}), ...(at !== null ? { at } : {}) }; }
    }
    else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(part)) e.updated = parseStamp(part);
  }
  return e;
}

// ---- a playlist's entries

/** The TMDB id of a show or film from an item ("tv:253" / "movie:603") or a lookup; null when neither knows. */
function tmdbNumOf(tmdb: string | null | undefined, kind: "movie" | "tv", lookup: ((title: string, kind: string) => string | null) | undefined, title: string): number | null {
  const own = new RegExp(`^${kind}:(\\d+)$`).exec(tmdb ?? "")?.[1];
  if (own) return Number(own);
  const found = lookup?.(title, kind === "tv" ? "series" : "movie") ?? lookup?.(title, kind);
  const n = new RegExp(`^${kind}:(\\d+)$`).exec(found ?? "")?.[1];
  return n ? Number(n) : null;
}

/** A playlist as its entries: one per film and per show, with the state the playlist holds for it; titles no TMDB id is known for are
 *  named back (kept on the device, never guessed onto the list). */
export function entriesOf(list: Playlist, lookup?: (title: string, kind: string) => string | null): { entries: Map<string, EntryState>; unmatched: string[] } {
  const entries = new Map<string, EntryState>();
  const unmatched: string[] = [];
  const stampOf = (i: PlItem): number => Math.max(i.addedAt, i.completedAt ?? 0, i.finishedAt ?? 0, i.atTime ?? 0, i.excludedAt ?? 0);
  const shows = new Map<string, PlItem[]>();
  for (const i of list.items) {
    if (i.kind === "movie") {
      const id = tmdbNumOf(i.tmdb, "movie", lookup, i.title);
      if (id === null) { unmatched.push(i.title); continue; }
      const watched = !!(i.finishedAt || i.completedAt);
      entries.set(entryKey("movie", id), { kind: "movie", id, episodes: "all", watched: watched ? [{ season: 0, from: 0, to: 0 }] : [], excluded: [], now: list.lastKey === i.key && i.at !== undefined && i.at !== null ? { at: i.at } : null, updated: Math.floor(stampOf(i) / 1000) });
      continue;
    }
    const show = i.show ?? i.title;
    if (!shows.has(show)) shows.set(show, []);
    shows.get(show)!.push(i);
  }
  for (const [show, items] of shows) {
    const id = tmdbNumOf(items.find((i) => i.tmdb)?.tmdb, "tv", lookup, items[0]!.playAs ?? show);
    if (id === null) { unmatched.push(show); continue; }
    const eps = items.filter((i) => typeof i.season === "number" && typeof i.episode === "number") as Array<PlItem & { season: number; episode: number }>;
    const followed = (list.follows ?? []).some((f) => f.show === show);
    const last = eps.find((i) => i.key === list.lastKey);
    entries.set(entryKey("tv", id), {
      kind: "tv", id,
      episodes: followed ? "all" : rangesOf(eps),
      watched: rangesOf(eps.filter((i) => i.finishedAt || i.completedAt)),
      excluded: rangesOf(eps.filter((i) => i.excluded)),
      now: last ? { season: last.season, episode: last.episode, ...(last.at !== undefined && last.at !== null ? { at: last.at } : {}) } : null,
      updated: Math.floor(Math.max(0, ...eps.map(stampOf)) / 1000),
    });
  }
  return { entries, unmatched };
}

export interface TmdbSeason { season: number; episodes: Array<{ episode: number; title: string; still: string | null; airDate: string | null }> }
export interface TmdbListEntry { kind: "movie" | "tv"; id: number; title: string; year: number | null; poster: string | null; comment: string | null }

/** An entry's items, from TMDB's seasons for the show (or the film itself): what another device rebuilds the playlist from. Services are
 *  the ones that carry the title here; the play path finds the episode on the service by its number. */
export function itemsOfEntry(entry: TmdbListEntry, state: EntryState, seasons: ReadonlyArray<TmdbSeason> | null, apps: ReadonlyArray<string>, now: number): { items: PlItem[]; follow: PlFollow | null; lastKey: string | null } {
  const stamp = state.updated ? state.updated * 1000 : now;
  const services = apps.map((app) => ({ app }));
  if (entry.kind === "movie") {
    const base = { kind: "movie" as const, title: entry.title, year: entry.year, tmdb: "movie:" + entry.id };
    const watched = Array.isArray(state.watched) ? state.watched.length > 0 : true;
    const key = itemKeyOf(base);
    return { items: [{ ...base, key, poster: entry.poster, services, addedAt: stamp, completedAt: watched ? stamp : null, finishedAt: watched ? stamp : null, ...(state.now?.at !== undefined ? { at: state.now.at, atTime: stamp } : {}) }], follow: null, lastKey: state.now ? key : null };
  }
  const items: PlItem[] = [];
  let lastKey: string | null = null;
  const watched = (s: number, e: number): boolean => (Array.isArray(state.watched) ? inRanges(state.watched, s, e) : s < state.watched.through.season || (s === state.watched.through.season && e <= state.watched.through.episode));
  for (const sn of [...(seasons ?? [])].sort((a, b) => a.season - b.season)) {
    if (sn.season === 0 && state.episodes === "all") continue;   // specials are added on purpose only
    for (const ep of [...sn.episodes].sort((a, b) => a.episode - b.episode)) {
      if (state.episodes !== "all" && !inRanges(state.episodes, sn.season, ep.episode)) continue;
      const base = { kind: "episode" as const, title: ep.title, show: entry.title, season: sn.season, episode: ep.episode, year: entry.year, tmdb: "tv:" + entry.id };
      const key = itemKeyOf(base);
      const done = watched(sn.season, ep.episode);
      const isNow = state.now?.season === sn.season && state.now?.episode === ep.episode;
      if (isNow) lastKey = key;
      items.push({ ...base, key, airDate: ep.airDate, poster: ep.still ?? entry.poster, services: services.map((s) => ({ ...s })), addedAt: stamp, completedAt: done ? stamp : null, finishedAt: done ? stamp : null, ...(inRanges(state.excluded, sn.season, ep.episode) ? { excluded: true } : {}), ...(isNow && state.now?.at !== undefined ? { at: state.now.at, atTime: stamp } : {}) });
    }
  }
  const follow: PlFollow | null = state.episodes === "all" && apps.length ? { show: entry.title, app: apps[0]!, services: [...apps], tmdb: "tv:" + entry.id, poster: entry.poster, known: items.map((i) => i.key) } : null;
  return { items, follow, lastKey };
}

/** A playlist rebuilt from its entries: items in release order (the playlist's order on TMDB). */
export function playlistFromEntries(base: Playlist, built: ReadonlyArray<{ items: PlItem[]; follow: PlFollow | null; lastKey: string | null }>, now: number): Playlist {
  const items = built.flatMap((b) => b.items);
  const shows = new Set(items.map((i) => i.show).filter((x): x is string => !!x));
  const follows = [...(base.follows ?? []).filter((f) => shows.has(f.show)), ...built.map((b) => b.follow).filter((f): f is PlFollow => !!f)].filter((f, n, arr) => arr.findIndex((x) => x.show === f.show) === n);
  const lastKey = built.map((b) => b.lastKey).find((k) => !!k && items.some((i) => i.key === k)) ?? null;
  return sortPlaylist({ ...base, items, follows, lastKey, lastAt: lastKey ? now : base.lastAt ?? 0 }, "released", now);
}

// ---- the engine

/** The lens primitives the engine writes through (lenses.ts, under the user's v4 token). */
export interface TmdbListApi {
  listCreate(name: string, isPublic: boolean, description?: string): Promise<number | null>;
  listGet(id: number, page?: number, fresh?: boolean): Promise<Record<string, unknown> | null>;
  listUpdate(id: number, fields: { name?: string; description?: string; public?: boolean; sort_by?: string }): Promise<boolean>;
  listDelete(id: number): Promise<boolean>;
  listItems(id: number, method: "POST" | "PUT" | "DELETE", items: Array<{ media_type: "movie" | "tv"; media_id: number; comment?: string }>): Promise<Record<string, unknown> | null>;
  listsOfAccount(page?: number): Promise<Record<string, unknown> | null>;
}
export interface SyncDeps {
  api: TmdbListApi;
  /** TMDB's seasons for a show by id (the details window's cache) */
  seasonsOf(id: number): Promise<TmdbSeason[] | null>;
  /** the household's services that carry a title here (apps), from TMDB's providers */
  carriedBy(kind: "movie" | "tv", id: number): Promise<string[]>;
  tmdbIdOf?: (title: string, kind: string) => string | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  report(e: unknown): void;
  /** the pace between TMDB calls (ms) */
  paceMs?: number;
}
/** What the device remembers of TMDB's side, per playlist: the list's id and flags, each entry's comment as last seen or written. */
export interface RemoteList { id: number; name: string; public: boolean; entries: Record<string, string | null>; readAt: number }
export interface SyncState { remote: Record<string, RemoteList>; dirty: Record<string, true>; deleted: Record<string, number>; localCopied?: boolean; pulledAt: number }
export const EMPTY_SYNC: SyncState = { remote: {}, dirty: {}, deleted: {}, pulledAt: 0 };
export const PULL_FRESH_MS = 10 * 60_000;
export const DELETE_GRACE_MS = 40_000;
const VERIFY_WAIT_MS = 3_000;
const WRITE_TRIES = 3;

/** The description Prism writes on a list it makes (TMDB shows it; the comments are the record). */
export const LIST_DESCRIPTION = "Made with Prism by Entangled. Each title's comment is the playlist's place in it.";

function listEntries(answer: Record<string, unknown> | null): TmdbListEntry[] {
  const res = Array.isArray(answer?.results) ? (answer!.results as Array<Record<string, unknown>>) : [];
  const comments = (answer?.comments as Record<string, string | null> | undefined) ?? {};
  return res.map((r) => {
    const kind: "movie" | "tv" = r.media_type === "tv" ? "tv" : "movie";
    const id = Number(r.id);
    const title = String(kind === "tv" ? r.name ?? r.original_name ?? "" : r.title ?? r.original_title ?? "");
    const date = String(kind === "tv" ? r.first_air_date ?? "" : r.release_date ?? "");
    return { kind, id, title, year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null, poster: typeof r.poster_path === "string" ? r.poster_path : null, comment: comments[entryKey(kind, id)] ?? null };
  });
}

export function createPlaylistSync(d: SyncDeps, io: { load(): SyncState; save(s: SyncState): void }) {
  const pace = async () => { await d.sleep(d.paceMs ?? 350); };
  let chain: Promise<void> = Promise.resolve();
  let busy = 0;
  let note: string | null = null;
  const queue = <T>(fn: () => Promise<T>): Promise<T> => {
    busy++;
    const p = chain.then(fn, fn);
    chain = p.then(() => { busy--; }, (e) => { busy--; d.report(e); });
    return p;
  };

  /** Every entry of a TMDB list, all pages, at a fresh address when asked (after a write). */
  const readList = async (id: number, fresh: boolean): Promise<{ entries: TmdbListEntry[]; name: string; isPublic: boolean } | null> => {
    const first = await d.api.listGet(id, 1, fresh);
    if (!first) return null;
    const entries = listEntries(first);
    const pages = Math.min(Number(first.total_pages) || 1, 50);
    for (let p = 2; p <= pages; p++) { await pace(); const a = await d.api.listGet(id, p, fresh); if (a) entries.push(...listEntries(a)); }
    return { entries, name: String(first.name ?? ""), isPublic: first.public === true };
  };

  /** One entry written: taken off if there, added, its comment set, read back; done again until TMDB keeps it. */
  const writeEntry = async (listId: number, key: string, kind: "movie" | "tv", id: number, comment: string, existed: boolean): Promise<boolean> => {
    for (let t = 0; t < WRITE_TRIES; t++) {
      if (existed || t > 0) { await d.api.listItems(listId, "DELETE", [{ media_type: kind, media_id: id }]); await pace(); }
      await d.api.listItems(listId, "POST", [{ media_type: kind, media_id: id }]); await pace();
      await d.api.listItems(listId, "PUT", [{ media_type: kind, media_id: id, comment }]);
      await d.sleep(VERIFY_WAIT_MS);
      const back = await readList(listId, true);
      if (back?.entries.find((e) => entryKey(e.kind, e.id) === key)?.comment === comment) return true;
      await pace();
    }
    return false;
  };

  return {
    /** Whether the engine is writing, and a line for the screen. */
    status(): { busy: boolean; note: string | null } { return { busy: busy > 0, note }; },
    /** Whether a read of TMDB's lists is due. */
    stale(): boolean { return d.now() - io.load().pulledAt >= PULL_FRESH_MS; },

    /**
     * TMDB's lists onto the device: every list of the account read; a list new here is made, one gone there is dropped (unless made here
     * and not pushed yet), and each entry whose comment changed since last seen is rebuilt - unless the device changed it meanwhile and its
     * stamp is newer. Returns the lists as they stand now.
     */
    pull(lists: ReadonlyArray<Playlist>, force = false): Promise<{ lists: Playlist[]; changed: boolean } | null> {
      return queue(async () => {
        const s = io.load();
        if (!force && d.now() - s.pulledAt < PULL_FRESH_MS) return null;
        note = "Reading your TMDB lists";
        const acct = await d.api.listsOfAccount(1);
        if (!acct) { note = "TMDB didn't answer"; return null; }
        const remoteLists: Array<{ id: number; name: string; isPublic: boolean }> = [];
        const read = (a: Record<string, unknown> | null) => { for (const r of (Array.isArray(a?.results) ? (a!.results as Array<Record<string, unknown>>) : [])) if (typeof r.id === "number") remoteLists.push({ id: r.id, name: String(r.name ?? ""), isPublic: r.public === true || r.public === 1 }); };
        read(acct);
        const pages = Math.min(Number(acct.total_pages) || 1, 20);
        for (let p = 2; p <= pages; p++) { await pace(); read(await d.api.listsOfAccount(p)); }
        const byRemoteId = new Map<number, string>();   // TMDB id -> playlist id
        for (const [plId, r] of Object.entries(s.remote)) byRemoteId.set(r.id, plId);
        let changed = false;
        const out: Playlist[] = [];
        const now = d.now();
        const seen = new Set<string>();
        for (const rl of remoteLists) {
          await pace();
          const got = await readList(rl.id, true);   // at a fresh address: TMDB's cache by address would show a stale list
          if (!got) continue;
          const plId = byRemoteId.get(rl.id) ?? "tmdb:" + rl.id;
          seen.add(plId);
          const local = lists.find((l) => l.id === plId);
          const rem = s.remote[plId] ?? { id: rl.id, name: rl.name, public: rl.isPublic, entries: {}, readAt: 0 };
          const base: Playlist = local ?? { id: plId, name: rl.name, items: [], view: "manual", serviceOrder: [], createdAt: now, updatedAt: now, public: rl.isPublic };
          const dirty = !!s.dirty[plId];
          const localEntries = local ? entriesOf(local, d.tmdbIdOf).entries : new Map<string, EntryState>();
          // each remote entry: kept as the device has it when its comment is what the device last saw (or the device changed it since and is
          // newer); rebuilt from TMDB when TMDB's changed
          const built: Array<{ items: PlItem[]; follow: PlFollow | null; lastKey: string | null }> = [];
          const keep = new Set<string>();
          const nextEntries: Record<string, string | null> = {};
          for (const e of got.entries) {
            const k = entryKey(e.kind, e.id);
            nextEntries[k] = e.comment;
            const mine = localEntries.get(k);
            const remoteState = parseComment(e.kind, e.id, e.comment);
            if (mine && k in rem.entries && rem.entries[k] === e.comment) { keep.add(k); continue; }
            if (mine && dirty && mine.updated >= remoteState.updated) { keep.add(k); continue; }
            const seasons = e.kind === "tv" ? await d.seasonsOf(e.id) : null;
            const apps = await d.carriedBy(e.kind, e.id);
            built.push(itemsOfEntry(e, remoteState, seasons, apps, now));
          }
          // the device's items: kept when their entry is kept, or unmatched on TMDB, or added here and not pushed yet; the rest replaced or gone
          let dropped = 0;
          const localKept = (local?.items ?? []).filter((i) => {
            const k = entryKeyOfItem(i, i.kind === "movie" ? "movie" : "tv", d.tmdbIdOf);
            if (!k || keep.has(k)) return true;
            if (!(k in nextEntries) && dirty && !(k in rem.entries)) return true;
            dropped++;
            return false;
          });
          let next: Playlist = base;
          if (!local || built.length || dropped) {
            const merged = playlistFromEntries({ ...base, items: [] }, [{ items: localKept, follow: null, lastKey: base.lastKey ?? null }, ...built], now);
            next = { ...merged, name: dirty ? base.name : got.name || base.name, public: dirty ? base.public === true : got.isPublic, updatedAt: now };
            changed = true;
          } else if (!dirty && ((got.name && got.name !== base.name) || got.isPublic !== (base.public === true))) { next = { ...base, name: got.name || base.name, public: got.isPublic }; changed = true; }
          out.push(next);
          s.remote[plId] = { id: rl.id, name: got.name || rl.name, public: got.isPublic, entries: nextEntries, readAt: now };
        }
        // lists the device has that TMDB no longer has: never pushed (kept, the push makes them), changed here since (kept, made again), or
        // taken off elsewhere (gone here too)
        for (const l of lists) {
          if (seen.has(l.id)) continue;
          if (!s.remote[l.id]) { out.push(l); continue; }
          if (s.dirty[l.id]) { delete s.remote[l.id]; out.push(l); continue; }
          delete s.remote[l.id]; changed = true;
        }
        s.pulledAt = now;
        io.save(s);
        note = null;
        return { lists: out, changed };
      });
    },

    /** The device's playlists onto TMDB: lists made, renamed, their flags set, each changed entry written and read back, gone ones taken off. */
    push(lists: ReadonlyArray<Playlist>, only?: ReadonlyArray<string>): Promise<{ unmatched: Record<string, string[]>; deferred: boolean }> {
      return queue(async () => {
        const s = io.load();
        const unmatched: Record<string, string[]> = {};
        const now = d.now();
        let deferred = false;
        for (const l of lists) {
          if (only && !only.includes(l.id)) continue;
          if (!s.dirty[l.id] && s.remote[l.id]) continue;
          note = "Saving " + l.name + " to TMDB";
          let rem = s.remote[l.id];
          if (!rem) {
            const id = await d.api.listCreate(l.name, l.public === true, LIST_DESCRIPTION);
            await pace();
            if (!id) { note = "TMDB wouldn't make " + l.name; continue; }
            rem = { id, name: l.name, public: l.public === true, entries: {}, readAt: now };
            s.remote[l.id] = rem; io.save(s);
          } else if (rem.name !== l.name || rem.public !== (l.public === true)) {
            if (await d.api.listUpdate(rem.id, { name: l.name, public: l.public === true })) { rem.name = l.name; rem.public = l.public === true; io.save(s); }
            await pace();
          }
          const { entries, unmatched: um } = entriesOf(l, d.tmdbIdOf);
          if (um.length) unmatched[l.id] = um;
          for (const [k, e] of entries) {
            const comment = encodeComment(e);
            if (rem.entries[k] === comment) continue;
            const ok = await writeEntry(rem.id, k, e.kind, e.id, comment, k in rem.entries);
            if (ok) { rem.entries[k] = comment; io.save(s); }
            else note = "TMDB didn't keep a change to " + l.name;
            await pace();
          }
          for (const k of Object.keys(rem.entries)) {
            if (entries.has(k)) continue;
            const [kind, id] = k.split(":");
            await d.api.listItems(rem.id, "DELETE", [{ media_type: kind === "tv" ? "tv" : "movie", media_id: Number(id) }]);
            delete rem.entries[k]; io.save(s);
            await pace();
          }
          delete s.dirty[l.id];
          io.save(s);
        }
        // lists taken off here: off TMDB once the undo window has passed
        for (const [plId, at] of Object.entries(s.deleted)) {
          if (lists.some((l) => l.id === plId)) { delete s.deleted[plId]; continue; }
          if (now - at < DELETE_GRACE_MS) { deferred = true; continue; }
          const rem = s.remote[plId];
          if (rem) { note = "Taking " + rem.name + " off TMDB"; await d.api.listDelete(rem.id); await pace(); }
          delete s.remote[plId]; delete s.deleted[plId]; delete s.dirty[plId];
          io.save(s);
        }
        note = null;
        return { unmatched, deferred };
      });
    },
  };
}
export type PlaylistSync = ReturnType<typeof createPlaylistSync>;

/** An item's entry key when its TMDB id is known (or found), else null. */
export function entryKeyOfItem(i: PlItem, kind: "movie" | "tv", lookup?: (title: string, kind: string) => string | null): string | null {
  const id = tmdbNumOf(i.tmdb, kind, lookup, kind === "tv" ? (i.playAs ?? i.show ?? i.title) : i.title);
  return id === null ? null : entryKey(kind, id);
}
