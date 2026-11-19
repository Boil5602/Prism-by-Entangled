import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * Lyrics (2026-11-15): the adapter's musicLyrics route opens and closes the page's own lyrics; core keeps whether they are on for
 * the service and says when a service has no such route. The lines themselves are read by the shell on the page and never kept.
 */
function fakeDrivers(answer: (js: string) => string | null) {
  const asked: Array<{ id: string; js: string }> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
      evaluate: async (id: string, js: string) => { asked.push({ id, js }); return answer(js); },
    } as Drivers["surface"],
    store: { get: (key) => kv.get(key) ?? null, set: (key, value) => void kv.set(key, value) },
  };
  return { drivers, asked };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive" },
    { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive" },
  ],
};

async function wall(answer: (js: string) => string | null) {
  const f = fakeDrivers(answer);
  const o = new Orchestrator(f.drivers);
  o.setAdapters({
    "apple-music": { id: "apple-music", musicLyrics: "/*lyrics*/" } as never,
    spotify: { id: "spotify" } as never,
  });
  await o.load(doc, { w: 1000, h: 625 });
  return { o, asked: f.asked };
}

describe("music lyrics", () => {
  it("opens the page's lyrics by the adapter's route and remembers they are on", async () => {
    const { o, asked } = await wall((js) => (js.includes('"open"') ? JSON.stringify(JSON.stringify({ ok: true, open: true })) : JSON.stringify(JSON.stringify({ ok: true, open: false }))));
    expect(o.musicLyricsState("am")).toMatchObject({ status: "off", can: true });
    await o.musicLyrics("am", true);
    expect(asked.filter((a) => a.id === "am" && a.js.includes("__prismMusicLyrics")).length).toBe(1);
    expect(o.musicLyricsState("am")).toMatchObject({ status: "on", can: true });
    await o.musicLyrics("am", false);
    expect(asked[asked.length - 1]!.js).toContain('"close"');
    expect(o.musicLyricsState("am")).toMatchObject({ status: "off", can: true });
  });

  it("says so when the service has no lyrics route, and asks its page nothing", async () => {
    const { o, asked } = await wall(() => null);
    expect(o.musicLyricsState("sp")).toMatchObject({ status: "unavailable", can: false });
    await o.musicLyrics("sp", true);
    expect(asked.filter((a) => a.js.includes("__prismMusicLyrics")).length).toBe(0);
    expect(o.musicLyricsState("sp").reason).toMatch(/does not show its lyrics/);
  });

  it("reports a page that does not answer, or has no lyrics to open, as an error with its reason", async () => {
    const silent = await wall(() => null);
    await silent.o.musicLyrics("am", true);
    expect(silent.o.musicLyricsState("am")).toMatchObject({ status: "error", reason: "the page did not answer" });
    const none = await wall(() => JSON.stringify(JSON.stringify({ ok: false })));
    await none.o.musicLyrics("am", true);
    expect(none.o.musicLyricsState("am").status).toBe("error");
  });
});
