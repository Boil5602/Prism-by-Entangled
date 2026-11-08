import { describe, expect, it } from "vitest";
import { COMMENT_MAX, DELETE_GRACE_MS, EMPTY_SYNC, createPlaylistSync, encodeComment, entriesOf, entryKey, itemsOfEntry, parseComment, playlistFromEntries, rangesOf, type EntryState, type SyncState, type TmdbListApi, type TmdbSeason } from "../src/playlist-tmdb.js";
import { itemKeyOf, type PlItem, type Playlist } from "../src/playlist-store.js";

// playlists on the person's TMDB lists (2026-10-03): each show or film an entry, its state in the entry's comment; order is release date
const T0 = Date.parse("2026-10-03T07:12:00Z");
const ep = (show: string, season: number, episode: number, extra: Partial<PlItem> = {}): PlItem => {
  const base = { kind: "episode" as const, title: `${show} ${season}x${episode}`, show, season, episode, year: 1966, tmdb: "tv:253" };
  return { ...base, key: itemKeyOf(base), airDate: `1966-09-${String(episode).padStart(2, "0")}`, services: [{ app: "paramount" }], addedAt: T0, ...extra };
};
const film = (title: string, id: number, extra: Partial<PlItem> = {}): PlItem => { const base = { kind: "movie" as const, title, year: 1979, tmdb: "movie:" + id }; return { ...base, key: itemKeyOf(base), services: [{ app: "paramount" }], addedAt: T0, ...extra }; };
const list = (items: PlItem[], extra: Partial<Playlist> = {}): Playlist => ({ id: "pl1", name: "Trek", items, view: "manual", serviceOrder: [], createdAt: T0, updatedAt: T0, ...extra });

describe("the comment: structured text a person can read on TMDB", () => {
  it("rounds a show's state through the comment: episodes, watched, excluded, the spot, the stamp", () => {
    const e: EntryState = { kind: "tv", id: 253, episodes: [{ season: 1, from: 1, to: 29 }, { season: 2, from: 1, to: 26 }], watched: [{ season: 1, from: 1, to: 12 }, { season: 2, from: 3, to: 3 }], excluded: [{ season: 2, from: 5, to: 5 }], now: { season: 2, episode: 4, at: 1872 }, updated: Math.floor(T0 / 1000) };
    const text = encodeComment(e);
    expect(text).toBe("Prism: episodes S1E1-29 S2E1-26; watched S1E1-12 S2E3; excluded S2E5; now S2E4 31:12; 2026-10-03 07:12");
    expect(parseComment("tv", 253, text)).toEqual(e);
  });
  it("a film: watched or not, the spot in it; an entry without the mark is the whole thing, nothing watched, stamp 0", () => {
    const e: EntryState = { kind: "movie", id: 152, episodes: "all", watched: [{ season: 0, from: 0, to: 0 }], now: { at: 3760 }, excluded: [], updated: 1_700_000_000 };
    const text = encodeComment(e);
    expect(text).toMatch(/^Prism: watched; now 1:02:40; 2023-11-14 22:13$/);
    expect(parseComment("movie", 152, text)).toEqual({ ...e, updated: 1_700_000_000 - 20 });   // minutes kept
    expect(parseComment("tv", 1, null)).toEqual({ kind: "tv", id: 1, episodes: "all", watched: [], excluded: [], now: null, updated: 0 });
    expect(parseComment("tv", 1, "Amazing show!")).toMatchObject({ episodes: "all", updated: 0 });
  });
  it("stays under the ceiling by dropping detail from the end: excluded first, then watched as 'through', then episodes as all", () => {
    const holes = Array.from({ length: 120 }, (_, i) => ({ season: 1 + Math.floor(i / 10), from: 2 + (i % 10) * 2, to: 2 + (i % 10) * 2 }));
    const e: EntryState = { kind: "tv", id: 1, episodes: holes, watched: holes.slice(0, 60), excluded: holes.slice(60), now: null, updated: 1 };
    const text = encodeComment(e);
    expect(text.length).toBeLessThanOrEqual(COMMENT_MAX);
    expect(text).toContain("episodes all");
    expect(text).toContain("watched through S6E20");
    expect(text).not.toContain("excluded");
    expect(rangesOf([{ season: 1, episode: 3 }, { season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 2, episode: 7 }])).toEqual([{ season: 1, from: 1, to: 3 }, { season: 2, from: 7, to: 7 }]);
  });
});

describe("a playlist as entries, and back", () => {
  it("entries: one per show (its episodes as ranges, watched, excluded, the spot with its seconds) and per film; a title TMDB can't place is named back", () => {
    const l = list([ep("Star Trek", 1, 1, { finishedAt: T0 + 1000 }), ep("Star Trek", 1, 2, { completedAt: T0 + 2000 }), ep("Star Trek", 1, 3, { at: 600, atTime: T0 + 3000 }), ep("Star Trek", 1, 5, { excluded: true }), film("Star Trek: The Motion Picture", 152), { ...film("Home video", 0), tmdb: null }], { lastKey: ep("Star Trek", 1, 3).key });
    const { entries, unmatched } = entriesOf(l);
    expect(unmatched).toEqual(["Home video"]);
    expect(entries.get("tv:253")).toEqual({ kind: "tv", id: 253, episodes: [{ season: 1, from: 1, to: 3 }, { season: 1, from: 5, to: 5 }], watched: [{ season: 1, from: 1, to: 2 }], excluded: [{ season: 1, from: 5, to: 5 }], now: { season: 1, episode: 3, at: 600 }, updated: Math.floor((T0 + 3000) / 1000) });
    expect(entries.get("movie:152")).toMatchObject({ kind: "movie", watched: [], now: null });
    // a followed show is "all"
    expect(entriesOf(list([ep("Star Trek", 1, 1)], { follows: [{ show: "Star Trek", app: "paramount", services: ["paramount"], known: null }] })).entries.get("tv:253")?.episodes).toBe("all");
  });
  it("items from an entry: TMDB's seasons cut to the ranges, watched and excluded applied, the spot named, services the ones carrying it here; 'all' follows the show", () => {
    const seasons: TmdbSeason[] = [{ season: 0, episodes: [{ episode: 1, title: "The Cage", still: null, airDate: "1988-10-04" }] }, { season: 1, episodes: [1, 2, 3, 4, 5].map((n) => ({ episode: n, title: "Ep " + n, still: "/s" + n + ".jpg", airDate: "1966-09-0" + n })) }];
    const state = parseComment("tv", 253, "Prism: episodes S1E1-3 S1E5; watched S1E1-2; excluded S1E5; now S1E3 10:00; 2026-10-03 07:12");
    const built = itemsOfEntry({ kind: "tv", id: 253, title: "Star Trek", year: 1966, poster: "/p.jpg", comment: null }, state, seasons, ["paramount", "netflix"], T0);
    expect(built.items.map((i) => i.episode)).toEqual([1, 2, 3, 5]);
    expect(built.items[0]).toMatchObject({ kind: "episode", show: "Star Trek", season: 1, episode: 1, title: "Ep 1", tmdb: "tv:253", completedAt: T0, finishedAt: T0, services: [{ app: "paramount" }, { app: "netflix" }], poster: "/s1.jpg", airDate: "1966-09-01" });
    expect(built.items[2]).toMatchObject({ episode: 3, completedAt: null, at: 600 });
    expect(built.items[3]).toMatchObject({ episode: 5, excluded: true });
    expect(built.lastKey).toBe(built.items[2]!.key);
    expect(built.follow).toBeNull();
    const all = itemsOfEntry({ kind: "tv", id: 253, title: "Star Trek", year: 1966, poster: null, comment: null }, parseComment("tv", 253, null), seasons, ["paramount"], T0);
    expect(all.items.map((i) => i.episode)).toEqual([1, 2, 3, 4, 5]);   // specials left out
    expect(all.follow).toMatchObject({ show: "Star Trek", app: "paramount", tmdb: "tv:253" });
    // the playlist from entries: release order across shows and films
    const pl = playlistFromEntries(list([]), [all, itemsOfEntry({ kind: "movie", id: 152, title: "Star Trek: The Motion Picture", year: 1979, poster: null, comment: "Prism: watched; 2026-10-03 07:12" }, parseComment("movie", 152, "Prism: watched; 2026-10-03 07:12"), null, ["paramount"], T0)], T0);
    expect(pl.items.at(-1)).toMatchObject({ kind: "movie", completedAt: T0 });
    expect(pl.follows?.map((f) => f.show)).toEqual(["Star Trek"]);
  });
});

/** A TMDB that behaves as measured: comments set once per item, reads cached by address, one write in `dropEvery` not kept. */
function fakeTmdb(opts: { dropEvery?: number } = {}) {
  type Item = { kind: "movie" | "tv"; id: number; comment: string | null };
  const lists = new Map<number, { name: string; isPublic: boolean; items: Item[] }>();
  const cache = new Map<string, string>();
  const calls: string[] = [];
  let nextId = 100; let writes = 0;
  const title = (k: string, id: number) => (k === "tv" ? { media_type: "tv", id, name: "Show " + id, first_air_date: "1966-09-08" } : { media_type: "movie", id, title: "Film " + id, release_date: "1979-12-07" });
  const api: TmdbListApi = {
    async listCreate(name, isPublic) { calls.push("create " + name); const id = nextId++; lists.set(id, { name, isPublic, items: [] }); return id; },
    async listGet(id, page = 1, fresh = false) {
      const addr = `${id}/${page}` + (fresh ? "#" + Math.random() : "");
      calls.push("get " + id + (fresh ? " fresh" : ""));
      if (cache.has(addr)) return JSON.parse(cache.get(addr)!);
      const l = lists.get(id); if (!l) return null;
      const per = 20; const slice = l.items.slice((page - 1) * per, page * per);
      const a = { id, name: l.name, public: l.isPublic, results: slice.map((i) => title(i.kind, i.id)), comments: Object.fromEntries(slice.map((i) => [entryKey(i.kind, i.id), i.comment])), total_pages: Math.max(1, Math.ceil(l.items.length / per)) };
      cache.set(addr, JSON.stringify(a));
      return a;
    },
    async listUpdate(id, f) { calls.push("update " + id); const l = lists.get(id); if (!l) return false; if (f.name) l.name = f.name; if (f.public !== undefined) l.isPublic = f.public; return true; },
    async listDelete(id) { calls.push("delete " + id); return lists.delete(id); },
    async listItems(id, method, items) {
      const l = lists.get(id); if (!l) return null;
      for (const it of items) {
        calls.push(`${method} ${id} ${it.media_type}:${it.media_id}` + (it.comment ? " c" : ""));
        const have = l.items.find((x) => x.kind === it.media_type && x.id === it.media_id);
        if (method === "POST") { if (!have) l.items.push({ kind: it.media_type, id: it.media_id, comment: null }); }
        else if (method === "DELETE") l.items = l.items.filter((x) => x !== have);
        else if (method === "PUT" && have && it.comment !== undefined && have.comment === null) { writes++; if (!(opts.dropEvery && writes % opts.dropEvery === 0)) have.comment = it.comment; }
      }
      return { success: true, status_code: 1, results: items.map((i) => ({ media_id: i.media_id, media_type: i.media_type, success: true })) };
    },
    async listsOfAccount() { calls.push("lists"); return { page: 1, total_pages: 1, results: [...lists].map(([id, l]) => ({ id, name: l.name, public: l.isPublic })) }; },
  };
  return { api, lists, calls, setComment(id: number, k: "movie" | "tv", mid: number, c: string | null) { const i = lists.get(id)!.items.find((x) => x.kind === k && x.id === mid)!; i.comment = c; } };
}
function rig(opts: { dropEvery?: number } = {}) {
  const t = fakeTmdb(opts);
  let now = T0;
  let sync: SyncState = JSON.parse(JSON.stringify(EMPTY_SYNC));
  const seasons: TmdbSeason[] = [{ season: 1, episodes: [1, 2, 3].map((n) => ({ episode: n, title: "Ep " + n, still: null, airDate: "1966-09-0" + n })) }];
  const engine = createPlaylistSync({ api: t.api, seasonsOf: async () => seasons, carriedBy: async () => ["paramount"], now: () => now, sleep: async () => {}, report: (e) => { throw e; }, paceMs: 0 }, { load: () => sync, save: (s) => { sync = s; } });
  return { ...t, engine, sync: () => sync, tick: (ms: number) => { now += ms; }, seasons };
}

describe("the engine: the device's playlists onto TMDB and back", () => {
  it("push: a new playlist is made (private, named), each entry added with its comment and read back fresh; nothing is written twice", async () => {
    const r = rig();
    const l = list([ep("Star Trek", 1, 1, { finishedAt: T0 }), ep("Star Trek", 1, 2), film("Star Trek: The Motion Picture", 152)]);
    r.sync().dirty[l.id] = true;
    await r.engine.push([l]);
    expect(r.calls[0]).toBe("create Trek");
    const tl = [...r.lists.values()][0]!;
    expect(tl.isPublic).toBe(false);
    expect(tl.items.map((i) => entryKey(i.kind, i.id)).sort()).toEqual(["movie:152", "tv:253"]);
    expect(tl.items.find((i) => i.kind === "tv")!.comment).toBe("Prism: episodes S1E1-2; watched S1E1; 2026-10-03 07:12");
    expect(r.calls.filter((c) => c.startsWith("get")).every((c) => c.endsWith("fresh"))).toBe(true);
    expect(r.sync().dirty[l.id]).toBeUndefined();
    const n = r.calls.length;
    await r.engine.push([l]);
    expect(r.calls.length).toBe(n);   // unchanged: no call
  });
  it("push: a changed entry is taken off and added again with the new comment (TMDB sets a comment once); a dropped write is done again", async () => {
    const r = rig({ dropEvery: 2 });
    const l = list([ep("Star Trek", 1, 1)]);
    r.sync().dirty[l.id] = true;
    await r.engine.push([l]);
    const id = [...r.lists.keys()][0]!;
    const l2 = { ...l, items: [ep("Star Trek", 1, 1, { finishedAt: T0 + 60_000 })] };
    r.sync().dirty[l.id] = true;
    await r.engine.push([l2]);
    expect(r.lists.get(id)!.items[0]!.comment).toBe("Prism: episodes S1E1; watched S1E1; 2026-10-03 07:13");
    const seq = r.calls.filter((c) => / tv:253/.test(c));
    expect(seq.slice(0, 2)).toEqual([`POST ${id} tv:253`, `PUT ${id} tv:253 c`]);
    expect(seq.slice(2)).toEqual([`DELETE ${id} tv:253`, `POST ${id} tv:253`, `PUT ${id} tv:253 c`, `DELETE ${id} tv:253`, `POST ${id} tv:253`, `PUT ${id} tv:253 c`]);   // the second write dropped, done again
  });
  it("pull: TMDB's lists become playlists (a list made on TMDB's site is every episode, nothing watched); an entry changed elsewhere is rebuilt, one unchanged is left as the device has it", async () => {
    const r = rig();
    r.lists.set(7, { name: "From the site", isPublic: true, items: [{ kind: "tv", id: 253, comment: null }, { kind: "movie", id: 152, comment: "Prism: watched; 2026-10-01 10:00" }] });
    const got = (await r.engine.pull([], true))!;
    expect(got.changed).toBe(true);
    const pl = got.lists[0]!;
    expect(pl).toMatchObject({ id: "tmdb:7", name: "From the site", public: true });
    expect(pl.items.map((i) => (i.kind === "episode" ? "S1E" + i.episode : "film"))).toEqual(["S1E1", "S1E2", "S1E3", "film"]);
    expect(pl.items[3]).toMatchObject({ completedAt: Date.parse("2026-10-01T10:00:00Z") });
    expect(pl.follows?.length).toBe(1);
    // the device marks an episode, a second pull within the fresh window is a no-op; forced, the unchanged entries are left alone
    const mine = { ...pl, items: pl.items.map((i, n) => (n === 0 ? { ...i, finishedAt: T0, completedAt: T0 } : i)) };
    expect(await r.engine.pull([mine])).toBeNull();
    r.tick(11 * 60_000);
    const again = (await r.engine.pull([mine]))!;
    expect(again.changed).toBe(false);
    // elsewhere, the film is marked not watched: that entry is rebuilt, the show's items kept as the device has them
    r.setComment(7, "movie", 152, "Prism: 2026-10-03 09:00");
    r.tick(11 * 60_000);
    const third = (await r.engine.pull([mine]))!;
    expect(third.changed).toBe(true);
    expect(third.lists[0]!.items.find((i) => i.kind === "movie")).toMatchObject({ completedAt: null });
    expect(third.lists[0]!.items[0]).toMatchObject({ episode: 1, completedAt: T0 });
  });
  it("pull against a dirty device: the device's newer state wins for an entry; a list the device made and has not pushed is kept; one taken off TMDB elsewhere goes", async () => {
    const r = rig();
    const mine = list([ep("Star Trek", 1, 1, { completedAt: T0 })]);
    r.sync().dirty[mine.id] = true;
    await r.engine.push([mine]);
    const id = [...r.lists.keys()][0]!;
    // TMDB's copy edited elsewhere with an older stamp than the device's next change
    r.setComment(id, "tv", 253, "Prism: episodes S1E1; 2026-10-03 07:00");
    const newer = { ...mine, items: [ep("Star Trek", 1, 1, { completedAt: T0 + 5 * 60_000 })] };
    r.sync().dirty[mine.id] = true;
    const unpushed = list([film("Star Trek II", 154)], { id: "pl2", name: "Films" });
    r.sync().dirty["pl2"] = true;
    r.tick(11 * 60_000);
    const got = (await r.engine.pull([newer, unpushed], true))!;
    expect(got.lists.find((l) => l.id === "pl1")!.items[0]).toMatchObject({ completedAt: T0 + 5 * 60_000 });
    expect(got.lists.find((l) => l.id === "pl2")).toBeDefined();
    // taken off TMDB elsewhere (and the device has no pending change): gone here
    await r.engine.push([newer, unpushed]);
    r.lists.delete(id);
    r.tick(11 * 60_000);
    const after = (await r.engine.pull([newer, unpushed], true))!;
    expect(after.lists.map((l) => l.id)).toEqual(["pl2"]);
  });
  it("a playlist removed here comes off TMDB only after the undo window; a rename and a public flag go through the list's own update", async () => {
    const r = rig();
    const l = list([film("Star Trek II", 154)]);
    r.sync().dirty[l.id] = true;
    await r.engine.push([l]);
    const id = [...r.lists.keys()][0]!;
    r.sync().dirty[l.id] = true;
    await r.engine.push([{ ...l, name: "Trek films", public: true }]);
    expect(r.lists.get(id)).toMatchObject({ name: "Trek films", isPublic: true });
    r.sync().deleted[l.id] = T0;
    await r.engine.push([]);
    expect(r.lists.has(id)).toBe(true);   // within the window
    r.tick(DELETE_GRACE_MS + 1);
    await r.engine.push([]);
    expect(r.lists.has(id)).toBe(false);
    expect(r.sync().remote[l.id]).toBeUndefined();
  });
});
