import { describe, expect, it } from "vitest";
import { VideoController } from "../src/video.js";

// The guide's programme on a window (programEdges) is what the break watch reads its programme, its edges and its channel name from.
// 2026-10-11: the big window came back from a restart on a channel's watch address, with no tune and no hint, and for a night the
// watch had none of the three for it, though the page itself said which channel it was on.
describe("the channel a window is on, and the guide's programme there (channelOf, programEdges)", () => {
  const NOW = Date.UTC(2026, 9, 11, 9, 10);
  const HALF = Math.floor(NOW / 1_800_000) * 1_800_000;
  function rig() {
    const v = new VideoController({
      adapterOf: () => ({ videoContext: "x" }) as never, adapterIdOf: () => "youtube-tv", tileExists: () => true, inject: async () => {},
      navigate: async () => {}, dashId: () => "d", store: () => undefined, arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://tv.youtube.com/watch/x", enterStage: () => {},
    } as never);
    v.keepLive("youtube-tv", [
      { id: "UCfx", name: "FX", url: "https://tv.youtube.com/live", schedule: [{ title: "A Film", start: HALF - 3_600_000, end: HALF + 1_800_000 }, { title: "Paid Programming", start: HALF + 1_800_000, end: HALF + 3_600_000 }] },
      { id: "UCfood", name: "Food Network", url: "https://tv.youtube.com/live", schedule: [{ title: "The Kitchen", start: HALF, end: HALF + 3_600_000 }] },
    ]);
    return v;
  }

  it("a live page that names its channel by name is matched to the guide, with no tune and no hint", () => {
    const v = rig();
    expect(v.programEdges("screen", NOW)).toBeNull();   // nothing known yet
    v.onObservation("screen", { playing: true, title: "A Film", artist: "", video: { kind: "live", title: "A Film", channel: "FX", id: "exvv", url: "https://tv.youtube.com/watch/exvv", playing: true } } as never);
    expect(v.channelOf("screen")).toEqual({ id: "FX", name: "FX" });
    expect(v.programEdges("screen", NOW)).toEqual({ channel: "FX", title: "A Film", start: HALF - 3_600_000, end: HALF + 1_800_000 });
    expect(v.programEdges("screen", HALF + 1_800_000 + 60_000)?.title).toBe("Paid Programming");
  });

  it("a restart's record that names nothing in the guide does not hide the page's own word (seen live 2026-10-11)", async () => {
    const v = rig();
    await v.restoreChannel("screen", "exvv", "A Film", false);   // the big window, 'tuned' to the film it had been started on
    v.onObservation("screen", { playing: true, title: "A Film", artist: "", video: { kind: "live", title: "A Film", channel: "FX", playing: true } } as never);
    expect(v.programEdges("screen", NOW)).toEqual({ channel: "FX", title: "A Film", start: HALF - 3_600_000, end: HALF + 1_800_000 });
  });

  it("... and by the guide's id as well", () => {
    const v = rig();
    v.onObservation("w4", { playing: true, title: "The Kitchen", artist: "", video: { kind: "live", title: "The Kitchen", channel: "UCfood", playing: true } } as never);
    expect(v.programEdges("w4", NOW)).toEqual({ channel: "Food Network", title: "The Kitchen", start: HALF, end: HALF + 3_600_000 });
  });

  it("a window on a title, or a live page that names no channel, is on no channel", () => {
    const v = rig();
    v.onObservation("a", { playing: true, title: "A Film", artist: "", video: { kind: "movie", title: "A Film", channel: "FX", playing: true } } as never);
    expect(v.channelOf("a")).toBeNull();
    v.onObservation("b", { playing: true, title: "Something", artist: "", video: { kind: "live", title: "Something", playing: true } } as never);
    expect(v.channelOf("b")).toBeNull();
    expect(v.programEdges("b", NOW)).toBeNull();
  });
});
