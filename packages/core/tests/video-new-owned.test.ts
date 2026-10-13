import { describe, expect, it } from "vitest";
import { VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/drivers.js";

// New in your library (2026-10-11, "How do we quickly surface that item to the user?"): a title that joins a library already known is new
// to it for a week - a purchase made on the phone among them. The first read of a library is the library, not two thousand purchases.
describe("the titles that joined a service's library (newlyOwned)", () => {
  function make() {
    const v = new VideoController({
      adapterOf: () => ({ match: ["athome.fandango.com"], videoContext: "/*c*/", videoLibrary: "/*l*/" }), adapterIdOf: () => "fandango", tileExists: () => true,
      inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://athome.fandango.com/content/my/library", onStage: () => false, enterStage: () => {},
      evaluate: async () => "", personActedSince: () => false,
    } as unknown as ConstructorParameters<typeof VideoController>[0]);
    const item = (id: string, title: string) => ({ id, title, kind: "movie", url: null, artwork: null, subtitle: null, progress: null });
    const read = (owned: ReturnType<typeof item>[], complete = true) =>
      v.keepListFrom("fandango", { playing: false, videoLibrary: { continue: [], list: [], owned, ownedComplete: complete } } as unknown as NowPlaying, true);
    return { v, item, read };
  }

  it("the first read of a library makes nothing new; a title that joins it later is new, newest first", () => {
    const { v, item, read } = make();
    read([item("a", "The Lantern Coast"), item("b", "Northbound")]);
    expect(v.newlyOwned("fandango")).toEqual([]);
    read([item("a", "The Lantern Coast"), item("b", "Northbound"), item("c", "Juniper and Rye")]);
    expect(v.newlyOwned("fandango").map((n) => n.item.title)).toEqual(["Juniper and Rye"]);
    read([item("a", "The Lantern Coast"), item("b", "Northbound"), item("c", "Juniper and Rye"), item("d", "Small Hours")]);
    expect(v.newlyOwned("fandango").map((n) => n.item.title)).toEqual(["Small Hours", "Juniper and Rye"]);
  });

  it("a week on it is no longer new, and a title read again is not new again", () => {
    const { v, item, read } = make();
    read([item("a", "The Lantern Coast")]);
    read([item("a", "The Lantern Coast"), item("c", "Juniper and Rye")]);
    const later = Date.now() + VideoController.NEW_OWNED_MS + 60_000;
    expect(v.newlyOwned("fandango", VideoController.NEW_OWNED_MS, later)).toEqual([]);
    read([item("a", "The Lantern Coast"), item("c", "Juniper and Rye")]);
    expect(v.newlyOwned("fandango").length).toBe(1);   // still the one, from its first joining
  });

  it("a title deep in a read is one an earlier read missed, not a purchase: only the front of a read can be new", () => {
    const { v, item, read } = make();
    const many = Array.from({ length: 30 }, (_, i) => item("m" + i, "Title " + i));
    read(many);
    read([...many.slice(0, 20), item("deep", "The Guard"), ...many.slice(20)]);   // turns up at position 20
    expect(v.newlyOwned("fandango")).toEqual([]);
    read([item("front", "Juniper and Rye"), ...many.slice(0, 20), item("deep", "The Guard"), ...many.slice(20)]);   // added last, listed first
    expect(v.newlyOwned("fandango").map((n) => n.item.title)).toEqual(["Juniper and Rye"]);
  });

  it("a partial read that misses titles makes none of them new when they return", () => {
    const { v, item, read } = make();
    read([item("a", "The Lantern Coast"), item("b", "Northbound")]);
    read([item("a", "The Lantern Coast")], false);   // a page that rendered late: b is still owned
    read([item("a", "The Lantern Coast"), item("b", "Northbound")]);
    expect(v.newlyOwned("fandango")).toEqual([]);
  });
});
