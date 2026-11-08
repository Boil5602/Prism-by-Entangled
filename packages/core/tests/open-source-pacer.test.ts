import { describe, it, expect } from "vitest";
import { OpenSourcePacer } from "../src/lenses.js";

// The open sources (Wikipedia, Wikimedia, Wikidata) read one after another; a 429 rests the reads, and each 429 in a row rests them
// twice as long (2026-11-04: the night's triage found 29 refusals in twelve minutes after a start, a rest of fifteen seconds and the same
// pace again). A read that succeeds puts the rest back to its first length.
describe("the open-source pacer", () => {
  it("rests twice as long for each 429 in a row, and starts over after a good read", async () => {
    const times: number[] = []; let fail = 3;
    const pacer = new OpenSourcePacer(async (u) => { times.push(Date.now()); if (fail-- > 0) throw new Error("429 Too Many Requests " + u); return "ok"; }, 0, 20);
    for (let i = 0; i < 3; i++) await pacer.read("https://wikimedia.org/x").catch(() => undefined);
    expect(pacer.refusals).toBe(3);
    await pacer.read("https://wikimedia.org/y");   // the fourth read: good
    expect(pacer.refusals).toBe(0);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps[0]).toBeGreaterThanOrEqual(18);   // after one 429: the rest
    expect(gaps[1]).toBeGreaterThanOrEqual(36);   // after two: twice
    expect(gaps[2]).toBeGreaterThanOrEqual(72);   // after three: four times
    await pacer.read("https://wikimedia.org/z");
    expect(times[4] - times[3]).toBeLessThan(18);   // no rest after a good read
  });
  it("an error that is not a 429 rests nothing", async () => {
    const times: number[] = [];
    const pacer = new OpenSourcePacer(async () => { times.push(Date.now()); throw new Error("no such page"); }, 0, 50);
    await pacer.read("a").catch(() => undefined); await pacer.read("b").catch(() => undefined);
    expect(pacer.refusals).toBe(0);
    expect(times[1] - times[0]).toBeLessThan(40);
  });
});
