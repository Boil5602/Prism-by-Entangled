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
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    media: {
      launch: (pkg, deepLink) => void calls.push({ op: "launch", pkg, deepLink }),
      listApps: () => [
        { package: "com.plexapp.android", label: "Plex" },
        { package: "com.netflix.ninja", label: "Netflix" },
      ],
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  return { o, api: new RemoteApi(o, drivers.store), calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "d", name: "D", layout: { mode: "grid" },
  tiles: [
    { id: "yt", url: "https://www.youtube.com", area: "1 / 1 / 2 / 2", audio: "exclusive" },
    { id: "netflix", launch: { package: "com.netflix.ninja" }, area: "1 / 2 / 2 / 3" },
  ],
};

describe("POST /navigate (§6)", () => {
  it("sends a web tile to an http(s) URL through the §16 load path and remembers it", async () => {
    const { o, api, calls } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    const { token } = await api.mintPairing("http://frame");
    calls.length = 0;
    const res = await api.handle({ method: "POST", path: "/navigate", body: JSON.stringify({ tile: "yt", url: "https://www.youtube.com/watch?v=abc" }), token });
    expect(res.status).toBe(200);
    expect(calls).toContainEqual({ op: "navigate", id: "yt", url: "https://www.youtube.com/watch?v=abc" });
    expect(o.getState()!.tiles.find((t) => t.id === "yt")!.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(o.getState()!.tiles.find((t) => t.id === "netflix")!.launch).toBe("com.netflix.ninja");
  });

  it("refuses non-http URLs, unknown tiles, and launch tiles", async () => {
    const { o, api } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    const { token } = await api.mintPairing("http://frame");
    expect((await api.handle({ method: "POST", path: "/navigate", body: '{"tile":"yt","url":"javascript:alert(1)"}', token })).status).toBe(400);
    expect((await api.handle({ method: "POST", path: "/navigate", body: '{"tile":"yt","url":"not a url"}', token })).status).toBe(400);
    expect((await api.handle({ method: "POST", path: "/navigate", body: '{"tile":"nope","url":"https://x.test"}', token })).status).toBe(404);
    expect((await api.handle({ method: "POST", path: "/navigate", body: '{"tile":"netflix","url":"https://x.test"}', token })).status).toBe(409);
  });
});

describe("apps (§12) via the remote", () => {
  it("lists installed apps sorted by label and launches by package", async () => {
    const { o, api, calls } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    const { token } = await api.mintPairing("http://frame");
    const apps = JSON.parse((await api.handle({ method: "GET", path: "/apps", body: null, token })).body);
    expect(apps.apps.map((a: { label: string }) => a.label)).toEqual(["Netflix", "Plex"]);
    const res = await api.handle({ method: "POST", path: "/launch", body: '{"package":"com.netflix.ninja"}', token });
    expect(res.status).toBe(200);
    expect(calls.at(-1)).toEqual({ op: "launch", pkg: "com.netflix.ninja", deepLink: undefined });
    expect((await api.handle({ method: "POST", path: "/launch", body: "{}", token })).status).toBe(400);
  });
});
