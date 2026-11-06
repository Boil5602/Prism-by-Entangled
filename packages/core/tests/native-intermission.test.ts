import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function frame() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
      showIntermission: (id, source) => void calls.push({ op: "cover", id, source }),
      hideIntermission: (id) => void calls.push({ op: "uncover", id }),
      setIntermissionSkip: (id, available) => void calls.push({ op: "chip", id, available }),
    },
    media: {
      launch: () => {},
      appSkip: (pkg, target) => {
        calls.push({ op: "appSkip", pkg, target });
        return true;
      },
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { o: new Orchestrator(drivers), calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lr", name: "Living Room", layout: { mode: "grid" },
  tiles: [
    { id: "prime", launch: { package: "com.amazon.amazonvideo.livingroom" }, area: "1 / 1 / 2 / 2", intermission: { enabled: true, source: "pack:cosmos" } },
    { id: "plex", launch: { package: "com.plexapp.android" }, area: "1 / 2 / 2 / 3" }, // no intermission configured
  ],
};

describe("§26 over native apps (accessibility observer → launch tile)", () => {
  it("maps package observations to the launch tile, covers slow, shows the chip, forwards only a human skip", async () => {
    const { o, calls } = frame();
    await o.load(doc, { w: 1920, h: 1080 });
    const pkg = "com.amazon.amazonvideo.livingroom";
    await o.onSurfaceEvent({ type: "app-foreground", id: "", package: pkg });
    expect(o.getState()!.foregroundApp).toBe(pkg);

    await o.onSurfaceEvent({ type: "app-ad-break", id: "", package: pkg, active: true });
    expect(calls.find((c) => c.op === "cover")).toBeUndefined(); // cover slow: debounce
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.find((c) => c.op === "cover")).toEqual({ op: "cover", id: "prime", source: "pack:cosmos" });

    await o.onSurfaceEvent({ type: "app-skip-available", id: "", package: pkg, available: true, target: "text:Skip Ad" });
    expect(calls.find((c) => c.op === "chip")).toEqual({ op: "chip", id: "prime", available: true });
    expect(o.getState()!.tiles.find((t) => t.id === "prime")).toMatchObject({ intermission: true, skipAvailable: true });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.filter((c) => c.op === "appSkip")).toEqual([]); // time never forwards

    await o.onSurfaceEvent({ type: "intermission-skip", id: "prime" }); // the human pressed the chip
    expect(calls.at(-1)).toEqual({ op: "appSkip", pkg, target: "text:Skip Ad" });

    await o.onSurfaceEvent({ type: "app-skip-available", id: "", package: pkg, available: false });
    expect(await o.tileCommand("prime", "skip")).toBe("unavailable");
    await o.onSurfaceEvent({ type: "app-ad-break", id: "", package: pkg, active: false });
    expect(calls.at(-1)).toEqual({ op: "uncover", id: "prime" }); // uncover fast
  });

  it("ignores packages with no launch tile and tiles without intermission configured", async () => {
    const { o, calls } = frame();
    await o.load(doc, { w: 1920, h: 1080 });
    await o.onSurfaceEvent({ type: "app-ad-break", id: "", package: "com.unknown.app", active: true });
    await o.onSurfaceEvent({ type: "app-ad-break", id: "", package: "com.plexapp.android", active: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.filter((c) => c.op === "cover")).toEqual([]);
  });
});
