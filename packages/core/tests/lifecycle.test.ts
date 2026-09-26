import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig() {
  const calls: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", id: opts.id }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: () => {},
      freeze: (id) => void calls.push({ op: "freeze", id }),
      reveal: (id) => void calls.push({ op: "reveal", id }),
      suspend: (id) => void calls.push({ op: "suspend", id }),
      resume: (id) => void calls.push({ op: "resume", id }),
      setMuted: () => {},
    },
    store: { get: () => null, set: () => {} },
  };
  return { calls, drivers };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "budget",
  name: "Budget",
  layout: { mode: "hero", hero: "a", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "a", url: "https://a.test", audio: "exclusive", persist: true },
    { id: "b", url: "https://b.test", audio: "mute", refresh: 60 },
    { id: "c", url: "https://c.test", audio: "mute" },
    { id: "d", url: "https://d.test", audio: "exclusive" },
  ],
};

const VIEWPORT = { w: 1000, h: 625 };

// Full §16 readiness per tile: load + paint + settle → reveal → enforcement.
async function revealAll(o: Orchestrator, ids: string[]) {
  for (const id of ids) {
    await o.onSurfaceEvent({ type: "load-finished", id, ok: true });
    await o.onSurfaceEvent({ type: "first-paint", id });
  }
  await vi.advanceTimersByTimeAsync(300);
}

const ops = (calls: Array<Record<string, unknown>>, op: string) =>
  calls.filter((c) => c.op === op).map((c) => c.id);

describe("tile lifecycle (§18)", () => {
  it("demotes LRU non-persist tiles beyond maxLiveTiles, only after reveal", async () => {
    const { calls, drivers } = rig();
    const o = new Orchestrator(drivers);
    o.setMaxLiveTiles(2);
    await o.load(doc, VIEWPORT);

    // nothing demoted before tiles have real pixels
    expect(ops(calls, "suspend")).toEqual([]);

    await revealAll(o, ["a", "b", "c", "d"]);
    // 4 live, cap 2, 'a' is persist → demote b then c (LRU among candidates)
    expect(ops(calls, "suspend")).toEqual(["b", "c"]);
    // demotion is freeze-then-suspend — pixels stay on the wall
    expect(ops(calls, "freeze")).toEqual(["b", "c"]);
    expect(o.getState()?.tiles.map((t) => [t.id, t.state])).toEqual([
      ["a", "live"], ["b", "warm"], ["c", "warm"], ["d", "live"],
    ]);
  });

  it("interaction revives a warm tile through resume + the §16 load path", async () => {
    const { calls, drivers } = rig();
    const o = new Orchestrator(drivers);
    o.setMaxLiveTiles(2);
    await o.load(doc, VIEWPORT);
    await revealAll(o, ["a", "b", "c", "d"]);
    calls.length = 0;

    await o.onSurfaceEvent({ type: "interaction", id: "c" });
    expect(ops(calls, "resume")).toEqual(["c"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ops(calls, "navigate")).toEqual(["c"]);
    expect(o.getState()?.tiles.find((t) => t.id === "c")?.state).toBe("live");

    // when it reveals fresh pixels, enforcement rotates the next LRU out
    await revealAll(o, ["c"]);
    expect(ops(calls, "suspend")).toEqual(["d"]);
  });

  it("persist and audible tiles are never demoted", async () => {
    const { calls, drivers } = rig();
    const o = new Orchestrator(drivers);
    o.setMaxLiveTiles(1);
    await o.load(doc, VIEWPORT);
    await o.onSurfaceEvent({ type: "playback", id: "d", playing: true }); // d audible
    await revealAll(o, ["a", "b", "c", "d"]);
    // a persist, d audible → only b and c can go warm; stays over budget at 2 live
    expect(ops(calls, "suspend").sort()).toEqual(["b", "c"]);
    const state = o.getState()!;
    expect(state.tiles.find((t) => t.id === "a")?.state).toBe("live");
    expect(state.tiles.find((t) => t.id === "d")?.state).toBe("live");
  });

  it("warm tiles with a refresh interval revive on cadence for fresh pixels", async () => {
    const { calls, drivers } = rig();
    const o = new Orchestrator(drivers);
    o.setMaxLiveTiles(2);
    await o.load(doc, VIEWPORT);
    await revealAll(o, ["a", "b", "c", "d"]);
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(60_000); // b's refresh cadence
    expect(ops(calls, "resume")).toEqual(["b"]);
    expect(ops(calls, "navigate")).toEqual(["b"]);
  });

  it("no cap → nothing ever demoted", async () => {
    const { calls, drivers } = rig();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    await revealAll(o, ["a", "b", "c", "d"]);
    expect(ops(calls, "suspend")).toEqual([]);
  });

  it("dashboard switch drops lifecycle state for removed tiles", async () => {
    const { calls, drivers } = rig();
    const o = new Orchestrator(drivers);
    o.setMaxLiveTiles(2);
    await o.loadBundle(
      { dashboards: [doc, { ...doc, id: "other", tiles: doc.tiles.slice(0, 1) }] },
      VIEWPORT,
    );
    await revealAll(o, ["a", "b", "c", "d"]);
    await o.switchTo("other"); // drops b (warm, 60s cadence), c, d
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(600_000);
    // no revive timers firing for dropped tiles
    expect(ops(calls, "resume")).toEqual([]);
  });
});
