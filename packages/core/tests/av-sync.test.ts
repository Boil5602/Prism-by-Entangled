import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AV_PROBE_JS, AV_SAMPLE_MS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// The picture falling behind the sound (2026-09-25, "The netflix audio and video are a little bit out of sync, are we able to detect and fix that
// if it occurs?"): the player's own counters sampled while a title plays; two samples behind get a pause and play, still behind the title is
// opened again; the person's Re-sync does the same by hand.

const URL = "https://www.netflix.com/watch/81724633";
function rig() {
  const injected: string[] = [];
  const navigated: string[] = [];
  // the player's counters as the page would give them: frames decoded, dropped, the title's clock
  let f = 0, d = 0, c = 100, fps = 24;
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.netflix.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" }), adapterIdOf: () => "netflix", tileExists: () => true,
    inject: async (_id, js) => { injected.push(js); }, navigate: async (_id, url) => { navigated.push(url); }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => URL, onStage: () => false, enterStage: () => {},
    evaluate: async (_id, js) => (js === AV_PROBE_JS ? JSON.stringify({ f, d, c, p: false }) : JSON.stringify("")),
    personActedSince: () => false,
  });
  const report = () => v.onObservation("screen", { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "episode", title: "Episode 2", series: "Animal Control", url: URL, id: "81724633", playing: true, position: c, duration: 1300 } } as unknown as NowPlaying);
  // one sample period: the clock moves as the wall clock does, the frames as the player decodes them
  const step = async (secs: number) => { c += secs; f += Math.round(fps * secs); await vi.advanceTimersByTimeAsync(secs * 1000); report(); await vi.advanceTimersByTimeAsync(10); };
  return { v, injected, navigated, report, step, setFps: (x: number) => { fps = x; }, drop: (n: number) => { d += n; } };
}
const nudges = (injected: string[]) => injected.filter((js) => js.includes('__prismVideoCmd("pause")')).length;

describe("the picture keeping time with the sound", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a player keeping time is left alone", async () => {
    const r = rig();
    await r.v.restoreTitle("screen", URL, "Animal Control", false);
    r.report();
    for (let i = 0; i < 8; i++) await r.step(AV_SAMPLE_MS / 1000);
    expect(nudges(r.injected)).toBe(0);
    expect(r.navigated).toEqual([]);
  });

  it("falling behind: a pause and play; still behind after that, the title is opened again at its place", async () => {
    const r = rig();
    await r.v.restoreTitle("screen", URL, "Animal Control", false);
    r.report();
    for (let i = 0; i < 4; i++) await r.step(AV_SAMPLE_MS / 1000);   // 24 a second learned
    r.setFps(18);   // the decoder falls to three quarters
    for (let i = 0; i < 3; i++) await r.step(AV_SAMPLE_MS / 1000);
    expect(nudges(r.injected)).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(r.injected.some((js) => js.includes('__prismVideoCmd("play")'))).toBe(true);
    for (let i = 0; i < 3; i++) await r.step(AV_SAMPLE_MS / 1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.navigated).toEqual([URL]);   // opened again - the wall's "close the app and open it again"
  });

  it("one burst as the player catches up (a restart) does not make a plain 24 read as behind (2026-10-06, the Apple TV episode reloaded three times)", async () => {
    const r = rig();
    await r.v.restoreTitle("screen", URL, "Big Door Prize", false);
    r.report();
    r.setFps(31);   // the first sample after the start: frames caught up in a burst
    await r.step(AV_SAMPLE_MS / 1000);
    await r.step(AV_SAMPLE_MS / 1000);
    r.setFps(24);   // then the film's own rate, for good
    for (let i = 0; i < 10; i++) await r.step(AV_SAMPLE_MS / 1000);
    expect(nudges(r.injected)).toBe(0);
    expect(r.navigated).toEqual([]);
  });

  it("Re-sync by hand: pause and play; pressed again within 10 s, the title opened again", async () => {
    const r = rig();
    await r.v.restoreTitle("screen", URL, "Animal Control", false);
    r.report();
    expect(r.v.resync("screen")).toBe("nudged");
    expect(nudges(r.injected)).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(r.v.resync("screen")).toBe("reopened");
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.navigated).toEqual([URL]);
  });
});
