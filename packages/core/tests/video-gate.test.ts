import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

const URL = "https://www.twitch.tv/somebody";

function rig() {
  const navigated: string[] = [];
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.twitch.tv"], videoContext: "/*c*/" }), adapterIdOf: () => "twitch", tileExists: () => true,
    inject: async () => {}, navigate: async (_id, url) => { navigated.push(url); }, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => URL, onStage: () => false, enterStage: () => {},
    evaluate: async () => JSON.stringify(""), personActedSince: () => false,
  });
  const report = (gate: { text: string; verb?: string } | null) => v.onObservation("w2", { playing: false, title: "", artist: "", album: "", artwork: null, video: { kind: "live", title: "somebody", url: URL, playing: false }, videoGate: gate } as unknown as NowPlaying);
  return { v, navigated, report };
}

describe("a service's own gate over its player (2026-10-13, Twitch's content disclaimer: 'I want them to see the disclaimer attached')", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("stands in the state in the service's words with its verb, holds the doctor and the pick while it is up, and goes when the page drops it", async () => {
    const { v, navigated, report } = rig();
    await v.restoreTitle("w2", URL, "somebody", false);
    const words = "somebody's content is intended for certain audiences It may contain: Drugs, Intoxication, or Excessive Tobacco Use";
    for (let t = 0; t < 50; t++) { report({ text: words, verb: "Start watching" }); await vi.advanceTimersByTimeAsync(1000); }
    const s = v.state(["w2"])[0]!;
    expect(s.gate).toEqual({ text: words, verb: "Start watching" });
    expect(s.error).toBeNull();
    expect(s.recovering).toBeFalsy();
    expect(navigated).toEqual([]);   // fifty seconds with nothing playing, and no "it did not start": the gate is the person's to answer
    report(null);
    expect(v.state(["w2"])[0]!.gate).toBeNull();
  });
});
