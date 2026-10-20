import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * The return from a song search's page (musicLookupReturnLater, 2026-09-28): three minutes after a search the music window goes back
 * where it was. 2026-10-19 ("I paused the music player but then i think it unpaused without my input"): Pandora, paused by hand, was
 * sent back through its station page by that return and the page played again on load. The return now leaves alone a window holding
 * a track (paused is held too), a pick on its way, and a page a person pressed on since the search.
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
  (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
  return { drivers, calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "sp", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "pd", url: "https://www.pandora.com/", adapter: "pandora", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ],
};

const tokenOf = (calls: Array<Record<string, unknown>>, fn: string): string => {
  const js = String(calls.filter((c) => c.op === "inject" && typeof c.js === "string" && String(c.js).includes(fn)).pop()?.js ?? "");
  return new RegExp(fn + '[(]"([^"]+)"').exec(js)?.[1] ?? "";
};

/** A search on Pandora's window while Spotify plays, the page answering; `after` is what happens on the window before the return is due. */
async function searched(after: (o: Orchestrator) => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const { drivers, calls } = fakeDrivers();
  const o = new Orchestrator(drivers);
  o.setAdapters({ pandora: { id: "pandora", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
  await o.load(doc, { w: 1000, h: 625 });
  await o.onSurfaceEvent({ type: "navigated", id: "pd", url: "https://www.pandora.com/station/play/4712968215082380737" });
  await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Hallucinate", artist: "Dua Lipa", album: "Future Nostalgia" } });
  calls.length = 0;
  const pending = o.musicLookup("pd");
  await vi.advanceTimersByTimeAsync(0);
  const token = tokenOf(calls, "__prismMusicLookup");
  expect(token).not.toBe("");
  await o.onSurfaceEvent({ type: "music-result", id: "pd", token, op: "lookup", ok: true, candidates: [{ id: "pandora:hallucinate|dua-lipa", title: "Hallucinate", artist: "Dua Lipa" }] });
  expect(await pending).toBe("found");
  await o.onSurfaceEvent({ type: "navigated", id: "pd", url: "https://www.pandora.com/search/hallucinate%20dua%20lipa/all" });
  await after(o);
  calls.length = 0;
  await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_LOOKUP_RETURN_MS + 1000);
  return calls;
}
const returned = (calls: Array<Record<string, unknown>>) => calls.filter((c) => c.op === "navigate" && c.id === "pd").map((c) => c.url);

describe("the return from a search page", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("goes back where the window was when nothing happened there since", async () => {
    expect(returned(await searched(async () => undefined))).toEqual(["https://www.pandora.com/station/play/4712968215082380737"]);
  });

  it("leaves a window holding a paused track alone", async () => {
    const calls = await searched(async (o) => {
      await o.onSurfaceEvent({ type: "now-playing", id: "pd", info: { playing: true, title: "Hallucinate", artist: "Dua Lipa", album: "" } });
      await o.onSurfaceEvent({ type: "now-playing", id: "pd", info: { playing: false, title: "Hallucinate", artist: "Dua Lipa", album: "" } });
    });
    expect(returned(calls)).toEqual([]);
  });

  it("leaves a page a person pressed on since the search alone", async () => {
    const calls = await searched(async (o) => { await o.onSurfaceEvent({ type: "interaction", id: "pd" }); });
    expect(returned(calls)).toEqual([]);
  });
});
