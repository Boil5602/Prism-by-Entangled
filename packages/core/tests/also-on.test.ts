import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Hulu's shows in the Disney+ app (2026-09-25, "Is every Hulu title available in Disney? Without just watch, how would you know"; "only when a
// title details is opened, updates in the background"): Disney+'s own search, on its hidden work page, answers for one title; the answer is kept
// a week, and a person's Search everywhere page is never used for it.

function rig(kv: Map<string, string>) {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _c, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { ops, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };

async function setup(kv = new Map<string, string>(), disneyExtra: Record<string, unknown> = {}) {
  const r = rig(kv);
  const rt = createRuntime(r.drivers);
  const adapters = {
    hulu: { match: ["www.hulu.com"], videoContext: "/*c*/" },
    disneyplus: { match: ["www.disneyplus.com"], videoContext: "/*c*/", videoLookup: "/*lk*/", videoSearchUrl: "https://www.disneyplus.com/search?q={q}", ...disneyExtra },
  };
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters }));
  await vi.advanceTimersByTimeAsync(50);
  for (const [id, name, url] of [["hulu", "Hulu", "https://www.hulu.com/hub/home"], ["disneyplus", "Disney+", "https://www.disneyplus.com/home"]] as const) {
    expect(JSON.parse(rt.modelSaveApp(JSON.stringify({ id, name, adapter: id, baseUrl: url, profileId: id, setup: { status: "signed-in" }, render: { audio: "exclusive" } }))).ok).toBe(true);
    expect(JSON.parse(rt.modelSaveFacet(JSON.stringify({ id: id + "-f", app: id, url, slotClass: "16:9·XL", label: "Home" }))).ok).toBe(true);
  }
  await vi.advanceTimersByTimeAsync(20);
  r.ops.length = 0;
  return { ...r, rt, kv };
}
const W = "app:disneyplus:work";
const tokenOf = (ops: Array<Record<string, unknown>>) => { const o = [...ops].reverse().find((x) => x.op === "inject" && x.id === W && String(x.js).includes("__prismVideoLookup(")); return o ? /__prismVideoLookup\("([^"]+)"/.exec(String(o.js))![1]! : null; };

describe("a Hulu title on Disney+", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is asked of Disney+'s own search on its work page, once, and the answer kept a week", async () => {
    const { rt, ops, kv } = await setup();
    expect(JSON.parse(rt.titleAlsoOn("tv", 4586, "Gilmore Girls", "hulu"))).toMatchObject({ state: "checking", app: "disneyplus", name: "Disney+" });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.find((o) => o.op === "navigate" && o.id === W)).toMatchObject({ url: "https://www.disneyplus.com/search?q=Gilmore%20Girls" });
    expect(ops.some((o) => String(o.id ?? "").endsWith(":lookup"))).toBe(false);   // never the Search everywhere page
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    const token = tokenOf(ops)!;
    expect(token).toBeTruthy();
    rt.titleAlsoOn("tv", 4586, "Gilmore Girls", "hulu");   // asked again while checking: no second search
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "lookup", ok: true, candidates: [{ id: "gg", title: "Gilmore Girls", kind: "title", play: false, url: "https://www.disneyplus.com/browse/entity-gg" }] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(JSON.parse(rt.titleAlsoOn("tv", 4586, "Gilmore Girls", "hulu")).state).toBe("yes");
    expect(ops.filter((o) => o.op === "navigate" && o.id === W).length).toBe(1);
    expect(kv.get("video:also-on")).toContain("v2|disneyplus|tv:4586");
  });

  it("a title Disney+ does not name is a no; a service with no such partner is n/a", async () => {
    const { rt, ops } = await setup();
    rt.titleAlsoOn("tv", 1, "Only On Hulu", "hulu");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "lookup", ok: true, candidates: [{ id: "x", title: "Something Else", kind: "title" }] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(JSON.parse(rt.titleAlsoOn("tv", 1, "Only On Hulu", "hulu")).state).toBe("no");
    expect(JSON.parse(rt.titleAlsoOn("tv", 1, "Anything", "netflix")).state).toBe("n/a");
  });

  it("found by search is not enough when the service can say more: the title's own page decides by the Play it offers (no bundle, no Play)", async () => {
    const { rt, ops } = await setup(new Map(), { videoCanPlay: "/*cp*/" });
    rt.titleAlsoOn("tv", 4586, "Gilmore Girls", "hulu");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    rt.event(JSON.stringify({ type: "music-result", id: W, token: tokenOf(ops)!, op: "lookup", ok: true, candidates: [{ id: "gg", title: "Gilmore Girls", kind: "title", play: false, url: "https://www.disneyplus.com/browse/entity-gg" }] }));
    await vi.advanceTimersByTimeAsync(50);
    // the title's page opened on the same work page
    expect(ops.filter((o) => o.op === "navigate" && o.id === W).map((o) => o.url)).toContain("https://www.disneyplus.com/browse/entity-gg");
    rt.event(JSON.stringify({ type: "load-finished", id: W, ok: true }));
    await vi.advanceTimersByTimeAsync(20);
    const cp = [...ops].reverse().find((o) => o.op === "inject" && o.id === W && String(o.js).includes("__prismVideoCanPlay("));
    const token = /__prismVideoCanPlay\("([^"]+)"/.exec(String(cp!.js))![1]!;
    rt.event(JSON.stringify({ type: "music-result", id: W, token, op: "canplay", ok: true, candidates: [{ id: "none", title: "Get Hulu with Disney+", play: false }] }));
    await vi.advanceTimersByTimeAsync(20);
    expect(JSON.parse(rt.titleAlsoOn("tv", 4586, "Gilmore Girls", "hulu")).state).toBe("no");
  });
});
