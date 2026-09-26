import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// The stage (docs/video-menu-spec.md §6 Decision, 2026-09-20): a play a person asked for enters the player's OWN fullscreen
// once it begins - the adapter's videoCmd fullscreen, else its presentation.enterFullscreen - exactly once, never for a
// play nobody asked for, never while an ad plays, never when the tile is already in element fullscreen, and never when
// the adapter names no control (no hunt).

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _c, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const injects = (ops: Array<Record<string, unknown>>, id: string, fn: string) => ops.filter((o) => o.op === "inject" && o.id === id && String(o.js).includes(fn));

async function setup(adapters: Record<string, unknown>) {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
  await vi.advanceTimersByTimeAsync(50);
  expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}
const playing = (rt: ReturnType<typeof createRuntime>, title: string, ad = false) =>
  rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", id: "e1", title, series: "Show", url: "https://www.hulu.com/watch/e1", playing: true, ad } } }));

describe("the stage", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a pick called off before it plays never takes the stage, and a page that begins anyway is paused once (Cancel and return to Watch, 2026-09-22)", async () => {
    const { rt, ops } = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } });
    expect(JSON.parse(rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One"))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoCancelPick())).toMatchObject({ ok: true });
    ops.length = 0;
    playing(rt, "Ep One");   // the deep link had already loaded, and its page began
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(0);
    const pauses = ops.filter((o) => o.op === "inject" && o.id === "screen" && /pause/i.test(String(o.js))).length;
    expect(pauses).toBeGreaterThan(0);
    ops.length = 0;
    playing(rt, "Ep One");   // the person pressed play on it themselves afterwards: left alone
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "inject" && o.id === "screen" && /pause/i.test(String(o.js))).length).toBe(0);
  });

  it("a human's play enters the player's own fullscreen once it plays - once, through the adapter's control", async () => {
    const { rt, ops } = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } });
    expect(JSON.parse(rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One"))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(0);   // not before it plays
    playing(rt, "Ep One", true);                                     // the pre-roll: not a title
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(0);
    playing(rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(1);
    playing(rt, "Ep One"); playing(rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(3);   // re-asked while the page is not in fullscreen (the page-side guard keeps one loop)
    rt.event(JSON.stringify({ type: "fullscreen-element", id: "screen", contains: true }));
    playing(rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(3);   // in fullscreen: no more
  });

  it("the stage goes through the adapter's videoCmd alone; the keeper's own presentation control is never pressed for it", async () => {
    const { rt, ops } = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/", presentation: { enterFullscreen: "button[aria-label='Fullscreen']" } } });
    rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One");
    await vi.advanceTimersByTimeAsync(50);
    playing(rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(1);
    expect(injects(ops, "screen", "Fullscreen']").length).toBe(0);
  });

  it("no ask, no stage; no control, no hunt; already in element fullscreen, nothing; an old ask expires", async () => {
    const none = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } });
    playing(none.rt, "Something nobody asked for");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(none.ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(0);
    const bare = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", presentation: { enterFullscreen: "button[aria-label='Fullscreen']" } } });   // the keeper's control alone: not the stage's
    bare.rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One");
    await vi.advanceTimersByTimeAsync(50);
    playing(bare.rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(bare.ops.filter((o) => o.op === "inject" && /ullscreen/i.test(String(o.js))).length).toBe(0);
    const fs = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } });
    fs.rt.event(JSON.stringify({ type: "fullscreen-element", id: "screen", contains: true }));
    fs.rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One");
    await vi.advanceTimersByTimeAsync(50);
    playing(fs.rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(fs.ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(0);
    const late = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } });
    late.rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One");
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    playing(late.rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(late.ops, "screen", '__prismVideoCmd("fullscreen")').length).toBe(0);
  });
});

describe("the page's own playback error (2026-09-21)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("is said on the wall, marks the pick failed with the page's words, refreshes the title once, and Retry opens it again", async () => {
    const { rt, ops } = await setup({ hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } });
    rt.videoPlayOn("hu", "title", "e1", "https://www.hulu.com/watch/e1", "Ep One");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    const errored = () => rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, video: { kind: "error", error: "Hulu: Error playing video (RUNUNK13)", url: "https://www.hulu.com/watch/e1" } } }));
    errored();
    await vi.advanceTimersByTimeAsync(10);
    let tile = JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    expect(tile.error).toBe("Hulu: Error playing video (RUNUNK13)");
    expect(tile.pending?.failed).toBe("Hulu: Error playing video (RUNUNK13)");
    expect(tile.video).toBeNull();   // no title is playing on an error page
    expect(ops.filter((o) => o.op === "navigate").length).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ops.filter((o) => o.op === "navigate" && o.url === "https://www.hulu.com/watch/e1").length).toBe(1);   // the one refresh
    errored(); errored();
    await vi.advanceTimersByTimeAsync(5000);
    expect(ops.filter((o) => o.op === "navigate").length).toBe(1);   // never a second refresh on its own
    rt.tileCommand("screen", "retry");
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "navigate").length).toBe(2);   // the person's Retry
    tile = JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    expect(tile.error).toBeNull();
    // the title plays after all: the error is gone from the wall
    playing(rt, "Ep One");
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen").video?.title).toBe("Ep One");
  });
});
