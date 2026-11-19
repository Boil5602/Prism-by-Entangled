import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * Covers of recents (2026-11-16): a recent with no cover, not in the service's library, has its cover asked for by the service's
 * own page (the adapter's musicCover route) and kept with the entry. Asked once; only the service's own site; never a signed-out
 * service or one whose adapter names no route.
 */
const album = "https://music.example/album/tall-grass/1";
const cover = "https://img.example/tall-grass.jpg";

function fake(answer: (js: string) => string | null, recents: Record<string, unknown[]>) {
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
  return { drivers, asked, kv, recents };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "one", url: "https://music.example/", adapter: "one", audio: "exclusive" },
    { id: "two", url: "https://radio.example/", adapter: "two", audio: "exclusive" },
  ],
};

async function wall(answer: (js: string) => string | null, entries: unknown[]) {
  const f = fake(answer, {});
  const o = new Orchestrator(f.drivers);
  o.setAdapters({ one: { id: "one", musicCover: "og" } as never, two: { id: "two" } as never });
  await o.load(doc, { w: 1000, h: 625 });
  // the recents as the store holds them, under whatever key core reads
  const seed = JSON.stringify(entries);
  const realGet = f.drivers.store!.get;
  f.drivers.store!.get = (key: string) => (/recent/.test(key) && !f.kv.has(key) ? seed : realGet(key));
  return { o, asked: f.asked, kv: f.kv };
}

describe("covers of recents", () => {
  it("asks the service's page once for a recent with no cover and keeps the answer with the entry", async () => {
    const { o, asked } = await wall((js) => (js.includes("fetch(") ? JSON.stringify("started") : JSON.stringify(cover)), [{ url: album, label: "Tall Grass", kind: "album", title: "Song", at: 5 }]);
    expect(await o.fillRecentCovers("one")).toBe(1);
    expect((await o.recentMusic("one"))[0]).toMatchObject({ url: album, artwork: cover });
    const asks = asked.filter((a) => a.js.includes("fetch(")).length;
    expect(asks).toBe(1);
    expect(await o.fillRecentCovers("one")).toBe(0);
    expect(asked.filter((a) => a.js.includes("fetch(")).length).toBe(1);
  }, 20000);

  it("reads an answer that comes as the value itself, not its JSON", async () => {
    const { o } = await wall((js) => (js.includes("fetch(") ? "started" : cover), [{ url: album, label: "Tall Grass", kind: "album", title: "Song", at: 5 }]);
    expect(await o.fillRecentCovers("one")).toBe(1);
    expect((await o.recentMusic("one"))[0]).toMatchObject({ artwork: cover });
  }, 20000);

  it("takes the square cover where the adapter names the last part, for a new answer and a kept one", async () => {
    const wide = "https://img.example/a/b/artwork.jpg/1200x630wp-60.jpg";
    const f = await wall((js) => (js.includes("fetch(") ? "started" : wide), [
      { url: album, label: "Tall Grass", kind: "album", title: "Song", at: 5 },
      { url: "https://music.example/album/paper-boats/2", label: "Paper Boats", kind: "album", title: "Song", artwork: wide, at: 4 },
      { url: "https://music.example/album/road-mix/3", label: "Road Mix", kind: "album", title: "Song", artwork: cover, at: 3 },
    ]);
    f.o.setAdapters({ one: { id: "one", musicCover: "og>last-segment=300x300bb.jpg" } as never, two: { id: "two" } as never });
    expect(await f.o.fillRecentCovers("one")).toBe(1);
    const square = "https://img.example/a/b/artwork.jpg/300x300bb.jpg";
    expect((await f.o.recentMusic("one")).map((e) => e.artwork)).toEqual([square, square, cover]);
  }, 20000);

  it("keeps nothing when the page has no cover, and does not ask again", async () => {
    const { o, asked } = await wall((js) => (js.includes("fetch(") ? JSON.stringify("started") : JSON.stringify("")), [{ url: album, label: "Tall Grass", kind: "album", title: "Song", at: 5 }]);
    expect(await o.fillRecentCovers("one")).toBe(0);
    expect((await o.recentMusic("one"))[0]!.artwork).toBeUndefined();
    expect(await o.fillRecentCovers("one")).toBe(0);
    expect(asked.filter((a) => a.js.includes("fetch(")).length).toBe(1);
  }, 20000);

  it("asks nothing for an entry that has a cover, another site's address, or a service with no route", async () => {
    const { o, asked } = await wall(() => JSON.stringify(cover), [
      { url: album, label: "Tall Grass", kind: "album", title: "Song", artwork: cover, at: 5 },
      { url: "https://elsewhere.example/album/x/2", label: "Other", kind: "album", title: "Song", at: 4 },
    ]);
    expect(await o.fillRecentCovers("one")).toBe(0);
    expect(await o.fillRecentCovers("two")).toBe(0);
    expect(asked).toHaveLength(0);
  });
});
