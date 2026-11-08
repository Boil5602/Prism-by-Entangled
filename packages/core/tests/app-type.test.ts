import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function frame(withObserver: boolean) {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    media: {
      launch: () => {},
      ...(withObserver
        ? {
            appType: (pkg: string, text: string) => {
              calls.push({ op: "appType", pkg, text });
              return text !== "nofield";
            },
            appBack: (pkg: string) => {
              calls.push({ op: "appBack", pkg });
              return true;
            },
          }
        : {}),
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  return { o, calls, api: new RemoteApi(o, drivers.store) };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1", id: "d", name: "D", layout: { mode: "grid" },
  tiles: [{ id: "prime", launch: { package: "com.amazon.amazonvideo.livingroom" }, area: "1 / 1 / 2 / 2" }],
};

describe("typing into the native app in front (§7 via the observer)", () => {
  it("forwards a human's text and Back only to the foreground app; honest errors otherwise", async () => {
    const { o, calls, api } = frame(true);
    await o.load(doc, { w: 1000, h: 600 });
    const { token } = await api.mintPairing("http://frame");
    expect((await api.handle({ method: "POST", path: "/apps/type", body: '{"text":"me@x.test"}', token })).status).toBe(409); // nothing in front
    await o.onSurfaceEvent({ type: "app-foreground", id: "", package: "com.amazon.amazonvideo.livingroom" });
    expect((await api.handle({ method: "POST", path: "/apps/type", body: '{"text":"me@x.test"}', token })).status).toBe(200);
    expect(calls.at(-1)).toEqual({ op: "appType", pkg: "com.amazon.amazonvideo.livingroom", text: "me@x.test" });
    expect((await api.handle({ method: "POST", path: "/apps/type", body: '{"text":"nofield"}', token })).status).toBe(409);
    expect((await api.handle({ method: "POST", path: "/apps/back", body: null, token })).status).toBe(200);
    expect(calls.at(-1)).toEqual({ op: "appBack", pkg: "com.amazon.amazonvideo.livingroom" });
    expect((await api.handle({ method: "POST", path: "/apps/type", body: "{}", token })).status).toBe(400);
  });

  it("is a 501 on frames without the observer", async () => {
    const { o, api } = frame(false);
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "app-foreground", id: "", package: "com.amazon.amazonvideo.livingroom" });
    const { token } = await api.mintPairing("http://frame");
    expect((await api.handle({ method: "POST", path: "/apps/type", body: '{"text":"x"}', token })).status).toBe(501);
  });
});
