import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import { ScheduleEngine } from "../src/schedule.js";
import { resolveBinding } from "../src/input.js";
import { sceneDocument, type App, type Facet, type Layout, type Scene } from "../src/scene-model.js";
import { CONTEXT_SHEET_ACTIONS, isPrismRoute, routeForAction, routes } from "../src/routes.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// SM-4 channel / runtime: the seam ops the scene model needs (visualization
// surfaces, hidden audio surfaces, reveal/collapse presence, deep-link routes,
// scenes in schedules and the carousel) and §32 Layer 2 plumbing into the
// music state model. Every assertion is on driver calls or state - the shell
// executes, core decides (§23).

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind ?? null, placeholder: !!o.placeholder }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: () => {},
      freeze: () => {},
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: () => {},
      resume: () => {},
      setMuted: (id, muted) => void ops.push({ op: "setMuted", id, muted }),
      setViewport: () => {},
      setNowPlaying: () => {},
      setChrome: (id, kind, face, hidden) => void ops.push({ op: "setChrome", id, kind, face, hidden: !!hidden }),
      createVisualization: (o) => void ops.push({ op: "createVisualization", ...o }),
      setVisualizationFeed: (id, json) => void ops.push({ op: "feed", id, feed: JSON.parse(json) }),
      setPresence: (id, presence, rect, durationMs) => void ops.push({ op: "setPresence", id, presence, rect, durationMs }),
    },
    ui: { route: (route, source, id) => void ops.push({ op: "ui.route", route, source, id: id ?? null }) },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers, orchestrator: new Orchestrator(drivers) };
}

const apps: App[] = [
  { id: "spotify", name: "Spotify", baseUrl: "https://open.spotify.com", profileId: "spotify", setup: { status: "unknown" } } as App,
  { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com", profileId: "hulu", setup: { status: "unknown" } } as App,
];
const facets: Facet[] = [
  { id: "spotify-controller", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·M", music: true } as Facet,
  { id: "hulu-live", app: "hulu", url: "https://www.hulu.com/live", slotClass: "16:9·XL" } as Facet,
];
const layout: Layout = {
  id: "two", name: "two", canvas: { aspect: "16:9", resolution: "1080-class" },
  slots: [
    { id: "hero", rect: { x: 0, y: 0, w: 0.7, h: 1 }, class: "16:9·XL" },
    { id: "side", rect: { x: 0.7, y: 0, w: 0.3, h: 0.5 }, class: "16:9·M" },
  ],
} as unknown as Layout;
const scene: Scene = {
  id: "evening", name: "Evening", layout: "two",
  assign: { hero: "hulu-live", side: "viz-1" },
  floating: [{ visualization: "viz-2", anchor: "bottom-right", size: 0.2 }],
  hidden: [{ facet: "spotify-controller", audio: "exclusive" }],
  visualizations: [
    { id: "viz-1", source: "spotify-controller", style: "prism-beams", artwork: "backdrop" },
    { id: "viz-2", source: "spotify-controller", style: "spectrum", artwork: "off" },
  ],
  schedule: null,
};

function materialized(): DashboardDocument {
  return sceneDocument({ scene, layout, facets, apps }, "wall", { w: 1920, h: 1080 }).doc;
}

describe("sceneDocument (§32 placement model) emits visualization tiles", () => {
  it("a slot assigned a visualization becomes a visualization tile sourced from the hidden facet", () => {
    const doc = materialized();
    const side = doc.tiles.find((t) => t.id === "side")!;
    expect(side.visualization).toEqual({ style: "prism-beams", source: "spotify-controller", artwork: "backdrop" });
    expect(side.placeholder).toBeUndefined();
    expect(side.url).toBeUndefined();
  });
  it("a floating visualization is a floating visualization tile; the hidden facet is a hidden floating tile", () => {
    const doc = materialized();
    const viz2 = doc.tiles.find((t) => t.id === "viz-2")!;
    expect(viz2.kind).toBe("floating");
    expect(viz2.visualization?.style).toBe("spectrum");
    const music = doc.tiles.find((t) => t.id === "spotify-controller")!;
    expect(music.kind).toBe("floating");
    expect(music.float?.hidden).toBe(true);
    expect(music.audio).toBe("exclusive");
  });
});

describe("Orchestrator: hidden + visualization surfaces, §32 Layer 2, reveal/collapse", () => {
  it("creates hidden facets with kind=hidden and visualizations through createVisualization (revealed at once)", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    expect(ops.find((o) => o.op === "create" && o.id === "spotify-controller")?.kind).toBe("hidden");
    expect(ops.find((o) => o.op === "create" && o.id === "hero")?.kind).toBeNull();
    const viz = ops.filter((o) => o.op === "createVisualization");
    expect(viz.map((o) => o.id).sort()).toEqual(["side", "viz-2"]);
    expect(viz[0]).toMatchObject({ source: "spotify-controller" });
    expect(ops.some((o) => o.op === "reveal" && o.id === "side")).toBe(true);
    // the initial feeds are pushed dark (no source playing yet)
    const feeds = ops.filter((o) => o.op === "feed");
    expect(feeds.length).toBeGreaterThanOrEqual(2);
    expect((feeds[0]!.feed as { active: boolean }).active).toBe(false);
  });

  it("falls back to a placeholder surface on a shell without a visualization surface", async () => {
    const { ops, drivers, orchestrator } = rig();
    delete drivers.surface.createVisualization;
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    expect(ops.find((o) => o.op === "create" && o.id === "side")?.placeholder).toBe(true);
  });

  it("a now-playing observation on the hidden facet lands in the music state and refreshes its visualizations' feeds", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    ops.length = 0;
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "spotify-controller", info: { playing: true, title: "Song", artist: "Band", artwork: "https://i/art.jpg", actions: ["play", "pause", "nexttrack"] } });
    const m = orchestrator.musicState();
    expect(m.sources["spotify-controller"]?.playbackState).toBe("playing");
    expect(m.sources["spotify-controller"]?.metadata.title).toBe("Song");
    expect(m.sources["spotify-controller"]?.actions).toContain("nexttrack");
    const feeds = ops.filter((o) => o.op === "feed") as Array<{ id: string; feed: { active: boolean; artwork: string | null } }>;
    expect(feeds.map((f) => f.id).sort()).toEqual(["side", "viz-2"]);
    expect(feeds.find((f) => f.id === "side")!.feed).toMatchObject({ active: true, artwork: "https://i/art.jpg" });   // backdrop mode shows art
    expect(feeds.find((f) => f.id === "viz-2")!.feed).toMatchObject({ active: true, artwork: null });                 // artwork off
    // a slot tile's now-playing never enters the music model
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "hero", info: { playing: true, title: "Show" } });
    expect(orchestrator.musicState().sources["hero"]).toBeUndefined();
    // gone → idle dark
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "spotify-controller", info: null });
    expect(orchestrator.musicState().sources["spotify-controller"]?.playbackState).toBe("none");
  });

  it("concept-scenes §2.5.2: the feed carries core's palette and core's audio-owner answer, and a pixel sample re-pushes it tinted", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    expect(orchestrator.registerStylePalettes({ "prism-beams": ["#F0A83C", "#5CC8C0", "#C86CF0", "#F05C7A"], spectrum: ["#F0A83C"] })).toBe(2);
    type Feed = { id: string; feed: { palette: string[]; dominant: string[] | null; audioOwner: boolean; metadata: { title?: string; artist?: string } | null } };
    const last = (id: string) => (ops.filter((o) => o.op === "feed" && o.id === id) as Feed[]).at(-1)!.feed;
    // B-165: a stage's source that plays while nobody owns the audio takes it - the wall's one switch decides whether it is heard
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "spotify-controller", info: { playing: true, title: "Aurora Skies", artist: "The Refractions", artwork: "https://i/art.jpg", actions: ["play", "pause"] } });
    expect(last("side").audioOwner).toBe(true);
    // §3 hands the hidden facet audio focus on a human-attributed play; now it reads "hidden facet · ♪ exclusive"
    await orchestrator.onSurfaceEvent({ type: "interaction", id: "spotify-controller" });
    await orchestrator.onSurfaceEvent({ type: "playback", id: "spotify-controller", playing: true });
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "spotify-controller", info: { playing: true, title: "Aurora Skies", artist: "The Refractions", artwork: "https://i/art.jpg", actions: ["play", "pause"] } });
    expect(last("side").audioOwner).toBe(true);
    expect(last("side").metadata).toMatchObject({ title: "Aurora Skies", artist: "The Refractions" });
    // no sample yet: the registered pack palette, untinted
    expect(last("side").palette).toEqual(["#F0A83C", "#5CC8C0", "#C86CF0", "#F05C7A"]);
    expect(last("side").dominant).toBeNull();
    // the shell hands over an RGBA sample; core derives the colours and pushes new feeds
    const px: number[] = [];
    for (let i = 0; i < 32; i++) px.push(0x30, 0x80, 0xd0, 255);
    ops.length = 0;
    expect(await orchestrator.noteArtworkColors("spotify-controller", "https://i/art.jpg", Uint8Array.from(px))).toBe("ok");
    expect((ops.filter((o) => o.op === "feed") as Feed[]).map((f) => f.id).sort()).toEqual(["side", "viz-2"]);
    expect(last("side").dominant).not.toBeNull();
    expect(last("side").palette).not.toEqual(["#F0A83C", "#5CC8C0", "#C86CF0", "#F05C7A"]);
    // artwork "off" is never tinted, and a sample for a non-source is refused
    expect(last("viz-2").palette).toEqual(["#F0A83C"]);
    expect(await orchestrator.noteArtworkColors("hero", "https://i/art.jpg", Uint8Array.from(px))).toBe("unknown");
    // the same answers reach the remote / the host through musicState()
    expect(orchestrator.musicState().feeds.find((f) => f.visualization === "side")!.audioOwner).toBe(true);
  });

  it("reveal shows the hidden facet's surface via setPresence (never destroy/create); collapse returns it to hidden", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    ops.length = 0;
    expect(await orchestrator.revealMusic("side", "panel")).toBe("ok");      // a visualization reveals its source
    const pres = ops.find((o) => o.op === "setPresence") as { id: string; presence: string; rect: { w: number; h: number } };
    expect(pres.id).toBe("spotify-controller");
    expect(pres.presence).toBe("panel");
    expect(pres.rect.w).toBeGreaterThan(0);
    expect(ops.some((o) => o.op === "destroy")).toBe(false);
    expect(ops.some((o) => o.op === "create")).toBe(false);
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "spotify-controller")!.revealed).toBe("panel");
    ops.length = 0;
    expect(await orchestrator.revealMusic("spotify-controller", "hero")).toBe("ok");
    expect((ops.find((o) => o.op === "setPresence") as { presence: string }).presence).toBe("hero");
    ops.length = 0;
    expect(await orchestrator.collapseMusic()).toBe("ok");
    expect(ops.find((o) => o.op === "setPresence")).toMatchObject({ id: "spotify-controller", presence: "hidden" });
    expect(ops.some((o) => o.op === "setChrome" && o.id === "spotify-controller" && o.hidden === true)).toBe(true);
    expect(orchestrator.musicState().reveal.facet).toBeNull();
    expect(await orchestrator.revealMusic("hero")).toBe("unknown");          // a video slot is not a music source
  });

  it("fullscreen-element and popup events are bookkeeping; a popup surface's own events never throw", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "hero", contains: true });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "hero")!.elementFullscreen).toBe(true);
    await orchestrator.onSurfaceEvent({ type: "popup", id: "hero#popup-1", opener: "hero", url: "https://accounts.google.com/x", open: true });
    expect(orchestrator.getState()!.popups).toEqual([{ id: "hero#popup-1", opener: "hero", url: "https://accounts.google.com/x" }]);
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "hero#popup-1", ok: true });
    await orchestrator.onSurfaceEvent({ type: "navigated", id: "hero#popup-1", url: "https://accounts.google.com/y" });
    await orchestrator.onSurfaceEvent({ type: "popup", id: "hero#popup-1", opener: "hero", open: false });
    expect(orchestrator.getState()!.popups).toBeUndefined();
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "hero", contains: false });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === "hero")!.elementFullscreen).toBeUndefined();
  });

  it("scene hooks: schedules fire scene actions, the carousel steps scenes when the wall is a scene", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    const applied: string[] = [];
    let active: string | null = "evening";
    orchestrator.setSceneHooks({ apply: (id) => { applied.push(id); active = id; }, ids: () => ["morning", "evening", "night"], active: () => active });
    expect(await orchestrator.carouselStep(1)).toBe("night");
    expect(await orchestrator.carouselStep(1)).toBe("morning");
    expect(await orchestrator.carouselStep(-1)).toBe("night");
    expect(applied).toEqual(["night", "morning", "night"]);
    expect(await orchestrator.sceneApply("evening")).toBe(true);
    expect(await orchestrator.sceneApply("nope")).toBe(false);
    // the schedule engine's "scene" action
    const fired: string[] = [];
    const engine = new ScheduleEngine({ dim: () => {}, sleep: () => {}, wake: () => {}, layout: () => {}, scene: (id) => fired.push(id), night: () => {}, lowpower: () => {}, alarm: () => {} });
    vi.setSystemTime(new Date(2026, 8, 1, 18, 59, 50));
    engine.start([{ at: "19:00", action: "scene", value: "night" }]);
    vi.advanceTimersByTime(11_000);
    expect(fired).toEqual(["night"]);
    engine.stop();
  });

  it("a held select opens the focused item's context sheet through the ui driver (§6a remote-hold)", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(materialized(), { w: 1920, h: 1080 });
    expect((resolveBinding(undefined, "ENTER_LONG") as { action: string }).action).toBe("context-sheet");
    ops.length = 0;
    await orchestrator.onInput({ key: "ENTER_LONG" });
    const r = ops.find((o) => o.op === "ui.route") as { route: string; source: string } | undefined;
    expect(r?.source).toBe("remote-hold");
    expect(r?.route).toMatch(/^prism:\/\/item\/.+\/sheet$/);
  });
});

describe("routes (§6a deep links are data)", () => {
  it("builds the spec's shapes and validates the scheme", () => {
    expect(routes.appSetup("hulu")).toBe("prism://app/hulu/setup");
    expect(routes.facetEdit("hulu-live")).toBe("prism://facet/hulu-live/edit");
    expect(routes.scene("evening")).toBe("prism://scene/evening");
    expect(isPrismRoute("prism://scene/x")).toBe(true);
    expect(isPrismRoute("https://evil")).toBe(false);
    expect(isPrismRoute("prism://")).toBe(false);
  });
  it("maps context-sheet actions to routes, and mute to none", () => {
    const ctx = { item: "hero", facet: "hulu-live", app: "hulu" };
    expect(routeForAction("open-setup", ctx)).toBe("prism://app/hulu/setup");
    expect(routeForAction("app-settings", ctx)).toBe("prism://app/hulu/settings");
    expect(routeForAction("edit-facet", ctx)).toBe("prism://facet/hulu-live/edit");
    expect(routeForAction("swap-facet", ctx)).toBe("prism://item/hero/swap");
    expect(routeForAction("mute", ctx)).toBeNull();
    expect(routeForAction("edit-facet", { item: "viz-2" })).toBeNull();
    expect(CONTEXT_SHEET_ACTIONS).toHaveLength(5);
  });
});

describe("RemoteApi parity (§6a tap + sheet, §32 now-playing card, scenes)", () => {
  async function paired() {
    const r = rig();
    await r.orchestrator.load(materialized(), { w: 1920, h: 1080 });
    const remote = new RemoteApi(r.orchestrator, r.drivers.store);
    remote.sceneContext = {
      itemContext: (id) => (id === "hero" ? { facet: "hulu-live", app: "hulu" } : id === "side" || id === "viz-2" ? { facet: "spotify-controller", app: "spotify" } : null),
      route: (route, source, id) => r.drivers.ui!.route(route, source, id),
    };
    const { token } = await remote.mintPairing("http://10.0.0.5:8471");
    const call = (method: string, path: string, body?: unknown) => remote.handle({ method, path, body: body === undefined ? null : JSON.stringify(body), token });
    return { ...r, remote, call };
  }

  it("GET /music and GET /now-playing expose the music state with transport availability", async () => {
    const { call, orchestrator } = await paired();
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: "spotify-controller", info: { playing: true, title: "Song", actions: ["play", "pause", "nexttrack"] } });
    const m = JSON.parse((await call("GET", "/music")).body);
    expect(m.sources["spotify-controller"].metadata.title).toBe("Song");
    const np = JSON.parse((await call("GET", "/now-playing")).body);
    expect(np.now.tile).toBe("spotify-controller");
    expect(np.now.transport).toEqual({ play: true, pause: true, previoustrack: false, nexttrack: true });
  });

  it("POST /items/{id}/tap reveals music and promotes video; /music/collapse collapses", async () => {
    const { call, ops } = await paired();
    ops.length = 0;
    expect(JSON.parse((await call("POST", "/items/side/tap")).body)).toEqual({ ok: true, did: "reveal" });
    expect(ops.some((o) => o.op === "setPresence" && o.presence === "panel")).toBe(true);
    expect(JSON.parse((await call("POST", "/music/collapse")).body).ok).toBe(true);
    expect(JSON.parse((await call("POST", "/items/hero/tap")).body)).toEqual({ ok: true, did: "promote" });
    expect((await call("POST", "/items/nope/tap")).status).toBe(404);
  });

  it("POST /items/{id}/action deep-links through the ui driver; mute is a tile command; /ui/route accepts any prism:// route", async () => {
    const { call, ops } = await paired();
    ops.length = 0;
    expect(JSON.parse((await call("POST", "/items/hero/action", { action: "edit-facet" })).body).route).toBe("prism://facet/hulu-live/edit");
    expect(JSON.parse((await call("POST", "/items/hero/action", { action: "app-settings" })).body).route).toBe("prism://app/hulu/settings");
    expect(JSON.parse((await call("POST", "/items/side/action", { action: "open-setup" })).body).route).toBe("prism://app/spotify/setup");
    expect(ops.filter((o) => o.op === "ui.route").map((o) => o.source)).toEqual(["remote", "remote", "remote"]);
    expect(JSON.parse((await call("POST", "/items/hero/action", { action: "mute" })).body).did).toBe("mute");
    expect(ops.some((o) => o.op === "setMuted" && o.id === "hero" && o.muted === true)).toBe(true);
    expect((await call("POST", "/items/hero/action", { action: "explode" })).status).toBe(400);
    expect(JSON.parse((await call("POST", "/items/hero/sheet")).body).route).toBe("prism://item/hero/sheet");
    expect((await call("POST", "/ui/route", { route: "prism://scene/evening" })).status).toBe(200);
    expect((await call("POST", "/ui/route", { route: "https://x" })).status).toBe(400);
  });

  it("scenes: PUT /scenes/{id} and POST /scenes/next go through the scene hooks", async () => {
    const { call, orchestrator } = await paired();
    const applied: string[] = [];
    let active: string | null = "evening";
    orchestrator.setSceneHooks({ apply: (id) => { applied.push(id); active = id; }, ids: () => ["morning", "evening"], active: () => active });
    expect((await call("PUT", "/scenes/morning")).status).toBe(200);
    expect(JSON.parse((await call("POST", "/scenes/next")).body).scene).toBe("evening");
    expect(applied).toEqual(["morning", "evening"]);
    expect((await call("PUT", "/scenes/zzz")).status).toBe(404);
  });
});
