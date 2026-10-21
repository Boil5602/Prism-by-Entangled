import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * 2026-10-20 ("I just tried to start an amazon music station but nothing happened"): a quick-play pick the page never started was marked
 * failed after thirty seconds and nothing said so. Now the feed carries it (musicWork with an error) for a while, and the page's play
 * script is handed the collection's name as well as its id, since Amazon's rebuilt player names its cards and carries no ids.
 */
function fakeDrivers(seed: Record<string, string>) {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>(Object.entries(seed));
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
    { id: "am", url: "https://music.amazon.com/", adapter: "amazon-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ],
};

describe("a quick-play pick the page never starts", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("hands the page the name with the id, and says in the feed when nothing started", async () => {
    const { drivers, calls } = fakeDrivers({ "music:stations-kept:lounge:am": JSON.stringify([{ id: "station:all-hits-radio", name: "All Hits Radio", kind: "station" }]) });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "amazon-music": { id: "amazon-music", controls: { play: ".play" }, musicPlay: "/*play*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    calls.length = 0;
    expect(await o.playCollection("am", "station", "station:all-hits-radio")).toBe("ok");
    const sent = calls.filter((c) => c.op === "inject" && typeof c.js === "string" && String(c.js).includes("__prismMusicPlay(")).map((c) => String(c.js));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('__prismMusicPlay("station", "station:all-hits-radio", "All Hits Radio")');
    const tile = () => o.getState()?.tiles.find((t) => t.id === "am") as { musicWork?: { what: string; name: string; error?: string }; musicPending?: unknown } | undefined;
    expect(tile()?.musicWork).toBeUndefined();
    await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_PICK_TIMEOUT_MS + 100);
    expect(tile()?.musicWork).toMatchObject({ what: "Play: did not start", name: "All Hits Radio" });
    expect(tile()?.musicWork?.error).toContain("did not start");
    await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_PICK_FAILED_LINGER_MS + 100);
    expect(tile()?.musicWork).toBeUndefined();
    expect(tile()?.musicPending).toBeUndefined();
  });

  it("says nothing when the page reported playing in time", async () => {
    const { drivers } = fakeDrivers({ "music:stations-kept:lounge:am": JSON.stringify([{ id: "station:all-hits-radio", name: "All Hits Radio", kind: "station" }]) });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "amazon-music": { id: "amazon-music", controls: { play: ".play" }, musicPlay: "/*play*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    expect(await o.playCollection("am", "station", "station:all-hits-radio")).toBe("ok");
    await vi.advanceTimersByTimeAsync(2_000);
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Bass Persuades", artist: "Miley Cyrus", album: "", context: { label: "All Hits Radio", kind: "station", id: "station:all-hits-radio", playing: true } } });
    await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_PICK_TIMEOUT_MS + 100);
    const tile = o.getState()?.tiles.find((t) => t.id === "am") as { musicWork?: unknown } | undefined;
    expect(tile?.musicWork).toBeUndefined();
  });
});
