import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../src/runtime.js";
import { splitEpisodeTitle } from "../src/video.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// docs/video-menu-spec.md, Phase 2 (2026-09-19): the universal menu over the video player that exists. Fixtures the work
// order names: the recency merge order; lastWatched never synthesized; a service with no menu contract still plays; the
// menu never calls a service API; the ordering is pure over the §4 inputs (menu-order.test.ts); the local watch log
// reaches no network payload.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const net: string[] = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: (id, muted) => void ops.push({ op: "mute", id, muted }), setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    net: { fetch: async (url: string) => { net.push(url); throw new Error("the menu never calls a service"); } } as never,
  };
  return { ops, store, net, drivers };
}
const FHD = { w: 1920, h: 1080 };
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const item = (id: string, title: string, url: string) => ({ id, title, kind: "title", url });
const injects = (ops: Array<Record<string, unknown>>, id: string, fn: string) => ops.filter((o) => o.op === "inject" && o.id === id && String(o.js).includes(fn));

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {
    netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoLibrary: "/*l*/", videoSearchUrl: "https://www.netflix.com/search?q={q}", videoTune: "/*tune*/" },
    hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoLibrary: "/*l*/", videoLive: "/*live*/", videoSearch: "/*search*/" },
    tubi: { match: ["tubitv.com"], session: { signedIn: ".a", signedOut: ".b" } },   // no menu contract at all
  } }));
  await vi.advanceTimersByTimeAsync(50);
  for (const a of [
    { id: "netflix", name: "Netflix", baseUrl: "https://www.netflix.com/browse", profileId: "netflix", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "tubi", name: "Tubi", baseUrl: "https://tubitv.com/home", profileId: "tubi", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
  ]) expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
  for (const f of [
    { id: "nf", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home" },
    { id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" },
    { id: "tb", app: "tubi", url: "https://tubitv.com/home", slotClass: "16:9·XL", label: "Home" },
  ]) expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(f))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: FHD, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "nf" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  return { ...r, rt };
}
const report = (rt: ReturnType<typeof createRuntime>, id: string, info: unknown) => rt.event(JSON.stringify({ type: "now-playing", id, info }));

describe("the universal video menu (video-menu-spec §2-§4)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("groups Continue Watching by service (2026-09-26): each service's row in its own order, the services A to Z; a play the wall saw keeps its real time and moves nothing; lastWatched never synthesized", async () => {
    const { rt } = await setup();
    rt.videoRowOrder("continue", "service");   // grouped (A to Z is the default)
    // Netflix on the screen reports its rows; then Hulu is up and reports its own
    report(rt, "screen", { playing: false, videoLibrary: { continue: [item("n1", "Dark", "https://www.netflix.com/watch/n1"), item("n2", "Heat", "https://www.netflix.com/watch/n2")], list: [item("n9", "Tires", "https://www.netflix.com/watch/n9")] } });
    await vi.advanceTimersByTimeAsync(50);
    rt.videoSwitch("hu");
    await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, videoLibrary: { continue: [item("h1", "The Bear", "https://www.hulu.com/watch/h1"), item("h2", "Shrill", "https://www.hulu.com/watch/h2")] } });
    await vi.advanceTimersByTimeAsync(50);
    let menu = JSON.parse(rt.videoMenu());
    // nothing played yet: Hulu's row as Hulu gives it, then Netflix's (A to Z); none carries a time
    expect(menu.continue.map((c: { item: { id: string } }) => c.item.id)).toEqual(["h1", "h2", "n1", "n2"]);
    expect(menu.continue.every((c: { lastWatched?: number }) => c.lastWatched === undefined)).toBe(true);
    expect(menu.continue.every((c: { recency: { kind: string } }) => c.recency.kind === "inferred")).toBe(true);
    expect(menu.list.map((c: { item: { id: string }; service: string }) => [c.item.id, c.service])).toEqual([["n9", "Netflix"]]);
    // Hulu plays Shrill: the log has it, exact - the card shows its real time and stays in Hulu's group, where Hulu puts it
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Shrill", id: "h2", url: "https://www.hulu.com/watch/h2", playing: true } });
    await vi.advanceTimersByTimeAsync(50);
    menu = JSON.parse(rt.videoMenu());
    expect(menu.continue.map((c: { item: { id: string } }) => c.item.id)).toEqual(["h1", "h2", "n1", "n2"]);
    expect(menu.continue[1]).toMatchObject({ item: { id: "h2" }, service: "Hulu", recency: { kind: "log", at: expect.any(Number) } });
    expect(menu.continue[1].lastWatched).toBe(menu.continue[1].recency.at);   // the one time a card shows is the log's, exactly
    expect([menu.continue[0], ...menu.continue.slice(2)].every((c: { lastWatched?: number }) => c.lastWatched === undefined)).toBe(true);
    expect(menu.log).toBe(1);
    // ten days on, the old first sights are no longer "recent": rank order, still no time invented
    vi.setSystemTime(1_800_000_000_000 + 10 * 24 * 3600_000);
    menu = JSON.parse(rt.videoMenu());
    expect(menu.continue.map((c: { item: { id: string }; recency: { kind: string } }) => [c.item.id, c.recency.kind])).toEqual([["h1", "rank"], ["h2", "log"], ["n1", "rank"], ["n2", "rank"]]);
  });

  it("each row's order is the person's choice, kept on the device (2026-09-26): My list New first (a banner leads), by service, A to Z; Continue watching A to Z or by service; each reversible", async () => {
    const { rt, store } = await setup();
    const it2 = (id: string, title: string, badge?: string) => ({ ...item(id, title, "https://www.netflix.com/watch/" + id), ...(badge ? { badge } : {}) });
    report(rt, "screen", { playing: false, videoLibrary: { continue: [it2("c1", "Zodiac"), it2("c2", "Arrival")], list: [it2("l1", "Yellowstone"), it2("l2", "Zorro", "New Season"), it2("l3", "Alien")] } });
    await vi.advanceTimersByTimeAsync(50);
    const ids = (k: "continue" | "list") => JSON.parse(rt.videoMenu())[k].map((c: { item: { id: string } }) => c.item.id);
    expect(JSON.parse(rt.videoMenu()).orders).toEqual({ continue: "title", list: "prism", continueReverse: false, listReverse: false });
    expect(ids("list")).toEqual(["l2", "l3", "l1"]);   // the bannered title first, then A to Z
    expect(ids("continue")).toEqual(["c2", "c1"]);     // A to Z
    rt.videoRowOrder("continue", "service");
    expect(ids("continue")).toEqual(["c2", "c1"]);     // one service: its titles A to Z
    expect(JSON.parse(rt.videoRowOrder("list", "service")).order).toBe("service");
    expect(ids("list")).toEqual(["l3", "l1", "l2"]);   // one service: its titles A to Z, the banner moves nothing
    rt.videoRowOrder("list", "title");
    expect(ids("list")).toEqual(["l3", "l1", "l2"]);   // A to Z, the banner moves nothing
    expect(JSON.parse(rt.videoRowOrder("list", null, "1")).reverse).toBe(true);
    expect(ids("list")).toEqual(["l2", "l1", "l3"]);   // Z to A
    rt.videoRowOrder("continue", "title");
    expect(ids("continue")).toEqual(["c2", "c1"]);
    expect(store.get("video:list-order")).toBe("title");
    expect(store.get("video:list-reverse")).toBe("1");
    expect(JSON.parse(rt.videoRowOrder("continue")).order).toBe("title");   // a null order reads it
    expect(JSON.parse(rt.videoRowOrder("list")).reverse).toBe(true);
    expect(JSON.parse(rt.videoRowOrder("list", "bogus")).order).toBe("prism");
  });

  it("the rows' orders and the Library sort are the profile set's (2026-09-27): each set its own, a set that never chose reads the shared one", async () => {
    const { rt, store } = await setup();
    rt.videoRowOrder("list", "title");   // no set yet: the shared value
    expect(store.get("video:list-order")).toBe("title");
    const sets = (active: string) => store.set("video:profile-presets", JSON.stringify({ presets: [{ id: "pa", name: "Alex", picks: {} }, { id: "ps", name: "Sam", picks: {} }], active, off: [] }));
    sets("pa");
    expect(JSON.parse(rt.videoMenu()).orders.list).toBe("title");   // Alex never chose: the shared one
    rt.videoRowOrder("continue", "service", "1");
    rt.videoRowOrder("list", "service");
    rt.videoLibraryTab("newest", null);
    expect(store.get("video:continue-order:pa")).toBe("service");
    expect(store.get("video:list-order")).toBe("title");   // the shared value untouched
    sets("ps");   // Sam: the shared values
    expect(JSON.parse(rt.videoMenu()).orders).toEqual({ continue: "title", list: "title", continueReverse: false, listReverse: false });
    expect(JSON.parse(rt.videoLibraryTab(null, null)).sort).not.toBe("newest");
    sets("pa");   // back to Alex: his own
    expect(JSON.parse(rt.videoMenu()).orders).toEqual({ continue: "service", list: "service", continueReverse: true, listReverse: false });
    expect(JSON.parse(rt.videoLibraryTab(null, null)).sort).toBe("newest");
  });

  it("playlists (2026-09-27): made and sent to on the runtime, and no network payload carries them (§22)", async () => {
    const { rt, net } = await setup();
    const id = JSON.parse(rt.playlistCreate("Secret Playlist Name")).id;
    JSON.parse(rt.playlistSend(JSON.stringify({ id }), JSON.stringify({ type: "movie", title: "Private Movie Title", services: [{ app: "netflix" }] })));
    await vi.advanceTimersByTimeAsync(50);
    rt.videoMenu(); rt.playlistsView(null, null, null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(JSON.parse(rt.playlistsView(null, null, null)).open.groups[0].items[0].title).toBe("Private Movie Title");
    expect(net.some((u) => /Secret|Private/.test(u))).toBe(false);
  });

  it("after a graphics driver reset, a video tile playing a title is loaded again at its own address, once a reset (2026-09-28)", async () => {
    const { rt, ops } = await setup();
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Episode 8", series: "Animal Control", id: "82675090", url: "https://www.netflix.com/watch/82675090", playing: true } });
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    rt.event(JSON.stringify({ type: "gpu-reset", id: "host" }));
    rt.event(JSON.stringify({ type: "gpu-reset", id: "host" }));   // one reset, told twice
    await vi.advanceTimersByTimeAsync(5_000);
    const navs = ops.filter((o) => o.op === "navigate" && o.id === "screen");
    expect(navs.length).toBe(1);
    expect(String(navs[0]!.url)).toContain("/watch/82675090");
  });

  it("a service that asks for it gets its next title's page loaded fresh when it rolls into it in place; the wall's own pick never (2026-09-28)", async () => {
    const r = rig();
    const rt = createRuntime(r.drivers);
    rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoFreshPageEachTitle: true } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "netflix", name: "Netflix", baseUrl: "https://www.netflix.com/browse", profileId: "netflix", setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "nf", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9\u00B7XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: FHD, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "mn", name: "Movie Night", layout: "night", assign: { screen: "nf" }, floating: [], hidden: [] }))).ok).toBe(true);
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    const nav = (url: string) => rt.event(JSON.stringify({ type: "navigated", id: "screen", url }));
    nav("https://www.netflix.com/watch/1");
    await vi.advanceTimersByTimeAsync(3_000);
    r.ops.length = 0;
    nav("https://www.netflix.com/watch/2?trackId=9");   // the service rolled on by itself
    await vi.advanceTimersByTimeAsync(3_000);
    expect(r.ops.filter((o) => o.op === "navigate" && o.id === "screen").map((o) => o.url)).toEqual(["https://www.netflix.com/watch/2?trackId=9"]);
    nav("https://www.netflix.com/watch/2?trackId=9");   // the fresh load itself: nothing more
    await vi.advanceTimersByTimeAsync(3_000);
    expect(r.ops.filter((o) => o.op === "navigate" && o.id === "screen").length).toBe(1);
  });

  it("the big window keeps its sound when multiview adds a window (the document applied again is not a boot) (2026-09-28)", async () => {
    const { rt, ops } = await setup();
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Episode 9", series: "Animal Control", id: "9", url: "https://www.netflix.com/watch/9", playing: true } });
    rt.event(JSON.stringify({ type: "interaction", id: "screen" }));
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));
    await vi.advanceTimersByTimeAsync(100);
    const heard = () => ops.filter((o) => o.op === "mute" && o.id === "screen").at(-1)?.muted;
    expect(heard()).toBe(false);
    ops.length = 0;
    rt.videoMultiview("on", null);
    await vi.advanceTimersByTimeAsync(500);
    expect(ops.some((o) => o.op === "mute" && o.id === "screen" && o.muted === true)).toBe(false);
  });

  it("a title that played to its end onto the service's own promo at the same address is not brought back after a restart (2026-09-28)", async () => {
    const { rt, store } = await setup();
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/watch/12" }));
    const at = (pos: number) => report(rt, "screen", { playing: true, video: { kind: "episode", title: "Episode 12", series: "Animal Control", id: "12", url: "https://www.netflix.com/watch/12", playing: true, position: pos, duration: 1300 } });
    at(600);
    await vi.advanceTimersByTimeAsync(100);
    const kept = () => Object.values(JSON.parse([...store.entries()].find(([k]) => k.startsWith("video:up:"))?.[1] ?? "{}")).map((x) => (x as { url: string }).url);
    expect(kept()).toEqual(["https://www.netflix.com/watch/12"]);
    at(1290);
    await vi.advanceTimersByTimeAsync(100);
    report(rt, "screen", { playing: false, video: null });   // the end-of-series promo: no title, same address
    await vi.advanceTimersByTimeAsync(100);
    expect(kept()).toEqual([]);
  });

  it("sound only from a title: a video tile playing with no title named (a home page's trailer) is muted; a title playing there has its sound back (2026-09-28)", async () => {
    const { rt, ops } = await setup();
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Episode 12", series: "Animal Control", id: "12", url: "https://www.netflix.com/watch/12", playing: true } });
    rt.event(JSON.stringify({ type: "interaction", id: "screen" }));
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));
    await vi.advanceTimersByTimeAsync(100);
    const last = () => ops.filter((o) => o.op === "mute" && o.id === "screen").at(-1)?.muted;
    expect(last()).toBe(false);
    report(rt, "screen", { playing: true, video: null });   // the season over: Netflix's home page, a trailer playing
    await vi.advanceTimersByTimeAsync(100);
    expect(last()).toBe(true);
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Episode 1", series: "Other Show", id: "1", url: "https://www.netflix.com/watch/1", playing: true } });
    await vi.advanceTimersByTimeAsync(100);
    expect(last()).toBe(false);
  });

  it("a muted preview stays muted when the page says it is playing: the audio focus does not give it its sound back (2026-09-29)", async () => {
    const { rt, ops } = await setup();
    const last = () => ops.filter((o) => o.op === "mute" && o.id === "screen").at(-1)?.muted;
    report(rt, "screen", { playing: true, video: { kind: "movie", title: "", url: "https://www.netflix.com/browse", playing: true, position: 0.3, duration: 61 } });   // a cleared screen: the home page's trailer
    await vi.advanceTimersByTimeAsync(100);
    expect(last()).toBe(true);
    rt.event(JSON.stringify({ type: "interaction", id: "screen" }));
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(last()).toBe(true);
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Episode 1", series: "Other Show", id: "1", url: "https://www.netflix.com/watch/1", playing: true } });
    await vi.advanceTimersByTimeAsync(100);
    expect(last()).toBe(false);   // a title: heard
  });

  it("after a title ends, its next episode carries on; an unrelated title the service autoplays is paused, muted and marked for Watch (2026-09-28)", async () => {
    const { rt, ops } = await setup();
    const ep = (series: string, n: number, pos: number) => report(rt, "screen", { playing: true, video: { kind: "episode", title: "E" + n, series, id: series + n, url: "https://www.netflix.com/watch/" + series.length + n, playing: true, position: pos, duration: 1300 } });
    ep("Animal Control", 11, 1280); await vi.advanceTimersByTimeAsync(50);
    ep("Animal Control", 12, 20); await vi.advanceTimersByTimeAsync(50);   // the next episode: carries on
    expect(ops.some((o) => o.op === "inject" && o.id === "screen" && /pause/i.test(String(o.js)))).toBe(false);
    ep("Animal Control", 12, 1290); await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, video: null }); await vi.advanceTimersByTimeAsync(50);   // the end screen
    ep("Sullivan's Crossing", 1, 5); await vi.advanceTimersByTimeAsync(50);   // an unrelated show, autoplayed
    const st = JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    expect(st.stoppedAutoplay).toBe(true);
    expect(ops.filter((o) => o.op === "mute" && o.id === "screen").at(-1)?.muted).toBe(true);
  });

  it("a title the person picks after one ends is theirs, not an unrelated autoplay; a first report naming only the episode waits for the next (2026-09-28 review)", async () => {
    const { rt } = await setup();
    const ep = (series: string, title: string, pos: number) => report(rt, "screen", { playing: true, video: { kind: "episode", title, ...(series ? { series } : {}), id: series + title, url: "https://www.netflix.com/watch/" + (series.length + title.length), playing: true, position: pos, duration: 1300 } });
    const st = () => JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    ep("Animal Control", "E12", 1290); await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, video: null }); await vi.advanceTimersByTimeAsync(50);   // the end screen
    rt.videoPlay("screen", "title", "77", "https://www.netflix.com/watch/77", "Sullivan's Crossing");   // the person's pick from Watch
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));   // uses up lastInteract
    ep("Sullivan's Crossing", "E1", 5); await vi.advanceTimersByTimeAsync(50);
    expect(st().stoppedAutoplay).toBeUndefined();
    // the next episode's first report names only the episode: not called another show
    ep("Sullivan's Crossing", "E1", 1280); await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, video: null }); await vi.advanceTimersByTimeAsync(50);
    ep("", "E2", 3); await vi.advanceTimersByTimeAsync(50);
    expect(st().stoppedAutoplay).toBeUndefined();
    ep("Sullivan's Crossing", "E2", 8); await vi.advanceTimersByTimeAsync(50);
    expect(st().stoppedAutoplay).toBeUndefined();
    // and the wall's Play lets a real stop go (a while after the pick)
    await vi.advanceTimersByTimeAsync(20_000);
    ep("Sullivan's Crossing", "E2", 1290); await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, video: null }); await vi.advanceTimersByTimeAsync(50);
    ep("Other Show", "E1", 4); await vi.advanceTimersByTimeAsync(50);
    expect(st().stoppedAutoplay).toBe(true);
    rt.tileCommand("screen", "play");
    expect(st().stoppedAutoplay).toBeUndefined();
  });

  it("a live channel moves from show to show by itself: heard though its page names nothing, never 'at its end', never stopped (2026-09-28)", async () => {
    const { rt, ops } = await setup();
    const st = () => JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    const live = (extra: Record<string, unknown> = {}) => report(rt, "screen", { playing: true, video: { kind: "live", id: "cbsn", url: "https://www.netflix.com/live/cbsn", playing: true, ...extra } });
    live();   // a channel whose page names no show
    rt.event(JSON.stringify({ type: "interaction", id: "screen" }));
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));
    await vi.advanceTimersByTimeAsync(50);
    live(); await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "mute" && o.id === "screen").at(-1)?.muted).not.toBe(true);   // not taken for a home page's preview
    live({ series: "CBS News 24/7", title: "Late Edition", playing: false, position: 3599, duration: 3600 }); st();   // paused at the live edge
    await vi.advanceTimersByTimeAsync(20_000);
    live({ series: "CBS News 24/7", title: "Late Edition", playing: false, position: 3599, duration: 3600 });
    expect(st().atEnd).toBeUndefined();
    live({ series: "Another Channel", title: "Overnight", position: 3599, duration: 3600 }); await vi.advanceTimersByTimeAsync(50);
    expect(st().stoppedAutoplay).toBeUndefined();
  });

  it("a title stuck at its end on a page that still names it is over after 15 seconds, on any service (2026-09-28)", async () => {
    const { rt, store } = await setup();
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/watch/12" }));
    const at = (pos: number, playing: boolean) => report(rt, "screen", { playing, video: { kind: "episode", title: "Episode 12", series: "Animal Control", id: "12", url: "https://www.netflix.com/watch/12", playing, position: pos, duration: 1300 } });
    const st = () => JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    at(700, false); await vi.advanceTimersByTimeAsync(100);   // a pause mid-title: not the end, however long
    st(); await vi.advanceTimersByTimeAsync(20_000);
    expect(st().atEnd).toBeUndefined();
    at(1299, false); await vi.advanceTimersByTimeAsync(100);   // the end card, the title still named
    expect(st().atEnd).toBeUndefined();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(st().atEnd).toBe(true);
    at(1299, false); await vi.advanceTimersByTimeAsync(100);
    const kept = Object.values(JSON.parse([...store.entries()].find(([k]) => k.startsWith("video:up:"))?.[1] ?? "{}"));
    expect(kept).toEqual([]);   // not brought back after a restart
    at(30, true); await vi.advanceTimersByTimeAsync(100);   // something plays again: not at the end
    expect(st().atEnd).toBeUndefined();
  });

  it("a title naming its show and episode in one is split in core when the service did not (2026-09-28)", async () => {
    expect(splitEpisodeTitle("Star Trek Season 1 Episode 5: The Enemy Within")).toEqual({ series: "Star Trek", title: "The Enemy Within", season: 1, episode: 5 });
    expect(splitEpisodeTitle("Severance: Season 2, Episode 3 - Who Is Alive?")).toEqual({ series: "Severance", title: "Who Is Alive?", season: 2, episode: 3 });
    expect(splitEpisodeTitle("Animal Control S4:E12 Bears")).toEqual({ series: "Animal Control", title: "Bears", season: 4, episode: 12 });
    expect(splitEpisodeTitle("Bluey S02E05")).toEqual({ series: "Bluey", title: "Bluey", season: 2, episode: 5 });
    expect(splitEpisodeTitle("The Seasoning House")).toBeNull();
    expect(splitEpisodeTitle("Season 3 Episode 1")).toBeNull();
    const { rt } = await setup();
    report(rt, "screen", { playing: true, video: { kind: "movie", title: "Star Trek Season 1 Episode 5: The Enemy Within", id: "5", url: "https://www.netflix.com/watch/5", playing: true } });
    await vi.advanceTimersByTimeAsync(100);
    const v = JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen").video;
    expect(v).toMatchObject({ kind: "episode", series: "Star Trek", title: "The Enemy Within", season: 1, episode: 5 });
  });

  it("a service without the menu contract contributes no rows and still plays exactly as before; the services row lists every service", async () => {
    const { rt, ops } = await setup();
    const menu = JSON.parse(rt.videoMenu());
    expect(menu.services.map((s: { app: string }) => s.app).sort()).toEqual(["hulu", "netflix", "tubi"]);
    expect(menu.continue.filter((c: { app: string }) => c.app === "tubi")).toEqual([]);
    expect(menu.search.map((s: { app: string }) => s.app).sort()).toEqual(["hulu", "netflix"]);   // an address (Netflix) or a script (Hulu); Tubi neither
    ops.length = 0;
    expect(JSON.parse(rt.videoPlayOn("tb", "title", "t1", "https://tubitv.com/movies/t1?start=true", "A Film"))).toMatchObject({ ok: true, switched: true });
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.some((o) => o.op === "navigate" && o.id === "screen" && String(o.url).includes("tubitv.com/movies/t1"))).toBe(true);
  });

  it("the menu never calls a service API, and the watch log reaches no network payload: no net call ever, and the log lives only under video:log:*", async () => {
    const { rt, net, store } = await setup();
    report(rt, "screen", { playing: true, video: { kind: "movie", title: "Heat", id: "n2", url: "https://www.netflix.com/watch/n2", playing: true } });
    await vi.advanceTimersByTimeAsync(50);
    rt.videoMenu(); rt.videoMenu();
    expect(net).toEqual([]);
    expect(store.get("video:log:wall")).toContain("Heat");
    for (const [k, v] of store) if (!k.startsWith("video:log:") && !k.startsWith("video:recent:") && !k.startsWith("video:resume:")) expect(v, k).not.toContain("\"at\":1800000000000");
    // menu-order.ts reads nothing but its arguments: no driver, no store, no clock of its own
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "menu-order.ts"), "utf8");
    expect(src).not.toMatch(/drivers|fetch\(|Date\.now|store|localStorage|XMLHttpRequest/);
  });

  it("a fresh runtime on the same store has the merged rows at its first menu open (the kept rows are read at boot)", async () => {
    const { rt, store } = await setup();
    report(rt, "screen", { playing: false, videoLibrary: { continue: [item("n1", "Dark", "https://www.netflix.com/watch/n1")] } });
    report(rt, "screen", { playing: true, video: { kind: "movie", title: "Dark", id: "n1", url: "https://www.netflix.com/watch/n1", playing: true } });
    await vi.advanceTimersByTimeAsync(50);
    const rt2 = createRuntime({ surface: { create() {}, destroy() {}, setRect() {}, setOpacity() {}, setZ() {}, navigate() {}, inject() {}, freeze() {}, reveal() {}, suspend() {}, resume() {}, setMuted() {}, setViewport() {} }, store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) } } as Drivers);
    rt2.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoLibrary: "/*l*/" } } }));
    await vi.advanceTimersByTimeAsync(100);
    const menu = JSON.parse(rt2.videoMenu());
    expect(menu.continue.map((c: { item: { id: string }; recency: { kind: string } }) => [c.item.id, c.recency.kind])).toEqual([["n1", "log"]]);
    expect(menu.log).toBe(1);
  });

  it("the rows a person browses on an App's popped-out page (app:<id>:preview) join the menu, keyed to the App, with no pick or hint of the screen's", async () => {
    const { rt } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:preview", info: { playing: false, videoLibrary: { continue: [item("h9", "Only Murders", "https://www.hulu.com/watch/h9")] }, videoLive: [{ id: "c1", name: "ABC", url: "https://www.hulu.com/live/c1" }] } }));
    await vi.advanceTimersByTimeAsync(50);
    const menu = JSON.parse(rt.videoMenu());
    expect(menu.continue.map((c: { item: { id: string }; service: string }) => [c.item.id, c.service])).toEqual([["h9", "Hulu"]]);
    expect(menu.live.map((l: { app: string; channels: Array<{ id: string }> }) => [l.app, l.channels.length])).toEqual([["hulu", 1]]);
    expect(JSON.parse(rt.videoState()).every((t: { pending: unknown }) => t.pending === null)).toBe(true);
  });

  it("tune (§3): a Live now card presses the channel's guide item in the service's own page - straight away on its guide, else after the screen switches there and the page is up", async () => {
    const { rt, ops } = await setup();
    // Hulu declares no tune script: the press still opens the guide (the existing play path), nothing else
    expect(JSON.parse(rt.videoTune("hu", "c1", "https://www.hulu.com/live", "ABC"))).toMatchObject({ ok: true, switched: true });
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoTune").length).toBe(0);
    // a service with a tune script, not on the screen: the switch to its guide page, then the press once the page is up
    rt.videoSwitch("hu");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    expect(JSON.parse(rt.videoTune("nf", "NBC", "https://www.netflix.com/live", "NBC"))).toMatchObject({ ok: true, switched: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoTune").length).toBe(0);   // not before the page is up
    expect(ops.some((o) => o.op === "navigate" && o.id === "screen" && String(o.url).includes("/live"))).toBe(false);   // never an address: the app walks its own route
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoTune(\"NBC\")").length).toBe(1);
    // on the screen already: the press goes to the page at once
    ops.length = 0;
    expect(JSON.parse(rt.videoTune("nf", "CBS", null, "CBS"))).toMatchObject({ ok: true, switched: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoTune(\"CBS\")").length).toBe(1);
  });

  it("search (§2 row 5) opens the service's own search page with the words in place, switching the screen there first when needed; live channels (§2 row 3) ride on the report", async () => {
    const { rt, ops } = await setup();
    // Hulu declares a search SCRIPT: the words go into its own search control - the screen switches to Hulu first, the words wait for the page
    expect(JSON.parse(rt.videoSearch("hu", "bear"))).toMatchObject({ ok: true, switched: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoSearch").length).toBe(0);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoSearch(\"bear\")").length).toBe(1);
    expect(ops.some((o) => o.op === "navigate" && String(o.url).includes("search"))).toBe(false);   // never an address for a scripted search
    rt.videoSwitch("nf");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    expect(JSON.parse(rt.videoSearch("nf", "the bear"))).toMatchObject({ ok: true, switched: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.some((o) => o.op === "navigate" && o.id === "screen" && o.url === "https://www.netflix.com/search?q=the%20bear")).toBe(true);
    rt.videoSwitch("hu");
    await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, videoLive: [{ id: "c1", name: "ABC News Live", url: "https://www.hulu.com/live/c1", now: "World News" }, { id: 7, name: "bad" }] });
    await vi.advanceTimersByTimeAsync(50);
    const menu = JSON.parse(rt.videoMenu());
    expect(menu.live).toEqual([{ app: "hulu", name: "Hulu", facet: "hu", channels: [{ id: "c1", name: "ABC News Live", url: "https://www.hulu.com/live/c1", now: "World News", logo: null, favorite: false, readAt: expect.any(Number) }] }]);
  });
});
