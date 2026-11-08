import { describe, expect, it } from "vitest";
import { ReclaimedLedger, dayKey, monthStartKey, weekStartKey, windowsFrom } from "../src/reclaimed.js";
import type { StoreDriver } from "../src/drivers.js";

function memStore(): StoreDriver & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}
// Local wall-clock timestamps (the ledger buckets by LOCAL date). Use midday to
// avoid any DST edge on the boundary days.
const at = (iso: string) => new Date(iso).getTime();

describe("boundaries", () => {
  it("week starts Monday (ISO): Sunday belongs to the week that began the prior Monday", () => {
    // 2026-08-31 is a Monday; 2026-08-30 is the Sunday before it.
    expect(new Date(at("2026-08-31T12:00")).getDay()).toBe(1); // Monday
    expect(new Date(at("2026-08-30T12:00")).getDay()).toBe(0); // Sunday
    expect(weekStartKey(at("2026-08-31T12:00"))).toBe("2026-08-31"); // Monday → itself
    expect(weekStartKey(at("2026-09-06T23:59"))).toBe("2026-08-31"); // the following Sunday → same Monday
    expect(weekStartKey(at("2026-08-30T00:00"))).toBe("2026-08-24"); // Sunday → the prior Monday
  });
  it("month is the calendar month", () => {
    expect(monthStartKey(at("2026-09-01T00:00"))).toBe("2026-09-01");
    expect(monthStartKey(at("2026-09-30T23:59"))).toBe("2026-09-01");
    expect(dayKey(at("2026-09-07T09:15"))).toBe("2026-09-07");
  });
});

describe("windows derived at read time", () => {
  it("a Monday-boundary entry: Sunday's time is last week, Monday's is this week", () => {
    // now = Tue 2026-09-01 (Monday of this week is 2026-08-31).
    const now = at("2026-09-01T12:00");
    const days = { "2026-08-30": 100, "2026-08-31": 200, "2026-09-01": 50 }; // Sun / Mon / Tue
    expect(windowsFrom(days, now)).toEqual({ week: 250, month: 50, all: 350 });
    //   week  = Mon 200 + Tue 50 (Sunday excluded)
    //   month = Sep only → Tue 50 (both August days excluded)
    //   all   = 350
  });

  it("a month-boundary entry: Aug 31 counts in the week but not the month; Sep 1 counts in both", () => {
    const now = at("2026-09-02T12:00");
    const days = { "2026-08-31": 300, "2026-09-01": 60 }; // both are in this ISO week (Mon 08-31)
    const w = windowsFrom(days, now);
    expect(w.week).toBe(360);   // week spans the month boundary
    expect(w.month).toBe(60);   // month starts Sep 1
    expect(w.all).toBe(360);
  });

  it("one week-spanning-month-boundary entry is counted in BOTH correct windows", () => {
    // The classic case: this week began Mon Aug 31, we are viewing on Wed Sep 2.
    // An entry on Aug 31 is in the week window but NOT the month; an entry on
    // Sep 1 is in both. The same underlying entries answer all three windows.
    const now = at("2026-09-02T18:00");
    const days = { "2026-08-31": 90, "2026-09-01": 90, "2026-09-02": 90 };
    expect(windowsFrom(days, now)).toEqual({ week: 270, month: 180, all: 270 });
  });

  it("windows move on their own with no migration: same data, a week later", () => {
    const days = { "2026-08-31": 200, "2026-09-01": 50 };
    // viewed the same week → both in the week
    expect(windowsFrom(days, at("2026-09-01T12:00")).week).toBe(250);
    // viewed a week later (Tue 2026-09-08, week starts Mon 09-07) → nothing in the week
    expect(windowsFrom(days, at("2026-09-08T12:00")).week).toBe(0);
    // ...but all-time is unchanged
    expect(windowsFrom(days, at("2026-09-08T12:00")).all).toBe(250);
  });
});

describe("ReclaimedLedger", () => {
  it("adds dated seconds, derives windows, persists, and resets", async () => {
    const store = memStore();
    const t = at("2026-09-02T10:00");
    const led = new ReclaimedLedger(store, { now: () => t });
    led.add(120);                       // Wed Sep 2 (this week, this month)
    led.add(45, at("2026-08-31T20:00")); // Mon Aug 31 (this week, NOT this month)
    led.add(30, at("2026-08-30T20:00")); // Sun Aug 30 (neither)
    expect(led.windows()).toEqual({ week: 165, month: 120, all: 195 });
    expect(led.entries()).toEqual([
      { day: "2026-08-30", seconds: 30 }, { day: "2026-08-31", seconds: 45 }, { day: "2026-09-02", seconds: 120 },
    ]);

    // persistence across instances
    const led2 = new ReclaimedLedger(store, { now: () => t });
    await led2.load();
    expect(led2.windows()).toEqual({ week: 165, month: 120, all: 195 });

    led2.reset();
    expect(led2.windows()).toEqual({ week: 0, month: 0, all: 0 });
    const led3 = new ReclaimedLedger(store, { now: () => t }); await led3.load();
    expect(led3.windows().all).toBe(0);
  });
  it("ignores non-positive additions and rounds fractional seconds", () => {
    const t = at("2026-09-02T10:00");
    const led = new ReclaimedLedger(null, { now: () => t });
    led.add(0); led.add(-5); led.add(12.4); led.add(0.6);
    expect(led.windows().all).toBe(13);
  });
});
