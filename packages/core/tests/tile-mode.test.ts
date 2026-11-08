import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function frame() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void calls.push({ op: "create", id: o.id, launch: o.launch ?? null }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    media: { launch: (pkg) => void calls.push({ op: "launch", pkg }) },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { o: new Orchestrator(drivers), calls, kv, drivers };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lr", name: "Living Room", layout: { mode: "grid" },
  tiles: [
    { id: "netflix", url: "https://www.netflix.com/browse", launch: { package: "com.netflix.ninja" }, area: "1 / 1 / 2 / 2" },
    { id: "yt", url: "https://youtube.com", area: "1 / 2 / 2 / 3" },
  ],
};

describe("web vs native tile mode (§12/§13 — native is opt-in)", () => {
  it("defaults to the web player, exposes the alternative, and switches on request (persisted)", async () => {
    const { o, calls, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    expect(calls.find((c) => c.op === "create" && c.id === "netflix")).toMatchObject({ launch: null });
    expect(calls.find((c) => c.op === "navigate" && c.id === "netflix")).toMatchObject({ url: "https://www.netflix.com/browse" });
    const before = o.getState()!.tiles.find((t) => t.id === "netflix")!;
    expect(before).toMatchObject({ mode: "web", url: "https://www.netflix.com/browse", alternative: { mode: "native", target: "com.netflix.ninja" } });
    expect(before.launch).toBeUndefined();
    expect(o.getState()!.tiles.find((t) => t.id === "yt")!.mode).toBeUndefined(); // single-form tiles carry no mode

    calls.length = 0;
    expect(await o.setTileMode("netflix", "native")).toBe("ok");
    expect(calls.map((c) => c.op)).toEqual(expect.arrayContaining(["destroy", "create"]));
    expect(calls.find((c) => c.op === "create" && c.id === "netflix")).toMatchObject({ launch: "com.netflix.ninja" });
    const after = o.getState()!.tiles.find((t) => t.id === "netflix")!;
    expect(after).toMatchObject({ mode: "native", launch: "com.netflix.ninja", alternative: { mode: "web", target: "https://www.netflix.com/browse" } });
    expect(kv.get("tile:mode:lr:netflix")).toBe("native");
    expect(await o.tileCommand("netflix", "launch")).toBe("ok"); // it's a launch tile now
    expect(await o.setTileMode("yt", "native")).toBe("not-switchable");
  });

  it("the persisted choice survives a reload; the remote route flips it", async () => {
    const { o, drivers, kv } = frame();
    kv.set("tile:mode:lr:netflix", "native");
    await o.load(doc, { w: 1000, h: 600 });
    expect(o.getState()!.tiles.find((t) => t.id === "netflix")!.mode).toBe("native");
    const api = new RemoteApi(o, drivers.store);
    const { token } = await api.mintPairing("http://frame");
    expect((await api.handle({ method: "PUT", path: "/tiles/netflix/mode", body: '{"mode":"web"}', token })).status).toBe(200);
    expect(o.getState()!.tiles.find((t) => t.id === "netflix")!.mode).toBe("web");
    expect((await api.handle({ method: "PUT", path: "/tiles/yt/mode", body: '{"mode":"native"}', token })).status).toBe(409);
    expect((await api.handle({ method: "PUT", path: "/tiles/netflix/mode", body: '{"mode":"tv"}', token })).status).toBe(400);
  });
});
