import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// The room in step with a listener (2026-10-31): while a stream runs
// and a music source has the sound, the shell is told to delay the room by the slowest listener's lag; video, no stream, no lag report,
// or the switch off, and the room is live.
function frame(shifts?: Array<{ listener: string; ms: number }>) {
  const kv = new Map<string, string>();
  const steps: Array<{ on: boolean; delayMs: number }> = [];
  const drivers: Drivers = {
    surface: { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {} },
    media: { launch: () => {} },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    ui: { roomStep: (on, delayMs) => void steps.push({ on, delayMs }), listenShift: (listener, ms) => void shifts?.push({ listener, ms }) },
  };
  const o = new Orchestrator(drivers);
  return { o, steps, kv, api: new RemoteApi(o, drivers.store) };
}
const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1", id: "d", name: "D", layout: { mode: "grid" },
  tiles: [
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", area: "1 / 1 / 2 / 2" },
    { id: "nf", url: "https://www.netflix.com/", adapter: "netflix", audio: "exclusive", area: "1 / 2 / 2 / 3" },
  ],
};

describe("the room in step with a listener", () => {
  it("delays the room by the slowest listener's lag while music has the sound, and not otherwise", async () => {
    const { o, steps, api } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    o.setAdapters({ netflix: { match: ["www.netflix.com"], videoContext: "(function(){})" }, "apple-music": { match: ["music.apple.com"], musicContext: "(function(){})" } } as never);   // what makes a tile video or music
    await o.tileCommand("am", "play");   // a person's press: the music source takes the sound
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    const { token } = await api.mintPairing("http://pc");
    const { token: other } = await api.mintPairing("http://pc");
    expect(steps).toEqual([]);
    // a stream runs, but no lag is known yet: the room stays live
    o.listenStreams([token]);
    expect(steps.at(-1) ?? { on: false }).toMatchObject({ on: false });
    // a lag from a phone whose stream does not run counts for nothing; one over ten seconds neither
    await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":3000}', token: other });
    await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":25000}', token });
    expect(steps).toEqual([]);
    // the phone says how far behind it runs; alone, it is told of no one else
    expect(JSON.parse((await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":3000}', token })).body)).toMatchObject({ ok: true, othersMs: null });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 3000 });
    // a second, slower listener sets the pace; a small drift does not move it; each is told the other's lag
    o.listenStreams([token, other]);
    expect(JSON.parse((await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":3300}', token: other })).body)).toMatchObject({ ok: true, othersMs: 3000 });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 3000 });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":3000}', token })).body)).toMatchObject({ ok: true, othersMs: 3300 });
    await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":4200}', token: other });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 4200 });
    expect(JSON.parse((await api.handle({ method: "GET", path: "/audio/room-step", body: null, token })).body)).toEqual({ on: true, active: true, delayMs: 4200, listeners: [{ lagMs: 4200, holdMs: 4200, house: false }, { lagMs: 3000, holdMs: 3000, house: false }] });   // the listeners' figures, slowest first, no ids
    // a video takes the sound: the room is live
    await o.tileCommand("nf", "play");
    await o.onSurfaceEvent({ type: "playback", id: "nf", playing: true });
    expect(steps.at(-1)).toEqual({ on: false, delayMs: 0 });
    await o.tileCommand("am", "play");
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 4200 });
    // the switch off, and on again; it survives a restart
    expect(JSON.parse((await api.handle({ method: "POST", path: "/audio/room-step", body: '{"on":false}', token })).body)).toMatchObject({ on: false, active: false });
    expect(steps.at(-1)).toEqual({ on: false, delayMs: 0 });
    await api.handle({ method: "POST", path: "/audio/room-step", body: '{"on":true}', token });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 4200 });
    // the last stream ends: live
    o.listenStreams([]);
    expect(steps.at(-1)).toEqual({ on: false, delayMs: 0 });
    // the house key reports its lag on its own route
    const house = await api.houseListen(true);
    const t = JSON.parse((await api.handle({ method: "POST", path: "/listen/ticket", body: null, token: house.key })).body).ticket as string;
    const who = api.redeemStreamTicket(t)!;
    o.listenStreams([who]);
    expect((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":2500}', token: house.key })).status).toBe(200);
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 2500 });
    // two pages on the house code at once (2026-10-31): each counts on its own, the room
    // follows the slowest, and each is told the slowest OTHER listener's lag so it can hold to it; a page alone is told nothing
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":1000,"id":"page1"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 2500 });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":4000,"id":"page2"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 2500 });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 4000 });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":1000,"id":"page1"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 4000 });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":4000,"id":"page2"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 2500 });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":4000,"id":"page2"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 2500 });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":1000,"id":"not a page id!"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 4000 });   // a bad id is no id: the house's own entry
    // a page says the figure it holds to as well as its lag of the moment: the others are told the hold, the room follows the lag
    await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":4000,"holdMs":2000,"id":"page2"}', token: house.key });
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":1000,"id":"page1"}', token: house.key })).body)).toMatchObject({ ok: true, othersMs: 2000 });   // page2's hold, over the house's own 1000 just above
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 2000 });   // the room follows the slowest hold, not the lag of the moment
    // the entries a listener may hold are capped at sixteen, the oldest out first: page2's 4000 goes before page3's..page18's and the room follows what is left
    for (let i = 3; i <= 18; i++) await api.handle({ method: "POST", path: "/listen/lag", body: '{"lagMs":1500,"id":"page' + i + '"}', token: house.key });
    expect(steps.at(-1)).toEqual({ on: true, delayMs: 1500 });
    o.listenStreams([]);
  });
  it("follows a music window that plays of its own accord when no window took the sound", async () => {
    const { o, steps, api } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    o.setAdapters({ netflix: { match: ["www.netflix.com"], videoContext: "(function(){})" }, "apple-music": { match: ["music.apple.com"], musicContext: "(function(){})" } } as never);
    const { token } = await api.mintPairing("http://pc");
    o.listenStreams([token]);
    await api.handle({ method: "POST", path: "/audio/lag", body: '{"lagMs":3000}', token });
    expect(steps.filter((s) => s.on)).toEqual([]);   // nothing plays: the room is live
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "A song" } as never });
    expect(steps.at(-1)).toMatchObject({ on: true, delayMs: 3000 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "A song" } as never });
    expect(steps.at(-1)).toMatchObject({ on: false });
    o.listenStreams([]);
  });
  it("shifts a listener's live MP3 on the PC when its lag sits off the house hold (2026-11-03)", async () => {
    // the companion app's background mode: the phone's own player on the live MP3, which an iPhone's Safari neither trims nor seeks, so its
    // report says shift and the PC does the holding - a lag more than half a second off the hold for fifteen seconds is shifted by the
    // difference, once in thirty seconds at most; a page that holds its own frames to the clock never asks
    const shifts: Array<{ listener: string; ms: number }> = [];
    const { o, api } = frame(shifts);
    await o.load(doc, { w: 1000, h: 600 });
    const { token } = await api.mintPairing("http://pc");
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
    try {
      o.listenStreams([token]);
      const say = (lagMs: number, shift = true) => api.handle({ method: "POST", path: "/audio/lag", body: JSON.stringify({ lagMs, holdMs: 3000, shift }), token });
      const tick = () => vi.advanceTimersByTime(5000);
      // 8.1 s behind, said every five seconds: nothing for fifteen seconds, then one cut of the difference
      await say(8100); tick(); await say(8100); tick(); await say(8100); expect(shifts).toEqual([]);
      tick(); await say(8100); expect(shifts).toEqual([{ listener: token, ms: 5100 }]);
      // and no second one within thirty seconds, however the readings run
      for (let i = 0; i < 5; i++) { tick(); await say(8100); } expect(shifts.length).toBe(1);
      tick(); await say(8100); expect(shifts.length).toBe(2);
      // within half a second of the hold: nothing, and the fifteen seconds start over; early, silence is put in
      shifts.length = 0;
      for (let i = 0; i < 8; i++) { tick(); await say(3400); } expect(shifts).toEqual([]);
      for (let i = 0; i < 3; i++) { tick(); await say(1200); } expect(shifts).toEqual([]);
      tick(); await say(1200); expect(shifts).toEqual([{ listener: token, ms: -1800 }]);
      // a report that does not say shift asks for nothing, however far off
      shifts.length = 0;
      for (let i = 0; i < 7; i++) { tick(); await say(9900, false); } expect(shifts).toEqual([]);
      for (let i = 0; i < 7; i++) { tick(); await say(9900); } expect(shifts).toEqual([{ listener: token, ms: 6900 }]);
      o.listenStreams([]);
    } finally { vi.useRealTimers(); }
  });
  it("keeps the switch across a restart", async () => {
    const { o, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    o.setRoomStep(false);
    expect(kv.get("audio:room-step")).toBe("0");
    const again = new Orchestrator({ surface: { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {} }, media: { launch: () => {} }, store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) } });
    await again.load(doc, { w: 1000, h: 600 });
    expect(again.roomStepStatus().on).toBe(false);
  });
});
