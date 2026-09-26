import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LifecycleManager } from "../src/lifecycle.js";
import {
  PEEK_TIMEOUT_MS,
  PeekScheduler,
  VirtualPlayhead,
  seekJs,
} from "../src/preview.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

/* --------------------------- PeekScheduler ---------------------------- */

function schedulerRig(opts: { peekMs?: number; hang?: Set<string> } = {}) {
  const warm = new Set<string>();
  const playing = new Set<string>();
  const peeks: string[] = [];
  const aborted: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const scheduler = new PeekScheduler({
    isWarm: (id) => warm.has(id),
    isPlaying: (id) => playing.has(id),
    peek: (id) =>
      new Promise<void>((resolve) => {
        peeks.push(id);
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        if (opts.hang?.has(id)) return; // never resolves — simulates a stuck load
        setTimeout(() => {
          concurrent -= 1;
          resolve();
        }, opts.peekMs ?? 3_000);
      }),
    abortPeek: (id) => {
      aborted.push(id);
      concurrent -= 1;
    },
    now: () => Date.now(),
  });
  return { warm, playing, peeks, aborted, scheduler, max: () => maxConcurrent };
}

describe("PeekScheduler (§25)", () => {
  it("peeks warm tiles round-robin, one at a time, staggered across the cadence", async () => {
    const rig = schedulerRig();
    for (const id of ["a", "b", "c"]) rig.warm.add(id);
    rig.scheduler.configure([
      { id: "a", intervalSec: 30, playhead: "advance" },
      { id: "b", intervalSec: 30, playhead: "advance" },
      { id: "c", intervalSec: 30, playhead: "advance" },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    // Stagger: a at 10s, b at 20s, c at 30s, then each ~30s later.
    expect(rig.peeks.slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(rig.peeks.length).toBeGreaterThanOrEqual(5);
    expect(rig.max()).toBe(1);
  });

  it("never peeks live or playing tiles — they already show motion", async () => {
    const rig = schedulerRig();
    rig.warm.add("still");
    rig.playing.add("still"); // contradictory on purpose: playing wins
    rig.scheduler.configure([
      { id: "live", intervalSec: 30, playhead: "advance" }, // not warm
      { id: "still", intervalSec: 30, playhead: "advance" },
    ]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rig.peeks).toEqual([]);
  });

  it("floors intervals to the device budget", async () => {
    const rig = schedulerRig();
    rig.warm.add("a");
    rig.scheduler.setBudget({ minPeekIntervalSec: 60 });
    rig.scheduler.configure([{ id: "a", intervalSec: 5, playhead: "advance" }]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(rig.peeks).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(rig.peeks).toEqual(["a"]);
  });

  it("aborts a peek that never reaches readiness so the buffer frees up", async () => {
    const rig = schedulerRig({ hang: new Set(["stuck"]) });
    rig.warm.add("stuck");
    rig.warm.add("fine");
    rig.scheduler.configure([
      { id: "stuck", intervalSec: 30, playhead: "advance" },
      { id: "fine", intervalSec: 30, playhead: "advance" },
    ]);
    await vi.advanceTimersByTimeAsync(15_000); // stuck due at 15s
    expect(rig.scheduler.peeking).toBe("stuck");
    await vi.advanceTimersByTimeAsync(PEEK_TIMEOUT_MS + 100);
    await vi.advanceTimersByTimeAsync(0); // let the race settle
    expect(rig.aborted).toEqual(["stuck"]);
    expect(rig.scheduler.peeking).not.toBe("stuck");
    expect(rig.peeks).toContain("fine"); // cycle continues — fine was overdue
  });

  it("pauses in low power and resumes with the stagger intact", async () => {
    const rig = schedulerRig();
    rig.warm.add("a");
    rig.warm.add("b");
    rig.scheduler.configure([
      { id: "a", intervalSec: 30, playhead: "advance" },
      { id: "b", intervalSec: 30, playhead: "advance" },
    ]);
    rig.scheduler.pause();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(rig.peeks).toEqual([]);
    rig.scheduler.resume();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(rig.peeks).toEqual(["a", "b"]); // not both at once at t=0
  });

  it("drops tiles that leave the dashboard", async () => {
    const rig = schedulerRig();
    rig.warm.add("a");
    rig.scheduler.configure([{ id: "a", intervalSec: 30, playhead: "advance" }]);
    rig.scheduler.configure([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rig.peeks).toEqual([]);
  });
});

/* -------------------------- VirtualPlayhead --------------------------- */

describe("VirtualPlayhead (§25)", () => {
  it("advances with wall-clock time, bounded by duration", () => {
    const ph = new VirtualPlayhead(() => Date.now());
    ph.configure([{ id: "v", playhead: "advance" }]);
    expect(ph.virtualPosition("v")).toBeNull(); // nothing reported yet
    ph.report("v", 100, 1000);
    vi.advanceTimersByTime(25_000);
    expect(ph.virtualPosition("v")).toBe(125);
    vi.advanceTimersByTime(3_600_000);
    expect(ph.virtualPosition("v")).toBe(1000);
  });

  it("holds position when configured", () => {
    const ph = new VirtualPlayhead(() => Date.now());
    ph.configure([{ id: "v", playhead: "hold" }]);
    ph.report("v", 42, 1000);
    vi.advanceTimersByTime(600_000);
    expect(ph.virtualPosition("v")).toBe(42);
  });

  it("treats live streams as 'now' — nothing to seek to", () => {
    const ph = new VirtualPlayhead(() => Date.now());
    ph.configure([{ id: "cam", playhead: "advance" }]);
    ph.report("cam", 3000, null);
    vi.advanceTimersByTime(60_000);
    expect(ph.virtualPosition("cam")).toBeNull();
  });

  it("ignores reports for unconfigured tiles and garbage positions", () => {
    const ph = new VirtualPlayhead(() => Date.now());
    ph.configure([{ id: "v", playhead: "advance" }]);
    ph.report("other", 5, 10);
    ph.report("v", -1, 10);
    ph.report("v", Number.NaN, 10);
    expect(ph.virtualPosition("other")).toBeNull();
    expect(ph.virtualPosition("v")).toBeNull();
  });
});

describe("seekJs", () => {
  it("prefers an adapter seek recipe and clamps to duration otherwise", () => {
    const js = seekJs(12.3456);
    expect(js).toContain("window.__prismSeek");
    expect(js).toContain("12.346");
    expect(js).toContain("Math.min(t,m.duration)");
  });
});

/* ------------------------ LifecycleManager.peek ----------------------- */

function lifecycleRig() {
  const log: string[] = [];
  let pending: { id: string; queued: boolean } | null = null;
  const lc = new LifecycleManager({
    freeze: (id) => void log.push(`freeze:${id}`),
    suspend: (id) => void log.push(`suspend:${id}`),
    resume: (id) => void log.push(`resume:${id}`),
    startLoad: (id, _url, _r, queued) => {
      log.push(`load:${id}:${queued ? "queued" : "direct"}`);
      pending = { id, queued };
    },
    stopLoad: (id) => void log.push(`stop:${id}`),
    isPlaying: () => false,
  });
  return { lc, log, pending: () => pending };
}

describe("LifecycleManager peek (§25 × §18)", () => {
  it("revives through the queue and demotes on reveal, leaving recency untouched", async () => {
    const { lc, log, pending } = lifecycleRig();
    lc.setMaxLive(1);
    lc.track([
      { id: "hero", url: "https://a", persist: false, refreshSec: null },
      { id: "cam", url: "https://b", persist: false, refreshSec: null },
    ]);
    // Both revealed; cam is LRU → warm.
    await lc.onRevealed("cam");
    await lc.onRevealed("hero");
    expect(lc.status("cam")).toBe("warm");
    log.length = 0;

    const done = lc.peek("cam");
    expect(lc.status("cam")).toBe("live");
    expect(lc.isPeeking("cam")).toBe(true);
    await vi.advanceTimersByTimeAsync(0); // resume() is awaited before the load starts
    expect(pending()).toEqual({ id: "cam", queued: true });
    expect(log).toEqual(["resume:cam", "load:cam:queued"]);

    await lc.onRevealed("cam"); // fresh frame on the wall
    await done;
    expect(lc.status("cam")).toBe("warm");
    expect(lc.isPeeking("cam")).toBe(false);
    expect(log.slice(2)).toEqual(["stop:cam", "freeze:cam", "suspend:cam"]);
    expect(lc.status("hero")).toBe("live"); // the peek displaced nobody
  });

  it("a touch mid-peek promotes the tile instead of demoting it", async () => {
    const { lc } = lifecycleRig();
    lc.setMaxLive(1);
    lc.track([
      { id: "hero", url: "https://a", persist: false, refreshSec: null },
      { id: "cam", url: "https://b", persist: false, refreshSec: null },
    ]);
    await lc.onRevealed("cam");
    await lc.onRevealed("hero");
    const done = lc.peek("cam");
    await lc.touch("cam");
    await done; // settled by the cancel
    expect(lc.isPeeking("cam")).toBe(false);
    await lc.onRevealed("cam");
    expect(lc.status("cam")).toBe("live"); // promoted — hero is now the LRU
    expect(lc.status("hero")).toBe("warm");
  });

  it("refuses to peek live tiles and abandons an overrunning peek", async () => {
    const { lc, log } = lifecycleRig();
    lc.track([{ id: "cam", url: "https://b", persist: false, refreshSec: null }]);
    await lc.peek("cam"); // live — resolves immediately, no side effects
    expect(log).toEqual([]);

    lc.setMaxLive(0); // everything over budget... but max<1 is treated as unlimited
    await lc.onRevealed("cam");
    expect(lc.status("cam")).toBe("live");
    await lc.demoteAll();
    expect(lc.status("cam")).toBe("warm");

    const done = lc.peek("cam");
    await lc.abandonPeek("cam");
    await done;
    expect(lc.status("cam")).toBe("warm");
    expect(lc.isPeeking("cam")).toBe(false);
  });
});
