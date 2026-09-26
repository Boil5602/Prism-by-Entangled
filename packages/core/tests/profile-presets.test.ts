import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Profile presets (2026-09-24): "save any number of profile presets. So if another user logs in, they can change the preset and therefore all
// service profiles, and see their My & Continue items update ... when they make the preset change, the software updates ALL the profiles for
// them at once." A preset change is the person's ask to switch whose account each service watches as: the hidden page presses the profile and
// the rows are read again; each profile's last rows come back at once.

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
const GATE = { gate: true, profiles: [{ id: "p1", name: "Alex", avatar: null }, { id: "p2", name: "Sam", avatar: null }], current: null };
const item = (id: string, title: string) => ({ id, title, kind: "series", url: null, artwork: null, subtitle: null, progress: null });

async function setup() { return setupWith({}); }
async function setupWith(extra: Record<string, unknown>) {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: {
    netflix: { match: ["www.netflix.com"], videoContext: "/*c*/", videoProfiles: "/*p*/", videoLibrary: "/*lib*/", videoListUrl: "https://www.netflix.com/browse/my-list", videoProfilesUrl: "https://www.netflix.com/ProfilesGate", ...extra },
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
  // Netflix has shown its gate once: its profiles are known
  rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoProfiles: GATE } }));
  await vi.advanceTimersByTimeAsync(20_000);
  r.ops.length = 0;
  return { ...r, rt };
}
const view = (rt: ReturnType<typeof createRuntime>) => JSON.parse(rt.videoProfilesView());
/** Netflix's hidden page shows the switch done - the wanted profile current (a real switch is confirmed so before the new person's rows count, 2026-09-24). */
const confirmOn = (rt: ReturnType<typeof createRuntime>, id: string) => rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: { gate: false, current: id, profiles: [{ id: "p1", name: "Alex", avatar: null }, { id: "p2", name: "Sam", avatar: null }] } } }));
const netflixRows = (rt: ReturnType<typeof createRuntime>) => { const s = JSON.parse(rt.videoServices()).services.find((x: { app: string }) => x.app === "netflix"); return { cw: (s.library.continue ?? []).map((i: { title: string }) => i.title), list: (s.library.list ?? []).map((i: { title: string }) => i.title) }; };

describe("profile presets", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the Profiles window lists only the services that have profiles, each with its current one", async () => {
    const { rt } = await setup();
    const v = view(rt);
    expect(v.services.map((s: { app: string }) => s.app)).toEqual(["netflix"]);   // Tubi has no profiles: not listed
    expect(v.services[0].profiles.map((p: { name: string }) => p.name)).toEqual(["Alex", "Sam"]);
    expect(v.services[0].current).toBeNull();
    expect(v.presets).toEqual([]);
  });

  it("presets save the current profiles under a name; applying one switches every service at once and reads its rows again", async () => {
    const { rt, ops } = await setup();
    expect(JSON.parse(rt.videoPresetSave("Alex"))).toMatchObject({ ok: false });   // nothing chosen yet
    expect(JSON.parse(rt.videoProfileSet("netflix", "p1")).ok).toBe(true);
    const mark = JSON.parse(rt.videoPresetSave("Alex")).preset;
    expect(mark.picks).toEqual({ netflix: { id: "p1", name: "Alex" } });
    rt.videoProfileSet("netflix", "p2");
    const sam = JSON.parse(rt.videoPresetSave("Sam")).preset;
    expect(view(rt).presets.map((p: { name: string }) => p.name)).toEqual(["Alex", "Sam"]);
    expect(view(rt).active).toBe(sam.id);
    // the same name replaces, not a twin
    expect(JSON.parse(rt.videoPresetSave("sam")).preset.id).toBe(sam.id);
    expect(view(rt).presets.length).toBe(2);
    ops.length = 0;
    // apply Alex: the choice, the profile page opened on the hidden surface, the wanted profile pressed there, then the list read
    expect(JSON.parse(rt.videoPresetApply(mark.id))).toEqual({ ok: true, switched: ["netflix"], missing: [] });
    expect(view(rt).active).toBe(mark.id);
    expect(view(rt).services[0].current).toEqual({ id: "p1", name: "Alex" });
    await vi.advanceTimersByTimeAsync(50);
    expect(ops.some((o) => o.op === "navigate" && o.id === "app:netflix:lookup" && o.url === "https://www.netflix.com/ProfilesGate")).toBe(true);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: GATE } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(ops.filter((o) => o.op === "inject" && o.id === "app:netflix:lookup" && String(o.js).includes('__prismVideoProfile("p1")')).length).toBe(1);
    expect(view(rt).services[0].switching).toBe(true);   // pressed; the new person's list not read yet
    await vi.advanceTimersByTimeAsync(13_000);
    expect(ops.some((o) => o.op === "navigate" && o.id === "app:netflix:lookup" && o.url === "https://www.netflix.com/browse/my-list")).toBe(true);
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoLibrary: { continue: [], list: [item("m1", "Alex's show")], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(view(rt).services[0].switching).toBe(false);   // read: the switch is complete
    // delete
    rt.videoPresetDelete(sam.id);
    expect(view(rt).presets.map((p: { name: string }) => p.name)).toEqual(["Alex"]);
  });

  it("each profile's rows: a switch never shows the other person's rows, and brings back that profile's last ones at once", async () => {
    const { rt } = await setup();
    rt.videoProfileSet("netflix", "p1"); confirmOn(rt, "p1");
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true })); rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("a", "Dark")], list: [item("b", "Ozark")], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflixRows(rt)).toEqual({ cw: ["Dark"], list: ["Ozark"] });
    rt.videoProfileSet("netflix", "p2"); confirmOn(rt, "p2");
    expect(netflixRows(rt)).toEqual({ cw: [], list: [] });   // Sam's not read yet: nothing of Alex's
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true })); rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("c", "Bluey")], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflixRows(rt).cw).toEqual(["Bluey"]);
    rt.videoProfileSet("netflix", "p1"); confirmOn(rt, "p1");
    expect(netflixRows(rt)).toEqual({ cw: ["Dark"], list: ["Ozark"] });   // Alex's, at once
  });

  it("an others-only switcher that does not list the wanted profile is already on it: nothing pressed", async () => {
    const { rt, ops } = await setup();
    rt.videoProfileSet("netflix", "p2");
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    rt.event(JSON.stringify({ type: "now-playing", id: "app:netflix:lookup", info: { playing: false, videoProfiles: { gate: false, othersOnly: true, profiles: [{ id: "p1", name: "Alex", avatar: null }] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(ops.some((o) => o.op === "inject" && String(o.js).includes("__prismVideoProfile"))).toBe(false);
  });

  it("a service with its own switch address (Netflix's /SwitchProfile?tkn=) is switched by opening it; a note in the profile-page field is never opened", async () => {
    const { rt, ops } = await setupWith({ videoProfileSwitchUrl: "https://www.netflix.com/SwitchProfile?tkn={id}", videoProfilesUrl: "NOT SET - a note" });
    rt.videoProfileSet("netflix", "p2");
    await vi.advanceTimersByTimeAsync(50);
    const navs = ops.filter((o) => o.op === "navigate" && o.id === "app:netflix:lookup").map((o) => o.url);
    expect(navs).toContain("https://www.netflix.com/SwitchProfile?tkn=p2");
    expect(navs.some((u) => String(u).startsWith("NOT SET"))).toBe(false);

  });

  it("Exclude: a service's cards leave Watch's Continue watching and My list for the person on now, and a preset carries it (2026-09-24)", async () => {
    const { rt } = await setup();
    rt.videoProfileSet("netflix", "p1"); confirmOn(rt, "p1");
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true })); rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("a", "Dark")], list: [item("b", "Ozark")], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    const menuTitles = () => { const m = JSON.parse(rt.videoMenu()); return { cw: m.continue.map((c: { item: { title: string } }) => c.item.title), list: m.list.map((c: { item: { title: string } }) => c.item.title) }; };
    expect(menuTitles()).toEqual({ cw: ["Dark"], list: ["Ozark"] });
    const mark = JSON.parse(rt.videoPresetSave("Alex")).preset;
    expect(JSON.parse(rt.videoProfileExclude("netflix", true))).toEqual({ ok: true, excluded: true });
    expect(menuTitles()).toEqual({ cw: [], list: [] });
    expect(view(rt).services[0].excluded).toBe(true);
    expect(view(rt).others.map((o: { app: string; excluded: boolean }) => o.app + ":" + o.excluded)).toEqual(["tubi:false"]);   // a service without profiles can be excluded too
    expect(view(rt).active).toBeNull();   // no longer the saved Alex
    const sam = JSON.parse(rt.videoPresetSave("Sam")).preset;
    expect(sam.off).toEqual(["netflix"]);
    rt.videoPresetApply(mark.id);
    expect(menuTitles().cw).toEqual(["Dark"]);   // Alex's preset includes Netflix
    rt.videoPresetApply(sam.id);
    expect(menuTitles()).toEqual({ cw: [], list: [] });
    expect(JSON.parse(rt.videoServices()).services.find((x: { app: string }) => x.app === "netflix").library.continue.length).toBe(1);   // still kept - only Watch's two rows leave it out
  });

  it("the window's draft is committed at once: only a changed profile is switched, the exclusions set, the loaded preset updated or a new one named", async () => {
    const { rt, ops } = await setup();
    rt.videoProfileSet("netflix", "p1");
    const mark = JSON.parse(rt.videoPresetSave("Alex")).preset;
    await vi.advanceTimersByTimeAsync(50);
    ops.length = 0;
    // the same profile, Tubi excluded, Alex updated: nothing switched
    let r = JSON.parse(rt.videoProfilesCommit(JSON.stringify({ picks: { netflix: "p1" }, off: ["tubi"], preset: mark.id })));
    expect(r).toMatchObject({ ok: true, switched: [], preset: { id: mark.id, name: "Alex" } });
    expect(ops.some((o) => o.op === "navigate")).toBe(false);
    expect(view(rt).presets[0].off).toEqual(["tubi"]);
    expect(view(rt).off).toEqual(["tubi"]);
    // a changed profile under a new name: switched, a new preset, the one on now
    r = JSON.parse(rt.videoProfilesCommit(JSON.stringify({ picks: { netflix: "p2" }, off: [], name: "Sam" })));
    expect(r.switched).toEqual(["netflix"]);
    expect(view(rt).presets.map((p: { name: string }) => p.name)).toEqual(["Alex", "Sam"]);
    expect(view(rt).active).toBe(r.preset.id);
    // an id the service never listed is ignored
    r = JSON.parse(rt.videoProfilesCommit(JSON.stringify({ picks: { netflix: "p9" }, off: [] })));
    expect(r).toMatchObject({ ok: true, switched: [], preset: null });
  });

  it("after a switch, a window of the service still on the last person's page does not bring that person's rows back (2026-09-24, the stutter)", async () => {
    const { rt } = await setup();
    rt.videoProfileSet("netflix", "p1"); confirmOn(rt, "p1");
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("a", "Dark")], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    rt.videoProfileSet("netflix", "p2"); confirmOn(rt, "p2");
    // the screen, not reloaded yet, reports Alex's rows again: not kept
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("a", "Dark")], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflixRows(rt).cw).toEqual([]);
    // it loads a page (the new person's): its rows count again
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("c", "Bluey")], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflixRows(rt).cw).toEqual(["Bluey"]);
  });

  it("after a switch, a window reloaded before the switch is pressed does not bring the last person's rows back (2026-09-24, \"the continue watching and my list were combined for at least a couple minutes\")", async () => {
    const { rt } = await setup();
    rt.videoProfileSet("netflix", "p1"); confirmOn(rt, "p1");
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("a", "Dark")], list: [item("b", "Ozark")], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    rt.videoProfileSet("netflix", "p2");
    // a Netflix window on the wall loads a page before the switch is pressed anywhere: still Alex's page - not kept
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("a", "Dark")], list: [item("b", "Ozark")], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflixRows(rt)).toEqual({ cw: [], list: [] });
    // the switch is done (the page shows Sam current), and the window loads her page: her rows count
    confirmOn(rt, "p2");
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/browse" })); rt.event(JSON.stringify({ type: "load-finished", id: "screen", ok: true }));
    rt.event(JSON.stringify({ type: "now-playing", id: "screen", info: { playing: false, videoLibrary: { continue: [item("c", "Bluey")], list: [], shelves: [] } } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(netflixRows(rt).cw).toEqual(["Bluey"]);
  });
});
