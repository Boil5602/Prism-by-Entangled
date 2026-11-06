import { describe, expect, it } from "vitest";
import { addItems, excludeItems, firstOpen, nextOpen, expandEpisodes, findPlaylists, itemKeyOf, markItems, moveBy, moveItems, pickerOf, playOrder, resolveService, viewOf, type PlItem, type Playlist } from "../src/playlist-store.js";
import { creditsWindow, inCredits, matchesItem, showsMatch, stepRun, type RunState } from "../src/playlist-play.js";
import { createPlaylists, type PlDeps, type PlEpisodes, type PlSvc } from "../src/playlists.js";

// docs/features/playlists.md (2026-09-27): the fixtures the feature names, over the pure store and play rules and the runtime part on fakes.

const T0 = 1_800_000_000_000;
const ep = (show: string, s: number, e: number, extra: Partial<PlItem> = {}): PlItem => {
  const base = { kind: "episode" as const, title: `${show} ${s}x${e}`, show, season: s, episode: e };
  return { ...base, key: itemKeyOf(base), services: [{ app: "hulu" }], addedAt: T0, ...extra };
};
const movie = (title: string, extra: Partial<PlItem> = {}): PlItem => ({ kind: "movie", title, key: itemKeyOf({ kind: "movie", title }), services: [{ app: "netflix" }], addedAt: T0, ...extra });
const pl = (items: PlItem[], extra: Partial<Playlist> = {}): Playlist => ({ id: "p1", name: "Mine", items, view: "manual", serviceOrder: [], createdAt: T0, updatedAt: T0, ...extra });
const keys = (xs: PlItem[]) => xs.map((i) => i.key);
const seasons = [
  { season: 0, episodes: [{ season: 0, episode: 1, title: "Special" }] },
  { season: 2, episodes: [{ season: 2, episode: 2, title: "B2" }, { season: 2, episode: 1, title: "B1" }] },
  { season: 1, episodes: [{ season: 1, episode: 1, title: "A1" }, { season: 1, episode: 2, title: "A2" }, { season: 1, episode: 3, title: "A3" }] },
];

describe("playlists - the store (pure)", () => {
  it("the series add is every episode but specials, in air order; the season add its episodes; the episode add exactly it; the rest of the season from it", () => {
    expect(expandEpisodes(seasons, "all").map((e) => e.title)).toEqual(["A1", "A2", "A3", "B1", "B2"]);
    expect(expandEpisodes(seasons, "season", 2).map((e) => e.title)).toEqual(["B1", "B2"]);
    expect(expandEpisodes(seasons, "episode", 1, 2).map((e) => e.title)).toEqual(["A2"]);
    expect(expandEpisodes(seasons, "rest", 1, 2).map((e) => e.title)).toEqual(["A2", "A3"]);
    expect(expandEpisodes(seasons, "episode", 0, 1).map((e) => e.title)).toEqual(["Special"]);   // a special added directly
  });
  it("adds land as one block - at the end, or at a position; duplicates are skipped and counted, their services merged into the one item", () => {
    const a = ep("Dark", 1, 1), b = ep("Dark", 1, 2), m = movie("Heat");
    let r = addItems(pl([m]), [a, b], T0);
    expect(keys(r.list.items)).toEqual([m.key, a.key, b.key]);
    r = addItems(pl([m, a]), [b], T0, 1);
    expect(keys(r.list.items)).toEqual([m.key, b.key, a.key]);
    r = addItems(pl([a]), [ep("Dark", 1, 1, { services: [{ app: "netflix", url: "https://n/1", id: "1" }] }), b], T0);
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(r.list.items[0]!.services.map((s) => s.app)).toEqual(["hulu", "netflix"]);   // the same show on two services: one item, both
  });
  it("the identity is the title itself: a card's show and Details' show are the same item (TMDB's id kept as data)", () => {
    expect(itemKeyOf({ kind: "episode", title: "x", show: "The Bear", season: 1, episode: 2, tmdb: "tv:136315" })).toBe(itemKeyOf({ kind: "episode", title: "y", show: "Bear", season: 1, episode: 2 }));
  });
  it("it plays on the first signed-in service in the playlist's order that has it; signed out moves it on; a pin overrides; not available only when none has it", () => {
    const i = ep("Dark", 1, 1, { services: [{ app: "hulu" }, { app: "netflix" }] });
    expect(resolveService(i, ["netflix", "hulu"], ["hulu", "netflix"])).toBe("netflix");
    expect(resolveService(i, ["netflix", "hulu"], ["hulu"])).toBe("hulu");
    expect(resolveService({ ...i, pin: "hulu" }, ["netflix", "hulu"], ["hulu", "netflix"])).toBe("hulu");
    expect(resolveService(i, ["netflix"], ["peacock"])).toBeNull();
    expect(resolveService({ ...i, mismatch: ["netflix"] }, ["netflix", "hulu"], ["hulu", "netflix"])).toBe("hulu");   // a flagged numbering is skipped
  });
  it("two shows interleaved in Manual keep that order; Grouped and back restores it exactly; completed items fade and sink, stable, in both views", () => {
    const items = [ep("A", 1, 1), ep("B", 1, 1), ep("A", 1, 2), ep("B", 1, 2), movie("Heat")];
    const l = pl(items);
    expect(keys(playOrder(l))).toEqual(keys(items));
    const grouped = { ...l, view: "show" as const };
    expect(viewOf(grouped).map((g) => [g.name, g.items.map((i) => i.title)])).toEqual([["A", ["A 1x1", "A 1x2"]], ["B", ["B 1x1", "B 1x2"]], ["Movies", ["Heat"]]]);
    expect(keys(playOrder({ ...grouped, view: "manual" }))).toEqual(keys(items));
    const done = markItems(l, [items[0]!.key, items[1]!.key], true, T0 + 1);
    expect(playOrder(done).map((i) => i.title)).toEqual(["A 1x2", "B 1x2", "Heat", "A 1x1", "B 1x1"]);
    expect(viewOf({ ...done, view: "show" })[0]!.items.map((i) => i.title)).toEqual(["A 1x2", "A 1x1"]);
  });
  it("an excluded episode dims to the bottom of its season (below the completed ones), is never played, and comes back where it was when included (2026-09-27)", () => {
    const items = [ep("A", 1, 1), ep("A", 1, 2), ep("A", 1, 3), ep("A", 2, 1)];
    let l = excludeItems({ ...pl(items), view: "show" }, [items[0]!.key], true, T0);
    l = markItems(l, [items[1]!.key], true, T0);
    expect(viewOf(l).map((g) => [g.season, g.items.map((i) => i.title)])).toEqual([[1, ["A 1x3", "A 1x2", "A 1x1"]], [2, ["A 2x1"]]]);
    expect(firstOpen(l)!.title).toBe("A 1x3");
    expect(nextOpen(l, items[2]!.key)!.title).toBe("A 2x1");
    l = excludeItems(l, [items[0]!.key], false, T0);
    expect(viewOf(l)[0]!.items.map((i) => i.title)).toEqual(["A 1x1", "A 1x3", "A 1x2"]);
  });
  it("a season sent later lands among its show's own episodes in air order, not at the end; by show lists the shows A to Z, a season to a head (2026-09-27)", () => {
    const s1 = [ep("Voyager", 1, 1), ep("Voyager", 1, 2)];
    let l = addItems(pl([...s1, movie("Heat")]), [ep("Enterprise", 1, 1)], T0).list;
    l = addItems(l, [ep("Voyager", 2, 1), ep("Voyager", 2, 2)], T0).list;
    expect(l.items.map((i) => i.title)).toEqual(["Voyager 1x1", "Voyager 1x2", "Voyager 2x1", "Voyager 2x2", "Heat", "Enterprise 1x1"]);
    expect(viewOf({ ...l, view: "show" }).map((g) => g.name + ":" + g.season)).toEqual(["Enterprise:1", "Voyager:1", "Voyager:2", "Movies:null"]);
  });
  it("the Release date view (2026-09-27): episodes by air date and movies by release date, oldest first; an undated episode stays among its show's own; undated movies last; the manual order untouched", () => {
    const items = [movie("Beyond", { airDate: "2016-07-22" }), ep("TOS", 1, 2, { airDate: "1966-09-15" }), ep("TOS", 1, 3), movie("Unknown"), ep("TOS", 1, 1, { airDate: "1966-09-08" }), movie("TMP", { airDate: "1979" }), ep("TOS", 1, 4, { airDate: "1966-09-29" })];
    const l = { ...pl(items), view: "released" as const };
    expect(playOrder(l).map((i) => i.title)).toEqual(["TOS 1x1", "TOS 1x2", "TOS 1x3", "TOS 1x4", "TMP", "Beyond", "Unknown"]);
    expect(keys(playOrder({ ...l, view: "manual" }))).toEqual(keys(items));
  });
  it("a playlist kept under a view comes back in that order, for good (the views became sorts, 2026-09-27)", async () => {
    const { storeOf } = await import("../src/playlist-store.js");
    const items = [ep("B", 1, 1), ep("A", 1, 2), ep("A", 1, 1)];
    const st = storeOf({ lists: [{ ...pl(items), view: "show" }], open: "p1", recent: [] });
    expect(st.lists[0]!.view).toBe("manual");
    expect(st.lists[0]!.items.map((i) => i.title)).toEqual(["A 1x1", "A 1x2", "B 1x1"]);
  });
  it("un-marking puts the item at the end of the not-completed section", () => {
    const items = [ep("A", 1, 1), ep("A", 1, 2), ep("A", 1, 3), ep("A", 1, 4)];
    let l = markItems(pl(items), [items[0]!.key, items[3]!.key], true, T0);
    l = markItems(l, [items[0]!.key], false, T0 + 1);
    expect(l.items.map((i) => i.title)).toEqual(["A 1x2", "A 1x3", "A 1x1", "A 1x4"]);
  });
  it("drag-style moves and the remote's moves give the same order; a run of items moves together", () => {
    const items = [ep("A", 1, 1), ep("A", 1, 2), ep("A", 1, 3), ep("A", 1, 4), ep("A", 1, 5)];
    const run = [items[1]!.key, items[2]!.key];
    const byMove = moveItems(pl(items), run, 5, T0);
    const byRemote = moveBy(pl(items), run, 4, T0);
    expect(byMove.items.map((i) => i.title)).toEqual(["A 1x1", "A 1x4", "A 1x5", "A 1x2", "A 1x3"]);
    expect(byRemote.items.map((i) => i.title)).toEqual(byMove.items.map((i) => i.title));
    expect(moveBy(pl(items), [items[4]!.key], "top", T0).items[0]!.title).toBe("A 1x5");
    expect(moveBy(pl(items), [items[0]!.key], "down", T0).items.map((i) => i.title).slice(0, 2)).toEqual(["A 1x2", "A 1x1"]);
  });
  it("the filter matches playlist names and the titles inside; the picker lists the open playlist first, then recent ones", () => {
    const lists = [pl([ep("Severance", 1, 1)], { id: "a", name: "Work nights", updatedAt: T0 }), pl([movie("Heat")], { id: "b", name: "Severance binge", updatedAt: T0 + 5 }), pl([], { id: "c", name: "Empty" })];
    expect(findPlaylists(lists, "severance", "name").map((l) => l.id)).toEqual(["b", "a"]);
    expect(findPlaylists(lists, "heat", "updated").map((l) => l.id)).toEqual(["b"]);
    expect(pickerOf({ lists, open: "c", recent: ["a", "c", "b"] }).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("playlists - played to its end (the credits window)", () => {
  it("a movie's last 8% (3 to 10 minutes), an episode's last 12% (30 s to 7 min)", () => {
    expect(creditsWindow("movie", 7200)).toBe(576);
    expect(creditsWindow("movie", 1200)).toBe(180);
    expect(creditsWindow("movie", 12000)).toBe(600);
    expect(creditsWindow("episode", 1320)).toBeCloseTo(158.4);
    expect(creditsWindow("episode", 200)).toBe(30);
    expect(creditsWindow("episode", 4200)).toBe(420);
    expect(inCredits("episode", 3300, 3600)).toBe(true);
    expect(inCredits("episode", 2400, 3600)).toBe(false);
    expect(inCredits("episode", 20, 30)).toBe(false);   // an ad's own clock is no title's credits (2026-09-28 review)
  });

  it("a movie is never matched by an episode that shares its name (2026-09-28 review)", () => {
    expect(matchesItem({ kind: "movie", title: "Home" }, movie("Home"))).toBe(true);
    expect(matchesItem({ kind: "episode", series: "Some Show", title: "Home", season: 2, episode: 4 }, movie("Home"))).toBe(false);
  });
});

describe("playlists - continuous play (the rules)", () => {
  it("the service's name for a show matches the playlist's: 'Star Trek: The Original Series (Remastered)' is 'Star Trek' (2026-09-27)", () => {
    expect(showsMatch("Star Trek: The Original Series (Remastered)", "Star Trek")).toBe(true);
    expect(showsMatch("Star Trek: The Animated Series", "Star Trek (1973)")).toBe(true);
    expect(showsMatch("Star Trekkers", "Star Trek")).toBe(false);
    expect(matchesItem({ kind: "episode", series: "Star Trek: The Original Series (Remastered)", season: 1, episode: 5, title: "The Naked Time" }, { ...ep("Star Trek", 1, 5), title: "The Naked Time" })).toBe(true);
    expect(matchesItem({ kind: "episode", series: "Star Trek: The Original Series (Remastered)", season: 1, episode: 6, title: "x" }, ep("Star Trek", 1, 5))).toBe(false);
    // by title before numbers: the player's S1 E5 "The Naked Time" is the playlist's S1 E4 "The Naked Time", not its S1 E5 "The Enemy Within"
    const naked = { ...ep("Star Trek", 1, 4), title: "The Naked Time" }, enemy = { ...ep("Star Trek", 1, 5), title: "The Enemy Within" };
    const playing = { kind: "episode", series: "Star Trek: The Original Series (Remastered)", season: 1, episode: 5, title: "The Naked Time" };
    expect(matchesItem(playing, naked)).toBe(true);
    expect(matchesItem(playing, enemy)).toBe(false);
    expect(matchesItem({ ...playing, title: "The Menagerie, Part 1" }, { ...ep("Star Trek", 1, 11), title: "The Menagerie (1)" })).toBe(true);
  });
  const cur = ep("Dark", 1, 1), nxt = ep("Dark", 1, 2);
  const run0: RunState = { listId: "p1", key: cur.key, tile: "screen", seen: false, near: false, ended: false, stopAfter: false, waiting: false, goneAt: null, startedAt: T0 };
  const playing = (e: number, position: number) => ({ pending: false, playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: e, title: "Dark 1x" + e, position, duration: 3600 } });
  it("played to its end, then gone: advance (after the autoplay grace); left early: the run ends, not marked", () => {
    let r = stepRun(run0, playing(1, 3400), cur, nxt, T0);
    expect(r.run).toMatchObject({ seen: true, near: true });
    const gone = { pending: false, playing: false, video: null };
    let s = stepRun(r.run, gone, cur, nxt, T0 + 1000);
    expect(s.step.do).toBe("wait");
    s = stepRun(s.run, gone, cur, nxt, T0 + 10_000);
    expect(s.step).toEqual({ do: "advance", keep: false });
    r = stepRun(run0, playing(1, 1200), cur, nxt, T0);
    expect(stepRun(r.run, gone, cur, nxt, T0 + 1000).step).toEqual({ do: "end", completed: false, why: "left the player" });
  });
  it("the service's autoplay into our next item is kept; into anything else, the playlist's next item instead", () => {
    const r = stepRun(run0, playing(1, 3500), cur, nxt, T0);
    expect(stepRun(r.run, playing(2, 5), cur, nxt, T0 + 1).step).toEqual({ do: "advance", keep: true });
    expect(stepRun(r.run, playing(7, 5), cur, nxt, T0 + 1).step).toEqual({ do: "advance", keep: false });
  });
  it("stop after this one ends the run when the item finishes, marked; a pick still starting decides nothing", () => {
    const r = stepRun({ ...run0, stopAfter: true }, playing(1, 3500), cur, nxt, T0);
    expect(stepRun(r.run, { pending: false, playing: false, video: null }, cur, nxt, T0 + 1).step).toEqual({ do: "end", completed: true, why: "stopped after this one" });
    expect(stepRun(run0, { pending: true, playing: false, video: null }, cur, nxt, T0).step).toEqual({ do: "none" });
  });
});

// ---- the runtime part on fakes
function rig(opts: { lists?: Record<string, PlEpisodes>; signedIn?: string[]; dates?: Record<string, Array<{ season: number; episode: number; airDate: string }>>; byId?: Record<number, Array<{ season: number; episodes: Array<{ episode: number; title: string; still: string | null; airDate: string | null }> }>>; alts?: Record<number, string[]> } = {}) {
  const kv = new Map<string, string>();
  const plays: Array<{ how: string; app?: string; url?: string; title: string }> = [];
  let now = T0;
  let presets: { presets: Array<{ id: string }>; active: string | null } = { presets: [], active: null };
  const ins = opts.signedIn ?? ["hulu", "netflix"];
  const svcs: PlSvc[] = ["netflix", "hulu", "peacock"].map((app) => ({ app, name: app[0]!.toUpperCase() + app.slice(1), facet: app + "-f", adapter: app, status: ins.includes(app) ? "signed-in" : "signed-out" }));
  let screenState: { playing?: boolean; video?: Record<string, unknown> | null; pending?: { failed?: unknown } | null } | null = null;
  const timers: Array<() => void> = [];
  const paused: string[] = [];
  const myList: ReturnType<PlDeps["myList"]> = [];
  const deps: PlDeps = {
    read: (k) => kv.get(k) ?? null, write: (k, v) => void kv.set(k, v),
    presets: () => presets, services: () => svcs, screen: () => "screen", state: () => screenState,
    playOn: (facet, _kind, _id, url, name) => { plays.push({ how: "address", app: facet.replace(/-f$/, ""), url, title: name }); return { ok: true }; },
    playCatalog: (s, title) => { plays.push({ how: "search", app: s.app, title }); return { ok: true }; },
    episodesOf: (s, series) => opts.lists?.[s.app + "|" + series] ?? { ready: true, seasons: [], error: "no list" },
    episodeByNumber: (app, series, sn, en) => { const v = opts.lists?.[app + "|" + series]; const e = v?.seasons.find((x) => x.season === sn)?.episodes.find((x) => x.episode === en); return e ? { id: e.id, url: e.url, title: e.title, airDate: e.airDate ?? null } : null; },
    myList: () => myList, onEndOf: () => "none", pause: (id) => void paused.push(id), now: () => now,
    ...(opts.dates ? { airDatesOf: async (show: string) => opts.dates![show] ?? null } : {}),
    ...(opts.byId ? { tvSeasonsById: async (id: number) => opts.byId![id] ?? null } : {}),
    ...(opts.alts ? { altTitlesOf: async (id: number) => opts.alts![id] ?? [] } : {}),
    later: (fn) => void timers.push(fn), sleep: async () => {}, report: () => {},
  };
  const p = createPlaylists(deps);
  return { p, kv, plays, paused, myList, setNow: (t: number) => { now = t; }, setPresets: (v: typeof presets) => { presets = v; }, setScreen: (v: typeof screenState) => { screenState = v; }, timers };
}
const darkList: PlEpisodes = { ready: true, seasons: [
  { season: 1, episodes: [1, 2, 3].map((e) => ({ season: 1, episode: e, title: "D1-" + e, id: "h1" + e, url: "https://www.hulu.com/watch/h1" + e, airDate: "2017-12-0" + e })) },
  { season: 0, episodes: [{ season: 0, episode: 1, title: "Behind", id: "h01", url: "https://www.hulu.com/watch/h01" }] },
] };
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("playlists - the runtime part", () => {
  it("a show sent from a card (details never opened) gives the same episodes, in the same order, as from details; duplicates reported", async () => {
    const { p } = rig({ lists: { "hulu|Dark": darkList } });
    const j1 = p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" }).job;
    await settle();
    expect(p.job(j1)).toMatchObject({ status: "done", added: 3, skipped: 0 });
    const id = p.view().open!.id;
    const j2 = p.send({ id }, { type: "series", show: "Dark", app: "hulu", services: ["hulu", "netflix"], scope: "season", season: 1 }).job;
    await settle();
    expect(p.job(j2)).toMatchObject({ status: "done", added: 0, skipped: 3 });
    expect(p.job(j2).message).toContain("3 already in this playlist");
    expect(p.view().open!.groups[0]!.items.map((i) => i.title)).toEqual(["D1-1", "D1-2", "D1-3"]);
    expect(p.view().open!.groups[0]!.items[0]!.services.map((s) => s.app)).toEqual(["hulu", "netflix"]);
  });
  it("episodes a service listed without air dates take TMDB's, at add time and for shows already in a playlist; a release-date sort then puts them in place (2026-09-27, Voyager)", async () => {
    const noDates: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [1, 2].map((e) => ({ season: 1, episode: e, title: "V" + e, id: "v" + e, url: "u" + e })) }] };
    const dates = { Voyager: [{ season: 1, episode: 1, airDate: "1995-01-16" }, { season: 1, episode: 2, airDate: "1995-01-23" }] };
    const r = rig({ lists: { "hulu|Voyager": noDates }, dates });
    r.p.send({ newName: "V" }, { type: "series", show: "Voyager", app: "hulu", scope: "all" });
    await settle(); await settle();
    expect(r.p.view().open!.groups.flatMap((g) => g.items).map((i) => i.airDate)).toEqual(["1995-01-16", "1995-01-23"]);
    // a playlist saved before: undated items in the store are dated from TMDB
    const st = JSON.parse(r.kv.get("video:playlists")!);
    st.lists[0].items = st.lists[0].items.map((i: Record<string, unknown>) => ({ ...i, airDate: null }));
    st.lists[0].items.push({ key: "m:heat", kind: "movie", title: "Heat", airDate: "1995-12-15", services: [{ app: "netflix" }], addedAt: 0 });
    st.lists[0].items.unshift({ key: "m:alien", kind: "movie", title: "Alien", airDate: "1979-05-25", services: [{ app: "netflix" }], addedAt: 0 });
    r.kv.set("video:playlists", JSON.stringify(st));
    await r.p.fillAllDates();
    const id = r.p.view().open!.id;
    r.p.edit(id, { op: "sort", by: "released" });
    expect(r.p.view().open!.groups.flatMap((g) => g.items).map((i) => i.title)).toEqual(["Alien", "V1", "V2", "Heat"]);
  });
  it("a whole series sent is followed: episodes that come out later are added among the show's own (next up when the rest are watched); a removed one never comes back; unfollowing stops it (2026-09-27)", async () => {
    const lists: Record<string, PlEpisodes> = { "hulu|Dark": { ready: true, seasons: [{ season: 1, episodes: [1, 2].map((e) => ({ season: 1, episode: e, title: "D" + e, id: "d" + e, url: "u" + e })) }] } };
    const r = rig({ lists });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const id = r.p.view().open!.id;
    expect(r.p.view().open!.follows).toEqual(["Dark"]);
    const titles = () => r.p.view().open!.groups.flatMap((g) => g.items).map((i) => i.title + (i.completed ? "*" : ""));
    r.p.edit(id, { op: "mark", keys: r.p.view().open!.groups.flatMap((g) => g.items).map((i) => i.key) });
    r.p.edit(id, { op: "remove", key: r.p.view().open!.groups.flatMap((g) => g.items)[1]!.key });   // D2 removed by the person
    lists["hulu|Dark"] = { ready: true, seasons: [{ season: 1, episodes: [1, 2, 3].map((e) => ({ season: 1, episode: e, title: "D" + e, id: "d" + e, url: "u" + e })) }, { season: 2, episodes: [{ season: 2, episode: 1, title: "E1", id: "e1", url: "ue1" }] }] };
    expect(await r.p.checkFollowsNow()).toBe(2);
    expect(titles()).toEqual(["D3", "E1", "D1*"]);   // the new ones on top, D2 not back
    expect(r.p.view().news).toMatchObject([{ show: "Dark", count: 2 }]);
    r.p.edit(id, { op: "follow", key: r.p.view().open!.groups.flatMap((g) => g.items)[0]!.key, on: false });
    lists["hulu|Dark"]!.seasons[1]!.episodes.push({ season: 2, episode: 2, title: "E2", id: "e2", url: "ue2" });
    expect(await r.p.checkFollowsNow()).toBe(0);
    expect(r.p.view().open!.follows).toEqual([]);
  });
  it("following a show added in part takes only what comes out from then on", async () => {
    const lists: Record<string, PlEpisodes> = { "hulu|Dark": { ready: true, seasons: [{ season: 1, episodes: [1, 2, 3].map((e) => ({ season: 1, episode: e, title: "D" + e, id: "d" + e, url: "u" + e })) }] } };
    const r = rig({ lists });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "episode", season: 1, episode: 1 });
    await settle();
    const id = r.p.view().open!.id;
    expect(r.p.view().open!.follows).toEqual([]);
    r.p.edit(id, { op: "follow", key: r.p.view().open!.groups[0]!.items[0]!.key, on: true });
    expect(await r.p.checkFollowsNow()).toBe(0);   // D2, D3 were out already: not added
    lists["hulu|Dark"]!.seasons[0]!.episodes.push({ season: 1, episode: 4, title: "D4", id: "d4", url: "u4" });
    expect(await r.p.checkFollowsNow()).toBe(1);
    expect(r.p.view().open!.groups.flatMap((g) => g.items).map((i) => i.title)).toEqual(["D1", "D4"]);
  });
  it("two shows of one name are told apart by TMDB's id: the 1973 'Star Trek' beside the 1966 one is 'Star Trek (1973)', its episodes TMDB's when the service's list is the other show's (2026-09-27)", async () => {
    const tos: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [1, 2].map((e) => ({ season: 1, episode: e, title: "TOS" + e, id: "t" + e, url: "u" + e, airDate: "1966-09-0" + e })) }] };
    const r = rig({ lists: { "hulu|Star Trek": tos }, byId: { 1992: [{ season: 1, episodes: [{ episode: 1, title: "Beyond the Farthest Star", still: null, airDate: "1973-09-08" }, { episode: 2, title: "Yesteryear", still: null, airDate: "1973-09-15" }] }] } });
    r.p.send({ newName: "Trek" }, { type: "series", show: "Star Trek", app: "hulu", scope: "all", tmdb: "tv:253", year: 1966 });
    await settle();
    const id = r.p.view().open!.id;
    const j = r.p.send({ id }, { type: "series", show: "Star Trek", app: "hulu", scope: "all", tmdb: "tv:1992", year: 1973 }).job;
    await settle(); await settle();
    expect(r.p.job(j)).toMatchObject({ status: "done", added: 2, skipped: 0 });
    const items = r.p.view().open!.groups.flatMap((g) => g.items);
    expect(items.map((i) => i.show + ": " + i.title)).toEqual(["Star Trek: TOS1", "Star Trek: TOS2", "Star Trek (1973): Beyond the Farthest Star", "Star Trek (1973): Yesteryear"]);
  });
  it("the service's own name for a same-named show (TMDB's other names, the one whose years match) gives its list with addresses; a re-send fills the links into items already there (2026-09-27)", async () => {
    const tos: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [1, 2].map((e) => ({ season: 1, episode: e, title: "TOS" + e, id: "t" + e, url: "u" + e, airDate: "1966-09-0" + e })) }] };
    const tas: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [{ season: 1, episode: 1, title: "Beyond the Farthest Star", id: "a1", url: "https://p/a1", airDate: "1973-09-08" }] }] };
    const noLinks: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [{ season: 1, episode: 1, title: "Beyond the Farthest Star", id: null, url: null, airDate: "1973-09-08" }] }] };   // a TMDB fill-in under a wrong name
    const r = rig({ lists: { "hulu|Star Trek": tos, "hulu|Star Trek: The Animated Adventures": noLinks, "hulu|Star Trek: The Animated Series": tas }, alts: { 1992: ["Star Trek: The Animated Adventures", "Star Trek: The Animated Series"] } });
    r.p.send({ newName: "Trek" }, { type: "series", show: "Star Trek", app: "hulu", scope: "all" });   // from a card: no TMDB id, no year
    await settle();
    const id = r.p.view().open!.id;
    r.p.send({ id }, { type: "series", show: "Star Trek", app: "hulu", scope: "all", tmdb: "tv:1992", year: 1973 });
    await settle(); await settle(); await settle();
    const a1 = r.p.view().open!.groups.flatMap((g) => g.items).find((i) => i.show === "Star Trek (1973)")!;
    expect(a1.title).toBe("Beyond the Farthest Star");
    r.p.play(id, a1.key);
    expect(r.plays.at(-1)).toMatchObject({ how: "address", url: "https://p/a1" });
    expect(r.p.view().open!.follows).toEqual(["Star Trek", "Star Trek (1973)"]);
  });
  it("a run carries on across a restart: kept on the device, read back by a new instance (2026-09-27)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    r.p.play(r.p.view().open!.id);
    expect(r.p.runNow()).not.toBeNull();
    const again = createPlaylists({ read: (k) => r.kv.get(k) ?? null, write: (k, v) => void r.kv.set(k, v), presets: () => ({ presets: [], active: null }), services: () => [], screen: () => null, state: () => null, playOn: () => ({}), playCatalog: () => ({}), episodesOf: () => ({ ready: true, seasons: [] }), episodeByNumber: () => null, myList: () => [], onEndOf: () => "none", now: () => T0 + 60_000, later: () => {}, sleep: async () => {}, report: () => {} });
    expect(again.runNow()).toMatchObject({ key: r.p.runNow()!.key });
    r.p.stop("now");
    expect(createPlaylists({ read: (k) => r.kv.get(k) ?? null, write: () => {}, presets: () => ({ presets: [], active: null }), services: () => [], screen: () => null, state: () => null, playOn: () => ({}), playCatalog: () => ({}), episodesOf: () => ({ ready: true, seasons: [] }), episodeByNumber: () => null, myList: () => [], onEndOf: () => "none", now: () => T0, later: () => {}, sleep: async () => {}, report: () => {} }).runNow()).toBeNull();
  });
  it("Previous and Next move the run along the playlist; the ends say so (2026-09-29)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const items = r.p.view().open!.groups.flatMap((g) => g.items);
    r.p.play(r.p.view().open!.id);
    expect(r.p.view().run).toMatchObject({ index: 1, hasPrevious: false, hasNext: true });
    expect(r.p.move("previous")).toMatchObject({ ok: false });
    expect(r.p.move("next")).toMatchObject({ ok: true });
    expect(r.p.runNow()!.key).toBe(items[1]!.key);
    expect(r.p.view().open!.groups.flatMap((g) => g.items)[0]!.completedAt ?? null).toBeNull();   // the one left is not marked
    expect(r.p.move("previous")).toMatchObject({ ok: true });
    expect(r.p.runNow()!.key).toBe(items[0]!.key);
    r.p.stop("now");
    expect(r.p.move("next")).toMatchObject({ ok: false });
  });
  it("Stop pauses what the playlist put on the screen, and nothing else (2026-09-29)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const id = r.p.view().open!.id;
    r.p.play(id);
    r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 1, title: "D1-1", position: 300, duration: 3000 } });
    expect(r.p.stop("now")).toMatchObject({ ok: true, paused: true });
    expect(r.paused).toEqual(["screen"]);
    expect(r.p.runNow()).toBeNull();
    r.p.play(id);
    r.setScreen({ playing: true, video: { kind: "movie", title: "Another Film", position: 300, duration: 3000 } });   // the person's own pick
    expect(r.p.stop("now")).toMatchObject({ ok: true, paused: false });
    expect(r.paused).toEqual(["screen"]);
  });
  it("the last episode watched is flagged, from the playlist or not; Play starts there, or after it when it finished (2026-09-27)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const id = r.p.view().open!.id;
    // watched outside the playlist: episode 2, part way
    r.setScreen({ playing: true, video: { kind: "episode", series: "Dark: The Series", season: 1, episode: 2, title: "D1-2", position: 300, duration: 3000 } });
    r.p.step("screen", false);
    expect(r.p.view().open!.lastKey).toBe(r.p.view().open!.groups[0]!.items[1]!.key);
    expect(r.p.view().lists[0]!.resume).toMatchObject({ title: "D1-2", last: true });
    r.p.play(id);
    expect(r.plays.at(-1)).toMatchObject({ url: "https://www.hulu.com/watch/h12" });
    r.p.stop("now");
    // it plays into its credits: completed, and Play goes on to the next
    r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 2, title: "D1-2", position: 2950, duration: 3000 } });
    r.p.step("screen", false);
    expect(r.p.view().open!.groups[0]!.items.find((i) => i.title === "D1-2")!.completed).toBe(true);
    expect(r.p.view().lists[0]!.resume).toMatchObject({ title: "D1-3", last: false });
  });
  it("an episode counts as watched at ten minutes in (the playlist's count only); Play still carries on with it until it plays to its end (2026-09-27)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const at = (pos: number) => { r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 1, title: "D1-1", position: pos, duration: 3000 } }); r.p.step("screen", false); };
    at(540);
    expect(r.p.view().lists[0]!.progress).toEqual({ done: 0, total: 3 });
    at(605);
    expect(r.p.view().lists[0]!.progress).toEqual({ done: 1, total: 3 });
    expect(r.p.view().lists[0]!.resume).toMatchObject({ title: "D1-1", last: true });   // watched, not finished: Play carries on with it
    at(2950);
    expect(r.p.view().lists[0]!.resume).toMatchObject({ title: "D1-2" });   // played to its credits: Play goes on
  });
  it("the extra checks: a skip past ten minutes counts at once and a skip back undoes nothing; a short episode at 60%; a later episode starting after five minutes of this one marks it (2026-09-27)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const at = (e: number, pos: number, dur = 3000) => { r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: e, title: "D1-" + e, position: pos, duration: dur } }); r.p.step("screen", false); };
    const done = () => r.p.view().open!.groups.flatMap((g) => g.items).filter((i) => i.completed).map((i) => i.title);
    at(1, 30); at(1, 900); at(1, 60);   // skipped ahead to 15:00, then back to 1:00
    expect(done()).toEqual(["D1-1"]);
    at(2, 200); at(2, 320);             // five minutes and more of episode 2 ...
    at(3, 10);                          // ... then episode 3 starts
    expect(done().sort()).toEqual(["D1-1", "D1-2"]);
    const short = rig({ lists: { "hulu|Dark": darkList } });
    short.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    short.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 1, title: "D1-1", position: 400, duration: 660 } });   // an 11-minute episode, 6:40 in
    short.p.step("screen", false);
    expect(short.p.view().open!.groups.flatMap((g) => g.items).filter((i) => i.completed).map((i) => i.title)).toEqual(["D1-1"]);
  });
  it("an ad's end is not the episode's end: 'ended' counts only in the episode's last tenth and outside an ad (2026-09-27)", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    r.p.play(r.p.view().open!.id);
    r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 1, title: "D1-1", position: 1560, duration: 3000 } });
    r.p.step("screen", false);
    r.p.step("screen", true);   // an ad's end, 26 minutes in
    expect(r.p.view().lists[0]!.resume).toMatchObject({ title: "D1-1", last: true });   // still carries on with it
    const played = r.plays.length;
    r.setScreen({ playing: false, video: null });
    r.p.step("screen", false);
    expect(r.plays.length).toBe(played);   // and nothing moved on
  });
  it("an add over 100 episodes asks first", async () => {
    const big: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: Array.from({ length: 120 }, (_, n) => ({ season: 1, episode: n + 1, title: "E" + (n + 1), id: "x" + n, url: "u" + n })) }] };
    const { p } = rig({ lists: { "hulu|Long": big } });
    const j = p.send({ newName: "Long" }, { type: "series", show: "Long", app: "hulu", scope: "all" }).job;
    await settle();
    expect(p.job(j)).toMatchObject({ status: "confirm", count: 120 });
    p.confirm(j, true);
    expect(p.job(j)).toMatchObject({ status: "done", added: 120 });
  });
  it("playlists are the profile set's: the shared store until a set exists, then moved to the first; each set its own", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.create("Before sets");
    r.setPresets({ presets: [{ id: "pa" }, { id: "ps" }], active: "ps" });
    expect(r.p.view().lists).toEqual([]);   // Sam: none
    r.p.create("Sam's");
    r.setPresets({ presets: [{ id: "pa" }, { id: "ps" }], active: "pa" });
    expect(r.p.view().lists.map((l) => l.name)).toEqual(["Before sets"]);
    expect(JSON.parse(r.kv.get("video:playlists:ps")!).lists.map((l: { name: string }) => l.name)).toEqual(["Sam's"]);
  });
  it("Play resumes at the first not-completed item on its resolved service; an item that plays to its end is marked and the next starts; left early is not marked", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", scope: "all" });
    await settle();
    const id = r.p.view().open!.id;
    r.p.edit(id, { op: "mark", keys: [r.p.view().open!.groups[0]!.items[0]!.key] });
    expect(r.p.play(id)).toMatchObject({ ok: true, app: "hulu" });
    expect(r.plays.at(-1)).toMatchObject({ how: "address", url: "https://www.hulu.com/watch/h12" });
    r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 2, title: "D1-2", position: 2900, duration: 3000 } });
    r.p.step("screen", false);
    r.setScreen({ playing: false, video: null });
    r.p.step("screen", false);
    r.setNow(T0 + 20_000);
    r.p.step("screen", false);
    expect(r.plays.at(-1)).toMatchObject({ url: "https://www.hulu.com/watch/h13" });
    expect(r.p.view().open!.groups[0]!.items.filter((i) => i.completed).map((i) => i.title)).toEqual(["D1-1", "D1-2"]);
    expect(r.p.view().undo).toMatchObject({ label: "D1-2 marked completed" });
    // left early: not marked, the run ends
    r.setScreen({ playing: true, video: { kind: "episode", series: "Dark", season: 1, episode: 3, title: "D1-3", position: 100, duration: 3000 } });
    r.p.step("screen", false);
    r.setScreen({ playing: false, video: null });
    r.p.step("screen", false);
    expect(r.p.runNow()).toBeNull();
    expect(r.p.view().open!.groups[0]!.items.find((i) => i.title === "D1-3")!.completed).toBe(false);
  });
  it("an episode with no address falls back to the show on its service with a Next up note, and continuous play waits", async () => {
    const tm: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [{ season: 1, episode: 1, title: "Pilot", id: null, url: null }] }] };
    const r = rig({ lists: { "hulu|Paradise": tm } });
    r.p.send({ newName: "P" }, { type: "series", show: "Paradise", app: "hulu", scope: "all" });
    await settle();
    expect(r.p.play(r.p.view().open!.id)).toMatchObject({ ok: true, waiting: true });
    expect(r.plays.at(-1)).toMatchObject({ how: "search", title: "Paradise" });
    expect(r.p.view().run).toMatchObject({ waiting: true, note: "Next up: S1 E1 · Pilot" });
  });
  it("a numbering mismatch on another service is flagged, not guessed: the item plays where the numbers agree", async () => {
    const other: PlEpisodes = { ready: true, seasons: [{ season: 1, episodes: [{ season: 1, episode: 2, title: "Different", id: "n12", url: "https://n/12", airDate: "2019-01-01" }] }] };
    const r = rig({ lists: { "hulu|Dark": darkList, "netflix|Dark": other } });
    r.p.send({ newName: "Dark" }, { type: "series", show: "Dark", app: "hulu", services: ["hulu", "netflix"], scope: "episode", season: 1, episode: 2 });
    await settle();
    const v = r.p.view().open!;
    const key = v.groups[0]!.items[0]!.key;
    // hulu's own address is on the item, so netflix is only asked when it comes first: put it first and drop hulu's address
    r.p.edit(v.id, { op: "order", apps: ["netflix", "hulu"] });
    const st = JSON.parse(r.kv.get("video:playlists")!); st.lists[0].items[0].services = [{ app: "hulu" }, { app: "netflix" }]; r.kv.set("video:playlists", JSON.stringify(st));
    r.p.play(v.id, key);
    expect(r.plays.at(-1)).toMatchObject({ app: "hulu", url: "https://www.hulu.com/watch/h12" });
    expect(r.p.view().open!.groups[0]!.items[0]!.mismatch).toEqual(["Netflix"]);
  });
  it("Import My List copies once: a later My List change leaves the playlist as it was, and nothing is written to a service", async () => {
    const r = rig({ lists: { "hulu|Dark": darkList } });
    r.myList.push({ app: "hulu", service: "Hulu", item: { id: "d", title: "Dark", kind: "series" } }, { app: "netflix", service: "Netflix", item: { id: "h", title: "Heat", kind: "movie", url: "https://n/h" } });
    const j = r.p.importMyList({ newName: "From My List" }, ["hulu", "netflix"], "s1").job;
    await settle(); await settle();
    expect(r.p.job(j)).toMatchObject({ status: "done", added: 4 });
    r.myList.length = 0;
    expect(r.p.view().open!.groups.flatMap((g) => g.items).length).toBe(4);
    expect(r.plays).toEqual([]);   // reading only: no play, no press
  });
  it("a sort is the playlist's own order, for good, and Play follows it; undo puts the order back; delete has a working undo (2026-09-27)", async () => {
    const r = rig();
    const id = r.p.create("X").id;
    r.p.send({ id }, { type: "movie", title: "Heat", services: [{ app: "netflix" }] });
    await settle();
    r.p.send({ id }, { type: "movie", title: "Alien", services: [{ app: "netflix" }] });
    await settle();
    expect(r.p.edit(id, { op: "sort", by: "show" })).toEqual({ ok: true });
    expect(r.p.view().open!.groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(["Alien", "Heat"]);
    expect(r.p.view().open!.manual).toBe(true);
    expect(r.p.edit(id, { op: "moveBy", key: "m:heat", how: "top" })).toEqual({ ok: true });   // reordering always works
    r.p.undo();   // the order before the sort
    expect(r.p.view().open!.groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(["Heat", "Alien"]);
    r.p.remove(id);
    expect(r.p.view().lists).toEqual([]);
    r.p.undo();
    expect(r.p.view().lists.map((l) => l.name)).toEqual(["X"]);
  });
});
