import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Background work on a service's hidden page (2026-09-22): removals and episode lists run on app:<id>:work, one at a time, and the only
// trusted input a page may ask for - a pointer MOVE - is forwarded only while a job a person confirmed is working on that page.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind }), destroy: (id) => void ops.push({ op: "destroy", id }), setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _c, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
      hover: (id, x, y) => void ops.push({ op: "hover", id, x, y }),
    },
    store: { get: () => null, set: () => {} },
  };
  return { ops, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

async function setup(extra: Record<string, unknown> = {}) {
  const r = rig();
  const rt = createRuntime(r.drivers);
  const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoRemoveContinue: "/*rm*/", videoRemoveContinueUrl: "https://www.hulu.com/hub/home", ...extra } };
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
/** The token core handed the page with its ask (the removal's call). */
const tokenOf = (ops: Array<Record<string, unknown>>) => { const o = [...ops].reverse().find((x) => x.op === "inject" && x.id === W && String(x.js).includes("__prismVideoRemoveContinue(")); return o ? /__prismVideoRemoveContinue\("([^"]+)"/.exec(String(o.js))![1]! : null; };
const up = async (rt: ReturnType<typeof createRuntime>) => { rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true })); await vi.advanceTimersByTimeAsync(20); };
const answer = async (rt: ReturnType<typeof createRuntime>, token: string, ok: boolean, op = "remove", extra: Record<string, unknown> = {}) => { rt.event(JSON.stringify({ type: "music-result", id: W, token, op, ok, ...extra })); await vi.advanceTimersByTimeAsync(20); };

describe("background work on a service's hidden page", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // B-307's tail (2026-10-30): a page standing on another address finishes that load after the navigate was asked; that load-finished is
  // not the new page up - the new page's own comes after the shell reports the new address
  it("a load-finished before the new address is reported is the page before's, not the new page up", async () => {
    const { rt, ops } = await setup();
    rt.videoRemoveContinue("hulu", "a1", "The Bear");
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "navigated", id: W, url: "https://www.hulu.com/hub/home" }));
    await up(rt);
    const t1 = tokenOf(ops); expect(t1).toBeTruthy();
    await answer(rt, t1!, true);
    await vi.advanceTimersByTimeAsync(50);
    // the page moved on by itself (the service's own routing) and is loading my-stuff when the next job asks for the home
    rt.event(JSON.stringify({ type: "navigated", id: W, url: "https://www.hulu.com/my-stuff" }));
    ops.length = 0;
    rt.videoRemoveContinue("hulu", "a2", "Only Murders");
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "navigate" && o.id === W).length).toBe(1);
    await up(rt);                                                        // my-stuff's late load: not the home
    expect(tokenOf(ops)).toBeNull();
    expect(ops.some((o) => o.op === "inject" && o.id === W && !String(o.js).includes("window.frame.__prism"))).toBe(false);   // nothing of the job reached the old page (the idempotent prelude every load gets is not the job)
    rt.event(JSON.stringify({ type: "navigated", id: W, url: "https://www.hulu.com/hub/home" }));
    await up(rt);                                                        // the home's own load
    const t2 = tokenOf(ops); expect(t2).toBeTruthy();
    expect(t2).not.toBe(t1);
  });

  it("a removal runs on the service's own work page - never the lookup page a person's search or pick uses", async () => {
    const { rt, ops } = await setup();
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a1", "The Bear"))).toMatchObject({ status: "working" });
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.find((o) => o.op === "create")).toMatchObject({ id: W, kind: "hidden" });
    expect(ops.find((o) => o.op === "navigate")).toMatchObject({ id: W, url: "https://www.hulu.com/hub/home" });
    expect(ops.some((o) => String(o.id ?? "").endsWith(":lookup"))).toBe(false);
  });

  it("a page's hover request is forwarded only while its job is working, and only as a move", async () => {
    const { rt, ops } = await setup();
    rt.videoRemoveContinue("hulu", "a1", "The Bear");
    await vi.advanceTimersByTimeAsync(20);
    await up(rt);
    const token = tokenOf(ops)!;
    expect(token).toBeTruthy();
    await answer(rt, token, true, "hover", { count: 263, total: 460 });
    expect(ops.filter((o) => o.op === "hover")).toEqual([{ op: "hover", id: W, x: 263, y: 460 }]);
    await answer(rt, token, true);   // done
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a1", "The Bear"))).toMatchObject({ status: "done" });
    await answer(rt, token, true, "hover", { count: 10, total: 10 });   // the job is over: no more moves for it
    expect(ops.filter((o) => o.op === "hover").length).toBe(1);
  });

  it("two removals asked together run one after the other: the second's page is not taken until the first has answered", async () => {
    const { rt, ops } = await setup();
    rt.videoRemoveContinue("hulu", "a1", "Breeders");
    rt.videoRemoveContinue("hulu", "a2", "The Bear");
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "navigate").length).toBe(1);   // the second waits
    // each poll says how many are ahead (2026-10-15: the phone and the PC follow a queued one for as long as it waits)
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a1", "Breeders"))).toMatchObject({ status: "working", ahead: 0 });
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a2", "The Bear"))).toMatchObject({ status: "working", ahead: 1 });
    await up(rt);
    const first = tokenOf(ops)!;
    expect(ops.filter((o) => o.op === "navigate").length).toBe(1);
    await answer(rt, first, true);
    await vi.advanceTimersByTimeAsync(20);
    expect(ops.filter((o) => o.op === "navigate").length).toBe(2);   // now the second takes the page
    await up(rt);
    const second = tokenOf(ops)!;
    expect(second).not.toBe(first);
    await answer(rt, second, true);
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a1", "Breeders"))).toMatchObject({ status: "done" });
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a2", "The Bear"))).toMatchObject({ status: "done" });
  });

  it("a broadcast still live is marked for removal, never called removed, and the mark can be undone (2026-10-15/16, Twitch)", async () => {
    const { rt, ops } = await setup();
    rt.videoRemoveContinue("hulu", "a1", "Live show");
    await vi.advanceTimersByTimeAsync(20);
    await up(rt);
    await answer(rt, tokenOf(ops)!, false, "remove", { error: "still-live" });
    const r = JSON.parse(rt.videoRemoveContinue("hulu", "a1", "Live show")) as { status: string; note: string };
    expect(r.status).toBe("queued");
    expect(r.note).toMatch(/until the live broadcast ends/);
    expect(JSON.parse(rt.videoUndoRemoveContinue("hulu", "a1"))).toMatchObject({ ok: true });   // undone: nothing waits any more
    expect(JSON.parse(rt.videoUndoRemoveContinue("hulu", "a1"))).toMatchObject({ ok: false });
  });

  it("a card with the service's live picture waits while its channel is live, and its removal runs once the channel is Offline (2026-10-17, Twitch)", async () => {
    const { rt, ops } = await setup({ videoLiveArtwork: "/_404/404_processing" });
    const lib = (state: string) => rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: {
      continue: [{ id: "v1", title: "Big stream", kind: "video", url: "https://www.hulu.com/watch/v1", artwork: "https://vod.example/_404/404_processing_320x180.png", channel: "Host", progress: 0.7 }],
      list: [], shelves: [], own: [{ title: "Followed channels", items: [{ id: "host", title: "Host", kind: "channel", url: "https://www.hulu.com/host", subtitle: state }] }] } } }));
    lib("Live");
    await vi.advanceTimersByTimeAsync(20);
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "v1", "Big stream"))).toMatchObject({ status: "queued" });   // live: marked, nothing asked of the page
    await vi.advanceTimersByTimeAsync(121_000);
    expect(ops.filter((o) => o.op === "navigate" && o.id === W).length).toBe(0);   // still live: still waiting
    lib("Offline");   // the broadcast is over, the picture still Twitch's "processing" one
    await vi.advanceTimersByTimeAsync(121_000);
    expect(ops.filter((o) => o.op === "navigate" && o.id === W).length).toBe(1);   // the removal runs now
  });

  it("a card still live twelve hours on is tried regardless; a removal that fails four times is let go (2026-10-17, bounded)", async () => {
    const { rt, ops } = await setup({ videoLiveArtwork: "/_404/404_processing" });
    const lib = (art: string) => rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: {
      continue: [{ id: "v1", title: "Big stream", kind: "video", url: "https://www.hulu.com/watch/v1", artwork: art, channel: "Nobody", progress: 0.7 }],
      list: [], shelves: [], own: [] } } }));
    lib("https://vod.example/_404/404_processing_320x180.png");
    await vi.advanceTimersByTimeAsync(20);
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "v1", "Big stream"))).toMatchObject({ status: "queued" });
    const navs = () => ops.filter((o) => o.op === "navigate" && o.id === W).length;
    await vi.advanceTimersByTimeAsync(11 * 3600_000);
    expect(navs()).toBe(0);   // live, its channel not followed: waiting
    await vi.advanceTimersByTimeAsync(3600_000 + 130_000);
    expect(navs()).toBe(1);   // twelve hours on: tried regardless
    lib("https://vod.example/thumb/v1.jpg");   // the picture is a real one now: no longer live, so a failed try is retried after ten minutes
    for (let n = 1; n <= 3; n++) {
      await up(rt);
      await answer(rt, tokenOf(ops)!, false, "remove", { error: "the video would not play" });
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 130_000);
      expect(navs()).toBe(n + 1);
    }
    await up(rt);
    await answer(rt, tokenOf(ops)!, false, "remove", { error: "the video would not play" });
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 130_000);
    expect(navs()).toBe(4);   // the fourth failure was the last: not tried again
    expect(JSON.parse(rt.videoUndoRemoveContinue("hulu", "v1"))).toMatchObject({ ok: false });   // the mark is gone
  }, 30_000);

  it("a failure is reported once; the next ask is a new job", async () => {
    const { rt, ops } = await setup();
    rt.videoRemoveContinue("hulu", "a1", "1923");
    await vi.advanceTimersByTimeAsync(20);
    await up(rt);
    await answer(rt, tokenOf(ops)!, false, "remove", { error: "Hulu did not remove it" });
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a1", "1923"))).toMatchObject({ status: "failed", error: "Hulu did not remove it" });
    expect(JSON.parse(rt.videoRemoveContinue("hulu", "a1", "1923"))).toMatchObject({ status: "working" });   // not the old failure again
  });
});
