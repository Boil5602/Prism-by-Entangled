import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { Orchestrator } from "../src/orchestrator.js";
import { cleanCandidates, orderLookup, type LookupServiceState } from "../src/video-lookup.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Cross-service video search (docs/video-menu-spec.md §2 row 5, the "later option" taken 2026-09-19): "All the services
// get searched but the app returns the results straight to the screen." Fixtures: every signed-in service with a reader
// is asked at once on its own HIDDEN surface, never revealed; a service without a reader or a session is listed with
// why; an answer counts only from the surface asked, with the token core handed it; a result plays only when the
// service itself answered with it; the words reach no store and no network; the merged row is pure over the answers;
// idle surfaces go after a few minutes.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const net: string[] = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind ?? "slot", profile: o.profile }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: (id, rect) => void ops.push({ op: "setRect", id, rect }), setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: (id) => void ops.push({ op: "reveal", id }), suspend: () => {}, resume: () => {},
      setMuted: (id, muted) => void ops.push({ op: "setMuted", id, muted }), setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    net: { fetch: async (url: string) => { net.push(url); throw new Error("the search never calls a service"); } } as never,
  };
  return { ops, store, net, drivers };
}
const FHD = { w: 1920, h: 1080 };
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const injects = (ops: Array<Record<string, unknown>>, id: string, fn: string) => ops.filter((o) => o.op === "inject" && o.id === id && String(o.js).includes(fn));

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {
    netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoLibrary: "/*l*/", videoSearchUrl: "https://www.netflix.com/search?q={q}", videoLookup: "/*NF-LOOKUP*/", videoPlay: "/*play*/" },
    hulu: { match: ["www.hulu.com"], videoContext: "/*c*/", videoSearch: "/*search*/", videoLookup: "/*HU-LOOKUP*/" },   // no search address: the reader types from the home
    tubi: { match: ["tubitv.com"], videoContext: "/*c*/", videoSearchUrl: "https://tubitv.com/search/{q}" },            // a chip, but no reader
    peacock: { match: ["www.peacocktv.com"], videoContext: "/*c*/", videoLookup: "/*PK-LOOKUP*/" },
  } }));
  await vi.advanceTimersByTimeAsync(50);
  await vi.advanceTimersByTimeAsync(9_000);   // the hidden pages wait out the boot (2026-09-28)
  for (const a of [
    { id: "netflix", name: "Netflix", baseUrl: "https://www.netflix.com/browse", profileId: "netflix", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/hub/home", profileId: "hulu", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "tubi", name: "Tubi", baseUrl: "https://tubitv.com/home", profileId: "tubi", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "peacock", name: "Peacock", baseUrl: "https://www.peacocktv.com/watch/home", profileId: "peacock", setup: { status: "needs-attention" }, render: { audio: "exclusive" } },
  ]) expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
  for (const f of [
    { id: "nf", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home" },
    { id: "hu", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" },
    { id: "tb", app: "tubi", url: "https://tubitv.com/home", slotClass: "16:9·XL", label: "Home" },
    { id: "pk", app: "peacock", url: "https://www.peacocktv.com/watch/home", slotClass: "16:9·XL", label: "Home" },
  ]) expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(f))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: FHD, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "nf" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}

const answer = (rt: ReturnType<typeof createRuntime>, id: string, token: string, candidates: unknown[], ok = true, error?: string) =>
  rt.event(JSON.stringify({ type: "music-result", id, token, op: "lookup", ok, candidates, ...(error ? { error } : {}) }));

describe("cross-service video search", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("asks every signed-in service with a reader at once, on hidden surfaces that are never revealed; the rest are listed with why", async () => {
    const { rt, ops } = await setup();
    const st = JSON.parse(rt.videoLookup("dark"));
    expect(st.ok).toBe(true);
    expect(st.done).toBe(false);
    expect(st.services.map((s: { app: string; status: string }) => [s.app, s.status])).toEqual([["netflix", "searching"], ["hulu", "searching"], ["tubi", "unavailable"], ["peacock", "unavailable"]]);
    expect(st.services[2].reason).toMatch(/no search reader/);
    expect(st.services[3].reason).toBe("sign in first");
    await vi.advanceTimersByTimeAsync(50);
    const created = ops.filter((o) => o.op === "create");
    expect(created).toEqual([{ op: "create", id: "app:netflix:lookup", kind: "hidden", profile: "netflix" }, { op: "create", id: "app:hulu:lookup", kind: "hidden", profile: "hulu" }]);
    expect(ops.filter((o) => o.op === "setMuted" && o.muted === true).map((o) => o.id)).toEqual(["app:netflix:lookup", "app:hulu:lookup"]);
    // the search address with the words where the service has one; the home where the reader types the words itself
    expect(ops.find((o) => o.op === "navigate" && o.id === "app:netflix:lookup")?.url).toBe("https://www.netflix.com/search?q=dark");
    expect(ops.find((o) => o.op === "navigate" && o.id === "app:hulu:lookup")?.url).toBe("https://www.hulu.com/hub/home");
    expect(ops.some((o) => o.op === "reveal")).toBe(false);
    // the page up: its adapter goes in, then the question with the token core handed it
    rt.event(JSON.stringify({ type: "load-finished", id: "app:netflix:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "app:netflix:lookup", "NF-LOOKUP").length).toBe(1);
    expect(injects(ops, "app:netflix:lookup", '__prismVideoLookup("vl1:netflix", "dark")').length).toBe(1);
    expect(ops.some((o) => o.op === "reveal")).toBe(false);
    // an answer from the WRONG surface with the right token is nobody's
    answer(rt, "app:hulu:lookup", "vl1:netflix", [{ id: "x", title: "Not mine" }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(rt.videoLookupState()).services[0].status).toBe("searching");
    answer(rt, "app:netflix:lookup", "vl1:netflix", [{ id: "70143836", title: "Dark", kind: "series", year: "2017", url: "https://www.netflix.com/watch/70143836", poster: "https://img.example/dark.jpg", play: true }, { id: "", title: "unnamed" }, { id: "70143836", title: "Dark again" }]);
    await vi.advanceTimersByTimeAsync(10);
    let cur = JSON.parse(rt.videoLookupState());
    expect(cur.services[0]).toMatchObject({ status: "ok", candidates: [{ id: "70143836", title: "Dark", kind: "series", year: 2017, url: "https://www.netflix.com/watch/70143836", poster: "https://img.example/dark.jpg" }] });
    expect(cur.services[0].candidates.length).toBe(1);   // the blank and the duplicate dropped
    expect(cur.done).toBe(false);
    // Hulu's page meets a gate it cannot pass: the row says so, and the search is done
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    answer(rt, "app:hulu:lookup", "vl1:hulu", [], false, "needs-profile");
    await vi.advanceTimersByTimeAsync(10);
    cur = JSON.parse(rt.videoLookupState());
    expect(cur.services[1]).toMatchObject({ status: "needs-profile", reason: "choose a profile on the screen first" });
    expect(cur.done).toBe(true);
  });

  it("a page that never loads or never answers fails its row alone; a newer search supersedes the old", async () => {
    const { rt } = await setup();
    rt.videoLookup("one");
    await vi.advanceTimersByTimeAsync(Orchestrator.LOOKUP_UP_TIMEOUT_MS + 100);
    let cur = JSON.parse(rt.videoLookupState());
    expect(cur.services[0]).toMatchObject({ status: "error", reason: "the page did not load" });
    expect(cur.done).toBe(true);
    rt.videoLookup("two");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:netflix:lookup", ok: true }));
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(Orchestrator.LOOKUP_ANSWER_TIMEOUT_MS + 100);
    cur = JSON.parse(rt.videoLookupState());
    expect(cur.q).toBe("two");
    expect(cur.services.slice(0, 2).every((s: { status: string; reason: string }) => s.status === "error" && s.reason === "the page did not answer")).toBe(true);
    expect(cur.done).toBe(true);
  });

  it("a result plays only when the service itself answered with it: its own address through the play path, a details page as an open, a Peacock-style id through the service's search", async () => {
    const { rt, ops } = await setup();
    rt.videoLookup("dark");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:netflix:lookup", ok: true }));
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    answer(rt, "app:netflix:lookup", "vl1:netflix", [{ id: "1", title: "Dark", url: "https://www.netflix.com/watch/1", play: true }, { id: "2", title: "Dark Shadows", url: "https://www.netflix.com/title/2", play: false }]);
    answer(rt, "app:hulu:lookup", "vl1:hulu", [{ id: "tile-9", title: "Dark Side of the Ring", kind: "series" }]);   // no address of its own
    await vi.advanceTimersByTimeAsync(10);
    // never a result the service did not give
    expect(JSON.parse(rt.videoPlayResult("netflix", JSON.stringify({ id: "999", title: "Forged", url: "https://www.netflix.com/watch/999" })))).toMatchObject({ ok: false });
    expect(JSON.parse(rt.videoPlayResult("nowhere", JSON.stringify({ id: "1", title: "Dark" })))).toMatchObject({ ok: false });
    ops.length = 0;
    // Netflix is on the screen: its own player takes the title
    expect(JSON.parse(rt.videoPlayResult("netflix", JSON.stringify({ id: "1", title: "Dark" })))).toMatchObject({ ok: true, switched: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", '__prismVideoPlay("title", "1", "https://www.netflix.com/watch/1")').length).toBe(1);
    // a details page: an open - no pick waits for a play that was not promised
    expect(JSON.parse(rt.videoPlayResult("netflix", JSON.stringify({ id: "2", title: "Dark Shadows" })))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", '__prismVideoPlay("open", "2"').length).toBe(1);
    const tile = JSON.parse(rt.videoState()).find((t: { id: string }) => t.id === "screen");
    expect(tile.pending ?? null).toBeNull();
    // Hulu's result has no address: the screen becomes Hulu, its search takes the words, and the result is pressed once shown
    ops.length = 0;
    const r = JSON.parse(rt.videoPlayResult("hulu", JSON.stringify({ id: "tile-9", title: "Dark Side of the Ring" })));
    expect(r).toMatchObject({ ok: true, switched: true });
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(injects(ops, "screen", '__prismVideoSearch("dark", "tile-9")').length).toBe(1);
  });

  it("the words reach no store and no network; nothing of the search is kept", async () => {
    const { rt, store, net, ops } = await setup();
    rt.videoLookup("a very private title");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:netflix:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    answer(rt, "app:netflix:lookup", "vl1:netflix", [{ id: "1", title: "A Very Private Title", url: "https://www.netflix.com/watch/1" }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(net).toEqual([]);
    expect([...store.entries()].some(([k, v]) => /private/i.test(k) || /private/i.test(v))).toBe(false);
    // the page's own request only: the surface was navigated to the service's search address, nothing else was fetched
    expect(ops.filter((o) => o.op === "navigate").map((o) => o.url)).toEqual(["https://www.netflix.com/search?q=a%20very%20private%20title", "https://www.hulu.com/hub/home"]);
  });

  it("idle surfaces go after a few minutes; a repeat search within them reuses the surface", async () => {
    const { rt, ops } = await setup();
    rt.videoLookup("dark");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:netflix:lookup", ok: true }));
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    answer(rt, "app:netflix:lookup", "vl1:netflix", []);
    answer(rt, "app:hulu:lookup", "vl1:hulu", []);
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.parse(rt.videoLookupState()).done).toBe(true);
    ops.length = 0;
    rt.videoLookup("darker");
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.filter((o) => o.op === "create").length).toBe(0);   // reused
    expect(ops.filter((o) => o.op === "navigate").length).toBe(2);
    rt.event(JSON.stringify({ type: "load-finished", id: "app:netflix:lookup", ok: true }));
    rt.event(JSON.stringify({ type: "load-finished", id: "app:hulu:lookup", ok: true }));
    await vi.advanceTimersByTimeAsync(50);
    answer(rt, "app:netflix:lookup", "vl2:netflix", []);
    answer(rt, "app:hulu:lookup", "vl2:hulu", []);
    await vi.advanceTimersByTimeAsync(Orchestrator.LOOKUP_IDLE_MS + 100);
    expect(ops.filter((o) => o.op === "destroy").map((o) => o.id).sort()).toEqual(["app:hulu:lookup", "app:netflix:lookup"]);
  });
});

describe("the merged row is pure over the answers (the transparency rule holds for search)", () => {
  const s = (app: string, titles: string[]): LookupServiceState => ({ app, name: app, facet: app, status: "ok", candidates: titles.map((t, i) => ({ id: app + i, title: t, kind: "title" as const })), at: 0 });
  it("the titles that ARE the words first, one per service in the household's order, then one card per service in turn", () => {
    const rows = orderLookup("Dark", [s("netflix", ["Dark Shadows", "Dark", "Darkest Hour"]), s("hulu", ["Dark Side of the Ring", "Dark Side of the 90s"]), s("tubi", ["DARK", "DarkPlace"])]);
    expect(rows.map((r) => r.app + ":" + r.candidate.title + (r.exact ? "*" : ""))).toEqual([
      "netflix:Dark*", "tubi:DARK*",
      "netflix:Dark Shadows", "hulu:Dark Side of the Ring", "tubi:DarkPlace",
      "netflix:Darkest Hour", "hulu:Dark Side of the 90s",
    ]);
  });
  it("same inputs, same order; a service's own order is kept; empty and failed services contribute nothing", () => {
    const a = orderLookup("x", [s("a", ["p", "q"]), { ...s("b", ["r"]), status: "error", candidates: [] }, s("c", ["s", "t", "u"])]);
    const b = orderLookup("x", [s("a", ["p", "q"]), { ...s("b", ["r"]), status: "error", candidates: [] }, s("c", ["s", "t", "u"])]);
    expect(a).toEqual(b);
    expect(a.map((r) => r.candidate.title)).toEqual(["p", "s", "q", "t", "u"]);
  });
  it("cleanCandidates keeps only named, id'd, http-addressed answers, at most the per-service cap, first come", () => {
    const raw = [{ id: "1", title: " Dark  Shadows ", kind: "movie", year: 1971, url: "javascript:alert(1)", poster: "//cdn/x.jpg" }, { id: "2", title: "Two", kind: "nonsense", url: "https://s/2", play: false }, { title: "no id" }, { id: "3" }, { id: "2", title: "dupe" }];
    expect(cleanCandidates(raw)).toEqual([{ id: "1", title: "Dark Shadows", kind: "movie", year: 1971 }, { id: "2", title: "Two", kind: "title", url: "https://s/2", play: false }]);
    expect(cleanCandidates(Array.from({ length: 40 }, (_, i) => ({ id: String(i), title: "t" + i })), 12).length).toBe(12);
    expect(cleanCandidates("nope")).toEqual([]);
  });
});
