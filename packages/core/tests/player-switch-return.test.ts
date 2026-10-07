import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// "All of the multiview windows are gone, and the big window is sitting on a youtubetv page" (2026-10-07): the Music player and back
// destroyed and remade the Video player's windows, and none was tuned back to the channel it had up. A window made again comes back to
// what it had up, as after a restart.
function rig(kv = new Map<string, string>()) {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, css, js) => void ops.push({ op: "inject", id, js, css }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { ops, drivers, kv };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

describe("the Video player after the Music player", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a live channel's window, made again on the way back, is tuned to the channel it had up", async () => {
    const r = rig();
    const rt = createRuntime(r.drivers);
    const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoTune: "/*tune*/" } };
    rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "hulu", name: "Hulu", adapter: "hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "lounge", name: "Lounge", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "stage", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "music-lounge" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "music-lounge-1", name: "Music Lounge", layout: "lounge", assign: {}, floating: [], hidden: [] }))).ok).toBe(true);
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/live/4928" }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "live", series: "Funniest Videos", title: "S7 E1", channel: "Funniest Videos", id: "4928", url: "https://www.hulu.com/live/4928", playing: true } } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.switchPlayer("music")).ok).not.toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(r.ops.some((o) => o.op === "destroy" && o.id === "screen")).toBe(true);   // the Video player's window went with it
    expect(r.kv.get("video:up:wall")).toContain("Funniest Videos");   // the record kept while the Music player is on
    r.ops.length = 0;
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    expect(r.ops.find((o) => o.op === "navigate" && o.id === "screen")?.url).toBe("https://www.hulu.com/hub/home");   // made again: its home
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(r.ops.some((o) => o.op === "inject" && o.id === "screen" && String(o.js).includes('__prismVideoTune("Funniest Videos")'))).toBe(true);   // and tuned back
  });
});
