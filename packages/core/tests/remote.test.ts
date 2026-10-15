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

// The TMDB guide (2026-10-10): the key is copied on the phone, so the phone sends it; a long key is nothing to type with a remote.
describe("RemoteApi - the person's TMDB key from the phone", () => {
  const LONG = "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJhdWQiOiJmYWtlZmFrZWZha2VmYWtlIiwic3ViIjoiMCJ9" + "." + "c2lnbmF0dXJlLW5vdC1yZWFsLWp1c3QtYS10ZXN0";
  it("a paired phone sets the key, long or short, and the answer does not repeat it", async () => {
    const { remote, orchestrator, token } = await paired();
    expect(orchestrator.lensHasKey()).toBe(false);
    const res = await remote.handle({ method: "POST", path: "/tmdb/key", body: JSON.stringify({ apiKey: "  " + LONG + " " }), token });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, set: true });
    expect(res.body).not.toContain("eyJ");
    expect(orchestrator.lensHasKey()).toBe(true);
    const short = await remote.handle({ method: "POST", path: "/tmdb/key", body: JSON.stringify({ apiKey: "0123456789abcdef0123456789abcdef" }), token });
    expect(short.status).toBe(200);
  });
  it("refuses what is not a key, and a phone that is not paired", async () => {
    const { remote, orchestrator, token } = await paired();
    for (const bad of ["", "short", "has spaces in the middle of it all", "x".repeat(700), 42])
      expect((await remote.handle({ method: "POST", path: "/tmdb/key", body: JSON.stringify({ apiKey: bad }), token })).status).toBe(400);
    expect(orchestrator.lensHasKey()).toBe(false);
    expect((await remote.handle({ method: "POST", path: "/tmdb/key", body: JSON.stringify({ apiKey: LONG }), token: "not-a-token" })).status).toBe(401);
    expect(orchestrator.lensHasKey()).toBe(false);
  });
});

describe("playlists on the phone (2026-10-12, 'Make sure I can manage playlists through the companion app')", () => {
  it("routes each call to the shell's playlist verbs, refuses a bad body, and says so on a shell without playlists", async () => {
    const { remote, orchestrator } = rig();
    await orchestrator.load(doc, VIEWPORT);
    const { token } = await remote.mintPairing("http://x");
    const none = await remote.handle({ method: "GET", path: "/playlists", body: null, token });
    expect(none.status).toBe(501);
    const calls: unknown[] = [];
    remote.playlists = {
      view: () => { calls.push(["view"]); return { lists: [], total: 0 }; },
      create: (name) => { calls.push(["create", name]); return { ok: true, id: "p1" }; },
      open: (id) => { calls.push(["open", id]); return { ok: true }; },
      rename: (id, name) => { calls.push(["rename", id, name]); return { ok: true }; },
      remove: (id) => { calls.push(["remove", id]); return { ok: true }; },
      play: (id, key) => { calls.push(["play", id, key]); return { ok: true }; },
      edit: (id, op) => { calls.push(["edit", id, op]); return { ok: true }; },
      undo: () => { calls.push(["undo"]); return { ok: true }; },
      move: (dir) => { calls.push(["move", dir]); return { ok: true }; },
      stop: (mode) => { calls.push(["stop", mode]); return { ok: true }; },
      send: (target, source) => { calls.push(["send", target, source]); return { job: "j1" }; },
      job: (id) => { calls.push(["job", id]); return { status: "confirm", message: "Add 12 episodes?" }; },
      confirm: (id, yes) => { calls.push(["confirm", id, yes]); return { ok: true }; },
    };
    const post = (path: string, body: unknown) => remote.handle({ method: "POST", path, body: JSON.stringify(body), token });
    expect((await remote.handle({ method: "GET", path: "/playlists", body: null, token })).status).toBe(200);
    expect((await post("/playlists", { name: "  Movie night " })).status).toBe(200);
    expect((await post("/playlists", { name: "  " })).status).toBe(400);
    expect((await post("/playlists/open", { id: "p1" })).status).toBe(200);
    expect((await post("/playlists/rename", { id: "p1", name: "Friday" })).status).toBe(200);
    expect((await post("/playlists/rename", { id: "p1" })).status).toBe(400);
    expect((await post("/playlists/play", { id: "p1", key: "k2" })).status).toBe(200);
    expect((await post("/playlists/play", { id: "p1" })).status).toBe(200);
    expect((await post("/playlists/edit", { id: "p1", op: { op: "mark", keys: ["k2"], done: true } })).status).toBe(200);
    expect((await post("/playlists/edit", { id: "p1", op: "mark" })).status).toBe(400);
    expect((await post("/playlists/undo", {})).status).toBe(200);
    expect((await post("/playlists/move", { dir: "previous" })).status).toBe(200);
    expect((await post("/playlists/stop", { mode: "now" })).status).toBe(200);
    expect((await post("/playlists/delete", { id: "p1" })).status).toBe(200);
    // a title sent from the phone's Details sheet (2026-10-13): the job, its question, the answer
    expect((await post("/playlists/send", { target: { id: "p1" }, source: { type: "movie", title: "Heat" } })).status).toBe(200);
    expect((await post("/playlists/send", { target: "p1", source: { type: "movie" } })).status).toBe(400);
    expect((await post("/playlists/job", { id: "j1" })).status).toBe(200);
    expect((await post("/playlists/confirm", { id: "j1", yes: true })).status).toBe(200);
    expect((await post("/playlists/nothing", {})).status).toBe(404);
    expect((await remote.handle({ method: "GET", path: "/playlists/open", body: null, token })).status).toBe(405);
    expect(calls).toEqual([
      ["view"], ["create", "Movie night"], ["open", "p1"], ["rename", "p1", "Friday"], ["play", "p1", "k2"], ["play", "p1", null],
      ["edit", "p1", { op: "mark", keys: ["k2"], done: true }], ["undo"], ["move", "previous"], ["stop", "now"], ["remove", "p1"],
      ["send", { id: "p1" }, { type: "movie", title: "Heat" }], ["job", "j1"], ["confirm", "j1", true],
    ]);
  });
});
