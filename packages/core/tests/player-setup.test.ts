import { describe, it, expect } from "vitest";
import { SceneModelStore } from "../src/scene-model-store.js";
import { setupPlayers, setupServices, setupKindOf, type SetupEntry } from "../src/player-setup.js";
import { playerScenes } from "../src/players.js";
import { sceneDocument } from "../src/scene-model.js";

const FHD = { w: 1920, h: 1080 };
const E = (id: string, name: string, url: string, audio: string | null = "exclusive"): SetupEntry => ({ id, name, url, adapter: null, audio });
const CATALOG: SetupEntry[] = [
  E("netflix", "Netflix", "https://www.netflix.com/browse"), E("hulu", "Hulu", "https://www.hulu.com/hub/home"),
  E("spotify", "Spotify", "https://open.spotify.com/"), E("apple-music", "Apple Music", "https://music.apple.com/"),
  E("weather", "Weather", "https://www.weather.gov/", "mute"), E("prism-timer", "Timer", "https://tiles.prism/timer/", null),
];
const MUSIC = new Set(["spotify", "apple-music"]);
const speaks = (e: SetupEntry) => MUSIC.has(e.id);
const fresh = () => { const kv = new Map<string, string>(); const m = new SceneModelStore({ get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) }); m.load(); return { m, kv }; };
const found = (m: SceneModelStore) => playerScenes(m.snapshot().scenes, (id) => m.layout(id), (id) => m.facet(id), m.activeScene());

describe("the players, set up from the services chosen (2026-09-29)", () => {
  it("lists music and video services; a page with no sound of its own is neither", () => {
    expect(setupKindOf(CATALOG[4]!, speaks)).toBeNull();
    const { m } = fresh();
    expect(setupServices(m, CATALOG, speaks).map((s) => s.id + ":" + s.kind + ":" + s.added)).toEqual(["apple-music:music:false", "spotify:music:false", "hulu:video:false", "netflix:video:false"]);
  });

  it("an empty device gets both players: the stage over every music service, the first video service on the screen", () => {
    const { m } = fresh();
    const r = setupPlayers(m, CATALOG, speaks, FHD);
    expect(r).toMatchObject({ ok: true });
    const p = found(m);
    expect(p.music?.id).toBe(r.music);
    expect(p.video?.id).toBe(r.video);
    expect(p.music!.hidden.map((h) => h.facet)).toEqual(["spotify-home-16x9-XL", "apple-music-home-16x9-XL"]);
    expect(p.music!.visualizations).toEqual([expect.objectContaining({ source: "spotify-home-16x9-XL", style: "sunrise-meadow", artwork: "focal" })]);
    expect(p.music!.assign.stage).toBe(p.music!.visualizations![0]!.id);
    expect(p.video!.assign.screen).toBe("netflix-home-16x9-XL");
    expect(p.video!.hidden).toEqual([]);   // the two players are separate: no music service in the Video player's scene
    expect(m.facet("hulu-home-16x9-XL")).toMatchObject({ app: "hulu", audio: "exclusive" });
    expect(m.facet("spotify-home-16x9-XL")).toMatchObject({ music: true });
    expect(m.app("netflix")).toMatchObject({ profileId: "shared", setup: { status: "unknown" }, render: { persist: true, audio: "exclusive" } });
    expect(m.app("weather")).toBeUndefined();
    // both draw
    for (const s of [p.music!, p.video!]) expect(sceneDocument({ scene: s, layout: m.layout(s.layout)!, facets: new Map(m.snapshot().facets.map((f) => [f.id, f])), apps: new Map(m.snapshot().apps.map((a) => [a.id, a])) }, "d", FHD).doc.tiles.length).toBeGreaterThan(0);
    expect(setupServices(m, CATALOG, speaks).every((s) => s.added)).toBe(true);
  });

  it("a new player opens on the service its template suggests first, whatever the catalog's order", () => {
    const { m } = fresh();
    const cat = [E("appletv", "Apple TV", "https://tv.apple.com/"), E("tubi", "Tubi", "https://tubitv.com/home"), E("hulu", "Hulu", "https://www.hulu.com/hub/home"), E("amazon-music", "Amazon Music", "https://music.amazon.com/"), E("apple-music", "Apple Music", "https://music.apple.com/")];
    setupPlayers(m, cat, (e) => /music/.test(e.id), FHD);
    expect(found(m).video!.assign.screen).toBe("hulu-home-16x9-XL");
    expect(found(m).music!.visualizations![0]!.source).toBe("apple-music-home-16x9-XL");
    expect(found(m).music!.hidden.map((h) => h.facet)).toEqual(["apple-music-home-16x9-XL", "amazon-music-home-16x9-XL"]);
  });

  it("a second run with more services adds them to the players that stand; nothing is made twice, nothing removed", () => {
    const { m } = fresh();
    const first = setupPlayers(m, CATALOG.filter((e) => e.id === "netflix" || e.id === "spotify"), speaks, FHD);
    const kept = { ...found(m).music!, name: "Our music" };
    m.saveScene(kept);
    const second = setupPlayers(m, CATALOG, speaks, FHD);
    expect(second).toMatchObject({ ok: true, music: first.music, video: first.video });
    expect(second.made).toEqual({ apps: ["hulu", "apple-music"], facets: ["hulu-home-16x9-XL", "apple-music-home-16x9-XL"], scenes: [] });
    expect(found(m).music).toMatchObject({ name: "Our music" });
    expect(found(m).music!.hidden.map((h) => h.facet)).toEqual(["spotify-home-16x9-XL", "apple-music-home-16x9-XL"]);
    expect(found(m).video!.assign.screen).toBe("netflix-home-16x9-XL");
    expect(m.snapshot().scenes.length).toBe(2);
  });

  it("only video services chosen: a Video player, no Music player; music added later gets one, and the Video player's scene stays its own", () => {
    const { m } = fresh();
    expect(setupPlayers(m, [CATALOG[0]!], speaks, FHD)).toMatchObject({ ok: true, music: null });
    expect(found(m).music).toBeNull();
    setupPlayers(m, [CATALOG[2]!], speaks, FHD);
    expect(found(m).music).not.toBeNull();
    expect(found(m).video!.hidden).toEqual([]);
  });
});

import { removeFromPlayers, parseRemoved, ownPlayer, profileFor, accountProfile } from "../src/player-setup.js";

describe("a service leaves the players (2026-09-29)", () => {
  it("a music service: its facet leaves both players' sources, a stage that drew it draws the next; the App and its facet stand", () => {
    const { m } = fresh();
    setupPlayers(m, CATALOG, speaks, FHD);
    const r = removeFromPlayers(m, "spotify", []);
    expect(r).toMatchObject({ ok: true, kind: "music", removed: ["spotify"] });
    expect(r.changed).toEqual(["music-lounge-1"]);
    expect(found(m).music!.hidden.map((h) => h.facet)).toEqual(["apple-music-home-16x9-XL"]);
    expect(found(m).music!.visualizations![0]!.source).toBe("apple-music-home-16x9-XL");
    expect(found(m).video!.hidden).toEqual([]);
    expect(m.app("spotify")).toBeTruthy();
    expect(m.facet("spotify-home-16x9-XL")).toBeTruthy();
    expect(setupServices(m, CATALOG, speaks, r.removed).find((s) => s.id === "spotify")).toMatchObject({ added: false, removed: true });
  });

  it("a video service on the screen: the screen goes to another service; one not on the screen changes no scene", () => {
    const { m } = fresh();
    setupPlayers(m, CATALOG, speaks, FHD);
    expect(found(m).video!.assign.screen).toBe("netflix-home-16x9-XL");
    const a = removeFromPlayers(m, "hulu", []);
    expect(a).toMatchObject({ ok: true, kind: "video", changed: [], removed: ["hulu"] });
    const b = removeFromPlayers(m, "netflix", a.removed);
    expect(b).toMatchObject({ ok: true, removed: ["hulu", "netflix"] });
    expect(found(m).video!.assign.screen).toBe("netflix-home-16x9-XL");   // no service left to go to: the screen stays as it was
    const { m: m2 } = fresh();
    setupPlayers(m2, CATALOG, speaks, FHD);
    removeFromPlayers(m2, "netflix", []);
    expect(found(m2).video!.assign.screen).toBe("hulu-home-16x9-XL");
  });

  it("chosen again on the setup page, a music service is back among the sources; an unknown service is refused; the kept list reads safely", () => {
    const { m } = fresh();
    setupPlayers(m, CATALOG, speaks, FHD);
    removeFromPlayers(m, "spotify", []);
    setupPlayers(m, CATALOG.filter((e) => e.id === "spotify"), speaks, FHD);
    expect(found(m).music!.hidden.map((h) => h.facet).sort()).toEqual(["apple-music-home-16x9-XL", "spotify-home-16x9-XL"]);
    expect(removeFromPlayers(m, "nothing", ["x"])).toMatchObject({ ok: false, removed: ["x"] });
    expect(parseRemoved('["a","a",3,""]')).toEqual(["a"]);
    expect(parseRemoved("{broken")).toEqual([]);
    expect(parseRemoved(null)).toEqual([]);
  });

  it("music an earlier build wrote into the Video player's scene is taken out, by the setup and by the switch", () => {
    const { m } = fresh();
    setupPlayers(m, CATALOG, speaks, FHD);
    m.saveScene({ ...found(m).video!, hidden: [{ facet: "spotify-home-16x9-XL", audio: "exclusive" }] });
    expect(found(m).video!.hidden.length).toBe(1);
    setupPlayers(m, [CATALOG[0]!], speaks, FHD);
    expect(found(m).video!.hidden).toEqual([]);
  });

  it("a demo scene standing on saved facets is the household's player; one on placeholders is not", () => {
    const { m } = fresh();
    m.saveApp({ id: "netflix", name: "Netflix", baseUrl: "https://www.netflix.com/browse" });
    m.saveFacet({ id: "netflix-home-16x9-XL", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home", audio: "exclusive", touch: "full" });
    m.saveLayout({ id: "demo-movie-night-layout", name: "Movie Night", canvasSize: FHD, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } });
    const real = m.saveScene({ id: "demo-movie-night", name: "Movie Night", layout: "demo-movie-night-layout", assign: { screen: "netflix-home-16x9-XL" }, floating: [], hidden: [] });
    const ph = m.saveScene({ id: "demo-sports", name: "Sports", layout: "demo-movie-night-layout", assign: { screen: "demo:placeholder" }, floating: [], hidden: [] });
    expect(real.ok && ownPlayer(m, real.value)).toBe(true);
    expect(ph.ok && ownPlayer(m, ph.value)).toBe(false);
    // the setup page adds to that player; it does not make a second Video player beside it
    const r = setupPlayers(m, [CATALOG[1]!], speaks, FHD);
    expect(r).toMatchObject({ ok: true, video: "demo-movie-night" });
    expect(m.snapshot().scenes.filter((s) => s.id.startsWith("movie-night")).length).toBe(0);
  });
});

describe("services that sign in with one account share a profile (2026-09-29)", () => {
  const A = (id: string, name: string, url: string, signInWith: string | null): SetupEntry => ({ id, name, url, adapter: null, audio: "exclusive", signInWith });
  const CAT = [A("apple-music", "Apple Music", "https://music.apple.com/", "apple"), A("appletv", "Apple TV", "https://tv.apple.com/", "apple"), A("amazon-music", "Amazon Music", "https://music.amazon.com/", "amazon"), A("primevideo", "Prime Video", "https://www.primevideo.com/", "amazon"), A("netflix", "Netflix", "https://www.netflix.com/browse", null)];
  const music = (e: SetupEntry) => /music/.test(e.id);

  it("a new device: every service in the one shared browser profile (one browser, many sign-ins, 2026-10-03)", () => {
    const { m } = fresh();
    setupPlayers(m, CAT, music, FHD, CAT);
    expect(m.app("apple-music")!.profileId).toBe("shared");
    expect(m.app("appletv")!.profileId).toBe("shared");
    expect(m.app("amazon-music")!.profileId).toBe("shared");
    expect(m.app("primevideo")!.profileId).toBe("shared");
    expect(m.app("netflix")!.profileId).toBe("shared");
    const list = setupServices(m, CAT, music);
    expect(list.find((s) => s.id === "appletv")!.sharesWith).toEqual(["Apple Music"]);
    expect(list.find((s) => s.id === "netflix")!.sharesWith).toEqual([]);
  });

  it("a service that is here keeps its profile; one of its account added later joins it, so the sign-in made serves both", () => {
    const { m } = fresh();
    m.saveApp({ id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music", setup: { status: "signed-in" } });
    setupPlayers(m, CAT.filter((e) => e.id === "appletv" || e.id === "apple-music"), music, FHD, CAT);
    expect(m.app("apple-music")!.profileId).toBe("apple-music");   // never moved: its sign-in lives there
    expect(m.app("appletv")!.profileId).toBe("apple-music");
    // chosen alone, with the whole catalog known: the same
    const { m: m2 } = fresh();
    m2.saveApp({ id: "amazon-music", name: "Amazon Music", baseUrl: "https://music.amazon.com/", profileId: "amazon-music" });
    setupPlayers(m2, [CAT[3]!], music, FHD, CAT);
    expect(m2.app("primevideo")!.profileId).toBe("amazon-music");
  });

  it("two services here before accounts were shared keep a profile each", () => {
    const { m } = fresh();
    m.saveApp({ id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music" });
    m.saveApp({ id: "appletv", name: "Apple TV", baseUrl: "https://tv.apple.com/", profileId: "appletv" });
    setupPlayers(m, CAT, music, FHD, CAT);
    expect(m.app("apple-music")!.profileId).toBe("apple-music");
    expect(m.app("appletv")!.profileId).toBe("appletv");
    expect(setupServices(m, CAT, music).find((s) => s.id === "appletv")!.sharesWith).toEqual(["Apple Music"]);   // shares by account: the boot move puts both in one browser (2026-10-03)
  });

  it("an account's name is made safe for a folder", () => {
    expect(accountProfile("Apple ID!")).toBe("account-apple-id");
    expect(profileFor(fresh().m, A("x", "X", "https://x.example/", " "), [])).toBe("shared");
  });
});
