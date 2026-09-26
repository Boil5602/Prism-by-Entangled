import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SceneModelStore } from "../src/scene-model-store.js";
import { SCENE_MODEL_KEYS } from "../src/scene-migration.js";
import { createRuntime } from "../src/runtime.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const here = dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(readFileSync(join(here, "fixtures/store-m1-demo.json"), "utf8")) as { data: Record<string, string> };

function rig(seed: Record<string, string> = {}) {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>(Object.entries(seed));
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, profile: o.profile, placeholder: !!o.placeholder }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }),
      setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers };
}

const FHD = { w: 1920, h: 1080 };
const app = { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", adapter: "hulu", setup: { status: "signed-in" } };
const facetXL = { id: "hulu-home-16x9-XL", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" };
const facetM = { id: "hulu-live-16x9-M", app: "hulu", url: "https://www.hulu.com/live", slotClass: "16:9·M", label: "Live" };
const layout = { id: "two-up", name: "Two up", canvasSize: FHD, slots: [{ id: "hero", rect: { x: 0, y: 0, w: 0.75, h: 1 } }, { id: "side", rect: { x: 0.75, y: 0, w: 0.25, h: 1 } }] };

describe("SceneModelStore — the five stores", () => {
  it("saves and reloads apps, facets, layouts, scenes under scene-model:* only", async () => {
    const { store } = rig();
    const m = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) });
    await m.load();
    expect(m.saveApp(app).ok).toBe(true);
    expect(m.saveFacet(facetXL).ok).toBe(true);
    const l = m.saveLayout(layout);
    expect(l.ok && l.value.slots.map((s) => s.class)).toEqual(["4:3·XL", "9:16·L"]);
    const s = m.saveScene({ id: "evening", name: "Evening", layout: "two-up", assign: { hero: "hulu-home-16x9-XL" } });
    expect(s.ok && s.warnings).toEqual(["hero (4:3·XL): facet hulu-home-16x9-XL is cut for 16:9·XL"]);
    expect([...store.keys()].every((k) => k.startsWith("scene-model:"))).toBe(true);
    const again = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: () => {} });
    await again.load();
    expect(again.snapshot()).toMatchObject({ apps: [app], facets: [facetXL], scenes: [expect.objectContaining({ id: "evening" })], activeScene: null, migrated: false });
    expect(again.snapshot().slotClasses).toEqual([{ class: "4:3·XL", layouts: 1, custom: false }, { class: "9:16·L", layouts: 1, custom: false }]);
  });
  it("flags duplicates on save and never refuses; archive hides, never deletes", async () => {
    const m = new SceneModelStore(null);
    await m.load();
    m.saveLayout(layout);
    const twin = m.saveLayout({ ...layout, id: "twin", name: "Twin", slots: [{ id: "a", rect: { x: 0, y: 0, w: 0.76, h: 1 } }, { id: "b", rect: { x: 0.76, y: 0, w: 0.24, h: 1 } }] });
    expect(twin.ok && twin.value.duplicateFlag).toBe("possibly duplicates ⟨Two up⟩");
    expect(twin.ok && twin.warnings).toEqual(["possibly duplicates ⟨Two up⟩"]);
    expect(m.snapshot().layouts).toHaveLength(2);
    expect(m.duplicatesOf({ ...layout, id: "" })).toHaveLength(2);
    expect(m.archiveLayout("two-up")).toBe("ok");
    expect(m.layoutsFor(FHD).map((l) => l.id)).toEqual(["twin"]);
    expect(m.layout("two-up")?.archived).toBe(true);
    expect(m.saveScene({ layout: "two-up" }).ok).toBe(true); // an archived layout still resolves
    expect(m.archiveLayout("nope")).toBe("unknown");
  });
  it("refuses to remove a referenced facet; a scene needs a saved layout", async () => {
    const m = new SceneModelStore(null);
    await m.load();
    m.saveFacet(facetXL);
    m.saveLayout(layout);
    m.saveScene({ id: "s", layout: "two-up", assign: { hero: facetXL.id } });
    expect(m.removeFacet(facetXL.id)).toBe("referenced");
    expect(m.removeScene("s")).toBe("ok");
    expect(m.removeFacet(facetXL.id)).toBe("ok");
    expect(m.saveScene({ layout: "missing" })).toEqual({ ok: false, error: 'unknown layout "missing"' });
    expect(m.saveApp({ id: "x" }).ok).toBe(false);
  });
  it("warns about music facets in slots, one-tier stretches, and dark visualizations", async () => {
    const m = new SceneModelStore(null);
    await m.load();
    m.saveLayout({ ...layout, slots: [{ id: "hero", rect: { x: 0, y: 0, w: 0.72, h: 0.72 } }, { id: "side", rect: { x: 0.72, y: 0, w: 0.28, h: 0.28 } }] }); // 16:9·XL, 16:9·M
    m.saveFacet({ ...facetM, slotClass: "16:9·L" });
    m.saveFacet({ id: "spot", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·M", label: "Spotify", music: true });
    const r = m.saveScene({ id: "s", layout: "two-up", assign: { hero: "hulu-live-16x9-M", side: "spot" }, visualizations: [{ id: "viz", source: "other" }] });
    expect(r.ok && r.warnings).toEqual([
      "hero: hulu-live-16x9-M stretches one tier",
      "side: spot is a music facet (hidden-only, §32); assign a visualization instead",
      'visualization viz: source "other" is not a hidden facet of this scene (it idles dark)',
    ]);
  });
  it("instantiates a template only when complete, saving its Layout + Scene", async () => {
    const m = new SceneModelStore(null);
    await m.load();
    expect(m.instantiateTemplate("kitchen-classic", FHD, { hero: "f1" })).toEqual({ ok: false, error: "incomplete: unresolved roles calendar, weather, ticker" });
    expect(m.instantiateTemplate("nope", FHD, {}).ok).toBe(false);
    const r = m.instantiateTemplate("kitchen-classic", FHD, { hero: "f1", calendar: "f2", weather: "f3", ticker: "f4" }, "Our kitchen");
    expect(r.ok).toBe(true);
    expect(m.snapshot().layouts.map((l) => l.id)).toEqual(["kitchen-classic-1"]);
    expect(m.snapshot().scenes[0]).toMatchObject({ id: "kitchen-classic-1", name: "Our kitchen", layout: "kitchen-classic-1" });
    expect(r.ok && r.warnings).toEqual(["hero: \"f1\" is not a saved facet", "calendar: \"f2\" is not a saved facet", "weather: \"f3\" is not a saved facet", "ticker: \"f4\" is not a saved facet"]);
  });
  it("migrate: explicit, one-shot, writes only new keys, returns the report; refuses to run twice without force", async () => {
    const { store } = rig(REAL.data);
    const before = new Map(store);
    const m = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) }, { readAll: () => Object.fromEntries(store) });
    await m.load();
    const r = m.migrate({ w: 2558, h: 1353 });
    expect(r.status).toBe("migrated");
    expect(r.report?.created).toEqual({ apps: 7, facets: 6, layouts: 1, scenes: 1 });
    for (const [k, v] of before) expect(store.get(k), k).toBe(v);                       // §10: every source key byte-identical
    expect([...store.keys()].filter((k) => !before.has(k)).sort()).toEqual(Object.values(SCENE_MODEL_KEYS).sort());
    expect(m.activeScene()).toBe("m1-demo");
    expect(m.migrate({ w: 2558, h: 1353 })).toEqual({ status: "already-migrated", report: null });
    expect(m.migrate({ w: 2558, h: 1353 }, true).status).toBe("migrated");
    expect(new SceneModelStore(null).migrate(FHD)).toEqual({ status: "no-store", report: null });
  });
});

describe("runtime — additive scene-model host calls", () => {
  const doc = JSON.parse(REAL.data.dashboard!) as DashboardDocument;
  it("exposes the stores, migrates from the host's store map, and applies a scene as a fixed-rect wall", async () => {
    const { store, ops, drivers } = rig(REAL.data);
    const rt = createRuntime(drivers);
    rt.init(JSON.stringify(doc), 2558, 1353);
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.modelState())).toMatchObject({ apps: [], migrated: false });
    const mig = JSON.parse(rt.modelMigrate(JSON.stringify(REAL), false)) as { status: string; report: { created: unknown; canvas: unknown } };
    expect(mig.status).toBe("migrated");
    expect(mig.report.canvas).toEqual({ w: 2558, h: 1353, source: "given" });
    expect(mig.report.created).toEqual({ apps: 7, facets: 6, layouts: 1, scenes: 1 });
    expect(store.get("dashboard")).toBe(REAL.data.dashboard);                          // untouched by the migration
    const st = JSON.parse(rt.modelState()) as { scenes: Array<{ id: string }>; activeScene: string; migrated: boolean; slotClasses: unknown[] };
    expect(st.scenes.map((s) => s.id)).toEqual(["m1-demo"]);
    expect(st.migrated).toBe(true);
    expect(st.slotClasses.length).toBeGreaterThan(0);
    // apply: the wall becomes the scene; rects reproduce the old solve exactly
    const beforeRects = JSON.parse(rt.rects()) as Record<string, { x: number; y: number; w: number; h: number }>;
    ops.length = 0;
    expect(JSON.parse(rt.modelApplyScene("m1-demo"))).toEqual({ ok: true, notes: [] });
    await vi.advanceTimersByTimeAsync(50);
    const afterRects = JSON.parse(rt.rects()) as typeof beforeRects;
    for (const id of Object.keys(beforeRects)) for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(beforeRects[id]![k] - afterRects[id]![k]), `${id}.${k}`).toBeLessThan(1e-6);
    expect(JSON.parse(rt.state()).layoutMode).toBe("fixed");
    expect(ops.filter((o) => o.op === "destroy")).toEqual([]);                          // same tile ids → surfaces survive
    expect(JSON.parse(rt.modelApplyScene("nope")).ok).toBe(false);
    // templates + news shelf are readable (Kitchen Command leads; Kitchen Classic stays — the golden path names it)
    const templateIds = (JSON.parse(rt.modelTemplates()) as Array<{ id: string }>).map((t) => t.id);
    expect(templateIds[0]).toBe("kitchen-command");
    expect(templateIds).toContain("kitchen-classic");
    expect(JSON.parse(rt.newsShelf()).entries.length).toBeGreaterThan(100);
    // second migrate refuses without force
    expect(JSON.parse(rt.modelMigrate(JSON.stringify(REAL), false)).status).toBe("already-migrated");
  });
  it("save calls validate and persist; nothing touches the old stores", async () => {
    const { store, drivers } = rig({ dashboard: REAL.data.dashboard! });
    const errors: string[] = [];
    globalThis.PrismBridge = { dispatch: (j) => void errors.push(j), storeGet: () => null }; // runtime.error goes over the bridge
    const rt = createRuntime(drivers);
    rt.init(REAL.data.dashboard!, 1920, 1080);
    await vi.advanceTimersByTimeAsync(50);
    const oldKeys = new Map([...store].filter(([k]) => !k.startsWith("scene-model:")));
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify(app))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(facetXL))).ok).toBe(true);
    const l = JSON.parse(rt.modelSaveLayout(JSON.stringify(layout)));
    expect(l.ok).toBe(true);
    expect(JSON.parse(rt.modelLayoutDuplicates(JSON.stringify({ ...layout, id: "" })))).toEqual([{ id: "two-up", name: "Two up", archived: false }]);
    expect(rt.modelArchiveLayout("two-up", true)).toBe("ok");
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "s", layout: "two-up", assign: {} }))).ok).toBe(true);
    expect(rt.modelRemoveFacet(facetXL.id)).toBe("ok");
    expect(rt.modelRemoveScene("s")).toBe("ok");
    expect(JSON.parse(rt.modelSaveApp("not json")).ok).toBe(false);
    expect(errors.some((e) => e.includes("runtime.error"))).toBe(true);
    delete globalThis.PrismBridge;
    for (const [k, v] of oldKeys) expect(store.get(k)).toBe(v);
  });
  it("the orchestrator applies a model document through the ordinary wall path", async () => {
    const { drivers, store } = rig();
    const o = new Orchestrator(drivers);
    await o.load(doc, FHD);
    const r = await o.applyModelDocument({ ...doc, layout: { mode: "fixed", rects: { hulu: { x: 0, y: 0, w: 1, h: 1 } } }, tiles: [doc.tiles.find((t) => t.id === "hulu")!] });
    expect(r).toBe("ok");
    expect(o.rects()).toEqual({ hulu: { x: 0, y: 0, w: 1920, h: 1080 } });
    expect(JSON.parse(store.get("dashboard")!).layout.mode).toBe("fixed");
  });
});

describe("multi-service lounge: the visual follows the pick (2026-09-07)", () => {
  it("a quick-play pick on the second service moves every stage to it - in the scene's record and on the wall", async () => {
    const { drivers, store, ops } = rig();
    (drivers.surface as any).createVisualization = (o: any) => void ops.push({ op: "createVisualization", id: o.id, source: o.source });
    const adapters = { "apple-music": { id: "apple-music", musicPlay: "window.__prismMusicPlay=function(){}" }, spotify: { id: "spotify", controls: { play: ".play" } } };
    const rt = createRuntime(drivers);
    rt.init(JSON.stringify({ schema: "frame.dashboard/v0.1", id: "m1-demo", name: "Wall", tiles: [] }), 1920, 1080, JSON.stringify({ adapters }));
    await vi.advanceTimersByTimeAsync(50);
    for (const a of [
      { id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music", catalogRef: "apple-music", setup: { status: "signed-in" } },
      { id: "spotify", name: "Spotify", baseUrl: "https://open.spotify.com/", profileId: "spotify", catalogRef: "spotify", setup: { status: "signed-in" } },
    ]) expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "am-home", app: "apple-music", url: "https://music.apple.com/us/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "sp-home", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "one", name: "One", canvasSize: FHD, slots: [{ id: "stage", rect: { x: 0, y: 0, w: 1, h: 1 } }] }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "lounge", name: "Lounge", layout: "one", assign: { stage: "viz" }, hidden: [{ facet: "am-home", audio: "exclusive" }, { facet: "sp-home", audio: "exclusive" }], visualizations: [{ id: "viz", source: "am-home", style: "prism-beams", artwork: "backdrop" }] }))).ok).toBe(true);
    expect(JSON.parse(rt.modelApplyScene("lounge")).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    const sources = JSON.parse(rt.musicSources()) as Array<{ tile: string; name: string; active: boolean }>;
    expect(sources.map((s) => [s.tile, s.name, s.active])).toEqual([["am-home", "Apple Music", true], ["sp-home", "Spotify", false]]);
    // Spotify lists a playlist; a pick on it plays there and the stage follows
    rt.event(JSON.stringify({ type: "now-playing", id: "sp-home", info: { playing: false, library: { playlists: [{ id: "37i9", name: "Chill", kind: "playlist", url: "https://open.spotify.com/playlist/37i9" }], stations: [] } } }));
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    rt.playCollection("sp-home", "playlist", "37i9");
    await vi.advanceTimersByTimeAsync(100);
    expect(ops.some((o) => o.op === "navigate" && o.id === "sp-home")).toBe(true);
    expect(ops.some((o) => o.op === "createVisualization" && o.id === "stage" && o.source === "sp-home")).toBe(true);
    const scene = (JSON.parse(rt.modelState()) as { scenes: Array<{ id: string; visualizations?: Array<{ source: string }> }> }).scenes.find((s) => s.id === "lounge");
    expect(scene?.visualizations?.[0]?.source).toBe("sp-home");
    expect((JSON.parse(rt.musicSources()) as Array<{ tile: string; active: boolean }>).find((s) => s.tile === "sp-home")?.active).toBe(true);
    // B-129: the stage follows whichever source is audible - Apple Music unmuted (the audio owner) and playing takes the stage back
    rt.tileCommand("am-home", "unmute");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "am-home", info: { playing: true, title: "Clearly" } }));
    await vi.advanceTimersByTimeAsync(100);
    expect((JSON.parse(rt.modelState()) as { scenes: Array<{ id: string; visualizations?: Array<{ source: string }> }> }).scenes.find((s) => s.id === "lounge")?.visualizations?.[0]?.source).toBe("am-home");
  });
});

describe("boot reconcile (B-106/B-120)", () => {
  it("boots the active scene's fresh projection over the persisted document (same ids), so a repaired projection reaches the wall on the next start", async () => {
    const { drivers, store } = rig();
    const adapters = { "apple-music": { id: "apple-music", musicContext: "window.__prismProbe=1" } };
    const rt = createRuntime(drivers);
    rt.init(JSON.stringify({ schema: "frame.dashboard/v0.1", id: "m1-demo", name: "Wall", tiles: [] }), 1920, 1080, JSON.stringify({ adapters }));
    await vi.advanceTimersByTimeAsync(50);
    // an App from the catalog (no adapter of its own), a facet, a one-slot scene, applied: the projection names the adapter
    const catalogApp = { id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music", catalogRef: "apple-music", setup: { status: "unknown" } };
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify(catalogApp))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "am-home", app: "apple-music", url: "https://music.apple.com/us/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "one", name: "One", canvasSize: FHD, slots: [{ id: "hero", rect: { x: 0, y: 0, w: 1, h: 1 } }] }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "lounge", name: "Lounge", layout: "one", assign: { hero: "am-home" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelApplyScene("lounge")).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    const persisted = JSON.parse(store.get("dashboard")!) as DashboardDocument;
    expect(persisted.tiles.find((t) => t.id === "hero")?.adapter).toBe("apple-music");
    // a stale cache: the persisted document from before the projection knew the adapter (what B-120 left behind)
    store.set("dashboard", JSON.stringify({ ...persisted, tiles: persisted.tiles.map(({ adapter: _a, ...t }) => t) }));
    const injects: Array<{ id: string; js: string | null }> = [];
    drivers.surface.inject = (id, _css, js) => void injects.push({ id, js });
    const again = createRuntime(drivers);
    again.init(store.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters }));
    await vi.advanceTimersByTimeAsync(50);
    again.event(JSON.stringify({ type: "load-finished", id: "hero", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects.some((i) => i.id === "hero" && !!i.js?.includes("window.__prismProbe=1"))).toBe(true);   // the adapter's scripts reach the page at boot
    expect(store.get(SCENE_MODEL_KEYS.activeScene)).toBe("lounge");
    // B-123: the wall's session watch keeps the App's status current - evidence "probe", written on change only
    again.event(JSON.stringify({ type: "session", id: "hero", state: "signed-out" }));   // boot window: recycled once, not believed
    await vi.advanceTimersByTimeAsync(50);
    expect((JSON.parse(again.modelState()) as { apps: Array<{ id: string; setup?: { status: string } }> }).apps.find((a) => a.id === "apple-music")?.setup?.status).toBe("unknown");
    again.event(JSON.stringify({ type: "session", id: "hero", state: "signed-out" }));   // the recreated page's word
    // B-217: a signed-out stands for 15 s before it is written - Apple's player shows Sign In for a beat on every load
    expect((JSON.parse(again.modelState()) as { apps: Array<{ id: string; setup?: { status: string } }> }).apps.find((a) => a.id === "apple-music")?.setup?.status).toBe("unknown");
    await vi.advanceTimersByTimeAsync(15_100);
    const appAfter = (JSON.parse(again.modelState()) as { apps: Array<{ id: string; setup?: { status: string; evidence?: string } }> }).apps.find((a) => a.id === "apple-music");
    expect(appAfter?.setup).toMatchObject({ status: "needs-attention", evidence: "probe" });
    again.event(JSON.stringify({ type: "session", id: "hero", state: "signed-in" }));
    expect((JSON.parse(again.modelState()) as { apps: Array<{ id: string; setup?: { status: string } }> }).apps.find((a) => a.id === "apple-music")?.setup?.status).toBe("signed-in");   // a signed-in is written at once
    // the boot-time flicker: Sign In seen, the account chrome 3 s later - nothing is written
    again.event(JSON.stringify({ type: "session", id: "hero", state: "signed-out" }));
    await vi.advanceTimersByTimeAsync(3_000);
    again.event(JSON.stringify({ type: "session", id: "hero", state: "signed-in" }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect((JSON.parse(again.modelState()) as { apps: Array<{ id: string; setup?: { status: string } }> }).apps.find((a) => a.id === "apple-music")?.setup?.status).toBe("signed-in");
    expect((JSON.parse(again.modelState()) as { apps: Array<{ id: string; setup?: { status: string } }> }).apps.find((a) => a.id === "apple-music")?.setup?.status).toBe("signed-in");                // nothing about the model changed
  });
});
