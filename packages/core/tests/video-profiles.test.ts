import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// "Can we just make profile a simple choice under each service (if multiple profiles are an option) and persist the
// profile choice until I make a different selection later" (2026-09-19). Fixtures: the profiles a service shows on any
// surface are remembered for the App (the menu's list); a choice from the menu stands, is applied to the gate now and on
// every later appearance (a fresh runtime included), and only an id the service listed is ever sent back; Ask clears it.

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }), destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }), inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "news", url: "https://news.example.com/", audio: "mute" }] };
const injects = (ops: Array<Record<string, unknown>>, id: string, fn: string) => ops.filter((o) => o.op === "inject" && o.id === id && String(o.js).includes(fn));
const GATE = { gate: true, profiles: [{ id: "p1", name: "Alex", avatar: "https://a/mark.png" }, { id: "p2", name: "Kids", avatar: null }], current: null };

async function setup(store?: Map<string, string>) {
  const r = rig();
  if (store) for (const [k, v] of store) r.store.set(k, v);
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {
    netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoProfiles: "/*p*/", videoLookup: "/*l*/" },
    tubi: { match: ["tubitv.com"], videoContext: "/*c*/" },
  } }));
  await vi.advanceTimersByTimeAsync(50);
  for (const a of [
    { id: "netflix", name: "Netflix", baseUrl: "https://www.netflix.com/browse", profileId: "netflix", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
    { id: "tubi", name: "Tubi", baseUrl: "https://tubitv.com/home", profileId: "tubi", setup: { status: "signed-in" }, render: { audio: "exclusive" } },
  ]) expect(JSON.parse(rt.modelSaveApp(JSON.stringify(a))).ok).toBe(true);
  for (const f of [
    { id: "nf", app: "netflix", url: "https://www.netflix.com/browse", slotClass: "16:9·XL", label: "Home" },
    { id: "tb", app: "tubi", url: "https://tubitv.com/home", slotClass: "16:9·XL", label: "Home" },
  ]) expect(JSON.parse(rt.modelSaveFacet(JSON.stringify(f))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveLayout(JSON.stringify({ id: "night", name: "Night", canvasSize: { w: 1920, h: 1080 }, slots: [{ id: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } }], source: { mode: "template", template: "movie-night" } }))).ok).toBe(true);
  expect(JSON.parse(rt.modelSaveScene(JSON.stringify({ id: "movie-night-1", name: "Movie Night", layout: "night", assign: { screen: "nf" }, floating: [], hidden: [] }))).ok).toBe(true);
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(50);
  r.ops.length = 0;
  return { ...r, rt };
}
const netflix = (rt: ReturnType<typeof createRuntime>) => JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "netflix");

describe("a service's profile as a plain choice under it", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the profiles a service shows are remembered for the App, from the screen or a hidden search surface; a choice is applied to the gate at once and kept", async () => {
    const { rt, ops, store } = await setup();
    expect(netflix(rt).profiles).toEqual([]);
    // the gate on the screen
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflix(rt).profiles).toEqual([{ id: "p1", name: "Alex", avatar: "https://a/mark.png" }, { id: "p2", name: "Kids", avatar: null }]);
    expect(netflix(rt).profile).toBeNull();
    expect(store.get("video:profiles:wall:netflix")).toContain("Kids");
    // an id the service never listed is refused
    expect(JSON.parse(rt.videoProfileChoose("netflix", "p9"))).toMatchObject({ ok: false });
    expect(JSON.parse(rt.videoProfileChoose("nowhere", "p1"))).toMatchObject({ ok: false });
    // the choice: pressed on the gate that is up now, kept as the household's standing choice
    expect(JSON.parse(rt.videoProfileChoose("netflix", "p2"))).toEqual({ ok: true, name: "Kids" });
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("p2")').length).toBe(1);
    expect(netflix(rt).profile).toMatchObject({ id: "p2", name: "Kids", always: true });
    expect(JSON.parse(store.get("video:profile:wall:netflix")!)).toMatchObject({ id: "p2", always: true });
    // the gate again later (a fresh document): answered by the wall, once per appearance
    await vi.advanceTimersByTimeAsync(20_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("p2")').length).toBe(2);
    // a hidden search surface meets the gate: answered with the profile the session is on (the wall's own press, p2), and the list is kept from there too
    rt.videoLookup("dark");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: { ...GATE, profiles: [...GATE.profiles, { id: "p3", name: "Guest", avatar: null }] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "app:netflix:lookup", '__prismVideoProfile("p2")').length).toBe(1);
    expect(netflix(rt).profiles.map((p: { name: string }) => p.name)).toEqual(["Alex", "Kids", "Guest"]);
    // Ask: the choice cleared, the service asks again
    expect(JSON.parse(rt.videoProfileAsk("netflix"))).toEqual({ ok: true });
    expect(netflix(rt).profile).toBeNull();
    expect(store.get("video:profile:wall:netflix")).toBe("");
    await vi.advanceTimersByTimeAsync(20_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("p2")').length).toBe(2);   // no more
  });

  it("a watch can be taken back: the log entry, the resume point and the recents go, by id, address or title (the person's eraser)", async () => {
    const { rt, store } = await setup();
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, video: { kind: "episode", id: "ep1", title: "Strange New Worlds", series: "Star Trek", url: "https://www.netflix.com/watch/ep1", playing: true } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(rt.videoMenu()).log).toBe(1);
    expect(store.get("video:log:wall")).toContain("ep1");
    expect(JSON.parse(rt.videoForgetWatch("netflix", "nothing-like-it"))).toEqual({ ok: true, removed: 0 });
    expect(JSON.parse(rt.videoForgetWatch("nowhere", "ep1"))).toMatchObject({ ok: false });
    expect(JSON.parse(rt.videoForgetWatch("netflix", "Star Trek"))).toEqual({ ok: true, removed: 1 });   // by series name
    expect(JSON.parse(rt.videoMenu()).log).toBe(0);
    expect(store.get("video:log:wall")).not.toContain("ep1");
    expect(store.get("video:resume:wall:netflix")).toBe("null");
    expect(store.get("video:recent:wall:netflix")).toBe("[]");
    expect(netflix(rt).resume).toBeNull();
  });

  it("a switcher (no gate, a current profile): the standing choice is pressed when the page is on another profile, once, and never when it is on it", async () => {
    const { rt, ops } = await setup();
    const SWITCH = { gate: false, profiles: [{ id: "Alex", name: "Alex", avatar: null }, { id: "Maya", name: "Maya", avatar: null }], current: "Alex" };
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: SWITCH } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflix(rt).profiles.map((p: { name: string }) => p.name)).toEqual(["Alex", "Maya"]);
    expect(injects(ops, "screen", "__prismVideoProfile").length).toBe(0);   // no choice: nothing pressed
    expect(JSON.parse(rt.videoProfileChoose("netflix", "Alex"))).toEqual({ ok: true, name: "Alex" });
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", "__prismVideoProfile").length).toBe(0);   // already on Alex: nothing to press
    expect(JSON.parse(rt.videoProfileChoose("netflix", "Maya"))).toEqual({ ok: true, name: "Maya" });
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("Maya")').length).toBe(1);   // on Alex, Maya chosen: pressed
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: { ...SWITCH, current: "Maya" } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("Maya")').length).toBe(1);   // the page followed: no more
    await vi.advanceTimersByTimeAsync(20_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: SWITCH } }));   // someone switched it back on the page
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("Maya")').length).toBe(2);   // the standing choice presses again, once per appearance
  });

  it("an others-only switcher (Hulu's Account Menu, Peacock's nav) adds to what the gate taught and never takes away; a listed standing choice is pressed, the current one never", async () => {
    const { rt, ops } = await setup();
    const names = () => netflix(rt).profiles.map((p: { name: string }) => p.name);
    const HOUSE = { gate: true, profiles: [{ id: "Alex", name: "Alex", avatar: null }, { id: "Leo", name: "Leo", avatar: null }, { id: "Ivy", name: "Ivy", avatar: null }], current: null };
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: HOUSE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(names()).toEqual(["Alex", "Leo", "Ivy"]);
    // the gate left as Alex: the menu lists everyone but Alex, and someone new
    const OTHERS = { gate: false, othersOnly: true, profiles: [{ id: "Leo", name: "Leo", avatar: "https://a/c.png" }, { id: "Ivy", name: "Ivy", avatar: null }, { id: "Maya", name: "Maya", avatar: null }], current: null };
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: OTHERS } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(names()).toEqual(["Alex", "Leo", "Ivy", "Maya"]);   // Alex kept, Maya added
    expect(netflix(rt).profiles.find((p: { id: string }) => p.id === "Leo").avatar).toBe("https://a/c.png");   // a missing avatar filled in
    // standing choice Alex: not listed, so the page is on it - nothing pressed
    expect(JSON.parse(rt.videoProfileChoose("netflix", "Alex"))).toEqual({ ok: true, name: "Alex" });
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: OTHERS } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", "__prismVideoProfile").length).toBe(0);
    // standing choice Leo: listed, so the page is NOT on it - pressed once
    expect(JSON.parse(rt.videoProfileChoose("netflix", "Leo"))).toEqual({ ok: true, name: "Leo" });
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: OTHERS } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("Leo")').length).toBe(1);
    // a gate again is the whole household: a profile the service no longer lists goes
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: { ...HOUSE, profiles: HOUSE.profiles.slice(0, 2) } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(names()).toEqual(["Alex", "Leo"]);
  });

  it("a hidden surface at a gate presses the profile the session is ON, never the household's standing choice over a pick for this once, and nothing after a hand's answer on the screen (a product for every household, 2026-09-21)", async () => {
    const { rt, ops, store } = await setup();
    const hidden = () => injects(ops, "app:netflix:lookup", "__prismVideoProfile(");
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(rt.videoProfileChoose("netflix", "p2"))).toEqual({ ok: true, name: "Kids" });   // the household's standing choice: Kids
    await vi.advanceTimersByTimeAsync(20_000);
    // a person picks Alex for this once on the screen's gate
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    rt.videoProfile("screen", "p1", false);
    await vi.advanceTimersByTimeAsync(10);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, title: "" } }));   // the gate gone, Alex watching
    // the list refresh's hidden surface meets the gate: Alex, whom the session is on - not Kids
    rt.videoLookup("dark");
    await vi.advanceTimersByTimeAsync(50);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(hidden().map((o) => String(o.js).includes('"p1"'))).toEqual([true]);
    // later the gate shows on the screen and someone answers it by hand (no press of the wall's): the session's profile is unknown
    await vi.advanceTimersByTimeAsync(20_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: true, title: "" } }));
    await vi.advanceTimersByTimeAsync(20_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(hidden().length).toBe(1);   // nothing pressed: the read yields nothing rather than switch whoever is watching
    // a switcher on the screen names the session's profile again: the hidden surface may answer again
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: { gate: false, profiles: GATE.profiles, current: "Kids" } } }));
    await vi.advanceTimersByTimeAsync(20_000);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(hidden().length).toBe(2);
    expect(String(hidden()[1]!.js)).toContain('"p2"');
    // the session lives in the browser's cookies across a restart: so does the wall's knowledge of its profile
    const again = await setup(store);
    again.rt.videoLookup("dark");
    await vi.advanceTimersByTimeAsync(50);
    again.rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(again.ops, "app:netflix:lookup", '__prismVideoProfile("p2")').length).toBe(1);
  });

  it("the list and the choice survive a restart, and a service that never showed a gate offers no list", async () => {
    const first = await setup();
    first.rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    first.rt.videoProfileChoose("netflix", "p1");
    const { rt, ops } = await setup(first.store);
    await vi.advanceTimersByTimeAsync(50);
    expect(netflix(rt).profiles.length).toBe(2);
    expect(netflix(rt).profile).toMatchObject({ id: "p1", name: "Alex" });
    expect(JSON.parse(rt.videoServices()).services.find((s: { app: string }) => s.app === "tubi")).toMatchObject({ profiles: [], profile: null });
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(injects(ops, "screen", '__prismVideoProfile("p1")').length).toBe(1);
  });
});
