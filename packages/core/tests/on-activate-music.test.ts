import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * onActivate "play" on a hidden music placement (2026-09-16): only the source the scene draws may start itself, and only
 * once per document - a re-apply of the same document (B-124's recycle) does not play it again. Before this, Apple's
 * placement resumed Vibes on every boot while the stage showed Spotify, armed as a human's play, took the audio and the
 * stage followed it.
 */
function fakeDrivers() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", ...opts }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: (id, rect) => void calls.push({ op: "setRect", id, rect }),
      setOpacity: (id, opacity) => void calls.push({ op: "setOpacity", id, opacity }),
      setZ: (id, z) => void calls.push({ op: "setZ", id, z }),
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: (id, css, js) => void calls.push({ op: "inject", id, css, js }),
      freeze: (id) => void calls.push({ op: "freeze", id }),
      reveal: (id, ms) => void calls.push({ op: "reveal", id, ms }),
      suspend: (id) => void calls.push({ op: "suspend", id }),
      resume: (id) => void calls.push({ op: "resume", id }),
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    store: { get: (key) => kv.get(key) ?? null, set: (key, value) => void kv.set(key, value) },
  };
  return { drivers, calls, kv };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "sp", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true }, onActivate: "play" },
    { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true }, onActivate: "play" },
  ],
};

describe("onActivate play on hidden music placements", () => {
  it("starts only the stage's source, and only once per document - not on a recycle of the same document", async () => {
    const { drivers, calls, kv } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    // both services remember what they last played (B-204 resume points)
    kv.set("music:resume:lounge:am", JSON.stringify({ url: "https://music.apple.com/us/library/playlist/p.vibes", title: "The Feels", artist: "Labrinth", label: "Vibes", kind: "playlist", id: "p.vibes", at: 1 }));
    kv.set("music:resume:lounge:sp", JSON.stringify({ url: "https://open.spotify.com/album/3Aieu", title: "Track", artist: "Band", label: "An Album", kind: "album", at: 1 }));
    const o = new Orchestrator(drivers);
    o.setAdapters({
      "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/" } as never,
      spotify: { id: "spotify", controls: { play: ".play", playPage: ".page-play" } } as never,
    });
    await o.load(doc, { w: 1000, h: 625 });

    // Apple's page settles: its placement says play, but the stage shows Spotify - nothing starts, nothing is armed
    calls.length = 0;
    await o.onSurfaceEvent({ type: "load-finished", id: "am", ok: true });
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicPlay"))).toBe(false);
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === false)).toBe(false);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toBeUndefined();

    // Spotify's page settles: the stage's own source may resume what it remembers (by address, it has no player API)
    calls.length = 0;
    await o.onSurfaceEvent({ type: "load-finished", id: "sp", ok: true });
    expect(calls.some((c) => c.op === "navigate" && c.id === "sp" && c.url === "https://open.spotify.com/album/3Aieu")).toBe(true);
    // ... and when that page settles, the press is the page's OWN Play for the collection (playPage), not the transport toggle
    calls.length = 0;
    await o.onSurfaceEvent({ type: "load-finished", id: "sp", ok: true });
    const press = calls.filter((c) => c.op === "inject" && c.id === "sp").map((c) => String(c.js)).join("\n");
    expect(press).toContain(".page-play");

    // the same document re-applied (a B-124 recycle) does not play it again
    await o.recycleAppSurfaces("sp");
    calls.length = 0;
    await o.onSurfaceEvent({ type: "load-finished", id: "sp", ok: true });
    // (the FIRST activation's resume is still in flight - its pending Play press may land on the recycled page; that is
    // the same resume, not a second one - so the check is that no new resume was started: no navigate to the album again)
    expect(calls.some((c) => c.op === "navigate" && c.id === "sp")).toBe(false);
  });
});
