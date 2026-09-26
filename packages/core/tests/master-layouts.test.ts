import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FLOAT, Orchestrator, masterDocument, normalizeMasterLayout } from "../src/orchestrator.js";
import { layoutDashboard } from "../src/layout.js";
import type { Drivers } from "../src/drivers.js";
import { SLOT_PURPOSES, type DashboardDocument, type MasterLayout } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// §33 master layouts: a wall without apps - slots with a shape and a
// purpose, saved by name; applied, apps fill the slots and the rest are
// empty slots (placeholder tiles) until an app is chosen.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, placeholder: o.placeholder ?? false, label: o.label }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {},
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
      setViewport: () => {},
      setChrome: (id, kind, face, hidden) => void ops.push({ op: "setChrome", id, kind, face, hidden }),
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
    { id: "c", url: "https://c.test", audio: "mute" },
  ],
};

const movieNight: MasterLayout = {
  id: "ml-movie",
  label: "Movie night",
  mode: "hero",
  heroSize: 0.7,
  gap: 8,
  slots: [
    { id: "main", purpose: "video", aspectHint: "16:9", hero: true },
    { id: "side", purpose: "web", aspectHint: "16:10" },
    { id: "music", purpose: "control", kind: "floating", float: { x: 0.6, y: 0.7, w: 0.4, h: 0.3 } },
  ],
};

const persisted = (store: Map<string, string>) => JSON.parse(store.get("dashboard")!) as DashboardDocument;

describe("§33 normalize", () => {
  it("shapes untrusted input: ids unique, bad aspects dropped, floats clamped, limits enforced", () => {
    const ml = normalizeMasterLayout({ label: "  x ", mode: "grid", cols: 3, rows: 2, slots: [{ purpose: "video", aspectHint: "16:9" }, { id: "slot-1", aspectHint: "nope" }, { kind: "floating", float: { x: 2, w: 0.3 } }] })!;
    expect(ml.label).toBe("x");
    expect(ml.mode).toBe("grid");
    expect(ml.cols).toBe(3);
    expect(ml.slots.map((s) => s.id)).toEqual(["slot-1", "slot-1-2", "slot-3"]);
    expect(ml.slots[1]!.aspectHint).toBeUndefined();
    expect(ml.slots[2]!.float).toMatchObject({ x: 0.7, w: 0.3 });
    expect(normalizeMasterLayout({ slots: [] })).toBeNull();
    expect(normalizeMasterLayout("junk")).toBeNull();
  });

  it("every purpose but custom names a valid aspect", () => {
    for (const p of SLOT_PURPOSES) if (p.id !== "custom") expect(p.aspect).toMatch(/^\d+:\d+$/);
    expect(SLOT_PURPOSES.find((p) => p.id === "control")?.floating).toBe(true);
  });
});

describe("§33 masterDocument", () => {
  it("apps fill wall slots in order, floating apps the floating slots, the rest are placeholders; extras leave", () => {
    const apps = [
      { id: "hulu", url: "https://hulu.test", audio: "exclusive" as const },
      { id: "news", url: "https://news.test", audio: "mute" as const, area: "1 / 1 / 2 / 2", aspectHint: "4:3" },
      { id: "extra", url: "https://extra.test", audio: "mute" as const },
    ];
    const d = masterDocument(movieNight, "wall", apps, doc);
    expect(d.tiles.map((t) => t.id)).toEqual(["hulu", "news", "music"]);
    expect(d.tiles[0]).toMatchObject({ url: "https://hulu.test", aspectHint: "16:9" });
    expect(d.tiles[1]).toMatchObject({ url: "https://news.test", aspectHint: "16:10" });
    expect(d.tiles[1]!.area).toBeUndefined();                                        // hero mode: no lattice areas
    expect(d.tiles[2]).toMatchObject({ placeholder: true, kind: "floating", float: { x: 0.6, y: 0.7, w: 0.4, h: 0.3 }, audio: "mute" });
    expect(d.layout).toEqual({ mode: "hero", hero: "hulu", heroSize: 0.7, satellites: "auto", gap: 8 });
    expect(d.name).toBe("Wall");
  });

  it("grid mode auto-flows wall slots into the lattice; the hero slot is honored in hero mode", () => {
    const g: MasterLayout = { id: "g", label: "Four up", mode: "grid", cols: 2, rows: 2, slots: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, purpose: "video", aspectHint: "16:9" })) };
    const d = masterDocument(g, "wall", []);
    expect(d.tiles.map((t) => t.area)).toEqual(["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3"]);
    expect(d.tiles.every((t) => t.placeholder)).toBe(true);
    expect(Object.keys(layoutDashboard(d, { w: 1000, h: 500 })).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    const h = masterDocument({ ...movieNight, slots: [{ id: "x", purpose: "web" }, { id: "y", purpose: "video", hero: true }] }, "wall", []);
    expect((h.layout as { hero: string }).hero).toBe("y");
  });

  it("placeholder ids never collide with an app that stays", () => {
    const d = masterDocument({ ...movieNight, slots: [{ id: "a", purpose: "video" }, { id: "a", purpose: "web" }] }, "wall", [{ id: "a", url: "https://a.test" }]);
    expect(d.tiles.map((t) => t.id)).toEqual(["a", "a-2"]);
  });
});

describe("§33 orchestrator", () => {
  it("save / list / remove persist under masterlayouts and appear in state", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    expect(await orchestrator.saveMasterLayout(movieNight)).toBe("ok");
    expect(await orchestrator.saveMasterLayout({ label: "Two", slots: [{ purpose: "video" }] })).toBe("ok");
    expect(await orchestrator.saveMasterLayout({ slots: [] })).toBe("invalid");
    const list = orchestrator.listMasterLayouts();
    expect(list.map((m) => m.id)).toEqual(["ml-movie", "ml-1"]);
    expect(JSON.parse(store.get("masterlayouts")!)).toHaveLength(2);
    expect(orchestrator.getState()!.masterLayouts?.map((m) => m.label)).toEqual(["Movie night", "Two"]);
    // upsert by id
    await orchestrator.saveMasterLayout({ ...movieNight, label: "Movie night 2" });
    expect(orchestrator.listMasterLayouts()).toHaveLength(2);
    expect(await orchestrator.removeMasterLayout("ml-1")).toBe("ok");
    expect(await orchestrator.removeMasterLayout("ml-1")).toBe("unknown");
    // a fresh orchestrator reads them back
    const again = rig();
    again.store.set("masterlayouts", store.get("masterlayouts")!);
    await again.orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    expect(again.orchestrator.listMasterLayouts().map((m) => m.label)).toEqual(["Movie night 2"]);
  });

  it("previewLayout is the solver at the given viewport, floats at their fractions, unplaced named", () => {
    const { orchestrator } = rig();
    const p = orchestrator.previewLayout(movieNight, { w: 1000, h: 500 })!;
    expect(Object.keys(p.rects).sort()).toEqual(["main", "side"]);
    expect(p.rects).toEqual(layoutDashboard(masterDocument(movieNight, "preview", []), { w: 1000, h: 500 }));
    expect(p.floats.music).toEqual({ x: 600, y: 350, w: 400, h: 150 });
    expect(p.unplaced).toEqual([]);
    const tight = orchestrator.previewLayout({ label: "1x1", mode: "grid", cols: 1, rows: 1, slots: [{ id: "p", purpose: "video" }, { id: "q", purpose: "video" }] }, { w: 1000, h: 500 })!;
    expect(tight.unplaced).toEqual(["q"]);
    expect(orchestrator.previewLayout(null, { w: 1, h: 1 })).toBeNull();
  });

  it("applyMasterLayout: apps fill slots, placeholders are created and revealed, extras leave, hero follows", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    await orchestrator.saveMasterLayout(movieNight);
    ops.length = 0;
    expect(await orchestrator.applyMasterLayout("ml-movie")).toBe("ok");
    const d = persisted(store);
    expect(d.tiles.map((t) => t.id)).toEqual(["a", "b", "music"]);
    expect(d.tiles[0]!.aspectHint).toBe("16:9");
    expect(d.tiles[2]).toMatchObject({ placeholder: true, kind: "floating" });
    expect(ops.some((o) => o.op === "destroy" && o.id === "c")).toBe(true);                        // beyond the slots
    expect(ops.find((o) => o.op === "create" && o.id === "music")).toMatchObject({ placeholder: true, label: "" });
    expect(ops.some((o) => o.op === "reveal" && o.id === "music")).toBe(true);                     // no load path
    expect(ops.some((o) => o.op === "navigate" && o.id === "music")).toBe(false);
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ kind: "floating", face: "control", hidden: false });
    const st = orchestrator.getState()!;
    expect(st.hero).toBe("a");
    expect(st.heroSize).toBe(0.7);
    expect(st.tiles.find((t) => t.id === "music")).toMatchObject({ placeholder: true, kind: "floating" });
    expect(Object.keys(orchestrator.rects()).sort()).toEqual(["a", "b"]);
    expect(await orchestrator.applyMasterLayout("nope")).toBe("unknown");
  });

  it("choosing an app for an empty slot keeps the slot's shape and place", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    await orchestrator.saveMasterLayout({ ...movieNight, id: "ml-x", slots: [{ id: "main", purpose: "video", aspectHint: "16:9", hero: true }, { id: "tall", purpose: "vertical", aspectHint: "9:16" }, { id: "music", purpose: "control", kind: "floating" }] });
    // only one app on the wall → "tall" and "music" are empty
    await orchestrator.removeTile("b");
    await orchestrator.removeTile("c");
    await orchestrator.applyMasterLayout("ml-x");
    expect(persisted(store).tiles.map((t) => t.id)).toEqual(["a", "tall", "music"]);
    expect(await orchestrator.replaceTile("tall", { id: "shorts", url: "https://shorts.test", audio: "mute", aspectHint: "16:9" })).toBe("ok");
    const t = persisted(store).tiles[1]!;
    expect(t).toMatchObject({ id: "shorts", aspectHint: "9:16" });
    expect(t.placeholder).toBeUndefined();
    expect(await orchestrator.replaceTile("music", { id: "spotify", url: "https://open.spotify.test", audio: "exclusive" })).toBe("ok");
    expect(persisted(store).tiles[2]).toMatchObject({ id: "spotify", kind: "floating", float: DEFAULT_FLOAT });
  });

  it("a placeholder never gets a viewfinder; a hidden floating facet reaches the shell as hidden", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    await orchestrator.saveMasterLayout(movieNight);
    await orchestrator.applyMasterLayout("ml-movie");
    expect(await orchestrator.startFraming("music")).toBe(false);
    ops.length = 0;
    await orchestrator.updateTile("music", { float: { hidden: true } });
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ hidden: true });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "music")!.float!.hidden).toBe(true);
    await orchestrator.updateTile("music", { float: { hidden: false } });
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "music").pop()).toMatchObject({ hidden: false });
  });
});
