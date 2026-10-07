import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TUNE_BOUNCE_MS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// A channel asked for is a pick on its way, as a title is (2026-09-29, "tried to start a peacock channel ... went to Nothing is playing"): it
// fails when the service sends its page back where the tune began, or at the pick's clock; a channel that plays clears it.
const HOME = "https://www.peacocktv.com/watch/home";
function rig() {
  let here = HOME;
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.peacocktv.com"], videoContext: "/*c*/", videoTune: "/*t*/" }), adapterIdOf: () => "peacock", tileExists: () => true,
    inject: async () => {}, navigate: async (_id, url) => { here = url; }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
  });
  const report = (video: Record<string, unknown> | null, playing = false) => v.onObservation("screen", { playing, title: "", artist: "", album: "", artwork: null, video } as unknown as NowPlaying);
  return { v, report, go: (u: string) => { here = u; } };
}

describe("a tune is a pick", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the service stepping back to where the tune began fails it, in words, soon", async () => {
    const { v, go } = rig();
    await v.tune("screen", "AFV", "America's Funniest Home Videos");
    expect(v.state(["screen"])[0]!.pending).toMatchObject({ kind: "live", name: "America's Funniest Home Videos" });
    go("https://www.peacocktv.com/watch/playback/live/4928"); v.noteNavigated("screen", "https://www.peacocktv.com/watch/playback/live/4928");
    go(HOME); v.noteNavigated("screen", HOME);   // Peacock's player stepped back
    await vi.advanceTimersByTimeAsync(TUNE_BOUNCE_MS + 100);
    expect(v.state(["screen"])[0]!.pending?.failed).toBe("the service went back to its page instead of playing the channel");
  });

  it("a live channel playing with no name on its page lands the pick, and the channel's name stands in (2026-09-29, Peacock)", async () => {
    const { v, report, go } = rig();
    await v.tune("screen", "NBC NEWS NOW", "NBC NEWS NOW");
    go("https://www.peacocktv.com/watch/playback/live/5676");
    report({ kind: "live", title: "", url: "https://www.peacocktv.com/watch/playback/live/5676", playing: true }, true);
    await vi.advanceTimersByTimeAsync(30_000);
    const st = v.state(["screen"])[0]!;
    expect(st.pending).toBeNull();
    expect(st.video).toMatchObject({ kind: "live", title: "NBC NEWS NOW" });
  });

  it("another channel, still playing, does not land the pick; a walk that is merely slow is not a bounce (2026-09-29 review)", async () => {
    const { v, report, go } = rig();
    go("https://www.peacocktv.com/watch/playback/live/1111");
    await v.tune("screen", "B", "Channel B");
    report({ kind: "live", title: "On A", channel: "A", url: "https://www.peacocktv.com/watch/playback/live/1111", playing: true }, true);   // A plays on
    expect(v.state(["screen"])[0]!.pending).toMatchObject({ name: "Channel B" });
    report({ kind: "live", title: "On B", channel: "B", url: "https://www.peacocktv.com/watch/playback/live/2222", playing: true }, true);
    expect(v.state(["screen"])[0]!.pending).toBeNull();
    const slow = rig();
    await slow.v.tune("screen", "B", "Channel B");   // from its home, which takes its time
    await vi.advanceTimersByTimeAsync(TUNE_BOUNCE_MS + 100);
    expect(slow.v.state(["screen"])[0]!.pending?.failed ?? null).toBeNull();
  });

  it("a channel that plays clears the pick; nothing fails later", async () => {
    const { v, report, go } = rig();
    await v.tune("screen", "AFV", "America's Funniest Home Videos");
    go("https://www.peacocktv.com/watch/playback/live/4928");
    report({ kind: "live", title: "America's Funniest Home Videos", url: "https://www.peacocktv.com/watch/playback/live/4928", playing: true }, true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(v.state(["screen"])[0]!.pending?.failed ?? null).toBeNull();
  });
});
