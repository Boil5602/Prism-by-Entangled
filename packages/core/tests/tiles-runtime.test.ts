import { describe, expect, it } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { CHORES_KEY, TIMER_KEY, type ChoresDoc, type TimerDoc } from "../src/tiles-data.js";
import type { Drivers } from "../src/drivers.js";

/**
 * The shell-facing half of the micro-facets (docs/concept-scenes.md §6): the
 * page posts one edit, the host hands it to PrismRuntime.tilesApply, core
 * persists through the Store driver and answers with the new document. The
 * host parses nothing about a chore or a countdown (§23) — these two calls are
 * its entire share.
 */
function rig(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { store, rt: createRuntime(drivers) };
}

describe("runtime — tilesGet / tilesApply", () => {
  it("hands back an empty list before anything is stored, and null for any other key", () => {
    const { rt } = rig();
    expect((JSON.parse(rt.tilesGet(CHORES_KEY)) as ChoresDoc).items).toEqual([]);
    expect(rt.tilesGet("scene-model:apps")).toBe("null");
    expect(rt.tilesGet("dashboard")).toBe("null");
  });

  it("persists an add under the store key the host writes to store.json", () => {
    const { rt, store } = rig();
    const res = JSON.parse(rt.tilesApply(CHORES_KEY, '{"op":"chores.add","text":"milk"}')) as { ok: boolean; changed: boolean; doc: ChoresDoc };
    expect(res.ok && res.changed).toBe(true);
    expect(res.doc.items[0]!.text).toBe("milk");
    expect(store.has(CHORES_KEY)).toBe(true);
    // the next read sees it — one document, not a copy per caller
    expect((JSON.parse(rt.tilesGet(CHORES_KEY)) as ChoresDoc).items[0]!.text).toBe("milk");
  });

  it("refuses a key that is not a micro-facet document — the store is not an open drawer", () => {
    const { rt, store } = rig({ dashboard: "{}" });
    const res = JSON.parse(rt.tilesApply("dashboard", '{"op":"chores.add","text":"milk"}')) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(store.get("dashboard")).toBe("{}");
  });

  it("refuses a message that is not one of the intents, and writes nothing", () => {
    const { rt, store } = rig();
    expect((JSON.parse(rt.tilesApply(CHORES_KEY, '{"op":"store.set","key":"x","value":"y"}')) as { ok: boolean }).ok).toBe(false);
    expect((JSON.parse(rt.tilesApply(CHORES_KEY, "not json")) as { ok: boolean }).ok).toBe(false);
    expect(store.size).toBe(0);
  });

  it("does not write when nothing changed", () => {
    const { rt, store } = rig();
    const res = JSON.parse(rt.tilesApply(CHORES_KEY, '{"op":"chores.notes","notes":""}')) as { ok: boolean; changed: boolean };
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(store.size).toBe(0);
  });

  it("a started timer keeps its deadline in the store, so a restart picks the run back up", () => {
    const { rt, store } = rig();
    const started = (JSON.parse(rt.tilesApply(TIMER_KEY, '{"op":"timer.start"}')) as { doc: TimerDoc }).doc;
    expect(started.running).toBe(true);
    const stored = JSON.parse(store.get(TIMER_KEY)!) as TimerDoc;
    expect(stored.endsAt).toBe(started.endsAt);
    // a fresh runtime over the same store (what a restart is) reads the same run
    const restarted = rig({ [TIMER_KEY]: store.get(TIMER_KEY)! });
    expect((JSON.parse(restarted.rt.tilesGet(TIMER_KEY)) as TimerDoc).endsAt).toBe(started.endsAt);
  });
});
