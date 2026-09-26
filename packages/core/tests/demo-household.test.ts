/**
 * The demo household — "the Parkers" (docs/concept-scenes.md §7, CS-5).
 *
 * The seed itself lives in `scripts/seed-demo-household.mjs` (it is a command,
 * not a core module) but every decision it makes is core's: the four templates
 * come from `SCENE_TEMPLATES` and the layouts and scenes from
 * `instantiateTemplate`, so the fixture injects core's SOURCE module and
 * exercises the real thing.
 *
 * What is pinned here:
 *   - the household: two adults, two kids; six chores, three done, at least one
 *     each; the fake week has the school run, soccer at 4, the dentist on
 *     Thursday and pizza on Friday, and no name reaches anything but those two
 *     lists (charter §7: "nowhere else")
 *   - the entities: 2 first-party Apps, 3 Facets, 5 Layouts, 5 Scenes; Family
 *     Hub is portrait; every account-needing role is an App-poster placeholder
 *     (scene-model spec §5) so the demo needs no sign-in — including Music
 *     Lounge's HIDDEN music source, which is what leaves that wall idle
 *     (CS-9; the lounge's own fixtures are in music-lounge-demo.test.ts)
 *   - §10, the part to get right: seed twice = one household, byte for byte;
 *     seed → reset = the store exactly as it was; reset on a store the seed
 *     never touched refuses and changes nothing; a pre-existing entity id is
 *     never overwritten and never removed by reset.
 */
import { describe, expect, it } from "vitest";
import { normalizeAgenda } from "../src/tiles-data.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../src/scene-model.js";
import { CHORES_KEY, normalizeChores } from "../src/tiles-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const seedModule = join(here, "..", "..", "..", "scripts", "seed-demo-household.mjs");
const seed = (await import(/* @vite-ignore */ seedModule)) as typeof import("../../../scripts/seed-demo-household.mjs");

const {
  HOUSEHOLD, PLACEHOLDER_REF, RECEIPT_KEY, STORE_KEYS, DEMO_ACTIVE_SCENE,
  applySeed, resetSeed, seedPlan, calendarWeek, choreList, choresStoreEntries, calendarStoreEntries,
} = seed as any;

const NOW = "2026-09-02T00:00:00.000Z";
const sow = (data: Record<string, string> = {}) => applySeed(data, core, { now: NOW });

/* ------------------------------------------------------------ the family ---- */

describe("the Parkers", () => {
  it("is two adults and two kids", () => {
    expect(HOUSEHOLD.members.filter((m: any) => m.role === "adult")).toHaveLength(2);
    expect(HOUSEHOLD.members.filter((m: any) => m.role === "child")).toHaveLength(2);
    expect(HOUSEHOLD.members.map((m: any) => m.name)).toEqual(["Alex", "Sam", "Maya", "Leo"]);
  });

  it("has six chores, three done, and at least one for each person", () => {
    const chores = choreList();
    expect(chores).toHaveLength(6);
    expect(chores.filter((c: any) => c.done)).toHaveLength(3);
    for (const m of HOUSEHOLD.members) expect(chores.some((c: any) => c.who === m.id)).toBe(true);
    for (const c of chores) expect(HOUSEHOLD.members.some((m: any) => m.id === c.who)).toBe(true);
  });

  it("has a week with the school run, soccer at 4, the dentist Thursday and pizza Friday", () => {
    const week = calendarWeek("2026-09-07");
    const titles = week.map((e: any) => e.title);
    expect(titles.filter((t: string) => t === "School run")).toHaveLength(5);
    const soccer = week.find((e: any) => e.title === "Soccer practice");
    expect(soccer.start).toBe("2026-09-08T16:00:00");
    expect(week.find((e: any) => e.title === "Dentist").start.startsWith("2026-09-10")).toBe(true);   // Thursday
    expect(week.find((e: any) => e.title === "Pizza night").start.startsWith("2026-09-11")).toBe(true); // Friday
    // local wall-clock strings only: nothing here is fetched, nothing carries an identifier (§19/§22)
    for (const e of week) expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("is deterministic (the same week for the same anchor)", () => {
    expect(calendarWeek("2026-09-07")).toEqual(calendarWeek("2026-09-07"));
    expect(calendarWeek("2026-09-14")[0].start.startsWith("2026-09-14")).toBe(true);
  });

  it("keeps the names on the chore list and the calendar and nowhere else", () => {
    const plan = seedPlan(core, {});
    const names = HOUSEHOLD.members.map((m: any) => m.name);
    const elsewhere = JSON.stringify({ apps: plan.apps, facets: plan.facets, layouts: plan.layouts, scenes: plan.scenes });
    for (const n of names) expect(elsewhere).not.toContain(n);
  });

  it("invents no account and names no third-party service", () => {
    const plan = seedPlan(core, {});
    expect(plan.apps.map((a: any) => a.id).sort()).toEqual(["prism-agenda", "prism-chores", "prism-timer"]);
    for (const a of plan.apps) {
      expect(a.setup.status).toBe("unknown");       // the seed never claims a sign-in
      expect(new URL(a.baseUrl).hostname).toBe("tiles.prism");   // first-party, host-served, offline
    }
  });
});

/* --------------------------------------------------------- the adapters ---- */

describe("the store adapters (the CS-3 reconcile points)", () => {
  it("puts every chores assumption in one function, writing one key", () => {
    const entries = choresStoreEntries(choreList(), HOUSEHOLD);
    expect(entries.map((e: any) => e.key)).toEqual([CHORES_KEY]);
    expect(entries[0].value.items).toHaveLength(6);
    expect(entries[0].value.v).toBe(1);
  });

  // The reconcile: the seeded list is the real document the micro-facet and
  // the phone both read (CS-3), not demo-only data sitting beside it.
  it("writes a chores document core reads back unchanged", () => {
    const entries = choresStoreEntries(choreList(), HOUSEHOLD, "2026-09-07");
    const doc = normalizeChores(JSON.stringify(entries[0].value), Date.parse(NOW));
    expect(doc.items.map((i) => i.text)).toEqual(choreList().map((c: any) => c.text));
    expect(doc.items.filter((i) => i.done)).toHaveLength(3);
    // `who` is the name the page shows — a name typed on this device, never an account id.
    expect(doc.items.map((i) => i.who)).toEqual(["Maya", "Sam", "Leo", "Maya", "Alex", "Leo"]);
    expect(doc.items.every((i) => i.added === "2026-09-07")).toBe(true);
    expect(doc.notes).toBe(seed.CHORE_NOTES);
    expect(doc.updated).toBe("2026-09-07");
  });

  it("puts every calendar assumption in one function, now writing the REAL agenda document too (CS-10.3)", () => {
    const entries = calendarStoreEntries(calendarWeek(), HOUSEHOLD, "2026-09-07");
    // tiles:agenda is what prism-agenda and a phone read; demo:calendar is KEPT
    // because §10 never deletes what a store already holds.
    expect(entries.map((e: any) => e.key)).toEqual(["tiles:agenda", "demo:calendar"]);
    for (const e of entries) expect(e.value.weekOf).toBe("2026-09-07");
    // both carry the SAME events in the same shape, so one renderer serves both
    expect(entries[0].value.events).toEqual(entries[1].value.events);
    // and the agenda document is the shape core parses
    const doc = normalizeAgenda(JSON.stringify(entries[0].value));
    expect(doc.v).toBe(1);
    expect(doc.weekOf).toBe("2026-09-07");
    expect(doc.events.length).toBe(calendarWeek().length);
    expect(doc.events.every((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.start))).toBe(true);
  });
});

/* ---------------------------------------------------------- the entities ---- */

describe("seeding", () => {
  it("creates the expected entities and the five scenes", () => {
    const r = sow();
    expect(r.ok).toBe(true);
    expect(r.created).toEqual({
      apps: ["prism-chores", "prism-timer", "prism-agenda"],
      facets: ["demo-chores-4x3-M", "demo-chores-1x1-M", "demo-timer-16x9-M", "demo-agenda-4x3-M", "demo-agenda-1x1-M"],
      layouts: ["demo-kitchen-command-layout", "demo-sports-multiview-layout", "demo-movie-night-layout", "demo-family-hub-layout", "demo-music-lounge-layout"],
      scenes: ["demo-kitchen-command", "demo-sports-multiview", "demo-movie-night", "demo-family-hub", "demo-music-lounge"],
    });
    expect(Object.keys(r.receipt.keys)).toEqual(["demo:household", "tiles:agenda", "demo:calendar", "tiles:chores"]);
    expect(r.data[STORE_KEYS.activeScene]).toBe(DEMO_ACTIVE_SCENE);
  });

  it("instantiates each template at its own canvas class - Family Hub portrait", () => {
    const layouts = JSON.parse(sow().data[STORE_KEYS.layouts]);
    const byId = Object.fromEntries(layouts.map((l: any) => [l.id, l]));
    for (const id of ["demo-kitchen-command-layout", "demo-sports-multiview-layout", "demo-movie-night-layout", "demo-music-lounge-layout"]) {
      expect(core.formatCanvasClass(byId[id].canvas)).toBe("16:9 @ 1080-class");
      expect(byId[id].canvas.orientation).toBe("landscape");
    }
    expect(core.formatCanvasClass(byId["demo-family-hub-layout"].canvas)).toBe("9:16 portrait @ 1080-class");
    expect(byId["demo-family-hub-layout"].slots).toHaveLength(6);
    for (const l of layouts) expect(l.source).toEqual({ mode: "template", template: l.id.replace(/^demo-|-layout$/g, "") });
  });

  it("draws no note: every role's class is what the canvas derives", () => {
    expect(seedPlan(core, {}).notes).toEqual([]);
  });

  it("gives every account-needing role the App-poster placeholder, and only the first-party roles a facet", () => {
    const r = sow();
    const scenes = JSON.parse(r.data[STORE_KEYS.scenes]);
    const facetIds = new Set(JSON.parse(r.data[STORE_KEYS.facets]).map((f: any) => f.id));
    // §7a: a visualization role's assignment is a visualization id, looked up in
    // the scene's own visualizations[] before any facet is (resolveAssignment).
    const vizIds = new Set(scenes.flatMap((s: any) => (s.visualizations ?? []).map((v: any) => v.id)));
    const assigned = scenes.flatMap((s: any) => Object.entries(s.assign) as Array<[string, string]>);
    for (const [, ref] of assigned) {
      if (ref === PLACEHOLDER_REF || vizIds.has(ref)) continue;
      expect(facetIds.has(ref)).toBe(true);
    }
    // 11: CS-10.2 retemplated Sports Multiview to hero-plus-two (one game slot
    // fewer, charter §2.2), and since the 2026-09-05 audit the agenda role in
    // Kitchen Command and Family Hub resolves to the first-party Agenda
    // micro-facet (CS-10.5 built it; the seed already wrote its data).
    expect(assigned.filter(([, ref]) => ref === PLACEHOLDER_REF)).toHaveLength(11);
    // exactly the first-party roles resolve to a facet; the stage resolves to its visualization
    expect(assigned.filter(([, ref]) => ref !== PLACEHOLDER_REF && !vizIds.has(ref)).map(([slot]) => slot).sort()).toEqual(["agenda", "agenda", "chores", "chores", "timer"]);
    expect([...vizIds]).toEqual(["viz-stage"]);
    // and the ONE hidden placement the seed writes is the lounge's idle music source
    expect(scenes.flatMap((s: any) => s.hidden)).toEqual([{ facet: PLACEHOLDER_REF, audio: "exclusive" }]);
  });

  it("renders those slots as placeholders through sceneDocument (spec §5)", () => {
    const r = sow();
    const facets = JSON.parse(r.data[STORE_KEYS.facets]).map((f: any) => core.normalizeFacet(f)!);
    const apps = JSON.parse(r.data[STORE_KEYS.apps]).map((a: any) => core.normalizeApp(a)!);
    const layout = core.normalizeLayout(JSON.parse(r.data[STORE_KEYS.layouts])[0])!;
    const scene = core.normalizeScene(JSON.parse(r.data[STORE_KEYS.scenes])[0])!;
    const { doc, notes } = core.sceneDocument({ scene, layout, facets, apps }, "demo", { w: 1920, h: 1080 });
    const hero = doc.tiles.find((t) => t.id === "hero")!;
    expect(hero.placeholder).toBe(true);
    expect(hero.url).toBeUndefined();
    expect(doc.tiles.find((t) => t.id === "chores")!.url).toBe("https://tiles.prism/chores/");
    // the placeholder ref is honestly reported, never silently swallowed
    expect(notes.every((n) => n.includes(PLACEHOLDER_REF))).toBe(true);
  });

  it("produces entities core's own normalizers accept unchanged", () => {
    const r = sow();
    for (const [key, norm] of [[STORE_KEYS.apps, core.normalizeApp], [STORE_KEYS.facets, core.normalizeFacet], [STORE_KEYS.layouts, core.normalizeLayout], [STORE_KEYS.scenes, core.normalizeScene]] as const) {
      for (const item of JSON.parse(r.data[key])) expect((norm as any)(item)).not.toBeNull();
    }
  });

  it("makes every facet fit the slot it is assigned to", () => {
    const r = sow();
    const facets = new Map(JSON.parse(r.data[STORE_KEYS.facets]).map((f: any) => [f.id, f]));
    const layouts = new Map(JSON.parse(r.data[STORE_KEYS.layouts]).map((l: any) => [l.id, l]));
    for (const scene of JSON.parse(r.data[STORE_KEYS.scenes])) {
      const layout: any = layouts.get(scene.layout);
      for (const [slotId, ref] of Object.entries(scene.assign) as Array<[string, string]>) {
        const facet: any = facets.get(ref);
        if (!facet) continue;
        const slot = layout.slots.find((s: any) => s.id === slotId);
        expect(core.facetFitsSlot(facet.slotClass, slot.class).match).toBe("exact");
      }
    }
  });

  it("carries the templates' settings through (audio owner, tap action, peek, intermission)", () => {
    const scenes = Object.fromEntries(JSON.parse(sow().data[STORE_KEYS.scenes]).map((s: any) => [s.id, s]));
    expect(scenes["demo-kitchen-command"].settings.hero.audio).toBe("exclusive");
    expect(scenes["demo-kitchen-command"].settings.hero.intermission).toEqual({ source: "pack:cosmos" });
    expect(scenes["demo-movie-night"].settings.screen.intermission).toEqual({ source: "pack:gallery" });
    expect(scenes["demo-sports-multiview"].settings.game3.tapAction).toBe("audio");
    expect(scenes["demo-sports-multiview"].settings.game3.preview).toEqual({ mode: "peek", interval: core.DEFAULT_PEEK_INTERVAL_SEC, playhead: "advance" });
    expect(scenes["demo-family-hub"].settings.timer.audio).toBe("mix");   // charter §2.4: the one mix role
  });
});

/* ------------------------------------------------------- §10: idempotence ---- */

describe("§10 - the seed never wipes and always undoes exactly itself", () => {
  it("seeded twice, leaves one household and an identical store", () => {
    const once = sow();
    const twice = applySeed(once.data, core, { now: "2026-12-25T00:00:00.000Z" });
    expect(twice.reseeded).toBe(true);
    expect(JSON.stringify(twice.data)).toBe(JSON.stringify(once.data));   // byte for byte, key order included
    expect(JSON.parse(twice.data[STORE_KEYS.scenes])).toHaveLength(5);
    expect(JSON.parse(twice.data[STORE_KEYS.apps])).toHaveLength(3);
  });

  it("seed -> reset leaves an empty store exactly as it was", () => {
    const before = {};
    const after = resetSeed(sow(before).data);
    expect(after.ok).toBe(true);
    expect(JSON.stringify(after.data)).toBe(JSON.stringify(before));
  });

  it("seed -> reset leaves a store WITH real entities exactly as it was", () => {
    const before: Record<string, string> = {
      "host.window": JSON.stringify({ w: 1920, h: 1080 }),
      [STORE_KEYS.apps]: JSON.stringify([{ id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", setup: { status: "signed-in" } }]),
      [STORE_KEYS.facets]: JSON.stringify([{ id: "hulu-home-16x9-XL", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "16:9·XL", label: "Home" }]),
      [STORE_KEYS.layouts]: JSON.stringify([{ id: "mine", name: "Mine", canvas: { aspect: "16:9", ratio: 16 / 9, resolution: "1080-class", orientation: "landscape" }, slots: [{ id: "a", rect: { x: 0, y: 0, w: 1, h: 1 }, class: "16:9·XL" }] }]),
      [STORE_KEYS.scenes]: JSON.stringify([{ id: "mine-scene", name: "Mine", layout: "mine", assign: { a: "hulu-home-16x9-XL" }, floating: [], hidden: [], schedule: null }]),
      [STORE_KEYS.activeScene]: "mine-scene",
      "tile:lasturl:m1-demo:hulu": "https://www.hulu.com/watch/abc",
    };
    const seeded = sow({ ...before });
    // the seed ADDED beside the real entities, never over them
    expect(JSON.parse(seeded.data[STORE_KEYS.apps]).map((a: any) => a.id)).toEqual(["hulu", "prism-chores", "prism-timer", "prism-agenda"]);
    expect(seeded.data[STORE_KEYS.activeScene]).toBe(DEMO_ACTIVE_SCENE);

    const after = resetSeed(seeded.data);
    expect(after.ok).toBe(true);
    expect(JSON.stringify(after.data)).toBe(JSON.stringify(before));
    expect(after.data[STORE_KEYS.activeScene]).toBe("mine-scene");        // the human's active scene came back
    expect(after.data["tile:lasturl:m1-demo:hulu"]).toBe(before["tile:lasturl:m1-demo:hulu"]);
  });

  it("refuses to reset a store it never seeded, and changes nothing", () => {
    const store = { "host.window": "{}", [STORE_KEYS.scenes]: "[]", "tiles:chores": "someone else's" };
    const snapshot = JSON.stringify(store);
    const r = resetSeed(store);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not seeded/);
    expect(r.data).toBeUndefined();
    expect(JSON.stringify(store)).toBe(snapshot);
  });

  it("refuses a receipt that is not ours", () => {
    expect(resetSeed({ [RECEIPT_KEY]: JSON.stringify({ schema: "something.else/v9", created: {} }) }).ok).toBe(false);
    expect(resetSeed({ [RECEIPT_KEY]: "not json at all" }).ok).toBe(false);
  });

  it("never removes an entity it did not create", () => {
    const before = { [STORE_KEYS.apps]: JSON.stringify([{ id: "prism-chores", name: "Chores (mine)", baseUrl: "https://tiles.prism/chores/", profileId: "prism-chores", setup: { status: "signed-in" } }]) };
    const seeded = sow({ ...before });
    expect(seeded.created.apps).toEqual(["prism-timer", "prism-agenda"]);  // prism-chores already existed
    expect(seeded.skipped.join(" ")).toMatch(/prism-chores/);
    const apps = JSON.parse(seeded.data[STORE_KEYS.apps]);
    expect(apps.find((a: any) => a.id === "prism-chores").name).toBe("Chores (mine)");  // untouched
    const after = resetSeed(seeded.data);
    expect(JSON.stringify(after.data)).toBe(JSON.stringify(before));
  });

  it("leaves a demo key a human edited after the seed, and says so", () => {
    const seeded = sow();
    seeded.data["tiles:chores"] = JSON.stringify({ mine: true });
    const after = resetSeed(seeded.data);
    expect(after.ok).toBe(true);
    expect(after.data["tiles:chores"]).toBe(JSON.stringify({ mine: true }));
    expect(after.notes.join(" ")).toMatch(/tiles:chores: edited since the seed/);
    expect(after.data[RECEIPT_KEY]).toBeUndefined();
  });

  it("removes only the seeded entities from a list a human added to since", () => {
    const seeded = sow();
    const scenes = JSON.parse(seeded.data[STORE_KEYS.scenes]);
    scenes.push({ id: "mine-after", name: "Mine", layout: "demo-movie-night-layout", assign: {}, floating: [], hidden: [], schedule: null });
    seeded.data[STORE_KEYS.scenes] = JSON.stringify(scenes);
    const after = resetSeed(seeded.data);
    expect(JSON.parse(after.data[STORE_KEYS.scenes]).map((s: any) => s.id)).toEqual(["mine-after"]);
    expect(after.notes.join(" ")).toMatch(/changed since the seed/);
  });

  it("leaves the active scene alone when it is no longer the demo's", () => {
    const seeded = sow();
    seeded.data[STORE_KEYS.activeScene] = "something-else";
    const after = resetSeed(seeded.data);
    expect(after.data[STORE_KEYS.activeScene]).toBe("something-else");
    expect(after.notes.join(" ")).toMatch(/no longer the demo scene/);
  });

  it("touches only its own keys - no profile, snapshot or session key is ever written", () => {
    const before = { "host.boot": "[]", "remote:tokens": "[]", "apps": "[]", "dashboard": "{}" };
    const seeded = sow({ ...before });
    const added = Object.keys(seeded.data).filter((k) => !(k in before));
    expect(added.sort()).toEqual([
      RECEIPT_KEY, "tiles:agenda", "demo:calendar", "tiles:chores", "demo:household",
      STORE_KEYS.activeScene, STORE_KEYS.apps, STORE_KEYS.facets, STORE_KEYS.layouts, STORE_KEYS.scenes,
    ].sort());
    for (const k of Object.keys(before)) expect(seeded.data[k]).toBe(before[k as keyof typeof before]);
  });

  it("can be seeded without touching the active scene at all", () => {
    const r = applySeed({ [STORE_KEYS.activeScene]: "mine" }, core, { now: NOW, activate: false });
    expect(r.data[STORE_KEYS.activeScene]).toBe("mine");
    expect(r.receipt.activeScene).toBeUndefined();
  });
});
