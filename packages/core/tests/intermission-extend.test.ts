import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntermissionController } from "../src/intermission.js";

// B-336 (2026-10-06, "Sent report of ad on my screen right now"): a three-minute Paramount+ break counting down from 179 s lost its cover at
// the two-minute backstop. The page's own clock, still counting, moves the backstop past the break's end; a clock that stops lets it fall.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig() {
  const calls: string[] = [];
  const c = new IntermissionController(
    { show: (id) => void calls.push("show " + id), hide: (id) => void calls.push("hide " + id), setMuted: (id, m) => void calls.push((m ? "mute " : "unmute ") + id) },
    { debounceMs: 1_000, safetyTimeoutMs: 120_000 },
  );
  c.configure([{ id: "w3", enabled: true, source: "pack:cosmos", audio: "mute" }]);
  return { calls, c };
}

describe("the backstop and a break the page still counts", () => {
  it("stays covered to the clock's end and a margin, then the page's own end uncovers", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toContain("show w3");
    for (let left = 179; left > 0; left--) { c.extend("w3", left); await vi.advanceTimersByTimeAsync(1_000); }
    expect(calls).not.toContain("hide w3");   // 180 s in: past the two-minute backstop, still covered
    c.onAdBreak("w3", false);
    expect(calls).toContain("hide w3");
  });
  it("a clock stuck on one number does not hold the cover past the backstop", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true);
    await vi.advanceTimersByTimeAsync(1_000);
    c.extend("w3", 90);
    for (let i = 0; i < 200; i++) { c.extend("w3", 90); await vi.advanceTimersByTimeAsync(1_000); }
    expect(calls).toContain("hide w3");
  });
});

describe("a re-apply of the document (B-346)", () => {
  it("keeps the cover on a tile still there, and drops only a tile that is gone", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toContain("show w3");
    // another window renewed: the document applied again with the same tiles plus a new one
    c.configure([{ id: "w3", enabled: true, source: "pack:cosmos", audio: "mute" }, { id: "w4", enabled: true, source: "pack:cosmos", audio: "mute" }]);
    expect(calls).not.toContain("hide w3");
    expect(c.isCovered("w3")).toBe(true);
    c.configure([{ id: "w4", enabled: true, source: "pack:cosmos", audio: "mute" }]);
    expect(calls).toContain("hide w3");
  });
});

describe("a service's own backstop (adBackstopMs, YouTube TV's live breaks, 2026-10-06)", () => {
  it("holds a held signal past two minutes up to the service's backstop, and the signal's end still uncovers at once", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true, 0, 300_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toContain("show w3");
    await vi.advanceTimersByTimeAsync(230_000);   // a four-minute break read off the picture: no page clock to extend it
    expect(calls).not.toContain("hide w3");
    c.onAdBreak("w3", false);
    expect(calls).toContain("hide w3");
  });
  it("still falls at the service's backstop when the signal never ends", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true, 0, 300_000);
    await vi.advanceTimersByTimeAsync(302_000);
    expect(calls).toContain("hide w3");
  });
  it("without one, the two-minute backstop is unchanged", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true);
    await vi.advanceTimersByTimeAsync(122_000);
    expect(calls).toContain("hide w3");
  });
});

// B-364 (2026-10-10, the hourly check): FX's 04:00 paid programme said so on the screen, the break watch covered it "until 04:30", and the
// five-minute backstop took the cover off at 04:05 with the watch still saying break. The shell knows the half hour's end and says so
// at each look; a shell that stops looking stops saying it.
describe("a break whose end the shell knows (hold, a paid programme's half hour)", () => {
  it("stays covered for the whole half hour while the shell keeps saying how long is left", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true, 0, 300_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toContain("show w3");
    for (let left = 1_770; left > 0; left -= 30) { expect(c.hold("w3", left)).toBe(true); await vi.advanceTimersByTimeAsync(30_000); }
    expect(calls).not.toContain("hide w3");   // 29.5 minutes in, far past the five-minute backstop
    c.onAdBreak("w3", false);
    expect(calls).toContain("hide w3");
  });
  it("takes a length that grows again (the next half hour of the same cover), where a page's stuck clock would not", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true, 0, 300_000);
    await vi.advanceTimersByTimeAsync(1_000);
    for (let left = 240; left > 0; left -= 30) { c.hold("w3", left); await vi.advanceTimersByTimeAsync(30_000); }
    for (let left = 1_800; left > 900; left -= 30) { c.hold("w3", left); await vi.advanceTimersByTimeAsync(30_000); }
    expect(calls).not.toContain("hide w3");
  });
  it("falls within ten minutes of the shell going quiet, however long it said was left", async () => {
    const { calls, c } = rig();
    c.onAdBreak("w3", true, 0, 300_000);
    await vi.advanceTimersByTimeAsync(1_000);
    c.hold("w3", 1_700);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(calls).not.toContain("hide w3");
    await vi.advanceTimersByTimeAsync(62_000);
    expect(calls).toContain("hide w3");
  });
  it("does nothing for a window that is not behind a cover", () => {
    const { calls, c } = rig();
    expect(c.hold("w3", 600)).toBe(false);
    expect(calls).toEqual([]);
  });
});
