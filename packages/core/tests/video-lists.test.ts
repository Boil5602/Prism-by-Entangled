import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// The combined My list (2026-09-20): "All services let you manage one." Each service's own list page is read on a hidden
// surface (an address, or a route walked from a mounted home); only the list (and a Continue Watching row the page
// carries) is kept from it - never its recommended rows; the refresh runs at boot and on a menu open after half an hour,
// never during a search; a search page's rows never reach the row; a card without an address plays through the
// adapter's own videoPlay.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind ?? "slot" }), destroy: (id) => void ops.push({ op: "destroy", id }), setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: (id) => void ops.push({ op: "reveal", id }), suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const injects = (ops: Array<Record<string, unknown>>, id: string, fn: string) => ops.filter((o) => o.op === "inject" && o.id === id && String(o.js).includes(fn));
const item = (id: string, title: string, url: string | null) => ({ id, title, kind: "title", url });

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {
    hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoLibrary: "/*HU-LIB*/", videoListUrl: "https://www.hulu.com/my-stuff", videoProfiles: "/*HU-PROF*/", videoProfilesUrl: "https://www.hulu.com/profiles", videoSearchUrl: "https://www.hulu.com/search?q={q}", videoLookup: "/*HU-LOOKUP*/" },
    peacock: { match: ["www.peacocktv.com"], videoContext: "/*c*/", videoLibrary: "/*PK-LIB*/", videoListRoute: "/*PK-ROUTE*/", videoPlay: "/*PK-PLAY*/" },
    tubi: { match: ["tubitv.com"], videoContext: "/*c*/", videoLibrary: "/*TB-LIB*/" },   // a library, but no list page named: the home's rows only
    fandango: { match: ["athome.fandango.com"], videoContext: "/*c*/", videoLibrary: "/*FA-LIB*/", videoListUrl: "https://athome.fandango.com/content/browse/mywishlist", videoListMerge: false },   // read, kept, never merged
  } }));
  await vi.advanceTimersByTimeAsync(50);
  for (const a of [
    { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "peacock", name: "Peacock", baseUrl: "https://www.peacocktv.com/watch/home", profileId: "peacock", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "tubi", name: "Tubi", baseUrl: "https://tubitv.com/home", profileId: "tubi", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "fandango", name: "Fandango at Home", baseUrl: "https://athome.fandango.com/", profileId: "fandango", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
  ]) expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
  for (const f of [
    { id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" },
    { id: "pk", app: "peacock", url: "https://www.peacocktv.com/watch/home", slotClass: "16:9·XL", label: "Home" },
    { id: "tb", app: "tubi", url: "https://tubitv.com/home", slotClass: "16:9·XL", label: "Home" },
    { id: "fa", app: "fandango", url: "https://athome.fandango.com/", slotClass: "16:9·XL", label: "Home" },
  ]) expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(f))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}
const listTitles = (rt: ReturnType<typeof createRuntime>) => JSON.parse(rt.videoMenu()).list.map((c: { service: string; item: { title: string } }) => c.service + ":" + c.item.title);

describe("the combined My list", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("each service's pages as a chain: the next page as soon as the list has been read, not after a fixed wait (2026-09-24)", async () => {
    const { rt, ops } = await setup();
    rt.videoRefreshLists(true);
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:lookup", info: { playing: false, videoLibrary: { continue: [], list: [item("h1", "The Rookie", null)], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(2500);   // read at once: the Who's watching page two seconds on, not twenty
    expect(ops.filter((o) => o.op === "navigate" && o.id === "app:hulu:lookup").map((o) => o.url)).toEqual(["https://www.hulu.com/my-stuff", "https://www.hulu.com/profiles"]);
    const f = JSON.parse(rt.videoFreshness());
    expect(f.hulu.readAt).toBeGreaterThan(0);
    expect(f.hulu.working).toBe(true);   // its profile page still being read
  });

  it("Watch opened: only the services not read in ten minutes are read again; the timed refresh keeps the household's quiet hours", async () => {
    const { rt, ops } = await setup();
    rt.videoRefreshLists(true);
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:lookup", info: { playing: false, videoLibrary: { continue: [], list: [item("h1", "The Rookie", null)], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(60_000);   // every chain done
    expect(JSON.parse(rt.videoRefreshStale()).asked).toEqual(["peacock", "fandango"]);   // Hulu was read a minute ago
    // quiet hours: the whole day, so the tick is always inside them
    expect(JSON.parse(rt.videoSetPause(true, "00:00", "23:59")).pause).toEqual({ on: true, from: "00:00", to: "23:59" });
    expect(JSON.parse(rt.videoSettings()).pause.on).toBe(true);
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(ops.some((o) => o.op === "navigate" && String(o.id).endsWith(":lookup"))).toBe(false);
    expect(JSON.parse(rt.videoSettings()).background.last).toMatch(/paused/);
    rt.videoSetPause(false, "23:00", "07:00");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ops.some((o) => o.op === "navigate" && String(o.id).endsWith(":lookup"))).toBe(true);   // off: the refresh runs again
  });

  it("a polite client: a service whose pages keep not answering is left alone a while, a person's refresh still goes; the timed refresh rests while nobody is about (2026-09-25)", async () => {
    const { rt, ops } = await setup();
    // nothing answers on the rig: three whole chains unanswered and the service is backed off
    for (let i = 0; i < 3; i++) { rt.videoRefreshLists(true); await vi.advanceTimersByTimeAsync(120_000); }
    expect(JSON.parse(rt.videoRefreshLists(true)).asked).toEqual([]);
    expect(JSON.parse(rt.videoRefreshApp("hulu")).ok).toBe(true);   // pressed by a person: always read
    // hours later with nobody about and nothing playing, the timed refresh rests
    await vi.advanceTimersByTimeAsync(4 * 3_600_000);
    expect(JSON.parse(rt.videoSettings()).background.last).toMatch(/resting/);
    ops.length = 0;
    rt.videoRefreshStale();   // Watch opened: a person is about again
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(JSON.parse(rt.videoSettings()).background.last).not.toMatch(/resting/);
  });

  it("each service's own list page is opened on a hidden surface - an address, or the app's own route from its home; only the list is kept from it", async () => {
    const { rt, ops } = await setup();
    expect(JSON.parse(rt.videoRefreshLists(true))).toEqual({ ok: true, asked: ["hulu", "peacock", "fandango"] });   // Tubi names no list page
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "create")).toEqual([{ op: "create", id: "app:hulu:lookup", kind: "hidden" }, { op: "create", id: "app:peacock:lookup", kind: "hidden" }, { op: "create", id: "app:fandango:lookup", kind: "hidden" }]);
    expect(ops.find((o) => o.op === "navigate" && o.id === "app:hulu:lookup")?.url).toBe("https://www.hulu.com/my-stuff");
    expect(ops.find((o) => o.op === "navigate" && o.id === "app:peacock:lookup")?.url).toBe("https://www.peacocktv.com/watch/home");
    expect(ops.some((o) => o.op === "reveal")).toBe(false);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    rt.event(JSON.stringify({ type: "load-finished", id: "app:peacock:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "app:hulu:lookup", "HU-LIB").length).toBe(1);
    expect(injects(ops, "app:hulu:lookup", "__prismVideoListRoute").length).toBe(0);
    expect(injects(ops, "app:peacock:lookup", "PK-LIB").length).toBe(1);
    expect(injects(ops, "app:peacock:lookup", "__prismVideoListRoute()").length).toBe(1);   // the route walked once the home is up
    expect(injects(ops, "app:peacock:lookup", "PK-ROUTE").length).toBe(1);                   // ... and the route script itself rode in with the adapter
    // the pages report: the list, and (Tubi-style) a Continue Watching row; a "recommended" shelf on the page is not kept
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:lookup", info: { playing: false, videoLibrary: { continue: [], list: [item("h1", "The Rookie", "https://www.hulu.com/watch/h1"), item("h2", "Paradise", "https://www.hulu.com/watch/h2")], shelves: [{ title: "Recommended for you", items: [item("h9", "Not mine", "https://www.hulu.com/watch/h9")] }] } } }));
    rt.event(JSON.stringify({ type: "now-playing", id: "app:peacock:lookup", info: { playing: false, videoLibrary: { continue: [item("p5", "Killing It S2", null)], list: [item("p1", "Killing It", null), item("p2", "Mrs. Davis", null)], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(50);
    // Fandango's wish list is read and kept, but never merged (videoListMerge false); its Continue Watching merges as any
    rt.event(JSON.stringify({ type: "load-finished", id: "app:fandango:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:fandango:lookup", info: { playing: false, videoLibrary: { continue: [item("f5", "Signs", "https://athome.fandango.com/content/browse/details/Signs/5")], list: [item("f1", "Dark Skies", "https://athome.fandango.com/content/browse/details/Dark-Skies/1")], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(listTitles(rt).sort()).toEqual(["Hulu:Paradise", "Hulu:The Rookie", "Peacock:Killing It", "Peacock:Mrs. Davis"]);
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "fandango").library.list.map((i: { title: string }) => i.title)).toEqual(["Dark Skies"]);
    const menu = JSON.parse(rt.videoMenu());
    expect(menu.continue.map((c: { item: { title: string } }) => c.item.title).sort()).toEqual(["Killing It S2", "Signs"]);
    expect(menu.suggestions.some((s: { app: string }) => s.app === "hulu")).toBe(false);   // the list page's recommended row never became a shelf
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu").library.list.length).toBe(2);
    // an empty list from the list page: not believed while the page may still be rendering, believed once it has settled (a fresh read -
    // the chain leaves a page once it has been read, 2026-09-24)
    rt.videoRefreshLists(true);
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:lookup", info: { playing: false, videoLibrary: { continue: [item("h5", "Continue me", "https://www.hulu.com/watch/h5")], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu").library.list.length).toBe(2);
    // ... and the page reports only on change: the settle itself believes the last empty report
    await vi.advanceTimersByTimeAsync(Orchestrator.LIST_SETTLE_MS + 2000);
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu").library.list.length).toBe(0);
  });

  it("the household follows the service's Who's watching page: read on the hidden surface after the list, a deleted profile leaves the menu, nothing is pressed there", async () => {
    const { rt, ops } = await setup();
    const known = () => JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu").profiles.map((p: { name: string }) => p.name);
    // the wall once saw the gate with three
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: { gate: true, profiles: [{ id: "Alex", name: "Alex", avatar: null }, { id: "Old", name: "Old", avatar: null }, { id: "Ivy", name: "Ivy", avatar: null }], current: null } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoProfileChoose("hulu", "Old"))).toMatchObject({ ok: true });   // a standing choice, on the profile about to be deleted
    expect(known()).toEqual(["Alex", "Old", "Ivy"]);
    ops.length = 0;
    rt.videoMenu();   // the refresh: the list page first ...
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "navigate" && o.id === "app:hulu:lookup").map((o) => o.url)).toEqual(["https://www.hulu.com/my-stuff"]);
    await vi.advanceTimersByTimeAsync(Orchestrator.LIST_SETTLE_MS + 4600);   // ... then, once it has settled (a list that never reports: the chain's limit), the Who's watching page
    expect(ops.filter((o) => o.op === "navigate" && o.id === "app:hulu:lookup").map((o) => o.url)).toEqual(["https://www.hulu.com/my-stuff", "https://www.hulu.com/profiles"]);
    // the page names the household as it is now: Old is gone
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:lookup", info: { playing: false, videoProfiles: { gate: true, profiles: [{ id: "Alex", name: "Alex", avatar: null }, { id: "Ivy", name: "Ivy", avatar: null }], current: null } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(known()).toEqual(["Alex", "Ivy"]);
    expect(ops.filter((o) => o.op === "inject" && o.id === "app:hulu:lookup" && String(o.js).includes("__prismVideoProfile(")).length).toBe(0);   // a read only: the standing choice is never pressed from the background
  });

  it("stale-guarded: a menu open re-reads the lists only after half an hour; never during a search; a search page's rows never reach the row", async () => {
    const { rt, ops } = await setup();
    rt.videoMenu();   // the first open asks
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "navigate").length).toBe(3);
    rt.videoMenu(); rt.videoMenu();
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "navigate").length).toBe(3);   // no more within the half hour
    await vi.advanceTimersByTimeAsync(Orchestrator.LISTS_STALE_MS + 100);
    rt.videoMenu();
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "navigate").length).toBeGreaterThanOrEqual(7);   // the three list pages again, and Hulu's Who's watching page after its first list settled (the background refresh, 2026-09-23, may have read them meanwhile too)
    // a search takes the surface to the search page: what that page reports is not the list
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    rt.videoLookup("dark");
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoRefreshLists(true))).toEqual({ ok: true, asked: [] });   // never during a search
    rt.event(JSON.stringify({ type: "now-playing", id: "app:hulu:lookup", info: { playing: false, videoLibrary: { continue: [], list: [item("s1", "A search hit", "https://www.hulu.com/watch/s1")], shelves: [{ title: "Episodes", items: [item("s2", "x", null)] }] } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(listTitles(rt)).toEqual([]);
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu").library.shelves.length).toBe(0);
  });

  it("keeps itself current: the background tick re-reads stale lists when the wall is quiet", async () => {
    const { rt, ops } = await setup();
    rt.videoMenu();
    await vi.advanceTimersByTimeAsync(50);
    const first = ops.filter((o) => o.op === "navigate").length;
    await vi.advanceTimersByTimeAsync(Orchestrator.BG_LISTS_MS + 5 * 60_000);   // the tick comes every four minutes
    expect(ops.filter((o) => o.op === "navigate").length).toBeGreaterThan(first);
    expect(JSON.parse(rt.backgroundState()).last).toMatch(/^refreshed|fresh/);
  });

  it("a list card without an address plays through the service's own videoPlay (Peacock walks to My Stuff and presses the tile)", async () => {
    const { rt, ops } = await setup();
    rt.videoRefreshLists(true);
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:peacock:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:peacock:lookup", info: { playing: false, videoLibrary: { continue: [], list: [item("tile-7", "Mrs. Davis", null)], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(50);
    const card = JSON.parse(rt.videoMenu()).list.find((c: { app: string }) => c.app === "peacock");
    expect(card.item).toMatchObject({ id: "tile-7", title: "Mrs. Davis", url: null });
    ops.length = 0;
    // the screen becomes Peacock, and once its home is up the adapter's own play takes the tile
    expect(JSON.parse(rt.videoPlayOn(card.facet, card.item.kind, card.item.id, card.item.url, card.item.title))).toMatchObject({ ok: true, switched: true });
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", '__prismVideoPlay("title", "tile-7", null)').length).toBe(1);
  });
});
