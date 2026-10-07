import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";

// Sign-ins on the wall (2026-09-29): a second person signs in as herself on Apple TV, the first person's sign-in stays on the device, and
// a profile set moves music and video together.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, profile: o.profile }), destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {}, setViewport: () => {},
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers };
}
const EMPTY = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "grid" }, tiles: [] };
const CATALOG = [
  { id: "appletv", name: "Apple TV", url: "https://tv.apple.com/", adapter: "appletv", audio: "exclusive", signInWith: "apple" },
  { id: "apple-music", name: "Apple Music", url: "https://music.apple.com/", adapter: null, audio: "exclusive", signInWith: "apple" },
  { id: "netflix", name: "Netflix", url: "https://www.netflix.com/browse", adapter: "netflix", audio: "exclusive", signInWith: null },
];
const OPTS = JSON.stringify({ adapters: { appletv: { match: ["tv.apple.com"], videoContext: "/*c*/" }, netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" }, "apple-music": { match: ["music.apple.com"], capabilities: ["media-session"] } } });
type View = { services: Array<{ app: string; kind: string; account: string; shares: string[]; signIns: Array<{ id: string; name: string }>; current: string | null }> };

async function setup() {
  const r = rig();
  const rt = createRuntime(r.drivers);
  rt.init(JSON.stringify(EMPTY), 1920, 1080, OPTS);
  await vi.advanceTimersByTimeAsync(100);
  // Apple TV alone among the video services first, so it is the one on the screen
  expect(JSON.parse(rt.playerSetup(JSON.stringify(CATALOG.filter((e) => e.id !== "netflix")), JSON.stringify(CATALOG)))).toMatchObject({ ok: true });
  expect(JSON.parse(rt.playerSetup(JSON.stringify([CATALOG[2]]), JSON.stringify(CATALOG)))).toMatchObject({ ok: true });
  rt.switchPlayer("video");
  await vi.advanceTimersByTimeAsync(200);
  return { ...r, rt };
}
const apps = (rt: ReturnType<typeof createRuntime>) => Object.fromEntries((JSON.parse(rt.modelState()) as { apps: Array<{ id: string; profileId: string; setup: { status: string } }> }).apps.map((a) => [a.id, a]));

describe("sign-ins on the wall", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("the services of both players are listed with their account's sign-ins; the profile they began with is the first", async () => {
    const { rt } = await setup();
    const v = JSON.parse(rt.signInsView(JSON.stringify(CATALOG))) as View;
    expect(v.services.map((s) => s.app + ":" + s.kind)).toEqual(["apple-music:music", "appletv:video", "netflix:video"]);
    const tv = v.services.find((s) => s.app === "appletv")!;
    expect(tv).toMatchObject({ account: "account:apple", shares: ["Apple Music"], signIns: [{ id: "household", name: "Household" }], current: "household" });
    expect(v.services.find((s) => s.app === "netflix")).toMatchObject({ account: "app:netflix", shares: [], current: "household" });
  });

  it("a second person signs in as herself on Apple TV: her own profile, the window made again in it, Apple Music left as it was", async () => {
    const { rt, ops } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    const before = apps(rt);
    expect(before.appletv!.profileId).toBe("shared");
    rt.modelSaveApp(JSON.stringify({ ...before.appletv, setup: { status: "signed-in" } }));
    const added = JSON.parse(rt.signInAdd("appletv", "Maya"));
    expect(added).toMatchObject({ ok: true, made: true, signIn: { id: "maya", name: "Maya" } });
    expect(apps(rt).appletv!.profileId).toBe("shared");   // adding is not switching
    ops.length = 0;
    expect(JSON.parse(rt.signInUse("appletv", "maya"))).toMatchObject({ ok: true, changed: true, status: "unknown" });
    await vi.advanceTimersByTimeAsync(200);
    expect(apps(rt).appletv).toMatchObject({ profileId: "shared-2", setup: { status: "unknown" } });
    expect(apps(rt)["apple-music"]!.profileId).toBe("shared");
    expect(ops.filter((o) => o.op === "destroy").map((o) => o.id)).toEqual(["screen"]);
    expect(ops.filter((o) => o.op === "create")).toEqual([{ op: "create", id: "screen", profile: "shared-2" }]);
    // her sign-in is there for Apple Music too, with no new login
    const v = JSON.parse(rt.signInsView(null)) as View;
    expect(v.services.find((s) => s.app === "apple-music")).toMatchObject({ current: "household", signIns: [{ id: "household" }, { id: "maya" }] });
    expect(v.services.find((s) => s.app === "appletv")!.current).toBe("maya");
    // and back: the first person's sign-in, signed in as it was left
    expect(JSON.parse(rt.signInUse("appletv", "household"))).toMatchObject({ ok: true, changed: true, status: "signed-in" });
    expect(apps(rt).appletv).toMatchObject({ profileId: "shared", setup: { status: "signed-in" } });
    expect(JSON.parse(rt.signInUse("appletv", "household"))).toMatchObject({ ok: true, changed: false });
    expect(JSON.parse(rt.signInUse("appletv", "nobody"))).toMatchObject({ ok: false });
    expect(JSON.parse(rt.signInUse("netflix", "maya"))).toMatchObject({ ok: false });   // an Apple sign-in is not one of Netflix's
  });

  it("a profile set carries the sign-ins of music and video together; applying it moves both players", async () => {
    const { rt, ops } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    expect(JSON.parse(rt.videoPresetSave("Alex"))).toMatchObject({ ok: true, preset: { name: "Alex", signIns: { appletv: "household", "apple-music": "household", netflix: "household" } } });
    rt.signInAdd("appletv", "Maya");
    // her set: Apple TV and Apple Music hers, Netflix the household's
    expect(JSON.parse(rt.videoProfilesCommit(JSON.stringify({ picks: {}, off: [], name: "Maya", signIns: { appletv: "maya", "apple-music": "maya" } })))).toMatchObject({ ok: true, moved: ["appletv", "apple-music"], preset: { name: "Maya" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(apps(rt).appletv!.profileId).toBe("shared-2");
    expect(apps(rt)["apple-music"]!.profileId).toBe("shared-2");
    expect(apps(rt).netflix!.profileId).toBe("shared");
    const view = JSON.parse(rt.videoProfilesView()) as { presets: Array<{ id: string; name: string; signIns?: Record<string, string> }>; active: string | null };
    const maya = view.presets.find((p) => p.name === "Maya")!, alex = view.presets.find((p) => p.name === "Alex")!;
    expect(maya.signIns).toEqual({ appletv: "maya", "apple-music": "maya", netflix: "household" });
    expect(view.active).toBe(maya.id);
    ops.length = 0;
    expect(JSON.parse(rt.videoPresetApply(alex.id))).toMatchObject({ ok: true, moved: ["apple-music", "appletv"] });   // in the order the set keeps them
    await vi.advanceTimersByTimeAsync(200);
    expect(apps(rt).appletv!.profileId).toBe("shared");
    expect(apps(rt)["apple-music"]!.profileId).toBe("shared");
    // both windows made again in the first person's profile: the screen, and the music kept warm beside it
    expect(ops.filter((o) => o.op === "create").map((o) => o.id + "@" + o.profile).sort()).toEqual(["apple-music-home-16x9-XL@shared", "screen@shared"]);
  });

  it("a person with her set on switches from music to video and back: nobody is asked again, nothing moves (2026-09-29)", async () => {
    const { rt, ops } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    rt.signInAdd("appletv", "Maya");
    rt.videoProfilesCommit(JSON.stringify({ picks: {}, off: [], name: "Maya", signIns: { appletv: "maya", "apple-music": "maya" } }));
    await vi.advanceTimersByTimeAsync(200);
    const set = (JSON.parse(rt.videoProfilesView()) as { active: string | null }).active;
    ops.length = 0;
    for (const kind of ["music", "video", "music", "video"]) {
      expect(JSON.parse(rt.switchPlayer(kind))).toMatchObject({ ok: true });
      await vi.advanceTimersByTimeAsync(200);
      expect(apps(rt).appletv!.profileId).toBe("shared-2");
      expect(apps(rt)["apple-music"]!.profileId).toBe("shared-2");
      expect((JSON.parse(rt.videoProfilesView()) as { active: string | null }).active).toBe(set);
    }
    // her music page stayed loaded through every switch, in her sign-in
    expect(ops.filter((o) => o.id === "apple-music-home-16x9-XL" && (o.op === "destroy" || o.op === "create"))).toEqual([]);
  });

  it("before the first other person is added, the wall as it stands is kept as a set to switch back to", async () => {
    const { rt } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    const sets = () => (JSON.parse(rt.videoProfilesView()) as { presets: Array<{ id: string; name: string; signIns?: Record<string, string> }>; active: string | null });
    expect(sets().presets).toEqual([]);
    rt.signInAdd("appletv", "Maya");
    expect(sets().presets.map((p) => p.name)).toEqual(["Household"]);
    expect(sets().presets[0]!.signIns).toEqual({ "apple-music": "household", appletv: "household", netflix: "household" });
    expect(sets().active).toBe(sets().presets[0]!.id);
    rt.signInAdd("netflix", "Maya");   // sets exist: none is made
    expect(sets().presets.length).toBe(1);
    rt.videoProfilesCommit(JSON.stringify({ picks: {}, off: [], name: "Maya", signIns: { appletv: "maya" } }));
    await vi.advanceTimersByTimeAsync(200);
    expect(apps(rt).appletv!.profileId).toBe("shared-2");
    expect(JSON.parse(rt.videoPresetApply(sets().presets.find((p) => p.name === "Household")!.id))).toMatchObject({ ok: true, moved: ["appletv"] });
    expect(apps(rt).appletv!.profileId).toBe("shared");
  });

  it("a person renames a sign-in and a set: 'Household' is only where the names begin (2026-09-29)", async () => {
    const { rt } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    rt.signInAdd("appletv", "Maya");
    expect(JSON.parse(rt.signInRename("appletv", "household", "Alex"))).toEqual({ ok: true, also: 1 });
    const v = JSON.parse(rt.signInsView(null)) as View;
    // the account's sign-in, so Apple Music names it the same
    expect(v.services.find((s) => s.app === "apple-music")!.signIns).toEqual([{ id: "household", name: "Alex" }, { id: "maya", name: "Maya" }]);
    expect(v.services.find((s) => s.app === "netflix")!.signIns).toEqual([{ id: "household", name: "Alex" }]);   // the same name on another service follows
    expect(JSON.parse(rt.signInRename("appletv", "household", "maya"))).toMatchObject({ ok: false });
    const sets = () => (JSON.parse(rt.videoProfilesView()) as { presets: Array<{ id: string; name: string; signIns?: Record<string, string> }> }).presets;
    const first = sets()[0]!;
    expect(first.name).toBe("Household");
    expect(JSON.parse(rt.videoPresetRename(first.id, "  Alex "))).toEqual({ ok: true });
    expect(sets()[0]).toMatchObject({ id: first.id, name: "Alex", signIns: first.signIns });   // what it holds is as it was
    expect(JSON.parse(rt.videoPresetRename(first.id, " "))).toMatchObject({ ok: false });
    expect(JSON.parse(rt.videoPresetRename("nothing", "X"))).toMatchObject({ ok: false });
  });

  it("the sign-ins are kept across a restart", async () => {
    const { rt, drivers, store } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    rt.signInAdd("appletv", "Maya");
    rt.signInUse("appletv", "maya");
    await vi.advanceTimersByTimeAsync(200);
    const next = createRuntime(drivers);
    next.init(store.get("dashboard")!, 1920, 1080, OPTS);
    await vi.advanceTimersByTimeAsync(200);
    const v = JSON.parse(next.signInsView(null)) as View;
    expect(v.services.find((s) => s.app === "appletv")).toMatchObject({ account: "account:apple", current: "maya", signIns: [{ id: "household", name: "Household" }, { id: "maya", name: "Maya" }] });
  });
});

describe("after the review (2026-09-29)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("a service whose account the catalog now shares keeps its sign-ins, names and all", async () => {
    const r = rig();
    const rt = createRuntime(r.drivers);
    rt.init(JSON.stringify(EMPTY), 1920, 1080, OPTS);
    await vi.advanceTimersByTimeAsync(100);
    const alone = CATALOG.map((e) => ({ ...e, signInWith: null }));
    rt.playerSetup(JSON.stringify(alone), JSON.stringify(alone));
    rt.signInsView(JSON.stringify(alone));
    rt.signInRename("appletv", "household", "Alex");
    expect((JSON.parse(rt.signInsView(null)) as View).services.find((s) => s.app === "appletv")).toMatchObject({ account: "app:appletv", signIns: [{ id: "household", name: "Alex" }] });
    // the catalog learns that Apple TV and Apple Music share an account
    const v = JSON.parse(rt.signInsView(JSON.stringify(CATALOG))) as View;
    const tv = v.services.find((s) => s.app === "appletv")!;
    expect(tv.account).toBe("account:apple");
    expect(tv.signIns.find((s) => s.name === "Alex")).toBeTruthy();
    expect(tv.current).toBe(tv.signIns.find((s) => s.name === "Alex")!.id);
  });

  it("a music service taken off while the Video player is the wall leaves the wall now", async () => {
    const { rt, ops } = await setup();
    ops.length = 0;
    expect(JSON.parse(rt.playerRemove("apple-music"))).toMatchObject({ ok: true, kind: "music", changed: ["music-lounge-1"] });
    await vi.advanceTimersByTimeAsync(200);
    expect(ops.filter((o) => o.op === "destroy").map((o) => o.id)).toEqual(["apple-music-home-16x9-XL"]);
  });
});

describe("accounts learned again (2026-09-30 review)", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());
  it("a service un-shared from an account leaves the account's sign-ins to the service still on it; a preset follows a renamed id", async () => {
    const { rt } = await setup();
    rt.signInsView(JSON.stringify(CATALOG));
    rt.signInAdd("appletv", "Maya");
    rt.videoProfilesCommit(JSON.stringify({ picks: {}, off: [], name: "Maya", signIns: { appletv: "maya" } }));
    await vi.advanceTimersByTimeAsync(200);
    // the catalog now says Apple TV shares nothing
    const cat = CATALOG.map((e) => (e.id === "appletv" ? { ...e, signInWith: null } : e));
    const v = JSON.parse(rt.signInsView(JSON.stringify(cat))) as View;
    const music = v.services.find((s) => s.app === "apple-music")!, tv = v.services.find((s) => s.app === "appletv")!;
    expect(music.account).toBe("account:apple");
    expect(music.signIns.map((s) => s.name)).toEqual(["Household", "Maya"]);   // Apple Music keeps the account's sign-ins
    expect(tv.account).toBe("app:appletv");
    expect(tv.signIns.map((s) => s.name)).toEqual(["Household", "Maya"]);       // and Apple TV takes them along
    expect(tv.current).toBe(tv.signIns.find((s) => s.name === "Maya")!.id);
    const sets = (JSON.parse(rt.videoProfilesView()) as { presets: Array<{ name: string; signIns?: Record<string, string> }> }).presets;
    expect(sets.find((p) => p.name === "Maya")!.signIns!.appletv).toBe(tv.current);
  });
});
