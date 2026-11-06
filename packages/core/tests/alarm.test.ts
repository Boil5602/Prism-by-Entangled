import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmEngine } from "../src/alarm.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 21, 0, 0));
});
afterEach(() => vi.useRealTimers());

function engineRig() {
  const calls: Array<Record<string, unknown>> = [];
  const engine = new AlarmEngine(
    {
      setBrightness: (value) => void calls.push({ op: "brightness", value }),
      wake: () => void calls.push({ op: "wake" }),
      setTone: (playing) => void calls.push({ op: "tone", playing }),
      onDismissed: () => void calls.push({ op: "dismissed" }),
    },
    { sunriseMs: 60_000, rampSteps: 4, snoozeMs: 30_000 },
  );
  return { calls, engine };
}

describe("AlarmEngine (§24)", () => {
  it("wakes, ramps brightness over the sunrise, then sounds", async () => {
    const { calls, engine } = engineRig();
    engine.fire();
    expect(calls).toEqual([{ op: "wake" }]);
    expect(engine.status).toBe("sunrise");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual([
      { op: "wake" },
      { op: "brightness", value: 0.25 },
      { op: "brightness", value: 0.5 },
      { op: "brightness", value: 0.75 },
      { op: "brightness", value: 1 },
      { op: "tone", playing: true },
    ]);
    expect(engine.status).toBe("ringing");
  });

  it("sunrise of 0 goes straight to full + sound", () => {
    const calls: Array<Record<string, unknown>> = [];
    const engine = new AlarmEngine(
      {
        setBrightness: (value) => void calls.push({ op: "brightness", value }),
        wake: () => {},
        setTone: (playing) => void calls.push({ op: "tone", playing }),
      },
      { sunriseMs: 0 },
    );
    engine.fire();
    expect(calls).toEqual([
      { op: "brightness", value: 1 },
      { op: "tone", playing: true },
    ]);
  });

  it("snooze silences, then rings again without a second sunrise", async () => {
    const { calls, engine } = engineRig();
    engine.fire();
    await vi.advanceTimersByTimeAsync(60_000);
    calls.length = 0;

    engine.snooze();
    expect(calls).toEqual([{ op: "tone", playing: false }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.at(-1)).toEqual({ op: "tone", playing: true });
    expect(engine.status).toBe("ringing");
  });

  it("dismiss stops everything and fires the trigger — including snoozed", async () => {
    const { calls, engine } = engineRig();
    engine.fire();
    await vi.advanceTimersByTimeAsync(60_000);
    engine.snooze();
    calls.length = 0;

    engine.dismiss(); // while snoozed
    expect(calls.filter((c) => c.op === "dismissed")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.filter((c) => c.op === "tone" && c.playing === true)).toHaveLength(0);
  });

  it("fire is idempotent while active", async () => {
    const { calls, engine } = engineRig();
    engine.fire();
    engine.fire();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.filter((c) => c.op === "tone")).toHaveLength(1);
  });
});

/* -------------------- orchestrator night/alarm flow -------------------- */

function orchestratorRig() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {},
      destroy: () => {},
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id) => void calls.push({ op: "navigate", id }),
      inject: () => {},
      freeze: (id) => void calls.push({ op: "freeze", id }),
      reveal: (id) => void calls.push({ op: "reveal", id }),
      suspend: (id) => void calls.push({ op: "suspend", id }),
      resume: (id) => void calls.push({ op: "resume", id }),
      setMuted: () => {},
    },
    display: {
      setBrightness: (value) => void calls.push({ op: "brightness", value }),
      setPower: (state) => void calls.push({ op: "power", state }),
    },
    alarm: { setTone: (playing) => void calls.push({ op: "tone", playing }) },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { calls, kv, drivers };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "bedroom",
  name: "Bedroom",
  layout: { mode: "hero", hero: "a", heroSize: 0.62, satellites: "auto", gap: 8 },
  schedule: [
    { at: "22:30", action: "night", value: 0.15 },
    { at: "06:30", action: "alarm" },
  ],
  tiles: [
    { id: "a", url: "https://a.test", audio: "exclusive", persist: true },
    { id: "b", url: "https://b.test", audio: "mute", refresh: 60 },
  ],
};

const VIEWPORT = { w: 1000, h: 625 };

async function revealAll(o: Orchestrator, ids: string[]) {
  for (const id of ids) {
    await o.onSurfaceEvent({ type: "load-finished", id, ok: true });
    await o.onSurfaceEvent({ type: "first-paint", id });
  }
  await vi.advanceTimersByTimeAsync(300);
}

describe("orchestrator §24 flow", () => {
  it("night at 22:30 dims and demotes everything; refresh pauses", async () => {
    const { calls, drivers } = orchestratorRig();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    await revealAll(o, ["a", "b"]);
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(90 * 60_000); // → 22:30
    expect(calls.filter((c) => c.op === "brightness")).toEqual([{ op: "brightness", value: 0.15 }]);
    // ALL tiles warm — persist offers no exemption from night (§24)
    expect(calls.filter((c) => c.op === "suspend").map((c) => c.id).sort()).toEqual(["a", "b"]);

    calls.length = 0;
    await vi.advanceTimersByTimeAsync(3 * 3_600_000); // deep night
    expect(calls.filter((c) => c.op === "resume")).toEqual([]); // no cadence revivals
  });

  it("input during low power wakes and revives", async () => {
    const { calls, drivers } = orchestratorRig();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    await revealAll(o, ["a", "b"]);
    await vi.advanceTimersByTimeAsync(90 * 60_000); // night
    calls.length = 0;

    await o.onInput({ key: "KEYCODE_DPAD_CENTER" });
    expect(calls.some((c) => c.op === "brightness" && c.value === 1)).toBe(true);
    expect(calls.filter((c) => c.op === "resume").map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("the alarm fires at 06:30: wake, revive, sunrise, tone; any key snoozes", async () => {
    const { calls, drivers } = orchestratorRig();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    await revealAll(o, ["a", "b"]);
    await vi.advanceTimersByTimeAsync(90 * 60_000); // night at 22:30
    calls.length = 0;

    await vi.advanceTimersByTimeAsync(8 * 3_600_000); // → 06:30
    expect(calls.filter((c) => c.op === "resume").length).toBeGreaterThan(0); // pre-empted low power
    await vi.advanceTimersByTimeAsync(10 * 60_000); // default sunrise
    expect(calls.at(-1)).toEqual({ op: "tone", playing: true });
    expect(o.getState()?.alarm.status).toBe("ringing");

    calls.length = 0;
    await o.onInput({ key: "KEYCODE_DPAD_CENTER" }); // any key = snooze
    expect(calls).toContainEqual({ op: "tone", playing: false });
    expect(o.getState()?.alarm.status).toBe("idle");
  });

  it("a missed alarm is surfaced at next boot and cleared on dismiss (§24)", async () => {
    const { kv, drivers } = orchestratorRig();
    kv.set("alarm:armed", new Date(2026, 7, 24, 6, 30).toISOString()); // this morning, we were off
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    expect(o.getState()?.alarm.missed).toBe(new Date(2026, 7, 24, 6, 30).toISOString());
    o.dismissAlarm();
    expect(o.getState()?.alarm.missed).toBeNull();
  });

  it("arming bookkeeping persists the next alarm time", async () => {
    const { kv, drivers } = orchestratorRig();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    // 21:00 now → next 06:30 is tomorrow morning
    expect(kv.get("alarm:armed")).toBe(new Date(2026, 7, 25, 6, 30).toISOString());
  });
});
