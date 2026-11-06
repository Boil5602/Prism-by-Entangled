import { describe, it, expect } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * A single song played with no collection behind it must not rename the collection whose page is still up (2026-11-04): Apple Music's page reports a
 * lone song's context as label "song" with no kind, the page address was still the Vibes playlist's, and core wrote that word over the
 * playlist's name in Recents. A context without a kind names no collection: its label is not taken, and a Recent entry matched by
 * address keeps its name. An entry already labelled with a bare kind word heals on read from the collection's own name when the
 * page says it again.
 */
function rig() {
  const kv = new Map<string, string>();
  const drivers = {
    surface: { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {} },
    store: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => void kv.set(k, v) },
  } as unknown as Drivers;
  return { kv, drivers };
}
const lounge: DashboardDocument = {
  schema: "frame.dashboard/v0.1", id: "lounge", name: "Lounge",
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ],
};
const VIBES = "https://music.apple.com/us/library/playlist/p.qQXL3qzcdqDNY2";
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("a lone song never renames the collection on the page (Recents)", () => {
  it("the playlist keeps its name when a single song plays over its page", async () => {
    const { drivers } = rig();
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never });
    await o.load(lounge, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: VIBES });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Real Peach", artist: "Henry Jamison", album: "The Wilds", context: { kind: "playlist", label: "Vibes", id: "p.qQXL3qzcdqDNY2", url: VIBES } } });
    await tick();
    expect((await o.recentMusic("am")).map((r) => [r.kind, r.label])).toEqual([["playlist", "Vibes"]]);
    // the search plays one song by id: the page stays on the playlist's address and says "song", no kind, no address
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Hyperactive", artist: "Forrest Day", album: "Forrest Day", context: { kind: null, label: "song", id: "1839397339", url: null } } });
    await tick();
    const after = await o.recentMusic("am");
    expect(after.map((r) => [r.kind, r.label])).toEqual([["playlist", "Vibes"]]);
    expect(after[0]?.title).toBe("Hyperactive");   // the spot moves on; the name does not
    expect((await o.resumePoint("am"))?.label).not.toBe("song");   // the resume point names no collection for a lone song, never the bare word
  });
  it("an entry already labelled with the bare word heals when the collection names itself again", async () => {
    const { kv, drivers } = rig();
    kv.set("music:recent:lounge:am", JSON.stringify([{ url: VIBES, label: "song", kind: "playlist", id: "p.qQXL3qzcdqDNY2", title: "Hyperactive", artist: "Forrest Day", at: 1 }]));
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never });
    await o.load(lounge, { w: 1000, h: 625 });
    expect((await o.recentMusic("am")).map((r) => r.label)).toEqual(["Playlist"]);   // read: a bare kind word shows as the kind, capitalised, until the name is known
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: VIBES });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Real Peach", artist: "Henry Jamison", context: { kind: "playlist", label: "Vibes", id: "p.qQXL3qzcdqDNY2", url: VIBES } } });
    await tick();
    expect((await o.recentMusic("am")).map((r) => r.label)).toEqual(["Vibes"]);
  });
});
