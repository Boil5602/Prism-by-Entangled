import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { cleanEvents } from "../src/video.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * Live events (2026-09-30, "Does Apple have live tv we can incorporate? What about their formula one stuff"): the sporting events a service
 * lists on pages of its own, read on its hidden work page, listed on the Live tab below the channel grid - on now first, then by start.
 */
const H = 3_600_000;
function rig(answers: Record<string, string>) {
  const kv = new Map<string, string>(); const navigated: string[] = []; let at = "";
  const up: { o: Orchestrator | null } = { o: null };   // the hidden page "loads" a moment after each navigate
  const drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: (id: string, url: string) => { navigated.push(url); at = url; setTimeout(() => { void up.o?.onSurfaceEvent({ type: "load-finished", id, ok: true }); }, 200); }, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
      evaluate: async () => JSON.stringify(answers[at] ?? "[]"),
    },
    store: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => void kv.set(k, v) },
  } as unknown as Drivers;
  return { drivers, kv, navigated, up };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "atv", heroSize: 0.6, satellites: "auto", gap: 0 }, tiles: [{ id: "atv", url: "https://tv.apple.com/", adapter: "appletv", audio: "exclusive" }] };
const svc = { app: "appletv", adapter: "appletv", profile: "appletv", status: "signed-in", home: "https://tv.apple.com/" };

describe("live events from a service's own pages", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T07:30:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("cleanEvents keeps what is well formed: an id, a title, an https address; a start as epoch ms; an end only after its start", () => {
    const out = cleanEvents([
      { id: "a", title: "Bahrain: Race", url: "https://tv.apple.com/us/sporting-event/x/a", start: Date.parse("2026-10-04T05:50:00Z"), live: false, group: "Formula 1", badge: null, artwork: "https://x/y.jpg" },
      { id: "b", title: "RBNY vs STL", url: "https://tv.apple.com/us/sporting-event/y/b", start: null, live: true, badge: "Live 2nd 54:00", group: "MLS" },
      { id: "c", title: "bad", url: "http://plain", start: 1 }, { id: "", title: "no id", url: "https://x" }, "junk", null,
      { id: "d", title: "ends before it starts", url: "https://tv.apple.com/d", start: 2e12, end: 1e12 },
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "d"]);
    expect(out[0]).toMatchObject({ kind: "live", group: "Formula 1", live: false, artwork: "https://x/y.jpg" });
    expect(out[1]).toMatchObject({ live: true, badge: "Live 2nd 54:00", start: null });
    expect(out[2]!.end).toBeNull();
  });

  it("read from the events pages on the hidden page, kept on the device, and listed: on now first, then by start; within a week; over ones gone", async () => {
    const now = Date.now();
    const f1 = "https://tv.apple.com/us/channel/formula-1/tvs.sbd.241000", mls = "https://tv.apple.com/us/channel/mls/tvs.sbd.7000";
    const { drivers, kv, navigated, up } = rig({
      [f1]: JSON.stringify([
        { id: "q", title: "Bahrain: Qualifying", url: "https://tv.apple.com/us/sporting-event/bahrain-q/q", start: now - 20 * 60_000, live: false, group: "Formula 1" },   // began 20 min ago: on, by its start
        { id: "r", title: "Bahrain: Race", url: "https://tv.apple.com/us/sporting-event/bahrain-r/r", start: now + 22 * H, live: false, group: "Formula 1" },          // tomorrow: listed
        { id: "s", title: "Singapore: Sprint", url: "https://tv.apple.com/us/sporting-event/sg/s", start: now + 9 * 24 * H, live: false, group: "Formula 1" },         // the week after: not yet
        { id: "t", title: "Singapore: Practice 1", url: "https://tv.apple.com/us/sporting-event/sg/t", start: now + 5 * 24 * H, live: false, group: "Formula 1" },     // this week: listed (2026-10-05, a week's window)
        { id: "p", title: "Bahrain: Practice 1", url: "https://tv.apple.com/us/sporting-event/p/p", start: now - 5 * H, live: false, group: "Formula 1" },             // over
      ]),
      [mls]: JSON.stringify([
        { id: "m", title: "New York Red Bulls vs. Saint Louis City SC", url: "https://tv.apple.com/us/sporting-event/m/m", start: null, live: true, badge: "Live 2nd 54:00", group: "MLS" },
        { id: "n", title: "Seattle vs. Kansas City", url: "https://tv.apple.com/us/sporting-event/n/n", start: now + 3 * H, live: false, group: "MLS" },
      ]),
    });
    const o = new Orchestrator(drivers);
    up.o = o;
    o.setAdapters({ appletv: { id: "appletv", match: ["tv.apple.com"], videoContext: "/*c*/", videoEvents: "/*events*/", videoEventsUrls: [f1, mls] } as never });
    await o.load(doc, { w: 1920, h: 1080 });
    expect(o.videoEventsRead([svc])).toEqual(["appletv"]);
    for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(navigated.filter((u) => u === f1 || u === mls)).toEqual([f1, mls]);
    const listed = o.liveEvents("appletv");
    expect(listed.map((e) => e.id)).toEqual(["m", "q", "n", "r", "t"]);   // on now first (the match, then qualifying by its start), then by start
    expect(listed[1]!.live).toBe(true);
    expect(listed[2]!.live).toBe(false);
    expect(o.eventsReadState().appletv?.readAt).toBeGreaterThan(0);
    // kept for the boot: a fresh orchestrator reads the record back
    const kept = kv.get("video:events:appletv");
    expect(kept).toContain("Bahrain: Race");
    const o2 = new Orchestrator(drivers);
    o2.setAdapters({ appletv: { id: "appletv", match: ["tv.apple.com"], videoContext: "/*c*/", videoEvents: "/*events*/", videoEventsUrls: [f1, mls] } as never });
    await o2.load(doc, { w: 1920, h: 1080 });
    await o2.videoEventsLoad([svc]);
    expect(o2.liveEvents("appletv").map((e) => e.id)).toEqual(["m", "q", "n", "r", "t"]);
    // a read within the half hour is not asked again unless forced
    expect(o2.videoEventsRead([svc])).toEqual([]);
    expect(o2.videoEventsRead([svc], true)).toEqual(["appletv"]);
    // four and a half hours on: the match listed as on at the last read is no longer believed on, qualifying is over, Seattle's match is on by its start
    vi.setSystemTime(new Date(now + 4.5 * H));
    expect(o.liveEvents("appletv").map((e) => [e.id, e.live])).toEqual([["n", true], ["r", false], ["t", false]]);
  });
});

describe("event rows among channel rows (2026-09-30)", () => {
  it("one total order: within a type, events before channels, events by time (on now first), channels by name - never a scramble", async () => {
    const { liveGuide } = await import("../src/live-guide.js");
    const now = Date.parse("2026-10-01T01:40:00Z"); const H = 3_600_000;
    const ev = (id: string, name: string, start: number | null, live = false) => ({ id, name, url: "https://tv.apple.com/e/" + id, logo: null, favorite: false, category: "Sports", event: true, ...(live ? { now: name, nowEnds: now + H } : {}), ...(start ? { schedule: [{ title: name, start, end: start + 2 * H, desc: null }] } : {}) });
    const ch = (id: string, name: string) => ({ id, name, url: "https://www.paramountplus.com/live-tv/stream/" + id, logo: null, favorite: false, category: "Sports", now: name + " Tonight", nowEnds: now + H });
    const apple = { app: "appletv", name: "Apple TV", facet: "a", channels: [ev("p1", "Bahrain: Practice 1", now + 26 * H), ev("m", "Zebras vs. Aardvarks", null, true), ev("w", "F1 Weekend Warm-Up", now + 7 * H), ev("s", "Atlanta vs. Dallas", now + 20 * H)] };
    const pp = { app: "paramountplus", name: "Paramount+", facet: "p", channels: [ch("c2", "Motor Trend"), ch("c1", "CBS Sports HQ"), ch("c3", "Golazo")] };
    const g = liveGuide([apple, pp], now, {});
    expect(g.rows.filter((r) => r.type === "Sports").map((r) => r.name)).toEqual(["Zebras vs. Aardvarks", "F1 Weekend Warm-Up", "Atlanta vs. Dallas", "Bahrain: Practice 1", "CBS Sports HQ", "Golazo", "Motor Trend"]);
    // the same with the services the other way round, and shuffled: the order is the order
    const g2 = liveGuide([pp, { ...apple, channels: [...apple.channels].reverse() }], now, {});
    expect(g2.rows.filter((r) => r.type === "Sports").map((r) => r.name)).toEqual(["Zebras vs. Aardvarks", "F1 Weekend Warm-Up", "Atlanta vs. Dallas", "Bahrain: Practice 1", "CBS Sports HQ", "Golazo", "Motor Trend"]);
  });
});

describe("events after the fifth review (2026-09-30)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T07:30:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("a page that did not answer keeps its last events; a live one is believed while the read is fresh past its scheduled end", async () => {
    const now = Date.now();
    const f1 = "https://tv.apple.com/us/channel/formula-1/tvs.sbd.241000", mls = "https://tv.apple.com/us/channel/mls/tvs.sbd.7000";
    const answers: Record<string, string> = {
      [f1]: JSON.stringify([{ id: "r", title: "Bahrain: Race", url: "https://tv.apple.com/us/sporting-event/r/r", start: now - 2.5 * H, live: true, group: "Formula 1" }]),   // delayed by rain: on, 2.5 h after its start
      [mls]: JSON.stringify([{ id: "m", title: "Seattle vs. Kansas City", url: "https://tv.apple.com/us/sporting-event/m/m", start: now + 5 * H, live: false, group: "MLS" }]),
    };
    const { drivers, up, navigated } = rig(answers);
    const o = new Orchestrator(drivers); up.o = o;
    o.setAdapters({ appletv: { id: "appletv", match: ["tv.apple.com"], videoContext: "/*c*/", videoEvents: "/*events*/", videoEventsUrls: [f1, mls] } as never });
    await o.load(doc, { w: 1920, h: 1080 });
    o.videoEventsRead([svc]);
    for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(o.liveEvents("appletv").map((e) => [e.id, e.live])).toEqual([["r", true], ["m", false]]);   // the race on, past start + 3 h is not yet
    // the next read: the MLS page says nothing (its load timed out), the F1 page answers again
    answers[mls] = "";
    vi.setSystemTime(new Date(now + 31 * 60_000));
    o.videoEventsRead([svc]);
    for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(navigated.filter((u) => u === mls).length).toBe(2);
    expect(o.liveEvents("appletv").map((e) => e.id)).toEqual(["r", "m"]);   // Seattle's match kept from the read before
    // the race: started 3 h ago now - still believed on, the read being fresh
    expect(o.liveEvents("appletv")[0]).toMatchObject({ id: "r", live: true });
  });
});

describe("Sports mode and the events (2026-10-01, 'Why isn't Apple listed?')", () => {
  it("the Sports filter takes every event row, whatever series the page gave it as a type", async () => {
    const { liveGuide } = await import("../src/live-guide.js");
    const now = Date.parse("2026-10-01T04:40:00Z");
    const apple = { app: "appletv", name: "Apple TV", facet: "a", channels: [{ id: "r", name: "Bahrain: Race", url: "https://tv.apple.com/e/r", logo: null, favorite: false, category: "Sports", series: "Formula 1", event: true, schedule: [{ title: "Bahrain: Race", start: now + 26 * 3_600_000, end: now + 28 * 3_600_000, desc: null }] }] };
    const pp = { app: "paramountplus", name: "Paramount+", facet: "p", channels: [{ id: "c", name: "CBS Sports HQ", url: "https://www.paramountplus.com/live-tv/stream/c", logo: null, favorite: false, category: "Sports", now: "SportsCenter-ish", nowEnds: now + 3_600_000 }, { id: "k", name: "Nick Jr.", url: "https://www.paramountplus.com/live-tv/stream/k", logo: null, favorite: false, category: "Kids", now: "Paw Patrol", nowEnds: now + 3_600_000 }] };
    const g = liveGuide([apple, pp], now, { type: "Sports" });
    expect(g.rows.map((r) => r.name)).toEqual(["Bahrain: Race", "CBS Sports HQ"]);
    expect(g.rows[0]).toMatchObject({ type: "Sports", series: "Formula 1" });   // Sports is the type; the series is a label (2026-10-01)
  });
});
