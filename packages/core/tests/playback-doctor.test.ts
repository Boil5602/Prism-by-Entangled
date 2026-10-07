import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCTOR_FROZEN_MS, DOCTOR_GAP_MS, DOCTOR_LOST_MS, DOCTOR_START_MS, PLAYBACK_ERROR_PROBE_JS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// The playback doctor (2026-09-23, "There is an error on the hulu video playback, can you see what can be done to autodetect and
// autorecover from video playback errors?"): a tile on the title the wall asked for is watched for the page's error, a start that never
// comes, a frozen clock, and a vanished player; each is healed by opening the title's own address again, within caps, then it stops.

const URL = "https://www.hulu.com/watch/189d7aa8";
function rig(opts: { said?: string; person?: () => boolean; renew?: boolean } = {}) {
  const navigated: string[] = [];
  const renewed: string[] = [];
  let here = URL;
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.hulu.com"], videoContext: "/*c*/" }), adapterIdOf: () => "hulu", tileExists: () => true,
    inject: async () => {}, navigate: async (_id, url) => { navigated.push(url); here = url; }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
    evaluate: async () => JSON.stringify(opts.said ?? ""), personActedSince: () => (opts.person ? opts.person() : false),
    ...(opts.renew ? { renew: async (_id: string, url: string) => { renewed.push(url); here = url; } } : {}),
  });
  const report = (video: Record<string, unknown> | null, playing = false) => v.onObservation("screen", { playing, title: "", artist: "", album: "", artwork: null, video } as unknown as NowPlaying);
  return { v, navigated, renewed, report, go: (u: string) => { here = u; } };
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

  it("the second try opens the title in a fresh window where the shell can make one; a reload keeps the page's process (2026-09-29, Paramount+ live)", async () => {
    const { v, navigated, renewed, report } = rig({ renew: true });
    await v.restoreTitle("screen", URL, "Paradise", true);
    for (let i = 0; i < 2; i++) {
      report(face({ playing: false, error: "Error playing video" }));
      await vi.advanceTimersByTimeAsync(DOCTOR_GAP_MS + 3000);
    }
    expect(navigated).toEqual([URL]);   // the first try: the same window, the address again
    expect(renewed).toEqual([URL]);     // the second: a fresh window
  });

  it("an address that arrives at a neighbouring one (a redirect) is still the title: a start that never comes is healed; a page browsed to elsewhere is not (2026-09-29, Paramount+ live)", async () => {
    for (const [to, heals] of [["https://www.hulu.com/watch/cbs-news", 1], ["https://www.hulu.com/hub/home", 0]] as const) {
      const { v, navigated, report, go } = rig();
      await v.restoreTitle("screen", URL, "Paradise", true);
      go(to); v.noteNavigated("screen", to);
      report(face({ url: to, playing: false, position: 0, duration: null }));
      await vi.advanceTimersByTimeAsync(DOCTOR_START_MS + 1000);
      report(face({ url: to, playing: false, position: 0, duration: null }));
      await vi.advanceTimersByTimeAsync(3000);
      expect(navigated.length).toBe(heals);
    }
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

  it("the wall's Skip button follows the page's offer: shown while a title plays and the page offers one, never in an ad, gone when it goes (2026-09-29)", async () => {
    let said = "Skip Intro";
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.hulu.com"], videoContext: "/*c*/" }), adapterIdOf: () => "hulu", tileExists: () => true,
      inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => URL, onStage: () => true, enterStage: () => {},
      evaluate: async () => JSON.stringify(said), personActedSince: () => false,
    });
    const report = (video: Record<string, unknown>) => v.onObservation("screen", { playing: true, title: "", artist: "", album: "", artwork: null, video } as unknown as NowPlaying);
    report(face({ playing: true, position: 5, duration: 3000 }));
    await vi.advanceTimersByTimeAsync(10);
    expect(v.state(["screen"])[0]!.skip).toBe("Skip Intro");
    said = "";
    await vi.advanceTimersByTimeAsync(2500);
    report(face({ playing: true, position: 8, duration: 3000 }));
    await vi.advanceTimersByTimeAsync(10);
    expect(v.state(["screen"])[0]!.skip).toBeNull();
    said = "Skip Intro";
    await vi.advanceTimersByTimeAsync(2500);
    report(face({ playing: true, position: 9, duration: 3000, ad: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(v.state(["screen"])[0]!.skip).toBeNull();
  });

  it("the probe is plain page JS that parses", () => {
    expect(() => new Function(PLAYBACK_ERROR_PROBE_JS)).not.toThrow();
    expect(PLAYBACK_ERROR_PROBE_JS).toContain("/\\s+/g");
    expect(DOCTOR_FROZEN_MS).toBeGreaterThan(10_000);
  });
});

describe("a channel that never starts (2026-09-29, 'none of the mini windows are playing')", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the media session's 'playing' over an empty player is not playing; the doctor reopens the channel's page", async () => {
    const PAGE = "https://www.paramountplus.com/live-tv/stream/cbs-sports-hq/";
    const navigated: string[] = []; const tunes: string[] = [];
    let here = "https://www.paramountplus.com/";
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.paramountplus.com"], videoContext: "/*c*/", videoTune: "/*tune*/" }), adapterIdOf: () => "paramountplus", tileExists: () => true,
      inject: async (_id, js) => { if (/__prismVideoTune\(/.test(js)) tunes.push(js); }, navigate: async (_id, url) => { navigated.push(url); here = url; }, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
      evaluate: async () => JSON.stringify(""), personActedSince: () => false,
    });
    await v.tune("w1", "cbs-sports-hq", "CBS Sports HQ", PAGE);
    here = PAGE;
    // the page's media session says playing; the adapter, reading the element, says the player has not started
    const report = () => v.onObservation("w1", { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "live", series: "CBS Sports HQ", title: "CBS Sports HQ", id: "cbs-sports-hq", url: PAGE, playing: false, position: null, duration: null, ad: false } } as unknown as NowPlaying);
    report();
    await vi.advanceTimersByTimeAsync(100);
    expect(v.state(["w1"])[0]!.playing).toBe(false);
    expect(v.state(["w1"])[0]!.pending).toMatchObject({ name: "CBS Sports HQ" });   // not landed on the session's word
    for (let t = 0; t < DOCTOR_START_MS + 6000; t += 2000) { report(); await vi.advanceTimersByTimeAsync(2000); }
    expect(tunes.length).toBe(2);   // tuned again, in place (a service that tunes by its own walk is never sent to a bare address)
    expect(navigated).toEqual([]);
    expect(v.state(["w1"])[0]!.recovering).toMatchObject({ why: "it did not start", attempt: 1 });
  });
});

describe("the doctor's own clock and a channel the service moved (2026-09-29, 'keep working on the doctor's second attempt')", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const PAGE = "https://www.paramountplus.com/live-tv/stream/cbs-sports-hq/";
  const rigLive = () => {
    const navigated: string[] = []; const renewed: string[] = []; const tunes: string[] = [];
    let here = PAGE;
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.paramountplus.com"], videoContext: "/*c*/", videoTune: "/*tune*/" }), adapterIdOf: () => "paramountplus", tileExists: () => true,
      inject: async (_id, js) => { if (/__prismVideoTune\(/.test(js)) tunes.push(js); }, navigate: async (_id, url) => { navigated.push(url); here = url; }, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
      evaluate: async () => JSON.stringify(""), personActedSince: () => false, renew: async (_id, url) => { renewed.push(url); here = url; },
    });
    const report = (id: string, playing: boolean) => v.onObservation("w1", { playing: false, title: "", artist: "", album: "", artwork: null, video: { kind: "live", series: "Live TV", title: "Live TV", id, url: here, playing, position: null, duration: null, ad: false } } as unknown as NowPlaying);
    return { v, navigated, renewed, tunes, report, go: (u: string) => { here = u; } };
  };

  it("a page that reports nothing more is still looked at: the second try opens a fresh window", async () => {
    const { v, navigated, renewed, tunes, report } = rigLive();
    await v.tune("w1", "cbs-sports-hq", "CBS Sports HQ", PAGE);
    report("cbs-sports-hq", false);   // one report, then silence (no player, nothing to report)
    await vi.advanceTimersByTimeAsync(DOCTOR_START_MS + 8_000);
    expect(tunes.length).toBe(2);   // try 1: tuned again in place, on the doctor's own clock
    expect(navigated).toEqual([]);
    expect(v.state(["w1"])[0]!.recovering).toMatchObject({ attempt: 1 });
    await vi.advanceTimersByTimeAsync(DOCTOR_GAP_MS + DOCTOR_START_MS + 8_000);
    expect(renewed).toEqual([PAGE]);   // try 2, a fresh window at the channel's page, then tuned there
    await vi.advanceTimersByTimeAsync(100);
    expect(tunes.length).toBe(3);
    expect(v.state(["w1"])[0]!.recovering).toMatchObject({ attempt: 2 });
  });

  it("the service moved the page to another channel: not the person browsing on - the channel asked for is opened again", async () => {
    const { v, navigated, tunes, report, go } = rigLive();
    await v.tune("w1", "cbs-sports-hq", "CBS Sports HQ", PAGE);
    go("https://www.paramountplus.com/live-tv/stream/dana-white-contender-series/");
    report("dana-white-contender-series", true);   // another channel, playing
    await vi.advanceTimersByTimeAsync(DOCTOR_START_MS + 8_000);
    expect(tunes.length).toBe(2);   // the channel asked for, tuned again
    expect(navigated).toEqual([]);
    // a page that left live television altogether is the person's (browsing the service's home): nothing reopened
    const other = rigLive();
    await other.v.tune("w1", "cbs-sports-hq", "CBS Sports HQ", PAGE);
    other.go("https://www.paramountplus.com/home/");
    other.v.onObservation("w1", { playing: false, title: "", artist: "", album: "", artwork: null, video: null } as unknown as NowPlaying);
    await vi.advanceTimersByTimeAsync(DOCTOR_START_MS + 8_000);
    expect(other.navigated).toEqual([]);
    expect(other.tunes.length).toBe(1);   // the ask only
  });
});

describe("a channel beneath the guide's address is not a moved channel (2026-09-30 review)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("Peacock: every row carries the guide's address; a channel playing at a page beneath it is left alone; a page the service tunes by its walk is re-tuned, never sent to an address", async () => {
    const GUIDE = "https://www.peacocktv.com/watch/playback/live";
    const navigated: string[] = []; const tunes: string[] = [];
    let here = "https://www.peacocktv.com/";
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.peacocktv.com"], videoContext: "/*c*/", videoTune: "/*tune*/", videoLiveUrl: GUIDE }), adapterIdOf: () => "peacock", tileExists: () => true,
      inject: async (_id, js) => { if (/__prismVideoTune/.test(js)) tunes.push(js); }, navigate: async (_id, url) => { navigated.push(url); here = url; }, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
      evaluate: async () => JSON.stringify(""), personActedSince: () => false,
    });
    await v.tune("w1", "NBC News NOW", "NBC News NOW", GUIDE);   // the row's address is the guide's: no page of the channel's own
    here = GUIDE + "/5676009166762707117";
    const report = (playing: boolean) => v.onObservation("w1", { playing: false, title: "", artist: "", album: "", artwork: null, video: { kind: "live", series: "NBC News NOW", title: "NBC Nightly News", id: "5676009166762707117", channel: "NBC News NOW", url: here, playing, position: null, duration: null, ad: false } } as unknown as NowPlaying);
    report(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(v.state(["w1"])[0]!.playing).toBe(true);
    expect(v.state(["w1"])[0]!.pending).toBeNull();
    for (let t = 0; t < DOCTOR_START_MS + 10_000; t += 2000) { report(true); await vi.advanceTimersByTimeAsync(2000); }
    expect(navigated).toEqual([]);   // nothing healed: it plays
    expect(v.state(["w1"])[0]!.recovering ?? null).toBeNull();
    // and a channel that does not start on such a service: tuned again, not sent to the guide's address
    const other = { navigated: [] as string[], tunes: [] as string[] };
    let h2 = "https://www.peacocktv.com/";
    const v2 = new VideoController({
      adapterOf: () => ({ match: ["www.peacocktv.com"], videoContext: "/*c*/", videoTune: "/*tune*/", videoLiveUrl: GUIDE }), adapterIdOf: () => "peacock", tileExists: () => true,
      inject: async (_id, js) => { if (/__prismVideoTune\(/.test(js)) other.tunes.push(js); }, navigate: async (_id, url) => { other.navigated.push(url); h2 = url; }, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => h2, onStage: () => false, enterStage: () => {},
      evaluate: async () => JSON.stringify(""), personActedSince: () => false,
    });
    await v2.tune("w1", "NBC News NOW", "NBC News NOW", "https://www.peacocktv.com/channels/nbc-news-now");   // a page of its own
    h2 = "https://www.peacocktv.com/channels/nbc-news-now";
    const rep2 = () => v2.onObservation("w1", { playing: false, title: "", artist: "", album: "", artwork: null, video: { kind: "live", series: "Live TV", title: "Live TV", id: "x", url: h2, playing: false, position: null, duration: null, ad: false } } as unknown as NowPlaying);
    rep2();
    for (let t = 0; t < DOCTOR_START_MS + 10_000; t += 2000) { rep2(); await vi.advanceTimersByTimeAsync(2000); }
    expect(other.navigated).toEqual([]);
    expect(other.tunes.length).toBeGreaterThanOrEqual(2);   // the ask, and the doctor's tune again
  });
});

describe("a channel's page beneath its row's address is the channel's page (2026-09-30: the doctor had watched nothing on Peacock)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const ROW = "https://www.peacocktv.com/watch/playback/live";   // what every Peacock row names; the guide itself is /channels
  const make = (tunes: string[], navigated: string[], hereRef: { here: string }) => new VideoController({
    adapterOf: () => ({ match: ["www.peacocktv.com"], videoContext: "/*c*/", videoTune: "/*tune*/", videoLiveUrl: "https://www.peacocktv.com/channels" }), adapterIdOf: () => "peacock", tileExists: () => true,
    inject: async (_id, js) => { if (/__prismVideoTune\(/.test(js)) tunes.push(js); }, navigate: async (_id, url) => { navigated.push(url); hereRef.here = url; }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => hereRef.here, onStage: () => false, enterStage: () => {},
    evaluate: async () => JSON.stringify(""), personActedSince: () => false,
  });
  const live = (channel: string, playing: boolean, here: string) => ({ playing: false, title: "", artist: "", album: "", artwork: null, video: { kind: "live", series: channel, title: channel + ": S1 E1", id: here.split("/").pop()!, url: here, channel, playing, position: null, duration: null, ad: false } });
  it("the channel asked for, playing one level under the row's address: watched, and left alone while it plays", async () => {
    const tunes: string[] = [], navigated: string[] = []; const r = { here: "https://www.peacocktv.com/" };
    const v = make(tunes, navigated, r);
    await v.tune("w2", "America's Funniest Home Videos", "America's Funniest Home Videos", ROW);
    r.here = ROW + "/4928977508425328117";
    for (let t = 0; t < DOCTOR_START_MS + 20_000; t += 2000) { v.onObservation("w2", live("America's Funniest Home Videos", true, r.here)); await vi.advanceTimersByTimeAsync(2000); }
    expect(navigated).toEqual([]);
    expect(tunes.length).toBe(1);   // the ask alone
    expect(v.state(["w2"])[0]!.playing).toBe(true);
  });
  it("the channel asked for, at its page under the row's address, never starting: healed - tuned again, never sent to the row's address", async () => {
    const tunes: string[] = [], navigated: string[] = []; const r = { here: "https://www.peacocktv.com/" };
    const v = make(tunes, navigated, r);
    await v.tune("w2", "America's Funniest Home Videos", "America's Funniest Home Videos", ROW);
    r.here = ROW + "/4928977508425328117";
    for (let t = 0; t < DOCTOR_START_MS + 20_000; t += 2000) { v.onObservation("w2", live("America's Funniest Home Videos", false, r.here)); await vi.advanceTimersByTimeAsync(2000); }
    expect(navigated).toEqual([]);
    expect(tunes.length).toBeGreaterThanOrEqual(2);
  });
  it("the page's own word names another channel (the press landed on the wrong row): a start that never came, tuned again", async () => {
    const tunes: string[] = [], navigated: string[] = []; const r = { here: "https://www.peacocktv.com/" };
    const v = make(tunes, navigated, r);
    await v.tune("w2", "America's Funniest Home Videos", "America's Funniest Home Videos", ROW);
    r.here = ROW + "/8601608236836923117";
    for (let t = 0; t < 26_000; t += 2000) { v.onObservation("w2", live("Are We There Yet?", true, r.here)); await vi.advanceTimersByTimeAsync(2000); }
    // past the pick's 20 s the pick still stands, not failed: a failed pick would have a small multiview window closed before the doctor's turn
    expect(v.state(["w2"])[0]!.pending).not.toBeNull();
    expect(v.state(["w2"])[0]!.pending!.failed ?? null).toBeNull();
    for (let t = 26_000; t < DOCTOR_START_MS + 20_000; t += 2000) { v.onObservation("w2", live("Are We There Yet?", true, r.here)); await vi.advanceTimersByTimeAsync(2000); }
    expect(navigated).toEqual([]);
    expect(tunes.length).toBeGreaterThanOrEqual(2);
    expect(v.state(["w2"])[0]!.recovering ?? v.state(["w2"])[0]!.pending).not.toBeNull();   // the wall says so, not "playing"
  });
  it("the player gone - the page reporting no video at all (2026-09-30 13:27, both Peacock streams stopped when the session lapsed): tuned again within the lost window, not left for the empty-window prune", async () => {
    const tunes: string[] = [], navigated: string[] = []; const r = { here: "https://www.peacocktv.com/" };
    const v = make(tunes, navigated, r);
    await v.tune("w2", "America's Funniest Home Videos", "America's Funniest Home Videos", ROW);
    r.here = ROW + "/4928977508425328117";
    for (let t = 0; t < 60_000; t += 2000) { v.onObservation("w2", live("America's Funniest Home Videos", true, r.here)); await vi.advanceTimersByTimeAsync(2000); }
    expect(tunes.length).toBe(1);
    // the stream stops: no video in the report from here on
    for (let t = 0; t < 30_000; t += 2000) { v.onObservation("w2", { playing: false, title: "", artist: "", album: "", artwork: null, video: null }); await vi.advanceTimersByTimeAsync(2000); }
    expect(navigated).toEqual([]);
    expect(tunes.length).toBeGreaterThanOrEqual(2);   // the ask, and the doctor's tune again - inside 30 s, before a window would be pruned as empty (45 s)
    expect(v.state(["w2"])[0]!.pending).not.toBeNull();   // the window is loading again, not empty
  });
  it("the same channel spelled differently by the page (case, punctuation) is the one asked for", async () => {
    const tunes: string[] = [], navigated: string[] = []; const r = { here: "https://www.peacocktv.com/" };
    const v = make(tunes, navigated, r);
    await v.tune("w2", "Americas Funniest Home Videos", "America\u2019s Funniest Home Videos", ROW);
    r.here = ROW + "/4928977508425328117";
    for (let t = 0; t < DOCTOR_START_MS + 20_000; t += 2000) { v.onObservation("w2", live("AMERICA'S FUNNIEST HOME VIDEOS", true, r.here)); await vi.advanceTimersByTimeAsync(2000); }
    expect(tunes.length).toBe(1);
    expect(v.state(["w2"])[0]!.pending).toBeNull();   // the pick landed on the page's spelling (not timed out at 20 s)
    expect(v.state(["w2"])[0]!.playing).toBe(true);
  });
});
