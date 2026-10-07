import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * Quick play's cross-service lookup through the orchestrator (2026-09-16): the song playing on one service is
 * asked of another service's page; the answer comes back as a music-result bound to core's token AND the tile
 * asked (a page in another tile cannot answer for it - review finding, same day); the two verbs only ever send
 * back ids the page itself returned or listed.
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
  return { drivers, calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    { id: "sp", url: "https://open.spotify.com/", adapter: "spotify", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ],
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const tokenOf = (calls: Array<Record<string, unknown>>, fn: string): string => {
  const js = String(calls.filter((c) => c.op === "inject" && typeof c.js === "string" && String(c.js).includes(fn)).pop()?.js ?? "");
  return new RegExp(fn + '\\("([^"]+)"').exec(js)?.[1] ?? "";
};

describe("Quick play: the song playing now, on another service", () => {
  it("asks the page, ignores an answer from another tile, matches strictly, and sends back only ids the page gave", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({
      "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never,
      spotify: { id: "spotify", controls: { play: ".play" } } as never,
    });
    await o.load(doc, { w: 1000, h: 625 });

    // nothing playing: the lookup says so
    expect(await o.musicLookup("am")).toBe("unavailable");
    expect(o.musicLookupState("am").reason).toMatch(/nothing is playing/);

    // Spotify plays Shame; the wall hears it
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature" } });
    expect(o.currentSong()).toMatchObject({ title: "Shame", artist: "Lauren Mayberry", from: "sp" });
    // a service with no lookup script says so, naming the song it would have looked for
    expect(await o.musicLookup("sp")).toBe("unavailable");
    expect(o.musicLookupState("sp")).toMatchObject({ status: "unavailable", song: { title: "Shame" }, reason: "this service cannot be searched from the wall yet" });
    // ... and with its own note, that note is the reason (Amazon Music: "Unavailable" with a ? that explains why, 2026-09-16)
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" }, musicLookupNote: "No way in from outside." } as never });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature" } });
    expect(await o.musicLookup("sp")).toBe("unavailable");
    expect(o.musicLookupState("sp").reason).toBe("No way in from outside.");

    // Apple is asked: the page gets the token and the song
    calls.length = 0;
    const pending = o.musicLookup("am");
    await tick();
    const token = tokenOf(calls, "__prismMusicLookup");
    expect(token).toMatch(/^lk\d+-[0-9a-f]+$/);
    expect(o.musicLookupState("am").status).toBe("searching");
    // a second open while the question is out does not ask again
    expect(await o.musicLookup("am")).toBe("searching");
    expect(calls.filter((c) => c.op === "inject" && String(c.js).includes("__prismMusicLookup")).length).toBe(1);

    // another tile's page answering with Apple's token is not Apple: ignored
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token, op: "lookup", ok: true, candidates: [{ id: "evil", title: "Shame", artist: "Lauren Mayberry" }] });
    expect(o.musicLookupState("am").status).toBe("searching");
    // Apple's own answer settles it, strictly: the album cut the song names comes first
    await o.onSurfaceEvent({ type: "music-result", id: "am", token, op: "lookup", ok: true, candidates: [
      { id: "1708516453", title: "Shame", artist: "Lauren Mayberry", album: "Shame - Single" },
      { id: "1769021548", title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature" },
      { id: "1750554620", title: "ASHAMED (feat. Lauren Mayberry)", artist: "HEALTH" },
    ] });
    expect(await pending).toBe("found");
    const st = o.musicLookupState("am");
    expect(st.match?.id).toBe("1769021548");
    expect(st.candidates.length).toBe(3);
    expect(st.playlists).toEqual([]);

    // the account's playlists arrive with the page's library; the wall knows which ones may be added to
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, library: { playlists: [{ id: "p.1", name: "Mine", kind: "playlist", edit: true }, { id: "p.2", name: "Acoustic Hits", kind: "playlist", edit: false }], stations: [] } } });
    expect(o.musicLookupState("am").playlists).toEqual([{ id: "p.1", name: "Mine", edit: true }, { id: "p.2", name: "Acoustic Hits", edit: false }]);

    // add: an id the page never returned, or a playlist it never listed, goes nowhere
    calls.length = 0;
    expect(await o.musicAddToPlaylist("am", "p.1", "evil")).toBe("unknown");
    expect(await o.musicAddToPlaylist("am", "p.9", "1769021548")).toBe("unknown");
    expect(calls.filter((c) => c.op === "inject").length).toBe(0);
    // a real add: the page is asked with both ids, its answer is the action's outcome
    const adding = o.musicAddToPlaylist("am", "p.1", "1769021548");
    await tick();
    const addToken = tokenOf(calls, "__prismMusicAddToPlaylist");
    expect(String(calls.find((c) => c.op === "inject")?.js)).toContain('"p.1", "1769021548"');
    expect(o.musicLookupState("am").action).toMatchObject({ op: "add", status: "pending", playlist: "Mine", song: "Shame" });
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: addToken, op: "add", ok: false, error: "HTTP 403" });
    expect(await adding).toBe("error");
    expect(o.musicLookupState("am").action).toMatchObject({ op: "add", status: "error", error: "HTTP 403" });

    // a station from the song: a human's pick - the tile is armed, the pending face names it, the page is asked
    calls.length = 0;
    const station = o.musicStationFromSong("am", "1769021548");
    await tick();
    const stToken = tokenOf(calls, "__prismMusicStationFromSong");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toMatchObject({ kind: "station", name: "Shame station" });
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: stToken, op: "station", ok: true });
    expect(await station).toBe("ok");
    expect(o.musicLookupState("am").action).toMatchObject({ op: "station", status: "ok" });
    expect(await o.musicStationFromSong("am", "evil")).toBe("unknown");
    // B-218: the pending station clears when the page plays a station named after the song (Pandora: "<song> Radio"), not only by id
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toMatchObject({ kind: "station" });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Shame", artist: "Lauren Mayberry", context: { kind: "station", id: "S1", label: "Shame Radio" } } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicPending).toBeUndefined();
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "" } });   // Apple's face blank again: the rest reads Spotify's

    // a new song asks again; the old answer is not reused
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Debut", artist: "KATSEYE" } });
    calls.length = 0;
    const again = o.musicLookup("am");
    await tick();
    expect(calls.filter((c) => c.op === "inject" && String(c.js).includes("__prismMusicLookup")).length).toBe(1);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [] });
    expect(await again).toBe("not-found");
  });

  it("a station the page plays is listed with the service's stations, and survives the page listing without it (B-216)", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, library: { playlists: [], stations: [{ id: "ra.u-1", name: "Mine", kind: "station" }] } } });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Lullaby of the Giants", artist: "Bear McCreary" } });
    const pending = o.musicLookup("am");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [{ id: "1370192787", title: "Lullaby of the Giants", artist: "Bear McCreary" }] });
    expect(await pending).toBe("found");
    calls.length = 0;
    const station = o.musicStationFromSong("am", "1370192787");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicStationFromSong"), op: "station", ok: true });
    expect(await station).toBe("ok");
    // the page plays the station and names it (Apple: ra.cp-<song>) - that is the moment the wall learns its id
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "The Ludlows", artist: "James Horner", context: { kind: "station", id: "ra.cp-1370192787", label: "Lullaby of the Giants Station", url: "https://music.apple.com/us/station/lullaby-of-the-giants-station/ra.cp-1370192787" } } });
    expect((await o.musicLibrary("am")).stations.map((s) => s.id)).toEqual(["ra.u-1", "ra.cp-1370192787"]);
    // Apple's own list still does not carry it; the wall's does, once
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "The Ludlows", artist: "James Horner", library: { playlists: [], stations: [{ id: "ra.u-1", name: "Mine", kind: "station" }] } } });
    expect((await o.musicLibrary("am")).stations.map((s) => s.name)).toEqual(["Mine", "Lullaby of the Giants Station"]);
    expect(o.musicLibraryNow("am").stations).toHaveLength(2);
    // a station started from the page's own screen (no pending pick) is kept the same way
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Ashes", artist: "Bear McCreary", context: { kind: "station", id: "ra.cp-77", label: "Ashes Station" } } });
    expect((await o.musicLibrary("am")).stations.map((s) => s.id)).toEqual(["ra.u-1", "ra.cp-77", "ra.cp-1370192787"]);
    // a second wall boots from the store: the station is still there
    const o2 = new Orchestrator(drivers);
    o2.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o2.load(doc, { w: 1000, h: 625 });
    expect((await o2.musicLibrary("am")).stations.map((s) => s.id)).toContain("ra.cp-1370192787");
    // a wall with nothing kept yet starts from the stations among its recents (the station made before this shipped)
    const fresh = fakeDrivers();
    await fresh.drivers.store.set("music:recent:lounge:am", JSON.stringify([{ url: "https://music.apple.com/us/station/x-station/ra.cp-9", label: "X Station", kind: "station", id: "ra.cp-9", title: "T", at: 1 }]));
    const o3 = new Orchestrator(fresh.drivers);
    o3.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o3.load(doc, { w: 1000, h: 625 });
    expect((await o3.musicLibrary("am")).stations.map((s) => s.name)).toEqual(["X Station"]);
  });

  it("a page script whose adapter says what it cannot do: the state carries it for the menu (B-218, Pandora's add)", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/", musicLookupCannot: { add: "Not here." } } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Shame", artist: "Lauren Mayberry" } });
    const pending = o.musicLookup("am");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [{ id: "x1", title: "Shame", artist: "Lauren Mayberry" }] });
    expect(await pending).toBe("found");
    expect(o.musicLookupState("am").cannot).toEqual({ add: "Not here." });
  });

  it("a play the page did not take is sent once more after six seconds, and only once (2026-10-04, a page just woken did nothing with the first)", async () => {
    vi.useFakeTimers();
    try {
      const { drivers, calls } = fakeDrivers();
      (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
      const o = new Orchestrator(drivers);
      o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
      await o.load(doc, { w: 1000, h: 625 });
      await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [] } } });
      const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
      calls.length = 0;
      expect(await o.playCollection("am", "playlist", "p.1", "normal")).toBe("ok");
      expect(injects("__prismMusicPlay").length).toBe(1);
      // silence from the page: the second send at six seconds, then no third
      await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_PLAY_RETRY_MS - 1);
      expect(injects("__prismMusicPlay").length).toBe(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(injects("__prismMusicPlay").length).toBe(2);
      expect(o.musicPlayRetries).toBe(1);
      await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_PLAY_RETRY_MS * 3);
      expect(injects("__prismMusicPlay").length).toBe(2);
      // a page that plays within the window needs no second send
      calls.length = 0;
      expect(await o.playCollection("am", "playlist", "p.1", "normal")).toBe("ok");
      await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "A", artist: "x", context: { kind: "playlist", id: "p.1", label: "Vibes", playing: true } } });
      await vi.advanceTimersByTimeAsync(Orchestrator.MUSIC_PLAY_RETRY_MS + 10);
      expect(injects("__prismMusicPlay").length).toBe(1);
      expect(o.musicPlayRetries).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("play orders (2026-09-17, spec 32 layer 5): the service's shuffle switch, Prism's true shuffle and reverse through the page's track list, a standing order the state names", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.tracksFreshMs = 0;   // this test feeds a different list to each order: every order reads afresh
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicShuffle: "/*shuffle*/", musicTracks: "/*tracks*/", musicQueue: "/*queue*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [{ id: "ra.1", name: "Vibes Station", kind: "station" }] } } });
    expect(o.musicOrderSupport("am")).toMatchObject({ shuffle: true, own: true });
    expect(o.musicOrderSupport("sp").shuffle).toMatch(/no shuffle switch/);
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
    // reverse: the page's track list, backwards, handed to the queue
    calls.length = 0;
    const rev = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }, { id: "3", title: "C", artist: "x" }, { id: "2", title: "B again", artist: "x" }] });
    await tick();
    const q = injects("__prismMusicQueue")[0];
    expect(q).toContain(JSON.stringify(["3", "2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rev).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ order: "reverse", label: "in reverse", name: "Vibes", id: "p.1", count: 3 });
    expect(await drivers.store!.get("music:order:lounge:am")).toContain("reverse");
    // true shuffle: the same three ids, every one once
    calls.length = 0;
    const ts = o.playCollection("am", "playlist", "p.1", "true-shuffle");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }, { id: "3", title: "C", artist: "x" }] });
    await tick();
    const q2 = /__prismMusicQueue\("[^"]+", (\[[^\]]*\])(?:, \{[^}]*\})?\)/.exec(injects("__prismMusicQueue")[0] ?? "");
    expect(q2).not.toBeNull();
    expect((JSON.parse(q2![1]!) as string[]).slice().sort()).toEqual(["1", "2", "3"]);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await ts).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ order: "true-shuffle", label: "true shuffle" });
    // the service's own shuffle: its switch on, its own queue; in order: the switch off and no standing order
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.1", "shuffle")).toBe("ok");
    expect(injects("__prismMusicShuffle(true)").length).toBe(1);
    expect(injects("__prismMusicPlay").length).toBe(1);
    // named outright while the page holds it (B-244): re-queued from the top, not carried on
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "A", artist: "x", context: { kind: "playlist", id: "p.1", label: "Vibes", playing: true } } });
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.1", "shuffle")).toBe("ok");
    expect(injects("__prismMusicPlay").length).toBe(1);

    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ order: "shuffle" });
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.1", "normal")).toBe("ok");
    expect(injects("__prismMusicShuffle(false)").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toBeUndefined();
    // the saved spot (2026-09-17): the player names the track it is on; a plain press or a resume carries on from there in the
    // same order, and any order named outright starts afresh
    calls.length = 0;
    const rv = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }, { id: "3", title: "C", artist: "x" }, { id: "4", title: "D", artist: "x" }] });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rv).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ order: "reverse", spot: 1, count: 4 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "B", artist: "x", context: { trackId: "2", playing: true } } });   // 4,3,2,1: the third
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 3 });
    expect(await drivers.store!.get("music:order:lounge:am")).toContain('"index":2');
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Other", artist: "y", context: { trackId: "zzz", playing: true } } });   // not in the order: the spot stays
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 3 });
    // the plain press on that playlist continues: the rest of the order, from the spot
    calls.length = 0;
    const cont = o.playCollection("am", "playlist", "p.1");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(0);
    expect(injects("__prismMusicQueue")[0]).toContain(JSON.stringify(["2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await cont).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ order: "reverse", spot: 3 });
    // a resume with nothing loaded takes the same road
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: null });
    calls.length = 0;
    const res = o.resumeMusic("am");
    await tick();
    expect(injects("__prismMusicQueue")[0]).toContain(JSON.stringify(["2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await res).toBe("ok");
    // the order named outright starts over: a fresh track read, the spot back at the top
    calls.length = 0;
    const again = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }] });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await again).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 1, count: 2 });
    // in order, named outright, clears the standing order; the plain press then plays in order
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.1", "normal")).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toBeUndefined();
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.1")).toBe("ok");
    expect(injects("__prismMusicPlay").length).toBe(1);
    expect(injects("__prismMusicQueue").length).toBe(0);
    // a station has no order; a service without the hooks cannot do Prism's orders
    expect(await o.playCollection("am", "station", "ra.1", "reverse")).toBe("unsupported");
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "s1", name: "Mix", kind: "playlist", url: "https://open.spotify.com/playlist/s1" }], stations: [] } } });
    expect(await o.playCollection("sp", "playlist", "s1", "true-shuffle")).toBe("unsupported");
  });

  it("a page-route service (2026-09-18, Spotify): its shuffle and repeat follow once its page plays; Prism's orders run through its list and queue like any other", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.orderWindow = 3;
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/" } as never, spotify: { id: "spotify", controls: { play: ".play" }, musicShuffle: "/*s*/", musicRepeat: "/*r*/", musicTracks: "/*t*/", musicQueue: "/*q*/", musicQueueAppend: "/*a*/", musicStartOver: "/*so*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "3Iwd", name: "ABSOLUTE VIDEOGAME", kind: "playlist", url: "https://open.spotify.com/playlist/3Iwd" }], stations: [] } } });
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && c.id === "sp" && String(c.js).includes(fn)).map((c) => String(c.js));
    expect(o.musicOrderSupport("sp")).toEqual({ shuffle: true, own: true, repeat: true });
    // the service's shuffle: the page route (go there, press its Play) - the switch waits for the page to play
    await o.setMusicRepeat("sp", true);
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "3Iwd", "shuffle")).toBe("ok");
    expect(calls.some((c) => c.op === "navigate" && c.id === "sp")).toBe(true);
    expect(injects("__prismMusicShuffle").length).toBe(0);
    await o.onSurfaceEvent({ type: "navigated", id: "sp", url: "https://open.spotify.com/playlist/3Iwd" });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "INVISIBLE", artist: "Duran Duran", context: { kind: "playlist", id: "3Iwd", label: "ABSOLUTE VIDEOGAME", playing: true } } });
    await tick();
    expect(injects("__prismMusicShuffle(true)").length).toBe(1);
    expect(injects("__prismMusicRepeat(true)").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toMatchObject({ order: "shuffle" });
    // in order, named outright while the page already holds and plays this playlist: no page load (B-243), and it STARTS OVER
    // in that order through the page's own start-over (B-244) - a plain press would carry on instead
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "3Iwd", "normal")).toBe("ok");
    expect(calls.some((c) => c.op === "navigate")).toBe(false);
    expect(injects("__prismMusicStartOver(\"playlist\", \"3Iwd\", false)").length).toBe(1);
    expect(injects("__prismMusicRepeat(true)").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toBeUndefined();
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "3Iwd", "shuffle")).toBe("ok");
    expect(injects("__prismMusicStartOver(\"playlist\", \"3Iwd\", true)").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toMatchObject({ order: "shuffle" });
    // the plain press on the held playlist carries on: the switch in place, nothing started over
    calls.length = 0;
    expect(await o.playCollection("sp", "playlist", "3Iwd")).toBe("ok");
    expect(injects("__prismMusicStartOver").length).toBe(0);
    expect(calls.some((c) => c.op === "navigate")).toBe(false);
    expect(injects("__prismMusicShuffle(false)").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toBeUndefined();
    // reverse: the page's list and queue, a window at a time, the spot on the page's word
    calls.length = 0;
    const rev = o.playCollection("sp", "playlist", "3Iwd", "reverse");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "a", title: "A", artist: "x" }, { id: "b", title: "B", artist: "x" }, { id: "c", title: "C", artist: "x" }, { id: "d", title: "D", artist: "x" }] });
    await tick();
    expect(injects("__prismMusicQueue(")[0]).toContain(JSON.stringify(["d", "c", "b"]));
    expect(injects("__prismMusicQueue(")[0]).toContain(JSON.stringify({ kind: "playlist", id: "3Iwd" }));   // the page is told whose ids these are
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rev).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toMatchObject({ order: "reverse", spot: 1, count: 4 });
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "C", artist: "x", context: { kind: "playlist", id: "3Iwd", label: "ABSOLUTE VIDEOGAME", playing: true, trackId: "c" } } });
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toMatchObject({ spot: 2 });
    // an album the page plays is never in the library's lists, but the page named it: the order button may act on it
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "The Last of Us", artist: "Gustavo Santaolalla", context: { kind: "album", id: "2GFF", label: "The Last of Us", url: "https://open.spotify.com/album/2GFF", playing: true } } });
    calls.length = 0;
    const alb = o.playCollection("sp", "album", "2GFF", "reverse");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "x", title: "X", artist: "g" }, { id: "y", title: "Y", artist: "g" }] });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await alb).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "sp")?.musicOrder).toMatchObject({ kind: "album", id: "2GFF", name: "The Last of Us", order: "reverse" });
    expect(await o.playCollection("sp", "album", "nope", "reverse")).toBe("unknown");   // a collection nobody named stays unknown
  });

  it("repeat (2026-09-18): a switch beside the order - the service's repeat-all for its orders, Prism's next pass for its own, a fresh draw for true shuffle", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.orderWindow = 2; o.orderWindowAhead = 1;
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicShuffle: "/*shuffle*/", musicRepeat: "/*repeat*/", musicTracks: "/*tracks*/", musicQueue: "/*queue*/", musicQueueAppend: "/*append*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [] } } });
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
    // the switch stands per tile and rides the state and the store
    expect(o.musicOrderSupport("am").repeat).toBe(true);
    expect(o.musicOrderSupport("sp").repeat).toMatch(/no repeat switch/);
    await o.setMusicRepeat("am", true);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicRepeat).toBe(true);
    expect(await drivers.store!.get("music:repeat:lounge:am")).toBe("1");
    expect(injects("__prismMusicRepeat(true)").length).toBe(1);   // no Prism order stands: the service's switch, now
    // a play in the service's order carries the switch
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.1", "normal")).toBe("ok");
    expect(injects("__prismMusicRepeat(true)").length).toBe(1);
    // a Prism order: the list of three, a window of two; at the end of the list the next pass joins - reverse repeats the same way round
    calls.length = 0;
    const rev = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }, { id: "3", title: "C", artist: "x" }] });
    await tick();
    expect(injects("__prismMusicQueue(")[0]).toContain(JSON.stringify(["3", "2"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rev).toBe("ok");
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "B", artist: "x", context: { trackId: "2", playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend")[0]).toContain(JSON.stringify(["1"]));   // the rest of the pass
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueueAppend"), op: "queue", ok: true });
    await tick();
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "A", artist: "x", context: { trackId: "1", playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend")[0]).toContain(JSON.stringify(["3", "2"]));   // the next pass, the same way round
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueueAppend"), op: "queue", ok: true });
    await tick();
    // into the second pass: the pass behind is dropped, the spot reads from the top again, the state counts the pass
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "C", artist: "x", context: { trackId: "3", playing: true } } });
    await tick();
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 1, count: 3, pass: 2 });
    // repeat off: the list ends where it ends
    await o.setMusicRepeat("am", false);
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "B", artist: "x", context: { trackId: "2", playing: true } } });
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueueAppend"), op: "queue", ok: true });
    await tick();
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "A", artist: "x", context: { trackId: "1", playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend").length).toBe(0);
    // true shuffle repeats with a fresh draw: the next pass holds the same three, once each
    await o.setMusicRepeat("am", true);
    calls.length = 0;
    const ts = o.playCollection("am", "playlist", "p.1", "true-shuffle");
    await tick();
    const first = /__prismMusicQueue\("[^"]+", (\[[^\]]*\])(?:, \{[^}]*\})?\)/.exec(injects("__prismMusicQueue(")[0] ?? "")![1]!;
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await ts).toBe("ok");
    const order = (o as unknown as { musicOrder: Map<string, { ids: string[] }> }).musicOrder.get("am")!.ids;
    expect(order.slice().sort()).toEqual(["1", "2", "3"]);
    expect(JSON.parse(first)).toEqual(order.slice(0, 2));
    calls.length = 0;
    for (const id of order.slice(0, 2)) await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t", artist: "x", context: { trackId: id, playing: true } } });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueueAppend"), op: "queue", ok: true });
    await tick();
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t", artist: "x", context: { trackId: order[2]!, playing: true } } });
    await tick();
    const next = /__prismMusicQueueAppend\("[^"]+", (\[[^\]]*\])(?:, \{[^}]*\})?\)/.exec(injects("__prismMusicQueueAppend")[0] ?? "")![1]!;
    const pass2 = (o as unknown as { musicOrder: Map<string, { ids: string[] }> }).musicOrder.get("am")!.ids.slice(3);
    expect(pass2.slice().sort()).toEqual(["1", "2", "3"]);
    expect(JSON.parse(next)).toEqual(pass2.slice(0, 2));
  });

  it("a newer read supersedes an older one on the tile (2026-09-19): the older question ends at once, and a wait for a read in progress shows in the feed", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicTracks: "/*t*/", musicQueue: "/*q*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }, { id: "p.2", name: "Other", kind: "playlist" }], stations: [] } } });
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
    // the read-ahead of Vibes is under way
    o.prepareOrder("am", "playlist", "p.1");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    // an order on another playlist: its read starts now, and Vibes' question is over
    calls.length = 0;
    const other = o.playCollection("am", "playlist", "p.2", "reverse");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "x", title: "X", artist: "g" }, { id: "y", title: "Y", artist: "g" }] });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await other).toBe("ok");
    // a true shuffle on Vibes now reads afresh instead of waiting on the dead question
    calls.length = 0;
    const vibes = o.playCollection("am", "playlist", "p.1", "true-shuffle");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicWork).toMatchObject({ what: "True shuffle: reading the track list", name: "Vibes" });
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }] });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await vibes).toBe("ok");
    // and a second ask while the same read runs waits for it, with the feed saying so
    o.tracksFreshMs = 0;
    calls.length = 0;
    o.prepareOrder("am", "playlist", "p.1");
    await tick();
    const second = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicWork).toMatchObject({ what: "reading the track list" });
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }] });
    await new Promise((r) => setTimeout(r, 450));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await second).toBe("ok");
  });

  it("a failed read says why (2026-09-19): the feed carries the page's words for a while", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicTracks: "/*t*/", musicQueue: "/*q*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [] } } });
    const rev = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicWork).toMatchObject({ what: "Reverse: reading the track list", name: "Vibes" });
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: false, error: "the page lists no track links to read" });
    expect(await rev).toBe("unsupported");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicWork).toMatchObject({ what: "could not read the track list", name: "Vibes", error: "the page lists no track links to read" });
  });

  it("read ahead (2026-09-18): a playlist playing in the service's order has its list read meanwhile, so a reverse picked later queues at once", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicShuffle: "/*shuffle*/", musicTracks: "/*tracks*/", musicQueue: "/*queue*/", musicQueueAppend: "/*append*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [] } } });
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
    // the order menu opens: the list is read ahead
    calls.length = 0;
    o.prepareOrder("am", "playlist", "p.1");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    o.prepareOrder("am", "playlist", "p.1");   // a read under way is not asked twice
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(1);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }, { id: "3", title: "C", artist: "x" }] });
    await tick();
    // reverse, picked later: no read - straight to the queue
    calls.length = 0;
    const rev = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    expect(injects("__prismMusicTracks").length).toBe(0);
    expect(injects("__prismMusicQueue(")[0]).toContain(JSON.stringify(["3", "2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rev).toBe("ok");
    // a plain play in the service's order reads nothing (2026-09-24: the read had held Spotify's play up for a minute) - only the order menu or an order does
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }, { id: "p.2", name: "Other", kind: "playlist" }], stations: [] } } });
    calls.length = 0;
    expect(await o.playCollection("am", "playlist", "p.2", "normal")).toBe("ok");
    expect(injects("__prismMusicTracks").length).toBe(0);
    await new Promise((r) => setTimeout(r, 3300));
    expect(injects("__prismMusicTracks").length).toBe(0);
  });

  it("windows (2026-09-18): the player holds a window of the order at a time; the next is appended as the spot nears the end; a continue hands a window from the spot", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.orderWindow = 4; o.orderWindowAhead = 1;
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicShuffle: "/*shuffle*/", musicTracks: "/*tracks*/", musicQueue: "/*queue*/", musicQueueAppend: "/*append*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Long", kind: "playlist" }], stations: [] } } });
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
    const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const rev = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: ids.map((id) => ({ id, title: "t" + id, artist: "x" })) });
    await tick();
    // the first window only: 10,9,8,7
    expect(injects("__prismMusicQueue(")[0]).toContain(JSON.stringify(["10", "9", "8", "7"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rev).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ count: 10, spot: 1 });
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    // the spot moves to the third of the window: not yet within 1 of its end
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t8", artist: "x", context: { trackId: "8", playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend").length).toBe(0);
    // the fourth: within 1 of the end - the next window (6,5,4,3) is appended, nothing re-queued
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t7", artist: "x", context: { trackId: "7", playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend")[0]).toContain(JSON.stringify(["6", "5", "4", "3"]));
    expect(injects("__prismMusicQueue(").length).toBe(0);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueueAppend"), op: "queue", ok: true });
    await tick();
    // the spot keeps walking into the appended part; the last window (2,1) comes when it nears the end of that one
    calls.length = 0;
    for (const id of ["6", "5", "4"]) await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t" + id, artist: "x", context: { trackId: id, playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend").length).toBe(0);
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t3", artist: "x", context: { trackId: "3", playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend")[0]).toContain(JSON.stringify(["2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueueAppend"), op: "queue", ok: true });
    await tick();
    // everything handed: no more appends
    calls.length = 0;
    for (const id of ["2", "1"]) await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t" + id, artist: "x", context: { trackId: id, playing: true } } });
    await tick();
    expect(injects("__prismMusicQueueAppend").length).toBe(0);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 10, count: 10 });
    // a continue from a spot hands a window from there, not the whole rest
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "t9", artist: "x", context: { trackId: "9", playing: true } } });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: null });
    calls.length = 0;
    const cont = o.resumeMusic("am");
    await tick();
    expect(injects("__prismMusicQueue(")[0]).toContain(JSON.stringify(["9", "8", "7", "6"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await cont).toBe("ok");
  });

  it("stall watchdog (2026-09-18): a player saying playing with a frozen clock is re-queued from the spot; a second stall on the same track skips it; a third stands", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicShuffle: "/*shuffle*/", musicTracks: "/*tracks*/", musicQueue: "/*queue*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [] } } });
    const injects = (fn: string) => calls.filter((c) => c.op === "inject" && String(c.js).includes(fn)).map((c) => String(c.js));
    const rev = o.playCollection("am", "playlist", "p.1", "reverse");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }, { id: "3", title: "C", artist: "x" }] });
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rev).toBe("ok");
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    expect(o.getState()?.audioOwner).toBe("am");
    const face = (pos: number) => o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "C", artist: "x", position: pos, duration: 153, context: { trackId: "3", playing: true, position: pos, duration: 153 } } });
    const watch = (o as unknown as { stallWatch: Map<string, { since: number }> }).stallWatch;
    // the clock moves: no stall
    await face(30); await face(31);
    calls.length = 0;
    watch.get("am")!.since -= 20_000;
    await face(32);
    expect(injects("__prismMusicQueue").length).toBe(0);
    // the clock stands still for longer than STALL_MS while faces keep arriving: the queue again from the spot (track 3 of the order)
    await face(32); watch.get("am")!.since -= 20_000;
    const p1 = face(32);
    await tick();
    expect(injects("__prismMusicQueue")[0]).toContain(JSON.stringify(["3", "2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    await p1;
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.stall).toMatchObject({ strikes: 1, spot: 1 });
    // the same track stalls again: past it
    calls.length = 0;
    await face(32); watch.get("am")!.since -= 20_000;
    const p2 = face(32);
    await tick();
    expect(injects("__prismMusicQueue")[0]).toContain(JSON.stringify(["2", "1"]));
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    await p2;
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.stall).toMatchObject({ strikes: 2, spot: 2 });
    // a third: nothing more is tried, the state says so
    calls.length = 0;
    await face(32); watch.get("am")!.since -= 20_000;
    await face(32);
    await tick();
    expect(injects("__prismMusicQueue").length).toBe(0);
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.stall).toMatchObject({ strikes: 3, spot: null });
    // B-233: a track played from another collection does not move the spot, even when the order holds the same song; and
    // Start over on a Prism-ordered play is the same order from its first track, not the page's remembered collection
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "A", artist: "x", position: 5, duration: 100, context: { trackId: "1", kind: "station", id: "ra.9", label: "Some Station", playing: true, position: 5 } } });
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 1 });   // where the last stalled face (track 3, the first of the order) left it - not "A" at 3
    calls.length = 0;
    const rs = o.restartMusic("am");
    await tick();
    expect(injects("__prismMusicQueue")[0]).toContain(JSON.stringify(["3", "2", "1"]));
    expect(injects("__prismMusicPlay").length).toBe(0);
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await rs).toBe("ok");
    expect(o.getState()?.tiles.find((t) => t.id === "am")?.musicOrder).toMatchObject({ spot: 1 });
    // a paused face, or a tile without the audio, is never a stall
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "C", artist: "x", position: 32, duration: 153, context: { trackId: "3", playing: false, position: 32 } } });
    expect(watch.has("am")).toBe(false);
  });

  it("section 3 amended (2026-09-17): a music source that loses the audio is paused through its own player, not left streaming in silence", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicCmd: "/*cmd*/" } as never, spotify: { id: "spotify", controls: { play: ".play", pause: ".pause" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    // Apple plays and owns the audio
    o.arm("am");
    await o.onSurfaceEvent({ type: "playback", id: "am", playing: true });
    expect(o.getState()?.audioOwner).toBe("am");
    // a person picks Spotify: Apple is muted AND paused, through MusicKit (its musicCmd)
    calls.length = 0;
    expect(await o.tileCommand("sp", "unmute")).toBe("ok");
    expect(calls.some((c) => c.op === "setMuted" && c.id === "am" && c.muted === true)).toBe(true);
    const pause = calls.find((c) => c.op === "inject" && c.id === "am" && /__prismMusicCmd\("pause"\)/.test(String(c.js)));
    expect(pause).toBeTruthy();
    // the switch back resumes it through its own play
    calls.length = 0;
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "Ashes", artist: "Bear McCreary" } });
    expect(await o.switchToService("am")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "am" && /__prismMusicCmd && window.__prismMusicCmd\("play"\)/.test(String(c.js)))).toBe(true);
  });

  it("B-229 (2026-09-17): one station per name in the menu - a page play the adapter could not pin an id to does not twin a kept one, and a kept one does not twin the page's own", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    // the page plays All Hits Radio with its id, then again from a page that showed no item (the adapter's name-only id)
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Mexico Honey", artist: "Kacey Musgraves", context: { kind: "station", id: "A3T0EGWSD7I0PD", label: "All Hits Radio", url: "https://music.amazon.com/stations/A3T0EGWSD7I0PD" } } });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Levitation", artist: "Aaron Hibell", context: { kind: "station", id: "station:all-hits-radio", label: "All Hits Radio" } } });
    let lib = await o.musicLibrary("am");
    expect(lib.stations.map((s) => s.id)).toEqual(["A3T0EGWSD7I0PD"]);
    // the other way round: the name-only play came first, then the real id - the real one replaces it
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "x", artist: "y", context: { kind: "station", id: "station:chill-radio", label: "Chill Radio" } } });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "x", artist: "y", context: { kind: "station", id: "B0CHILL1", label: "Chill Radio", url: "https://music.amazon.com/stations/B0CHILL1" } } });
    lib = await o.musicLibrary("am");
    expect(lib.stations.map((s) => s.id).sort()).toEqual(["A3T0EGWSD7I0PD", "B0CHILL1"]);
    // the page's own library lists All Hits Radio under yet another id: the page's entry shows, the kept twin does not
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "x", artist: "y", library: { playlists: [], stations: [{ id: "page-all-hits", name: "All Hits Radio", kind: "station" }] } } });
    lib = await o.musicLibrary("am");
    expect(lib.stations.map((s) => s.id).sort()).toEqual(["B0CHILL1", "page-all-hits"]);
  });

  it("B-228 (2026-09-17): nothing has a face, but the stage draws what its source would resume - that is the song; and the two kinds of unavailable are told apart", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, pandora: { id: "pandora", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    // nothing on the wall has a face yet: the only song is the one the wall would resume, and there is none stored
    expect(o.currentSong()).toBeNull();
    expect(await o.musicLookup("sp")).toBe("unavailable");
    expect(o.musicLookupState("sp")).toMatchObject({ status: "unavailable", why: "no-song" });
    // Apple played once (the resume point is stored), then its page went quiet: no face, but the stage's block names it
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: true, title: "Ashes", artist: "Bear McCreary", album: "God of War", context: { url: "https://music.apple.com/us/album/god-of-war/1", label: "God of War", kind: "album" } } });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: null });
    (o as unknown as { lastSongSeen: null }).lastSongSeen = null;   // past the blink window
    expect(o.currentSong()).toMatchObject({ title: "Ashes", artist: "Bear McCreary", from: "am" });
    calls.length = 0;
    const pending = o.musicLookup("sp");
    await tick();
    expect(tokenOf(calls, "__prismMusicLookup")).not.toBe("");
    expect(o.musicLookupState("sp")).toMatchObject({ status: "searching", song: { title: "Ashes" } });
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [] });
    expect(await pending).toBe("not-found");
    // a service with no lookup at all is the other kind (Apple's adapter re-registered without one; a different song so no settled answer is reused)
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never, spotify: { id: "spotify", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Spend Dat", artist: "Yung Miami" } });
    expect(await o.musicLookup("am")).toBe("unavailable");
    expect(o.musicLookupState("am")).toMatchObject({ status: "unavailable", why: "no-lookup" });
  });

  it("a paused track on the stage is the song on the wall (B-214)", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never });
    await o.load(doc, { w: 1000, h: 625 });
    // the stage draws Apple; Apple holds a track, paused; nothing owns the audio and nothing says playing
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "Ashes", artist: "Bear McCreary", album: "God of War" } });
    expect(o.currentSong()).toMatchObject({ title: "Ashes", artist: "Bear McCreary", from: "am" });
    // Spotify is asked for it: the page gets the song, not "nothing is playing on the wall"
    calls.length = 0;
    const pending = o.musicLookup("sp");
    await tick();
    expect(tokenOf(calls, "__prismMusicLookup")).not.toBe("");
    expect(o.musicLookupState("sp")).toMatchObject({ status: "searching", song: { title: "Ashes", artist: "Bear McCreary" } });
    await o.onSurfaceEvent({ type: "music-result", id: "sp", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [{ id: "x", title: "Ashes", artist: "Bear McCreary", album: "God of War" }] });
    expect(await pending).toBe("found");
    expect(o.musicLookupState("sp")).toMatchObject({ status: "found", match: { id: "x" }, confidence: { percent: 98 } });   // title, artist and album all agree
    // B-227: opening the entry again reuses the answer but asks the page for a fresh report (its playlists as of now)
    const reports = () => calls.filter((c) => c.op === "inject" && String(c.js).includes("__prismReportNow")).length;
    const before = reports();
    expect(await o.musicLookup("sp")).toBe("found");
    expect(reports()).toBe(before + 1);
    expect(calls.filter((c) => c.op === "inject" && String(c.js).includes("__prismMusicLookup")).length).toBe(1);   // no second search
  });

  it("a lone title-only hit is the answer with its confidence, the face's length counted, and no chooser (2026-09-17)", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Gunna - flow 2", artist: "Veniso", context: { duration: 117 } } });
    expect(o.currentSong()).toMatchObject({ title: "Gunna - flow 2", durationMs: 117000 });
    const pending = o.musicLookup("am");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [
      { id: "1653670702", title: "Gunna Flow", artist: "C2", durationMs: 195291 },
      { id: "1702536301", title: "Gunna Flow 2 (feat. Bgunna)", artist: "Recklezz Dely", durationMs: 192980 },
    ] });
    expect(await pending).toBe("found");
    const st = o.musicLookupState("am");
    expect(st).toMatchObject({ status: "found", match: { id: "1702536301" }, confidence: { percent: 35, because: ["title matches", "artist differs", "length differs"] } });
    expect(st.candidates.length).toBe(1);
    expect(st.picked).toBeUndefined();
  });

  it("a pick among candidates is marked and survives the face blinking empty for a beat", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicLookup: "/*lookup*/" } as never, spotify: { id: "spotify", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "Lullaby of the Giants", artist: "Bear McCreary" } });
    const pending = o.musicLookup("am");
    await tick();
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicLookup"), op: "lookup", ok: true, candidates: [
      { id: "a", title: "Lullaby of the Giants", artist: "Someone Else" },
      { id: "b", title: "Lullaby of the Giants (Live)", artist: "Bear McCreary Orchestra" },
      { id: "c", title: "Lullaby", artist: "Bear McCreary" },
    ] });
    expect(await pending).toBe("ambiguous");
    expect(o.musicLookupPick("am", "b")).toBe(true);
    expect(o.musicLookupState("am")).toMatchObject({ status: "found", picked: true, match: { id: "b" } });
    // the owner's face blinks empty (Amazon Music's Media Session drops its metadata for a tick, 2026-09-16)
    await o.onSurfaceEvent({ type: "now-playing", id: "sp", info: { playing: true, title: "", artist: "" } });
    expect(o.currentSong()?.title).toBe("Lullaby of the Giants");   // the song seen a moment ago still counts
    expect(await o.musicLookup("am")).toBe("found");               // the pick stands; nothing was wiped
    expect(o.musicLookupState("am")).toMatchObject({ status: "found", picked: true, match: { id: "b" } });
    expect(o.musicLookupPick("am", "zzz")).toBe(false);
  });
  it("a Prism order read while the other source plays on (2026-10-05): the audio changes hands only when the ordered list is ready", async () => {
    const { drivers, calls } = fakeDrivers();
    (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" }, musicPlay: "/*play*/", musicTracks: "/*tracks*/", musicQueue: "/*queue*/" } as never, spotify: { id: "spotify", controls: { play: ".play", pause: ".pause" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    await o.onSurfaceEvent({ type: "now-playing", id: "am", info: { playing: false, title: "", artist: "", library: { playlists: [{ id: "p.1", name: "Vibes", kind: "playlist" }], stations: [] } } });
    // Spotify plays and owns the audio
    o.arm("sp");
    await o.onSurfaceEvent({ type: "playback", id: "sp", playing: true });
    expect(o.getState()?.audioOwner).toBe("sp");
    calls.length = 0;
    const ts = o.playCollection("am", "playlist", "p.1", "true-shuffle");
    await tick();
    // the list is being read: Spotify still has the audio, nothing muted or paused it
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicTracks"))).toBe(true);
    expect(calls.some((c) => c.op === "setMuted" && c.id === "sp" && c.muted === true)).toBe(false);
    expect(o.getState()?.audioOwner).toBe("sp");
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicTracks"), op: "tracks", ok: true, candidates: [{ id: "1", title: "A", artist: "x" }, { id: "2", title: "B", artist: "x" }] });
    await tick();
    // the list is ordered and handed over: now Spotify goes quiet and Apple takes the audio
    expect(calls.some((c) => c.op === "inject" && String(c.js).includes("__prismMusicQueue"))).toBe(true);
    expect(calls.some((c) => c.op === "setMuted" && c.id === "sp" && c.muted === true)).toBe(true);
    expect(o.getState()?.audioOwner).toBe("am");
    await o.onSurfaceEvent({ type: "music-result", id: "am", token: tokenOf(calls, "__prismMusicQueue"), op: "queue", ok: true });
    expect(await ts).toBe("ok");
  });
});
