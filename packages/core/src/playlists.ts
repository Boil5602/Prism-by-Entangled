/**
 * Playlists (docs/features/playlists.md, 2026-09-27): the runtime part - the store per profile set, sending titles to a playlist (episodes read
 * through the details window's own load path), Import My List, editing, service resolution at play time and continuous play. Built from its
 * dependencies so the fixtures drive it without the host; runtime.ts wires the real ones. Local only: nothing here reaches the network (§22) -
 * episode lists come from the service pages and the TMDB fill-in the details window already uses.
 */
import { EMPTY_STORE, LARGE_ADD, addItems, excludeItems, sortPlaylist, resumePoint, expandEpisodes, findPlaylists, firstOpen, itemKeyOf, markItems, moveBy, moveItems, nextOpen, pickerOf, removeItems, resolveService, showKeysOf, storeOf, touchRecent, viewOf, type EpisodeScope, type PlItem, type PlService, type Playlist, type PlaylistStore, type PlaylistView, type PlFollow } from "./playlist-store.js";
import { stepRun, matchesItem, inCredits, showsMatch, type RunState } from "./playlist-play.js";
import { DELETE_GRACE_MS, EMPTY_SYNC, createPlaylistSync, type PlaylistSync, type SyncState, type TmdbListApi, type TmdbSeason } from "./playlist-tmdb.js";
import { titleKey } from "./lenses.js";

export interface PlSvc { app: string; name: string; facet: string; adapter: string; profile?: string; home?: string; status: string }
export interface PlEpisodes { ready: boolean; seasons: Array<{ season: number; episodes: Array<{ season: number; episode: number; title: string; id: string | null; url: string | null; airDate?: string | null; still?: string | null }> }>; error?: string | null }
export interface PlDeps {
  read(key: string): string | null;
  write(key: string, value: string): void;
  presets(): { presets: Array<{ id: string }>; active: string | null };
  /** the device's video services, in the household's order */
  services(): PlSvc[];
  screen(): string | null;
  state(tileId: string): { playing?: boolean; video?: Record<string, unknown> | null; pending?: { failed?: unknown } | null } | null;
  playOn(facet: string, kind: string, id: string, url: string, name: string): Record<string, unknown>;
  playCatalog(s: PlSvc, title: string, kind: string): Record<string, unknown>;
  /** the details window's episode load path (orchestrator.episodesOf): cached, read on a hidden page when stale */
  episodesOf(s: PlSvc, series: string): PlEpisodes;
  episodeByNumber(app: string, series: string, season: number, episode: number): { id: string | null; url: string | null; title: string; airDate?: string | null } | null;
  myList(): Array<{ app: string; service: string; item: { id: string; title: string; kind?: string; url?: string | null; artwork?: string | null }; also?: Array<{ app: string; item: { id: string; url?: string | null } }> }>;
  onEndOf(tileId: string): string;
  /** pause what plays on the tile (the wall's own pause) */
  pause?(tileId: string): void;
  /** the title on the tile has stood at its end, not playing, for a while (orchestrator.titleAtEnd) */
  atEnd?(tileId: string): boolean;
  /** a movie's release date as the lens facts know it (the Library's Newest / Oldest), or null; asks TMDB for it when there is a key */
  releaseOf?(title: string, kind: string): string | null;
  /** a picture for a title that came without one (TMDB's backdrop or poster, else the household's own library art), or null */
  pictureOf?(title: string, kind: string): string | null;
  /** TMDB's air dates for a series' episodes (under the key), for episodes its service listed without them */
  airDatesOf?(show: string): Promise<Array<{ season: number; episode: number; airDate: string }> | null>;
  /** TMDB's seasons for one exact show by its id, and the id the facts give a title ("tv:253") */
  tvSeasonsById?(id: number): Promise<Array<{ season: number; episodes: Array<{ episode: number; title: string; still: string | null; airDate: string | null }> }> | null>;
  tmdbIdOf?(title: string, kind: string): string | null;
  /** TMDB's other names for a show by its id - a service's own name for it */
  altTitlesOf?(id: number): Promise<string[]>;
  now(): number;
  later(fn: () => void, ms: number): void;
  sleep(ms: number): Promise<void>;
  report(e: unknown): void;
  /** The person's TMDB account with lists (playlist-tmdb.ts, 2026-10-03): while one is linked the playlists are its lists and nothing else;
   *  `account` is its id or null. Absent or null, there are no playlists (the gate), and the device's own earlier ones stay where they are. */
  tmdb?: { account(): string | null; api: TmdbListApi; seasonsOf(id: number): Promise<TmdbSeason[] | null>; carriedBy(kind: "movie" | "tv", id: number): Promise<string[]> };
}

const KEY = "video:playlists";
/** The push waits this long after the last change (a run's marks come in bursts). */
const PUSH_DEBOUNCE_MS = 4_000;
/** An episode counts as watched for the playlist at this far in (seconds) - the playlist's own count, not the service's Continue Watching. */
export const EPISODE_WATCHED_S = 600;
type Target = { id?: string | null; newName?: string | null };
export type PlSource =
  | { type: "movie"; title: string; year?: number | null; tmdb?: string | null; poster?: string | null; services: PlService[] }
  | { type: "series"; show: string; year?: number | null; tmdb?: string | null; poster?: string | null; app?: string | null; services?: string[]; scope: EpisodeScope; season?: number | null; episode?: number | null;
      /** a card whose kind the service didn't say: no episode list on its service makes it a movie */
      orMovie?: boolean;
      /** the name the service knows it by, when the playlist names it apart ("Star Trek" for "Star Trek (1973)") */
      playAs?: string | null };
interface Job { id: string; status: "reading" | "confirm" | "done" | "error"; message: string; target: Target; items: PlItem[]; count: number; added: number; skipped: number; listId?: string; error?: string; follows: PlFollow[] }

export function createPlaylists(d: PlDeps) {
  // ---- the store: the active profile set's (the first while none is active); the shared key only while no set exists, moved to the first set
  // once one does (the way The Binge's hidden titles move)
  const acct = (): string | null => d.tmdb?.account() ?? null;
  /** The device's own store key (the active profile set's), apart from the TMDB-backed one. */
  const localKey = (): string => {
    const st = d.presets();
    if (!st.presets.length) return KEY;
    const first = KEY + ":" + st.presets[0]!.id;
    const base = storeOf(parse(d.read(KEY)));
    if (base.lists.length) {
      const into = storeOf(parse(d.read(first)));
      d.write(first, JSON.stringify({ ...into, lists: [...into.lists, ...base.lists.filter((l) => !into.lists.some((x) => x.id === l.id))] }));
      d.write(KEY, JSON.stringify(EMPTY_STORE));
    }
    return KEY + ":" + (st.active ?? st.presets[0]!.id);
  };
  const keyNow = (): string => { const a = acct(); return a ? KEY + ":tmdb:" + a : localKey(); };
  const parse = (raw: string | null): unknown => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const load = (): PlaylistStore => storeOf(parse(d.read(keyNow())));
  // ---- TMDB (playlist-tmdb.ts): the engine per account, the sync record beside the store, changed lists marked on save, the push a moment later
  let engine: { account: string; sync: PlaylistSync } | null = null;
  const syncKey = (a: string) => KEY + ":tmdb:" + a + ":sync";
  const syncState = (a: string): SyncState => { const v = parse(d.read(syncKey(a))) as Partial<SyncState> | null; return v && typeof v === "object" && v.remote ? { ...EMPTY_SYNC, ...v } as SyncState : JSON.parse(JSON.stringify(EMPTY_SYNC)); };
  const engineOf = (): { account: string; sync: PlaylistSync } | null => {
    const a = acct();
    if (!a || !d.tmdb) return null;
    if (engine?.account !== a) {
      engine = { account: a, sync: createPlaylistSync({ api: d.tmdb.api, seasonsOf: d.tmdb.seasonsOf, carriedBy: d.tmdb.carriedBy, ...(d.tmdbIdOf ? { tmdbIdOf: d.tmdbIdOf } : {}), now: d.now, sleep: d.sleep, report: d.report }, { load: () => syncState(a), save: (s) => d.write(syncKey(a), JSON.stringify(s)) }) };
      // work left from before a restart (a change not pushed, a playlist taken off within its undo window): pushed now
      const sy = syncState(a);
      if (Object.keys(sy.dirty).length || Object.keys(sy.deleted).length) schedulePush();
    }
    return engine;
  };
  let pushTimer = 0;
  let unmatched: Record<string, string[]> = {};
  const schedulePush = (): void => {
    const e = engineOf();
    if (!e) return;
    const my = ++pushTimer;
    d.later(() => { if (my !== pushTimer) return; void e.sync.push(load().lists).then((r) => { unmatched = r.unmatched; if (r.deferred) d.later(schedulePush, DELETE_GRACE_MS); }).catch(d.report); }, PUSH_DEBOUNCE_MS);
  };
  const save = (st: PlaylistStore): void => {
    const e = engineOf();
    if (!e) { d.write(keyNow(), JSON.stringify(st)); return; }
    // the TMDB-backed store: lists in release order ("sort them by release date only for now"), the changed ones marked, the gone ones timed
    const before = load();
    const next: PlaylistStore = { ...st, lists: st.lists.map((l) => (l.view === "manual" ? sortPlaylist(l, "released", l.updatedAt) : l)) };
    d.write(keyNow(), JSON.stringify(next));
    const s = syncState(e.account);
    let changed = false;
    for (const l of next.lists) { const was = before.lists.find((x) => x.id === l.id); if (!was || JSON.stringify(was) !== JSON.stringify(l)) { s.dirty[l.id] = true; changed = true; } }
    for (const l of before.lists) if (!next.lists.some((x) => x.id === l.id)) { s.deleted[l.id] = d.now(); changed = true; }
    if (changed) { d.write(syncKey(e.account), JSON.stringify(s)); schedulePush(); }
  };
  /** TMDB's lists read onto the device when stale (or asked): the store replaced by what came back, the open list kept. */
  let pulling = false;
  const pull = (force = false): void => {
    const e = engineOf();
    if (!e || pulling || (!force && !e.sync.stale())) return;
    pulling = true;
    void e.sync.pull(load().lists, force).then((r) => {
      if (!r || !r.changed) return;
      const st = load();
      const open = r.lists.some((l) => l.id === st.open) ? st.open : r.lists[0]?.id ?? null;
      d.write(keyNow(), JSON.stringify({ ...st, lists: r.lists, open, recent: st.recent.filter((id) => r.lists.some((l) => l.id === id)) }));
    }).catch(d.report).finally(() => { pulling = false; });
  };
  const putList = (st: PlaylistStore, l: Playlist): PlaylistStore => ({ ...st, lists: st.lists.map((x) => (x.id === l.id ? l : x)) });
  let seq = 0;
  const newId = (p: string) => p + d.now().toString(36) + (seq++).toString(36);
  const create = (st: PlaylistStore, name: string, isPublic = false): { st: PlaylistStore; list: Playlist } => {
    const now = d.now();
    const list: Playlist = { id: newId("pl"), name: name.trim().slice(0, 60) || "Playlist", items: [], view: "manual", serviceOrder: [], createdAt: now, updatedAt: now, ...(acct() ? { public: isPublic } : {}) };
    return { st: touchRecent({ ...st, lists: [...st.lists, list], open: list.id }, list.id), list };
  };

  const signedIn = (): PlSvc[] => d.services().filter((s) => s.status === "signed-in");
  const orderOf = (l: Playlist): string[] => (l.serviceOrder.length ? l.serviceOrder : d.services().map((s) => s.app));

  // ---- undo (the last completion, mark, delete, removal): 30 seconds
  let undo: { label: string; until: number; apply: () => void } | null = null;
  const setUndo = (label: string, before: PlaylistStore) => { undo = { label, until: d.now() + 30_000, apply: () => save(before) }; };

  // ---- sending titles: episodes through the details window's load path
  const jobs = new Map<string, Job>();
  const svcFor = (app: string | null | undefined, apps: ReadonlyArray<string> = []): PlSvc | null => {
    const ins = signedIn();
    return ins.find((s) => s.app === app) ?? ins.find((s) => apps.includes(s.app)) ?? null;
  };
  const readEpisodes = async (s: PlSvc, show: string, job: Job): Promise<PlEpisodes> => {
    let v = d.episodesOf(s, show);
    for (let t = 0; !v.ready && t < 240; t++) { job.message = "Reading " + show + "'s episodes on " + s.name; await d.sleep(1000); v = d.episodesOf(s, show); }
    return v;
  };
  const episodeItems = (src: Extract<PlSource, { type: "series" }>, s: PlSvc, v: PlEpisodes): PlItem[] => {
    const now = d.now();
    const others = (src.services ?? []).filter((a) => a !== s.app);
    return expandEpisodes(v.seasons, src.scope, src.season, src.episode).map((ep) => {
      const base = { kind: "episode" as const, title: ep.title, show: src.show, season: ep.season, episode: ep.episode, year: src.year ?? null, tmdb: src.tmdb ?? null };
      const playAs = src.playAs ? { playAs: src.playAs } : {};
      return { ...base, ...playAs, key: itemKeyOf(base), airDate: ep.airDate ?? null, poster: ep.still ?? src.poster ?? null, services: [{ app: s.app, id: ep.id ?? null, url: ep.url ?? null }, ...others.map((app) => ({ app }))], addedAt: now };
    });
  };
  const itemsOf = async (src0: PlSource, job: Job): Promise<PlItem[]> => {
    const first = src0;
    if (first.type === "movie") {
      const base = { kind: "movie" as const, title: first.title, year: first.year ?? null, tmdb: first.tmdb ?? null };
      return [{ ...base, key: itemKeyOf(base), poster: first.poster ?? null, services: first.services.map((x) => ({ ...x })), addedAt: d.now() }];
    }
    let src: Extract<PlSource, { type: "series" }> = first;
    // two shows of one name (2026-09-27, "I've added the animated series twice to my list but I can't seem to find it in there. It says it's
    // already in there": TMDB names both the 1966 series and the 1973 animated one "Star Trek"): a show whose TMDB id differs from a same-named
    // show already in the playlist is named with its year, "Star Trek (1973)", and so is its own item
    const tmdbNum = /^tv:(\d+)$/.exec(src.tmdb ?? "")?.[1];
    if (tmdbNum && job.target.id) {
      const l = load().lists.find((x) => x.id === job.target.id);
      const same = (l?.items ?? []).filter((i) => i.kind === "episode" && titleKey(i.show ?? "") === titleKey(src.show));
      const theirs = same.map((i) => i.tmdb ?? d.tmdbIdOf?.(src.show, "tv") ?? null).find((t) => !!t);
      // told apart by TMDB's id, or - items sent from a card carry none - by their years (the 1966 episodes against a 1973 show)
      const theirYear = Number(same.map((i) => i.airDate).filter((x): x is string => !!x).sort()[0]?.slice(0, 4)) || null;
      const otherYears = !!src.year && !!theirYear && Math.abs(theirYear - src.year) > 1;
      if (same.length && ((theirs && theirs !== src.tmdb) || (!theirs && otherYears))) src = { ...src, show: src.show + (src.year ? " (" + src.year + ")" : " (TMDB " + tmdbNum + ")"), playAs: src.show };
    }
    const s = svcFor(src.app, src.services ?? []);
    const asMovie = () => itemsOf({ type: "movie", title: src.show, year: src.year ?? null, tmdb: src.tmdb ?? null, poster: src.poster ?? null, services: (src.services ?? (src.app ? [src.app] : [])).map((app) => ({ app })) }, job);
    if (!s) { if (src.orMovie) return asMovie(); throw new Error("no signed-in service here has " + src.show); }
    let v = await readEpisodes(s, src.playAs ?? src.show, job);
    // the service's list is another show's (its years miles from this one's - Paramount+'s "Star Trek" is the 1966 series): TMDB's list for this
    // exact show instead, its episodes without the service's addresses (Play opens the show and says which episode)
    const yearOf = (x: PlEpisodes) => Number((x.seasons.flatMap((y) => y.episodes).map((e) => e.airDate).filter((a): a is string => !!a).sort()[0] ?? "").slice(0, 4)) || null;
    const firstYear = yearOf(v);
    let wrong = !!src.year && !!firstYear && Math.abs(firstYear - src.year) > 1;
    // the service's own name for this show (2026-09-27, "Paramount+ has the animated series too. WHy cant it create the links"): TMDB's other
    // names for it, each read on the service - the one whose years match is the service's list, with its addresses
    let serviceList = false;
    if ((wrong || src.playAs) && tmdbNum && d.altTitlesOf) {
      for (const alt of (await d.altTitlesOf(Number(tmdbNum)).catch(() => [] as string[])).filter((t) => titleKey(t) !== titleKey(src.playAs ?? src.show)).slice(0, 6)) {
        job.message = "Looking for " + src.show + " on " + s.name + " as " + alt;
        const v2 = await readEpisodes(s, alt, job);
        const y2 = yearOf(v2);
        // the service's own list: its episodes carry its addresses (a TMDB fill-in under that name has the years and no addresses)
        const hasAddresses = v2.seasons.some((x) => x.episodes.some((e) => !!e.url));
        if (v2.seasons.length && hasAddresses && (!src.year || (y2 && Math.abs(y2 - src.year) <= 1))) { v = v2; wrong = false; serviceList = true; src = { ...src, playAs: alt }; break; }
      }
    }
    if (!serviceList && (wrong || src.playAs) && tmdbNum && d.tvSeasonsById) {
      job.message = "Reading " + src.show + "'s episodes from TMDB";
      const tm = await d.tvSeasonsById(Number(tmdbNum));
      if (tm?.length) v = { ready: true, seasons: tm.map((x) => ({ season: x.season, episodes: x.episodes.map((e) => ({ season: x.season, episode: e.episode, title: e.title, id: null, url: null, airDate: e.airDate, still: e.still })) })) };
      else if (wrong) throw new Error(s.name + " lists a different " + src.show + ", and TMDB's list for this one couldn't be read");
    }
    if (!v.seasons.length) { if (src.orMovie) return asMovie(); throw new Error(v.error || s.name + " did not list " + src.show + "'s episodes"); }
    const items = episodeItems(src, s, v);
    // a whole series: the playlist follows it - what comes out later is added (2026-09-27); the episodes seen now are known
    if (src.scope === "all" && (!src.playAs || serviceList)) job.follows.push({ show: src.show, readAs: src.playAs ?? null, app: s.app, services: [...new Set([s.app, ...(src.services ?? [])])], tmdb: src.tmdb ?? null, poster: src.poster ?? null, known: expandEpisodes(v.seasons, "all").map((ep) => itemKeyOf({ kind: "episode", title: ep.title, show: src.show, season: ep.season, episode: ep.episode })), checkedAt: d.now() });
    if (d.airDatesOf && items.some((i) => !i.airDate)) {
      job.message = "Reading " + src.show + "'s air dates from TMDB";
      try {
        const dates = await d.airDatesOf(src.show);
        const at = new Map((dates ?? []).map((x) => [x.season + "|" + x.episode, x.airDate]));
        return items.map((i) => (i.airDate ? i : { ...i, airDate: at.get(i.season + "|" + i.episode) ?? null }));
      } catch (e) { d.report(e); }
    }
    return items;
  };
  const finish = (job: Job, confirmed: boolean): void => {
    if (job.items.length > LARGE_ADD && !confirmed) { job.status = "confirm"; job.count = job.items.length; job.message = "Add " + job.items.length + " episodes?"; return; }
    let st = load();
    let list = job.target.id ? st.lists.find((l) => l.id === job.target.id) : undefined;
    if (!list) { const c = create(st, job.target.newName || "Playlist"); st = c.st; list = c.list; }
    const r = addItems(list, job.items, d.now());
    let withFollows = r.list;
    for (const f of job.follows) withFollows = follow(withFollows, f);
    st = touchRecent({ ...putList(st, withFollows), open: r.list.id }, r.list.id);
    save(st);
    job.status = "done"; job.added = r.added; job.skipped = r.skipped; job.listId = r.list.id;
    job.message = (r.added ? "Added " + r.added + (r.added === 1 ? " item" : " items") + " to " + r.list.name : "Nothing new for " + r.list.name) + (r.skipped ? ". " + r.skipped + " already in this playlist" : "");
  };
  const startJob = (target: Target, work: (job: Job) => Promise<PlItem[]>): string => {
    const job: Job = { id: newId("job"), status: "reading", message: "Reading", target, items: [], count: 0, added: 0, skipped: 0, follows: [] };
    jobs.set(job.id, job);
    void work(job).then((items) => { job.items = items; finish(job, false); }, (e) => { job.status = "error"; job.error = e instanceof Error ? e.message : String(e); job.message = job.error; });
    return job.id;
  };

  // ---- air dates a service didn't give (2026-09-27, "In this same playlist, by release date, I see Voyager appearing much later than it should":
  // Paramount+ listed Voyager's 123 episodes without dates, and a release-date sort put the show last): TMDB's, once per show, kept on the items
  const datesAsked = new Set<string>();
  const fillDates = (show: string): Promise<void> => {
    const k = titleKey(show);
    if (datesAsked.has(k) || !d.airDatesOf) return Promise.resolve();
    datesAsked.add(k);
    return d.airDatesOf(show).then((dates) => {
      if (!dates?.length) { datesAsked.delete(k); return; }
      const at = new Map(dates.map((x) => [x.season + "|" + x.episode, x.airDate]));
      const st = load();
      let changed = false;
      const lists = st.lists.map((l) => ({ ...l, items: l.items.map((i) => {
        if (i.kind !== "episode" || i.airDate || titleKey(i.show ?? "") !== k) return i;
        const a = at.get(i.season + "|" + i.episode);
        if (!a) return i;
        changed = true;
        return { ...i, airDate: a };
      }) }));
      if (changed) save({ ...st, lists });
    }, (e) => { datesAsked.delete(k); d.report(e); });
  };
  const undatedShows = (st: PlaylistStore): string[] => [...new Set(st.lists.flatMap((l) => l.items.filter((i) => i.kind === "episode" && !i.airDate && i.show).map((i) => i.show!)))];

  // ---- followed shows: their new episodes, as their service lists them - read no more than every 12 hours a show, through the details window's
  // own (cached) episode path; an episode never seen before is added among the show's own, so with the rest watched it is next up
  const follow = (l: Playlist, f: PlFollow): Playlist => {
    const k = titleKey(f.show);
    const rest = (l.follows ?? []).filter((x) => titleKey(x.show) !== k);
    const had = (l.follows ?? []).find((x) => titleKey(x.show) === k);
    return { ...l, follows: [...rest, had && had.known && f.known ? { ...f, known: [...new Set([...had.known, ...f.known])] } : f] };
  };
  const FOLLOW_EVERY_MS = 12 * 3_600_000;
  let following = false;
  const checkFollows = async (force = false): Promise<number> => {
    if (following) return 0;
    following = true;
    let added = 0;
    try {
      for (const l0 of load().lists) for (const f of l0.follows ?? []) {
        if (!force && f.checkedAt && d.now() - f.checkedAt < FOLLOW_EVERY_MS) continue;
        const s = svcFor(f.app, f.services);
        if (!s) continue;
        const job = { message: "" } as Job;
        let v: PlEpisodes;
        try { v = await readEpisodes(s, f.readAs ?? f.show, job); } catch (e) { d.report(e); continue; }
        const st = load();
        const l = st.lists.find((x) => x.id === l0.id);
        const cur = l?.follows?.find((x) => titleKey(x.show) === titleKey(f.show));
        if (!l || !cur) continue;
        const all = episodeItems({ type: "series", show: cur.show, app: s.app, services: cur.services, scope: "all", tmdb: cur.tmdb ?? null, poster: cur.poster ?? null, playAs: cur.readAs ?? null }, s, v);
        if (!v.seasons.length) { save(putList(st, follow(l, { ...cur, checkedAt: d.now() }))); continue; }
        const known = new Set(cur.known ?? []);
        const fresh = cur.known ? all.filter((i) => !known.has(i.key)) : [];
        let next = follow(l, { ...cur, known: [...new Set([...known, ...all.map((i) => i.key)])], checkedAt: d.now() });
        if (fresh.length) { const r = addItems(next, fresh, d.now()); next = r.list; added += r.added; if (r.added) news.push({ listId: l.id, list: l.name, show: cur.show, count: r.added, at: d.now() }); }
        save(putList(st, next));
        if (fresh.some((i) => !i.airDate)) void fillDates(cur.show);
      }
    } finally { following = false; }
    return added;
  };
  const news: Array<{ listId: string; list: string; show: string; count: number; at: number }> = [];
  const followTick = () => { void checkFollows(); d.later(followTick, 6 * 3_600_000); };
  d.later(followTick, 10 * 60_000);   // the first look ten minutes after a start, then every six hours (each show at most every twelve)

  // ---- continuous play
  // the run is kept on the device, so a restart carries on with it (2026-09-27: a restart mid-playlist left the title playing and the run gone)
  const RUN_KEY = "video:playlist-run";
  let run: (RunState & { note?: string | null }) | null = (() => {
    const r = parse(d.read(RUN_KEY)) as (RunState & { savedAt?: number }) | null;
    return r && typeof r.listId === "string" && typeof r.key === "string" && d.now() - (r.savedAt ?? 0) < 12 * 3_600_000 ? r : null;
  })();
  const saveRun = () => { try { d.write(RUN_KEY, run ? JSON.stringify({ ...run, savedAt: d.now() }) : ""); } catch (e) { d.report(e); } };
  const itemLabel = (i: PlItem) => (i.kind === "episode" ? `${i.show} S${i.season} E${i.episode}` : i.title);
  /** Plays one item on its resolved service through the existing play path; a service whose numbering disagrees is flagged and the next tried. */
  const playItem = (listId: string, key: string): { ok: boolean; error?: string; waiting?: boolean; app?: string } => {
    for (let tries = 0; tries < 8; tries++) {
      const st = load();
      const list = st.lists.find((l) => l.id === listId);
      const item = list?.items.find((i) => i.key === key);
      if (!list || !item) return { ok: false, error: "that item is gone" };
      const app = resolveService(item, orderOf(list), signedIn().map((s) => s.app));
      if (!app) return { ok: false, error: item.title + " isn't available on a service signed in here" };
      const s = d.services().find((x) => x.app === app)!;
      const known = item.services.find((x) => x.app === app);
      if (item.kind === "movie") {
        const r = known?.url && known.id ? d.playOn(s.facet, "title", known.id, known.url, item.title) : d.playCatalog(s, item.title, "movie");
        return { ok: r.ok !== false, app, ...(r.ok === false ? { error: String(r.error ?? "it didn't start") } : {}) };
      }
      if (known?.url && known.id) { const r = d.playOn(s.facet, "title", known.id, known.url, itemLabel(item)); return { ok: r.ok !== false, app }; }
      const ep = d.episodeByNumber(app, item.show ?? item.title, item.season ?? 0, item.episode ?? 0);
      // the service's list for this show disagrees with the item (its air date, or its title): flagged for that service, never guessed
      const off = ep && ((item.airDate && ep.airDate && Math.abs(Date.parse(item.airDate) - Date.parse(ep.airDate)) > 3 * 86_400_000) || (ep.title && item.title && titleKey(ep.title) !== titleKey(item.title) && !item.airDate));
      if (off) { save(putList(st, { ...list, items: list.items.map((i) => (i.key === key ? { ...i, mismatch: [...new Set([...(i.mismatch ?? []), app])] } : i)) })); continue; }
      if (ep?.id && ep.url) { const r = d.playOn(s.facet, "title", ep.id, ep.url, itemLabel(item)); return { ok: r.ok !== false, app }; }
      // no address for this episode on the service: its show opens there, the person picks the episode; continuous play waits for them
      const showName = item.playAs ?? item.show ?? item.title;
      if (!item.playAs) void d.episodesOf(s, showName);   // read for next time
      d.playCatalog(s, showName, "series");
      return { ok: true, waiting: true, app };
    }
    return { ok: false, error: "no service here numbers this show the same way" };
  };
  const startRun = (listId: string, key: string, stopAfter = false): Record<string, unknown> => {
    const r = playItem(listId, key);
    if (!r.ok) { run = null; saveRun(); return { ok: false, error: r.error }; }
    const st = load();
    const item = st.lists.find((l) => l.id === listId)?.items.find((i) => i.key === key);
    run = { listId, key, tile: null, seen: false, near: false, ended: false, stopAfter, waiting: !!r.waiting, goneAt: null, startedAt: d.now(), note: r.waiting && item ? "Next up: S" + item.season + " E" + item.episode + " · " + item.title : null };
    save(touchRecent({ ...st, open: listId }, listId));
    saveRun();
    return { ok: true, waiting: !!r.waiting, app: r.app };
  };
  const complete = (listId: string, key: string, label: string): void => {
    const st = load();
    const list = st.lists.find((l) => l.id === listId);
    if (!list) return;
    setUndo(label, st);
    const marked = markItems(list, [key], true, d.now());
    save(putList(st, { ...marked, items: marked.items.map((i) => (i.key === key ? { ...i, finishedAt: i.finishedAt ?? d.now() } : i)) }));   // a run's item ended: finished too
  };
  const lastSeen = new Map<string, string>();   // listId -> the key last written, so a report writes the store only when it changes
  // the furthest each item was seen (2026-09-27, "In case someone skips ahead past 10, make sure there are some additional checks to get the item
  // marked watched"): a skip forward counts at once, a skip back undoes nothing
  const furthest = new Map<string, number>();
  const observe = (tileId: string, ended: boolean): void => {
    if (tileId !== d.screen()) return;
    const t = d.state(tileId);
    const v = (t?.video ?? null) as { kind?: string; title?: string; series?: string; season?: number | null; episode?: number | null; position?: number | null; duration?: number | null; ad?: boolean } | null;
    // an ad names the title it interrupts but its clock is the ad's own (2026-09-28 review: a pre-roll's 20 of 30 s marked the episode finished)
    if (!v || v.ad || !(v.title || v.series) || v.kind === "title") return;
    let st: PlaylistStore | null = null;
    for (const l of load().lists) {
      const it = l.items.find((i) => matchesItem(v, i));
      if (!it) continue;
      // watched (the playlist's own count): an episode at ten minutes in (2026-09-27, "Let's just auto mark any episode as watched once we're 10
      // minutes in. This is just for the playlist episode completeness stars. Not for the continue watching where I left off feature"), a movie at
      // its credits; played to its end: the credits or the player's end - where Play goes on from
      const fk = l.id + "|" + it.key;
      if (typeof v.position === "number") furthest.set(fk, Math.max(furthest.get(fk) ?? 0, v.position));
      const far = furthest.get(fk) ?? 0;
      // ten minutes in - or, for a short episode, 60% of it
      const need = typeof v.duration === "number" && v.duration > 0 ? Math.min(EPISODE_WATCHED_S, v.duration * 0.6) : EPISODE_WATCHED_S;
      const finished = !it.finishedAt && (ended || inCredits(it.kind, v.position, v.duration));
      const done = !it.completedAt && (finished || (it.kind === "episode" && far >= need));
      // a later episode of the same show from this playlist has started after at least five minutes of the one before: that one is watched
      // (a skip to its end, or the service rolling on between reports)
      const prevKey = l.lastKey && l.lastKey !== it.key ? l.lastKey : null;
      const prev = prevKey ? l.items.find((i) => i.key === prevKey) : undefined;
      const prevDone = !!prev && prev.kind === "episode" && it.kind === "episode" && !prev.completedAt && showsMatch(prev.show ?? "", it.show ?? "")
        && l.items.indexOf(prev) < l.items.indexOf(it) && (furthest.get(l.id + "|" + prev.key) ?? 0) >= 300;
      // the spot (playlist-tmdb.ts, 2026-10-03, "include watch status, time remaining"): the item's position, kept when it first shows, then
      // every five minutes of play, and at the end - each one a write to TMDB, so not every report
      const spot = typeof v.position === "number" && (it.at === undefined || it.at === null || Math.abs(v.position - it.at) >= 300 || finished) ? Math.floor(v.position) : null;
      if (lastSeen.get(l.id) === it.key && l.lastKey === it.key && !done && !finished && spot === null) continue;
      lastSeen.set(l.id, it.key);
      st ??= load();
      const cur = st.lists.find((x) => x.id === l.id);
      if (!cur) continue;
      let next: Playlist = done ? markItems(cur, [it.key], true, d.now()) : cur;
      if (prevDone && prev) next = markItems(next, [prev.key], true, d.now());
      if (finished) next = { ...next, items: next.items.map((i) => (i.key === it.key ? { ...i, finishedAt: d.now() } : i)) };
      if (spot !== null) next = { ...next, items: next.items.map((i) => (i.key === it.key ? { ...i, at: spot, atTime: d.now() } : i)) };
      next = { ...next, lastKey: it.key, lastAt: d.now() };
      st = putList(st, next);
    }
    if (st) save(st);
  };
  // the player's "ended" is the episode's end only near its end and outside an ad (2026-09-27: each of Paramount+'s ads is its own video, and
  // an ad's end said "ended" 26 minutes into The Enemy Within - it was taken for played to its end)
  const realEnd = (tileId: string, ended: boolean): boolean => {
    if (!ended && d.atEnd?.(tileId)) return true;   // stuck at its end - an end card naming it (every service, 2026-09-28)
    if (!ended) return false;
    const v = (d.state(tileId)?.video ?? null) as { ad?: boolean; position?: number | null; duration?: number | null } | null;
    if (!v || v.ad) return false;
    if (typeof v.position !== "number" || typeof v.duration !== "number" || v.duration <= 0) return true;
    return v.position >= v.duration * 0.9;
  };
  const step = (tileId: string, ended0: boolean): void => {
    const ended = realEnd(tileId, ended0);
    try { observe(tileId, ended); } catch (e) { d.report(e); }
    if (!run) return;
    const before = JSON.stringify(run);
    try { stepInner(tileId, ended); } finally { if (JSON.stringify(run) !== before) saveRun(); }
  };
  const stepInner = (tileId: string, ended: boolean): void => {
    if (!run) return;
    const screen = d.screen();
    if (!screen || tileId !== screen) return;
    const st = load();
    const list = st.lists.find((l) => l.id === run!.listId);
    const current = list?.items.find((i) => i.key === run!.key);
    if (!list || !current) { run = null; return; }
    if (ended && run.seen) run = { ...run, ended: true };
    const t = d.state(tileId);
    const pend = t?.pending && !t.pending.failed;
    const next = nextOpen(list, current.key);
    const r = stepRun(run, { pending: !!pend, playing: !!t?.playing, video: (t?.video as never) ?? null }, current, next, d.now());
    run = { ...run, ...r.run, tile: tileId };
    const s = r.step;
    if (s.do === "wait") { d.later(() => step(tileId, false), s.ms + 50); return; }
    if (s.do === "end") { if (s.completed) complete(list.id, current.key, current.title + " marked completed"); run = null; return; }
    if (s.do !== "advance") return;
    complete(list.id, current.key, current.title + " marked completed");
    if (d.onEndOf(tileId) !== "none" || !next) { run = null; return; }   // a standing onEnd instruction wins; the end of the playlist
    if (s.keep) { run = { ...run, key: next.key, seen: true, near: false, ended: false, goneAt: null, waiting: false, note: null }; return; }
    const stopAfter = run.stopAfter;
    startRun(list.id, next.key, stopAfter);
  };

  const summary = (l: Playlist, open: string | null) => {
    const r = resumePoint(l);
    // the progress over the whole playlist (2026-09-27, "a fill bar ... for total playlist completion"): excluded items count for neither
    const kept = l.items.filter((i) => !i.excluded);
    return { id: l.id, name: l.name, count: l.items.length, done: l.items.filter((i) => i.completedAt).length, updated: l.updatedAt, open: l.id === open, public: l.public === true,
      progress: { done: kept.filter((i) => i.completedAt).length, total: kept.length },
      resume: r ? { key: r.key, title: r.title, show: r.show ?? null, season: r.season ?? null, episode: r.episode ?? null, kind: r.kind, last: r.key === l.lastKey } : null };
  };
  const detail = (l: Playlist) => {
    const ins = signedIn().map((s) => s.app);
    const names = new Map(d.services().map((s) => [s.app, s.name]));
    const order = orderOf(l);
    let n = 0;
    return {
      id: l.id, name: l.name, view: l.view, manual: l.view === "manual", follows: (l.follows ?? []).map((f) => f.show), lastKey: l.lastKey ?? null,
      serviceOrder: order.map((app) => ({ app, name: names.get(app) ?? app, signedIn: ins.includes(app) })),
      groups: viewOf(l).map((g) => ({ name: g.name, season: g.season ?? null, items: g.items.map((i) => {
        const on = resolveService(i, order, ins);
        return { key: i.key, pos: ++n, kind: i.kind, title: i.title, show: i.show ?? null, season: i.season ?? null, episode: i.episode ?? null, airDate: i.airDate ?? null, poster: i.poster ?? null,
          completed: !!i.completedAt, excluded: !!i.excluded, playsOn: on ? { app: on, name: names.get(on) ?? on } : null, pin: i.pin ?? null,
          services: i.services.map((x) => ({ app: x.app, name: names.get(x.app) ?? x.app })), mismatch: (i.mismatch ?? []).map((a) => names.get(a) ?? a), manualIndex: l.items.indexOf(i) };
      }) })),
    };
  };
  const runView = () => {
    if (!run) return null;
    const l = load().lists.find((x) => x.id === run!.listId);
    if (!l) return null;
    const order = viewOf(l).flatMap((g) => g.items).filter((i) => !i.excluded);
    const cur = l.items.find((i) => i.key === run!.key);
    const names = new Map(d.services().map((x) => [x.app, x.name]));
    const on = cur ? resolveService(cur, orderOf(l), signedIn().map((x) => x.app)) : null;
    // the Watch page's playlist panel (2026-09-27, "show the current details, position as well as items completed and items remaining")
    return { listId: l.id, name: l.name, key: run.key, index: order.findIndex((i) => i.key === run!.key) + 1, total: order.length, hasPrevious: order.findIndex((i) => i.key === run!.key) > 0, hasNext: order.findIndex((i) => i.key === run!.key) < order.length - 1, stopAfter: run.stopAfter, waiting: run.waiting, note: run.note ?? null,
      current: cur ? { title: cur.title, kind: cur.kind, show: cur.show ?? null, season: cur.season ?? null, episode: cur.episode ?? null, poster: cur.poster ?? null, service: on ? names.get(on) ?? on : null } : null,
      completed: order.filter((i) => !!i.completedAt).length, remaining: order.filter((i) => !i.completedAt).length };
  };

  return {
    step,
    view(q?: string | null, sort?: string | null, listId?: string | null) {
      let st = load();
      // a movie's release date (the Release date sort), and a picture for an item sent without one (2026-09-27, "there are a number of items
      // missing pictures but they existed when searching" - films sent from a card's menu carried no art), kept on the item once known
      if (d.releaseOf || d.pictureOf) {
        let changed = false;
        const lists = st.lists.map((l) => ({ ...l, items: l.items.map((i) => {
          let n = i;
          if (i.kind === "movie" && !i.airDate && d.releaseOf) { const r = d.releaseOf(i.title, "movie"); if (r) n = { ...n, airDate: r }; }
          if (!i.poster && d.pictureOf) { const pic = d.pictureOf(i.kind === "movie" ? i.title : i.show ?? i.title, i.kind === "movie" ? "movie" : "series"); if (pic) n = { ...n, poster: pic }; }
          if (n !== i) changed = true;
          return n;
        }) }));
        if (changed) { st = { ...st, lists }; save(st); }
      }
      for (const show of undatedShows(st)) void fillDates(show);
      const lists = findPlaylists(st.lists, q ?? "", sort === "name" ? "name" : "updated");
      const openId = listId && st.lists.some((l) => l.id === listId) ? listId : st.open;
      const open = st.lists.find((l) => l.id === openId) ?? null;
      void checkFollows();
      // TMDB (2026-10-03): the lists read when stale; the screen told what the engine is doing, the titles TMDB could not place, and the
      // device's own earlier playlists it can copy up (once)
      const e = engineOf();
      if (e) pull();
      const localLists = e ? storeOf(parse(d.read(localKey()))).lists : [];
      const sy = e ? syncState(e.account) : null;
      const tmdb = e ? { active: true, ...e.sync.status(), unmatched: Object.values(unmatched).flat().filter((t, n, arr) => arr.indexOf(t) === n), localCount: sy?.localCopied ? 0 : localLists.length, pulledAt: sy?.pulledAt ?? 0 } : { active: false, busy: false, note: null, unmatched: [], localCount: 0, pulledAt: 0 };
      return { news: news.filter((n) => d.now() - n.at < 86_400_000), lists: lists.map((l) => summary(l, openId)), total: st.lists.length, open: open ? detail(open) : null, run: runView(), undo: undo && undo.until > d.now() ? { label: undo.label } : null, services: d.services().map((s) => ({ app: s.app, name: s.name, signedIn: s.status === "signed-in" })), tmdb };
    },
    /** Whether playlists are on (a TMDB account with lists linked): the gate the screen shows otherwise. */
    gate() { return { active: !!acct() }; },
    /** TMDB's lists read now (Refresh). */
    sync() { pull(true); return { ok: !!engineOf() }; },
    /** The device's own earlier playlists copied onto TMDB as private lists, once ("Copy my N playlists"); the originals stay where they are (section 10). */
    copyLocal() {
      const e = engineOf();
      if (!e) return { ok: false, error: "no TMDB account with lists is linked" };
      const local = storeOf(parse(d.read(localKey()))).lists;
      let st = load();
      const now = d.now();
      for (const l of local) {
        if (st.lists.some((x) => x.name === l.name && x.items.length === l.items.length)) continue;   // already here under that name
        st = { ...st, lists: [...st.lists, { ...l, id: newId("pl"), public: false, view: "manual", createdAt: now, updatedAt: now }] };
      }
      save(st);
      const sy = syncState(e.account); sy.localCopied = true; d.write(syncKey(e.account), JSON.stringify(sy));
      return { ok: true, copied: local.length };
    },
    /** A list public on TMDB (anyone can see it there) or private. */
    setPublic(id: string, on: boolean) {
      const st = load(); const l = st.lists.find((x) => x.id === id);
      if (!l) return { ok: false };
      save(putList(st, { ...l, public: on, updatedAt: d.now() }));
      return { ok: true };
    },
    picker() { const st = load(); return { items: pickerOf(st), total: st.lists.length }; },
    create(name: string, isPublic = false) { const c = create(load(), name, isPublic); save(c.st); return { ok: true, id: c.list.id }; },
    open(id: string) { const st = load(); if (!st.lists.some((l) => l.id === id)) return { ok: false }; save(touchRecent({ ...st, open: id }, id)); return { ok: true }; },
    rename(id: string, name: string) {
      const st = load(); const l = st.lists.find((x) => x.id === id);
      if (!l || !name.trim()) return { ok: false };
      save(putList(st, { ...l, name: name.trim().slice(0, 60), updatedAt: d.now() })); return { ok: true };
    },
    remove(id: string) {
      const st = load(); const l = st.lists.find((x) => x.id === id);
      if (!l) return { ok: false };
      setUndo(l.name + " deleted", st);
      if (run?.listId === id) { run = null; saveRun(); }
      save({ ...st, lists: st.lists.filter((x) => x.id !== id), open: st.open === id ? null : st.open, recent: st.recent.filter((x) => x !== id) });
      return { ok: true };
    },
    undo() { if (!undo || undo.until < d.now()) return { ok: false }; undo.apply(); undo = null; return { ok: true }; },
    send(target: Target, src: PlSource) { return { job: startJob(target, (job) => itemsOf(src, job)) }; },
    importMyList(target: Target, apps: string[], scope: "all" | "s1") {
      return { job: startJob(target, async (job) => {
        const cards = d.myList().filter((c) => apps.includes(c.app) || (c.also ?? []).some((a) => apps.includes(a.app)));
        const out: PlItem[] = [];
        let n = 0;
        for (const c of cards) {
          n++;
          job.message = "Reading " + n + " of " + cards.length + ": " + c.item.title;
          const services: PlService[] = [{ app: c.app, id: c.item.id, url: c.item.url ?? null }, ...(c.also ?? []).map((a) => ({ app: a.app, id: a.item.id, url: a.item.url ?? null }))].filter((x) => apps.includes(x.app));
          const k = (c.item.kind ?? "").toLowerCase();
          if (k === "movie") { out.push(...await itemsOf({ type: "movie", title: c.item.title, poster: c.item.artwork ?? null, services }, job)); continue; }
          // a series (or a card whose kind the service didn't say): its episodes, read the way the details window reads them; no list = a movie
          try {
            const got = await itemsOf({ type: "series", show: c.item.title, poster: c.item.artwork ?? null, app: services[0]?.app ?? c.app, services: services.map((x) => x.app), scope: scope === "s1" ? "season" : "all", season: scope === "s1" ? 1 : null }, job);
            out.push(...got);
          } catch (e) {
            if (k === "series" || k === "episode" || k === "show") { d.report(e); continue; }
            out.push(...await itemsOf({ type: "movie", title: c.item.title, poster: c.item.artwork ?? null, services }, job));
          }
        }
        return out;
      }) };
    },
    job(id: string) { const j = jobs.get(id); return j ? { status: j.status, message: j.message, count: j.count, added: j.added, skipped: j.skipped, listId: j.listId ?? null, error: j.error ?? null } : { status: "error", message: "no such job" }; },
    confirm(id: string, yes: boolean) {
      const j = jobs.get(id);
      if (!j || j.status !== "confirm") return { ok: false };
      if (!yes) { j.status = "done"; j.message = "Nothing added"; return { ok: true }; }
      finish(j, true); return { ok: true };
    },
    edit(id: string, op: Record<string, unknown>) {
      const st = load(); const l = st.lists.find((x) => x.id === id);
      if (!l) return { ok: false, error: "no such playlist" };
      const now = d.now();
      const keys = Array.isArray(op.keys) ? (op.keys as unknown[]).filter((k): k is string => typeof k === "string") : typeof op.key === "string" ? [op.key] : [];
      const reorder = op.op === "move" || op.op === "moveBy";
      if (reorder && l.view !== "manual") return { ok: false, error: "Switch to Manual to reorder" };
      let next: Playlist = l;
      switch (op.op) {
        case "move": next = moveItems(l, keys, Number(op.to), now); break;
        case "moveBy": next = moveBy(l, keys, typeof op.how === "number" ? op.how : op.how === "up" || op.how === "down" || op.how === "top" ? op.how : Number(op.how), now); break;
        // marked by hand: watched and done with - Play goes on past it
        case "mark": { setUndo(keys.length === 1 ? (op.done !== false ? "Marked watched" : "Marked not watched") : (op.done !== false ? "Marked " + keys.length + " watched" : "Marked " + keys.length + " not watched"), st); const on = op.done !== false; const m = markItems(l, keys, on, now, op.keep === true); next = on ? { ...m, items: m.items.map((i) => (keys.includes(i.key) ? { ...i, finishedAt: i.finishedAt ?? now } : i)) } : m; break; }
        case "markShow": { setUndo("Marked the show", st); const ks = showKeysOf(l, keys[0] ?? ""); const m = markItems(l, ks, true, now); next = { ...m, items: m.items.map((i) => (ks.includes(i.key) ? { ...i, finishedAt: i.finishedAt ?? now } : i)) }; break; }
        case "remove": setUndo(keys.length === 1 ? "Removed" : "Removed " + keys.length, st); next = removeItems(l, keys, now); break;
        case "removeShow": setUndo("Removed the show", st); next = removeItems(l, showKeysOf(l, keys[0] ?? ""), now); break;
        case "clearCompleted": setUndo("Cleared completed", st); next = removeItems(l, l.items.filter((i) => i.completedAt).map((i) => i.key), now); break;
        case "sort": setUndo("Sorted " + (op.by === "released" ? "by release date" : op.by === "added" ? "by date added" : "by show"), st); next = sortPlaylist(l, op.by === "released" || op.by === "added" ? op.by : "show", now); break;
        case "follow": {
          const it = l.items.find((i) => i.key === keys[0]);
          if (!it || it.kind !== "episode") return { ok: false, error: "follow a show from one of its episodes" };
          const show = it.show ?? it.title;
          if (op.on === false) next = { ...l, follows: (l.follows ?? []).filter((x) => titleKey(x.show) !== titleKey(show)), updatedAt: now };
          else next = { ...follow(l, { show, app: it.services[0]?.app ?? "", services: it.services.map((x) => x.app), tmdb: it.tmdb ?? null, poster: null, known: null }), updatedAt: now };
          break;
        }
        case "last": next = { ...l, lastKey: keys[0] ?? null, lastAt: now }; break;
        case "unfinish": next = { ...l, items: l.items.map((i) => (keys.includes(i.key) ? { ...i, finishedAt: null } : i)) }; break;   // a wrong "played to its end" taken back   // the last-watched flag set by hand (a correction)
        case "exclude": next = excludeItems(l, keys, op.on !== false, now); break;
        case "pin": next = { ...l, items: l.items.map((i) => (keys.includes(i.key) ? { ...i, pin: typeof op.app === "string" && op.app ? op.app : null } : i)), updatedAt: now }; break;
        case "view": next = { ...l, view: (op.view === "show" || op.view === "added" || op.view === "released" ? op.view : "manual") as PlaylistView, updatedAt: now }; break;
        case "order": next = { ...l, serviceOrder: Array.isArray(op.apps) ? (op.apps as unknown[]).filter((a): a is string => typeof a === "string") : [], updatedAt: now }; break;
        default: return { ok: false, error: "unknown edit" };
      }
      save(putList(st, next));
      return { ok: true };
    },
    play(id: string, key?: string | null) {
      const l = load().lists.find((x) => x.id === id);
      if (!l) return { ok: false, error: "no such playlist" };
      const item = key ? l.items.find((i) => i.key === key) : resumePoint(l);
      if (!item) return { ok: false, error: "everything in " + l.name + " is completed" };
      return startRun(id, item.key);
    },
    /** Previous / Next (2026-09-29, "I should be able to hit previous or next on a playlist too"): the item before or after the one the run is
     *  on, in the playlist's order as drawn, completed or not; the one left is not marked completed. */
    move(dir: "previous" | "next") {
      if (!run) return { ok: false, error: "no playlist is playing" };
      const l = load().lists.find((x) => x.id === run!.listId);
      if (!l) return { ok: false, error: "that playlist is gone" };
      const order = viewOf(l).flatMap((g) => g.items).filter((i) => !i.excluded);
      const at = order.findIndex((i) => i.key === run!.key);
      const to = at < 0 ? undefined : order[at + (dir === "next" ? 1 : -1)];
      if (!to) return { ok: false, error: dir === "next" ? "that was the last one in " + l.name : "that is the first one in " + l.name };
      return startRun(l.id, to.key, run.stopAfter);
    },
    /** Stop: the run ends, and what it put on the screen is paused where it is (2026-09-29, "I hit stop on a playlist but it doesnt stop whats
     *  currently on the screen even though it was the playlist") - only the playlist's own item; anything else on the screen is the person's. */
    stop(mode: "after" | "now") {
      if (!run) return { ok: false };
      let paused = false;
      if (mode === "now") {
        const tile = d.screen(), st = tile ? d.state(tile) : null;
        const item = load().lists.find((l) => l.id === run!.listId)?.items.find((i) => i.key === run!.key) ?? null;
        if (tile && st?.playing && matchesItem((st.video ?? null) as never, item)) { try { d.pause?.(tile); paused = true; } catch (e) { d.report(e); } }
        run = null;
      } else run = { ...run, stopAfter: true };
      saveRun();
      return { ok: true, paused };
    },
    runNow: () => run,
    /** the followed shows read now, whatever their last look (tests, and a person's refresh) */
    checkFollowsNow: () => checkFollows(true),
    /** every show in the playlists with undated episodes, dated from TMDB now (tests; the view does this in the background) */
    fillAllDates: () => Promise.all(undatedShows(load()).map((s) => fillDates(s))),
  };
}
export type Playlists = ReturnType<typeof createPlaylists>;
