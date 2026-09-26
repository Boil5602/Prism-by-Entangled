import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// The Episodes list in the background (2026-09-23, "it takes quite a while 'Reading every season from Hulu...' when it could've been
// handling this in the background, and perhaps load each season starting with #1 onto the screen as they become available"): a series
// up on the screen is read on the service's work page before anyone asks, and each season shows (and plays) as the page finishes it.

function rig(kv?: Map<string, string>) {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind }), destroy: (id) => void ops.push({ op: "destroy", id }), setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _c, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
      hover: (id, x, y) => void ops.push({ op: "hover", id, x, y }),
    },
    store: kv ? { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) } : { get: () => null, set: () => {} },
  };
  return { ops, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

async function setup(kv?: Map<string, string>) {
  const r = rig(kv);
  const rt = createRuntime(r.drivers);
  const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoEpisodes: "/*ep*/", videoEpisodesUrl: "https://www.hulu.com/series/{id}" } };
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
  await vi.advanceTimersByTimeAsync(50);
  expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "hulu", name: "Hulu", adapter: "hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}
const W = "app:hulu:work";
const tokenOf = (ops: Array<Record<string, unknown>>) => { const o = [...ops].reverse().find((x) => x.op === "inject" && x.id === W && String(x.js).includes("__prismVideoEpisodes(")); return o ? /__prismVideoEpisodes\("([^"]+)"/.exec(String(o.js))![1]! : null; };
const ep = (season: number, episode: number) => ({ season, episode, title: "S" + season + "E" + episode, id: "e" + season + "-" + episode, url: "https://www.hulu.com/watch/e" + season + "-" + episode });
const view = (rt: ReturnType<typeof createRuntime>) => JSON.parse(rt.videoEpisodes()) as { ready: boolean; canPlay: boolean; seasons: Array<{ season: number }> };

describe("the Episodes list in the background", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a series up on the screen is read before anyone asks; each season shows, playable, as the page finishes it", async () => {
    const { rt, ops } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "The Rookie", title: "Pilot", id: "rookie", playing: true } } }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(ops.some((o) => o.id === W)).toBe(false);   // not at once: a series has to stay up a moment
    await vi.advanceTimersByTimeAsync(7000);
    expect(ops.find((o) => o.op === "navigate" && o.id === W)).toMatchObject({ url: "https://www.hulu.com/series/rookie" });
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    const token = tokenOf(ops)!;
    expect(token).toBeTruthy();
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "episodes-part", ok: true, candidates: [ep(1, 1), ep(1, 2)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(view(rt)).toMatchObject({ ready: false, canPlay: true, seasons: [{ season: 1 }] });
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "episodes-part", ok: true, candidates: [ep(1, 1), ep(1, 2), ep(2, 1)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(view(rt).seasons.length).toBe(2);
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "episodes", ok: true, candidates: [ep(1, 1), ep(1, 2), ep(2, 1), ep(3, 1)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(view(rt)).toMatchObject({ ready: true, canPlay: true });
    expect(view(rt).seasons.length).toBe(3);
    expect(ops.filter((o) => o.op === "navigate" && o.id === W).length).toBe(1);   // the menu opening now reads nothing again
  });

  it("a page that stops part way keeps the seasons it read - they are the service's own", async () => {
    const { rt, ops } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "The Rookie", title: "Pilot", id: "rookie", playing: true } } }));
    await vi.advanceTimersByTimeAsync(9000);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    const token = tokenOf(ops)!;
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "episodes-part", ok: true, candidates: [ep(1, 1)] }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "episodes", ok: false, error: "the page went away" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(view(rt)).toMatchObject({ ready: true, canPlay: true, seasons: [{ season: 1 }] });
  });

  it("the Details page: any series' episodes on a service, read by its Continue watching id; a chosen episode plays by its own address (2026-09-24)", async () => {
    const { rt, ops } = await setup();
    const first = JSON.parse(rt.titleEpisodes("hulu", "Only Murders in the Building", "omitb", 2, 3));
    expect(first.ready).toBe(false);   // being read on the work page
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.find((o) => o.op === "navigate" && o.id === W)).toMatchObject({ url: "https://www.hulu.com/series/omitb" });
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "episodes", ok: true, candidates: [ep(1, 1), ep(2, 2), ep(2, 3), ep(2, 4)] }));
    await vi.advanceTimersByTimeAsync(20);
    const v = JSON.parse(rt.titleEpisodes("hulu", "Only Murders in the Building", "omitb", 2, 3));
    expect(v).toMatchObject({ ready: true, canPlay: true, current: { season: 2, episode: 3 } });
    ops.length = 0;
    expect(JSON.parse(rt.titleEpisodePlay("hulu", "Only Murders in the Building", 2, 4))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.some((o) => (o.op === "navigate" && String(o.url).includes("/watch/e2-4")) || (o.op === "inject" && String(o.js).includes("e2-4")))).toBe(true);
  });

  it("Continue watching says which episode an entry is once the service's list has named it (2026-09-24)", async () => {
    const { rt, ops } = await setup();
    // Hulu's Continue watching: the entry's id is an episode id on Hulu
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [{ id: "e2-3", title: "Only Murders in the Building", kind: "series", url: "https://www.hulu.com/watch/e2-3", artwork: null, subtitle: null, progress: 0.4 }], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(20);
    const sub = () => (JSON.parse(rt.videoMenu()).continue as Array<{ item: { title: string; subtitle?: string | null } }>).find((c) => c.item.title === "Only Murders in the Building")?.item.subtitle ?? null;
    expect(sub()).toBeNull();   // not known yet
    rt.titleEpisodes("hulu", "Only Murders in the Building", "e2-3", null, null);
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "episodes", ok: true, candidates: [ep(2, 2), ep(2, 3)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(sub()).toBe("S2 E3 \u00B7 S2E3");   // season, episode and its title
  });

  it("an entry that names the show, not an episode, takes the episode the show page marks as the one the account is on (Netflix, 2026-09-25)", async () => {
    const { rt, ops } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [{ id: "show-ac", title: "Animal Control", kind: "series", url: "https://www.hulu.com/series/show-ac", artwork: null, subtitle: null, progress: 0.4 }], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(20);
    const sub = () => (JSON.parse(rt.videoMenu()).continue as Array<{ item: { title: string; subtitle?: string | null } }>).find((c) => c.item.title === "Animal Control")?.item.subtitle ?? null;
    rt.titleEpisodes("hulu", "Animal Control", "show-ac", null, null);
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "episodes", ok: true, candidates: [ep(4, 1), { ...ep(4, 2), resume: true }, ep(4, 3)] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(sub()).toBe("S4 E2 \u00B7 S4E2");
  });

  it("a face that names only the episode number takes its season, title and next episode from the service's own list (Netflix, 2026-09-25)", async () => {
    const { rt, ops } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "Animal Control", title: "Episode 2", id: "e4-2", episode: 2, playing: true } } }));
    await vi.advanceTimersByTimeAsync(9000);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "episodes", ok: true, candidates: [ep(3, 9), ep(4, 1), ep(4, 2), { ...ep(4, 3), still: "https://img/e4-3.jpg", synopsis: "A raccoon." }] }));
    await vi.advanceTimersByTimeAsync(20);
    const v = (JSON.parse(rt.videoState()) as Array<{ id: string; video?: { season?: number; episode?: number; title?: string } }>).find((t) => t.id === "screen")!.video!;
    expect(v).toMatchObject({ season: 4, episode: 2, title: "S4E2" });
    expect(JSON.parse(rt.videoNextEpisode("screen"))).toMatchObject({ ready: true, from: "service", service: "Hulu", next: { season: 4, episode: 3, name: "S4E3", still: "https://img/e4-3.jpg", overview: "A raccoon." } });
  });

  it("a series pick opens the episode left partway, skipping the show page; one left near its end goes through the show page (2026-09-25)", async () => {
    const { rt, ops } = await setup();
    const seen = (pos: number) => rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "The Rookie", title: "Manhunt", id: "e1-15", url: "https://www.hulu.com/watch/e1-15", playing: true, position: pos, duration: 2600 } } }));
    seen(300);
    await vi.advanceTimersByTimeAsync(20);
    ops.length = 0;
    rt.videoPlayOn("hu", "series", "rookie", "https://www.hulu.com/series/rookie", "The Rookie");
    await vi.advanceTimersByTimeAsync(50);
    // the episode's own address opened (or asked of the page's play script)
    const played = () => ops.filter((o) => o.id === "screen" && (o.op === "navigate" || (o.op === "inject" && String(o.js).includes("__prismVideoPlay(")))).map((o) => String(o.url ?? o.js)).pop() ?? "";
    expect(played()).toContain("https://www.hulu.com/watch/e1-15");
    // left in its last minute: the show page decides what is next
    await vi.advanceTimersByTimeAsync(61_000);
    seen(2550);
    await vi.advanceTimersByTimeAsync(20);
    ops.length = 0;
    rt.videoPlayOn("hu", "series", "rookie", "https://www.hulu.com/series/rookie", "The Rookie");
    await vi.advanceTimersByTimeAsync(50);
    expect(played()).toContain("https://www.hulu.com/series/rookie");
  });

  it("back in an episode's first seconds shows the previous episode at once, before the service names it (2026-09-25)", async () => {
    const { rt, ops } = await setup();
    const face = (id: string, episode: number, title: string, pos: number) => rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", series: "The Rookie", title, id, season: 1, episode, url: "https://www.hulu.com/watch/" + id, playing: true, position: pos, duration: 2600 } } }));
    face("e1-3", 3, "S1E3", 2);
    await vi.advanceTimersByTimeAsync(9000);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "episodes", ok: true, candidates: [ep(1, 2), ep(1, 3)] }));
    await vi.advanceTimersByTimeAsync(20);
    face("e1-3", 3, "S1E3", 3);
    expect(JSON.parse(rt.videoStartOver())).toMatchObject({ ok: true, did: "previous", season: 1, episode: 2 });
    const shown = () => (JSON.parse(rt.videoState()) as Array<{ id: string; video?: { episode?: number; title?: string } }>).find((t) => t.id === "screen")!.video!;
    face("e1-3", 3, "S1E3", 4);   // the page still on the old episode
    expect(shown()).toMatchObject({ episode: 2, title: "S1E2" });
    face("e1-2", 2, "S1E2", 1);   // the service names it: its own word from here
    expect(shown()).toMatchObject({ episode: 2, title: "S1E2" });
  });

  it("a series' episode list is kept on the device: after a restart it shows at once, nothing read again (2026-09-24)", async () => {
    const kv = new Map<string, string>();
    const a = await setup(kv);
    a.rt.titleEpisodes("hulu", "Only Murders in the Building", "omitb", null, null);
    await vi.advanceTimersByTimeAsync(50);
    a.rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    a.rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(a.ops)!, op: "episodes", ok: true, candidates: [ep(1, 1), ep(2, 3)] }));
    await vi.advanceTimersByTimeAsync(6000);   // written a few seconds after it is read
    expect(kv.has("video:episode-lists")).toBe(true);
    const b = await setup(kv);
    const v = JSON.parse(b.rt.titleEpisodes("hulu", "Only Murders in the Building", "omitb", null, null));
    expect(v).toMatchObject({ ready: true, canPlay: true, source: "service" });
    expect(v.seasons.length).toBe(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(b.ops.some((o) => o.op === "navigate" && o.id === W)).toBe(false);   // fresh enough: not read again
  });
});
