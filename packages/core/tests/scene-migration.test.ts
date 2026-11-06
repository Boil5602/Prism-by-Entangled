import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCENE_MODEL_KEYS, appKeyOf, assertWritesOnlyNewKeys, inferCanvasFromBoot, migrateStore, storeData } from "../src/scene-migration.js";
import { denormalizeRect, normalizeApp, normalizeFacet, normalizeLayout, normalizeScene, sceneDocument, type Facet, type Layout, type Scene } from "../src/scene-model.js";
import { layoutDashboard } from "../src/layout.js";
import type { DashboardDocument, MasterLayout } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(readFileSync(join(here, "fixtures/store-m1-demo.json"), "utf8")) as { data: Record<string, string> };

/** Solve the migrated scene back to device rects and compare with the source document's solve. */
function roundTrip(data: Record<string, string>, opts: Parameters<typeof migrateStore>[1] = {}) {
  const r = migrateStore(data, opts);
  const doc = JSON.parse(data.dashboard!) as DashboardDocument;
  const canvas = { w: r.report.canvas.w, h: r.report.canvas.h };
  const override = data[`layout:${doc.id}`] ? JSON.parse(data[`layout:${doc.id}`]!) : {};
  const before = layoutDashboard(doc, canvas, override);
  const scene = r.model.scenes.find((s) => s.id === doc.id)!;
  const layout = r.model.layouts.find((l) => l.id === scene.layout)!;
  const { doc: after, notes } = sceneDocument({ scene, layout, facets: r.model.facets, apps: r.model.apps }, doc.id, canvas);
  const rects = layoutDashboard(after, canvas);
  return { r, doc, canvas, before, after, rects, notes, scene, layout };
}

describe("scene-model §7 migration — the real config (copy)", () => {
  it("reads the store file wrapper and infers the canvas from host.boot", () => {
    expect(Object.keys(storeData(REAL))).toContain("dashboard");
    expect(inferCanvasFromBoot(REAL.data["host.boot"])).toEqual({ w: 2558, h: 1353 });
  });
  it("creates one App + one Facet per tile, one Layout + one Scene for the dashboard, and reports it", () => {
    const { r } = roundTrip(REAL.data);
    expect(r.report.canvas).toEqual({ w: 2558, h: 1353, source: "inferred:host.boot" });
    // 6 tiles on the wall (peacock carries a stale `float` but is not kind: floating) + the registry's off-wall apple music app
    expect(r.model.apps.map((a) => a.id).sort()).toEqual(["hulu", "music-apple", "netflix", "paramountplus", "peacock", "twitch", "youtube"]);
    expect(r.model.facets).toHaveLength(6);
    expect(r.model.layouts).toHaveLength(1);
    expect(r.model.scenes).toHaveLength(1);
    expect(r.report.created).toEqual({ apps: 7, facets: 6, layouts: 1, scenes: 1 });
    expect(r.model.activeScene).toBe("m1-demo");
    // the persisted hero override (hulu @ 0.59) wins over the document's (netflix @ 0.62)
    expect(r.model.layouts[0]!.source).toEqual({ mode: "hero", hero: "hulu", heroSize: 0.59, satellites: "auto" });
    // inferred classes are listed for review, one per assigned slot
    expect(r.report.inferred.map((i) => `${i.tile}:${i.class}`).sort()).toEqual([
      "hulu:16:9·XL", "netflix:21:9-strip·M", "paramountplus:3:2·M", "peacock:3:2·M", "twitch:21:9-strip·M", "youtube:21:9-strip·M",
    ]);
    // orphans are reported, not migrated
    expect(r.report.ambiguous.filter((a) => a.includes("hulu-2") || a.includes("apple-music"))).toHaveLength(2);
    expect(r.report.lastPages.filter((p) => p.orphan).map((p) => p.tile).sort()).toEqual(["apple-music", "hulu-2"]);
    expect(r.report.lastPages.find((p) => p.tile === "netflix")).toMatchObject({ url: "https://www.netflix.com/browse", orphan: false });
  });
  it("round-trips: solving the produced Layout + Scene reproduces every tile's rect, url, focus, zoom, profile", () => {
    const { doc, before, rects, after, notes } = roundTrip(REAL.data);
    expect(notes).toEqual([]);
    expect(Object.keys(rects).sort()).toEqual(Object.keys(before).sort());
    for (const t of doc.tiles) {
      const a = before[t.id]!, b = rects[t.id]!;
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(a[k] - b[k]), `${t.id}.${k}`).toBeLessThan(1e-6);
      const tile = after.tiles.find((x) => x.id === t.id)!;
      expect(tile.url, t.id).toBe(t.url);
      expect(tile.focus ?? null, t.id).toEqual(t.focus ?? null);
      expect(tile.zoom ?? 1, t.id).toBe(t.zoom ?? 1);
      expect(tile.profile, t.id).toBe(t.profile ?? t.id);
      expect(tile.adapter ?? null, t.id).toBe(t.adapter ?? null);
      expect(tile.audio ?? null, t.id).toBe(t.audio ?? null);
      expect(tile.intermission ?? null, t.id).toEqual(t.intermission ?? null);
      expect(tile.veil ?? null, t.id).toEqual(t.veil ?? null);
      expect(tile.viewport ?? null, t.id).toBe(t.viewport ?? null);
    }
  });
  it("writes ONLY new keys (§10): every source key untouched, every write under scene-model:", () => {
    const { r } = roundTrip(REAL.data);
    expect(Object.keys(r.writes).sort()).toEqual(Object.values(SCENE_MODEL_KEYS).sort());
    for (const k of Object.keys(r.writes)) expect(k in REAL.data).toBe(false);
    expect(r.report.sourceKeys).toEqual(["apps", "dashboard", "host.boot", "layout:m1-demo", "tile:lasturl:m1-demo:apple-music", "tile:lasturl:m1-demo:hulu", "tile:lasturl:m1-demo:hulu-2", "tile:lasturl:m1-demo:netflix", "tile:lasturl:m1-demo:paramountplus", "tile:lasturl:m1-demo:peacock", "tile:lasturl:m1-demo:twitch", "tile:lasturl:m1-demo:youtube"]);
    expect(() => assertWritesOnlyNewKeys({ dashboard: "x" }, { dashboard: "y" })).toThrow(/never rewrite/);
    // the written JSON re-validates through the model's own normalizers
    for (const a of JSON.parse(r.writes[SCENE_MODEL_KEYS.apps]!)) expect(normalizeApp(a)).toEqual(a);
    for (const f of JSON.parse(r.writes[SCENE_MODEL_KEYS.facets]!)) expect(normalizeFacet(f)).toEqual(f);
    for (const l of JSON.parse(r.writes[SCENE_MODEL_KEYS.layouts]!)) expect(normalizeLayout(l)).toEqual(l);
    for (const s of JSON.parse(r.writes[SCENE_MODEL_KEYS.scenes]!)) expect(normalizeScene(s)).toEqual(s);
    expect(JSON.parse(r.writes[SCENE_MODEL_KEYS.migration]!).schema).toBe("prism.scene-model-migration/v0.1");
  });
  it("is deterministic and never invents standing instructions", () => {
    const a = migrateStore(REAL.data, { now: "t" }), b = migrateStore(REAL.data, { now: "t" });
    expect(a).toEqual(b);
    for (const s of a.model.scenes) expect(s.settings).toBeUndefined();
  });
  it("app identity follows the old registry key: adapter id, else host slug", () => {
    expect(appKeyOf({ id: "t", adapter: "hulu", url: "https://x/" })).toBe("hulu");
    expect(appKeyOf({ id: "t", url: "https://www.netflix.com/" })).toBe("netflix");
    expect(appKeyOf({ id: "t" })).toBe("t");
  });
});

// --------------------------------------------------------------- synthetic: floating / hidden / placeholders / master layouts / scenes v0 / shortcuts
const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1", id: "wall", name: "Wall",
  layout: { mode: "hero", hero: "hulu", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "hulu", url: "https://www.hulu.com/hub/home", adapter: "hulu", audio: "exclusive", aspectHint: "16:9", profile: "hulu", zoom: 1.2, focus: { region: { x: 10, y: 0, w: 2415, h: 1353 }, viewport: { w: 2558, h: 1353 } } },
    { id: "news", url: "https://news.example.com/", audio: "mute", touch: "scroll", refresh: 900, aspectHint: "3:4" },
    { id: "slot-3", placeholder: true, aspectHint: "1:1", audio: "mute" },
    { id: "spotify", url: "https://open.spotify.com/", audio: "exclusive", kind: "floating", float: { x: 0.6, y: 0.7, w: 0.38, h: 0.28, face: "control" } },
    { id: "radio", url: "https://radio.example.com/", audio: "exclusive", kind: "floating", float: { x: 0.1, y: 0.1, w: 0.3, h: 0.2, hidden: true } },
    { id: "hulu-2", url: "https://www.hulu.com/live", adapter: "hulu", audio: "mute", profile: "hulu-kids" },
  ],
};
const ml: MasterLayout = {
  id: "movie", label: "Movie night", mode: "hero", heroSize: 0.7, gap: 8,
  slots: [{ id: "main", purpose: "video", aspectHint: "16:9", hero: true }, { id: "side", purpose: "web", aspectHint: "16:10" }, { id: "music", purpose: "control", kind: "floating", float: { x: 0.6, y: 0.7, w: 0.4, h: 0.3 } }],
};
const synthetic: Record<string, string> = {
  dashboard: JSON.stringify(doc),
  "layout:wall": JSON.stringify({ hero: "hulu", heroSize: 0.6 }),
  apps: JSON.stringify([
    { id: "hulu", name: "Hulu", tile: { id: "hulu", url: "https://www.hulu.com/hub/home", profile: "hulu", adapter: "hulu", audio: "exclusive", aspectHint: "16:9" } },
    { id: "open-spotify", name: "Spotify", tile: { id: "open-spotify", url: "https://open.spotify.com/", profile: "open-spotify", audio: "exclusive", kind: "floating" } },
    { id: "news-example", name: "Example News", tile: { id: "news-example", url: "https://news.example.com/", profile: "news", audio: "mute" } },
  ]),
  "shortcuts:hulu": JSON.stringify([{ id: "live-guide", label: "Live guide", url: "https://www.hulu.com/live", focus: { selector: ".LiveGuide", pad: 8 }, aspectHint: "16:9" }]),
  masterlayouts: JSON.stringify([ml]),
  scenes: JSON.stringify([{ id: "evening", label: "Evening", layoutId: "movie", slots: { main: { app: "hulu", view: "live-guide" }, side: { app: "news-example" }, music: { app: "open-spotify" } } }]),
  "scene:current": "evening",
  "tile:lasturl:wall:hulu": "https://www.hulu.com/watch/abc",
};

describe("scene-model §7 migration — every old shape", () => {
  const r = migrateStore(synthetic, { canvas: { w: 1920, h: 1080 }, now: "t" });
  const facet = (id: string): Facet => r.model.facets.find((f) => f.id === id)!;
  const layout = (id: string): Layout => r.model.layouts.find((l) => l.id === id)!;
  const scene = (id: string): Scene => r.model.scenes.find((s) => s.id === id)!;

  it("floating → scene.floating with the exact rect kept; hidden → scene.hidden; neither occupies a slot", () => {
    const s = scene("wall");
    expect(layout("wall-layout").slots.map((x) => x.id).sort()).toEqual(["hulu", "hulu-2", "news", "slot-3"]);
    expect(s.floating).toHaveLength(1);
    expect(s.floating[0]).toMatchObject({ anchor: "bottom-right", size: 0.38, rect: { x: 0.6, y: 0.7, w: 0.38, h: 0.28 }, face: "control" });
    expect(facet(s.floating[0]!.facet!)).toMatchObject({ app: "open-spotify", url: "https://open.spotify.com/", slotClass: "21:9-strip·M" });
    expect(s.hidden).toEqual([{ facet: expect.stringMatching(/^radio-/), audio: "exclusive" }]);
    expect(facet(s.hidden[0]!.facet).app).toBe("radio-example");
  });
  it("placeholders become unassigned slots; a second profile of one app is a second App (reported)", () => {
    const s = scene("wall");
    expect(s.assign["slot-3"]).toBeUndefined();
    expect(Object.keys(s.assign).sort()).toEqual(["hulu", "hulu-2", "news"]);
    expect(facet(s.assign["hulu-2"]!).app).toBe("hulu-hulu-kids");
    expect(r.model.apps.find((a) => a.id === "hulu-hulu-kids")).toMatchObject({ profileId: "hulu-kids", adapter: "hulu" });
    expect(r.report.ambiguous.some((a) => a.includes('separate App "hulu-hulu-kids"'))).toBe(true);
  });
  it("facets keep the tile's page, focus, zoom, audio, touch, refresh; the app keeps the profile and adapter", () => {
    const f = facet(scene("wall").assign.hulu!);
    expect(f).toMatchObject({ app: "hulu", url: "https://www.hulu.com/hub/home", zoom: 1.2, focus: doc.tiles[0]!.focus, aspectHint: "16:9", slotClass: "16:9·XL" });
    expect(facet(scene("wall").assign.news!)).toMatchObject({ touch: "scroll", refresh: 900, label: "Example News" });
    expect(r.model.apps.find((a) => a.id === "news-example")?.render?.audio).toBe("mute"); // inherited by every facet of the app
    expect(r.model.apps.find((a) => a.id === "hulu")).toMatchObject({ name: "Hulu", profileId: "hulu", adapter: "hulu", catalogRef: "hulu", baseUrl: "https://www.hulu.com/hub/home" });
  });
  it("master layouts → Layouts (floating slots noted as scene-level); scenes v0 → Scenes over them; views → facets", () => {
    const l = layout("ml-movie");
    expect(l.slots.map((x) => x.id)).toEqual(["main", "side"]);
    expect(l.source).toEqual({ mode: "hero", hero: "main", heroSize: 0.7, satellites: "auto" });
    const s = scene("v0-evening");
    expect(s.layout).toBe("ml-movie");
    expect(facet(s.assign.main!)).toMatchObject({ app: "hulu", url: "https://www.hulu.com/live", focus: { selector: ".LiveGuide", pad: 8 }, label: "Hulu · Live guide" });
    expect(facet(s.assign.side!)).toMatchObject({ app: "news-example", url: "https://news.example.com/" });
    expect(s.floating[0]).toMatchObject({ rect: { x: 0.6, y: 0.7, w: 0.4, h: 0.3 } });
    expect(r.model.activeScene).toBe("v0-evening");
    expect(r.report.ambiguous.some((a) => a.startsWith("master layout movie: 1 floating slot"))).toBe(true);
  });
  it("shortcuts → facets of their app, deduplicated against identical faces, tier inferred and reported", () => {
    const hulu = r.model.facets.filter((f) => f.app === "hulu");
    // home (wall), live guide (scene v0 main slot) — the shortcut is that same face, so no third facet
    expect(hulu.map((f) => f.url).sort()).toEqual(["https://www.hulu.com/hub/home", "https://www.hulu.com/live"]);
    expect(r.report.ambiguous.some((a) => a.startsWith("shortcut hulu/live-guide"))).toBe(true);
  });
  it("round-trips the synthetic wall too (rects, floats, hidden)", () => {
    const { before, rects, after, notes } = roundTrip(synthetic, { canvas: { w: 1920, h: 1080 } });
    expect(notes).toEqual([]);
    for (const id of Object.keys(before)) for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(before[id]![k] - rects[id]![k]), `${id}.${k}`).toBeLessThan(1e-6);
    expect(after.tiles.find((t) => t.url === "https://open.spotify.com/")?.float).toEqual({ x: 0.6, y: 0.7, w: 0.38, h: 0.28, face: "control" });
    expect(after.tiles.find((t) => t.url === "https://radio.example.com/")?.float?.hidden).toBe(true);
    expect(after.tiles.find((t) => t.id === "slot-3")).toMatchObject({ placeholder: true, aspectHint: "3:4" });
  });
  it("solo dashboards become one full-canvas layout and one scene per app", () => {
    const solo = migrateStore({ dashboard: JSON.stringify({ ...doc, id: "one", layout: { mode: "solo" } }) }, { canvas: { w: 1920, h: 1080 } });
    expect(solo.model.layouts[0]!.slots).toEqual([{ id: "solo", rect: { x: 0, y: 0, w: 1, h: 1 }, class: "16:9·XL" }]);
    expect(solo.model.scenes.map((s) => s.id)).toEqual(["one-solo-hulu", "one-solo-news", "one-solo-slot-3", "one-solo-hulu-2"]);
  });
  it("an empty store migrates to an empty model with a note; a store without host.boot assumes 1080p", () => {
    const empty = migrateStore({}, { now: "t" });
    expect(empty.model).toMatchObject({ apps: [], facets: [], layouts: [], scenes: [], activeScene: null });
    expect(empty.report.canvas.source).toBe("assumed");
    expect(empty.report.ambiguous.length).toBeGreaterThan(0);
  });
  it("SM-6 alias: a source tile with the pre-rename kind 'frame' migrates as a wall slot and is named in the report; the source is untouched", () => {
    const doc = JSON.parse(REAL.data.dashboard!) as DashboardDocument;
    (doc.tiles[0] as { kind?: unknown }).kind = "frame";
    const data = { ...REAL.data, dashboard: JSON.stringify(doc) };
    const before = JSON.stringify(data);
    const r = migrateStore(data, { now: "t" });
    const scene = r.model.scenes.find((s) => s.id === doc.id)!;
    expect(scene.assign[doc.tiles[0]!.id]).toBeTruthy();                                       // assigned to a wall slot, not floating/hidden
    expect(scene.floating ?? []).toHaveLength(0);
    expect(r.report.ambiguous.some((l) => l.includes(`${doc.id}/${doc.tiles[0]!.id}`) && l.includes("pre-rename"))).toBe(true);
    expect(r.report.created).toEqual({ apps: 7, facets: 6, layouts: 1, scenes: 1 });          // same model as without the alias
    expect(JSON.stringify(data)).toBe(before);                                                  // §10: the source map is not rewritten
    expect(Object.keys(r.writes).every((k) => k.startsWith("scene-model:"))).toBe(true);
  });
  it("refuses to clobber: writes never overlap the source map even when a future key collides", () => {
    expect(() => migrateStore({ ...synthetic, "scene-model:apps": "[]" }, { canvas: { w: 1920, h: 1080 } })).not.toThrow(); // re-run over its own output is allowed
    expect(() => assertWritesOnlyNewKeys(synthetic, { apps: "[]" })).toThrow();
  });
});

describe("scene-model §7 migration — normalized rects are exact at the stored canvas", () => {
  it("denormalize(normalize(rect)) at 2558×1353 is bit-close", () => {
    const { r, canvas, before } = roundTrip(REAL.data);
    for (const s of r.model.layouts[0]!.slots) {
      const back = denormalizeRect(s.rect, canvas);
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(back[k] - before[s.id]![k])).toBeLessThan(1e-9);
    }
  });
});
