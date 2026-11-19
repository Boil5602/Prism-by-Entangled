import { describe, expect, it } from "vitest";
import { lookAheadFor } from "../src/look-ahead.js";
import type { VideoChannel } from "../src/types.js";

const YTV = { videoLookAhead: { backSec: 15 } };
const ch = (name: string, extra: Partial<VideoChannel> = {}): VideoChannel => ({ id: name, name, url: "https://tv.youtube.com/watch/x", ...extra });

describe("the look-ahead's rule of which channel may play behind live (docs/features/look-ahead.md)", () => {
  it("a service whose adapter has no look-ahead is never delayed", () => {
    expect(lookAheadFor(undefined, ch("HGTV"), "HGTV", "House Hunters")).toMatchObject({ ok: false, why: "no-service" });
    expect(lookAheadFor({}, ch("HGTV"), "HGTV", "House Hunters")).toMatchObject({ ok: false, why: "no-service" });
    expect(lookAheadFor({ videoLookAhead: { backSec: 0 } }, ch("HGTV"), "HGTV", "")).toMatchObject({ ok: false, why: "no-service" });
  });

  it("an entertainment or news channel may be delayed, and the answer carries the adapter's words", () => {
    expect(lookAheadFor(YTV, ch("HGTV"), "HGTV", "House Hunters")).toEqual({ ok: true, why: "ok", channel: "HGTV", backSec: 15, tooMany: null });
    expect(lookAheadFor({ videoLookAhead: { backSec: 15, tooMany: "too many" } }, ch("ABC News Live"), "", "Prime")).toMatchObject({ ok: true, tooMany: "too many" });
  });

  it("a sports channel is never delayed: by the service's word, by its name, or as an event row", () => {
    expect(lookAheadFor(YTV, ch("The Ocho", { category: "Sports" }), "", "")).toMatchObject({ ok: false, why: "sports" });
    expect(lookAheadFor(YTV, ch("ESPN"), "", "SportsCenter")).toMatchObject({ ok: false, why: "sports" });
    expect(lookAheadFor(YTV, ch("FS1"), "", "NASCAR Race Hub")).toMatchObject({ ok: false, why: "sports" });
    expect(lookAheadFor(YTV, ch("NFL Network"), "", "")).toMatchObject({ ok: false, why: "sports" });
    for (const name of ["ESPN2", "ESPNU", "ESPNEWS", "FS2", "Big Ten Network", "SEC Network", "CBSSN", "Tennis Channel"]) expect(lookAheadFor(YTV, ch(name), "", "")).toMatchObject({ ok: false, why: "sports" });
    expect(lookAheadFor(YTV, ch("Some Channel", { event: true }), "", "")).toMatchObject({ ok: false, why: "sports" });
  });

  it("a game on any other channel is not delayed while it is on", () => {
    expect(lookAheadFor(YTV, ch("CBS"), "", "NFL Football")).toMatchObject({ ok: false, why: "sports" });
    expect(lookAheadFor(YTV, ch("TNT"), "", "NBA Basketball")).toMatchObject({ ok: false, why: "sports" });
    expect(lookAheadFor(YTV, ch("CBS"), "", "60 Minutes")).toMatchObject({ ok: true });
    for (const title of ["USA vs. Haiti", "Arsenal v Chelsea", "Toronto Maple Leafs at Chicago Blackhawks", "Duke at North Carolina"]) expect(lookAheadFor(YTV, ch("TBS"), "", title)).toMatchObject({ ok: false, why: "sports" });
    for (const title of ["Live at Five", "Breakfast at Tiffany's", "Night at the Museum", "Family Guy", "Law & Order: Special Victims Unit"]) expect(lookAheadFor(YTV, ch("TBS"), "", title)).toMatchObject({ ok: true });
  });

  it("a channel the guide does not know is judged by the window's own word for it", () => {
    expect(lookAheadFor(YTV, null, "ESPN2", "")).toMatchObject({ ok: false, why: "sports", channel: "ESPN2" });
    expect(lookAheadFor(YTV, null, "Food Network", "")).toMatchObject({ ok: true, channel: "Food Network" });
    expect(lookAheadFor(YTV, null, "", "")).toMatchObject({ ok: true });
  });
});
