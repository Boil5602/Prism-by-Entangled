import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * Up next through the orchestrator (2026-11-16): the queue read from the service's page, a track removed from it and a skip to
 * a track. Until this file the remove had no test at all. The page is a fake: what is checked is what core sends to the page,
 * what it does with the page's answer, and what it does to an order PRISM holds. Made-up songs only.
 */
function fakeDrivers() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", ...opts }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: (id, rect) => void calls.push({ op: "setRect", id, rect }),
      setOpacity: (id, opacity) => void calls.push({ op: "setOpacity", id, opacity }),
      setZ: (id, z) => void calls.push({ op: "setZ", id, z }),
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: (id, css, js) => void calls.push({ op: "inject", id, css, js }),
      freeze: (id) => void calls.push({ op: "freeze", id }),
      reveal: (id, ms) => void calls.push({ op: "reveal", id, ms }),
      suspend: (id) => void calls.push({ op: "suspend", id }),
      resume: (id) => void calls.push({ op: "resume", id }),
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    store: { get: (key) => kv.get(key) ?? null, set: (key, value) => void kv.set(key, value) },
  };
  return { drivers, calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ],
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const sent = (calls: Array<Record<string, unknown>>, fn: string) => calls.filter((c) => c.op === "inject" && typeof c.js === "string" && String(c.js).includes(fn + "("));
const tokenOf = (calls: Array<Record<string, unknown>>, fn: string): string => new RegExp(fn + '\\("([^"]+)"').exec(String(sent(calls, fn).pop()?.js ?? ""))?.[1] ?? "";
const answer = (o: Orchestrator, id: string, token: string, body: Record<string, unknown>) => o.onSurfaceEvent({ type: "music-result", id, token, op: "queue", ...body } as never);

async function wall() {
  const { drivers, calls } = fakeDrivers();
  (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
  const o = new Orchestrator(drivers);
  o.setAdapters({
    "apple-music": { id: "apple-music", controls: { play: ".play" }, musicQueueView: "/*view*/", musicQueueRemove: "/*remove*/", musicQueueSkip: "/*skip*/" } as never,
    spotify: { id: "spotify", controls: { play: ".play" } } as never,
  });
  await o.load(doc, { w: 1000, h: 625 });
  calls.length = 0;
  return { o, calls };
}
const QUEUE = [
  { title: "Paper Boats", artist: "Tall Grass", current: true, index: 0, id: "t0" },
  { title: "Evening Beats", artist: "Road Mix", index: 1, id: "t1", artwork: "https://example.invalid/a.jpg" },
  { title: "Low Tide", artist: "Tall Grass", index: 2, id: "t2" },
];
/** The queue read once, answered by the page with the songs given. */
async function read(o: Orchestrator, calls: Array<Record<string, unknown>>, items: unknown[], total?: number) {
  const p = o.musicUpNext("am");
  await tick();
  const token = tokenOf(calls, "__prismMusicQueueView");
  await answer(o, "am", token, { ok: true, items, ...(total !== undefined ? { total } : {}) });
  await p;
  return token;
}

describe("Up next: the queue read from the service's page", () => {
  it("says so for a service with no route, and asks nothing of its page", async () => {
    const { o, calls } = await wall();
    expect(o.musicUpNextState("sp")).toMatchObject({ status: "unavailable", reason: "nothing asked yet" });
    await o.musicUpNext("sp");
    expect(o.musicUpNextState("sp")).toMatchObject({ status: "unavailable", reason: "this service does not show its queue to PRISM yet", items: [] });
    expect(sent(calls, "__prismMusicQueueView").length).toBe(0);
    expect(o.musicQueueSupport("sp")).toMatchObject({ view: false, remove: false, skip: false });
    expect(o.musicQueueSupport("am")).toMatchObject({ view: true, remove: true, skip: true });
  });
  it("keeps the page's songs with their place, id and cover, and drops what is not a song", async () => {
    const { o, calls } = await wall();
    const token = await read(o, calls, [...QUEUE, null, { artist: "no title" }, 7], 40);
    expect(token).toMatch(/^qv/);
    const s = o.musicUpNextState("am");
    expect(s.status).toBe("ready");
    expect(s.items.map((x) => x.title)).toEqual(["Paper Boats", "Evening Beats", "Low Tide"]);
    expect(s.items[1]).toMatchObject({ artist: "Road Mix", index: 1, id: "t1", artwork: "https://example.invalid/a.jpg" });
    expect(s.items[0].current).toBe(true);
    expect(s.left).toBe(40);
  });
  it("ignores an answer from another window, and says when the page fails", async () => {
    const { o, calls } = await wall();
    const p = o.musicUpNext("am");
    await tick();
    const token = tokenOf(calls, "__prismMusicQueueView");
    expect(o.musicUpNextState("am").status).toBe("working");
    await answer(o, "sp", token, { ok: true, items: [{ title: "Not this one", artist: "x", index: 0, id: "evil" }] });
    expect(o.musicUpNextState("am").status).toBe("working");
    await answer(o, "am", token, { ok: false, error: "no queue yet" });
    await p;
    expect(o.musicUpNextState("am")).toMatchObject({ status: "error", reason: "no queue yet", items: [] });
  });
});

describe("Up next: a track removed from the queue", () => {
  it("refuses a service with no route and a place or id that is not a track, and sends nothing", async () => {
    const { o, calls } = await wall();
    expect(await o.musicQueueRemove("sp", 1, "t1")).toEqual({ ok: false, error: "this service's queue cannot be changed from PRISM yet" });
    expect(await o.musicQueueRemove("nope", 1, "t1")).toMatchObject({ ok: false });
    for (const [i, id] of [[-1, "t1"], [1.5, "t1"], [1, ""]] as Array<[number, string]>) expect(await o.musicQueueRemove("am", i, id)).toEqual({ ok: false, error: "no such track in the queue" });
    expect(sent(calls, "__prismMusicQueueRemove").length).toBe(0);
  });
  it("sends the page the place and the id it listed, and reads the queue again after the page says yes", async () => {
    const { o, calls } = await wall();
    await read(o, calls, QUEUE);
    const p = o.musicQueueRemove("am", 1, "t1");
    await tick();
    const js = String(sent(calls, "__prismMusicQueueRemove").pop()?.js ?? "");
    const token = tokenOf(calls, "__prismMusicQueueRemove");
    expect(token).toMatch(/^qr/);
    expect(js).toContain(`__prismMusicQueueRemove(${JSON.stringify(token)}, 1, "t1")`);
    const before = sent(calls, "__prismMusicQueueView").length;
    await answer(o, "am", token, { ok: true });
    await tick();
    // the queue is asked for again; the page answers without the track
    expect(sent(calls, "__prismMusicQueueView").length).toBe(before + 1);
    await answer(o, "am", tokenOf(calls, "__prismMusicQueueView"), { ok: true, items: [QUEUE[0], { ...QUEUE[2], index: 1 }] });
    expect(await p).toEqual({ ok: true });
    expect(o.musicUpNextState("am").items.map((x) => x.id)).toEqual(["t0", "t2"]);
  });
  it("gives the page's reason when it says no, and leaves the list as it was", async () => {
    const { o, calls } = await wall();
    await read(o, calls, QUEUE);
    const before = sent(calls, "__prismMusicQueueView").length;
    const p = o.musicQueueRemove("am", 1, "t1");
    await tick();
    await answer(o, "am", tokenOf(calls, "__prismMusicQueueRemove"), { ok: false, error: "the track at that place is another one" });
    expect(await p).toEqual({ ok: false, error: "the track at that place is another one" });
    expect(sent(calls, "__prismMusicQueueView").length).toBe(before);
    expect(o.musicUpNextState("am").items.map((x) => x.id)).toEqual(["t0", "t1", "t2"]);
    // a no with no reason gets core's own words
    const p2 = o.musicQueueRemove("am", 2, "t2");
    await tick();
    await answer(o, "am", tokenOf(calls, "__prismMusicQueueRemove"), { ok: false });
    expect(await p2).toEqual({ ok: false, error: "the track could not be removed" });
  });
  it("a text with quotes in the id cannot leave the call it is sent in", async () => {
    const { o, calls } = await wall();
    const bad = `x"); window.evil = 1; ("`;
    const p = o.musicQueueRemove("am", 1, bad);
    await tick();
    const js = String(sent(calls, "__prismMusicQueueRemove").pop()?.js ?? "");
    expect(js).toContain(JSON.stringify(bad));
    expect(js.endsWith(JSON.stringify(bad) + ")")).toBe(true);
    await answer(o, "am", tokenOf(calls, "__prismMusicQueueRemove"), { ok: false });
    await p;
  });
  it("drops the track from an order PRISM holds, only a track still to play, and keeps the place", async () => {
    const { o, calls } = await wall();
    const setOrder = (o as unknown as { setMusicOrder: (t: string, v: Record<string, unknown>) => Promise<void> }).setMusicOrder.bind(o);
    const held = () => (o as unknown as { musicOrder: Map<string, { ids?: string[]; count?: number; index?: number; order: string }> }).musicOrder.get("am")!;
    await setOrder("am", { kind: "playlist", id: "pl1", name: "Evening Beats", order: "true-shuffle", count: 5, ids: ["t0", "t1", "t2", "t3", "t4"], index: 1 });
    const remove = async (index: number, id: string) => {
      const p = o.musicQueueRemove("am", index, id);
      await tick();
      await answer(o, "am", tokenOf(calls, "__prismMusicQueueRemove"), { ok: true });
      await tick();
      await answer(o, "am", tokenOf(calls, "__prismMusicQueueView"), { ok: true, items: [] });
      return p;
    };
    // a track after the one playing leaves the order
    expect(await remove(2, "t3")).toEqual({ ok: true });
    expect(held().ids).toEqual(["t0", "t1", "t2", "t4"]);
    expect(held().count).toBe(4);
    expect(held().index).toBe(1);
    expect(held().order).toBe("true-shuffle");
    // the track playing now and a track already played stay in the order: only what is still to play is dropped
    await remove(0, "t1");
    await remove(0, "t0");
    expect(held().ids).toEqual(["t0", "t1", "t2", "t4"]);
    expect(held().count).toBe(4);
    // a track the order does not hold changes nothing
    await remove(3, "zz");
    expect(held().ids).toEqual(["t0", "t1", "t2", "t4"]);
    // what is left after this one, as Up next says it: PRISM's own count
    expect(o.musicUpNextState("am").left).toBe(2);
  });
});

describe("Up next: a skip to a track", () => {
  it("refuses what the remove refuses, sends the place and the id, and reads the queue again", async () => {
    const { o, calls } = await wall();
    expect(await o.musicQueueSkip("sp", 1, "t1")).toEqual({ ok: false, error: "this service's queue cannot be changed from PRISM yet" });
    expect(await o.musicQueueSkip("am", -1, "t1")).toEqual({ ok: false, error: "no such track in the queue" });
    expect(sent(calls, "__prismMusicQueueSkip").length).toBe(0);
    const p = o.musicQueueSkip("am", 2, "t2");
    await tick();
    const token = tokenOf(calls, "__prismMusicQueueSkip");
    expect(token).toMatch(/^qs/);
    expect(String(sent(calls, "__prismMusicQueueSkip").pop()?.js)).toContain(`__prismMusicQueueSkip(${JSON.stringify(token)}, 2, "t2")`);
    await answer(o, "am", token, { ok: true });
    await tick();
    await answer(o, "am", tokenOf(calls, "__prismMusicQueueView"), { ok: true, items: [{ ...QUEUE[2], current: true, index: 0 }] });
    expect(await p).toEqual({ ok: true });
    expect(o.musicUpNextState("am").items.map((x) => x.id)).toEqual(["t2"]);
    const p2 = o.musicQueueSkip("am", 1, "t1");
    await tick();
    await answer(o, "am", tokenOf(calls, "__prismMusicQueueSkip"), { ok: false });
    expect(await p2).toEqual({ ok: false, error: "the player did not go to that track" });
  });
});
