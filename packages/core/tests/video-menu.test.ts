import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../src/runtime.js";
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
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
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

  it("merges Continue Watching across services by §4: a play the wall saw (the log) first with its real time, then the inferred, then each service's own rank; lastWatched never synthesized", async () => {
    const { rt } = await setup();
    // Netflix on the screen reports its rows; then Hulu is up and reports its own
    report(rt, "screen", { playing: false, videoLibrary: { continue: [item("n1", "Dark", "https://www.netflix.com/watch/n1"), item("n2", "Heat", "https://www.netflix.com/watch/n2")], list: [item("n9", "Tires", "https://www.netflix.com/watch/n9")] } });
    await vi.advanceTimersByTimeAsync(50);
    rt.videoSwitch("hu");
    await vi.advanceTimersByTimeAsync(50);
    report(rt, "screen", { playing: false, videoLibrary: { continue: [item("h1", "The Bear", "https://www.hulu.com/watch/h1"), item("h2", "Shrill", "https://www.hulu.com/watch/h2")] } });
    await vi.advanceTimersByTimeAsync(50);
    let menu = JSON.parse(rt.videoMenu());
    // nothing played yet: every card is the service's rank, none carries a time, the first-seen record makes them all "inferred" (fresh)
    // both rows freshly seen: interleaved by each service's own position, as the rank class is (2026-09-23 - Apple TV's first read put its 40 behind all else)
    expect(menu.continue.map((c: { item: { id: string } }) => c.item.id)).toEqual(["n1", "h1", "n2", "h2"]);
    expect(menu.continue.every((c: { lastWatched?: number }) => c.lastWatched === undefined)).toBe(true);
    expect(menu.continue.every((c: { recency: { kind: string } }) => c.recency.kind === "inferred")).toBe(true);
    expect(menu.list.map((c: { item: { id: string }; service: string }) => [c.item.id, c.service])).toEqual([["n9", "Netflix"]]);
    // Hulu plays Shrill: the log has it, exact, and it leads with its real time
    report(rt, "screen", { playing: true, video: { kind: "episode", title: "Shrill", id: "h2", url: "https://www.hulu.com/watch/h2", playing: true } });
    await vi.advanceTimersByTimeAsync(50);
    menu = JSON.parse(rt.videoMenu());
    expect(menu.continue[0]).toMatchObject({ item: { id: "h2" }, service: "Hulu", recency: { kind: "log", at: expect.any(Number) } });
    expect(menu.continue[0].lastWatched).toBe(menu.continue[0].recency.at);   // the one time a card shows is the log's, exactly
    expect(menu.continue.slice(1).every((c: { lastWatched?: number }) => c.lastWatched === undefined)).toBe(true);
    expect(menu.log).toBe(1);
    // ten days on, the old first sights are no longer "recent": rank order, still no time invented
    vi.setSystemTime(1_800_000_000_000 + 10 * 24 * 3600_000);
    menu = JSON.parse(rt.videoMenu());
    expect(menu.continue.map((c: { item: { id: string }; recency: { kind: string } }) => [c.item.id, c.recency.kind])).toEqual([["h2", "log"], ["n1", "rank"], ["h1", "rank"], ["n2", "rank"]]);
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
    expect(menu.live).toEqual([{ app: "hulu", name: "Hulu", facet: "hu", channels: [{ id: "c1", name: "ABC News Live", url: "https://www.hulu.com/live/c1", now: "World News", logo: null, favorite: false }] }]);
  });
});
