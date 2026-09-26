import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { VideoController, cleanLibrary, isVideoAdapter } from "../src/video.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// VP-2 (2026-09-19): the video player's contract, shaped like the music one - a VIDEO adapter declares page scripts
// (videoContext / videoLibrary / videoPlay / videoCmd), the observer carries their words on the now-playing report,
// core keeps the face, the library and the resume point, and the wall's verbs reach the adapter's own player first.

function fakeDrivers() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", ...opts }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: (id, css, js) => void calls.push({ op: "inject", id, css, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {},
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    store: { get: (key) => kv.get(key) ?? null, set: (key, value) => void kv.set(key, value) },
  };
  return { drivers, calls, kv };
}
const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1", id: "night", name: "Night", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "nf", url: "https://www.netflix.com/browse", audio: "exclusive", adapter: "netflix" },
    { id: "yt", url: "https://www.youtube.com/", audio: "exclusive", adapter: "youtube" },
  ],
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const injects = (calls: Array<Record<string, unknown>>, fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));

describe("video - the adapter contract", () => {
  it("a video tile is one whose adapter declares a video script; the scripts are injected with the adapter's own", async () => {
    expect(isVideoAdapter({ id: "x", videoContext: "/*c*/" } as never)).toBe(true);
    expect(isVideoAdapter({ id: "x", controls: { play: ".p" } } as never)).toBe(false);
    expect(isVideoAdapter(undefined)).toBe(false);
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoContext: "/*NFCTX*/", videoLibrary: "/*NFLIB*/", videoPlay: "/*NFPLAY*/", videoCmd: "/*NFCMD*/" } as never, youtube: { id: "youtube", controls: { play: ".ytp-play-button" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "load-finished", id: "nf", ok: true });
    await tick();
    const js = injects(calls, "NFCTX");
    expect(js.length).toBeGreaterThan(0);
    expect(js[0]).toContain("NFLIB");
    expect(js[0]).toContain("NFCMD");
    expect(o.videoState().map((t) => t.id)).toEqual(["nf"]);   // YouTube declares no video script yet
    expect(o.videoState()[0]).toMatchObject({ adapter: "netflix", playing: false, video: null, can: { play: true, cmd: true, lookup: false } });
  });

  it("the observer's report fills the face, keeps the library and the resume point under video:* keys, and a fresh wall reads them back", async () => {
    const { drivers, kv } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoContext: "/*c*/", videoLibrary: "/*l*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    // the browse page, idle: the library on its own
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoLibrary: { continue: [{ id: "81", title: "Dark", kind: "series", url: "https://www.netflix.com/watch/81", progress: 0.4 }, { id: 0, title: "junk" }], list: [{ id: "70", title: "Heat", kind: "movie" }] } } } as never);
    await tick();
    const st = o.videoState()[0]!;
    expect(st.library.continue).toEqual([{ id: "81", title: "Dark", kind: "series", url: "https://www.netflix.com/watch/81", artwork: null, subtitle: null, progress: 0.4 }]);
    expect(st.library.list?.map((x) => x.title)).toEqual(["Heat"]);
    expect(kv.get("video:library:night:netflix")).toContain("Dark");
    // an episode plays: the face, the resume point
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, title: "", video: { kind: "episode", title: "Sic Mundus Creatus Est", series: "Dark", episode: 3, id: "81", url: "https://www.netflix.com/watch/81", playing: true, position: 120, duration: 2700 } } } as never);
    await tick();
    expect(o.videoState()[0]).toMatchObject({ playing: true, video: { series: "Dark", episode: 3, title: "Sic Mundus Creatus Est" }, resume: { kind: "episode", id: "81", title: "Sic Mundus Creatus Est", series: "Dark" } });
    expect(JSON.parse(kv.get("video:resume:night:netflix")!)).toMatchObject({ id: "81", series: "Dark" });
    // an ad in the stream is never the resume point
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, video: { kind: "ad", title: "Advert", id: "ad1", playing: true, ad: true } } } as never);
    await tick();
    expect(o.videoState()[0]!.resume).toMatchObject({ id: "81" });
    // a fresh wall on the same store reads the library and the resume point back
    const o2 = new Orchestrator(drivers);
    o2.setAdapters({ netflix: { id: "netflix", videoContext: "/*c*/" } as never });
    await o2.load(doc, { w: 1000, h: 625 });
    expect((await o2.videoLibrary("nf")).continue?.[0]?.title).toBe("Dark");
    await tick();
    expect(o2.videoState()[0]!.resume).toMatchObject({ id: "81", series: "Dark" });
  });

  it("Quick play goes through the adapter's videoPlay, arming the tile and taking the audio; without one, the wall goes to the title's page; the pick clears once the face names it", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoContext: "/*c*/", videoPlay: "/*p*/" } as never, youtube: { id: "youtube", videoContext: "/*c*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    calls.length = 0;
    expect(await o.videoPlay("nf", "series", "81", "https://www.netflix.com/watch/81", "Dark")).toBe("ok");
    expect(injects(calls, "__prismVideoPlay(\"series\", \"81\", \"https://www.netflix.com/watch/81\")").length).toBe(1);
    expect(o.videoState().find((t) => t.id === "nf")!.pending).toMatchObject({ id: "81", name: "Dark" });
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, video: { kind: "episode", title: "Secrets", series: "Dark", id: "81", playing: true } } } as never);
    await tick();
    expect(o.videoState().find((t) => t.id === "nf")!.pending).toBeNull();
    // a page that names nothing (Netflix's hidden chrome): the pick's name is the face, for the episode id the show resumed at
    await o.videoPlay("nf", "title", "81666277", "https://www.netflix.com/watch/81666277", "DANG!");
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, video: { kind: "movie", title: "", id: "81748889", url: "https://www.netflix.com/watch/81748889", playing: true, position: 67 } } } as never);
    await tick();
    expect(o.videoState().find((t) => t.id === "nf")!.video).toMatchObject({ title: "DANG!", id: "81748889" });
    expect(o.videoState().find((t) => t.id === "nf")!.resume).toMatchObject({ title: "DANG!", id: "81748889" });
    // the page's own word that it failed
    await o.videoPlay("nf", "movie", "70", null, "Heat");
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoPlayState: { kind: "movie", id: "70", status: "error:not-found" } } } as never);
    await tick();
    expect(o.videoState().find((t) => t.id === "nf")!.pending).toMatchObject({ id: "70", failed: "error:not-found" });
    // no videoPlay: the address
    calls.length = 0;
    expect(await o.videoPlay("yt", "video", "abc", "https://www.youtube.com/watch?v=abc")).toBe("ok");
    expect(calls.some((c) => c.op === "navigate" && c.id === "yt" && c.url === "https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(await o.videoPlay("yt", "video", "abc", null)).toBe("unavailable");
    expect(await o.videoPlay("nope", "video", "abc", null)).toBe("unknown-tile");
  });

  it("a service with no context script: the wall's own pick is the face once the page plays - the pending pick clears, the resume point and the recents follow (Hulu, 2026-09-19)", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoLibrary: "/*l*/" } as never });   // rows only, no videoContext
    await o.load(doc, { w: 1000, h: 625 });
    expect(await o.videoPlay("nf", "title", "e0dc", "https://www.netflix.com/watch/e0dc", "What We Do in the Shadows")).toBe("ok");
    // a play somewhere else on the service (a home page's promo) is not the pick: no face, no resume point (2026-09-20)
    await o.onSurfaceEvent({ type: "navigated", id: "nf", url: "https://www.netflix.com/browse" } as never);
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, title: "" } } as never);
    await tick();
    expect(o.videoState().find((t) => t.id === "nf")!.video).toBeNull();
    // on the pick's own page, the pick is the face
    await o.onSurfaceEvent({ type: "navigated", id: "nf", url: "https://www.netflix.com/watch/e0dc" } as never);
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, title: "" } } as never);
    await tick();
    const st = o.videoState().find((t) => t.id === "nf")!;
    expect(st.pending).toBeNull();
    expect(st.video).toMatchObject({ title: "What We Do in the Shadows", id: "e0dc", playing: true });
    expect(st.resume).toMatchObject({ title: "What We Do in the Shadows", id: "e0dc" });
    // and a play the wall did not ask for stays unnamed: no invention
    const o2 = new Orchestrator(drivers);
    o2.setAdapters({ netflix: { id: "netflix", videoLibrary: "/*l*/" } as never });
    await o2.load(doc, { w: 1000, h: 625 });
    await o2.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, title: "" } } as never);
    await tick();
    expect(o2.videoState().find((t) => t.id === "nf")!.video).toBeNull();
  });

  it("the wall's verbs reach the adapter's own player first (videoCmd), and the video-only verbs go nowhere else", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoContext: "/*c*/", videoCmd: "/*cmd*/" } as never, youtube: { id: "youtube", controls: { play: ".ytp-play-button" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    calls.length = 0;
    expect(await o.tileCommand("nf", "seekforward")).toBe("ok");
    expect(injects(calls, "__prismVideoCmd(\"seekforward\")").length).toBe(1);
    expect(await o.tileCommand("nf", "skipintro")).toBe("ok");
    expect(injects(calls, "__prismVideoCmd(\"skipintro\")").length).toBe(1);
    expect(await o.tileCommand("nf", "nextepisode")).toBe("ok");
    expect(await o.tileCommand("nf", "captions")).toBe("ok");
    expect(await o.tileCommand("yt", "skipintro")).toBe("unavailable");   // no video script: nothing to press
    expect(await o.tileCommand("yt", "nextepisode")).toBe("unavailable");
    expect(await o.tileCommand("nope", "skipintro")).toBe("unknown-tile");
  });

  it("no seek while the page says an ad is running: a stitched break is covered, never skipped (B-263)", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoContext: "/*c*/", videoCmd: "/*cmd*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, video: { kind: "episode", title: "Secrets", series: "Dark", id: "81", playing: true, ad: true } } } as never);
    await tick();
    calls.length = 0;
    expect(await o.tileCommand("nf", "seekforward")).toBe("unavailable");
    expect(await o.tileCommand("nf", "seekbackward")).toBe("unavailable");
    expect(injects(calls, "__prismVideoCmd").length).toBe(0);
    expect(await o.tileCommand("nf", "pause")).toBe("ok");   // the transport's other verbs are untouched
    // the content is back: the seeks are too
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: true, video: { kind: "episode", title: "Secrets", series: "Dark", id: "81", playing: true, ad: false } } } as never);
    await tick();
    expect(await o.tileCommand("nf", "seekforward")).toBe("ok");
  });

  it("the owned library grows on a partial read and forgets a title absent from two COMPLETE passes in a row (2026-09-22)", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", videoContext: "/*c*/", videoLibrary: "/*l*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    const items = (n: number, skip: string[] = []) => Array.from({ length: n }, (_, i) => ({ id: "o" + i, title: "Title " + i, kind: "movie" })).filter((x) => !skip.includes(x.id));
    const owned = () => (o.videoState()[0]!.library.owned ?? []).map((x) => x.id);
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoLibrary: { owned: items(60) } } } as never);
    await tick();
    expect(owned().length).toBe(60);
    // a partial read of half: nothing forgotten
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoLibrary: { owned: items(30) } } } as never);
    await tick();
    expect(owned().length).toBe(60);
    // one complete pass without o5: still there (a row that rendered late is not a deletion)
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoLibrary: { owned: items(60, ["o5"]), ownedComplete: true } } } as never);
    await tick();
    expect(owned()).toContain("o5");
    // the second complete pass without it: gone; a title seen again in between is kept
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoLibrary: { owned: items(60, ["o5", "o7"]), ownedComplete: true } } } as never);
    await tick();
    expect(owned()).not.toContain("o5");
    expect(owned()).toContain("o7");
    await o.onSurfaceEvent({ type: "now-playing", id: "nf", info: { playing: false, videoLibrary: { owned: items(60, ["o5"]), ownedComplete: true } } } as never);
    await tick();
    expect(owned()).toContain("o7");   // seen again: its count reset
    expect(owned().length).toBe(59);
  });

  it("a tile whose App names no adapter binds the one that claims its host (the Netflix App added by address, 2026-09-19)", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ netflix: { id: "netflix", match: ["www.netflix.com"], videoContext: "/*NFCTX*/" } as never, hulu: { id: "hulu", match: ["hulu.com"], videoContext: "/*HULU*/" } as never });
    await o.load({ ...doc, tiles: [{ id: "screen", url: "https://www.netflix.com/latest", audio: "exclusive" }, { id: "h", url: "https://www.hulu.com/hub/home", audio: "exclusive" }, { id: "other", url: "https://example.com/", audio: "mute" }] }, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "load-finished", id: "screen", ok: true });
    await tick();
    expect(injects(calls, "NFCTX").length).toBe(1);
    expect(o.videoState().map((t) => [t.id, t.adapter])).toEqual([["screen", "netflix"], ["h", "hulu"]]);   // a parent-domain match binds too
  });

  it("cleanLibrary keeps only well-formed items and fills the optional fields", () => {
    expect(cleanLibrary(null)).toEqual({ continue: [], list: [], shelves: [], owned: [], ownedComplete: false, continueOnly: false });
    expect(cleanLibrary({ continue: [{ id: "1", title: "A" }, { id: 2, title: "B" }, "x"], list: "no", shelves: [{ title: "Top picks", items: [{ id: "9", title: "Z" }] }, { title: "Empty", items: [] }, "bad"] })).toEqual({ continue: [{ id: "1", title: "A", kind: "video", url: null, artwork: null, subtitle: null, progress: null }], list: [], shelves: [{ title: "Top picks", items: [{ id: "9", title: "Z", kind: "video", url: null, artwork: null, subtitle: null, progress: null }] }], owned: [], ownedComplete: false, continueOnly: false });
  });

  it("the controller ignores tiles that are not video tiles", () => {
    const v = new VideoController({ adapterOf: () => undefined, adapterIdOf: () => null, tileExists: () => true, inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined, arm: () => {}, claimAudio: async () => {} });
    v.onObservation("x", { playing: true, video: { title: "T" } } as never);
    expect(v.state(["x"])).toEqual([]);
  });
});

describe("the service's own card banner (2026-09-23)", () => {
  it("cleanLibrary keeps a badge in the service's words, whitespace folded, and adds nothing when there is none", () => {
    const lib = cleanLibrary({ list: [{ id: "1", title: "Paradise", kind: "series", badge: "  New\n Season " }, { id: "2", title: "Beef", kind: "series", badge: "" }, { id: "3", title: "Dark", kind: "series" }] });
    expect(lib.list[0].badge).toBe("New Season");
    expect("badge" in lib.list[1]).toBe(false);
    expect("badge" in lib.list[2]).toBe(false);
  });
});
