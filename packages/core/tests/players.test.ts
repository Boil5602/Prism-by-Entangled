import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_TEMPLATES, carryHiddenMusic, isPlayerKind, playerOfScene, playerScenes } from "../src/players.js";
import type { Facet, Layout, Scene } from "../src/scene-model.js";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// The two players (2026-09-19): "can we begin to make a video player that we can switch to from the music player?
// Make sure I can switch back and forth. I imagine it's just a prism menu item."

const FHD = { w: 1920, h: 1080 };
const facets: Record<string, Facet> = {
  am: { id: "am", app: "apple-music", url: "https://music.apple.com/", slotClass: "16:9·XL", label: "Apple Music", music: true },
  sp: { id: "sp", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·XL", label: "Spotify", music: true },
  hulu: { id: "hulu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" },
  clock: { id: "clock", app: "prism-timer", url: "prism://timer", slotClass: "1:1·S", label: "Clock" },
};
const facet = (id: string) => facets[id];
const layouts: Record<string, Layout> = {
  lounge: { id: "lounge", name: "Lounge", canvas: "16:9·FHD" as never, canvasSize: FHD, slots: [{ id: "stage", rect: { x: 0, y: 0, w: 1, h: 1 }, class: "16:9·XL" }], source: { mode: "template", template: "music-lounge" } } as never,
  night: { id: "night", name: "Night", canvas: "16:9·FHD" as never, canvasSize: FHD, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 }, class: "16:9·XL" }], source: { mode: "template", template: "movie-night" } } as never,
  drawn: { id: "drawn", name: "Drawn", canvas: "16:9·FHD" as never, canvasSize: FHD, slots: [{ id: "a", rect: { x: 0, y: 0, w: 1, h: 1 }, class: "16:9·XL" }], source: { mode: "drawn" } } as never,
};
const layout = (id: string) => layouts[id];
const scene = (id: string, name: string, lay: string, extra: Partial<Scene> = {}): Scene =>
  ({ id, name, layout: lay, assign: {}, floating: [], hidden: [], schedule: null, ...extra });

const lounge = scene("music-lounge-1", "Music Lounge", "lounge", { assign: { stage: "viz" }, visualizations: [{ id: "viz", source: "am", style: "prism-beams", artwork: "off" }], hidden: [{ facet: "am", audio: "exclusive" }, { facet: "sp", audio: "exclusive" }] });
const night = scene("movie-night-1", "Movie Night", "night", { assign: { screen: "hulu" } });

describe("players - which scene is which player", () => {
  it("tells a player by its layout's template lineage; a hand-drawn stage over hidden music is the Music player; anything else is neither", () => {
    expect(playerOfScene(lounge, layout("lounge"), facet)).toBe("music");
    expect(playerOfScene(night, layout("night"), facet)).toBe("video");
    expect(playerOfScene(scene("x", "Clock lounge", "drawn", { assign: { a: "viz" }, visualizations: [{ id: "viz", source: "sp", style: "spectrum", artwork: "off" }], hidden: [{ facet: "sp", audio: "exclusive" }] }), layout("drawn"), facet)).toBe("music");
    expect(playerOfScene(scene("y", "A wall", "drawn", { assign: { a: "hulu" } }), layout("drawn"), facet)).toBeNull();
    expect(playerOfScene(scene("z", "Kitchen", "drawn", { hidden: [{ facet: "clock", audio: "mute" }], visualizations: [{ id: "v", source: "clock", style: "spectrum", artwork: "off" }] }), layout("drawn"), facet)).toBeNull();
    expect(playerOfScene(lounge, undefined, facet)).toBe("music");   // no layout record: the stage still tells
    expect(PLAYER_TEMPLATES.video[0]).toBe("movie-night");
    expect(isPlayerKind("music") && isPlayerKind("video") && !isPlayerKind("news")).toBe(true);
  });
  it("picks the active scene when it is that player, else the household's own instance over a seeded demo, else the newest", () => {
    const demoNight = scene("demo-movie-night", "Movie Night", "night");
    const night2 = scene("movie-night-2", "Movie Night 2", "night", { assign: { screen: "hulu" } });
    const all = [demoNight, lounge, night, night2];
    expect(playerScenes(all, layout, facet, null)).toMatchObject({ music: { id: "music-lounge-1" }, video: { id: "movie-night-2" } });
    expect(playerScenes(all, layout, facet, "movie-night-1").video?.id).toBe("movie-night-1");
    expect(playerScenes([demoNight, lounge], layout, facet, null).video?.id).toBe("demo-movie-night");
    expect(playerScenes([lounge], layout, facet, null)).toEqual({ music: lounge, video: null });
  });
  it("carries the Music player's hidden sources into the Video player - its own non-music hidden facets stay, and nothing is written when they already match", () => {
    const carried = carryHiddenMusic({ ...night, hidden: [{ facet: "clock", audio: "mute" }] }, lounge, facet);
    expect(carried?.hidden).toEqual([{ facet: "clock", audio: "mute" }, { facet: "am", audio: "exclusive" }, { facet: "sp", audio: "exclusive" }]);
    expect(carryHiddenMusic(carried!, lounge, facet)).toBeNull();
    // a source that left the lounge leaves the video player too
    const smaller = { ...lounge, hidden: [{ facet: "sp", audio: "exclusive" as const }] };
    expect(carryHiddenMusic(carried!, smaller, facet)?.hidden).toEqual([{ facet: "clock", audio: "mute" }, { facet: "sp", audio: "exclusive" }]);
  });
});

// ---- the runtime: a switch is a scene switch that keeps the music warm and resumes it on the way back
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
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
  };
  return { ops, store, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

describe("players - the runtime switch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("switches the wall to the Video player with the music sources carried (no source tile destroyed), and back to the Music player resuming what a video paused", async () => {
    const { ops, drivers } = rig();
    const rt = createRuntime(drivers);
    rt.init(JSON.stringify(doc), 1920, 1080);
    await vi.advanceTimersByTimeAsync(50);
    for (const a of [{ id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music", setup: { status: "signed-in" } }, { id: "spotify", name: "Spotify", baseUrl: "https://open.spotify.com/", profileId: "spotify", setup: { status: "signed-in" } }, { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", setup: { status: "signed-in" } }])
      expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
    for (const f of [facets.am, facets.sp, facets.hulu]) expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(f))).ok).toBe(true);
    for (const l of [layouts.lounge, layouts.night]) expect(JSON.parse(rt.modelSaveLayout(JSON.stringify(l))).ok).toBe(true);
    for (const s of [lounge, night]) expect(JSON.parse(rt.modelSaveScene(JSON.stringify(s))).ok).toBe(true);
    expect(JSON.parse(rt.players())).toEqual({ active: null, music: { id: "music-lounge-1", name: "Music Lounge" }, video: { id: "movie-night-1", name: "Movie Night" } });

    // the wall becomes the Music player; Apple Music plays
    expect(JSON.parse(rt.switchPlayer("music"))).toMatchObject({ ok: true, kind: "music", sceneId: "music-lounge-1" });
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.players()).active).toBe("music");
    expect(ops.some((o) => o.op === "create" && o.id === "am")).toBe(true);
    rt.event(JSON.stringify({ type: "now-playing", id: "am", info: { playing: true, title: "Teenage Messiah", artist: "Some Band" } }));
    await vi.advanceTimersByTimeAsync(50);

    // to the Video player: the sources ride along as hidden placements, so their tiles survive the switch
    ops.length = 0;
    expect(JSON.parse(rt.switchPlayer("video"))).toMatchObject({ ok: true, kind: "video", sceneId: "movie-night-1" });
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.players()).active).toBe("video");
    const saved = (JSON.parse(rt.modelState()) as { scenes: Scene[] }).scenes.find((s) => s.id === "movie-night-1")!;
    expect(saved.hidden).toEqual([{ facet: "am", audio: "exclusive" }, { facet: "sp", audio: "exclusive" }]);
    expect(ops.filter((o) => o.op === "destroy").map((o) => o.id)).not.toContain("am");
    expect(ops.filter((o) => o.op === "destroy").map((o) => o.id)).not.toContain("sp");
    const tiles = JSON.parse(rt.state()).tiles as Array<{ id: string; url?: string }>;
    expect(tiles.some((t) => (t.url ?? "").includes("hulu.com"))).toBe(true);   // the screen holds Hulu
    expect(tiles.some((t) => t.id === "am")).toBe(true);                        // and Apple's source is still on the wall

    // a video takes the audio and the music is paused through its own player (section 3); back to the Music player resumes it
    rt.event(JSON.stringify({ type: "now-playing", id: "am", info: { playing: false, title: "Teenage Messiah", artist: "Some Band" } }));
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    expect(JSON.parse(rt.switchPlayer("music"))).toMatchObject({ ok: true, kind: "music", sceneId: "music-lounge-1" });
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(rt.players()).active).toBe("music");
    expect(ops.filter((o) => o.op === "destroy").map((o) => o.id)).not.toContain("am");
    const playSent = () => ops.some((o) => o.op === "inject" && o.id === "am" && /__prismMediaAction/.test(String(o.js)));
    expect(playSent()).toBe(true);   // the Play verb reached Apple's tile

    // a second trip while the music still plays: the way back sends no Play
    ops.length = 0;
    rt.event(JSON.stringify({ type: "now-playing", id: "am", info: { playing: true, title: "Teenage Messiah", artist: "Some Band" } }));
    await vi.advanceTimersByTimeAsync(50);
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    rt.switchPlayer("music");
    await vi.advanceTimersByTimeAsync(100);
    expect(playSent()).toBe(false);

    // no Video player yet: the answer names the template the wizard opens
    expect(rt.modelRemoveScene("movie-night-1")).toBe("ok");
    expect(JSON.parse(rt.switchPlayer("video"))).toEqual({ ok: false, reason: "no-scene", template: "movie-night" });
    expect(JSON.parse(rt.switchPlayer("news"))).toMatchObject({ ok: false });
  });
});
