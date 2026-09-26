import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BACKGROUND, HUMAN_INTENT_MS, Orchestrator } from "../src/orchestrator.js";
import { createRuntime } from "../src/runtime.js";
import { insetRects, layoutDashboard } from "../src/layout.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/** Fake driver seam that records every call. */
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
    store: {
      get: (key) => kv.get(key) ?? null,
      set: (key, value) => void kv.set(key, value),
    },
  };
  return { drivers, calls, kv };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "kitchen",
  name: "Kitchen",
  theme: { background: "#101318" },
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "yt", url: "https://www.youtube.com", aspectHint: "16:9", aspectWeight: 1.0, audio: "exclusive" },
    { id: "calendar", url: "https://example.com/cal", aspectHint: "3:4", aspectWeight: 0.6, audio: "mute", profile: "family" },
    { id: "radio", url: "https://example.com/radio", aspectHint: "4:3", aspectWeight: 0.2, audio: "exclusive" },
  ],
};

const VIEWPORT = { w: 1000, h: 625 };

describe("quick play: the last five collections a music tile played from", () => {
  it("remembers collection pages only, one entry each, newest first, five at most; playRecent goes there and presses Play", async () => {
    const { collectionKind, collectionSlug } = await import("../src/orchestrator.js");
    expect(collectionKind("https://music.apple.com/us/album/discovery/697194953")).toBe("album");
    expect(collectionKind("https://music.apple.com/us/playlist/todays-hits/pl.f4d1")).toBe("playlist");
    expect(collectionKind("https://music.apple.com/us/station/pure-focus/ra.985")).toBe("station");
    expect(collectionKind("https://music.apple.com/us/home")).toBeNull();
    expect(collectionSlug("https://music.apple.com/us/playlist/todays-hits/pl.f4d1")).toBe("Todays hits");
    expect(collectionSlug("https://music.apple.com/us/album/697194953")).toBeNull();
    expect(collectionSlug("https://www.pandora.com/station/play/4712968215082380737")).toBeNull();   // a verb, not a name (2026-09-07)
    // B-124: a library collection lives under /library/; a catalog one is left alone
    const { normalizeCollectionUrl } = await import("../src/orchestrator.js");
    expect(normalizeCollectionUrl("https://music.apple.com/us/playlist/p.O1kzPZ1Crxa8Pl")).toBe("https://music.apple.com/us/library/playlist/p.O1kzPZ1Crxa8Pl");
    expect(normalizeCollectionUrl("https://music.apple.com/us/album/l.abc123")).toBe("https://music.apple.com/us/library/album/l.abc123");
    expect(normalizeCollectionUrl("https://music.apple.com/us/playlist/todays-hits/pl.f4d1")).toBe("https://music.apple.com/us/playlist/todays-hits/pl.f4d1");
    expect(normalizeCollectionUrl("https://music.apple.com/us/library/playlist/p.1")).toBe("https://music.apple.com/us/library/playlist/p.1");
    // B-125: the service's id read back from an address, for entries recorded before ids travelled
    const { collectionIdFromUrl } = await import("../src/orchestrator.js");
    expect(collectionIdFromUrl("https://music.apple.com/us/station/mark-graffs-station/ra.u-1da9c0216baa")).toEqual({ kind: "station", id: "ra.u-1da9c0216baa" });
    expect(collectionIdFromUrl("https://music.apple.com/us/station/ra.985")).toEqual({ kind: "station", id: "ra.985" });
    expect(collectionIdFromUrl("https://music.apple.com/us/playlist/todays-hits/pl.f4d1")).toEqual({ kind: "playlist", id: "pl.f4d1" });
    expect(collectionIdFromUrl("https://music.apple.com/us/library/playlist/p.O1kz")).toEqual({ kind: "playlist", id: "p.O1kz" });
    expect(collectionIdFromUrl("https://music.apple.com/us/album/discovery/697194953")).toEqual({ kind: "album", id: "697194953" });
    expect(collectionIdFromUrl("https://music.apple.com/us/home")).toBeNull();
    expect(collectionIdFromUrl("https://open.spotify.com/playlist/abc")).toBeNull();
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as any).createVisualization = (opts: any) => void calls.push({ op: "createVisualization", ...opts });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never });
    await o.load({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
      { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] }, VIEWPORT);
    const play = async (url: string, title: string, album?: string) => {
      await o.onSurfaceEvent({ type: "navigated", id: "am", url });
      await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title, artist: "Daft Punk", ...(album ? { album } : {}) } });
    };
    await play("https://music.apple.com/us/home", "One More Time", "Discovery");            // home is not a collection
    expect(await o.recentMusic("am")).toEqual([]);
    for (let i = 1; i <= 6; i++) await play(`https://music.apple.com/us/album/a${i}/${i}`, "Track", "Album " + i);
    await play("https://music.apple.com/us/playlist/todays-hits/pl.1", "Song", "Some Album");
    await play("https://music.apple.com/us/album/a6/6", "Track 2", "Album 6");           // again: moves to the front, no duplicate
    // a station started from Home never navigates: the PAGE says what is playing (the adapter's probe), and that wins
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: "https://music.apple.com/us/home" });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "deja vu", artist: "Olivia Rodrigo", context: { url: "https://music.apple.com/us/station/ra.u-1", label: "Alex's Station", kind: "station" } } });
    expect((await o.recentMusic("am"))[0]).toMatchObject({ label: "Alex's Station", kind: "station", url: "https://music.apple.com/us/station/ra.u-1" });
    expect((await o.resumePoint("am"))?.url).toBe("https://music.apple.com/us/station/ra.u-1");
    await play("https://music.apple.com/us/album/a6/6", "Track 2", "Album 6");
    const recent = await o.recentMusic("am");
    expect(recent.map((r) => r.label)).toEqual(["Album 6", "Alex's Station", "Todays hits", "Album 5", "Album 4"]);
    expect(recent[2]).toMatchObject({ kind: "playlist", artist: "Daft Punk" });
    // the library the page reported: kept, listable, playable by id only when listed
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play", next: ".next" }, musicPlay: "window.__prismMusicPlay=function(){}", musicCmd: "window.__prismMusicCmd=function(){}" } as never });
    // B-127: the transport asks the service's own player first; the declared control is the fallback in the same script
    calls.length = 0;
    expect(await o.tileCommand("am", "next")).toBe("ok");
    const nextJs = String(calls.find((c) => c.op === "inject" && c.id === "am")?.js);
    expect(nextJs).toContain('__prismMusicCmd("next")');
    expect(nextJs).toContain('".next"');
    calls.length = 0;
    expect(await o.tileCommand("am", "prev")).toBe("ok");   // no declared prev: the player, then the media fallback
    expect(String(calls.find((c) => c.op === "inject" && c.id === "am")?.js)).toContain('__prismMusicCmd("prev")');
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, library: { playlists: [{ id: "p.1", name: "Dinner", kind: "playlist" }], stations: [{ id: "ra.u-1", name: "Alex's Station", kind: "station" }] } } });
    expect((await o.musicLibrary("am")).stations[0]).toMatchObject({ name: "Alex's Station" });
    expect(o.musicState().sources.am?.state ?? "gone").toBe("gone");   // a library-only report while idle paints no face
    calls.length = 0;
    expect(await o.playCollection("am", "station", "ra.u-1")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicPlay(\"station\", \"ra.u-1\")"))).toBe(true);
    expect(await o.playCollection("am", "station", "ra.evil")).toBe("unknown");
    calls.length = 0;
    expect(await o.playRecent("am", "https://music.apple.com/us/album/a4/4")).toBe("ok");
    // B-125: an Apple Music address carries its id, so even this older entry plays by id - no navigation
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicPlay(\"album\", \"4\")"))).toBe(true);
    expect(calls.find((c) => c.op === "navigate" && c.id === "am")).toBeUndefined();
    expect(await o.playRecent("am", "https://evil.example/")).toBe("unknown");          // never an arbitrary page
    // the loading signal: the pick is pending until the page reports that collection playing
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toMatchObject({ kind: "album", name: "Album 4" });   // the latest pick (playRecent) is the pending one
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Clearly", context: { url: "https://music.apple.com/us/album/a4/4", label: "Album 4", kind: "album" } } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toBeUndefined();
    // the page's own word that the play failed marks the pick failed (the wall says "couldn't start", not nothing)
    expect(await o.playCollection("am", "playlist", "p.1")).toBe("ok");
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "Clearly", playState: { kind: "playlist", id: "p.1", status: "error:CONTENT_UNAVAILABLE" } } });   // paused: nothing new is remembered
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toMatchObject({ name: "Dinner", failed: "error:CONTENT_UNAVAILABLE" });
    // B-123: no MusicKit instance means the page is signed out - the wall says "sign in", and the watch's word is kept per tile
    expect(await o.playCollection("am", "playlist", "p.1")).toBe("ok");
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", playState: { kind: "playlist", id: "p.1", status: "error:no-musickit" } } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending?.failed).toBe("needs-signin");
    (o as unknown as { bootAt: number }).bootAt = 0;   // past the boot window: the watch's word is believed as is
    await o.onSurfaceEvent({ type: "session", id: "am", state: "signed-out" });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.session).toBe("signed-out");
    // B-124: a recent entry with the service's id plays by id through musicPlay - no navigation, no address to get wrong
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Hurtless", artist: "Dean Lewis", context: { url: "https://music.apple.com/us/playlist/p.9", label: "Vibes", kind: "playlist", id: "p.9" } } });
    const healed = await o.recentMusic("am");
    expect(healed[0]).toMatchObject({ url: "https://music.apple.com/us/library/playlist/p.9", id: "p.9", label: "Vibes" });
    // B-140: the page holds Vibes and plays it - a pick of it carries on: nothing re-queued, nothing loading
    calls.length = 0;
    expect(await o.playRecent("am", healed[0]!.url)).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicPlay"))).toBe(false);
    expect(calls.some((c) => c.op === "navigate" && c.id === "am")).toBe(false);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toBeUndefined();
    // the page has moved on to an album: the pick queues Vibes by id
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Nine", context: { url: "https://music.apple.com/us/album/a9/9", label: "Album 9", kind: "album", id: "9" } } });
    calls.length = 0;
    expect(await o.playRecent("am", healed[0]!.url)).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicPlay(\"playlist\", \"p.9\")"))).toBe(true);
    expect(calls.some((c) => c.op === "navigate" && c.id === "am")).toBe(false);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toMatchObject({ name: "Vibes", id: "p.9" });
    // B-126: the playback a pick starts is a human's - the tile takes the audio and is NOT paused as autoplay, even under the boot hold
    (o as unknown as { bootPaused: Set<string> }).bootPaused.add("am");
    calls.length = 0;
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    expect(o.getState()?.audioOwner).toBe("am");
    expect(calls.some((c) => c.op === "inject" && /pause/i.test(String(c.js)))).toBe(false);
    // B-125: an older entry without an id plays by the id in its address - no navigation, so no "leave site?" prompt
    const older = (await o.recentMusic("am")).find((e) => e.kind === "station");
    expect(older?.id).toBeUndefined();
    calls.length = 0;
    expect(await o.playRecent("am", older!.url)).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicPlay(\"station\""))).toBe(true);
    expect(calls.some((c) => c.op === "navigate" && c.id === "am")).toBe(false);
    // B-124 recovery: recycling the App's surfaces destroys and recreates the music tile (its visualization stays)
    calls.length = 0;
    expect(await o.recycleAppSurfaces("am")).toBe(1);   // the tile's profile (its own id here: §10 implicit per-tile profile)
    expect(calls.some((c) => c.op === "destroy" && c.id === "am")).toBe(true);
    expect(calls.some((c) => c.op === "create" && c.id === "am")).toBe(true);
    expect(calls.some((c) => c.op === "destroy" && c.id === "stage")).toBe(false);
    expect(await o.recycleAppSurfaces("nobody")).toBe(0);
    // B-124 boot self-heal: inside the boot window the first signed-out recycles the tile once and is not believed; the next word is
    (o as unknown as { bootAt: number }).bootAt = Date.now();
    (o as unknown as { bootRecycled: Set<string> }).bootRecycled.clear();
    calls.length = 0;
    await o.onSurfaceEvent({ type: "session", id: "am", state: "signed-out" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.op === "destroy" && c.id === "am")).toBe(true);
    expect(o.sessionOf("am")).not.toBe("signed-out");
    await o.onSurfaceEvent({ type: "session", id: "am", state: "signed-out" });
    expect(o.sessionOf("am")).toBe("signed-out");   // the recreated page's word stands
    calls.length = 0;
    await o.onSurfaceEvent({ type: "session", id: "am", state: "signed-out" });
    expect(calls.some((c) => c.op === "destroy" && c.id === "am")).toBe(false);   // once
    // B-122: the transport's mute is a §3 focus change - unmute takes the audio (audioOwner names the tile), mute gives it up
    calls.length = 0;
    expect(await o.tileCommand("am", "unmute")).toBe("ok");
    expect(o.getState()?.audioOwner).toBe("am");
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === false)).toBe(true);
    calls.length = 0;
    expect(await o.tileCommand("am", "mute")).toBe("ok");
    expect(o.getState()?.muted).toBe(true);   // the wall's one switch
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === true)).toBe(true);
    // B-150 (settled): Play starts the page and takes the audio for it, but the wall's mute keeps it silent; unmute lets it sound
    calls.length = 0;
    expect(await o.tileCommand("am", "play")).toBe("ok");
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    expect(o.getState()?.audioOwner).toBe("am");
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === false)).toBe(false);
    expect(await o.tileCommand("am", "unmute")).toBe("ok");
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === false)).toBe(true);
    expect(o.getState()?.muted).toBeUndefined();
  });
});

describe("multi-service lounge (2026-09-07)", () => {
  it("re-sources a stage to another music source, lists the scene's sources, and plays a page-listed collection by address when the service has no player script", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as any).createVisualization = (opts: any) => void calls.push({ op: "createVisualization", ...opts });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "spotify": { id: "spotify", controls: { play: ".play", wake: ".keep" } } as never, "apple-music": { id: "apple-music", musicPlay: "1", musicCmd: "1", capabilities: ["rating"] } as never });
    await o.load({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
      { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
      { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] }, VIEWPORT);
    expect(o.musicSourceTiles()).toEqual([{ tile: "am", stages: ["stage"] }, { tile: "sp", stages: [] }]);
    calls.length = 0;
    expect(await o.resourceVisualization("stage", "sp")).toBe("ok");
    expect(calls.find((c) => c.op === "createVisualization")).toMatchObject({ id: "stage", source: "sp" });
    expect(o.getState()?.tiles.find((t) => t.id === "stage")?.visualization?.source).toBe("sp");
    expect(o.musicSourceTiles()).toEqual([{ tile: "am", stages: [] }, { tile: "sp", stages: ["stage"] }]);
    expect(await o.resourceVisualization("stage", "sp")).toBe("ok");            // already there: nothing rebuilt
    expect(await o.resourceVisualization("stage", "nope")).toBe("unknown");      // not a music source
    // Spotify lists its playlists with addresses and has no player script: a pick goes to the page and presses Play
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: false, library: { playlists: [{ id: "37i9", name: "Chill", kind: "playlist", url: "https://open.spotify.com/playlist/37i9" }], stations: [] } } });
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "37i9")).toBe("ok");
    expect(calls.find((c) => c.op === "navigate" && c.id === "sp")).toMatchObject({ url: "https://open.spotify.com/playlist/37i9" });
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicPending).toMatchObject({ name: "Chill", kind: "playlist" });
    expect(await o.playCollection("sp", "playlist", "nope")).toBe("unknown");
    // B-137: the page is there and holds the collection: a pick goes nowhere - the audio moves to it at once.
    // 2026-09-17 (section 3 amended): a music source that loses the audio is PAUSED, not left streaming in silence - so
    // Apple taking the audio pauses Spotify through its page, and the pick presses Spotify's own Play to carry on
    await o.onSurfaceEvent({ type: "navigated", id: "sp", url: "https://open.spotify.com/playlist/37i9" });
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });
    calls.length = 0;
    expect(await o.tileCommand("am", "unmute")).toBe("ok");   // Apple has the audio
    expect(calls.some((c) => c.op === "setMuted" && c.id === "sp" && c.muted === true)).toBe(true);
    expect(calls.some((c) => c.op === "inject" && c.id === "sp" && /pause/.test(String(c.js)))).toBe(true);   // and Spotify is paused, through its page
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "37i9")).toBe("ok");
    expect(calls.some((c) => c.op === "navigate")).toBe(false);
    expect(calls.some((c) => c.op === "inject" && c.id === "sp" && String(c.js).includes("click()"))).toBe(true);   // the page's own Play
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });   // the page plays: the audio moves to it (the pick armed it)
    expect(calls.some((c) => c.op === "setMuted" && c.id === "sp" && c.muted === false)).toBe(true);
    expect(o.getState()?.audioOwner).toBe("sp");
    // a service with no Media Session names the track through its context (Pandora): the face and the recent list use it
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "", context: { url: "https://www.pandora.com/station/play/471", label: "Pop Coast Hits Radio", kind: "station", id: "471", title: "Nice To Meet You", artist: "Myles Smith" } } });
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.nowPlaying).toMatchObject({ title: "Nice To Meet You", artist: "Myles Smith" });
    expect((await o.recentMusic("sp"))[0]).toMatchObject({ label: "Pop Coast Hits Radio", kind: "station", id: "471", title: "Nice To Meet You" });
    // B-132: the page's transport can assert playing; a playback signal asks the page for a fresh report and shows on the tile
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: false, title: "X", context: { playing: true } } });
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.nowPlaying?.playing).toBe(true);
    calls.length = 0;
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });
    expect(calls.some((c) => c.op === "inject" && c.id === "sp" && String(c.js).includes("__prismReportNow"))).toBe(true);
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.playing).toBe(true);
    // B-139: a fresh face saying paused corrects the machine, and a human press answers the page's own "still listening?" prompt first
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: false, title: "X" } });
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.playing).toBe(false);
    calls.length = 0;
    expect(await o.tileCommand("sp", "play")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "sp" && String(c.js).includes('".keep"') && String(c.js).includes('".play"'))).toBe(true);
    // B-140: a pick of the collection the page already holds carries on - the player resumes, nothing is re-queued
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "Song", context: { kind: "playlist", id: "p1", label: "Vibes" }, library: { playlists: [{ id: "p1", name: "Vibes", kind: "playlist" }], stations: [] } } });
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p1")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "am" && String(c.js).includes("__prismMusicPlay"))).toBe(false);
    expect(calls.some((c) => c.op === "inject" && c.id === "am" && String(c.js).includes('__prismMusicCmd("play")'))).toBe(true);
    // B-141: Start over queues the same collection again on purpose
    calls.length = 0;
    expect(await o.tileCommand("am", "restart")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "am" && String(c.js).includes('__prismMusicPlay("playlist", "p1")'))).toBe(true);
    expect(await o.tileCommand("stage", "restart")).toBe("unavailable");
    // B-155: a thumbs up goes to the service - Apple through its player API, a service without one is "unavailable"
    calls.length = 0;
    expect(await o.tileCommand("am", "thumbup")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "am" && String(c.js).includes('__prismMusicCmd("like")'))).toBe(true);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.rate).toBe(true);
    expect(await o.tileCommand("sp", "thumbdown")).toBe("ok");   // B-163: no dislike control - the skip (the media fallback here)
    // B-163: a dislike on a service with a Next but no dislike (Spotify) is the skip
    o.setAdapters({ "spotify": { id: "spotify", controls: { play: ".play", wake: ".keep", next: ".next" } } as never, "apple-music": { id: "apple-music", musicPlay: "1", musicCmd: "1", capabilities: ["rating"] } as never });
    calls.length = 0;
    expect(await o.tileCommand("sp", "thumbdown")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "sp" && String(c.js).includes('".next"'))).toBe(true);
    // B-158: a page with no media element (Spotify) reports playing through its face - that is the playback signal, human-attributed
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "Song" } });   // the page paused: off the playing set
    expect(await o.tileCommand("am", "play")).toBe("ok");
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Song" } });
    expect(o.getState()?.audioOwner).toBe("am");
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === false)).toBe(true);
    // B-142: a tile a human played is not re-held at a break's end
    (o as unknown as { bootHeld: Set<string> }).bootHeld.add("am");
    await o.onSurfaceEvent({ type: "ad-break", id: "am", active: true });
    await o.onSurfaceEvent({ type: "ad-break", id: "am", active: false });
    calls.length = 0;
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    expect(calls.some((c) => c.op === "inject" && c.id === "am" && /m\.pause\(\)/.test(String(c.js)))).toBe(false);
    // B-150: the wall's mute holds through a service switch - the pick moves the audio to sp, the wall keeps it silent, unmute lifts it
    expect(await o.tileCommand("am", "mute")).toBe("ok");
    expect(o.getState()?.muted).toBe(true);
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "37i9")).toBe("ok");
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });
    expect(calls.some((c) => c.op === "setMuted" && c.id === "sp" && c.muted === false)).toBe(false);
    expect(o.getState()?.audioOwner).toBe("sp");
    expect(await o.tileCommand("sp", "unmute")).toBe("ok");
    expect(calls.some((c) => c.op === "setMuted" && c.id === "sp" && c.muted === false)).toBe(true);
    expect(o.getState()?.muted).toBeUndefined();
  });
});

describe("B-129: what a person started in App setup carries on", () => {
  it("the closed preview's playing collection is picked up by the recycled music tile - by address when the service has no player script", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as any).createVisualization = (opts: any) => void calls.push({ op: "createVisualization", ...opts });
    const o = new Orchestrator(drivers);
    o.setAdapters({ pandora: { id: "pandora", controls: { play: ".play" }, musicContext: "window.__prismMusicContext=function(){return null}" } as never });
    await o.load({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "stage", visualization: { style: "prism-beams", source: "pd", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
      { id: "pd", url: "https://www.pandora.com/", profile: "pandora", adapter: "pandora", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] }, VIEWPORT);
    const pv = o.openAppSurface("pandora", "pandora", "https://www.pandora.com/", "pandora");
    await new Promise((r) => setTimeout(r, 0));
    await o.onSurfaceEvent({ type: "load-finished", id: pv, ok: true });
    expect(calls.some((c) => c.op === "inject" && c.id === pv && String(c.js).includes("__prismMusicContext"))).toBe(true);   // the preview runs the music scripts too
    await o.onSurfaceEvent({ type: "navigated", id: pv, url: "https://www.pandora.com/station/play/123" });
    await o.onSurfaceEvent({ type: "now-playing", id: pv, info: { playing: true, title: "Song", context: { url: "https://www.pandora.com/station/123", label: "Chill Radio", kind: "station", id: "123" } } });
    expect(o.closeAppSurface(pv)).toBe(true);
    calls.length = 0;
    expect(await o.recycleAppSurfaces("pandora")).toBe(1);
    expect(calls.some((c) => c.op === "navigate" && c.id === "pd" && c.url === "https://www.pandora.com/station/123")).toBe(true);
    expect(o.getState()?.tiles.find((t) => t.id === "pd")?.musicPending).toMatchObject({ name: "Chill Radio", kind: "station" });
    // nothing was playing in the preview: nothing is carried
    const pv2 = o.openAppSurface("pandora", "pandora", "https://www.pandora.com/", "pandora");
    await new Promise((r) => setTimeout(r, 0));
    await o.onSurfaceEvent({ type: "now-playing", id: pv2, info: { playing: false, title: "" } });
    o.closeAppSurface(pv2);
    calls.length = 0;
    await o.recycleAppSurfaces("pandora");
    expect(calls.some((c) => c.op === "navigate" && c.id === "pd" && String(c.url).includes("/station/"))).toBe(false);   // the recreate loads its home page; nothing is carried
  });
});

describe("§26 ambient audio (opt-in, 2026-09-07)", () => {
  it("B-226 (2026-09-17): a nameless element playing while the player's own transport says stopped is not the service playing (Apple Music idle)", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, capabilities: ["media-session"] } as never });
    await o.load({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "am", url: "https://music.apple.com/", profile: "apple-music", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] }, VIEWPORT);
    const library = { playlists: [{ id: "p.1", name: "Vibes" }], stations: [] };
    // the idle page's face as the wall saw it: an element playing, nothing named, MusicKit's transport stopped
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "", artist: "", context: { playing: false, position: 0, duration: null }, library } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.nowPlaying).toBeUndefined();   // no face at all: the page is idle
    expect(o.currentSong()).toBeNull();
    // the real thing: MusicKit says playing and the Media Session names the track
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Crazy", artist: "Oliver Tree", context: { playing: true, position: 3, duration: 180 }, library } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.nowPlaying).toMatchObject({ playing: true, title: "Crazy" });
    // B-132 still holds: the transport's playing counts when the Media Session lags
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "Crazy", artist: "Oliver Tree", context: { playing: true, position: 4, duration: 180 }, library } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.nowPlaying).toMatchObject({ playing: true, title: "Crazy" });
  });

  it("B-225 (2026-09-17): a face under an ad break is never the resume point - Pandora's 'Advertisement' stayed as the station's last track", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ pandora: { id: "pandora", controls: { play: ".play" }, capabilities: ["media-session", "audio-intermission"] } as never });
    await o.load({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "pd", url: "https://www.pandora.com/", profile: "pandora", adapter: "pandora", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] }, VIEWPORT);
    const station = { url: "https://www.pandora.com/station/play/162391272500243565", label: "Bear McCreary Radio", kind: "station", id: "162391272500243565" };
    await o.onSurfaceEvent({ type: "now-playing", id: "pd", info: { playing: true, title: "Ashes", artist: "Bear McCreary", context: station } });
    expect(await o.resumePoint("pd")).toMatchObject({ title: "Ashes", label: "Bear McCreary Radio" });
    // the break: the adapter's ad signal, then the face Pandora draws for it (the page's own words, through the context)
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: true });
    await o.onSurfaceEvent({ type: "now-playing", id: "pd", info: { playing: true, title: "", artist: "", context: { ...station, label: null, title: "Advertisement", artist: "Your station will be right back.", playing: true, position: 2, duration: 30 } } });
    expect(await o.resumePoint("pd")).toMatchObject({ title: "Ashes", label: "Bear McCreary Radio" });   // untouched
    expect((await o.recentMusic("pd")).some((r) => r.title === "Advertisement")).toBe(false);
    // the break ends and the station plays on: the next track is the resume point again
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: false });
    await o.onSurfaceEvent({ type: "now-playing", id: "pd", info: { playing: true, title: "Lullaby of the Giants", artist: "Bear McCreary", context: station } });
    expect(await o.resumePoint("pd")).toMatchObject({ title: "Lullaby of the Giants" });
  });

  it("a soundscape surface fades in when the break covers the source and is muted when it ends; the wall's mute covers it", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as any).createVisualization = (opts: any) => void calls.push({ op: "createVisualization", ...opts });
    const o = new Orchestrator(drivers);
    // the adapter can see the service's breaks (`audio-intermission`): the hidden source gets audio intermission by default, no config on the tile
    o.setAdapters({ pandora: { id: "pandora", controls: { play: ".play" }, capabilities: ["media-session", "audio-intermission"] } as never });
    await o.load({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "stage", visualization: { style: "prism-beams", source: "pd", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
      { id: "pd", url: "https://www.pandora.com/", profile: "pandora", adapter: "pandora", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true }, intermission: { enabled: false } },   // the App's scenery flag, off - irrelevant to a hidden source
    ] }, VIEWPORT);
    expect(await o.setIntermissionAmbient("crickets")).toBe(1);
    expect((JSON.parse((await drivers.store!.get("dashboard"))!) as { tiles: Array<{ id: string; intermission?: { ambient?: string } }> }).tiles.find((t) => t.id === "pd")?.intermission?.ambient).toBe("crickets");   // persisted with the document
    // B-147: the soundscape sounds only while the music's tile owns the audio - a break on a muted source is a silent break
    calls.length = 0;
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: true });
    await new Promise((r) => setTimeout(r, 1200));
    expect(calls.some((c) => c.op === "setMuted" && c.id === "ambient:pd" && c.muted === true)).toBe(true);
    expect(calls.some((c) => c.op === "setMuted" && c.id === "ambient:pd" && c.muted === false)).toBe(false);
    expect(calls.find((c) => c.op === "create" && c.id === "ambient:pd")).toBeTruthy();
    expect(calls.find((c) => c.op === "navigate" && c.id === "ambient:pd")).toMatchObject({ url: "https://tiles.prism/soundscape/?sound=crickets" });
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: false });
    expect(await o.tileCommand("pd", "unmute")).toBe("ok");   // the room asks to hear Pandora: it owns the audio now
    calls.length = 0;
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: true });
    await new Promise((r) => setTimeout(r, 1200));   // the engine's cover debounce
    expect(calls.some((c) => c.op === "setMuted" && c.id === "pd" && c.muted === true)).toBe(true);
    expect(calls.some((c) => c.op === "setMuted" && c.id === "ambient:pd" && c.muted === false)).toBe(true);
    // 2026-09-17: the soundscape page reports its own playback and a face (the bootstrap wraps play()); neither is a
    // tile taking the audio, so section 3 never mutes the soundscape for it (three silent Spotify breaks, Space Walk)
    calls.length = 0;
    await o.onSurfaceEvent({ type: "playback", id: "ambient:pd", playing: true });
    await o.onSurfaceEvent({ type: "now-playing", id: "ambient:pd", info: { playing: true, title: "", artist: "", position: 4.4, duration: 379.7 } });
    expect(calls.some((c) => c.op === "setMuted" && c.id === "ambient:pd" && c.muted === true)).toBe(false);
    expect(calls.some((c) => c.op === "setMuted" && c.id === "pd")).toBe(false);   // and the source's own mute is untouched
    calls.length = 0;
    expect(await o.tileCommand("pd", "mute")).toBe("ok");   // the wall's mute covers the soundscape
    expect(calls.some((c) => c.op === "setMuted" && c.id === "ambient:pd" && c.muted === true)).toBe(true);
    calls.length = 0;
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: false });
    expect(calls.some((c) => c.op === "setMuted" && c.id === "ambient:pd" && c.muted === true)).toBe(true);
    // B-147: muted during the break = muted after it; the engine's restore does not override the person
    expect(calls.some((c) => c.op === "setMuted" && c.id === "pd" && c.muted === false)).toBe(false);
    expect(await o.tileCommand("pd", "unmute")).toBe("ok");
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: true });
    await new Promise((r) => setTimeout(r, 1200));
    calls.length = 0;
    await o.onSurfaceEvent({ type: "ad-break", id: "pd", active: false });
    expect(calls.some((c) => c.op === "setMuted" && c.id === "pd" && c.muted === false)).toBe(true);   // the owner gets its sound back
    expect(await o.setIntermissionAmbient(null)).toBe(1);
    expect((JSON.parse((await drivers.store!.get("dashboard"))!) as { tiles: Array<{ id: string; intermission?: { ambient?: string } }> }).tiles.find((t) => t.id === "pd")?.intermission?.ambient).toBeUndefined();
  }, 10_000);
});

describe("§32 backdrop tint honours the pack's artTint", () => {
  it("a tableau keeps most of its own colour under a muted album cover; an original pack tints as before", async () => {
    const { MusicStateModel } = await import("../src/music-state.js");
    const m = new MusicStateModel();
    expect(m.registerStylePalettes({ "street-fair": { palette: ["#F05C7A", "#F0A83C"], artTint: 0.2 }, bloom: ["#C86CF0", "#F05C7A"] })).toBe(2);
    expect(m.styleTint("street-fair")).toBe(0.2);
    expect(m.styleTint("bloom")).toBe(0.6);
    expect(m.stylePalette("street-fair")).toEqual(["#F05C7A", "#F0A83C"]);
  });
});

describe("resume: Play with nothing queued goes back to what last played and presses the page's Play", () => {
  const lounge = (): DashboardDocument => ({ ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ] });
  it("records the page something played from, then navigates there and presses Play once the page is up", async () => {
    const { drivers, calls, kv } = fakeDrivers();
    (drivers.surface as any).createVisualization = (opts: any) => void calls.push({ op: "createVisualization", ...opts });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".primary-actions button.play-button" } } as never });
    await o.load(lounge(), VIEWPORT);
    // nothing has ever played: Play has nothing to resume and falls through to the page's handler
    expect(await o.resumeMusic("am")).toBe("none");
    // a person plays an album: the observer sees playback on that page
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: "https://music.apple.com/us/album/discovery/697194953" });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "One More Time", artist: "Daft Punk", album: "Discovery" } });
    const point = await o.resumePoint("am");
    expect(point).toMatchObject({ url: "https://music.apple.com/us/album/discovery/697194953", title: "One More Time", artist: "Daft Punk", album: "Discovery" });
    expect(kv.get("music:resume:lounge:am")).toContain("Discovery");
    // later: the page is back on its home, nothing queued (a restart), and Play is pressed on the wall
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: null });
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: "https://music.apple.com/us/home" });
    calls.length = 0;
    expect(await o.tileCommand("am", "play")).toBe("ok");
    expect(calls.find((c) => c.op === "navigate" && c.id === "am")).toMatchObject({ url: "https://music.apple.com/us/album/discovery/697194953" });
    expect(calls.some((c) => c.op === "inject" && c.id === "am")).toBe(false);   // not before the page is up
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: "https://music.apple.com/us/album/discovery/697194953" });
    await o.onSurfaceEvent({ type: "load-finished", id: "am", ok: true });
    const press = calls.find((c) => c.op === "inject" && c.id === "am" && String(c.js).includes(".primary-actions button.play-button"));
    expect(press).toBeTruthy();
    // already on that page: no navigation, straight to the control
    calls.length = 0;
    expect(await o.tileCommand("am", "play")).toBe("ok");
    expect(calls.some((c) => c.op === "navigate")).toBe(false);
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("play-button"))).toBe(true);
    // with a track queued, Play is the plain pass-through again
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "One More Time" } });
    calls.length = 0;
    await o.tileCommand("am", "play");
    expect(calls.some((c) => c.op === "navigate")).toBe(false);
  });
});

describe("restyleVisualization: another look without touching the music", () => {
  it("rebuilds only the visualization surface and never mutes or navigates the source", async () => {
    const { drivers, calls, kv } = fakeDrivers();
    (drivers.surface as any).createVisualization = (opts: any) => void calls.push({ op: "createVisualization", ...opts });
    const o = new Orchestrator(drivers);
    const lounge: DashboardDocument = { ...doc, id: "lounge", layout: { mode: "grid", cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
      { id: "am", url: "https://music.apple.com/", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] };
    await o.load(lounge, VIEWPORT);
    calls.length = 0;
    expect(await o.restyleVisualization("stage", "spectrum")).toBe("ok");
    const stage = calls.filter((c) => c.id === "stage").map((c) => c.op);
    expect(stage.indexOf("destroy")).toBeGreaterThanOrEqual(0);
    expect(calls.find((c) => c.op === "createVisualization" && c.id === "stage")).toMatchObject({ style: "spectrum", source: "am", artwork: "backdrop" });
    // the music source is not touched: no destroy, no navigate, no mute change
    expect(calls.some((c) => c.id === "am" && (c.op === "destroy" || c.op === "navigate" || c.op === "setMuted"))).toBe(false);
    // and the document now carries the pack, so a restart boots into it
    expect(JSON.parse(kv.get("dashboard")!).tiles.find((t: any) => t.id === "stage").visualization.style).toBe("spectrum");
    expect(await o.restyleVisualization("am", "bloom")).toBe("unknown");   // not a visualization
  });
});

describe("apply: a survivor that changed shape is rebuilt", () => {
  it("destroys and recreates a placeholder slot that became an app (found live 2026-09-05)", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    const empty: DashboardDocument = { ...doc, id: "kc", layout: { mode: "grid", cols: 2, rows: 1, gap: 8 }, tiles: [
      { id: "hero", placeholder: true, audio: "mute", aspectHint: "16:9", label: "Video hero" },
      { id: "chores", url: "https://tiles.prism/chores/", audio: "mute" },
    ] };
    await o.load(empty, VIEWPORT);
    expect(calls.find((c) => c.op === "create" && c.id === "hero")).toMatchObject({ placeholder: true, label: "Video hero" });
    calls.length = 0;
    const filled: DashboardDocument = { ...empty, tiles: [
      { id: "hero", url: "https://www.youtube.com/", audio: "exclusive", aspectHint: "16:9" },
      { id: "chores", url: "https://tiles.prism/chores/", audio: "mute" },
    ] };
    await o.applyModelDocument(filled);
    const ops = calls.filter((c) => c.id === "hero").map((c) => c.op);
    expect(ops.indexOf("destroy")).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf("create")).toBeGreaterThan(ops.indexOf("destroy"));
    expect(calls.find((c) => c.op === "navigate" && c.id === "hero")).toMatchObject({ url: "https://www.youtube.com/" });
    // the unchanged neighbour survives untouched (§9)
    expect(calls.some((c) => c.op === "destroy" && c.id === "chores")).toBe(false);
  });
});

describe("Orchestrator.load", () => {
  it("creates, navigates, mutes, and lays out every tile", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);

    const creates = calls.filter((c) => c.op === "create");
    expect(creates.map((c) => c.id)).toEqual(["yt", "calendar", "radio"]);
    // §10: implicit per-tile profile unless declared
    expect(creates.find((c) => c.id === "yt")).toMatchObject({ profile: "yt", background: "#101318" });
    expect(creates.find((c) => c.id === "calendar")).toMatchObject({ profile: "family" });

    expect(calls.filter((c) => c.op === "navigate").map((c) => c.url)).toEqual([
      "https://www.youtube.com",
      "https://example.com/cal",
      "https://example.com/radio",
    ]);

    // §3 rule 5: boot is silent - EVERY tile muted at startup
    const muted = calls.filter((c) => c.op === "setMuted");
    expect(muted.every((c) => c.muted === true)).toBe(true);
    expect(new Set(muted.map((c) => c.id))).toEqual(new Set(["yt", "calendar", "radio"]));

    // rects match the layout engine, inset by gap/2
    const expected = insetRects(layoutDashboard(doc, VIEWPORT), 8);
    const setRects = Object.fromEntries(
      calls.filter((c) => c.op === "setRect").map((c) => [c.id, c.rect]),
    );
    expect(setRects).toEqual(expected);
  });

  it("uses the dark default substrate when the theme has none (§16)", async () => {
    const { drivers, calls } = fakeDrivers();
    const bare: DashboardDocument = { ...doc, theme: {} };
    await new Orchestrator(drivers).load(bare, VIEWPORT);
    expect(calls.find((c) => c.op === "create")).toMatchObject({ background: DEFAULT_BACKGROUND });
  });

  it("destroys surfaces that the next dashboard doesn't want", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    const next: DashboardDocument = { ...doc, id: "dinner", tiles: doc.tiles.slice(0, 2) };
    await o.load(next, VIEWPORT);
    expect(calls.filter((c) => c.op === "destroy").map((c) => c.id)).toEqual(["radio"]);
    // surviving tiles are not re-created
    expect(calls.filter((c) => c.op === "create").length).toBe(3);
  });
});

describe("Orchestrator — hero interaction", () => {
  it("promoteHero re-solves and persists", async () => {
    const { drivers, calls, kv } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    calls.length = 0;

    await o.promoteHero("calendar");
    const expected = insetRects(layoutDashboard(doc, VIEWPORT, { hero: "calendar" }), 8);
    const setRects = Object.fromEntries(
      calls.filter((c) => c.op === "setRect").map((c) => [c.id, c.rect]),
    );
    expect(setRects).toEqual(expected);
    expect(JSON.parse(kv.get("layout:kitchen")!)).toEqual({ hero: "calendar" });
  });

  it("ignores promotion of unknown tiles", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    calls.length = 0;
    await o.promoteHero("nope");
    expect(calls).toEqual([]);
  });

  it("setHeroSize clamps, re-solves, and only persists on commit", async () => {
    const { drivers, kv } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);

    await o.setHeroSize(0.99, false); // live drag — no persistence
    expect(kv.get("layout:kitchen")).toBeUndefined();
    expect(o.rects()).toEqual(layoutDashboard(doc, VIEWPORT, { heroSize: 0.85 }));

    await o.setHeroSize(0.5); // commit
    expect(JSON.parse(kv.get("layout:kitchen")!)).toEqual({ heroSize: 0.5 });
  });

  it("restores persisted hero state on load (§8 — shell persists the value)", async () => {
    const { drivers, kv } = fakeDrivers();
    kv.set("layout:kitchen", JSON.stringify({ hero: "radio", heroSize: 0.4 }));
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    expect(o.rects()).toEqual(layoutDashboard(doc, VIEWPORT, { hero: "radio", heroSize: 0.4 }));
  });

  it("survives corrupt persisted state", async () => {
    const { drivers, kv } = fakeDrivers();
    kv.set("layout:kitchen", "{not json");
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    expect(o.rects()).toEqual(layoutDashboard(doc, VIEWPORT));
  });
});

describe("Orchestrator — resize and events", () => {
  it("resize re-solves at the new viewport", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    calls.length = 0;

    const portrait = { w: 625, h: 1000 };
    await o.resize(portrait);
    const expected = insetRects(layoutDashboard(doc, portrait), 8);
    const setRects = Object.fromEntries(
      calls.filter((c) => c.op === "setRect").map((c) => [c.id, c.rect]),
    );
    expect(setRects).toEqual(expected);
  });

  it("playback events drive audio focus through the seam", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    calls.length = 0;

    await o.onSurfaceEvent({ type: "interaction", id: "yt" });      // rule-5 attribution
    await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });
    await o.onSurfaceEvent({ type: "interaction", id: "radio" });
    await o.onSurfaceEvent({ type: "playback", id: "radio", playing: true });

    expect(calls.filter((c) => c.op === "setMuted")).toEqual([
      { op: "setMuted", id: "yt", muted: false },
      { op: "setMuted", id: "radio", muted: false },
      { op: "setMuted", id: "yt", muted: true },
    ]);
    // mute-only: the losing tile keeps playing silently - nothing is paused
    expect(calls.filter((c) => c.op === "inject")).toHaveLength(0);
  });

  it("routes {\"cmd\":\"hero\"} input bindings, incl. focusedMedia", async () => {
    const { drivers } = fakeDrivers();
    const withInputs: DashboardDocument = {
      ...doc,
      inputs: {
        KEY_H: { tile: "focusedMedia", cmd: "hero" },
        KEY_C: { tile: "calendar", cmd: "hero" },
      },
    };
    const o = new Orchestrator(drivers);
    await o.load(withInputs, VIEWPORT);

    await o.onInput({ key: "KEY_H" }); // no focused media yet — no-op
    expect(o.rects()).toEqual(layoutDashboard(withInputs, VIEWPORT));

    await o.onSurfaceEvent({ type: "interaction", id: "radio" });   // rule-5 attribution
    await o.onSurfaceEvent({ type: "playback", id: "radio", playing: true });
    await o.onInput({ key: "KEY_H" });
    expect(o.rects()).toEqual(layoutDashboard(withInputs, VIEWPORT, { hero: "radio" }));

    await o.onInput({ key: "KEY_C" });
    expect(o.rects()).toEqual(layoutDashboard(withInputs, VIEWPORT, { hero: "calendar" }));
  });
});

describe("runtime bridge (shells/android host contract)", () => {
  it("drives the orchestrator through JSON strings end to end", async () => {
    const { drivers, calls } = fakeDrivers();
    const rt = createRuntime(drivers);
    rt.init(JSON.stringify(doc), 1000, 625);
    // init is fire-and-forget; a macrotask tick drains the async load chain
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.filter((c) => c.op === "create")).toHaveLength(3);
    const rects = JSON.parse(rt.rects());
    expect(rects).toEqual(layoutDashboard(doc, VIEWPORT));

    rt.event(JSON.stringify({ type: "interaction", id: "yt" }));    // rule-5 attribution
    rt.event(JSON.stringify({ type: "playback", id: "yt", playing: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.op === "setMuted" && c.id === "yt" && c.muted === false)).toBe(true);
  });
});

describe("§3 rule 5 — human attribution survives a slow service", () => {
  it("a press whose playback lands 10s later still unmutes (the Apple Music case)", async () => {
    vi.useFakeTimers();
    try {
      const { drivers, calls } = fakeDrivers();
      const o = new Orchestrator(drivers);
      await o.load(doc, VIEWPORT);
      calls.length = 0;

      // Observed on the wall 2026-09-04: press at 10:48:18, playback report at
      // 10:48:27.884. The old 7s window called that autoplay and the exclusive
      // source played MUTED - a silent wall with no way to tell why.
      await o.onSurfaceEvent({ type: "interaction", id: "yt" });
      vi.advanceTimersByTime(10_000);
      await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });

      expect(calls.filter((c) => c.op === "setMuted")).toEqual([{ op: "setMuted", id: "yt", muted: false }]);
    } finally { vi.useRealTimers(); }
  });

  it("still refuses autoplay that follows no interaction at all", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    calls.length = 0;
    await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });
    expect(calls.filter((c) => c.op === "setMuted" && c.muted === false)).toEqual([]);
  });

  it("an arm is consumed, so a later autoplay cannot ride the same press", async () => {
    vi.useFakeTimers();
    try {
      const { drivers, calls } = fakeDrivers();
      const o = new Orchestrator(drivers);
      await o.load(doc, VIEWPORT);
      await o.onSurfaceEvent({ type: "interaction", id: "yt" });
      await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });   // consumes it
      await o.onSurfaceEvent({ type: "playback", id: "yt", playing: false });
      calls.length = 0;
      vi.advanceTimersByTime(5_000);
      await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });   // autoplay now
      expect(calls.filter((c) => c.op === "setMuted" && c.muted === false)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it("a stale arm expires - walking away still means silence", async () => {
    vi.useFakeTimers();
    try {
      const { drivers, calls } = fakeDrivers();
      const o = new Orchestrator(drivers);
      await o.load(doc, VIEWPORT);
      await o.onSurfaceEvent({ type: "interaction", id: "yt" });
      calls.length = 0;
      vi.advanceTimersByTime(HUMAN_INTENT_MS + 1_000);
      await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });
      expect(calls.filter((c) => c.op === "setMuted" && c.muted === false)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it("an interaction in one tile does not unmute another", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.load(doc, VIEWPORT);
    calls.length = 0;
    await o.onSurfaceEvent({ type: "interaction", id: "yt" });
    await o.onSurfaceEvent({ type: "playback", id: "radio", playing: true });
    expect(calls.filter((c) => c.op === "setMuted" && c.muted === false)).toEqual([]);
  });

  it("B-204 (2026-09-15): nothing loaded after a restart - the row says what Play would resume, and Play resumes it", async () => {
    const { drivers, calls } = fakeDrivers();
    const lounge = { ...doc, id: "lounge", layout: { mode: "grid" as const, cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive" as const, kind: "floating" as const, float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] };
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never });
    await o.load(lounge, VIEWPORT);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.resume).toBeUndefined();   // never seen playing: nothing to offer
    const station = "https://music.apple.com/us/station/mark-graffs-station/ra.u-1";
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: station });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Gnarly", artist: "KATSEYE", context: { url: station, label: "Alex Parker's Station", kind: "station", id: "ra.u-1" } } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.resume).toBeUndefined();   // a track is loaded: the row carries the track, not a memory
    // the page came back cold (a restart, or the service dropped its queue): library only, no track
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, library: { playlists: [], stations: [] } } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.resume).toEqual({ title: "Gnarly", artist: "KATSEYE", label: "Alex Parker's Station", kind: "station" });
    // a fresh wall on the same store knows it too, before the page has said a word
    const o2 = new Orchestrator(drivers);
    o2.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never });
    await o2.load(lounge, VIEWPORT);
    expect(o2.getState()?.tiles.find((t) => t.id === "am")?.resume).toMatchObject({ title: "Gnarly", label: "Alex Parker's Station" });
    calls.length = 0;
    expect(await o2.tileCommand("am", "play")).toBe("ok");
    expect(calls.find((c) => c.op === "navigate" && c.id === "am")).toMatchObject({ url: station });   // back to the station page; load-finished presses its Play
  });

  it("B-205 (2026-09-15): a resume goes by id through the service's own player when it has one, and Switch to a service plays on from wherever it is", async () => {
    const { drivers, calls } = fakeDrivers();
    const lounge = { ...doc, id: "lounge", layout: { mode: "grid" as const, cols: 1, rows: 1, gap: 0 }, tiles: [
      { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive" as const, kind: "floating" as const, float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
      { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive" as const, kind: "floating" as const, float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    ] };
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "(function(){})()", musicCmd: "(function(){})()" }, spotify: { id: "spotify", controls: { play: ".play" } } } as never);
    await o.load(lounge, VIEWPORT);
    expect(await o.switchToService("am")).toBe("none");   // nothing held, nothing remembered
    const station = "https://music.apple.com/us/station/mark-graffs-station/ra.u-1";
    await o.onSurfaceEvent({ type: "navigated", id: "am", url: station });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Gnarly", artist: "KATSEYE", context: { url: station, label: "Alex Parker's Station", kind: "station", id: "ra.u-1" } } });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, library: { playlists: [], stations: [] } } });   // the page let go of its queue
    calls.length = 0;
    expect(await o.tileCommand("am", "play")).toBe("ok");
    const inj = calls.filter((c) => c.op === "inject" && c.id === "am").map((c) => String(c.js));
    expect(inj.some((j) => j.includes('__prismMusicPlay("station", "ra.u-1")'))).toBe(true);   // the station by id - never the page's Play control (which hit "Play Vibes")
    expect(inj.some((j) => j.includes(".play"))).toBe(false);
    expect(calls.some((c) => c.op === "navigate" && c.id === "am")).toBe(false);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toMatchObject({ kind: "station", id: "ra.u-1", name: "Alex Parker's Station" });
    // Spotify holds a paused track: Switch to it plays what it holds (no player api: the page's own control)
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: false, title: "Marigny", artist: "Wilbert Roget, II" } });
    calls.length = 0;
    expect(await o.switchToService("sp")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "sp" && String(c.js).includes(".play"))).toBe(true);
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicPending).toMatchObject({ kind: "play", name: "Marigny" });
    // ... and one already playing just takes the room's audio
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Marigny", artist: "Wilbert Roget, II" } });
    calls.length = 0;
    expect(await o.switchToService("sp")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "sp")).toBe(false);
    expect(o.getState()?.audioOwner).toBe("sp");
  });
});
