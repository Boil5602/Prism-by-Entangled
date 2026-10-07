import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCTOR_FROZEN_MS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// 2026-10-06: "An item I was playing in multi window 2 is sitting there spinning like it's frozen. Its a twitch video" (the player paused
// itself on a stall and the doctor took it for a person's pause), and "The apple title I was playing is sitting on its homepage again" (a
// reopen loaded the episode's page, which waits for a Play press).

const URL = "https://www.twitch.tv/videos/2892751942";
function rig(opts: { videoPlay?: boolean; person?: () => boolean } = {}) {
  const navigated: string[] = [];
  const injected: string[] = [];
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.twitch.tv"], videoContext: "/*c*/", ...(opts.videoPlay ? { videoPlay: "/*p*/" } : {}) }), adapterIdOf: () => "twitch", tileExists: () => true,
    inject: async (_id, js) => { injected.push(js); }, navigate: async (_id, url) => { navigated.push(url); }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => URL, onStage: () => false, enterStage: () => {},
    evaluate: async () => JSON.stringify(""), personActedSince: () => (opts.person ? opts.person() : false),
  });
  const report = (video: Record<string, unknown>, playing: boolean) => v.onObservation("w2", { playing, title: "", artist: "", album: "", artwork: null, video: { kind: "video", title: "Newsday", url: URL, ...video } } as unknown as NowPlaying);
  return { v, navigated, injected, report };
}

describe("the doctor and a stopped player", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a player that stopped itself and says it is loading is healed after a freeze's wait; one that is simply paused is left", async () => {
    const stalled = rig();
    await stalled.v.restoreTitle("w2", URL, "Newsday", false);
    for (let t = 0; t < 5; t++) { stalled.report({ playing: true, position: 12795 + t, duration: 23315 }, true); await vi.advanceTimersByTimeAsync(1000); }
    for (let t = 0; t < 40; t++) { stalled.report({ playing: false, buffering: true, position: 12800, duration: 23315 }, false); await vi.advanceTimersByTimeAsync(1000); }
    await vi.advanceTimersByTimeAsync(3000);
    expect(stalled.navigated).toEqual([URL]);
    expect(stalled.v.state(["w2"])[0]!.recovering).toMatchObject({ why: "the player stalled" });

    const paused = rig();
    await paused.v.restoreTitle("w2", URL, "Newsday", false);
    for (let t = 0; t < 5; t++) { paused.report({ playing: true, position: 12795 + t, duration: 23315 }, true); await vi.advanceTimersByTimeAsync(1000); }
    for (let t = 0; t < DOCTOR_FROZEN_MS / 1000 + 20; t++) { paused.report({ playing: false, buffering: false, position: 12800, duration: 23315 }, false); await vi.advanceTimersByTimeAsync(1000); }
    expect(paused.navigated).toEqual([]);
  });

  it("a reopen asks the service's own play once the page is up, never over a person's press or a title already playing", async () => {
    const r = rig({ videoPlay: true });
    await r.v.restoreTitle("w2", URL, "Newsday", false);
    for (let t = 0; t < 5; t++) { r.report({ playing: true, position: 100 + t, duration: 3000 }, true); await vi.advanceTimersByTimeAsync(1000); }
    for (let t = 0; t < 40; t++) { r.report({ playing: false, buffering: true, position: 104, duration: 3000 }, false); await vi.advanceTimersByTimeAsync(1000); }
    await vi.advanceTimersByTimeAsync(3000 + 6500);
    expect(r.navigated).toEqual([URL]);
    expect(r.injected.some((js) => js.includes("__prismVideoPlay(\"title\""))).toBe(true);

    // a person presses right after the reopen: the page is theirs, no press of Prism's follows
    let navs: string[] = [];
    const p = rig({ videoPlay: true, person: () => navs.length > 0 });
    navs = p.navigated;
    await p.v.restoreTitle("w2", URL, "Newsday", false);
    for (let t = 0; t < 5; t++) { p.report({ playing: true, position: 100 + t, duration: 3000 }, true); await vi.advanceTimersByTimeAsync(1000); }
    for (let t = 0; t < 40; t++) { p.report({ playing: false, buffering: true, position: 104, duration: 3000 }, false); await vi.advanceTimersByTimeAsync(1000); }
    await vi.advanceTimersByTimeAsync(20_000);
    expect(p.navigated).toEqual([URL]);
    expect(p.injected.some((js) => js.includes("__prismVideoPlay(\"title\""))).toBe(false);
  });
});

describe("a channel whose match is only upcoming (B-335, found again after a restart 2026-10-06: 'Just lost paramount+ in window 4')", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("is not reopened, though the restored ask says 'live:<id>' and the page names itself 'Live TV'", async () => {
    const PAGE = "https://www.paramountplus.com/live-tv/stream/barclays-womens-super-league/";
    const navigated: string[] = [];
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.paramountplus.com"], videoContext: "/*c*/", videoTune: "/*t*/" }), adapterIdOf: () => "paramountplus", tileExists: () => true,
      inject: async () => {}, navigate: async (_id, url) => { navigated.push(url); }, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => PAGE, onStage: () => false, enterStage: () => {},
      evaluate: async () => JSON.stringify(""), personActedSince: () => false, renew: async (_id: string, url: string) => { navigated.push(url); },
    });
    v.keepLive("paramountplus", [{ id: "barclays-womens-super-league", name: "Barclays Women's Super League", url: PAGE, now: "Upcoming: Arsenal vs. Birmingham City" }]);
    await v.restoreChannel("w4", "live:barclays-womens-super-league", "Live TV", false);
    await v.tune("w4", "live:barclays-womens-super-league", "Live TV", PAGE);   // the restart tunes the channel again: its page is the watch
    const live = (playing: boolean) => v.onObservation("w4", { playing, title: "", artist: "", album: "", artwork: null, video: { kind: "live", title: "Live TV", series: "Live TV", id: "barclays-womens-super-league", url: PAGE, playing, position: null, duration: null } } as unknown as NowPlaying);
    for (let t = 0; t < 10; t++) { live(true); await vi.advanceTimersByTimeAsync(1000); }
    for (let t = 0; t < 120; t++) { live(false); await vi.advanceTimersByTimeAsync(1000); }
    expect(navigated).toEqual([]);
    expect(v.state(["w4"])[0]!.recovering).toMatchObject({ gaveUp: true, why: "not live yet. Upcoming: Arsenal vs. Birmingham City" });
  });
});
