import { describe, expect, it } from "vitest";
import { VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/drivers.js";

function make() {
  const v = new VideoController({
    adapterOf: () => ({ match: ["www.peacocktv.com"], videoContext: "/*c*/" }), adapterIdOf: () => "peacock", tileExists: () => true,
    inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://www.peacocktv.com/watch/my-stuff", onStage: () => false, enterStage: () => {},
    evaluate: async () => "", personActedSince: () => false,
  } as unknown as ConstructorParameters<typeof VideoController>[0]);
  const asked: string[] = [];
  v.onListReturned = (_a, it, n) => asked.push(it.title + "#" + n);
  const item = (id: string, title: string) => ({ id, title, kind: "series", url: null, artwork: null, subtitle: null, progress: null });
  const read = (...items: ReturnType<typeof item>[]) => v.keepListFrom("peacock", { playing: false, videoLibrary: { continue: [], list: items } } as unknown as NowPlaying, true);
  const list = () => (v.libraryOf("peacock").library.list ?? []).map((x) => x.title);
  return { v, asked, item, read, list };
}

describe("a removal the service did not keep", () => {
  it("stays off the row and is asked again, twice at most, then is the household's", () => {
    const { v, asked, item, read, list } = make();
    const mf = item("1", "Modern Family"), pr = item("2", "Parks and Recreation");
    read(mf, pr);
    v.noteRemoved("peacock", mf);
    read(mf, pr);                           // back on the next read
    expect(list()).toEqual(["Parks and Recreation"]);
    expect(asked).toEqual(["Modern Family#1"]);
    read(mf, pr);                           // still being retried: not asked twice at once
    expect(asked).toEqual(["Modern Family#1"]);
    v.removalRetried("peacock", "1");
    read(mf, pr);
    expect(asked).toEqual(["Modern Family#1", "Modern Family#2"]);
    v.removalRetried("peacock", "1");
    read(mf, pr);                           // two retries spent: it is theirs to keep
    expect(list()).toEqual(["Modern Family", "Parks and Recreation"]);
  });
  it("an add from the wall ends the record", () => {
    const { v, asked, item, read, list } = make();
    const mf = item("1", "Modern Family");
    v.noteRemoved("peacock", mf);
    v.noteAdded("peacock", "1");
    read(mf);
    expect(asked).toEqual([]);
    expect(list()).toEqual(["Modern Family"]);
  });
});
