import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FLOAT, Orchestrator, clampFloat } from "../src/orchestrator.js";
import { layoutDashboard } from "../src/layout.js";
import { pickerTile, type CatalogEntry } from "../src/catalog.js";
import type { Drivers } from "../src/drivers.js";
import { aliasTileKind, tileKind, type DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// §32 floating facets: out of the solver, placed from wall fractions, the
// shell told which chrome to wear; now-playing observed and pushed.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {},
      reveal: () => {},
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
      setViewport: () => {},
      setNowPlaying: (id, info) => void ops.push({ op: "setNowPlaying", id, info }),
      setChrome: (id, kind, face, hidden) => void ops.push({ op: "setChrome", id, kind, face, hidden: !!hidden }),
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
    { id: "b", url: "https://b.test", audio: "mute" },
    { id: "music", url: "https://music.test", audio: "exclusive", kind: "floating", float: { x: 0.5, y: 0.5, w: 0.5, h: 0.25 } },
  ],
};

const persisted = (store: Map<string, string>) => JSON.parse(store.get("dashboard")!) as DashboardDocument;

describe("§32 floating facets are not solver input (§8)", () => {
  it("layoutDashboard partitions the wall among the wall tiles only", () => {
    const rects = layoutDashboard(doc, { w: 1000, h: 500 });
    expect(Object.keys(rects).sort()).toEqual(["a", "b"]);
    // identical to the same wall without the floating tile at all
    const bare = { ...structuredClone(doc), tiles: doc.tiles.filter((t) => t.kind !== "floating") };
    expect(rects).toEqual(layoutDashboard(bare, { w: 1000, h: 500 }));
  });

  it("a floating tile named as hero is ignored: the first wall tile anchors", () => {
    const d = structuredClone(doc);
    (d.layout as { hero: string }).hero = "music";
    const rects = layoutDashboard(d, { w: 1000, h: 500 });
    expect(Object.keys(rects).sort()).toEqual(["a", "b"]);
    expect(rects.a!.w * rects.a!.h).toBeGreaterThan(rects.b!.w * rects.b!.h);
  });

  it("grid and solo modes exclude it too", () => {
    const grid: DashboardDocument = { ...structuredClone(doc), layout: { mode: "grid" }, grid: { cols: 2, rows: 1, gap: 0 } };
    grid.tiles[0]!.area = "1 / 1 / 2 / 2";
    grid.tiles[1]!.area = "1 / 2 / 2 / 3";
    expect(Object.keys(layoutDashboard(grid, { w: 1000, h: 500 })).sort()).toEqual(["a", "b"]);
    const solo: DashboardDocument = { ...structuredClone(doc), layout: { mode: "solo" } };
    expect(Object.keys(layoutDashboard(solo, { w: 1000, h: 500 })).sort()).toEqual(["a", "b"]);
  });
});

describe("§32 placement and chrome", () => {
  it("places the floating tile from its fractions, raises it, and tells the shell its chrome", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    const rect = ops.filter((o) => o.op === "setRect" && o.id === "music").pop();
    expect(rect?.rect).toEqual({ x: 500, y: 250, w: 500, h: 125 });
    expect(ops.some((o) => o.op === "setZ" && o.id === "music" && o.z === 30)).toBe(true);
    const chrome = ops.filter((o) => o.op === "setChrome" && o.id === "music").pop();
    expect(chrome).toMatchObject({ kind: "floating", face: "control" });
    // rects() stays the wall partition
    expect(Object.keys(orchestrator.rects()).sort()).toEqual(["a", "b"]);
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "music")).toMatchObject({ kind: "floating", float: { x: 0.5, y: 0.5, w: 0.5, h: 0.25, face: "control" } });
  });

  it("a resize keeps the place (fractions, not pixels)", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    await orchestrator.resize({ w: 2000, h: 1000 });
    const rect = ops.filter((o) => o.op === "setRect" && o.id === "music").pop();
    expect(rect?.rect).toEqual({ x: 1000, y: 500, w: 1000, h: 250 });
  });

  it("a drag end patches x,y only; a face flip patches face only; both persist and merge", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    expect(await orchestrator.updateTile("music", { float: { x: 0.1, y: 0.2 } })).toBe("ok");
    expect(persisted(store).tiles[2]!.float).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.25, face: "control" });
    expect(ops.filter((o) => o.op === "setRect" && o.id === "music").pop()?.rect).toEqual({ x: 100, y: 100, w: 500, h: 125 });
    await orchestrator.updateTile("music", { float: { face: "page" } });
    expect(persisted(store).tiles[2]!.float?.face).toBe("page");
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ kind: "floating", face: "page" });
  });

  it("clampFloat keeps the floating facet on the wall and no smaller than a control", () => {
    expect(clampFloat(undefined)).toEqual(DEFAULT_FLOAT);
    expect(clampFloat({ x: 0.9, y: 0.95, w: 0.5, h: 0.25 })).toEqual({ x: 0.5, y: 0.75, w: 0.5, h: 0.25, face: "control" });
    expect(clampFloat({ w: 0.01, h: 0.01 })).toMatchObject({ w: 0.12, h: 0.06 });
    expect(clampFloat({ x: -1, y: -1 })).toMatchObject({ x: 0, y: 0 });
  });

  it("Float this slot / Dock into the wall: kind flips reflow the wall and reset the chrome", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    expect(await orchestrator.updateTile("b", { kind: "floating" })).toBe("ok");
    expect(persisted(store).tiles[1]).toMatchObject({ kind: "floating", float: DEFAULT_FLOAT });
    expect(Object.keys(orchestrator.rects())).toEqual(["a"]);                       // the wall reflowed without b
    expect(ops.filter((o) => o.op === "setRect" && o.id === "a").pop()?.rect).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(ops.some((o) => o.op === "setZ" && o.id === "b" && o.z === 30)).toBe(true);
    ops.length = 0;
    expect(await orchestrator.updateTile("b", { kind: null })).toBe("ok");
    expect(persisted(store).tiles[1]!.kind).toBeUndefined();
    expect(Object.keys(orchestrator.rects()).sort()).toEqual(["a", "b"]);
    expect(ops.some((o) => o.op === "setZ" && o.id === "b" && o.z === 0)).toBe(true);
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "b").pop()).toMatchObject({ kind: "slot", face: "page" });
  });
});

describe("§32 now playing", () => {
  it("is kept per tile, exposed in state, pushed to the shell, and cleared on null", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    const info = { playing: true, title: "Song", artist: "Band", artwork: "https://music.test/a.jpg", position: 12, duration: 200, actions: ["nexttrack"] };
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "music", info });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "music")!.nowPlaying).toEqual(info);
    expect(ops.pop()).toMatchObject({ op: "setNowPlaying", id: "music", info });
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "music", info: null });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "music")!.nowPlaying).toBeUndefined();
    expect(ops.pop()).toMatchObject({ op: "setNowPlaying", id: "music", info: null });
  });

  it("the control's taps route page-side through the Media Session handler on a plain music page", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    expect(await orchestrator.tileCommand("music", "next")).toBe("ok");
    const js = String(ops.pop()!.js);
    expect(js).toContain('__prismMediaAction(a)');
    expect(js).toContain('"nexttrack"');
  });
});

describe("§32 catalog", () => {
  it("a floating entry picks as a floating tile with its default place", () => {
    const entry: CatalogEntry = {
      id: "apple-music", name: "Apple Music", url: "https://music.apple.com/", aspectHint: "16:9", audio: "exclusive",
      poster: { source: "site", fallback: "wordmark" }, kind: "floating", float: { x: 0.62, y: 0.76, w: 0.36, h: 0.2, face: "control" },
    };
    const tile = pickerTile(entry);
    expect(tile).toMatchObject({ kind: "floating", float: { x: 0.62, y: 0.76, w: 0.36, h: 0.2, face: "control" }, persist: true, audio: "exclusive" });
    expect(pickerTile({ ...entry, kind: undefined, float: undefined }).kind).toBeUndefined();
  });
});

describe("§32 × §31 popped out: the configure viewfinder and fullscreen show the bare page", () => {
  it("startFraming strips the floating chrome and raises the tile; finishFraming restores place, chrome, and z", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    expect(await orchestrator.startFraming("music")).toBe(true);
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ kind: "slot", face: "page", hidden: false });
    expect(ops.filter((o) => o.op === "setZ" && o.id === "music").pop()?.z).toBe(40);
    expect(ops.filter((o) => o.op === "setRect" && o.id === "music").pop()?.rect).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    ops.length = 0;
    await orchestrator.finishFraming("music", null);
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ kind: "floating", face: "control" });
    expect(ops.filter((o) => o.op === "setZ" && o.id === "music").pop()?.z).toBe(30);
    expect(ops.filter((o) => o.op === "setRect" && o.id === "music").pop()?.rect).toEqual({ x: 500, y: 250, w: 500, h: 125 });
  });

  it("a hidden floating facet popped out is shown; hidden again when it comes back", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    await orchestrator.updateTile("music", { float: { hidden: true } });
    ops.length = 0;
    expect(await orchestrator.enterFullscreen("music")).toBe(true);
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ kind: "slot", hidden: false });
    await orchestrator.exitFullscreen();
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ kind: "floating", hidden: true });
    expect(ops.filter((o) => o.op === "setZ" && o.id === "music").pop()?.z).toBe(30);
  });
});

describe("SM-6 read-alias: the pre-rename tile kind", () => {
  it("a stored tile with kind 'frame' loads as a slot", async () => {
    const { ops, store, orchestrator } = rig();
    const stored = structuredClone(doc) as DashboardDocument;
    (stored.tiles[1] as { kind?: unknown }).kind = "frame";               // the pre-rename spelling, as an old document may carry it
    const before = JSON.stringify(stored);
    await orchestrator.load(stored, { w: 1000, h: 500 });
    expect(Object.keys(orchestrator.rects()).sort()).toEqual(["a", "b"]);   // b is solver input: a wall slot, not floating
    expect(orchestrator.tile("b")?.kind).toBe("slot");                     // read as the new spelling
    expect(tileKind({ kind: "frame" as unknown as "slot" })).toBe("slot");
    expect(aliasTileKind({ id: "x", kind: "frame" })).toEqual({ id: "x", kind: "slot" });
    expect(aliasTileKind({ id: "y", kind: "floating" })).toEqual({ id: "y", kind: "floating" });
    expect(JSON.stringify(stored)).toBe(before);                           // §10: the source document was not rewritten by loading
    expect(ops.some((o) => o.op === "setChrome" && o.kind === "frame")).toBe(false);   // the wire carries the new spelling only
    expect(store.has("dashboard")).toBe(false);                            // loading alone persists nothing
  });
});
