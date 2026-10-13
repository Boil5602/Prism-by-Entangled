import { describe, expect, it } from "vitest";
import { VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/drivers.js";

// YouTube's history (2026-10-11, "What if I just finished it?"): the adapter lists only the part-watched videos as Continue watching, so a
// day when every video was finished reads as an empty continue-only page, beside the sidebar's own row. The row empties: yesterday's cards
// are not kept because an own row came with the read.
function make() {
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.youtube.com"], videoContext: "/*c*/" }), adapterIdOf: () => "youtube", tileExists: () => true,
    inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://www.youtube.com/feed/history", onStage: () => false, enterStage: () => {},
    evaluate: async () => "", personActedSince: () => false,
  } as unknown as ConstructorParameters<typeof VideoController>[0]);
  const item = (id: string, title: string, progress: number | null = null) => ({ id, title, kind: "video", url: null, artwork: null, subtitle: null, progress });
  const read = (lib: Record<string, unknown>) => v.keepListFrom("youtube", { playing: false, videoLibrary: lib } as unknown as NowPlaying, true);
  const cont = () => (v.libraryOf("youtube").library.continue ?? []).map((x) => x.title);
  const own = () => (v.libraryOf("youtube").library.own ?? []).map((r) => r.title);
  return { item, read, cont, own };
}

describe("a continue-only page with nothing part-watched", () => {
  it("empties the row, even beside the page's own rows; a page that is not continue-only keeps it", () => {
    const { item, read, cont, own } = make();
    const subs = { title: "Subscriptions", items: [item("@nasa", "NASA")] };
    read({ continue: [item("a", "Half watched", 0.5)], list: [], own: [subs], continueOnly: true });
    expect(cont()).toEqual(["Half watched"]);
    read({ continue: [], list: [], own: [subs], continueOnly: true });   // every video finished since
    expect(cont()).toEqual([]);
    expect(own()).toEqual(["Subscriptions"]);
    read({ continue: [item("b", "Started today", 0.1)], list: [], own: [subs], continueOnly: true });
    expect(cont()).toEqual(["Started today"]);
    read({ continue: [], list: [], own: [subs] });   // a page of own rows alone (a channel page) says nothing about the row
    expect(cont()).toEqual(["Started today"]);
  });
});
