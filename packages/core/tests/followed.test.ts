import { describe, expect, it } from "vitest";
import { followedRow, isChannelRow, latestRow } from "../src/followed.js";
import type { VideoItem } from "../src/types.js";

// Channels you follow (2026-10-12): Twitch's Followed channels and YouTube's Subscriptions as one row, live first.
describe("channels you follow, one row across services (followed.ts)", () => {
  const item = (id: string, title: string, kind: string, extra: Partial<VideoItem> = {}): VideoItem => ({ id, title, kind, url: null, artwork: null, subtitle: null, progress: null, ...extra });
  const twitch = { app: "twitch", name: "Twitch", facet: "tw-f", own: [
    { title: "Followed channels", items: [item("coshmack", "coshmack", "channel", { subtitle: "Offline · last: Just Chatting" }), item("hasanabi", "HasanAbi", "live", { subtitle: "Live · Just Chatting · 12K viewers", badge: "LIVE" })] },
    { title: "Latest videos from channels you follow", items: [item("1", "A stream", "video", { channel: "coshmack" })] },
  ] };
  const youtube = { app: "youtube", name: "YouTube", facet: "yt-f", own: [
    { title: "Subscriptions", items: [item("@tested", "Adam Savage’s Tested", "channel", { url: "https://www.youtube.com/@tested", subtitle: "7M subscribers" }), item("@nasa", "NASA", "channel", { url: "https://www.youtube.com/@nasa", subtitle: "12M subscribers" })] },
    { title: "Latest from your subscriptions", items: [item("v1", "Artemis launch", "video", { channel: "NASA", badge: "LIVE", subtitle: "NASA · live" }), item("v2", "One day build", "video", { channel: "Adam Savage’s Tested", subtitle: "Adam Savage’s Tested · 11:32 · 6h ago" })] },
  ] };

  it("a row of channels is told from a row of videos", () => {
    expect(isChannelRow(twitch.own[0]!)).toBe(true);
    expect(isChannelRow(twitch.own[1]!)).toBe(false);
    expect(isChannelRow({ items: [] })).toBe(false);
  });

  it("live first across services; a YouTube channel is live when its feed carries a LIVE video of its own; kinds stay the service's", () => {
    const row = followedRow([twitch, youtube]);
    expect(row.map((c) => c.app + ":" + c.item.id)).toEqual(["twitch:hasanabi", "youtube:@nasa", "twitch:coshmack", "youtube:@tested"]);
    const nasa = row.find((c) => c.item.id === "@nasa")!.item;
    expect(nasa.kind).toBe("channel");
    expect(nasa.badge).toBe("LIVE");
    expect(nasa.subtitle).toBe("Live · 12M subscribers");
    expect(row.find((c) => c.item.id === "@tested")!.item.badge).toBeUndefined();
    expect(row.every((c) => c.service.length > 0 && c.facet.length > 0)).toBe(true);
  });

  it("a service with no row of channels adds nothing", () => {
    expect(followedRow([{ app: "p", name: "P", facet: "p-f", own: [{ title: "Videos", items: [item("1", "V", "video")] }] }])).toEqual([]);
  });
});

describe("the latest videos from the channels you follow, one row across services (2026-10-13)", () => {
  it("takes every followed service's other own rows, live first, then newest by the date beside each, each card its service's", () => {
    const now = Date.UTC(2026, 9, 13, 18);
    const item = (id: string, title: string, subtitle: string, extra: Partial<VideoItem> = {}): VideoItem => ({ id, title, url: "https://x/" + id, kind: "video", subtitle, ...extra } as VideoItem);
    const chan = (id: string): VideoItem => ({ id, title: id, url: "https://x/" + id, kind: "channel" } as VideoItem);
    const twitch = { app: "twitch", name: "Twitch", facet: "t", own: [{ title: "Followed channels", items: [chan("a")] }, { title: "Latest videos", items: [item("t1", "Old stream", "a \u00b7 3 days ago"), item("t2", "On now", "a \u00b7 12 viewers", { kind: "live" })] }] };
    const youtube = { app: "youtube", name: "YouTube", facet: "y", own: [{ title: "Subscriptions", items: [chan("b")] }, { title: "Latest", items: [item("y1", "Fresh", "b \u00b7 10:00 \u00b7 2 hours ago"), item("y2", "Yesterday", "b \u00b7 8:00 \u00b7 1 day ago")] }] };
    const nochan = { app: "youtube-tv", name: "YouTube TV", facet: "v", own: [{ title: "Recordings", items: [item("r1", "Rec", "1 hour ago")] }] };
    const row = latestRow([twitch, youtube, nochan], now);
    expect(row.map((c) => c.app + ":" + c.item.id)).toEqual(["twitch:t2", "youtube:y1", "youtube:y2", "twitch:t1"]);   // live first, then newest; a service with no followed channels gives nothing
    expect(row.every((c) => c.service.length > 0)).toBe(true);
  });
});
