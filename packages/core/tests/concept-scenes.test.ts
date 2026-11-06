import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import { AudioFocusMachine } from "../src/audio-focus.js";
import { PeekScheduler, PREVIEW_BUDGETS } from "../src/preview.js";
import { SceneModelStore } from "../src/scene-model-store.js";
import { MIGRATED_ASSIGNMENT_SETTINGS } from "../src/scene-migration.js";
import { tapRoute, type SceneItemRef } from "../src/routes.js";
import {
  DEFAULT_ASSIGNMENT_SETTINGS,
  DEFAULT_PEEK_INTERVAL_SEC,
  FAMILY_HUB,
  KITCHEN_CLASSIC,
  KITCHEN_COMMAND,
  MOVIE_NIGHT,
  SCENE_TEMPLATES,
  SPORTS_MULTIVIEW,
  assignmentSettings,
  classifyRect,
  facetFitsSlot,
  formatSlotClass,
  instantiateTemplate,
  normalizeScene,
  sceneDocument,
  slotClassRatio,
  templateAudioOwner,
  templateCompletion,
  type App,
  type AssignmentSettings,
  type Facet,
  type Layout,
  type Scene,
  type SceneTemplate,
} from "../src/scene-model.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * CS-1 (docs/concept-scenes.md): the four concepts as repo data, the three
 * AssignmentSettings additions, §25 living previews reaching the scene model,
 * and §5 audio-follows-tap in core. Every assertion is on data the wizard
 * reads or on driver calls the shell executes — core decides (§23).
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FHD = { w: 1920, h: 1080 };
const PORTRAIT = { w: 1080, h: 1920 };

/** A 1080-class canvas of the aspect the template's blueprint was drawn for. */
function canvasOf(template: SceneTemplate): { w: number; h: number } {
  const ratio = slotClassRatio({ aspect: template.canvasAspect, tier: "XL" })!;
  return ratio >= 1 ? { w: 1920, h: Math.round(1920 / ratio) } : { w: Math.round(1920 * ratio), h: 1920 };
}

const CONCEPTS = [KITCHEN_COMMAND, SPORTS_MULTIVIEW, MOVIE_NIGHT, FAMILY_HUB];

// ------------------------------------------------------- §2 the templates

describe("concept scenes §2 — the four Scene Templates as repo data", () => {
  it("the wizard list leads with Kitchen Command and keeps Kitchen Classic (SM-5's golden path names it)", () => {
    expect(SCENE_TEMPLATES[0]).toBe(KITCHEN_COMMAND);
    expect(SCENE_TEMPLATES.map((t) => t.id)).toEqual([
      "kitchen-command", "sports-multiview", "movie-night", "family-hub",
      "music-lounge", "music-lounge-clock",     // CS-7 (§2.5), added after Family Hub
      "kitchen-classic",
    ]);
    expect(new Set(SCENE_TEMPLATES.map((t) => t.id)).size).toBe(SCENE_TEMPLATES.length);
  });

  it("every role's class is exactly what its blueprint rect derives on the template's own canvas", () => {
    for (const t of CONCEPTS) {
      const canvas = canvasOf(t);
      expect(t.slots.map((s) => s.role).sort(), t.id).toEqual(t.roles.map((r) => r.id).sort());
      for (const s of t.slots) {
        const role = t.roles.find((r) => r.id === s.role)!;
        expect(formatSlotClass(classifyRect(s.rect, canvas)), `${t.id}/${role.id}`).toBe(role.class);
      }
    }
  });

  it("roles name purposes and classes, never apps or facets", () => {
    for (const t of CONCEPTS) {
      expect(JSON.stringify(t), t.id).not.toMatch(/"(app|facet)":/);
      for (const r of t.roles) expect(typeof r.label === "string" && r.label.length > 0, `${t.id}/${r.id}`).toBe(true);
    }
    // tunedPreset names a catalog focusPresets id, never a selector (§1)
    for (const t of CONCEPTS) for (const r of t.roles) {
      if (r.tunedPreset) expect(r.tunedPreset, `${t.id}/${r.id}`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("audio: exactly one exclusive owner for Kitchen Command / Sports Multiview / Movie Night — and NULL for Family Hub", () => {
    expect(templateAudioOwner(KITCHEN_COMMAND)).toBe("hero");
    expect(templateAudioOwner(SPORTS_MULTIVIEW)).toBe("game1");
    expect(templateAudioOwner(MOVIE_NIGHT)).toBe("screen");
    // §2.4: Family Hub has no video hero, so it has NO exclusive role at all.
    // null is legal here — the timer is the one "mix" role (a countdown chime
    // that cannot be heard is not a timer), never the exclusive owner.
    expect(templateAudioOwner(FAMILY_HUB)).toBeNull();
    expect(FAMILY_HUB.roles.filter((r) => r.audio === "exclusive")).toEqual([]);
    expect(FAMILY_HUB.roles.find((r) => r.id === "timer")!.audio).toBe("mix");
    for (const t of CONCEPTS) expect(t.roles.filter((r) => r.audio === "exclusive").length, t.id).toBeLessThanOrEqual(1);
  });

  it("Sports Multiview asks for audio-follows-tap on every game and a peek on every game", () => {
    const games = SPORTS_MULTIVIEW.roles.filter((r) => r.kind === "video-hero");
    expect(games.map((r) => r.id)).toEqual(["game1", "game2", "game3"]);
    for (const r of games) {
      expect(r.settings.tapAction, r.id).toBe("audio");
      expect(r.settings.preview, r.id).toEqual({ mode: "peek", interval: DEFAULT_PEEK_INTERVAL_SEC, playhead: "advance" });
    }
    // the ticker is neither tapped for audio nor peeked
    const scores = SPORTS_MULTIVIEW.roles.find((r) => r.id === "scores")!;
    expect(scores.settings.tapAction).toBeUndefined();
    expect(scores.settings.preview).toBeUndefined();
  });

  it("Sports Multiview is hero-plus-two, and its classes are the ones the geometry derives (CS-10.2)", () => {
    // The 2x2 of four games is gone: four concurrent players exceeded §18's
    // concurrent-playing budget on every build but the mini PC (charter §2.2).
    expect(SPORTS_MULTIVIEW.roles.map((r) => r.id)).toEqual(["game1", "game2", "game3", "scores"]);
    expect(SPORTS_MULTIVIEW.roles.some((r) => r.id === "game4")).toBe(false);
    expect(SPORTS_MULTIVIEW.blurb).not.toMatch(/four games/i);

    // Why the classes are not 16:9 — a 16:9 slot on a 16:9 canvas needs EQUAL
    // w/h fractions, so a true-16:9 hero-plus-two-stacked tiling closes only
    // at 2/3 + 1/3, which forces a third of the wall to be ticker. The
    // blueprint stretches instead, and takes what classifyRect derives.
    expect(SPORTS_MULTIVIEW.roles.find((r) => r.id === "game1")!.class).toBe("4:3·XL");
    expect(SPORTS_MULTIVIEW.roles.find((r) => r.id === "game2")!.class).toBe("3:2·M");
    expect(SPORTS_MULTIVIEW.roles.find((r) => r.id === "game3")!.class).toBe("3:2·M");
    // the 2/3 alternative really is 16:9 — recorded so the trade-off stays legible
    expect(formatSlotClass(classifyRect({ x: 0, y: 0, w: 2 / 3, h: 2 / 3 }, FHD))).toBe("16:9·XL");
    expect(formatSlotClass(classifyRect({ x: 0, y: 2 / 3, w: 1, h: 1 / 3 }, FHD))).toBe("8:1-ticker·L");   // 33.3% of the canvas, just under the XL floor

    // A facet cut 16:9 for another template does NOT fit these slots: the
    // aspect bucket must match exactly (only the tier tolerates one step).
    // The wizard is still never empty — it cuts a new facet at the role class.
    expect(facetFitsSlot("16:9·XL", "4:3·XL").compatible).toBe(false);
    expect(facetFitsSlot("4:3·XL", "4:3·XL").match).toBe("exact");
    expect(facetFitsSlot("3:2·M", "3:2·M").match).toBe("exact");
  });

  it("the imagery packs the two hero concepts ask for reach the placement, not the App", () => {
    expect(KITCHEN_COMMAND.roles.find((r) => r.id === "hero")!.settings.intermission).toEqual({ source: "pack:cosmos" });
    expect(MOVIE_NIGHT.roles[0]!.settings.intermission).toEqual({ source: "pack:gallery" });
    expect(MOVIE_NIGHT.roles[0]!.settings).toMatchObject({ keepPresentation: true, onEnd: "none", tapAction: "promote" });
  });

  it("instantiateTemplate refuses while a role is unresolved, and otherwise produces the Layout + Scene with per-role settings", () => {
    const partial = instantiateTemplate(SPORTS_MULTIVIEW, FHD, { game1: "f1" }, { layoutId: "l", sceneId: "s" });
    expect(partial).toEqual({ error: "incomplete", unresolved: ["game2", "game3", "scores"] });
    expect(templateCompletion(SPORTS_MULTIVIEW, { game1: "f1" }).complete).toBe(false);

    const resolved = { game1: "f1", game2: "f2", game3: "f3", scores: "f5" };
    const full = instantiateTemplate(SPORTS_MULTIVIEW, FHD, resolved, { layoutId: "l", sceneId: "s" });
    if ("error" in full) throw new Error("expected an instance");
    expect(full.notes).toEqual([]);
    expect(full.layout.source).toEqual({ mode: "template", template: "sports-multiview" });
    expect(full.layout.slots.map((s) => `${s.id}:${s.class}`)).toEqual([
      "game1:4:3·XL", "game2:3:2·M", "game3:3:2·M", "scores:8:1-ticker·M",
    ]);
    expect(full.scene.assign).toEqual(resolved);
    expect(full.scene.settings!.game1).toEqual({
      keepPresentation: true, onEnd: "none", audio: "exclusive", touch: "full",
      tapAction: "audio", preview: { mode: "peek", interval: 30, playhead: "advance" },
    });
    expect(full.scene.settings!.game2).toMatchObject({ audio: "mute", tapAction: "audio" });
    expect(full.scene.settings!.scores).toEqual({ keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" });
  });

  it("Family Hub instantiates on a portrait canvas with the timer's mix policy intact", () => {
    const resolved = { photos: "p", agenda: "a", chores: "c", timer: "t", weather: "w", ticker: "n" };
    const r = instantiateTemplate(FAMILY_HUB, PORTRAIT, resolved, { layoutId: "l", sceneId: "s" });
    if ("error" in r) throw new Error("expected an instance");
    expect(r.notes).toEqual([]);
    expect(r.layout.canvas.orientation).toBe("portrait");
    expect(r.scene.settings!.timer).toMatchObject({ audio: "mix", touch: "full" });
    // no placement in Family Hub asks for a peek, a tap-for-audio or imagery
    expect(JSON.stringify(r.scene.settings)).not.toMatch(/preview|tapAction|intermission/);
  });

  it("Kitchen Classic is untouched — the minimal starter still classes and instantiates as it did", () => {
    expect(KITCHEN_CLASSIC.roles.map((r) => r.id)).toEqual(["hero", "calendar", "weather", "ticker"]);
    for (const s of KITCHEN_CLASSIC.slots) {
      const role = KITCHEN_CLASSIC.roles.find((r) => r.id === s.role)!;
      expect(formatSlotClass(classifyRect(s.rect, FHD)), role.id).toBe(role.class);
    }
    expect(JSON.stringify(KITCHEN_CLASSIC)).not.toMatch(/preview|tapAction|intermission/);
  });
});

// -------------------------------------------- §1 AssignmentSettings additions

const app: App = { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", setup: { status: "unknown" } };
const facet = (id: string, cls = "16:9·L"): Facet => ({ id, app: "hulu", url: `https://www.hulu.com/${id}`, slotClass: cls, label: id });
const layoutOf = (ids: readonly string[]): Layout => ({
  id: "grid", name: "grid", canvas: { aspect: "16:9", ratio: 16 / 9, resolution: "1080-class", orientation: "landscape" },
  slots: ids.map((id, i) => ({ id, rect: { x: (i % 2) * 0.5, y: Math.floor(i / 2) * 0.5, w: 0.5, h: 0.5 }, class: "16:9·L" })),
});

describe("concept scenes §1 — AssignmentSettings gains preview / tapAction / intermission", () => {
  it("the three additions default to ABSENT: an existing scene behaves exactly as it did", () => {
    expect(DEFAULT_ASSIGNMENT_SETTINGS).toEqual({ keepPresentation: false, onEnd: "none" });
    const scene: Scene = { id: "s", name: "s", layout: "grid", assign: { a: "f" }, floating: [], hidden: [], schedule: null };
    const s = assignmentSettings(scene, "a");
    expect(s.preview).toBeUndefined();
    expect(s.tapAction).toBeUndefined();
    expect(s.intermission).toBeUndefined();
  });

  it("round-trips through the untrusted normalizer and the store", async () => {
    const settings: AssignmentSettings = {
      keepPresentation: true, onEnd: "restart", audio: "exclusive", touch: "full",
      tapAction: "both", preview: { mode: "peek", interval: 45, playhead: "hold" }, intermission: { source: "pack:gallery" },
    };
    const scene = normalizeScene({ id: "s", name: "s", layout: "grid", assign: { a: "f1" }, settings: { a: settings } })!;
    expect(scene.settings!.a).toEqual(settings);

    const store = new Map<string, string>();
    const m = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) });
    await m.load();
    expect(m.saveApp(app).ok).toBe(true);
    expect(m.saveFacet(facet("f1")).ok).toBe(true);
    expect(m.saveLayout({ id: "grid", name: "grid", canvasSize: FHD, slots: [{ id: "a", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }] }).ok).toBe(true);
    expect(m.saveScene({ id: "s", name: "s", layout: "grid", assign: { a: "f1" }, settings: { a: settings } }).ok).toBe(true);

    const again = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: () => {} });
    await again.load();
    expect(again.scene("s")!.settings!.a).toEqual(settings);
  });

  it("migration never sets any of the three (scene-model spec §9)", () => {
    expect(MIGRATED_ASSIGNMENT_SETTINGS).toEqual({ keepPresentation: false, onEnd: "none" });
    expect(MIGRATED_ASSIGNMENT_SETTINGS.preview).toBeUndefined();
    expect(MIGRATED_ASSIGNMENT_SETTINGS.tapAction).toBeUndefined();
    expect(MIGRATED_ASSIGNMENT_SETTINGS.intermission).toBeUndefined();
  });

  it("garbage in ⇒ the field is simply absent — never a throw", () => {
    const junk = {
      id: "s", name: "s", layout: "grid", assign: { a: "f1" },
      settings: {
        a: {
          keepPresentation: "yes", onEnd: "explode",
          preview: "peek", tapAction: "shout", intermission: 7,
        },
        b: { preview: { mode: "off", interval: -1 }, tapAction: 3, intermission: { source: "   " } },
        c: { preview: { mode: "peek", interval: "soon", playhead: "sideways" } },
      },
    };
    const scene = normalizeScene(junk)!;
    expect(scene.settings!.a).toEqual({ keepPresentation: false, onEnd: "none" });
    expect(scene.settings!.b).toEqual({ keepPresentation: false, onEnd: "none" });
    // a well-formed peek with unusable numbers keeps the mode and falls back to the defaults
    expect(scene.settings!.c).toEqual({
      keepPresentation: false, onEnd: "none",
      preview: { mode: "peek", interval: DEFAULT_PEEK_INTERVAL_SEC, playhead: "advance" },
    });
    expect(() => normalizeScene({ layout: "grid", settings: { a: null, b: [], c: "x" } })).not.toThrow();
  });
});

// -------------------------------------------------- §4 §25 living previews

const previewScene = (): { scene: Scene; layout: Layout; facets: Facet[]; apps: App[] } => {
  const ids = ["game1", "game2", "game3", "game4"];
  const peek: AssignmentSettings = { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full", tapAction: "audio", preview: { mode: "peek", interval: 30, playhead: "advance" } };
  const settings: Record<string, AssignmentSettings> = {};
  for (const id of ids) settings[id] = { ...peek };
  settings["game1"] = { ...peek, keepPresentation: true, audio: "exclusive" };
  settings["scores"] = { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" };
  return {
    scene: { id: "sports", name: "Sports", layout: "grid", assign: Object.fromEntries([...ids, "scores"].map((id) => [id, `f-${id}`])), settings, floating: [], hidden: [], schedule: null },
    layout: layoutOf([...ids, "scores"]),
    facets: [...ids, "scores"].map((id) => facet(`f-${id}`)),
    apps: [app],
  };
};

const peekDoc = (): DashboardDocument => {
  const m = previewScene();
  return sceneDocument(m, "wall", FHD).doc;
};

describe("concept scenes §4 — §25 living previews reach the scene model", () => {
  it("sceneDocument carries AssignmentSettings.preview into the tile spec the orchestrator already understands", () => {
    const doc = peekDoc();
    expect(doc.tiles.find((t) => t.id === "game2")!.preview).toEqual({ mode: "peek", interval: 30, playhead: "advance" });
    // the peek set the orchestrator selects (url + preview.mode "peek") is the four games, never the ticker
    expect(doc.tiles.filter((t) => t.url && t.preview?.mode === "peek").map((t) => t.id)).toEqual(["game1", "game2", "game3", "game4"]);
    expect(doc.tiles.find((t) => t.id === "scores")!.preview).toBeUndefined();
  });

  it("a placement that asks for nothing produces no preview — the default stays off", () => {
    const m = previewScene();
    for (const id of Object.keys(m.scene.settings!)) delete m.scene.settings![id]!.preview;
    expect(sceneDocument(m, "wall", FHD).doc.tiles.every((t) => t.preview === undefined)).toBe(true);
  });

  it("playhead \"hold\" survives the trip to the tile", () => {
    const m = previewScene();
    m.scene.settings!["game2"] = { ...m.scene.settings!["game2"]!, preview: { mode: "peek", interval: 30, playhead: "hold" } };
    expect(sceneDocument(m, "wall", FHD).doc.tiles.find((t) => t.id === "game2")!.preview!.playhead).toBe("hold");
  });

  it("the scene's interval floors at the device budget (a 2GB box peeks at 60s, not the scene's 30s)", () => {
    const doc = peekDoc();
    const peeked: string[] = [];
    const sched = new PeekScheduler({
      isWarm: () => true, isPlaying: () => false,
      peek: async (id) => void peeked.push(id), abortPeek: () => {}, now: () => Date.now(),
    });
    sched.setBudget(PREVIEW_BUDGETS["tv-box-2gb"]!);
    const start = Date.now();
    sched.configure(doc.tiles.filter((t) => t.url && t.preview?.mode === "peek").map((t) => ({ id: t.id, intervalSec: t.preview!.interval!, playhead: "advance" as const })));
    // four tiles staggered across the FLOORED 60s cadence, not the requested 30s
    expect(sched.nextDue("game4")! - start).toBe(60_000);
    expect(sched.nextDue("game1")! - start).toBe(15_000);
    sched.stop();
  });

  it("an activated Scene actually schedules peeks: muted, one at a time, and never the playing slot", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setMaxLiveTiles(1);              // §18: everything but the live tile goes warm
    await orchestrator.load(peekDoc(), FHD);
    // game1 is the audio owner and is playing — a playing slot is never peeked
    await orchestrator.onSurfaceEvent({ type: "interaction", id: "game1" });
    await orchestrator.onSurfaceEvent({ type: "playback", id: "game1", playing: true });
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    const peeked = ops.filter((o) => o.op === "setMuted" && o.muted === true).map((o) => o.id as string);
    expect(peeked.length).toBeGreaterThan(0);
    expect(peeked).not.toContain("game1");
    expect(peeked).not.toContain("scores");
    // peak cost is one extra renderer: exactly one peek is in flight
    expect(orchestrator.getState()!.tiles.filter((t) => t.peeking).length).toBeLessThanOrEqual(1);
  });
});

// ------------------------------------------------- §5 audio-follows-tap

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const store = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {},
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: () => {},
      freeze: () => {},
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: () => {},
      resume: () => {},
      setMuted: (id, muted) => void ops.push({ op: "setMuted", id, muted }),
      setViewport: () => {},
      setChrome: () => {},
    },
    ui: { route: (route, source, id) => void ops.push({ op: "ui.route", route, source, id: id ?? null }) },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  return { ops, store, drivers, orchestrator: new Orchestrator(drivers) };
}

/** The wall Sports Multiview describes: four games, game1 the exclusive owner, all four tap-for-audio. */
async function wall() {
  const r = rig();
  await r.orchestrator.load(peekDoc(), FHD);
  // game1 is playing and audible (a human pressed play in it)
  await r.orchestrator.onSurfaceEvent({ type: "interaction", id: "game1" });
  await r.orchestrator.onSurfaceEvent({ type: "playback", id: "game1", playing: true });
  await r.orchestrator.onSurfaceEvent({ type: "interaction", id: "game2" });
  await r.orchestrator.onSurfaceEvent({ type: "playback", id: "game2", playing: true, ended: false });
  r.ops.length = 0;
  return r;
}

const muteOps = (ops: Array<Record<string, unknown>>) => ops.filter((o) => o.op === "setMuted").map((o) => `${o.id}:${o.muted ? "mute" : "unmute"}`);

describe("concept scenes §5 — audio-follows-tap (normative)", () => {
  it("the default is unchanged: a tap with no standing instruction promotes (§6a)", async () => {
    const { ops, orchestrator } = rig();
    const doc = peekDoc();
    for (const t of doc.tiles) delete t.tapAction;
    await orchestrator.load(doc, FHD);
    ops.length = 0;
    expect(orchestrator.tapActionOf("game2")).toBe("promote");
    const r = await orchestrator.tapItem("game2");
    expect(r).toMatchObject({ ok: true, action: "promote", did: "promote" });
    expect(r.audio).toBeUndefined();
    expect(ops.some((o) => o.op === "setZ" && o.id === "game2" && o.z === 40)).toBe(true);
    expect(muteOps(ops)).toEqual([]);                       // a promote never touches the audio
  });

  it("tapAction \"audio\": the sound moves exactly once — previous owner muted, tapped slot unmuted, nothing promoted", async () => {
    const { ops, orchestrator } = await wall();
    expect(orchestrator.tapActionOf("game3")).toBe("audio");
    const r = await orchestrator.tapItem("game3");
    expect(r).toEqual({ ok: true, action: "audio", did: "audio", audio: "moved" });
    expect(muteOps(ops)).toEqual(["game1:mute", "game3:unmute"]);   // mute first, one unmute, no double-unmute
    expect(ops.some((o) => o.op === "setZ")).toBe(false);           // the layout is untouched
    expect(ops.some((o) => o.op === "destroy")).toBe(false);        // the other games keep playing silently
  });

  it("tapping the current owner is a no-op — never a mute", async () => {
    const { ops, orchestrator } = await wall();
    const r = await orchestrator.tapItem("game1");
    expect(r).toEqual({ ok: true, action: "audio", did: "none", audio: "already-owner" });
    expect(muteOps(ops)).toEqual([]);
    // and again after the sound has moved: the new owner is now the no-op
    await orchestrator.tapItem("game4");
    ops.length = 0;
    expect((await orchestrator.tapItem("game4")).audio).toBe("already-owner");
    expect(muteOps(ops)).toEqual([]);
  });

  it("a scene with no exclusive owner yet grants ownership to the tapped slot", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(peekDoc(), FHD);   // boot is silent (§3 rule 5): nobody owns the audio
    ops.length = 0;
    const r = await orchestrator.tapItem("game2");
    expect(r).toMatchObject({ did: "audio", audio: "moved" });
    expect(muteOps(ops)).toEqual(["game2:unmute"]);   // nothing to mute — one unmute, nothing else
  });

  it("\"both\" promotes AND leaves the audio where the tap put it", async () => {
    const { ops, orchestrator } = rig();
    const doc = peekDoc();
    doc.tiles.find((t) => t.id === "game4")!.tapAction = "both";
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "interaction", id: "game1" });
    await orchestrator.onSurfaceEvent({ type: "playback", id: "game1", playing: true });
    ops.length = 0;
    const r = await orchestrator.tapItem("game4");
    expect(r).toMatchObject({ ok: true, action: "both", did: "audio+promote", audio: "moved" });
    expect(muteOps(ops)).toEqual(["game1:mute", "game4:unmute"]);
    expect(ops.some((o) => o.op === "setZ" && o.id === "game4" && o.z === 40)).toBe(true);
    // Back out of the promotion: the audio stays where the tap put it
    ops.length = 0;
    await orchestrator.tileCommand("game4", "normal");
    expect(muteOps(ops)).toEqual([]);
  });

  it("a slot mid-peek is never a tap target for the audio switch (§25 × §5)", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setMaxLiveTiles(1);
    await orchestrator.load(peekDoc(), FHD);
    await vi.advanceTimersByTimeAsync(60_000);
    const peeking = orchestrator.getState()!.tiles.find((t) => t.peeking)?.id;
    expect(peeking, "a peek should be in flight").toBeTruthy();
    ops.length = 0;
    const r = await orchestrator.tapItem(peeking!);
    expect(r).toMatchObject({ action: "audio", did: "none", audio: "peeking" });
    expect(muteOps(ops)).toEqual([]);
  });

  it("the §6 remote taps mean the same thing (parity, not a second path)", async () => {
    const r = await wall();
    const remote = new RemoteApi(r.orchestrator, r.drivers.store);
    const { token } = await remote.mintPairing("http://10.0.0.5:8471");
    const call = (path: string) => remote.handle({ method: "POST", path, body: null, token });
    expect(JSON.parse((await call("/items/game3/tap")).body)).toEqual({ ok: true, did: "audio", audio: "moved" });
    expect(muteOps(r.ops)).toEqual(["game1:mute", "game3:unmute"]);
    expect((await call("/items/nope/tap")).status).toBe(404);
  });

  it("tapRoute: an \"audio\" placement routes nowhere; \"both\" and the default still promote", () => {
    const item: SceneItemRef = { kind: "video-facet", scene: "sports", item: "game2", facet: "f-game2", app: "hulu" };
    expect(tapRoute(item)).toBe("prism://facet/f-game2/full");
    expect(tapRoute({ ...item, tapAction: "promote" })).toBe("prism://facet/f-game2/full");
    expect(tapRoute({ ...item, tapAction: "both" })).toBe("prism://facet/f-game2/full");
    expect(tapRoute({ ...item, tapAction: "audio" })).toBeNull();
  });
});

describe("AudioFocusMachine.takeAudioFocus (§3 exclusivity, reached by a tap)", () => {
  const machine = () => new AudioFocusMachine({ game1: "exclusive", game2: "mute", game3: "mute", calendar: "mute" });

  it("mutes the previous owner before unmuting the tapped tile, and only once each", () => {
    const m = machine();
    m.onPlayback("game1", true);
    m.onPlayback("game2", true, false);           // autoplaying silently
    expect(m.takeAudioFocus("game2")).toEqual([{ tile: "game1", op: "mute" }, { tile: "game2", op: "unmute" }]);
    // B-122: muting the owner gives the focus up; muting a bystander only mutes it
    expect(m.releaseAudioFocus("game1")).toEqual([{ tile: "game1", op: "mute" }]);
    expect(m.focusedMedia).toBe("game2");
    expect(m.releaseAudioFocus("game2")).toEqual([{ tile: "game2", op: "mute" }]);
    expect(m.focusedMedia).toBeNull();
  });

  it("the tap promotes the tile's policy, so its own next playback report cannot re-mute it", () => {
    const m = machine();
    m.onPlayback("game1", true);
    m.takeAudioFocus("game3");
    expect(m.policyOf("game3")).toBe("exclusive");
    // without the promotion this report would come back {game3, mute} (rule 3)
    // and the sound the household just asked for would die a second later
    const after = m.onPlayback("game3", true);
    expect(after).toContainEqual({ tile: "game3", op: "unmute" });
    expect(after.some((c) => c.tile === "game3" && c.op === "mute")).toBe(false);
  });

  it("is a no-op on the current owner and on a tile that is not on this wall", () => {
    const m = machine();
    m.onPlayback("game1", true);
    expect(m.takeAudioFocus("game1")).toEqual([]);
    expect(m.takeAudioFocus("nope")).toEqual([]);
    expect(m.focusedMedia).toBe("game1");
  });

  it("never pauses anything: the other games keep playing silently (the sports-bar wall)", () => {
    const m = machine();
    m.onPlayback("game1", true);
    expect(m.takeAudioFocus("game2").some((c) => c.op === "pause")).toBe(false);
    expect(m.isPlaying("game1")).toBe(true);
  });
});

// ------------------------------------------- onActivate (opt-in, default off)

describe("AssignmentSettings.onActivate", () => {
  it("is absent everywhere unless a placement asks for it - no shipped template starts playing on its own", () => {
    for (const t of SCENE_TEMPLATES)
      for (const r of [...t.roles, ...(t.hidden ?? [])])
        expect(r.settings.onActivate, `${t.id}/${r.id}`).toBeUndefined();
  });

  it("survives normalization only as the exact literal", () => {
    const keep = normalizeScene({ layout: "l", settings: { s: { onActivate: "play" } } })!;
    expect(keep.settings!.s!.onActivate).toBe("play");
    // anything else leaves it ABSENT: an unknown value can never make a wall play
    for (const junk of ["Play", "PLAY", "pause", "true", true, 1, {}, [], null]) {
      const n = normalizeScene({ layout: "l", settings: { s: { onActivate: junk } } })!;
      expect(n.settings!.s!.onActivate, JSON.stringify(junk)).toBeUndefined();
    }
  });

  it("reaches the tile spec so the runtime can act on it", () => {
    const scene: Scene = {
      id: "s", name: "S", layout: "grid", assign: { a: "f1" },
      settings: { a: { keepPresentation: false, onEnd: "none", onActivate: "play" } },
      floating: [], hidden: [], schedule: null,
    };
    const layout: Layout = {
      id: "grid", name: "grid", canvas: { aspect: "16:9", ratio: 16 / 9, resolution: "1080-class", orientation: "landscape" },
      slots: [{ id: "a", rect: { x: 0, y: 0, w: 1, h: 1 }, class: "16:9·XL" }],
    };
    const facet: Facet = { id: "f1", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·XL", label: "f1" };
    const app: App = { id: "spotify", name: "Spotify", baseUrl: "https://open.spotify.com/", profileId: "p" };
    const { doc } = sceneDocument({ scene, layout, facets: [facet], apps: [app] }, "wall", FHD);
    expect(doc.tiles.find((t) => t.id === "a")!.onActivate).toBe("play");

    // and a placement that does NOT ask for it carries nothing
    const plain = sceneDocument(
      { scene: { ...scene, settings: { a: { keepPresentation: false, onEnd: "none" } } }, layout, facets: [facet], apps: [app] },
      "wall", FHD,
    ).doc;
    expect(plain.tiles.find((t) => t.id === "a")!.onActivate).toBeUndefined();
  });


  it("a HIDDEN placement carries its settings too - onActivate on a music source reaches the tile", () => {
    // §32 keeps a music facet hidden, so the placement that most needs
    // onActivate has no slot to be keyed by. Hidden placements were built with
    // no settings at all, so nothing could be set on them.
    const scene: Scene = {
      id: "s", name: "S", layout: "grid", assign: {},
      settings: { f1: { keepPresentation: false, onEnd: "none", onActivate: "play" } },
      floating: [], hidden: [{ facet: "f1", audio: "exclusive" }], schedule: null,
    };
    const layout: Layout = {
      id: "grid", name: "grid", canvas: { aspect: "16:9", ratio: 16 / 9, resolution: "1080-class", orientation: "landscape" },
      slots: [],
    };
    const facet: Facet = { id: "f1", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·XL", label: "f1", music: true };
    const app: App = { id: "spotify", name: "Spotify", baseUrl: "https://open.spotify.com/", profileId: "p" };
    const { doc } = sceneDocument({ scene, layout, facets: [facet], apps: [app] }, "wall", FHD);
    const hidden = doc.tiles.find((t) => t.id === "f1")!;
    expect(hidden.onActivate).toBe("play");
    expect(hidden.float?.hidden).toBe(true);   // still hidden - onActivate does not surface it
    expect(hidden.audio).toBe("exclusive");
  });
});
