import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCTOR_FROZEN_MS, DOCTOR_GAP_MS, DOCTOR_LOST_MS, DOCTOR_START_MS, PLAYBACK_ERROR_PROBE_JS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// The playback doctor (2026-09-23, "There is an error on the hulu video playback, can you see what can be done to autodetect and
// autorecover from video playback errors?"): a tile on the title the wall asked for is watched for the page's error, a start that never
// comes, a frozen clock, and a vanished player; each is healed by opening the title's own address again, within caps, then it stops.

const URL = "https://www.hulu.com/watch/189d7aa8";
function rig(opts: { said?: string; person?: () => boolean } = {}) {
  const navigated: string[] = [];
  let here = URL;
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.hulu.com"], videoContext: "/*c*/" }), adapterIdOf: () => "hulu", tileExists: () => true,
    inject: async () => {}, navigate: async (_id, url) => { navigated.push(url); here = url; }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
    evaluate: async () => JSON.stringify(opts.said ?? ""), personActedSince: () => (opts.person ? opts.person() : false),
  });
  const report = (video: Record<string, unknown> | null, playing = false) => v.onObservation("screen", { playing, title: "", artist: "", album: "", artwork: null, video } as unknown as NowPlaying);
  return { v, navigated, report, go: (u: string) => { here = u; } };
}
const face = (o: Record<string, unknown>) => ({ kind: "title", title: "Paradise", url: URL, ...o });

describe("the playback doctor", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a start that never comes: the page's own words are read, the title's address is opened again", async () => {
    const { v, navigated, report } = rig({ said: "Error playing video. RUNUNK13" });
    await v.restoreTitle("screen", URL, "Paradise", true);
    report(face({ playing: false, position: 0, duration: null }));
    await vi.advanceTimersByTimeAsync(DOCTOR_START_MS + 1000);
    report(face({ playing: false, position: 0, duration: null }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(navigated).toEqual([URL]);
    const st = v.state(["screen"])[0]!;
    expect(st.recovering).toMatchObject({ why: "Error playing video. RUNUNK13", attempt: 1 });
    expect(st.error).toBe("Error playing video. RUNUNK13");
  });

  it("the page's error (the adapter's reading) heals at once; a frozen clock heals; a clean minute of play resets the tries", async () => {
    const { v, navigated, report } = rig();
    await v.restoreTitle("screen", URL, "Paradise", true);
    report(face({ playing: false, error: "Error playing video" }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(navigated.length).toBe(1);
    // plays, then the clock stops while the page says it plays
    for (let t = 0; t < 5; t++) { report(face({ playing: true, position: 100 + t, duration: 3000 }), true); await vi.advanceTimersByTimeAsync(1000); }
    await vi.advanceTimersByTimeAsync(DOCTOR_GAP_MS);
    for (let t = 0; t < 40; t++) { report(face({ playing: true, position: 104, duration: 3000 }), true); await vi.advanceTimersByTimeAsync(1000); }
    await vi.advanceTimersByTimeAsync(3000);
    expect(navigated.length).toBe(2);
    expect(v.state(["screen"])[0]!.recovering).toMatchObject({ why: "the picture froze", attempt: 2 });
    // a clean minute: the ladder is reset and the note goes
    for (let t = 0; t < 70; t++) { report(face({ playing: true, position: 200 + t, duration: 3000 }), true); await vi.advanceTimersByTimeAsync(1000); }
    expect(v.state(["screen"])[0]!.recovering).toBeNull();
  });

  it("after two tries it stops: the failure stands for the person's Retry", async () => {
    const { v, navigated, report } = rig();
    await v.restoreTitle("screen", URL, "Paradise", true);
    for (let i = 0; i < 4; i++) {
      report(face({ playing: false, error: "Error playing video" }));
      await vi.advanceTimersByTimeAsync(DOCTOR_GAP_MS + 3000);
    }
    expect(navigated.length).toBe(2);
    const st = v.state(["screen"])[0]!;
    expect(st.recovering).toMatchObject({ gaveUp: true });
    expect(st.pending?.failed).toBe("Error playing video");
  });

  it("a person's pause is never healed; a paused player keeps its clock and is left alone; a page that left the title is left alone", async () => {
    let touched = false;
    const { v, navigated, report, go } = rig({ person: () => touched });
    await v.restoreTitle("screen", URL, "Paradise", true);
    report(face({ playing: true, position: 10, duration: 3000 }), true);
    await vi.advanceTimersByTimeAsync(1000);
    // paused on the page (clock and length kept): not a vanished player
    for (let t = 0; t < 30; t++) { report(face({ playing: false, position: 11, duration: 3000 })); await vi.advanceTimersByTimeAsync(1000); }
    expect(navigated).toEqual([]);
    // the player gone, but a person pressed on the page: theirs
    touched = true;
    for (let t = 0; t < DOCTOR_LOST_MS / 1000 + 5; t++) { report(face({ playing: false, position: 0, duration: null })); await vi.advanceTimersByTimeAsync(1000); }
    expect(navigated).toEqual([]);
    // the person browsed away from the title: nothing to heal
    touched = false;
    go("https://www.hulu.com/hub/home");
    for (let t = 0; t < 60; t++) { report(null); await vi.advanceTimersByTimeAsync(1000); }
    expect(navigated).toEqual([]);
  });

  it("a person's seek: a stall in the minute after it is never healed (Peacock, 2026-09-23)", async () => {
    let touchedAt = 0;
    const { v, navigated, report } = rig({ person: () => touchedAt > 0 });
    await v.restoreTitle("screen", URL, "Paradise", true);
    for (let t = 0; t < 5; t++) { report(face({ playing: true, position: 100 + t, duration: 3000 }), true); await vi.advanceTimersByTimeAsync(1000); }
    touchedAt = Date.now();   // the slider
    for (let t = 0; t < 45; t++) { report(face({ playing: true, position: 640, duration: 3000 }), true); await vi.advanceTimersByTimeAsync(1000); }
    expect(navigated).toEqual([]);
  });

  it("the probe is plain page JS that parses", () => {
    expect(() => new Function(PLAYBACK_ERROR_PROBE_JS)).not.toThrow();
    expect(PLAYBACK_ERROR_PROBE_JS).toContain("/\\s+/g");
    expect(DOCTOR_FROZEN_MS).toBeGreaterThan(10_000);
  });
});
