import { describe, expect, it } from "vitest";
import { VideoController } from "../src/video.js";

// The slider (2026-09-23, "drag the slider on all of the video streams to find my spot"): the service's own seek (adapter videoSeek),
// answered at once (the host reads it through a script call that cannot wait on a promise), refused during an ad (B-263).
function rig(spec: Record<string, string> | undefined) {
  const injected: string[] = [];
  const v = new VideoController({
    adapterOf: () => spec as never, adapterIdOf: () => "svc", tileExists: (id) => id === "t", inject: async (_id, js) => void injected.push(js),
    navigate: async () => {}, dashId: () => "d", store: () => undefined, arm: () => {}, claimAudio: async () => {}, urlOf: () => null, onStage: () => false, enterStage: () => {},
  });
  return { v, injected };
}
describe("the slider's seek", () => {
  it("asks the page's own seek with the spot in seconds, and answers ok at once", () => {
    const { v, injected } = rig({ videoContext: "/*c*/", videoSeek: "/*s*/" });
    expect(v.seekTo("t", 1234.56)).toBe("ok");
    expect(injected).toEqual(["window.__prismVideoSeek && window.__prismVideoSeek(1234.6)"]);
  });
  it("no seek script, a bad spot, an unknown tile: unavailable, nothing asked", () => {
    const { v, injected } = rig({ videoContext: "/*c*/" });
    expect(v.seekTo("t", 10)).toBe("unavailable");
    expect(rig({ videoContext: "/*c*/", videoSeek: "/*s*/" }).v.seekTo("t", NaN)).toBe("unavailable");
    expect(v.seekTo("nope", 10)).toBe("unknown-tile");
    expect(injected).toEqual([]);
  });
  it("during an ad it is refused", () => {
    const { v, injected } = rig({ videoContext: "/*c*/", videoSeek: "/*s*/" });
    v.onObservation("t", { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "title", title: "X", ad: true } } as never);
    expect(v.seekTo("t", 100)).toBe("ad");
    expect(injected).toEqual([]);
  });
});
