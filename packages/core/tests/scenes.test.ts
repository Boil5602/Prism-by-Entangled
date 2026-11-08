import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator, SHAPE_TOLERANCE, normalizeScene } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument, MasterLayout } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// §34 views & scenes: the app registry, the slot shapes the layouts define,
// near-duplicate layouts, and scenes that materialize a wall from registry
// apps + their views.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, profile: o.profile, placeholder: !!o.placeholder }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {},
      reveal: () => {},
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
      setViewport: () => {},
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
  layout: { mode: "hero", hero: "hulu", heroSize: 0.62, satellites: "auto", gap: 0 },
  tiles: [
    { id: "hulu", url: "https://www.hulu.com/hub/home", audio: "exclusive", adapter: "hulu", veil: { mode: "veil-only" } },
    { id: "news", url: "https://news.example.com/", audio: "mute" },
    { id: "spotify", url: "https://open.spotify.com/", audio: "exclusive", kind: "floating", float: { x: 0.6, y: 0.7, w: 0.4, h: 0.3 } },
  ],
};

const movieNight: MasterLayout = {
  id: "ml-movie", label: "Movie night", mode: "hero", heroSize: 0.7, gap: 8,
  slots: [
    { id: "main", purpose: "video", aspectHint: "16:9", hero: true },
    { id: "side", purpose: "web", aspectHint: "16:10" },
    { id: "music", purpose: "control", kind: "floating", float: { x: 0.6, y: 0.7, w: 0.4, h: 0.3, hidden: true } },
  ],
};

const persisted = (store: Map<string, string>) => JSON.parse(store.get("dashboard")!) as DashboardDocument;

describe("§34 the app registry", () => {
  it("learns every app on the wall (key, pretty name, base tile, first profile) and the catalog name on a pick", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    const apps = orchestrator.knownApps();
    expect(apps.map((a) => a.id)).toEqual(["hulu", "news-example", "open-spotify"]);
    expect(apps[0]).toMatchObject({ name: "Hulu", tile: { url: "https://www.hulu.com/hub/home", adapter: "hulu", audio: "exclusive", profile: "hulu" } });
    expect(apps[2]!.tile).toMatchObject({ kind: "floating" });
    expect(JSON.parse(store.get("apps")!)).toHaveLength(3);
    await orchestrator.addTile({ id: "peacock", url: "https://www.peacocktv.com/", audio: "exclusive", adapter: "peacock" }, "Peacock TV");
    expect(orchestrator.knownApps().find((a) => a.id === "peacock")).toMatchObject({ name: "Peacock TV" });
    // the registry survives the app leaving the wall
    await orchestrator.removeTile("peacock");
    expect(orchestrator.knownApps().some((a) => a.id === "peacock")).toBe(true);
    const st = orchestrator.getState()!;
    expect(st.apps?.map((a) => a.id)).toContain("peacock");
    expect(st.apps?.find((a) => a.id === "open-spotify")?.floating).toBe(true);
  });

  it("§34.1 Save & close: updateTile {url, home} makes the page the app's home (registry) without a reload; a plain url change does not", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    ops.length = 0;
    // navigating a slot (a view, a Go) changes the tile, not the app
    expect(await orchestrator.updateTile("hulu", { url: "https://www.hulu.com/live" })).toBe("ok");
    expect(orchestrator.knownApps().find((a) => a.id === "hulu")!.tile.url).toBe("https://www.hulu.com/hub/home");
    expect(ops.some((o) => o.op === "navigate" && o.id === "hulu" && o.url === "https://www.hulu.com/live")).toBe(true);
    ops.length = 0;
    // Save & close on the page already showing: app home + tile url persist, no reload, resume agrees
    expect(await orchestrator.updateTile("hulu", { url: "https://www.hulu.com/my-stuff", home: true, reload: false })).toBe("ok");
    expect(orchestrator.knownApps().find((a) => a.id === "hulu")!.tile.url).toBe("https://www.hulu.com/my-stuff");
    expect(JSON.parse(store.get("apps")!).find((a: { id: string }) => a.id === "hulu").tile.url).toBe("https://www.hulu.com/my-stuff");
    expect(persisted(store).tiles[0]!.url).toBe("https://www.hulu.com/my-stuff");
    expect(store.get("tile:lasturl:wall:hulu")).toBe("https://www.hulu.com/my-stuff");
    expect(ops.some((o) => o.op === "navigate" && o.id === "hulu")).toBe(false);
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "hulu")!.url).toBe("https://www.hulu.com/my-stuff");
  });
});

describe("§34 slot shapes from the layouts", () => {
  it("groups aspects within the tolerance, floating apart, with layout counts and the largest sample", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    expect(orchestrator.slotShapes({ w: 1000, h: 500 })).toEqual([expect.objectContaining({ aspect: "16:9", layouts: 0 })]);   // nothing saved: 16:9 alone
    await orchestrator.saveMasterLayout(movieNight);
    await orchestrator.saveMasterLayout({ id: "ml-2", label: "Two", mode: "grid", cols: 2, rows: 1, slots: [{ id: "l", purpose: "video", aspectHint: "7:4" }, { id: "r", purpose: "web", aspectHint: "16:10" }] });
    const shapes = orchestrator.slotShapes({ w: 1000, h: 500 });
    expect(shapes.map((s) => [s.aspect, s.layouts, s.floating])).toEqual([["16:9", 2, false], ["16:10", 2, false], ["16:5", 1, true]]);   // 7:4 ≈ 16:9 (1.6% apart)
    expect(shapes[0]!.sample.w).toBeGreaterThan(0);
    expect(Math.abs(16 / 9 - 7 / 4) / (16 / 9)).toBeLessThan(SHAPE_TOLERANCE);
    expect(Math.abs(16 / 9 - 16 / 10) / (16 / 9)).toBeGreaterThan(SHAPE_TOLERANCE);
    expect(orchestrator.getState()!.slotShapes?.length).toBe(3);
  });
});

describe("§33 near-duplicate layouts", () => {
  it("flags a saved layout whose slots all overlap the draft's; a different arrangement is not flagged", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    await orchestrator.saveMasterLayout(movieNight);
    const nearly = { ...movieNight, id: "", label: "Movie night again", heroSize: 0.71 };
    expect(orchestrator.similarLayouts(nearly, { w: 1000, h: 500 })).toEqual([{ id: "ml-movie", label: "Movie night" }]);
    const different = { label: "Halves", mode: "grid", cols: 2, rows: 1, slots: [{ id: "l", purpose: "video" }, { id: "r", purpose: "video" }] };
    expect(orchestrator.similarLayouts(different, { w: 1000, h: 500 })).toEqual([]);
    // the same id is never its own duplicate (editing a saved layout)
    expect(orchestrator.similarLayouts(movieNight, { w: 1000, h: 500 })).toEqual([]);
  });
});

describe("§34 scenes", () => {
  it("normalize: layoutId required, slot entries shaped, junk dropped", () => {
    expect(normalizeScene({ label: "x", slots: {} })).toBeNull();
    const s = normalizeScene({ layoutId: "ml-movie", slots: { main: { app: "hulu", view: "home" }, side: { app: "" }, music: null, junk: 5 } })!;
    expect(s.slots).toEqual({ main: { app: "hulu", view: "home" }, side: null, music: null, junk: null });
    expect(s.label).toBe("Untitled scene");
  });

  it("save / list / remove persist; the layout must exist", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    expect(await orchestrator.saveScene({ label: "Evening", layoutId: "nope", slots: {} })).toBe("unknown-layout");
    await orchestrator.saveMasterLayout(movieNight);
    expect(await orchestrator.saveScene({ label: "Evening", layoutId: "ml-movie", slots: { main: { app: "hulu" } } })).toBe("ok");
    expect(orchestrator.listScenes().map((s) => s.id)).toEqual(["scene-1"]);
    expect(JSON.parse(store.get("scenes")!)).toHaveLength(1);
    expect(orchestrator.getState()!.scenes?.[0]).toMatchObject({ id: "scene-1", label: "Evening" });
    expect(await orchestrator.removeScene("scene-1")).toBe("ok");
    expect(await orchestrator.removeScene("scene-1")).toBe("unknown");
  });

  it("applyScene materializes the wall: registry apps with their views, the slot's shape and place, shared profiles, empty slots, the hero", async () => {
    const { ops, store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    // a Hulu view for 16:9 slots: the live-guide page with a region
    await orchestrator.saveShortcut("hulu", { label: "Live guide", url: "https://www.hulu.com/live", focus: { region: { x: 10, y: 20, w: 800, h: 450 }, viewport: { w: 1600, h: 900 } }, aspectHint: "16:9" });
    const view = orchestrator.getState()!.appViews!.hulu[0]!;
    await orchestrator.saveMasterLayout(movieNight);
    // news leaves the wall first: the registry still knows it
    await orchestrator.removeTile("news");
    await orchestrator.saveScene({ id: "scene-a", label: "Evening", layoutId: "ml-movie", slots: { main: { app: "hulu", view: view.id }, side: { app: "news-example" }, music: { app: "open-spotify" } } });
    ops.length = 0;
    expect(await orchestrator.applyScene("scene-a")).toBe("ok");
    const d = persisted(store);
    expect(d.tiles.map((t) => t.id)).toEqual(["hulu", "news-example", "open-spotify"]);
    expect(d.tiles[0]).toMatchObject({ url: "https://www.hulu.com/live", adapter: "hulu", aspectHint: "16:9", profile: "hulu", focus: { region: { x: 10, y: 20, w: 800, h: 450 } } });
    expect(d.tiles[1]).toMatchObject({ url: "https://news.example.com/", aspectHint: "16:10", profile: "news" });   // its first profile, not its new id
    expect(d.tiles[1]!.focus).toBeUndefined();
    expect(d.tiles[2]).toMatchObject({ kind: "floating", float: { x: 0.6, y: 0.7, w: 0.4, h: 0.3, hidden: true }, profile: "spotify" });
    expect(d.layout).toMatchObject({ mode: "hero", hero: "hulu", heroSize: 0.7 });
    expect(ops.find((o) => o.op === "create" && o.id === "news-example")).toMatchObject({ profile: "news", placeholder: false });
    expect(ops.filter((o) => o.op === "setChrome" && o.id === "open-spotify").pop()).toMatchObject({ kind: "floating", hidden: true });
    const st = orchestrator.getState()!;
    expect(st.currentScene).toBe("scene-a");
    expect(st.hero).toBe("hulu");
    expect(store.get("scene:current")).toBe("scene-a");
  });

  it("an unassigned or unknown slot stays empty; the same app twice gets distinct ids and one profile", async () => {
    const { store, orchestrator } = rig();
    await orchestrator.load(structuredClone(doc), { w: 1000, h: 500 });
    await orchestrator.saveMasterLayout(movieNight);
    await orchestrator.saveScene({ id: "s", label: "S", layoutId: "ml-movie", slots: { main: { app: "hulu" }, side: { app: "hulu" }, music: { app: "ghost" } } });
    expect(await orchestrator.applyScene("s")).toBe("ok");
    const d = persisted(store);
    expect(d.tiles.map((t) => t.id)).toEqual(["hulu", "hulu-2", "music"]);
    expect(d.tiles[1]!.profile).toBe("hulu");
    expect(d.tiles[2]).toMatchObject({ placeholder: true, kind: "floating" });
    expect(await orchestrator.applyScene("missing")).toBe("unknown");
  });
});
