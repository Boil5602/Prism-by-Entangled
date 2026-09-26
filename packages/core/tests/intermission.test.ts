import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntermissionController } from "../src/intermission.js";
import { Orchestrator } from "../src/orchestrator.js";
import { FRAME_PRELUDE_JS } from "../src/adapters.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig() {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new IntermissionController(
    {
      show: (id, source) => void calls.push({ op: "show", id, source }),
      hide: (id) => void calls.push({ op: "hide", id }),
      setMuted: (id, muted) => void calls.push({ op: "mute", id, muted }),
    },
    { debounceMs: 1_000, safetyTimeoutMs: 60_000 },
  );
  controller.configure([
    { id: "yt", enabled: true, source: "pack:cosmos", audio: "mute" },
    { id: "quiet", enabled: true, source: "pack:nature", audio: "keep" },
    { id: "plain", enabled: false, source: "pack:cosmos", audio: "mute" },
  ]);
  return { calls, controller };
}

describe("IntermissionController (§26 normative)", () => {
  it("mutes fast, covers slow: the mute lands on the first sign, the scenery only after the signal sustains the debounce (2026-09-15)", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("yt", true);
    expect(calls).toEqual([{ op: "mute", id: "yt", muted: true }]);   // at once: the room hears no more of the ad
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual([{ op: "mute", id: "yt", muted: true }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([
      { op: "mute", id: "yt", muted: true },
      { op: "show", id: "yt", source: "pack:cosmos" },
    ]);
    expect(controller.isCovered("yt")).toBe(true);
  });

  it("a flicker inside the debounce mutes and unmutes, never covers (a wrong mute is a half-second dip, 2026-09-15)", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("yt", true);
    await vi.advanceTimersByTimeAsync(500);
    controller.onAdBreak("yt", false); // doubt — cancel
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toEqual([
      { op: "mute", id: "yt", muted: true },
      { op: "mute", id: "yt", muted: false },
    ]);
    expect(controller.isCovered("yt")).toBe(false);
    // the next sign starts over: a fresh fast mute, then the cover after the window - with ONE mute, not two
    calls.length = 0;
    controller.onAdBreak("yt", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([
      { op: "mute", id: "yt", muted: true },
      { op: "show", id: "yt", source: "pack:cosmos" },
    ]);
    // a repeated 'ad' while the window runs, or under the cover, is not a second mute
    controller.onAdBreak("yt", true);
    expect(calls.filter((c) => c.op === "mute")).toHaveLength(1);
  });

  it("audio 'keep' has no fast mute either: a flicker on a keep tile is silent in the ops", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("quiet", true);
    await vi.advanceTimersByTimeAsync(500);
    controller.onAdBreak("quiet", false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toEqual([]);
  });

  it("a signal the adapter already sustained page-side shortens the window by that much, never below 200 ms (2026-09-14)", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("yt", true, 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls.map((c) => c.op)).toEqual(["mute"]);   // the fast mute, at once (2026-09-15); the scenery waits
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.op)).toEqual(["mute", "show"]);
    const { calls: c2, controller: k2 } = rig();
    k2.onAdBreak("yt", true, 5_000);   // more than the whole window: the floor holds
    await vi.advanceTimersByTimeAsync(199);
    expect(c2.map((c) => c.op)).toEqual(["mute"]);   // the fast mute, at once; the scenery waits for the floor
    await vi.advanceTimersByTimeAsync(1);
    expect(c2.map((c) => c.op)).toEqual(["mute", "show"]);
  });

  it("uncovers fast: end signal drops immediately, audio restored before hide", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("yt", true);
    await vi.advanceTimersByTimeAsync(1_000);
    calls.length = 0;

    controller.onAdBreak("yt", false);
    expect(calls).toEqual([
      { op: "mute", id: "yt", muted: false }, // audio first (§26 asymmetry)
      { op: "hide", id: "yt" },
    ]);
    expect(controller.isCovered("yt")).toBe(false);
  });

  it("safety timeout uncovers a missed end signal", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("yt", true);
    await vi.advanceTimersByTimeAsync(1_000);
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.some((c) => c.op === "hide" && c.id === "yt")).toBe(true);
  });

  it("audio 'keep' never touches the mute state", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("quiet", true);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.onAdBreak("quiet", false);
    expect(calls.filter((c) => c.op === "mute")).toEqual([]);
    expect(calls.map((c) => c.op)).toEqual(["show", "hide"]);
  });

  it("signals on non-enabled tiles are inert", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("plain", true);
    controller.onAdBreak("mystery", true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toEqual([]);
  });

  it("reconfigure uncovers anything covered (observer lost its footing)", async () => {
    const { calls, controller } = rig();
    controller.onAdBreak("yt", true);
    await vi.advanceTimersByTimeAsync(1_000);
    calls.length = 0;
    controller.configure([]);
    expect(calls.map((c) => c.op)).toEqual(["mute", "hide"]);
  });
});

describe("the §26 card corner carries the image's provenance", () => {
  const plate = {
    file: "nasa-PIA02241.jpg",
    title: "Saturn Rings",
    credit: "JPL, NASA — Public domain",
    license: { id: "public-domain" as const, name: "Public domain", url: "https://creativecommons.org/publicdomain/mark/1.0/" },
    attribution: "Saturn Rings — JPL, NASA (NASA ID PIA02241), public domain",
    sourceUrl: "https://images.nasa.gov/details/PIA02241",
    sha256: "c".repeat(64),
  };

  it("has no attribution until the shell names the image it put up", () => {
    const { controller } = rig();
    expect(controller.card("yt")?.attribution).toBeNull();
    expect(controller.card("plain")).toBeNull(); // not intermission-enabled
  });

  it("renders title · credit · licence on the card, and the source url stays reachable", async () => {
    const { controller } = rig();
    controller.onAdBreak("yt", true);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.setImagery("yt", plate);
    const card = controller.card("yt")!;
    expect(card.covered).toBe(true);
    expect(card.source).toBe("pack:cosmos");
    expect(card.attribution!.line).toBe("Saturn Rings · JPL, NASA — Public domain · Public domain");
    expect(card.attribution!.sourceUrl).toBe("https://images.nasa.gov/details/PIA02241");
  });

  it("minimal mode collapses the line to the credit alone — never to nothing", () => {
    const { controller } = rig();
    controller.setImagery("yt", plate);
    controller.setMinimal("yt", true);
    expect(controller.isMinimal("yt")).toBe(true);
    expect(controller.card("yt")!.attribution!.line).toBe("JPL, NASA — Public domain");
    controller.setMinimal("yt", false);
    expect(controller.card("yt")!.attribution!.line).toContain("Saturn Rings");
  });

  it("minimal mode persists across reconfiguration (§26 'persists per site')", () => {
    const { controller } = rig();
    controller.setMinimal("yt", true);
    controller.configure([{ id: "yt", enabled: true, source: "pack:gallery", audio: "mute" }]);
    expect(controller.isMinimal("yt")).toBe(true);
    expect(controller.card("yt")!.image).toBeNull(); // the picture is the shell's to name again
  });
});

describe("orchestrator §26 wiring", () => {
  const doc: DashboardDocument = {
    schema: "frame.dashboard/v0.1",
    id: "k",
    name: "K",
    layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
    tiles: [
      {
        id: "yt",
        url: "https://yt.test",
        adapter: "youtube",
        audio: "exclusive",
        intermission: { enabled: true, source: "pack:cosmos" },
      },
    ],
  };

  it("ad-break events flow through to the overlay ops and /state", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const drivers: Drivers = {
      surface: {
        create: () => {},
        destroy: () => {},
        setRect: () => {},
        setOpacity: () => {},
        setZ: () => {},
        navigate: () => {},
        inject: () => {},
        freeze: () => {},
        reveal: () => {},
        suspend: () => {},
        resume: () => {},
        setMuted: (id, muted) => void calls.push({ op: "mute", id, muted }),
        showIntermission: (id, source) => void calls.push({ op: "show", id, source }),
        hideIntermission: (id) => void calls.push({ op: "hide", id }),
      },
      store: { get: () => null, set: () => {} },
    };
    const o = new Orchestrator(drivers);
    await o.load(doc, { w: 1000, h: 625 });
    calls.length = 0;

    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.some((c) => c.op === "show" && c.source === "pack:cosmos")).toBe(true);
    expect(o.getState()?.tiles[0]?.intermission).toBe(true);

    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    expect(calls.at(-1)).toEqual({ op: "hide", id: "yt" });
    expect(o.getState()?.tiles[0]?.intermission).toBeUndefined();
  });

  it("the page's own ad count rides the break into /state and the card, sticks through a tick that lost it, and clears with the break (Spotify '1 of 3', 2026-09-15)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const drivers: Drivers = {
      surface: {
        create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
        freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {},
        setMuted: () => {}, showIntermission: () => {}, hideIntermission: () => {},
        setAdInfo: (id, count, remaining) => void calls.push({ op: "adInfo", id, count, remaining }),
      },
      store: { get: () => null, set: () => {} },
    };
    const o = new Orchestrator(drivers);
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "ad-info", id: "yt", count: "1 of 3", remaining: 30 });   // before the cover: nothing to say yet
    expect(o.getState()?.tiles[0]?.adCount).toBeUndefined();
    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await o.onSurfaceEvent({ type: "ad-info", id: "yt", count: "1 of 3", remaining: 28 });
    expect(o.getState()?.tiles[0]).toMatchObject({ intermission: true, adCount: "1 of 3" });
    await o.onSurfaceEvent({ type: "ad-info", id: "yt", remaining: 27 });   // a tick without the subtitle keeps the count
    expect(o.getState()?.tiles[0]?.adCount).toBe("1 of 3");
    expect(calls.at(-1)).toEqual({ op: "adInfo", id: "yt", count: "1 of 3", remaining: 27 });
    await o.onSurfaceEvent({ type: "ad-info", id: "yt", count: "2 of 3", remaining: 30 });   // the next ad's clock starts over - the count says why
    expect(o.getState()?.tiles[0]?.adCount).toBe("2 of 3");
    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    expect(o.getState()?.tiles[0]?.adCount).toBeUndefined();
    await o.onSurfaceEvent({ type: "ad-info", id: "yt", remaining: 5 });   // a late tick after the break brings nothing back
    expect(o.getState()?.tiles[0]?.adCount).toBeUndefined();
  });

  it("an unmute during a break never lifts the source under the cover (the ad and the soundscape played together, 2026-09-14)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const drivers: Drivers = {
      surface: {
        create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
        freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {},
        setMuted: (id, muted) => void calls.push({ op: "mute", id, muted }),
        showIntermission: (id, source) => void calls.push({ op: "show", id, source }),
        hideIntermission: (id) => void calls.push({ op: "hide", id }),
      },
      store: { get: () => null, set: () => {} },
    };
    const o = new Orchestrator(drivers);
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });
    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(o.getState()?.tiles[0]?.intermission).toBe(true);
    calls.length = 0;
    await o.tileCommand("yt", "mute");
    await o.tileCommand("yt", "unmute");
    expect(calls.filter((c) => c.op === "mute" && c.id === "yt" && c.muted === false)).toEqual([]);   // still covered: still silent
    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    calls.length = 0;
    await o.tileCommand("yt", "unmute");
    expect(calls.some((c) => c.op === "mute" && c.id === "yt" && c.muted === false)).toBe(true);   // the break over: the unmute lands
  });

  it("the frame prelude carries the adBreak contract", () => {
    expect(FRAME_PRELUDE_JS).toContain("notifyAdBreak");
  });
});
