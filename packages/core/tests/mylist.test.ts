import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// My List on the service itself (2026-09-23, "lets do My List exactly the same way for adding/removing items including queuing and
// multi-hidden sessions"): the adapter's videoListSet on the App's hidden work page, its address rules tried in order, the row following at once.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind }), destroy: (id) => void ops.push({ op: "destroy", id }), setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _c, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
      hover: (id, x, y) => void ops.push({ op: "hover", id, x, y }),
    },
    store: { get: () => null, set: () => {} },
  };
  return { ops, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoListSet: "/*ls*/", videoListSetUrl: ["https://www.hulu.com/series/{id}", "https://www.hulu.com/movie/{id}"] } };
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
  await vi.advanceTimersByTimeAsync(50);
  expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "hulu", name: "Hulu", adapter: "hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}
const W = "app:hulu:work";
const tokenOf = (ops: Array<Record<string, unknown>>) => { const o = [...ops].reverse().find((x) => x.op === "inject" && x.id === W && String(x.js).includes("__prismVideoListSet(")); return o ? /__prismVideoListSet[(]"([^"]+)"/.exec(String(o.js))![1]! : null; };
const up = async (rt: ReturnType<typeof createRuntime>) => { rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true })); await vi.advanceTimersByTimeAsync(20); };
const answer = async (rt: ReturnType<typeof createRuntime>, token: string, ok: boolean, error?: string) => { rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "list", ok, ...(error ? { error } : {}) })); await vi.advanceTimersByTimeAsync(20); };
const listRow = (rt: ReturnType<typeof createRuntime>) => (JSON.parse(rt.videoMenu()) as { list: Array<{ item: { id: string; title: string } }> }).list.map((c) => c.item.title);

describe("My List on the service itself", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("an add tries the adapter's addresses in order - a page with no toggle for the title passes to the next - and the title is in My List at once", async () => {
    const { rt, ops } = await setup();
    expect(JSON.parse(rt.videoListInfo("hulu"))).toMatchObject({ can: true });
    expect(JSON.parse(rt.videoListSet("hulu", "add", "m1", "Prey", null, "movie", null))).toMatchObject({ status: "working" });
    await vi.advanceTimersByTimeAsync(20);
    expect(listRow(rt)).toContain("Prey");   // shown while it works
    expect(ops.find((o) => o.op === "navigate" && o.id === W)).toMatchObject({ url: "https://www.hulu.com/series/m1" });
    await up(rt);
    expect(String(ops.find((o) => o.op === "inject" && String(o.js).includes("__prismVideoListSet("))!.js)).toContain(", true, ");
    await answer(rt, tokenOf(ops)!, false, "not-found");
    await vi.advanceTimersByTimeAsync(20);
    expect([...ops].reverse().find((o) => o.op === "navigate" && o.id === W)).toMatchObject({ url: "https://www.hulu.com/movie/m1" });
    await up(rt);
    await answer(rt, tokenOf(ops)!, true);
    expect(JSON.parse(rt.videoListSet("hulu", "add", "m1", "Prey", null, "movie", null))).toMatchObject({ status: "done" });
    expect(listRow(rt)).toContain("Prey");   // kept: the service's list has it now
  });

  it("a removal takes the title out of My List while it works and brings it back when the service says no", async () => {
    const { rt, ops } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [], list: [{ id: "b1", title: "Breeders", kind: "series", url: null }], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(20);
    expect(listRow(rt)).toContain("Breeders");
    rt.videoListSet("hulu", "remove", "b1", "Breeders", null, "series", null);
    await vi.advanceTimersByTimeAsync(20);
    expect(listRow(rt)).not.toContain("Breeders");
    await up(rt);
    expect(String([...ops].reverse().find((o) => o.op === "inject" && String(o.js).includes("__prismVideoListSet("))!.js)).toContain(", false, ");
    await answer(rt, tokenOf(ops)!, false, "Hulu did not take it off");
    expect(JSON.parse(rt.videoListSet("hulu", "remove", "b1", "Breeders", null, "series", null))).toMatchObject({ status: "failed", error: "Hulu did not take it off" });
    expect(listRow(rt)).toContain("Breeders");
  });
});
