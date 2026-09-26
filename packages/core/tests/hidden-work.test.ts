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

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  const adapters = { hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoRemoveContinue: "/*rm*/", videoRemoveContinueUrl: "https://www.hulu.com/hub/home" } };
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
