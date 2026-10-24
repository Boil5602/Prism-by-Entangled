import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOW_CONTROLS_READ_MS, SKIP_OFFER_JS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// The page's own controls woken with the wall's bar (2026-10-23, Netflix's Skip Intro "just disappears super quick and no alternative can be
// found"): the adapter's videoCmd "controls" wakes them, and the skip offer is asked again straight after, inside its usual two seconds.

function controller(answer: string) {
  const asked: string[] = [];
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.netflix.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/" }), adapterIdOf: () => "netflix", tileExists: () => true,
    inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://www.netflix.com/watch/1", onStage: () => false, enterStage: () => {},
    evaluate: async (_id: string, js: string) => { asked.push(js); return js === SKIP_OFFER_JS ? JSON.stringify("") : answer; },
  });
  const playing = () => v.onObservation("screen", { playing: true, title: "", artist: "", album: "", artwork: null,
    video: { kind: "episode", title: "The Visit", series: "A Show", url: "https://www.netflix.com/watch/1", playing: true, position: 40 } } as unknown as NowPlaying);
  return { v, asked, playing };
}

describe("the page's controls woken with the wall's bar", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("asks the page's skip offer again once the controls are up", async () => {
    vi.useFakeTimers();
    const { v, asked, playing } = controller("true");
    playing();
    expect(asked.filter((j) => j === SKIP_OFFER_JS)).toHaveLength(1);
    expect(await v.showControls("screen")).toBe("ok");
    expect(asked.some((j) => j.includes('"controls"'))).toBe(true);
    playing();   // inside the two seconds and before the controls have drawn: not asked yet
    expect(asked.filter((j) => j === SKIP_OFFER_JS)).toHaveLength(1);
    vi.advanceTimersByTime(SHOW_CONTROLS_READ_MS);
    playing();
    expect(asked.filter((j) => j === SKIP_OFFER_JS)).toHaveLength(2);
  });

  it("changes nothing on a page with no way to show its controls", async () => {
    vi.useFakeTimers();
    const { v, asked, playing } = controller("false");
    playing();
    expect(await v.showControls("screen")).toBe("unavailable");
    vi.advanceTimersByTime(SHOW_CONTROLS_READ_MS);
    playing();
    expect(asked.filter((j) => j === SKIP_OFFER_JS)).toHaveLength(1);
  });
});
