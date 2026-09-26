import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { UNMUTE_PLAYER_JS, mvLayout, mvPipRect } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Multiview (2026-09-23): the Video player's screen slot and up to three floating video windows; the big one by role, the rest down
// its right edge; a swap trades places and never reloads a page; a pick lands in the target window; off closes the small windows.

function rig(kv = new Map<string, string>()) {
  const ops: Array<Record<string, unknown>> = [];
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  const muted = new Map<string, boolean>();
  const unmuted: string[] = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, r) => void rects.set(id, r), setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, css, js) => void ops.push({ op: "inject", id, js, css }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: (id, m) => { muted.set(id, m); if (!m) unmuted.push(id); }, setViewport: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { ops, rects, drivers, kv, muted, unmuted };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

async function setup(kv?: Map<string, string>, huluExtra: Record<string, unknown> = {}) {
  const r = rig(kv);
  const rt = createRuntime(r.drivers);
  const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/", ...huluExtra }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } };
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
  await vi.advanceTimersByTimeAsync(50);
  for (const [id, name, url] of [["hulu", "Hulu", "https://www.hulu.com/hub/home"], ["netflix", "Netflix", "https://www.netflix.com/browse"]] as const) {
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id, name, adapter: id, baseUrl: url, profileId: id, setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
  }
  expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "nf", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}
/** The screen slot's place on a 1920 x 1080 wall, inset by the wall's gap. */
const BASE = { x: 4, y: 4, w: 1912, h: 1072 };
const state = (rt: ReturnType<typeof createRuntime>) => JSON.parse(rt.videoMultiview("state")) as { on: boolean; target: number; windows: Array<{ tile: string; app: string }> };

describe("multiview", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a small window sits on the big one's right edge, 16:9, a quarter of its width, one under the other", () => {
    const base = { x: 0, y: 0, w: 1920, h: 1080 };
    const a = mvPipRect(base, 0), b = mvPipRect(base, 1);
    expect(a.w).toBe(461); expect(a.h).toBe(Math.round(461 * 9 / 16));
    expect(a.x + a.w).toBeLessThan(1920); expect(b.y).toBeGreaterThan(a.y + a.h);
  });

  it("a 32:9 wall: the big window full height and exactly 16:9 on the left, the small ones a grid in the space to its right - all on screen (2026-09-23, 49\" monitors)", () => {
    const base = { x: 4, y: 4, w: 5112, h: 1432 };
    const three = mvLayout(base, 3);
    expect(three.hero).toEqual({ x: 4, y: 4, w: 2546, h: 1432 });
    expect(three.smalls.length).toBe(3);
    for (const r of three.smalls) {
      expect(r.x).toBeGreaterThanOrEqual(three.hero.x + three.hero.w);
      expect(r.x + r.w).toBeLessThanOrEqual(base.x + base.w);
      expect(r.y + r.h).toBeLessThanOrEqual(base.y + base.h);
      expect(Math.abs(r.w / r.h - 16 / 9)).toBeLessThan(0.01);
    }
    expect(three.smalls[0]!.w).toBeGreaterThan(1200);   // two columns - the largest windows the space allows
    expect(mvLayout(base, 0).hero).toEqual(base);        // nothing small: the big window has the whole slot
  });
  it("a 16:9 wall keeps the small windows over the big one's right edge; a short slot shrinks the stack so it never runs off the bottom", () => {
    const base = { x: 4, y: 4, w: 1912, h: 1072 };
    const l = mvLayout(base, 3);
    expect(l.hero).toEqual(base);
    expect(l.smalls).toEqual([0, 1, 2].map((i) => mvPipRect(base, i)));
    const short = { x: 0, y: 0, w: 1900, h: 820 };   // wider than 16:9, not wide enough for the side grid
    for (const r of mvLayout(short, 3).smalls) expect(r.y + r.h).toBeLessThanOrEqual(short.h);
  });

  it("with multiview on, a pick on another service opens its window as the big one, and the one that was big keeps playing small", async () => {
    const { rt, ops, rects } = await setup();
    expect(JSON.parse(rt.videoMultiview("on"))).toMatchObject({ ok: true, on: true, windows: [{ tile: "screen", app: "hulu" }] });
    expect(JSON.parse(rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace"))).toMatchObject({ ok: true, multiview: true, tile: "nf" });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.some((o) => o.op === "create" && o.id === "nf")).toBe(true);
    expect(ops.some((o) => o.op === "destroy" && o.id === "screen")).toBe(false);   // Hulu's page stays up
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["nf", "screen"]);
    expect(rects.get("nf")).toEqual(BASE);   // the screen slot's own place (the wall's gap inset)
    expect(rects.get("screen")).toEqual(mvPipRect(BASE, 0));
    expect(JSON.parse(rt.videoServices()).screen).toMatchObject({ slot: "nf", app: "netflix" });   // the stage bar follows the big window
  });

  it("swap trades the places of live pages - nothing is created, destroyed or navigated", async () => {
    const { rt, ops, rects } = await setup();
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    expect(JSON.parse(rt.videoMultiview("swap")).windows.map((w: { tile: string }) => w.tile)).toEqual(["screen", "nf"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "create" || o.op === "destroy" || o.op === "navigate")).toEqual([]);
    expect(rects.get("screen")).toEqual(BASE);
    expect(rects.get("nf")).toEqual(mvPipRect(BASE, 0));
  });

  it("the sound stays with the big window: a pick into a small window plays there muted, and its own play signal takes nothing (2026-09-23)", async () => {
    const { rt, muted, unmuted } = await setup();
    rt.videoMultiview("on");
    rt.videoMultiview("target", "1");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["screen", "nf"]);
    rt.event(JSON.stringify({ type: "load-finished", id: "nf", ok: true }));
    rt.event(JSON.stringify({ type: "playback", id: "nf", playing: true }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(muted.get("nf")).toBe(true);
    expect(unmuted).not.toContain("nf");
  });

  it("drag out: a small window closes; the big one out, the next backfills it and plays on as the big screen, untouched (2026-09-23; 2026-09-25)", async () => {
    const { rt, ops, rects } = await setup();
    rt.videoMultiview("on");
    rt.videoMultiview("target", "1");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["screen", "nf"]);
    // the big one out: Netflix is the one left - its own window plays on in the big place, never opened again ("I clicked the window 2 X
    // and it cleared both the big window and window 2", 2026-09-25: moving it into the screen slot reloaded it)
    ops.length = 0;
    expect(JSON.parse(rt.videoMultiview("remove", "screen"))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["nf"]);
    expect(rects.get("nf")).toEqual(BASE);
    expect(ops.some((o) => o.op === "destroy" && o.id === "nf")).toBe(false);
    expect(ops.some((o) => o.op === "navigate" && o.id === "nf")).toBe(false);
  });

  it("place: a window dragged onto another place trades places with the one there", async () => {
    const { rt, rects } = await setup();
    rt.videoMultiview("on");
    rt.videoMultiview("target", "1");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoMultiview("place", "nf:0")).windows.map((w: { tile: string }) => w.tile)).toEqual(["nf", "screen"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(rects.get("nf")).toEqual(BASE);
    expect(rects.get("screen")).toEqual(mvPipRect(BASE, 0));
  });

  it("a swap lifts the new big window's own player mute - once, when the big window changes (2026-09-23, Peacock silent after Swap)", async () => {
    const { rt, ops } = await setup();
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    rt.videoMultiview("swap");
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "inject" && o.js === UNMUTE_PLAYER_JS).map((o) => o.id)).toEqual(["screen"]);
    ops.length = 0;
    rt.videoMultiview("place", "screen:0");   // already big: nothing changes hands, nothing is un-muted
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "inject" && o.js === UNMUTE_PLAYER_JS)).toEqual([]);
  });

  it("the tile with the sound, playing a title, has its page's own mute lifted once per title - a restored big window too (B-292)", async () => {
    const { rt, ops } = await setup();
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "nf", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    rt.videoMultiview("swap"); await vi.advanceTimersByTimeAsync(20);
    rt.videoMultiview("swap"); await vi.advanceTimersByTimeAsync(20);   // Netflix big again, with the sound, its page up
    ops.length = 0;
    const report = (url: string) => rt.event(JSON.stringify({ type: "now-playing", id: "nf", info: { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "title", title: "Grace", url, playing: true, position: 5, duration: 3000 } } }));
    report("https://www.netflix.com/watch/81"); await vi.advanceTimersByTimeAsync(20);
    report("https://www.netflix.com/watch/81"); await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "inject" && o.id === "nf" && o.js === UNMUTE_PLAYER_JS).length).toBe(1);
    report("https://www.netflix.com/watch/82"); await vi.advanceTimersByTimeAsync(20);   // the next title: once more
    expect(ops.filter((o) => o.op === "inject" && o.id === "nf" && o.js === UNMUTE_PLAYER_JS).length).toBe(2);
    // a small window playing never has its player touched
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "title", title: "Paradise", url: "https://www.hulu.com/watch/h1", playing: true } } }));
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "inject" && o.id === "screen" && o.js === UNMUTE_PLAYER_JS)).toEqual([]);
  });

  it("the quick change: a pick with small window 2 named lands there and the big window stays", async () => {
    const { rt } = await setup();
    rt.videoMultiview("on");
    expect(JSON.parse(rt.videoMultiview("target", "1")).target).toBe(1);
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["screen", "nf"]);
  });

  it("off hides the small windows: nothing reloads, the big one is untouched, the small ones pause and leave the wall; on brings them back playing", async () => {
    const { rt, ops, rects } = await setup();
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));   // the one that went small plays on
    await vi.advanceTimersByTimeAsync(20);
    ops.length = 0;
    expect(JSON.parse(rt.videoMultiview("off"))).toMatchObject({ ok: true, on: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "create" || o.op === "destroy" || o.op === "navigate")).toEqual([]);
    expect(rects.get("nf")).toEqual(BASE);
    expect(rects.get("screen")!.x).toBeLessThan(0);
    expect(ops.some((o) => o.op === "inject" && o.id === "screen" && String(o.js).includes("pause"))).toBe(true);
    expect(ops.some((o) => o.op === "inject" && o.id === "nf" && String(o.js).includes("pause"))).toBe(false);
    expect(JSON.parse(rt.videoServices()).screen).toMatchObject({ slot: "nf" });   // the stage bar stays with the big one
    ops.length = 0;
    expect(JSON.parse(rt.videoMultiview("on"))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(rects.get("screen")).toEqual(mvPipRect(BASE, 0));
    expect(ops.some((o) => o.op === "inject" && o.id === "screen" && String(o.js).includes("play"))).toBe(true);
    expect(JSON.parse(rt.videoMultiview("state")).on).toBe(true);
  });

  it("close ends multiview: the small windows close; the big one stays - in the screen slot, at the title it was playing", async () => {
    const { rt, ops } = await setup();
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "navigated", id: "nf", url: "https://www.netflix.com/watch/81" }));
    await vi.advanceTimersByTimeAsync(20);
    ops.length = 0;
    expect(JSON.parse(rt.videoMultiview("close"))).toMatchObject({ ok: true, on: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.some((o) => o.op === "destroy" && o.id === "nf")).toBe(true);
    expect(JSON.parse(rt.videoServices()).screen).toMatchObject({ slot: "screen", app: "netflix" });
  });

  it("the TV off and on again: a restart brings back multiview, its windows in their places, each at the title it had up", async () => {
    const kv = new Map<string, string>();
    const { rt } = await setup(kv);
    rt.videoMultiview("on");
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/watch/abc" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "The Rookie", title: "Pilot", playing: true } } }));
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "navigated", id: "nf", url: "https://www.netflix.com/watch/81" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "nf", info: { playing: true, video: { kind: "movie", title: "Grace", playing: true } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["nf", "screen"]);
    // the wall closes; a new process boots on the same store, with the document the store kept
    const b = rig(kv);
    const rt2 = createRuntime(b.drivers);
    const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } };
    rt2.init(kv.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters }));
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt2)).toMatchObject({ on: true, windows: [{ tile: "nf" }, { tile: "screen" }] });
    expect(b.ops.find((o) => o.op === "navigate" && o.id === "nf")?.url).toBe("https://www.netflix.com/watch/81");
    expect(b.ops.find((o) => o.op === "navigate" && o.id === "screen")?.url).toBe("https://www.hulu.com/watch/abc");
    expect(b.rects.get("nf")).toEqual(BASE);
    expect(b.rects.get("screen")).toEqual(mvPipRect(BASE, 0));
    const vs = JSON.parse(rt2.videoState()) as Array<{ id: string; pending: { name: string } | null }>;
    expect(vs.find((t) => t.id === "nf")?.pending?.name).toBe("Grace");   // Watch sees a title on its way and stays down
  });

  it("a title brought back that never starts gets its own address once more; one that plays is left alone", async () => {
    const kv = new Map<string, string>();
    const { rt } = await setup(kv);
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    for (const [id, url, title] of [["screen", "https://www.hulu.com/watch/abc", "Pilot"], ["nf", "https://www.netflix.com/watch/81", "Grace"]] as const) {
      rt.event(JSON.stringify({ type: "navigated", id, url }));
      rt.event(JSON.stringify({ type: "now-playing", id, info: { playing: true, video: { kind: "movie", title, playing: true } } }));
    }
    await vi.advanceTimersByTimeAsync(50);
    const b = rig(kv);
    const rt2 = createRuntime(b.drivers);
    rt2.init(kv.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    for (const id of ["screen", "nf"]) rt2.event(JSON.stringify({ type: "load-finished", id, ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    rt2.event(JSON.stringify({ type: "playback", id: "nf", playing: true }));   // Netflix started; Hulu sits on its ad loader
    b.ops.length = 0;
    await vi.advanceTimersByTimeAsync(46_000);
    const again = b.ops.filter((o) => o.op === "navigate");
    expect(again.map((o) => o.id)).toEqual(["screen"]);
    expect(again[0]!.url).toBe("https://www.hulu.com/watch/abc");
  });

  it("a title brought back whose address waits for a Play press has its service's Play pressed; one that plays is not (2026-09-25, Foundation)", async () => {
    const kv = new Map<string, string>();
    const { rt } = await setup(kv);
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    for (const [id, url, title] of [["screen", "https://www.hulu.com/watch/abc", "Pilot"], ["nf", "https://www.netflix.com/watch/81", "Grace"]] as const) {
      rt.event(JSON.stringify({ type: "navigated", id, url }));
      rt.event(JSON.stringify({ type: "now-playing", id, info: { playing: true, video: { kind: "movie", title, playing: true } } }));
    }
    await vi.advanceTimersByTimeAsync(50);
    const b = rig(kv);
    const rt2 = createRuntime(b.drivers);
    rt2.init(kv.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoPlay: "/*p*/" }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoPlay: "/*p*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    for (const id of ["screen", "nf"]) rt2.event(JSON.stringify({ type: "load-finished", id, ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    rt2.event(JSON.stringify({ type: "playback", id: "nf", playing: true }));   // Netflix plays by itself; Hulu's page waits for Play
    b.ops.length = 0;
    await vi.advanceTimersByTimeAsync(9_000);
    const presses = b.ops.filter((o) => o.op === "inject" && String(o.js).includes("__prismVideoPlay("));
    expect(presses.map((o) => o.id)).toEqual(["screen"]);
    expect(String(presses[0]!.js)).toContain("https://www.hulu.com/watch/abc");
  });

  it("a video service's page draws no browser controls: the wall's rule rides its adapter's css (2026-09-25, Apple TV's fullscreen <video>)", async () => {
    const { rt, ops } = await setup();
    ops.length = 0;
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    const withCss = ops.filter((o) => o.op === "inject" && o.id === "screen" && typeof (o as { css?: unknown }).css === "string");
    expect(withCss.some((o) => String((o as { css?: unknown }).css).includes("::-webkit-media-controls"))).toBe(true);
  });

  it("a pause from the wall keeps the picture in its window: a player that leaves fullscreen for its pause screen goes back; one left without a pause stays", async () => {
    const { rt, ops } = await setup();
    rt.event(JSON.stringify({ type: "fullscreen-element", id: "screen", contains: true }));
    await vi.advanceTimersByTimeAsync(20);
    const stageAsks = () => ops.filter((o) => o.op === "inject" && o.id === "screen" && String(o.js).includes("__prismStageTry")).length;
    await rt.tileCommand("screen", "pause");
    rt.event(JSON.stringify({ type: "fullscreen-element", id: "screen", contains: false }));   // Paramount+'s pause screen
    await vi.advanceTimersByTimeAsync(700);
    expect(stageAsks()).toBe(1);
    rt.event(JSON.stringify({ type: "fullscreen-element", id: "screen", contains: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "fullscreen-element", id: "screen", contains: false }));   // left later, not by a pause
    await vi.advanceTimersByTimeAsync(700);
    expect(stageAsks()).toBe(1);
  });

  it("a pause the wall was asked for holds once: a page that plays again by itself is paused again; a Play from the wall is left playing", async () => {
    const { rt, ops } = await setup();
    const pauses = () => ops.filter((o) => o.op === "inject" && o.id === "screen" && String(o.js).includes('__prismVideoCmd("pause")')).length;
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));
    await vi.advanceTimersByTimeAsync(20);
    await rt.tileCommand("screen", "pause");
    await vi.advanceTimersByTimeAsync(20);
    const first = pauses();
    expect(first).toBeGreaterThan(0);
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: false }));
    await vi.advanceTimersByTimeAsync(10_000);
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));   // Hulu, by itself
    await vi.advanceTimersByTimeAsync(20);
    expect(pauses()).toBe(first * 2);
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));   // again: not fought
    await vi.advanceTimersByTimeAsync(20);
    expect(pauses()).toBe(first * 2);
    await rt.tileCommand("screen", "play");
    rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));
    await vi.advanceTimersByTimeAsync(20);
    expect(pauses()).toBe(first * 2);
  });

  it("a title closed before the wall was is not brought back - the service's home comes up", async () => {
    const kv = new Map<string, string>();
    const { rt } = await setup(kv);
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/watch/abc" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "The Rookie", title: "Pilot", playing: true } } }));
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/hub/home" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, video: null } }));
    await vi.advanceTimersByTimeAsync(50);
    const b = rig(kv);
    const rt2 = createRuntime(b.drivers);
    rt2.init(kv.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(b.ops.find((o) => o.op === "navigate" && o.id === "screen")?.url).toBe("https://www.hulu.com/hub/home");
    expect(state(rt2).on).toBe(false);
  });

  it("only windows in the order count: a stray floating video window leaves the scene, nothing drawn behind the windows (2026-09-23, a 5th behind #2)", async () => {
    const { rt } = await setup();
    rt.videoMultiview("on");
    // a floating Netflix window the order never took - left by an older build, or a scene edited by hand
    const scene = () => (JSON.parse(rt.modelState()).scenes as Array<{ id: string; floating?: Array<{ facet: string }> }>).find((x) => x.id === "movie-night-1")!;
    const sc = scene();
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ ...sc, floating: [{ facet: "nf", anchor: "top-right", size: 0.24, face: "page" }] }))).ok).toBe(true);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["screen"]);   // not a window: the state already leaves it out ...
    await vi.advanceTimersByTimeAsync(50);
    expect((scene().floating ?? []).map((f) => f.facet)).toEqual([]);   // ... and it has left the scene
    // a pick on Netflix now opens it as a window of the order, once
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["nf", "screen"]);
    expect((scene().floating ?? []).filter((f) => f.facet === "nf")).toHaveLength(1);
  });

  it("a title brought back that still never starts after its second address is given up and forgotten: the next boot brings the service's home (2026-09-23, Apple's Hijack)", async () => {
    const kv = new Map<string, string>();
    const { rt } = await setup(kv);
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/watch/abc" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "movie", title: "Pilot", playing: true } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(kv.get("video:up:wall")).toContain("/watch/abc");
    const boot = () => {
      const b = rig(kv);
      const r2 = createRuntime(b.drivers);
      r2.init(kv.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } } }));
      return { b, r2 };
    };
    const one = boot();
    await vi.advanceTimersByTimeAsync(50);
    expect(one.b.ops.find((o) => o.op === "navigate" && o.id === "screen")?.url).toBe("https://www.hulu.com/watch/abc");
    one.r2.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(91_000);   // the second address at 45 s, and still nothing at 90 s
    const vs = JSON.parse(one.r2.videoState()) as Array<{ id: string; pending: { failed?: string } | null }>;
    expect(vs.find((t) => t.id === "screen")?.pending?.failed).toMatch(/did not start/);
    expect(kv.get("video:up:wall") ?? "{}").not.toContain("/watch/abc");
    const two = boot();
    await vi.advanceTimersByTimeAsync(50);
    expect(two.b.ops.find((o) => o.op === "navigate" && o.id === "screen")?.url).toBe("https://www.hulu.com/hub/home");
  });

  it("only a title that played is brought back: a page on a title's address that never played is not (2026-09-23)", async () => {
    const kv = new Map<string, string>();
    const { rt } = await setup(kv);
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/watch/abc" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, video: { kind: "movie", title: "Pilot", playing: false, position: 0 } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(kv.get("video:up:wall") ?? "{}").not.toContain("/watch/abc");
    const b = rig(kv);
    const r2 = createRuntime(b.drivers);
    r2.init(kv.get("dashboard")!, 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(b.ops.find((o) => o.op === "navigate" && o.id === "screen")?.url).toBe("https://www.hulu.com/hub/home");
  });

  it("a small window with no video closes after 45 s, the ones after it moving up; a pick still loading is kept (2026-09-24, \"Its not supposed to show any of them if not assigned a video\")", async () => {
    const { rt } = await setup();
    rt.videoMultiview("on");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");   // Netflix to the big window; Hulu's home page moves down, playing nothing
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.app)).toEqual(["netflix", "hulu"]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state(rt).windows.map((w) => w.app)).toEqual(["netflix", "hulu"]);   // not yet
    await vi.advanceTimersByTimeAsync(20_000);
    // the empty window is gone; Netflix's pick, still loading, stays - alone in the big place, as it was (2026-09-25)
    expect(state(rt).windows.map((w) => w.app)).toEqual(["netflix"]);
  });

  it("a second window of a service leaves the first one alone: not closed, not opened again (2026-09-25, Apple TV)", async () => {
    const { rt, ops } = await setup();
    rt.videoMultiview("on");
    rt.videoMultiview("target", "1");
    rt.videoPlayOn("hu", "title", "h2", "https://www.hulu.com/watch/h2", "Two");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    rt.videoMultiview("target", "2");
    rt.videoPlayOn("hu", "title", "h3", "https://www.hulu.com/watch/h3", "Three");
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.id === "hu" && (o.op === "destroy" || o.op === "create" || o.op === "navigate")).map((o) => o.op)).toEqual([]);
  });

  it("one service in several windows: a Hulu title dropped on window 2 and another on window 3 open two more Hulu windows, copies of its facet; clearing one removes its copy (2026-09-24)", async () => {
    const { rt } = await setup();
    rt.videoMultiview("on");
    rt.videoMultiview("target", "1");
    rt.videoPlayOn("hu", "title", "h2", "https://www.hulu.com/watch/h2", "Two");
    await vi.advanceTimersByTimeAsync(50);
    rt.videoMultiview("target", "2");
    rt.videoPlayOn("hu", "title", "h3", "https://www.hulu.com/watch/h3", "Three");
    await vi.advanceTimersByTimeAsync(50);
    const s = state(rt);
    expect(s.windows.map((w) => w.app)).toEqual(["hulu", "hulu", "hulu"]);
    expect(s.windows.map((w) => w.tile)).toEqual(["screen", "hu", "hu-w2"]);
    const facets = () => (JSON.parse(rt.modelState()) as { facets: Array<{ id: string }> }).facets.map((f) => f.id);
    expect(facets()).toContain("hu-w2");
    rt.videoMultiview("remove", "hu-w2");
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.map((w) => w.tile)).toEqual(["screen", "hu"]);
    expect(facets()).not.toContain("hu-w2");
    // the same service on the target place: the title plays in that window, nothing new opens
    rt.videoMultiview("target", "1");
    expect(JSON.parse(rt.videoPlayOn("hu", "title", "h4", "https://www.hulu.com/watch/h4", "Four"))).toMatchObject({ ok: true, tile: "hu" });
  });

  it("Clear screens: every small window closes and multiview ends; with one screen it still answers (2026-09-24, \"clear all the video screens even if only 1 is playing\")", async () => {
    const { rt, ops } = await setup();
    rt.videoMultiview("on");
    rt.videoMultiview("target", "1");
    rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace");
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).windows.length).toBe(2);
    expect(JSON.parse(rt.videoMultiview("clearAll"))).toMatchObject({ ok: true, cleared: true, on: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(state(rt).on).toBe(false);
    ops.length = 0;
    expect(JSON.parse(rt.videoMultiview("clearAll"))).toMatchObject({ ok: true, cleared: true, on: false });   // single screen: nothing to close, still fine
    await vi.advanceTimersByTimeAsync(50);
    // the screen's page leaves the title for its service's home, so its next report cannot bring the title back (2026-09-25)
    expect(ops.some((o) => o.op === "navigate" && o.id === "screen")).toBe(true);
  });

  it("back to start: past 5 s the title starts again; in its first 5 s an episode plays the one before (2026-09-24)", async () => {
    const { rt, ops } = await setup(undefined, { videoEpisodeNumber: "/*ep*/" });
    const report = (position: number, season: number, episode: number) => rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", title: "Pilot", series: "Parks and Recreation", season, episode, position, duration: 1300 } } }));
    report(120, 2, 3);
    await vi.advanceTimersByTimeAsync(10);
    ops.length = 0;
    expect(JSON.parse(rt.videoStartOver()).did).not.toBe("previous");   // two minutes in: back to the start, never the episode before
    expect(ops.some((o) => o.op === "inject" && String(o.js).includes("__prismVideoEpisodeNumber"))).toBe(false);
    report(2, 2, 3);
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(rt.videoStartOver())).toMatchObject({ ok: true, did: "previous", season: 2, episode: 2 });
    expect(ops.some((o) => o.op === "inject" && String(o.js).includes("__prismVideoEpisodeNumber(2, 2)"))).toBe(true);
    report(1, 2, 1);   // the season's first episode, the season before not listed yet: the start
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(rt.videoStartOver()).did).not.toBe("previous");
  });
});
