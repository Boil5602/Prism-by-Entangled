import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleEngine, msUntil } from "../src/schedule.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 23, 21, 0, 0)); // Aug 23 2026, 21:00 local
});
afterEach(() => vi.useRealTimers());

function rig() {
  const fired: Array<Record<string, unknown>> = [];
  const engine = new ScheduleEngine({
    dim: (value) => void fired.push({ action: "dim", value }),
    sleep: () => void fired.push({ action: "sleep" }),
    wake: () => void fired.push({ action: "wake" }),
    layout: (id) => void fired.push({ action: "layout", id }),
  });
  return { fired, engine };
}

describe("msUntil", () => {
  it("computes delay to later today", () => {
    expect(msUntil("22:30", new Date(2026, 7, 23, 21, 0, 0))).toBe(90 * 60_000);
  });

  it("rolls to tomorrow when the time has passed", () => {
    expect(msUntil("06:30", new Date(2026, 7, 23, 21, 0, 0))).toBe(9.5 * 3_600_000);
  });

  it("rejects malformed times", () => {
    expect(msUntil("25:00", new Date())).toBeNull();
    expect(msUntil("6:75", new Date())).toBeNull();
    expect(msUntil("sunset", new Date())).toBeNull();
  });
});

describe("ScheduleEngine (§4)", () => {
  it("fires dim/sleep at their local times", async () => {
    const { fired, engine } = rig();
    engine.start([
      { at: "22:30", action: "dim", value: 0.25 },
      { at: "23:00", action: "sleep" },
    ]);
    await vi.advanceTimersByTimeAsync(90 * 60_000);
    expect(fired).toEqual([{ action: "dim", value: 0.25 }]);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fired).toEqual([{ action: "dim", value: 0.25 }, { action: "sleep" }]);
  });

  it("re-arms daily", async () => {
    const { fired, engine } = rig();
    engine.start([{ at: "22:00", action: "wake" }]);
    await vi.advanceTimersByTimeAsync(25 * 3_600_000); // through tomorrow 22:00
    expect(fired).toEqual([{ action: "wake" }, { action: "wake" }]);
  });

  it("layout entries switch dashboards", async () => {
    const { fired, engine } = rig();
    engine.start([{ at: "21:30", action: "layout", value: "dinner-mode" }]);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fired).toEqual([{ action: "layout", id: "dinner-mode" }]);
  });

  it("ignores trigger-based and malformed entries", async () => {
    const { fired, engine } = rig();
    engine.start([
      { on: "motion", action: "wake" },
      { at: "nope", action: "sleep" },
      { at: "21:10", action: "dim", value: "dark" as unknown as number }, // bad value
    ]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fired).toEqual([]);
  });

  it("start replaces the previous schedule; stop cancels everything", async () => {
    const { fired, engine } = rig();
    engine.start([{ at: "21:10", action: "sleep" }]);
    engine.start([{ at: "21:20", action: "wake" }]); // replaces
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(fired).toEqual([]); // sleep was replaced before firing
    engine.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fired).toEqual([]);
  });
});
