import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";

/** A wall with a store and nothing else: the bag is all this exercises. */
function rig(mem: Map<string, string>) {
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    store: { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) },
  };
  return new Orchestrator(drivers) as unknown as { randomSoundscape(): Promise<string> };
}

describe("Random soundscape is a shuffle bag (2026-09-15: 'seems like I get the same ones often')", () => {
  it("deals every recording once before any plays again, and the next bag never opens with the one just heard", async () => {
    const o = rig(new Map());
    const first = [] as string[];
    for (let i = 0; i < Orchestrator.SOUNDSCAPES.length; i++) first.push(await o.randomSoundscape());
    expect([...first].sort()).toEqual([...Orchestrator.SOUNDSCAPES].sort());   // all twelve, each once
    const second = [] as string[];
    for (let i = 0; i < Orchestrator.SOUNDSCAPES.length; i++) second.push(await o.randomSoundscape());
    expect([...second].sort()).toEqual([...Orchestrator.SOUNDSCAPES].sort());
    expect(second[0]).not.toBe(first[first.length - 1]);   // no repeat across the boundary
  });

  it("the bag is kept in the store: a restart carries on where it was, and a corrupt bag is a fresh one", async () => {
    const mem = new Map<string, string>();
    const o1 = rig(mem);
    const heard = [] as string[];
    for (let i = 0; i < 5; i++) heard.push(await o1.randomSoundscape());
    expect(JSON.parse(mem.get(Orchestrator.SOUNDSCAPE_BAG_KEY)!)).toHaveLength(Orchestrator.SOUNDSCAPES.length - 5);
    const o2 = rig(mem);   // the wall restarted
    for (let i = 0; i < Orchestrator.SOUNDSCAPES.length - 5; i++) {
      const s = await o2.randomSoundscape();
      expect(heard).not.toContain(s);
      heard.push(s);
    }
    expect([...heard].sort()).toEqual([...Orchestrator.SOUNDSCAPES].sort());
    mem.set(Orchestrator.SOUNDSCAPE_BAG_KEY, "{not json");
    const o3 = rig(mem);
    expect(Orchestrator.SOUNDSCAPES).toContain(await o3.randomSoundscape());
    mem.set(Orchestrator.SOUNDSCAPE_BAG_KEY, JSON.stringify(["bees", "not-a-recording"]));   // an unknown id is dropped, a known one kept
    const o4 = rig(mem);
    expect(await o4.randomSoundscape()).toBe("bees");
  });
});
