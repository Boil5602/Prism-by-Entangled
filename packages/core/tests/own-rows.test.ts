import { describe, expect, it } from "vitest";
import { cleanLibrary, mergeOwnRows } from "../src/video.js";

describe("a service's own rows (2026-10-05: Twitch's Followed channels and latest videos)", () => {
  it("reads own rows from a page's report, dropping empty ones", () => {
    const lib = cleanLibrary({ continue: [], list: [], own: [
      { title: "Followed channels", items: [{ id: "hasanabi", title: "HasanAbi", kind: "channel", url: "https://www.twitch.tv/hasanabi" }] },
      { title: "Empty", items: [] },
      { items: [{ id: "x", title: "no title row" }] },
    ] });
    expect(lib.own.map((r) => r.title)).toEqual(["Followed channels"]);
    expect(lib.own[0]!.items[0]).toMatchObject({ id: "hasanabi", kind: "channel" });
  });
  it("a report's rows replace the kept rows of the same title and leave the others", () => {
    const kept = [{ title: "Followed channels", items: [{ id: "a", title: "A", kind: "channel", url: null, artwork: null, subtitle: null, progress: null }] }, { title: "Latest videos", items: [{ id: "v1", title: "V1", kind: "video", url: null, artwork: null, subtitle: null, progress: null }] }];
    const now = [{ title: "Followed channels", items: [{ id: "b", title: "B", kind: "channel", url: null, artwork: null, subtitle: null, progress: null }] }];
    const merged = mergeOwnRows(kept, now);
    expect(merged.map((r) => r.title + ":" + r.items.map((i) => i.id).join(","))).toEqual(["Latest videos:v1", "Followed channels:b"]);
    expect(mergeOwnRows(kept, [])).toBe(kept);
  });
});
