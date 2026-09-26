import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// VP-3 (2026-09-19): the Video player as a UNIVERSAL player - "our movie player would seemingly play from any service,
// LIKE THE MUSIC PLAYER" - and profile selection as a capability of every video service.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, url: (o as { url?: string }).url }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers };
}
const FHD = { w: 1920, h: 1080 };
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const injects = (ops: Array<Record<string, unknown>>, id: string, fn: string) => ops.filter((o) => o.op === "inject" && o.id === id && String(o.js).includes(fn));

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {
    netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoPlay: "/*p*/", videoProfiles: "/*pr*/" },
    hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" },
  } }));
  await vi.advanceTimersByTimeAsync(50);
  for (const a of [
    { id: "netflix", name: "Netflix", baseUrl: "https://www.netflix.com/browse", profileId: "netflix", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", setup: { status: "unknown" } },
    { id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music", setup: { status: "signed-in" } },
  ]) expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
  for (const f of [
    { id: "netflix-home-16x9-XL", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home" },
    { id: "netflix-strip-21x9-M", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "21:9·M", label: "Strip" },
    { id: "hulu-16x9-XL", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home", audio: "exclusive" },
    { id: "am", app: "apple-music", url: "https://music.apple.com/", slotClass: "16:9·XL", label: "Apple Music", music: true, audio: "exclusive" },
  ]) expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(f))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: FHD, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "netflix-home-16x9-XL" }, floating: [], hidden: [{ facet: "am", audio: "exclusive" }] }))).ok).toBe(true);
  return { ...r, rt };
}

describe("VP-3 - the universal Video player", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists the household's video services (one per App, its XL facet; music facets never), with who is on the screen", async () => {
    const { rt } = await setup();
    const sv = JSON.parse(rt.videoServices());
    expect(sv).toMatchObject({ scene: "movie-night-1", active: false, screen: { slot: "screen", facet: "netflix-home-16x9-XL", app: "netflix" } });
    expect(sv.services.map((s: { app: string; facet: string; status: string; onScreen: boolean; adapter: string }) => [s.app, s.facet, s.status, s.onScreen, s.adapter]))
      .toEqual([["netflix", "netflix-home-16x9-XL", "signed-in", true, "netflix"], ["hulu", "hulu-16x9-XL", "unknown", false, "hulu"]]);
  });

  it("a switch re-assigns the screen and takes the wall there; a Quick play on another service switches first and asks for the title once the page is up", async () => {
    const { rt, ops } = await setup();
    // to the Video player, Netflix up
    expect(JSON.parse(rt.switchPlayer("video")).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.state()).tiles.find((t: { id: string }) => t.id === "screen")?.url).toContain("netflix.com");
    // Hulu's Continue Watching pick: the screen becomes Hulu, then the title is asked for on its page
    ops.length = 0;
    const r = JSON.parse(rt.videoPlayOn("hulu-16x9-XL", "series", "h1", "https://www.hulu.com/watch/h1", "The Bear"));
    expect(r).toMatchObject({ ok: true, switched: true, slot: "screen" });
    await vi.advanceTimersByTimeAsync(50);
    const sv = JSON.parse(rt.videoServices());
    expect(sv.screen.facet).toBe("hulu-16x9-XL");
    expect(JSON.parse(rt.state()).tiles.find((t: { id: string }) => t.id === "screen")?.url).toContain("hulu.com");
    expect(ops.filter((o) => o.op === "navigate" && o.id === "screen" && String(o.url).includes("/watch/h1")).length).toBe(1);   // the pick's OWN address loads on the switch, not the service's home first (2026-09-21)
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.hulu.com/watch/h1" }));
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "navigate" && o.id === "screen" && String(o.url).includes("/watch/h1")).length).toBe(1);   // already there: no reload once the page is up
    // a pick that never started on one service must not follow the slot to the next service
    rt.videoPlayOn("hulu-16x9-XL", "series", "h2", "https://www.hulu.com/watch/h2", "Ghost");
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoState())[0].pending).toMatchObject({ name: "Ghost" });
    rt.videoSwitch("netflix-home-16x9-XL");
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoState())[0].pending).toBeNull();
    // the same service again: no switch, the pick goes straight to the page (Netflix's videoPlay)
    rt.videoSwitch("netflix-home-16x9-XL");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    expect(JSON.parse(rt.videoPlayOn("netflix-home-16x9-XL", "movie", "70", "https://www.netflix.com/watch/70", "Heat"))).toMatchObject({ ok: true, switched: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoPlay(\"movie\", \"70\"").length).toBe(1);
    // a service's library is kept per App, so Hulu's Continue Watching is listed while Netflix is up
    rt.videoSwitch("hulu-16x9-XL");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [{ id: "h1", title: "The Bear", kind: "series" }] } } }));
    await vi.advanceTimersByTimeAsync(50);
    rt.videoSwitch("netflix-home-16x9-XL");
    await vi.advanceTimersByTimeAsync(50);
    const hulu = JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu");
    expect(hulu.library.continue.map((x: { title: string }) => x.title)).toEqual(["The Bear"]);
    expect(hulu.onScreen).toBe(false);
  });

  it("VS-1 (section 10): a service's setup status - signed in, with its evidence - persists in the store and a fresh runtime on the same store reads it back (App setup round-trip across a host restart)", async () => {
    const { rt, store } = await setup();
    const hulu = JSON.parse(rt.modelState()).apps.find((a: { id: string }) => a.id === "hulu");
    expect(hulu.setup.status).toBe("unknown");
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ ...hulu, setup: { status: "signed-in", lastVerified: "2026-09-19", evidence: "probe" } }))).ok).toBe(true);
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "hulu").status).toBe("signed-in");
    expect(store.get("scene-model:apps")).toContain("\"signed-in\"");
    // the host restarts: a fresh runtime, the same store, nothing wiped (section 10) - the status stands
    const rt2 = createRuntime({ surface: { create() {}, destroy() {}, setRect() {}, setOpacity() {}, setZ() {}, navigate() {}, inject() {}, freeze() {}, reveal() {}, suspend() {}, resume() {}, setMuted() {}, setViewport() {} }, store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) } } as Drivers);
    rt2.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    const again = JSON.parse(rt2.modelState()).apps.find((a: { id: string }) => a.id === "hulu");
    expect(again.setup).toMatchObject({ status: "signed-in", evidence: "probe" });
    expect(JSON.parse(rt2.videoServices()).services.find((s: { app: string }) => s.app === "hulu").status).toBe("signed-in");
  });

  it("VP-3b: each service carries its recents (the last five titles the wall saw play, newest first) and the page's shelves, kept across reports and restarts", async () => {
    const { rt, store } = await setup();
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    // the browse page: shelves and Continue Watching; a later report from the My List page keeps the shelves
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [{ id: "1", title: "Dark", kind: "title" }], shelves: [{ title: "Top picks", items: [{ id: "5", title: "Heat", kind: "title" }] }] } } }));
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { list: [{ id: "7", title: "Tires", kind: "title" }] } } }));
    await vi.advanceTimersByTimeAsync(50);
    let nf = JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "netflix");
    expect(nf.library.shelves.map((s: { title: string }) => s.title)).toEqual(["Top picks"]);
    expect(nf.library.list.map((x: { title: string }) => x.title)).toEqual(["Tires"]);
    expect(nf.library.continue.map((x: { title: string }) => x.title)).toEqual(["Dark"]);
    // six plays: the recents hold the last five, newest first, a replay moving to the front
    for (const [id, title] of [["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"], ["a", "A"]]) {
      rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "movie", title, id, url: "https://www.netflix.com/watch/" + id, playing: true } } }));
      await vi.advanceTimersByTimeAsync(20);
    }
    nf = JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "netflix");
    expect(nf.recent.map((r: { title: string }) => r.title)).toEqual(["A", "E", "D", "C", "B"]);
    expect(JSON.parse(store.get("video:recent:wall:netflix")!).length).toBe(5);
    // a fresh runtime on the same store reads them back
    const rt2 = createRuntime({ ...({} as Drivers), surface: { create() {}, destroy() {}, setRect() {}, setOpacity() {}, setZ() {}, navigate() {}, inject() {}, freeze() {}, reveal() {}, suspend() {}, resume() {}, setMuted() {}, setViewport() {} }, store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) } } as Drivers);
    rt2.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } } }));
    await vi.advanceTimersByTimeAsync(50);
    rt2.videoServices();
    await vi.advanceTimersByTimeAsync(50);
    const again = JSON.parse(rt2.videoServices()).services.find((s: { app: string }) => s.app === "netflix");
    expect(again.recent.map((r: { title: string }) => r.title)).toEqual(["A", "E", "D", "C", "B"]);
    expect(again.library.shelves[0].title).toBe("Top picks");
  });

  it("profiles: the gate rides on the report; a pick is a human's press; 'always' is a standing choice the wall applies when the gate shows again, and it can be forgotten", async () => {
    const { rt, ops, store } = await setup();
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    const gate = { gate: true, profiles: [{ id: "A1", name: "Alex" }, { id: "B2", name: "Sam" }], current: null };
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: gate } }));
    await vi.advanceTimersByTimeAsync(50);
    const st = JSON.parse(rt.videoState())[0];
    expect(st.profiles).toEqual(gate);
    expect(st.can.profiles).toBe(true);
    expect(injects(ops, "screen", "__prismVideoProfile").length).toBe(0);   // no standing choice: the gate is the person's
    // a plain pick: once
    rt.videoProfile("screen", "A1", false);
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoProfile(\"A1\")").length).toBe(1);
    expect(JSON.parse(rt.videoState())[0].profileChoice).toMatchObject({ id: "A1", name: "Alex", always: false });
    ops.length = 0;
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: gate } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoProfile").length).toBe(0);   // a plain pick is not applied again by the wall
    // always: applied on the next appearance of the gate, once per appearance, and kept under video:profile:*
    rt.videoProfile("screen", "A1", true);
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(store.get("video:profile:wall:netflix")!)).toMatchObject({ id: "A1", always: true });
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(16_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: gate } }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: gate } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoProfile(\"A1\")").length).toBe(1);
    // forgotten: the gate is the person's again
    rt.videoForgetProfile("screen");
    await vi.advanceTimersByTimeAsync(50);
    expect(store.get("video:profile:wall:netflix")).toBe("");
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(16_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: gate } }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", "__prismVideoProfile").length).toBe(0);
  });
});
