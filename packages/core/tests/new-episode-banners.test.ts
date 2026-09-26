import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LensResolver } from "../src/lenses.js";

// 2026-09-24, "So frequently i notice My List losing its new episode banners and banner sorting": TMDB's last aired dates are kept on the
// device (a relaunch opens with them), and a read that fails keeps the known date and asks again in five minutes.

function rig(store: Map<string, string>, answer: (url: string) => Promise<string>, now: () => number) {
  const r = new LensResolver({
    fetchStatic: async () => { throw new Error("no"); },
    fetchKeyed: answer,
    store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
    dashId: () => "wall", now, paceMs: 0,
  });
  r.setKey("test-key");
  return r;
}
const tmdb = (calls: string[]) => async (url: string) => {
  calls.push(url);
  if (url.includes("/search/")) return JSON.stringify({ results: [{ id: 42, media_type: "tv", name: "Slow Horses", first_air_date: "2022-04-01" }] });
  if (/\/tv\/42\?|\/tv\/42$/.test(url)) return JSON.stringify({ last_episode_to_air: { air_date: "2026-09-21" } });
  return "{}";
};

describe("My List's new-episode dates", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const T0 = Date.parse("2026-09-24T12:00:00Z");

  it("a relaunch opens with the dates read before - nothing to wait for, nothing asked", async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    const a = rig(store, tmdb(calls), () => T0);
    expect(a.lastAired("Slow Horses", "series")).toBeNull();   // asked in the background
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.lastAired("Slow Horses", "series")).toBe("2026-09-21");
    const later: string[] = [];
    const b = rig(store, tmdb(later), () => T0 + 60_000);
    expect(b.lastAired("Slow Horses", "series")).toBe("2026-09-21");
    await vi.advanceTimersByTimeAsync(5000);
    expect(later.filter((u) => u.includes("/tv/42"))).toEqual([]);
  });

  it("a read that fails keeps the known date, and asks again in five minutes rather than six hours", async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    let t = T0;
    const ok = rig(store, tmdb(calls), () => t);
    ok.lastAired("Slow Horses", "series");
    await vi.advanceTimersByTimeAsync(5000);
    // seven hours on, TMDB does not answer
    t = T0 + 7 * 3_600_000;
    const failing: string[] = [];
    const down = rig(store, async (url) => { failing.push(url); throw new Error("timeout"); }, () => t);
    expect(down.lastAired("Slow Horses", "series")).toBe("2026-09-21");   // stale: asked again, the date still shown
    await vi.advanceTimersByTimeAsync(5000);
    expect(down.lastAired("Slow Horses", "series")).toBe("2026-09-21");   // the failure did not erase it
    const n = failing.length;
    t += 60_000;
    down.lastAired("Slow Horses", "series"); await vi.advanceTimersByTimeAsync(100);
    expect(failing.length).toBe(n);   // not before five minutes
    t += 5 * 60_000;
    down.lastAired("Slow Horses", "series"); await vi.advanceTimersByTimeAsync(5000);
    expect(failing.length).toBeGreaterThan(n);
  });
});
