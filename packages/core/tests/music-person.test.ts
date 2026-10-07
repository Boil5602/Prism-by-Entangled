import { describe, it, expect } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * A music tile's own records - resume point, recents, library - belong to the person signed in (2026-09-30, sign-ins for both
 * players: "a music tile's resume point is kept a tile, not a sign-in"). The tile's profile IS the sign-in: the same tile in another
 * profile starts with nothing of the first person's, and the first person's records are there again when their profile is back.
 * A record from before sign-ins is claimed once, for the sign-in in use when it is first read. Nothing is deleted.
 */
function rig() {
  const kv = new Map<string, string>();
  const drivers = {
    surface: { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, createVisualization: () => {} },
    store: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => void kv.set(k, v) },
  } as unknown as Drivers;
  return { kv, drivers };
}
const lounge = (profile: string): DashboardDocument => ({
  schema: "frame.dashboard/v0.1", id: "lounge", name: "Lounge",
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true }, profile },
  ],
});
const play = async (o: Orchestrator, url: string, title: string, album: string) => {
  await o.onSurfaceEvent({ type: "navigated", id: "am", url });
  await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title, artist: "Daft Punk", album } });
  await new Promise<void>((r) => setTimeout(r, 0));
};

describe("a music tile's records are the person's", () => {
  it("another sign-in on the same tile starts clean; the first person's records come back with their profile; a record from before is claimed by the first reader", async () => {
    const { kv, drivers } = rig();
    // from before sign-ins: a resume point and recents keyed by the tile alone
    kv.set("music:resume:lounge:am", JSON.stringify({ url: "https://music.apple.com/us/album/old/1", title: "Old Song", album: "Old Album", at: 1 }));
    kv.set("music:recent:lounge:am", JSON.stringify([{ url: "https://music.apple.com/us/album/old/1", label: "Old Album", kind: "album" }]));
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never });
    // the household's sign-in: the records from before are its, claimed at the load - all of them, read or not
    await o.load(lounge("account-apple"), { w: 1000, h: 625 });
    expect(kv.get("music:recent:lounge:am:claimed")).toBe("account-apple");
    expect(kv.get("music:recent:lounge:am:account-apple")).toContain("Old Album");
    expect((await o.resumePoint("am"))?.title).toBe("Old Song");
    expect((await o.recentMusic("am")).map((r) => r.label)).toEqual(["Old Album"]);
    await play(o, "https://music.apple.com/us/album/discovery/697194953", "One More Time", "Discovery");
    expect((await o.resumePoint("am"))?.title).toBe("One More Time");
    expect((await o.recentMusic("am")).map((r) => r.label)).toEqual(["Discovery", "Old Album"]);
    expect(kv.get("music:resume:lounge:am")).toContain("Old Song");                    // nothing deleted
    // a second person's sign-in on the same tile: nothing of the first person's, not the record from before either
    await o.load(lounge("account-apple-maya"), { w: 1000, h: 625 });
    expect(await o.resumePoint("am")).toBeNull();
    expect(await o.recentMusic("am")).toEqual([]);
    await play(o, "https://music.apple.com/us/album/folklore/1", "cardigan", "folklore");
    expect((await o.resumePoint("am"))?.title).toBe("cardigan");
    expect((await o.recentMusic("am")).map((r) => r.label)).toEqual(["folklore"]);
    // the first person's profile again: their own records, untouched by the second's
    await o.load(lounge("account-apple"), { w: 1000, h: 625 });
    expect((await o.resumePoint("am"))?.title).toBe("One More Time");
    expect((await o.recentMusic("am")).map((r) => r.label)).toEqual(["Discovery", "Old Album"]);
    // and the second's are still theirs
    await o.load(lounge("account-apple-maya"), { w: 1000, h: 625 });
    expect((await o.resumePoint("am"))?.title).toBe("cardigan");
  });
});
