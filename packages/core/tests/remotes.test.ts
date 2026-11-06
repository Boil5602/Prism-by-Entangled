import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function frame(withInput: boolean) {
  const calls: string[] = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
    },
    ...(withInput
      ? {
          input: {
            startPairing: () => void calls.push("pair"),
            listRemotes: () => [
              { device: "kitchen-remote", name: "Kitchen Remote", connected: false, battery: null },
              { device: "kitchen-remote", name: "Kitchen Remote", connected: true, battery: 72 }, // BLE + classic records
              { device: "8bitdo-micro", name: "8BitDo Micro", connected: false, battery: null },
            ],
          },
        }
      : {}),
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  return { o, calls, api: new RemoteApi(o, drivers.store) };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "d", name: "D", layout: { mode: "grid" },
  tiles: [{ id: "a", url: "https://a.test", area: "1 / 1 / 2 / 2" }],
  inputs: { "device:kitchen-remote": { KEY_1: { tile: "a", cmd: "reload" } } },
};

describe("§11 remotes via core + remote API", () => {
  it("lists paired remotes with override slugs and battery where reported; pairing is shell-owned", async () => {
    const { o, api, calls } = frame(true);
    await o.load(doc, { w: 800, h: 600 });
    const { token } = await api.mintPairing("http://frame");
    const list = JSON.parse((await api.handle({ method: "GET", path: "/input/devices", body: null, token })).body);
    expect(list.devices).toEqual([
      { device: "kitchen-remote", name: "Kitchen Remote", connected: true, battery: 72, overridden: true },
      { device: "8bitdo-micro", name: "8BitDo Micro", connected: false, battery: null, overridden: false },
    ]);
    const pair = await api.handle({ method: "POST", path: "/input/pair", body: null, token });
    expect(pair.status).toBe(200);
    expect(calls).toEqual(["pair"]);
  });

  it("is honest when the shell has no input driver", async () => {
    const { api } = frame(false);
    const { token } = await api.mintPairing("http://frame");
    expect(JSON.parse((await api.handle({ method: "GET", path: "/input/devices", body: null, token })).body)).toEqual({ devices: [] });
    expect((await api.handle({ method: "POST", path: "/input/pair", body: null, token })).status).toBe(501);
  });
});
