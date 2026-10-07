import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";

// A new device's wall (2026-09-29): it boots with nothing on it - no demo services under the welcome page - and the players made from the
// services chosen take it over.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const errors: string[] = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, errors, drivers };
}
const EMPTY = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "grid" }, tiles: [] };
const CATALOG = [
  { id: "netflix", name: "Netflix", url: "https://www.netflix.com/browse", adapter: "netflix", audio: "exclusive" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/", adapter: null, audio: "exclusive" },
];

describe("a new device's wall", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());
  it("a document with no tiles boots: nothing is made, the state answers, no player yet", async () => {
    const r = rig();
    const rt = createRuntime(r.drivers);
    rt.init(JSON.stringify(EMPTY), 1920, 1080, JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" }, spotify: { match: ["open.spotify.com"], capabilities: ["media-session"] } } }));
    await vi.advanceTimersByTimeAsync(100);
    expect(r.ops.filter((o) => o.op === "create")).toEqual([]);
    expect(JSON.parse(rt.state())).toMatchObject({ tiles: [] });
    expect(JSON.parse(rt.players())).toEqual({ active: null, music: null, video: null });
    // the welcome page's Continue: both players, and the wall becomes the Video player
    expect(JSON.parse(rt.playerSetup(JSON.stringify(CATALOG)))).toMatchObject({ ok: true, music: "music-lounge-1", video: "movie-night-1" });
    expect(JSON.parse(rt.switchPlayer("video"))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(rt.players())).toMatchObject({ active: "video" });
    expect(r.ops.filter((o) => o.op === "create").map((o) => o.id).sort()).toEqual(["screen", "spotify-home-16x9-XL"]);
  });
});

describe("an App's setup window and the wall (2026-09-29)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());
  it("a wall applied again does not close a sign-in window's page", async () => {
    const r = rig();
    const rt = createRuntime(r.drivers);
    rt.init(JSON.stringify(EMPTY), 1920, 1080, JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" }, spotify: { match: ["open.spotify.com"], capabilities: ["media-session"] } } }));
    await vi.advanceTimersByTimeAsync(100);
    rt.playerSetup(JSON.stringify(CATALOG));
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(100);
    const id = rt.modelOpenAppSurface("netflix", "https://www.netflix.com/login");
    await vi.advanceTimersByTimeAsync(100);
    expect(id).toBe("app:netflix:preview");
    rt.switchPlayer("music");   // the wall is applied again
    await vi.advanceTimersByTimeAsync(200);
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(200);
    expect(r.ops.filter((o) => o.op === "destroy" && o.id === id)).toEqual([]);
    expect(rt.modelCloseAppSurface(id)).toBe("ok");
    expect(r.ops.filter((o) => o.op === "destroy" && o.id === id).length).toBe(1);
  });
});

describe("the Video player after a restart (2026-09-29)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());
  it("comes up with the music warm beside it, and its scene holds none of it", async () => {
    const r = rig();
    const opts = JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" }, spotify: { match: ["open.spotify.com"], capabilities: ["media-session"] } } });
    const first = createRuntime(r.drivers);
    first.init(JSON.stringify(EMPTY), 1920, 1080, opts);
    await vi.advanceTimersByTimeAsync(100);
    first.playerSetup(JSON.stringify(CATALOG));
    first.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(200);
    const kept = r.store.get("dashboard");
    expect(kept).toBeTruthy();
    // the next start: a new runtime over the same store, the kept document handed back
    r.ops.length = 0;
    const next = createRuntime(r.drivers);
    next.init(kept!, 1920, 1080, opts);
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(next.players())).toMatchObject({ active: "video" });
    expect((JSON.parse(next.state()).tiles as Array<{ id: string }>).map((t) => t.id).sort()).toEqual(["screen", "spotify-home-16x9-XL"]);
    const scenes = (JSON.parse(next.modelState()) as { scenes: Array<{ id: string; hidden: unknown[] }> }).scenes;
    expect(scenes.find((s) => s.id === "movie-night-1")!.hidden).toEqual([]);
  });
});
