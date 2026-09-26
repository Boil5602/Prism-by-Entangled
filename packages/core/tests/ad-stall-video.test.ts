import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// A video service's stalled break (2026-09-25): South Park's pre-roll on Paramount+ stood at "36" for minutes after a restart. The break's
// own clock standing still is nudged with the service's own pause and play, twice, as for music; a video title still stuck is opened again.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _c, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
      setAdInfo: (id, count, remaining) => void ops.push({ op: "adinfo", id, count, remaining }),
    },
    store: { get: () => null, set: () => {} },
  };
  return { ops, drivers };
}
const URL = "https://www.paramountplus.com/shows/video/EP1/";
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "pp", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "pp", url: "https://www.paramountplus.com/home/", audio: "exclusive", adapter: "paramountplus" }] };

describe("a video service's stalled break", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is nudged with its own player's pause and play, twice, and then the title is opened again", async () => {
    const { ops, drivers } = rig();
    const rt = createRuntime(drivers);
    rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { paramountplus: { match: ["www.paramountplus.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    const face = { kind: "episode", title: "South American Biker Gangs", series: "South Park", url: URL, id: "EP1", playing: false, position: 0, duration: 1626, ad: true };
    // the title the wall asked for, on its page, in a break whose clock says 36
    rt.videoPlay("pp", "title", URL, URL, "South Park");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "url-changed", id: "pp", url: URL }));
    rt.event(JSON.stringify({ type: "ad-break", id: "pp", active: true }));
    const tick = async (ms: number) => { for (let t = 0; t < ms; t += 5000) { rt.event(JSON.stringify({ type: "now-playing", id: "pp", info: { playing: false, video: face } })); rt.event(JSON.stringify({ type: "ad-info", id: "pp", remaining: 36 })); await vi.advanceTimersByTimeAsync(5000); } };
    await tick(50_000);
    const nudges = () => ops.filter((o) => o.op === "inject" && o.id === "pp" && String(o.js).includes('__prismVideoCmd("pause")') && String(o.js).includes('__prismVideoCmd("play")'));
    expect(nudges().length).toBe(1);
    await tick(50_000);
    expect(nudges().length).toBe(2);
    ops.length = 0;
    await tick(60_000);
    expect(ops.some((o) => o.op === "adinfo" && String(o.count).includes("opening the title again"))).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ops.some((o) => o.op === "navigate" && o.id === "pp" && o.url === URL)).toBe(true);   // the title's own address again
  });
});
