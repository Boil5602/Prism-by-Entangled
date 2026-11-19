import { describe, expect, it } from "vitest";
import { MusicPanelNav, coverAskJs, playChoices, isBareKind, jumpBackIn, libraryMatches, libraryRows, orderServices, pickUpLine, pictureOf, recentPicture, realName, serviceBadge, serviceStatus, type PanelSource } from "../src/music-panel.js";

/**
 * The music panel (2026-11-16): navigation between its screens and the lists it shows. One panel; a row replaces the content,
 * Back and Escape return one level, Back at Home closes it.
 */
describe("music panel: navigation", () => {
  it("opens at Home with nothing to go back to", () => {
    const nav = new MusicPanelNav();
    expect(nav.state().open).toBe(false);
    expect(nav.open()).toEqual({ open: true, screen: "home", arg: null, canBack: false, depth: 1 });
  });

  it("a row replaces the content and Back returns one level", () => {
    const nav = new MusicPanelNav();
    nav.open();
    expect(nav.go("service", "apple")).toEqual({ open: true, screen: "service", arg: "apple", canBack: true, depth: 2 });
    expect(nav.back()).toEqual({ open: true, screen: "home", arg: null, canBack: false, depth: 1 });
  });

  it("Back at Home closes the panel", () => {
    const nav = new MusicPanelNav();
    nav.open();
    expect(nav.back().open).toBe(false);
    expect(nav.go("scenes").open).toBe(false);   // a closed panel goes nowhere
  });

  it("every screen is reached from Home and returns to it", () => {
    for (const screen of ["upnext", "add", "station", "scenes", "history"]) {
      const nav = new MusicPanelNav();
      nav.open();
      expect(nav.go(screen).screen).toBe(screen);
      expect(nav.back().screen).toBe("home");
    }
  });

  it("the same screen is shown again with its new argument, never stacked on itself", () => {
    const nav = new MusicPanelNav();
    nav.open();
    nav.go("service", "apple");
    expect(nav.go("service", "spotify")).toMatchObject({ screen: "service", arg: "spotify", depth: 2 });
    expect(nav.back().screen).toBe("home");
  });

  it("a second level returns to the first, and never goes deeper than three", () => {
    const nav = new MusicPanelNav();
    nav.open();
    nav.go("service", "apple");
    expect(nav.go("add", "apple")).toMatchObject({ screen: "add", depth: 3 });
    expect(nav.go("history")).toMatchObject({ screen: "history", depth: 3 });
    expect(nav.back()).toMatchObject({ screen: "service", arg: "apple" });
    expect(nav.back().screen).toBe("home");
  });

  it("Home from anywhere empties the stack; an unknown screen or a library with no service changes nothing", () => {
    const nav = new MusicPanelNav();
    nav.open();
    nav.go("service", "apple"); nav.go("add");
    expect(nav.go("home")).toEqual({ open: true, screen: "home", arg: null, canBack: false, depth: 1 });
    expect(nav.go("settings").screen).toBe("home");
    expect(nav.go("service").screen).toBe("home");
    expect(nav.go("service", "").screen).toBe("home");
  });
});

const apple: PanelSource = {
  tile: "apple", name: "Apple Music", session: "signed-in", playing: true,
  recents: [
    { url: "https://music.example/station/1", label: "Morning Station", kind: "station", id: "ra.1", at: 500 },
    { url: "https://music.example/playlist/2", label: "playlist", kind: "playlist", id: "pl.2", at: 400 },
    { url: "https://music.example/album/3", label: "Album", kind: "album", album: "Tall Grass", at: 300 },
    { url: "https://music.example/playlist/9", label: "Playlist", kind: "playlist", id: "pl.gone", at: 250 },
  ],
  playlists: [{ id: "pl.2", name: "Evening Beats", kind: "playlist" }, { id: "pl.5", name: "Road Mix", kind: "playlist", edit: true }, { id: "pl.6", name: "Beats to Think To", kind: "playlist", edit: false }],
  stations: [{ id: "ra.1", name: "Morning Station", kind: "station" }, { id: "ra.7", name: "The Beatles", kind: "station" }],
};
const pandora: PanelSource = { tile: "pandora", name: "Pandora", session: "signed-out", recents: [{ url: "https://radio.example/s/4", label: "Upbeat Radio", kind: "station", at: 450 }], playlists: [], stations: [] };
const amazon: PanelSource = { tile: "amazon", name: "Amazon Music", session: "signed-in", recents: [{ url: "https://amzn.example/albums/5", label: "Paper Boats", kind: "album", at: 100 }], playlists: [], stations: [] };

describe("music panel: jump back in", () => {
  it("is one list across the services, newest first", () => {
    const rows = jumpBackIn([amazon, apple, pandora]);
    expect(rows.map((r) => r.name)).toEqual(["Morning Station", "Upbeat Radio", "Evening Beats", "Tall Grass", "Paper Boats"]);
    expect(rows[0]).toMatchObject({ tile: "apple", meta: "Station · Apple Music", url: "https://music.example/station/1", id: "ra.1" });
  });

  it("shows the real name, from the library or the album, and never a bare kind word", () => {
    expect(isBareKind(" Playlist ")).toBe(true);
    expect(realName(apple.recents[1]!, apple.playlists)).toBe("Evening Beats");
    expect(realName(apple.recents[2]!, [])).toBe("Tall Grass");
    expect(realName(apple.recents[3]!, apple.playlists)).toBeNull();
    expect(jumpBackIn([apple]).some((r) => isBareKind(r.name))).toBe(false);
  });

  it("marks a signed-out service's row, keeps one row an address, and holds to the limit", () => {
    expect(jumpBackIn([pandora])[0]).toMatchObject({ signedOut: true, meta: "Station · Pandora · sign in first" });
    const twice = { ...amazon, recents: [...amazon.recents, { ...amazon.recents[0]!, at: 50 }] };
    expect(jumpBackIn([twice])).toHaveLength(1);
    expect(jumpBackIn([amazon, apple, pandora], 2)).toHaveLength(2);
    const tuned = { ...pandora, session: "signed-in", recents: [{ url: "https://radio.example/s/4?a", label: "Hits Radio", kind: "station", at: 10 }, { url: "https://radio.example/s/4?b", label: "Hits Radio", kind: "station", at: 30 }, { url: "https://radio.example/s/4?c", label: "hits radio", kind: "station", at: 20 }] };
    expect(jumpBackIn([tuned])).toEqual([expect.objectContaining({ name: "Hits Radio", url: "https://radio.example/s/4?b", at: 30 })]);
  });
});

describe("music panel: pictures", () => {
  const art = "https://img.example/a.jpg";
  const lib = [{ id: "pl.2", name: "Evening Beats", kind: "playlist" as const, artwork: art }, { id: "ra.1", name: "Morning Station", kind: "station" as const, artwork: "http://img.example/plain.jpg" }];
  it("takes only an https address", () => {
    expect(pictureOf(art)).toBe(art);
    expect(pictureOf("http://img.example/a.jpg")).toBeNull();
    expect(pictureOf("data:image/png;base64,AAAA")).toBeNull();
    expect(pictureOf(null)).toBeNull();
  });
  it("gives a recent the library's picture of the same collection, by id or by kind and name, before the one kept with it", () => {
    const kept = "https://img.example/track.jpg";
    expect(recentPicture({ url: "u", label: "x", kind: "playlist", id: "pl.2", artwork: kept, at: 1 }, "Evening Beats", lib)).toBe(art);
    expect(recentPicture({ url: "u", label: "x", kind: "playlist", at: 1 }, "evening beats", lib)).toBe(art);
    expect(recentPicture({ url: "u", label: "x", kind: "station", id: "ra.1", artwork: kept, at: 1 }, "Morning Station", lib)).toBe(kept);
    expect(recentPicture({ url: "u", label: "x", kind: "album", at: 1 }, "Tall Grass", lib)).toBeNull();
    expect(recentPicture({ url: "u", label: "x", kind: "album", at: 1 }, "Tall Grass", lib, { album: "tall grass", artwork: kept })).toBe(kept);
    expect(recentPicture({ url: "u", label: "x", kind: "playlist", at: 1 }, "Tall Grass", lib, { album: "Tall Grass", artwork: kept })).toBeNull();
  });
  it("carries the picture on the rows of every list", () => {
    const src = { ...apple, playlists: [{ ...apple.playlists[0]!, artwork: art }, ...apple.playlists.slice(1)] };
    expect(jumpBackIn([src]).find((r) => r.name === "Evening Beats")!.artwork).toBe(art);
    expect(jumpBackIn([src]).find((r) => r.name === "Tall Grass")!.artwork).toBeUndefined();
    expect(libraryMatches("evening", [src])[0]!.artwork).toBe(art);
    expect(libraryRows(src.playlists, null).map((r) => r.artwork)).toEqual([art, null, null]);
  });
});

describe("music panel: in your library", () => {
  it("finds playlists and stations by the words typed, names that begin with them first, each group A to Z", () => {
    expect(libraryMatches("bea", [apple]).map((r) => r.name)).toEqual(["Beats to Think To", "Evening Beats", "The Beatles"]);
    expect(libraryMatches("BEATLES", [apple])[0]).toMatchObject({ kind: "station", meta: "Station · Apple Music", id: "ra.7" });
  });
  it("is empty for no words, and leaves a signed-out service out", () => {
    expect(libraryMatches("  ", [apple])).toEqual([]);
    expect(libraryMatches("radio", [{ ...pandora, stations: [{ id: "s", name: "Radio One", kind: "station" }] }])).toEqual([]);
  });
});

describe("music panel: the service rows and a service's library", () => {
  it("says what the library holds, else the last thing played, else that it is signed out", () => {
    expect(serviceStatus(apple)).toBe("3 playlists · 2 stations");
    expect(serviceStatus({ ...apple, playlists: [apple.playlists[0]!], stations: [] })).toBe("1 playlist");
    expect(serviceStatus(amazon)).toBe("Last played: Paper Boats");
    expect(serviceStatus({ ...amazon, recents: [] })).toBe("Nothing played yet");
    expect(serviceStatus(pandora)).toBe("Not signed in");
  });
  it("badges the playing service and a signed-out one", () => {
    expect(serviceBadge(apple)).toBe("Playing");
    expect(serviceBadge(pandora)).toBe("Sign in");
    expect(serviceBadge({ ...pandora, playing: true })).toBe("Sign in");
    expect(serviceBadge(amazon)).toBeNull();
  });
  it("lists the playing service first, then the one on the screen, the rest as they were added", () => {
    const order = (list: PanelSource[]) => orderServices(list).map((s) => s.tile);
    expect(order([amazon, pandora, apple])).toEqual(["apple", "amazon", "pandora"]);
    expect(order([pandora, { ...amazon, active: true }, { ...apple, playing: false }])).toEqual(["amazon", "pandora", "apple"]);
    expect(order([{ ...pandora, active: true }, amazon])).toEqual(["pandora", "amazon"]);
  });
  it("offers the saved place only on the collection that holds it", () => {
    const order = { kind: "playlist", id: "pl.5", count: 200, spot: 40 };
    expect(pickUpLine({ id: "pl.5" }, order)).toBe("Pick up at 40 of 200");
    expect(pickUpLine({ id: "pl.2" }, order)).toBeNull();
    expect(pickUpLine({ id: "pl.5" }, { kind: "playlist", id: "pl.5", count: 200 })).toBeNull();
    expect(pickUpLine({ id: "pl.5" }, null)).toBeNull();
  });
  it("lists a tab in the service's order, narrowed by the filter", () => {
    const order = { kind: "playlist", id: "pl.5", count: 200, spot: 40 };
    expect(libraryRows(apple.playlists, order).map((r) => [r.name, r.sub, r.edit])).toEqual([["Evening Beats", null, true], ["Road Mix", "Pick up at 40 of 200", true], ["Beats to Think To", null, false]]);
    expect(libraryRows(apple.playlists, order, "road").map((r) => r.name)).toEqual(["Road Mix"]);
    expect(libraryRows(apple.stations, { kind: "station", id: "ra.1", count: 5, spot: 2 })[0]!.sub).toBeNull();
  });
});

describe("music panel: the page's ask for a cover", () => {
  // the script as a service's page would run it, with a stand-in window, location and fetch
  async function run(route: string, url: string, answer: { ok: boolean; body: string } | "fail") {
    const asked: string[] = [];
    const win: { __prismCover?: Record<string, string> } = {};
    const fetchStub = (u: string) => { asked.push(u); return answer === "fail" ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: answer.ok, text: () => Promise.resolve(answer.body) }); };
    const said = new Function("window", "location", "fetch", "return " + coverAskJs(route, url))(win, { origin: "https://music.example" }, fetchStub) as string;
    await new Promise((r) => setTimeout(r, 5));
    return { said, asked, got: win.__prismCover?.[url], win, again: () => new Function("window", "location", "fetch", "return " + coverAskJs(route, url))(win, { origin: "https://music.example" }, fetchStub) as string };
  }
  const album = "https://music.example/album/tall-grass/1";
  it("reads the collection page's og:image", async () => {
    const r = await run("og", album, { ok: true, body: '<head><meta property="og:image" content="https://img.example/c.jpg?a=1&amp;b=2"><meta property="og:title" content="x"></head>' });
    expect(r.said).toBe("started");
    expect(r.asked).toEqual([album]);
    expect(r.got).toBe("https://img.example/c.jpg?a=1&b=2");
  });
  it("reads the embed address's thumbnail", async () => {
    const r = await run("oembed:/oembed?url={url}", album, { ok: true, body: JSON.stringify({ thumbnail_url: "https://img.example/t.jpg" }) });
    expect(r.asked).toEqual(["https://music.example/oembed?url=" + encodeURIComponent(album)]);
    expect(r.got).toBe("https://img.example/t.jpg");
  });
  it("answers empty for a page with no cover, a refusal or a failed fetch, and asks an address once", async () => {
    expect((await run("og", album, { ok: true, body: "<head></head>" })).got).toBe("");
    expect((await run("og", album, { ok: false, body: "" })).got).toBe("");
    expect((await run("oembed:/oembed?url={url}", album, { ok: true, body: "not json" })).got).toBe("");
    const failed = await run("og", album, "fail");
    expect(failed.got).toBe("");
    expect(failed.again()).toBe("have");
    expect(failed.asked).toHaveLength(1);
  });
});

describe("music panel: a playlist's play choices", () => {
  const item = { id: "pl.5" };
  it("offers Resume with the place and its order, picked, where PRISM holds a place", () => {
    const c = playChoices(item, { kind: "playlist", id: "pl.5", spot: 40, count: 200, order: "true-shuffle" }, true);
    expect(c.resume).toEqual({ line: "Song 40 of 200 · True shuffle", how: "order" });
    expect(c.picked).toBe("resume");
    expect(c.orders.map((o) => o.label)).toEqual(["In order", "Reverse", "True shuffle"]);
    expect(c.orders.every((o) => o.can)).toBe(true);
  });
  it("offers no Resume for another playlist or a place with no count, and picks In order", () => {
    expect(playChoices(item, { kind: "playlist", id: "pl.2", spot: 3, count: 9, order: "reverse" }, true)).toMatchObject({ resume: null, picked: "normal" });
    expect(playChoices(item, { kind: "playlist", id: "pl.5", count: 9 }, true).resume).toBeNull();
    expect(playChoices(item, null, true).resume).toBeNull();
  });
  it("offers Resume at the player's own place after a play in order, and PRISM's place before it", () => {
    expect(playChoices(item, null, true, { id: "pl.5", title: "Paper Boats" })).toMatchObject({ resume: { line: "Paper Boats · In order", how: "player" }, picked: "resume" });
    expect(playChoices(item, null, true, { id: "pl.5" }).resume).toEqual({ line: "In order", how: "player" });
    expect(playChoices(item, null, true, { id: "pl.2", title: "Paper Boats" })).toMatchObject({ resume: null, picked: "normal" });
    // the place kept for a play in order that gave way (2026-11-16): the song, resumed through PRISM's order
    expect(playChoices(item, { kind: "playlist", id: "pl.5", order: "normal", kept: true, song: "Tall Grass" }, true, { id: "pl.2", title: "Paper Boats" })).toMatchObject({ resume: { line: "Tall Grass · In order", how: "order" }, picked: "resume" });
    expect(playChoices(item, { kind: "playlist", id: "pl.5", order: "normal", kept: true, song: "Tall Grass" }, true, { id: "pl.5", title: "Paper Boats" }).resume).toMatchObject({ how: "player" });
    expect(playChoices(item, { kind: "playlist", id: "pl.5", spot: 40, count: 200, order: "reverse" }, true, { id: "pl.5", title: "Paper Boats" }).resume).toEqual({ line: "Song 40 of 200 · Reverse", how: "order" });
  });
  it("lists an order the service cannot take with the reason, not to be picked", () => {
    const c = playChoices(item, null, "no track lists yet");
    expect(c.orders.map((o) => [o.order, o.can, o.why])).toEqual([["normal", true, null], ["reverse", false, "no track lists yet"], ["true-shuffle", false, "no track lists yet"]]);
  });
  it("the panel goes from a library to a playlist's choices and back", () => {
    const nav = new MusicPanelNav();
    nav.open(); nav.go("service", "one"); nav.go("play", "one|pl.5");
    expect(nav.state()).toMatchObject({ screen: "play", arg: "one|pl.5", depth: 3 });
    expect(nav.back()).toMatchObject({ screen: "service", arg: "one" });
  });
});
