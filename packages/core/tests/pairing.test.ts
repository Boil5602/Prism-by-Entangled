import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";

function frame() {
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return new RemoteApi(new Orchestrator(drivers), drivers.store);
}

describe("multi-frame pairing (§6)", () => {
  it("signals `paired` exactly once, on a token's first authenticated use", async () => {
    const api = frame();
    const paired: string[] = [];
    api.onPaired = (t) => void paired.push(t);
    const { token } = await api.mintPairing("http://frame");
    await api.handle({ method: "GET", path: "/state", body: null, token: "bogus" }); // 401: not a pairing
    expect(paired).toEqual([]);
    await api.handle({ method: "GET", path: "/state", body: null, token });
    await api.handle({ method: "GET", path: "/rects", body: null, token });
    expect(paired).toEqual([token]);
  });

  it("a phone can forget a frame: DELETE /pairing revokes only its own token", async () => {
    const api = frame();
    const a = await api.mintPairing("http://frame");
    const b = await api.mintPairing("http://frame");
    expect((await api.listDevices()).length).toBe(2);
    expect((await api.handle({ method: "DELETE", path: "/pairing", body: null, token: a.token })).status).toBe(200);
    expect((await api.listDevices()).length).toBe(1);
    expect((await api.handle({ method: "GET", path: "/state", body: null, token: a.token })).status).toBe(401);
    expect((await api.handle({ method: "GET", path: "/rects", body: null, token: b.token })).status).toBe(200);
  });
});

describe("paired means a phone that connected (§6 housekeeping)", () => {
  it("names a device from its browser, counts only used tokens, and prunes dead QRs but the newest", async () => {
    const api = frame();
    const dead1 = await api.mintPairing("http://frame"); // boot QR nobody scanned
    const phone = await api.mintPairing("http://frame");
    const dead2 = await api.mintPairing("http://frame");
    await api.handle({ method: "GET", path: "/rects", body: null, token: phone.token, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15" });
    expect(await api.pairedCount()).toBe(1);
    const named = (await api.listDevices()).find((d) => d.lastSeen)!;
    expect(named.name).toBe("iPhone");
    const newest = await api.mintPairing("http://frame"); // the code on screen right now
    expect(await api.pruneUnused()).toBe(2); // dead1 + dead2 gone
    const left = await api.listDevices();
    expect(left.length).toBe(2); // the phone and the newest unscanned code
    expect((await api.handle({ method: "GET", path: "/rects", body: null, token: phone.token })).status).toBe(200);
    expect((await api.handle({ method: "GET", path: "/rects", body: null, token: newest.token })).status).toBe(200);
    expect((await api.handle({ method: "GET", path: "/rects", body: null, token: dead1.token })).status).toBe(401);
    expect((await api.handle({ method: "GET", path: "/rects", body: null, token: dead2.token })).status).toBe(401);
  });
});
