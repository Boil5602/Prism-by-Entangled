import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// 2026-10-06, "When the software closes while something is actively playing, it autostarts the title from its last known location. I noticed the
// apple title that is playing, the homepage for the title displays first before the video (in the big window), it should not": a start stays
// open until the tile first plays, though a resumed title's pick lands as soon as its page names it.

const make = () => new VideoController({
  adapterOf: () => ({ match: ["tv.apple.com"], videoContext: "/*c*/" }), adapterIdOf: () => "appletv", tileExists: () => true,
  inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
  arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://tv.apple.com/us/episode/x/umc.1", onStage: () => false, enterStage: () => {},
});
const page = (playing: boolean) => ({ playing, title: "Trina", artist: "", album: "", artwork: null, video: { kind: "episode", title: "Trina", url: "https://tv.apple.com/us/episode/x/umc.1", playing } } as unknown as NowPlaying);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0)); });
afterEach(() => vi.useRealTimers());

describe("a start the wall waits on to play", () => {
  it("stays open after a resumed title's page names it, until the title plays", async () => {
    const v = make();
    await v.restoreTitle("screen", "https://tv.apple.com/us/episode/x/umc.1", "The Big Door Prize", false);
    expect(v.startingOpen("screen")).toBe(true);
    v.onObservation("screen", page(false));   // the title's page, named, not playing
    expect(v.startingOpen("screen")).toBe(true);
    vi.advanceTimersByTime(2000);
    v.onObservation("screen", page(true));
    expect(v.startingOpen("screen")).toBe(false);
  });

  it("ignores the last title's play reported in the first moment, and ends on its own for a resume left paused", async () => {
    const v = make();
    await v.restoreTitle("screen", "https://tv.apple.com/us/episode/x/umc.1", "The Big Door Prize", false);
    v.notePlayback("screen", true);   // within 1.5 s: the page that was there
    expect(v.startingOpen("screen")).toBe(true);
    vi.advanceTimersByTime(26_000);
    expect(v.startingOpen("screen")).toBe(false);
  });

  it("goes with a pick called off", async () => {
    const v = make();
    await v.play("screen", "episode", "umc.1", "https://tv.apple.com/us/episode/x/umc.1", "Trina");
    expect(v.startingOpen("screen")).toBe(true);
    v.cancelPick("screen");
    expect(v.startingOpen("screen")).toBe(false);
  });
});
