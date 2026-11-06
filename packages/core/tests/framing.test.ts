import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { focusFramingJs, validRegion } from "../src/focus.js";
import { customTile, hostSlug } from "../src/catalog.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// §31 step 3 (host viewfinder) + the menu's layout/tile edits: every edit is
// a core call, persisted to the "dashboard" key, applied live to the seam.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, zoom: o.zoom }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: (id) => void ops.push({ op: "freeze", id }),
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
      setViewport: (id, w, h) => void ops.push({ op: "setViewport", id, w, h }),
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, orchestrator: new Orchestrator(drivers) };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "wall",
  name: "Wall",
  layout: { mode: "hero", hero: "a", heroSize: 0.62, satellites: "auto", gap: 0 },
  tiles: [
    { id: "a", url: "https://a.test", audio: "mute" },
    { id: "b", url: "https://b.test", audio: "mute", focus: { selector: "#main" } },
    { id: "c", url: "https://c.test", audio: "mute" },
  ],
};

async function settle(o: Orchestrator, ids: string[]) {
  for (const id of ids) {
    await o.onSurfaceEvent({ type: "load-finished", id, ok: true });
    await o.onSurfaceEvent({ type: "first-paint", id });
    await o.onSurfaceEvent({ type: "focus-result", id, found: true });
  }
  await vi.advanceTimersByTimeAsync(500);
}

const persisted = (store: Map<string, string>) => JSON.parse(store.get("dashboard")!) as DashboardDocument;

describe("focus.region framing script (§17)", () => {
  it("frames a page rectangle without a selector, contain-fit by default", () => {
    const js = focusFramingJs({ region: { x: 100, y: 200, w: 800, h: 450 } });
    expect(js).toContain('var region = {"x":100,"y":200,"w":800,"h":450}');
    expect(js).toContain("var selector = null");
    expect(js).toContain('"contain"');
    expect(js).toContain("notifyFocusResult");
  });

  it("region wins over selector; a bad region falls back to the selector", () => {
    expect(focusFramingJs({ selector: "#x", region: { x: 0, y: 0, w: 10, h: 10 } })).toContain("var selector = null");
    expect(focusFramingJs({ selector: "#x", region: { x: 0, y: 0, w: 0, h: 10 } })).toContain('var selector = "#x"');
  });

  it("validRegion rejects non-finite, negative-origin and empty rects", () => {
    expect(validRegion({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(validRegion({ x: -1, y: 0, w: 1, h: 1 })).toBe(false);
    expect(validRegion({ x: 0, y: 0, w: 0, h: 1 })).toBe(false);
    expect(validRegion({ x: 0, y: 0, w: NaN, h: 1 })).toBe(false);
    expect(validRegion(null)).toBe(false);
  });
});

describe("viewfinder: startFraming / finishFraming (§31 step 3)", () => {
  it("pops the slot out full screen unframed at its natural layout, then persists rect + viewport and re-frames it in its slot", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    const slot = ops.filter((o) => o.op === "setRect" && o.id === "b").at(-1)!.rect as { w: number };
    ops.length = 0;

    expect(await orchestrator.startFraming("b")).toBe(true);
    // unframed (the previous selector framing cleared), the whole window, natural layout
    expect(ops.some((o) => o.op === "inject" && o.id === "b" && String(o.js).includes('root.style.transform = ""'))).toBe(true);
    expect(ops.some((o) => o.op === "setZ" && o.id === "b" && o.z === 40)).toBe(true);
    expect(ops.some((o) => o.op === "setRect" && o.id === "b" && (o.rect as { w: number }).w === 1000)).toBe(true);
    expect(ops.some((o) => o.op === "setViewport" && o.id === "b" && o.w === 0 && o.h === 0)).toBe(true);
    expect(orchestrator.getState()!.framing).toBe("b");
    expect(orchestrator.getState()!.fullscreen).toBe("b");
    ops.length = 0;

    expect(await orchestrator.finishFraming("b", { region: { x: 120.4, y: 80.6, w: 640, h: 360 }, viewport: { w: 2000, h: 1200.4 } })).toBe("ok");
    // back in its slot, the region's layout viewport applied, region framed (rounded), persisted with its viewport
    const back = ops.filter((o) => o.op === "setRect" && o.id === "b").at(-1)!.rect as { w: number };
    expect(back.w).toBeCloseTo(slot.w, 6);
    expect(orchestrator.getState()!.fullscreen).toBeNull();
    expect(ops.some((o) => o.op === "setViewport" && o.id === "b" && o.w === 2000 && o.h === 1200)).toBe(true);
    expect(ops.some((o) => o.op === "inject" && o.id === "b" && String(o.js).includes('"x":120,"y":81,"w":640,"h":360'))).toBe(true);
    expect(persisted(store).tiles.find((t) => t.id === "b")!.focus).toEqual({ region: { x: 120, y: 81, w: 640, h: 360 }, viewport: { w: 2000, h: 1200 } });
    expect(orchestrator.getState()!.framing).toBeUndefined();
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "b")!.focus).toEqual({ region: { x: 120, y: 81, w: 640, h: 360 }, viewport: { w: 2000, h: 1200 } });
    // a later reflow keeps sending the region's viewport (not rect/zoom)
    ops.length = 0;
    await orchestrator.resize({ w: 1200, h: 700 });
    expect(ops.some((o) => o.op === "setViewport" && o.id === "b" && o.w === 2000 && o.h === 1200)).toBe(true);
  });

  it("cancel restores the previous framing and the slot; nothing persists", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    await orchestrator.startFraming("b");
    ops.length = 0;
    expect(await orchestrator.finishFraming("b", null)).toBe("ok");
    expect(ops.some((o) => o.op === "inject" && o.id === "b" && String(o.js).includes('"#main"'))).toBe(true);
    expect(orchestrator.getState()!.fullscreen).toBeNull();
    expect(store.has("dashboard")).toBe(false);
    expect(await orchestrator.finishFraming("b", null)).toBe("not-framing");
  });

  it("{clear:true} ends the pick with no framing at all (the whole page), persisted", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    await orchestrator.startFraming("b");                        // b had a selector focus
    ops.length = 0;
    expect(await orchestrator.finishFraming("b", { clear: true })).toBe("ok");
    expect(persisted(store).tiles.find((t) => t.id === "b")!.focus).toBeUndefined();
    expect(ops.some((o) => o.op === "inject" && o.id === "b" && String(o.js).includes('root.style.transform = ""'))).toBe(true);
    expect(ops.some((o) => o.op === "setViewport" && o.id === "b" && o.w === 0 && o.h === 0)).toBe(true);
    expect(orchestrator.getState()!.fullscreen).toBeNull();
  });

  it("a bad rectangle is refused and treated as cancel", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    await orchestrator.startFraming("c");
    expect(await orchestrator.finishFraming("c", { region: { x: 0, y: 0, w: -5, h: 10 } })).toBe("invalid");
    expect(store.has("dashboard")).toBe(false);
    expect(orchestrator.getState()!.framing).toBeUndefined();
  });

  it("refuses tiles that are not live web pages", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    expect(await orchestrator.startFraming("nope")).toBe(false);
  });
});

describe("redirect on arrival (§16)", () => {
  it("a failed load-finished followed by a successful one within the grace still reveals", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    ops.length = 0;
    // peacocktv.com → /watch/home: the superseded navigation reports failure, the real one succeeds
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "a", ok: false });
    await vi.advanceTimersByTimeAsync(300);
    await orchestrator.onSurfaceEvent({ type: "navigated", id: "a", url: "https://a.test/home" });
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "a", ok: true });
    await orchestrator.onSurfaceEvent({ type: "first-paint", id: "a" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ops.some((o) => o.op === "reveal" && o.id === "a")).toBe(true);
    expect(ops.filter((o) => o.op === "navigate" && o.id === "a")).toHaveLength(0);   // no quiet retry
  });

  it("a failed load that nothing better follows still keeps the snapshot and retries quietly", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    ops.length = 0;
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "a", ok: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ops.some((o) => o.op === "reveal" && o.id === "a")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ops.filter((o) => o.op === "navigate" && o.id === "a")).toHaveLength(1);
  });
});

describe("updateTile (menu edits)", () => {
  it("url change persists and reloads on the §16 path; focus null clears the framing live", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    ops.length = 0;

    expect(await orchestrator.updateTile("a", { url: "https://a.test/other" })).toBe("ok");
    expect(persisted(store).tiles.find((t) => t.id === "a")!.url).toBe("https://a.test/other");
    expect(ops.some((o) => o.op === "navigate" && o.id === "a" && o.url === "https://a.test/other")).toBe(true);

    expect(await orchestrator.updateTile("b", { focus: null })).toBe("ok");
    expect(persisted(store).tiles.find((t) => t.id === "b")!.focus).toBeUndefined();
    expect(ops.some((o) => o.op === "inject" && o.id === "b" && String(o.js).includes('root.style.transform = ""'))).toBe(true);

    expect(await orchestrator.updateTile("a", { url: "ftp://x" })).toBe("bad-url");
    expect(await orchestrator.updateTile("zz", { url: "https://x.test" })).toBe("unknown-tile");
  });

  it("zoom is clamped to §31 bounds, applied live as a rect/zoom viewport, and null clears it", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    const slot = ops.filter((o) => o.op === "setRect" && o.id === "c").at(-1)!.rect as { w: number; h: number };
    ops.length = 0;
    expect(await orchestrator.updateTile("c", { zoom: 9 })).toBe("ok");
    const vp = ops.find((o) => o.op === "setViewport" && o.id === "c")!;
    expect(vp.w).toBe(Math.round(slot.w / 3));
    expect(vp.h).toBe(Math.round(slot.h / 3));
    expect(persisted(store).tiles.find((t) => t.id === "c")!.zoom).toBe(3);
    ops.length = 0;
    expect(await orchestrator.updateTile("c", { zoom: null })).toBe("ok");
    expect(ops.some((o) => o.op === "setViewport" && o.id === "c" && o.w === 0 && o.h === 0)).toBe(true);
    expect(persisted(store).tiles.find((t) => t.id === "c")!.zoom).toBeUndefined();
  });

});

describe("setLayout (menu)", () => {
  it("grid auto-flows one cell per tile, row-major, and persists the lattice", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    expect(await orchestrator.setLayout({ mode: "grid", cols: 2, rows: 2 })).toBe("ok");
    const d = persisted(store);
    expect(d.layout).toEqual({ mode: "grid" });
    expect(d.grid).toEqual({ cols: 2, rows: 2, gap: 8 });
    expect(d.tiles.map((t) => t.area)).toEqual(["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "2 / 1 / 3 / 2"]);
    const rects = orchestrator.rects();
    expect(rects.a).toEqual({ x: 0, y: 0, w: 500, h: 300 });
    expect(rects.c).toEqual({ x: 0, y: 300, w: 500, h: 300 });
    expect(orchestrator.getState()!.grid).toEqual({ cols: 2, rows: 2 });
  });

  it("back to hero keeps the persisted hero override; solo is a plain mode switch", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    await orchestrator.promoteHero("c");
    await orchestrator.setLayout({ mode: "grid", cols: 3, rows: 1 });
    expect(await orchestrator.setLayout({ mode: "hero", heroSize: 0.5 })).toBe("ok");
    const d = persisted(store);
    expect(d.layout).toMatchObject({ mode: "hero", hero: "c", heroSize: 0.5, satellites: "auto" });
    expect(orchestrator.getState()!.hero).toBe("c");
    expect(await orchestrator.setLayout({ mode: "solo" })).toBe("ok");
    expect(persisted(store).layout).toEqual({ mode: "solo" });
    expect(await orchestrator.setLayout({ mode: "grid", cols: 0, rows: 2 })).toBe("invalid");
  });
});

describe("replaceTile (configure slot)", () => {
  it("swaps the tile in its slot, follows the hero, destroys the old surface, persists", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    ops.length = 0;
    expect(await orchestrator.replaceTile("a", { id: "news", url: "https://news.test", audio: "mix", profile: "news", persist: true })).toBe("ok");
    const d = persisted(store);
    expect(d.tiles.map((t) => t.id)).toEqual(["news", "b", "c"]);
    expect(d.layout).toMatchObject({ mode: "hero", hero: "news" });
    expect(orchestrator.getState()!.hero).toBe("news");
    expect(ops.some((o) => o.op === "destroy" && o.id === "a")).toBe(true);
    expect(ops.some((o) => o.op === "create" && o.id === "news")).toBe(true);
    expect(ops.some((o) => o.op === "navigate" && o.id === "news" && o.url === "https://news.test")).toBe(true);
    expect(await orchestrator.replaceTile("zz", { id: "x", url: "https://x.test" })).toBe("unknown-tile");
  });

  it("dedupes the new id against neighbours and keeps a grid area", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await orchestrator.setLayout({ mode: "grid", cols: 3, rows: 1 });
    expect(await orchestrator.replaceTile("a", { id: "b", url: "https://b2.test", profile: "b" })).toBe("ok");
    const d = persisted(store);
    expect(d.tiles.map((t) => t.id)).toEqual(["b-2", "b", "c"]);
    expect(d.tiles[0]!.profile).toBe("b-2");
    expect(d.tiles[0]!.area).toBe("1 / 1 / 2 / 2");
  });
});

describe("shortcuts (named places on an app)", () => {
  it("saves under the app key, lists in state, applies as page + view, removes", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    expect(orchestrator.getState()!.tiles[0]!.app).toBe("a");          // no adapter: the site's host slug
    expect(await orchestrator.saveShortcut("a", { label: "Top News", url: "https://a.test/news", focus: { region: { x: 1, y: 2, w: 300, h: 200 }, viewport: { w: 1600, h: 900 } } })).toBe("ok");
    expect(await orchestrator.saveShortcut("a", { label: "Top News" })).toBe("ok");               // same label → id top-news-2, current page
    expect(await orchestrator.saveShortcut("a", { label: "   " })).toBe("invalid");
    const saved = JSON.parse(store.get("shortcuts:a")!) as Array<{ id: string; label: string; url: string }>;
    expect(saved.map((s) => s.id)).toEqual(["top-news", "top-news-2"]);
    expect(saved[1]!.url).toBe("https://a.test");
    expect(orchestrator.getState()!.tiles[0]!.userShortcuts).toEqual([
      { id: "top-news", label: "Top News", url: "https://a.test/news", hasRegion: true },
      { id: "top-news-2", label: "Top News", url: "https://a.test", hasRegion: false },
    ]);
    ops.length = 0;
    expect(await orchestrator.applyShortcut("a", "top-news")).toBe("ok");
    expect(ops.some((o) => o.op === "setViewport" && o.id === "a" && o.w === 1600 && o.h === 900)).toBe(true);
    expect(ops.some((o) => o.op === "navigate" && o.id === "a" && o.url === "https://a.test/news")).toBe(true);
    expect(persisted(store).tiles[0]!.focus).toEqual({ region: { x: 1, y: 2, w: 300, h: 200 }, viewport: { w: 1600, h: 900 } });
    expect(await orchestrator.removeShortcut("a", "top-news")).toBe("ok");
    expect(await orchestrator.removeShortcut("a", "top-news")).toBe("unknown-shortcut");
    expect(orchestrator.shortcutsFor("a").map((s) => s.id)).toEqual(["top-news-2"]);
  });

  it("saving a second and third layout never touches the first (each is its own entry)", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    const first = { region: { x: 10, y: 20, w: 300, h: 200 }, viewport: { w: 1600, h: 900 } };
    await orchestrator.saveShortcut("a", { label: "Home", url: "https://a.test/", focus: first, aspectHint: "16:9" });
    await orchestrator.saveShortcut("a", { label: "Search", url: "https://a.test/search", focus: { region: { x: 0, y: 0, w: 800, h: 600 }, viewport: { w: 1200, h: 800 } }, aspectHint: "4:3" });
    await orchestrator.saveShortcut("a", { label: "Live", url: "https://a.test/live", focus: null });
    const saved = JSON.parse(store.get("shortcuts:a")!) as Array<{ id: string; url: string; focus?: unknown; aspectHint?: string }>;
    expect(saved.map((s) => s.id)).toEqual(["home", "search", "live"]);
    expect(saved[0]).toEqual({ id: "home", label: "Home", url: "https://a.test/", focus: first, aspectHint: "16:9" });
    expect(saved[2]!.focus).toBeUndefined();
    await orchestrator.removeShortcut("a", "search");
    expect(JSON.parse(store.get("shortcuts:a")!)[0]).toEqual({ id: "home", label: "Home", url: "https://a.test/", focus: first, aspectHint: "16:9" });
  });

  it("a layout can carry a slot shape: assigning it sets the tile's aspect hint and reflows the wall", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    expect(await orchestrator.saveShortcut("c", { label: "Tall", url: "https://c.test/tall", focus: null, aspectHint: "3:4" })).toBe("ok");
    expect(await orchestrator.saveShortcut("c", { label: "Bad", url: "https://c.test/x", aspectHint: "wide" })).toBe("ok");   // an unparsable hint is dropped
    const saved = JSON.parse(store.get("shortcuts:c")!) as Array<{ id: string; aspectHint?: string }>;
    expect(saved[0]!.aspectHint).toBe("3:4");
    expect(saved[1]!.aspectHint).toBeUndefined();
    ops.length = 0;
    expect(await orchestrator.applyShortcut("c", "tall")).toBe("ok");
    expect(persisted(store).tiles.find((t) => t.id === "c")!.aspectHint).toBe("3:4");
    expect(ops.some((o) => o.op === "setRect")).toBe(true);                    // the wall reflowed
    expect(await orchestrator.updateTile("c", { aspectHint: null })).toBe("ok");
    expect(persisted(store).tiles.find((t) => t.id === "c")!.aspectHint).toBeUndefined();
  });

  it("shortcuts survive a reload of the document (read back from the store)", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await orchestrator.saveShortcut("b", { label: "Live", url: "https://b.test/live", focus: null });
    const again = new Orchestrator({
      surface: { create() {}, destroy() {}, setRect() {}, setOpacity() {}, setZ() {}, navigate() {}, inject() {}, freeze() {}, reveal() {}, suspend() {}, resume() {}, setMuted() {} },
      store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    });
    await again.load(structuredClone(doc), { w: 1000, h: 600 });
    expect(again.shortcutsFor("b")).toEqual([{ id: "live", label: "Live", url: "https://b.test/live" }]);
  });
});

describe("boot-hold vs an ad already playing", () => {
  it("does not hold an ad under the veil; the hold lands on the content after the break", async () => {
    const { ops, store, orchestrator } = rig();
    store.set("tile:lasturl:wall:a", "https://a.test/watch/123");        // a resumed location boots PAUSED (§10)
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 600 });
    await settle(orchestrator, ["a", "b", "c"]);
    const holds = () => ops.filter((o) => o.op === "inject" && o.id === "a" && String(o.js).includes("__prism-hold")).length;
    ops.length = 0;
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "a", active: true });      // the break begins first
    await orchestrator.onSurfaceEvent({ type: "playback", id: "a", playing: true });     // ...then the first thing to play is the ad
    expect(holds()).toBe(0);                                                               // not held: the ad runs under the veil
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "a", active: false });
    await orchestrator.onSurfaceEvent({ type: "playback", id: "a", playing: true });     // content starts
    expect(holds()).toBe(1);                                                               // now the hold lands
  });
});

describe("customTile (§31 step 2)", () => {
  it("derives id/profile from the host, plain fields only, http(s) only", () => {
    const t = customTile("https://news.ycombinator.com/newest")!;
    expect(t).toEqual({
      id: "news-ycombinator", url: "https://news.ycombinator.com/newest", audio: "mix",
      profile: "news-ycombinator", persist: true, veil: { mode: "veil-only" },
    });
    expect(customTile("ftp://x.test")).toBeNull();
    expect(customTile("not a url")).toBeNull();
    expect(customTile("https://x.test", { tileId: "mine", zoom: 0.1 })).toMatchObject({ id: "mine", profile: "mine", zoom: 0.5 });
  });

  it("hostSlug", () => {
    expect(hostSlug("www.cnn.com")).toBe("cnn");
    expect(hostSlug("bbc.co.uk")).toBe("bbc-co");
    expect(hostSlug("localhost")).toBe("localhost");
    expect(hostSlug("")).toBe("site");
  });
});
