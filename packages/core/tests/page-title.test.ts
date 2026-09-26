import { describe, expect, it } from "vitest";
import { isPageTitle, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

// A service's own page title is no title (2026-09-25: a Hulu window read "Hulu | Watch" in Watch's corner until it played).

describe("a service's page title", () => {
  it("is told from a title's name", () => {
    for (const t of ["Hulu | Watch", "Netflix", "Home | Paramount+", "Disney+", "Watch - Peacock", "Tubi"]) expect(isPageTitle(t)).toBe(true);
    for (const t of ["Atlanta", "It's Always Sunny in Philadelphia", "Watch Me Now", "Star Trek: Strange New Worlds", "Hulu Original: Only Murders", "Max Payne"]) expect(isPageTitle(t)).toBe(false);
  });

  it("gives way to the name the wall asked for", async () => {
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.hulu.com"], videoContext: "/*c*/" }), adapterIdOf: () => "hulu", tileExists: () => true,
      inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://www.hulu.com/watch/abc", onStage: () => false, enterStage: () => {},
    });
    await v.restoreTitle("w2", "https://www.hulu.com/watch/abc", "Atlanta", false);
    v.onObservation("w2", { playing: false, title: "", artist: "", album: "", artwork: null, video: { kind: "episode", title: "Hulu | Watch", url: "https://www.hulu.com/watch/abc" } } as unknown as NowPlaying);
    expect(v.state(["w2"])[0]!.video?.title).toBe("Atlanta");
  });
});

describe("an episode entry named series - episode", () => {
  it("is split: the series the title, the episode before the subtitle; films and plain names untouched", async () => {
    const { splitEpisodeName } = await import("../src/video.js");
    expect(splitEpisodeName({ kind: "episode", title: "Star Wars: Maul – Shadow Lord - Chapter 7: Call to Oblivion", subtitle: "20m left" }))
      .toMatchObject({ title: "Star Wars: Maul – Shadow Lord", subtitle: "Chapter 7: Call to Oblivion · 20m left" });
    expect(splitEpisodeName({ kind: "movie", title: "Spider-Man - Far From Home", subtitle: null }).title).toBe("Spider-Man - Far From Home");
    expect(splitEpisodeName({ kind: "episode", title: "Ted Lasso", subtitle: null }).title).toBe("Ted Lasso");
    expect(splitEpisodeName({ kind: "episode", title: "Andor – Rix Road", subtitle: null }).title).toBe("Andor – Rix Road");   // an en dash is the title's own
  });
});

describe("a service's home-page preview", () => {
  it("is not a title up, and not playing; a nameless video on a playback page still is", () => {
    let here = "https://www.netflix.com/browse";
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.netflix.com"], videoContext: "/*c*/", videoPlaysAt: ["/watch/"] }), adapterIdOf: () => "netflix", tileExists: () => true,
      inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => here, onStage: () => false, enterStage: () => {},
    });
    const report = (url: string) => v.onObservation("screen", { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "title", title: "", url, playing: true, position: 71 } } as unknown as NowPlaying);
    report("https://www.netflix.com/browse");
    expect(v.state(["screen"])[0]!.video).toBeNull();
    v.onObservation("screen", { playing: true, title: "", artist: "", album: "", artwork: null, video: null } as unknown as NowPlaying);   // no video named at all
    expect(v.state(["screen"])[0]!.playing).toBe(false);
    expect(v.state(["screen"])[0]!.playing).toBe(false);
    v.notePlayback("screen", true);
    expect(v.state(["screen"])[0]!.playing).toBe(false);
    here = "https://www.netflix.com/watch/82675085";
    report("https://www.netflix.com/watch/82675085");
    expect(v.state(["screen"])[0]!.playing).toBe(true);
  });
});

describe("a title the boot brought back", () => {
  it("is over if it never started, even when its page never said it had loaded", async () => {
    const { vi } = await import("vitest");
    const { RESTORE_GIVE_UP_MS } = await import("../src/video.js");
    vi.useFakeTimers();
    try {
      const v = new VideoController({
        adapterOf: () => ({ match: ["www.hulu.com"], videoContext: "/*c*/" }), adapterIdOf: () => "hulu", tileExists: () => true,
        inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
        arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://www.hulu.com/watch/abc", onStage: () => false, enterStage: () => {},
      });
      await v.restoreTitle("w2", "https://www.hulu.com/watch/abc", "Atlanta", false);
      expect(v.state(["w2"])[0]!.pending?.failed).toBeUndefined();
      vi.advanceTimersByTime(RESTORE_GIVE_UP_MS + 1);
      expect(v.state(["w2"])[0]!.pending?.failed).toBe("did not start again after the restart");
    } finally { vi.useRealTimers(); }
  });
});
