import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import { layoutDashboard } from "../src/layout.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function rig() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", id: opts.id }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: (id, rect) => void calls.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: (id, css, js) => void calls.push({ op: "inject", id, js }),
      freeze: (id) => void calls.push({ op: "freeze", id }),
      reveal: (id) => void calls.push({ op: "reveal", id }),
      suspend: (id) => void calls.push({ op: "suspend", id }),
      resume: (id) => void calls.push({ op: "resume", id }),
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    display: {
      setBrightness: (value) => void calls.push({ op: "brightness", value }),
      setPower: (state) => void calls.push({ op: "power", state }),
    },
    store: {
      get: (key) => kv.get(key) ?? null,
      set: (key, value) => void kv.set(key, value),
    },
  };
  const orchestrator = new Orchestrator(drivers);
  const remote = new RemoteApi(orchestrator, drivers.store);
  return { calls, kv, drivers, orchestrator, remote };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "kitchen",
  name: "Kitchen",
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "yt", url: "https://yt.test", aspectHint: "16:9", aspectWeight: 1.0, audio: "exclusive" },
    { id: "cal", url: "https://cal.test", aspectHint: "3:4", aspectWeight: 0.6, audio: "mute" },
  ],
};

const VIEWPORT = { w: 1000, h: 625 };

async function paired() {
  const r = rig();
  await r.orchestrator.load(doc, VIEWPORT);
  const { token } = await r.remote.mintPairing("http://10.0.0.5:8471");
  return { ...r, token };
}

describe("RemoteApi — pairing", () => {
  it("mints per-phone tokens embedded in the QR URL", async () => {
    const { remote } = rig();
    const a = await remote.mintPairing("http://10.0.0.5:8471/");
    const b = await remote.mintPairing("http://10.0.0.5:8471");
    expect(a.url).toBe(`http://10.0.0.5:8471/remote?token=${a.token}`);
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    expect(await remote.listDevices()).toHaveLength(2);
  });

  it("persists tokens through the store and survives a new instance (§10)", async () => {
    const { remote, orchestrator, drivers } = rig();
    await orchestrator.load(doc, VIEWPORT);
    const { token } = await remote.mintPairing("http://x");
    const reborn = new RemoteApi(orchestrator, drivers.store);
    const res = await reborn.handle({ method: "GET", path: "/state", body: null, token });
    expect(res.status).toBe(200);
  });

  it("revocation cuts access immediately", async () => {
    const { remote, token } = await paired();
    await remote.revoke(token);
    const res = await remote.handle({ method: "GET", path: "/state", body: null, token });
    expect(res.status).toBe(401);
  });
});

describe("RemoteApi — auth", () => {
  it("rejects missing and bogus tokens with 401", async () => {
    const { remote } = await paired();
    for (const token of [null, "deadbeef"]) {
      const res = await remote.handle({ method: "GET", path: "/state", body: null, token });
      expect(res.status).toBe(401);
    }
  });
});

describe("RemoteApi — routes (§6)", () => {
  it("GET /state reports dashboard, hero, and tile audio state", async () => {
    const { remote, token } = await paired();
    const res = await remote.handle({ method: "GET", path: "/state", body: null, token });
    expect(res.status).toBe(200);
    // Tiles also carry `url` (web) / `launch` (app) for the remote's mirror.
    expect(JSON.parse(res.body)).toMatchObject({
      dashboard: "kitchen",
      name: "Kitchen",
      layoutMode: "hero",
      hero: "yt",
      heroSize: 0.62,
      tiles: [
        { id: "yt", audio: "exclusive", playing: false, state: "live", url: expect.any(String) },
        { id: "cal", audio: "mute", playing: false, state: "live", url: expect.any(String) },
      ],
      dashboards: ["kitchen"],
      alarm: { status: "idle", missed: null },
    });
  });

  it("POST /tiles/{id}/command hero re-solves the layout", async () => {
    const { remote, orchestrator, token } = await paired();
    const res = await remote.handle({
      method: "POST",
      path: "/tiles/cal/command",
      body: JSON.stringify({ cmd: "hero" }),
      token,
    });
    expect(res.status).toBe(200);
    expect(orchestrator.rects()).toEqual(layoutDashboard(doc, VIEWPORT, { hero: "cal" }));
  });

  it("mute/unmute/pause drive the surface driver", async () => {
    const { remote, calls, token } = await paired();
    calls.length = 0;
    await remote.handle({ method: "POST", path: "/tiles/yt/command", body: '{"cmd":"mute"}', token });
    await remote.handle({ method: "POST", path: "/tiles/yt/command", body: '{"cmd":"unmute"}', token });
    await remote.handle({ method: "POST", path: "/tiles/yt/command", body: '{"cmd":"pause"}', token });
    // B-175 (2026-09-09): the wall's mute mutes EVERY page with audio, not only the one the command names; the unmute lifts the owner
    const muted = calls.filter((c) => c.op === "setMuted") as { op: string; id: string; muted: boolean }[];
    expect(muted[0]).toEqual({ op: "setMuted", id: "yt", muted: true });
    expect(muted.filter((c) => c.muted).map((c) => c.id)).toContain("yt");
    const lift = muted.findIndex((c) => c.id === "yt" && !c.muted);
    expect(lift).toBeGreaterThan(0);
    expect(muted.slice(0, lift).every((c) => c.muted)).toBe(true);   // nothing is unmuted until the unmute
    expect(calls.at(-1)).toMatchObject({ op: "inject", id: "yt" });
  });

  it("reload rides the §16 refresh path", async () => {
    const { remote, calls, token } = await paired();
    calls.length = 0;
    const res = await remote.handle({
      method: "POST",
      path: "/tiles/yt/command",
      body: '{"cmd":"reload"}',
      token,
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((c) => c.op)).toEqual(["freeze", "navigate"]);
  });

  it("unknown tiles 404, unknown cmds 400, bad body 400", async () => {
    const { remote, token } = await paired();
    expect(
      (await remote.handle({ method: "POST", path: "/tiles/nope/command", body: '{"cmd":"hero"}', token })).status,
    ).toBe(404);
    expect(
      (await remote.handle({ method: "POST", path: "/tiles/yt/command", body: '{"cmd":"warp"}', token })).status,
    ).toBe(400);
    expect(
      (await remote.handle({ method: "POST", path: "/tiles/yt/command", body: "not json", token })).status,
    ).toBe(400);
  });

  it("POST /display forwards brightness and power", async () => {
    const { remote, calls, token } = await paired();
    calls.length = 0;
    const res = await remote.handle({
      method: "POST",
      path: "/display",
      body: '{"brightness": 2, "power": "sleep"}',
      token,
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { op: "brightness", value: 1 }, // clamped
      { op: "power", state: "sleep" },
    ]);
  });

  it("PUT /layout/{id} switches dashboards, 404s unknown ids", async () => {
    const { remote, orchestrator, token } = await paired();
    await orchestrator.loadBundle(
      { dashboards: [doc, { ...doc, id: "dinner", name: "Dinner" }] },
      VIEWPORT,
    );
    expect((await remote.handle({ method: "PUT", path: "/layout/dinner", body: null, token })).status).toBe(200);
    expect(orchestrator.getState()?.dashboard).toBe("dinner");
    expect((await remote.handle({ method: "PUT", path: "/layout/nope", body: null, token })).status).toBe(404);
  });

  it("POST /carousel/next cycles and reports the new dashboard", async () => {
    const { remote, orchestrator, token } = await paired();
    await orchestrator.loadBundle(
      { dashboards: [doc, { ...doc, id: "dinner", name: "Dinner" }] },
      VIEWPORT,
    );
    const res = await remote.handle({ method: "POST", path: "/carousel/next", body: null, token });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ dashboard: "dinner" });
  });

  it("unrouted paths 404", async () => {
    const { remote, token } = await paired();
    expect((await remote.handle({ method: "GET", path: "/secrets", body: null, token })).status).toBe(404);
  });
});
