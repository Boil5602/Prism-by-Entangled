import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * 2026-09-30, 13:28: two Peacock windows playing live channels for an hour were closed the moment Peacock's hidden lookup page had said
 * "signed out" for 15 s (the household's Peacock session had lapsed; the streams already open kept playing). A window that is playing is
 * the truth about its page: no hidden page's word closes it. The service's setup status does turn "needs attention" (that part is right).
 */
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, css, js) => void ops.push({ op: "inject", id, js, css }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { ops, drivers, kv };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

describe("a playing multiview window outlives its service's hidden page saying signed out (2026-09-30, Peacock)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("the window stays and plays; the App is marked needs attention only once the hidden page has said so for ten minutes", async () => {
    const r = rig();
    const rt = createRuntime(r.drivers);
    const adapters = {
      hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoCmd: "/*cmd*/", login: "https://auth.hulu.com/web/login", session: "/*s*/" },
      netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", login: "https://www.netflix.com/login", session: "/*s*/" },
    };
    rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
    await vi.advanceTimersByTimeAsync(50);
    for (const [id, name, url] of [["hulu", "Hulu", "https://www.hulu.com/hub/home"], ["netflix", "Netflix", "https://www.netflix.com/browse"]] as const)
      expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id, name, adapter: id, baseUrl: url, profileId: id, setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: "nf", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "hu" }, floating: [], hidden: [] }))).ok).toBe(true);
    rt.switchPlayer("video");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoMultiview("on")).ok).toBe(true);
    expect(JSON.parse(rt.videoPlayOn("nf", "title", "81", "https://www.netflix.com/watch/81", "Grace"))).toMatchObject({ ok: true, multiview: true, tile: "nf" });
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "nf", ok: true }));
    let pos = 30;
    const play = () => { pos += 3; for (const [id, title, url] of [["nf", "Grace", "https://www.netflix.com/watch/81"], ["screen", "Only Murders", "https://www.hulu.com/watch/7"]]) rt.event(JSON.stringify({ type: "now-playing", id, info: { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "title", title, id: "81", url, playing: true, position: pos, duration: 3000, ad: false } } })); };
    for (let t = 0; t < 30_000; t += 3000) { play(); await vi.advanceTimersByTimeAsync(3000); }
    const windows = () => (JSON.parse(rt.videoMultiview("state")) as { windows: Array<{ tile: string }> }).windows.map((w) => w.tile);
    expect(windows()).toEqual(["nf", "screen"]);
    r.ops.length = 0;
    // Netflix's hidden lookup page, on Netflix's own home, says signed out (the session lapsed; Peacock's home never sends to /signin)
    const status = () => (JSON.parse(rt.modelState()) as { apps: Array<{ id: string; setup?: { status?: string } }> }).apps.find((a) => a.id === "netflix")?.setup?.status;
    rt.event(JSON.stringify({ type: "navigated", id: "app:netflix:lookup", url: "https://www.netflix.com/browse" }));
    rt.event(JSON.stringify({ type: "session", state: "signed-out", id: "app:netflix:lookup" }));
    for (let t = 0; t < 60_000; t += 3000) { play(); await vi.advanceTimersByTimeAsync(3000); }
    expect(status()).toBe("signed-in");   // a moment's word from a hidden page is not believed (Apple TV's Sign In control flickers)
    // ... said again twenty minutes later, with no account seen since: believed
    for (let t = 0; t < 20 * 60_000; t += 5000) { play(); await vi.advanceTimersByTimeAsync(5000); }
    rt.event(JSON.stringify({ type: "session", state: "signed-out", id: "app:netflix:lookup" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(status()).toBe("needs-attention");
    expect(r.ops.filter((o) => o.op === "destroy").map((o) => o.id)).toEqual([]);   // the playing window is not closed by any of it
    expect(windows()).toEqual(["nf", "screen"]);
    // the account seen again on any page of the service: signed in, and the streak forgotten
    rt.event(JSON.stringify({ type: "session", state: "signed-in", id: "app:netflix:lookup" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(status()).toBe("signed-in");
    rt.event(JSON.stringify({ type: "session", state: "signed-out", id: "app:netflix:lookup" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(status()).toBe("signed-in");
    // a person signs in through the wizard (its Done writes signed in) after a long streak: the streak is over - one flicker after it changes nothing
    rt.event(JSON.stringify({ type: "session", state: "signed-out", id: "app:netflix:lookup" }));
    for (let t = 0; t < 12 * 60_000; t += 5000) { play(); await vi.advanceTimersByTimeAsync(5000); }
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id: "netflix", name: "Netflix", adapter: "netflix", baseUrl: "https://www.netflix.com/browse", profileId: "netflix", setup: { status: "signed-in", evidence: "probe" }, render: { audio: "exclusive" } }))).ok).toBe(true);
    rt.event(JSON.stringify({ type: "session", state: "signed-out", id: "app:netflix:lookup" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(status()).toBe("signed-in");
  });
});
