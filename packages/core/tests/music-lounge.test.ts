import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SceneModelStore } from "../src/scene-model-store.js";
import { facetPresetsFor, presetFacet, tunedPresetFor, type CatalogEntryWithFacets } from "../src/adapters-facets.js";
import {
  FAMILY_HUB,
  KITCHEN_CLASSIC,
  KITCHEN_COMMAND,
  MOVIE_NIGHT,
  MUSIC_LOUNGE,
  MUSIC_LOUNGE_CLOCK,
  SCENE_TEMPLATES,
  SPORTS_MULTIVIEW,
  classifyRect,
  formatSlotClass,
  instantiateTemplate,
  normalizeScene,
  normalizeSceneTemplate,
  normalizeTemplateRole,
  normalizeTemplateVisualization,
  orderFacetsForSlot,
  resolveAssignment,
  sceneDocument,
  templateAudioOwner,
  templateCompletion,
  templateVisualizationId,
  type App,
  type Facet,
  type SceneTemplate,
} from "../src/scene-model.js";

/**
 * CS-7 (docs/concept-scenes.md §2.5 + §7a): the Music Lounge templates and
 * the additive schema they needed — hidden roles and visualization roles. The
 * point of every assertion here is that ONE decision (which service) produces
 * the hidden facet, the visualization sourced to it, and the assignment — and
 * that the five templates that shipped before this are byte-for-byte what
 * they were.
 */

const FHD = { w: 1920, h: 1080 };
const LOUNGES = [MUSIC_LOUNGE, MUSIC_LOUNGE_CLOCK];

// ------------------------------------------------------ §2.5.1 the templates

describe("Music Lounge §2.5.1 — the template as repo data", () => {
  it("both variants sit in the wizard list after Family Hub and before Kitchen Classic", () => {
    const ids = SCENE_TEMPLATES.map((t) => t.id);
    expect(ids.indexOf("music-lounge")).toBe(ids.indexOf("family-hub") + 1);
    expect(ids.indexOf("music-lounge-clock")).toBe(ids.indexOf("music-lounge") + 1);
    expect(ids.indexOf("kitchen-classic")).toBe(ids.indexOf("music-lounge-clock") + 1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every SLOT role's class is exactly what its blueprint rect derives on a 16:9 canvas", () => {
    for (const t of LOUNGES) {
      expect(t.canvasAspect, t.id).toBe("16:9");
      expect(t.slots.map((s) => s.role).sort(), t.id).toEqual(t.roles.map((r) => r.id).sort());
      for (const s of t.slots) {
        const role = t.roles.find((r) => r.id === s.role)!;
        expect(formatSlotClass(classifyRect(s.rect, FHD)), `${t.id}/${role.id}`).toBe(role.class);
      }
    }
    // the corner clock is square ON THE CANVAS: 0.14 x 0.25 of 16:9 is 1:1, not 0.14 x 0.14
    expect(MUSIC_LOUNGE_CLOCK.slots.find((s) => s.role === "clock")!.rect).toEqual({ x: 0.83, y: 0.04, w: 0.14, h: 0.25 });
    expect(formatSlotClass(classifyRect({ x: 0.83, y: 0.04, w: 0.14, h: 0.14 }, FHD))).toBe("16:9·S");
  });

  it("the stage is a visualization role: prism-beams, backdrop, sourced to the hidden role, tap = reveal", () => {
    for (const t of LOUNGES) {
      const stage = t.roles.find((r) => r.id === "stage")!;
      expect(stage.kind, t.id).toBe("visualization");
      expect(stage.class, t.id).toBe("16:9·XL");
      expect(stage.visualization, t.id).toEqual({ style: "prism-beams", artwork: "backdrop", source: "source" });
      expect(stage.suggestions, t.id).toEqual([]);        // a visualization is never an app choice
      expect(stage.audio, t.id).toBe("mute");
      expect(stage.settings.tapAction, t.id).toBe("promote");
      expect(t.slots.find((s) => s.role === "stage")!.rect, t.id).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    }
  });

  it("the source is a HIDDEN music role: the three POC-cleared services, exclusive audio, never a slot", () => {
    for (const t of LOUNGES) {
      expect(t.hidden!.map((r) => r.id), t.id).toEqual(["source"]);
      const source = t.hidden![0]!;
      expect(source.kind, t.id).toBe("music");
      expect(source.suggestions, t.id).toEqual(["spotify", "apple-music", "pandora"]);
      expect(source.audio, t.id).toBe("exclusive");
      expect(t.slots.some((s) => s.role === "source"), `${t.id}: a hidden role never gets a slot`).toBe(false);
      expect(t.roles.some((r) => r.id === "source"), `${t.id}: a hidden role is not a slot role`).toBe(false);
    }
    // §32: a music facet is hidden-only, so it is never offered for the stage slot either
    const music: Facet = { id: "spotify-home", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·XL", label: "Player", music: true };
    expect(orderFacetsForSlot([music], "16:9·XL")).toEqual([]);
  });

  it("the clock variant adds the corner role and nothing else; both share one hidden source", () => {
    expect(MUSIC_LOUNGE.roles.map((r) => r.id)).toEqual(["stage"]);
    expect(MUSIC_LOUNGE_CLOCK.roles.map((r) => r.id)).toEqual(["stage", "clock"]);
    const clock = MUSIC_LOUNGE_CLOCK.roles.find((r) => r.id === "clock")!;
    expect(clock.class).toBe("1:1·S");
    expect(clock.kind).toBe("utility");
    expect(clock.suggestions).toEqual(["prism-timer"]);
    expect(clock.tunedPreset).toBe("clock");
    expect(clock.audio).toBe("mute");
    expect(MUSIC_LOUNGE.hidden![0]).toBe(MUSIC_LOUNGE_CLOCK.hidden![0]);
  });

  it("roles name purposes and classes, never apps or facets", () => {
    for (const t of LOUNGES) {
      expect(JSON.stringify(t), t.id).not.toMatch(/"(app|facet)":/);
      for (const r of [...t.roles, ...(t.hidden ?? [])]) expect(r.label.length, `${t.id}/${r.id}`).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------- §7a completion & the audio owner

describe("§7a — completion counts hidden roles, the audio owner may be one", () => {
  it("the ONE question is the service: the stage is never asked about", () => {
    expect(templateCompletion(MUSIC_LOUNGE, {})).toEqual({ complete: false, unresolved: ["source"] });
    expect(templateCompletion(MUSIC_LOUNGE, { source: "spotify-player" })).toEqual({ complete: true, unresolved: [] });
    // and resolving the stage directly is neither needed nor harmful
    expect(templateCompletion(MUSIC_LOUNGE, { stage: "whatever" }).unresolved).toEqual(["source"]);
  });

  it("the clock variant is two questions, and the first-party one pre-resolves in the wizard (§1)", () => {
    expect(templateCompletion(MUSIC_LOUNGE_CLOCK, {}).unresolved).toEqual(["clock", "source"]);
    expect(templateCompletion(MUSIC_LOUNGE_CLOCK, { clock: "prism-timer-clock-1x1-s" }).unresolved).toEqual(["source"]);
    expect(templateCompletion(MUSIC_LOUNGE_CLOCK, { clock: "c", source: "s" }).complete).toBe(true);
  });

  it("templateAudioOwner returns the HIDDEN role — the exclusive owner is not in a slot", () => {
    expect(templateAudioOwner(MUSIC_LOUNGE)).toBe("source");
    expect(templateAudioOwner(MUSIC_LOUNGE_CLOCK)).toBe("source");
    for (const t of LOUNGES) expect([...t.roles, ...(t.hidden ?? [])].filter((r) => r.audio === "exclusive").length, t.id).toBe(1);
  });

  it("a visualization role with nothing to source from is the one that reports itself", () => {
    // the hidden role gone: nothing declares "source", so the stage is the open question
    const orphan: SceneTemplate = { ...MUSIC_LOUNGE, hidden: [] };
    expect(templateCompletion(orphan, {}).unresolved).toEqual(["stage"]);
    // a caller that resolves the named id anyway is taken at its word
    expect(templateCompletion(orphan, { source: "s" }).complete).toBe(true);
    // and a visualization role whose block was dropped can never complete
    const blockless: SceneTemplate = { ...MUSIC_LOUNGE, roles: [{ ...MUSIC_LOUNGE.roles[0]!, visualization: undefined }] };
    expect(templateCompletion(blockless, { source: "s" }).unresolved).toEqual(["stage"]);
    expect(instantiateTemplate(blockless, FHD, { source: "s" }, { layoutId: "l", sceneId: "s" })).toEqual({ error: "incomplete", unresolved: ["stage"] });
  });
});

// ------------------------------------------------------- §7a instantiation

const spotify: App = { id: "spotify", name: "Spotify", baseUrl: "https://open.spotify.com/", profileId: "spotify", setup: { status: "signed-in" } };
const player: Facet = { id: "spotify-player", app: "spotify", url: "https://open.spotify.com/", slotClass: "16:9·XL", label: "Player", music: true, audio: "exclusive", touch: "full" };
const clockFacet: Facet = { id: "prism-timer-clock-1x1-s", app: "prism-timer", url: "https://tiles.prism/timer/", slotClass: "1:1·S", label: "Clock face" };

describe("§7a — instantiateTemplate writes hidden[], visualizations[] and the assignment together", () => {
  it("one resolution produces the hidden placement, the visualization and assign.stage", () => {
    const r = instantiateTemplate(MUSIC_LOUNGE, FHD, { source: "spotify-player" }, { layoutId: "l", sceneId: "s" });
    if ("error" in r) throw new Error("expected an instance");
    expect(r.notes).toEqual([]);
    expect(r.layout.source).toEqual({ mode: "template", template: "music-lounge" });
    expect(r.layout.slots.map((s) => `${s.id}:${s.class}`)).toEqual(["stage:16:9·XL"]);
    expect(r.scene.hidden).toEqual([{ facet: "spotify-player", audio: "exclusive" }]);
    expect(r.scene.visualizations).toEqual([
      { id: "viz-stage", source: "spotify-player", style: "prism-beams", artwork: "backdrop", label: "The stage" },
    ]);
    expect(r.scene.assign).toEqual({ stage: "viz-stage" });
    expect(templateVisualizationId("stage")).toBe("viz-stage");
    // slot-side settings for the viz role come from the role, exactly as for a facet role
    expect(r.scene.settings!.stage).toEqual({ keepPresentation: false, onEnd: "none", audio: "mute", touch: "full", tapAction: "promote" });
    expect(r.scene.floating).toEqual([]);
  });

  it("the assignment resolves to the visualization, not to a missing facet", () => {
    const r = instantiateTemplate(MUSIC_LOUNGE, FHD, { source: "spotify-player" }, { layoutId: "l", sceneId: "s" });
    if ("error" in r) throw new Error("expected an instance");
    const a = resolveAssignment(r.scene, "stage", [player]);
    expect(a?.kind).toBe("visualization");
    expect(a).toMatchObject({ visualization: { source: "spotify-player", style: "prism-beams" } });
  });

  it("it refuses while the service is unresolved — and never invents a visualization", () => {
    expect(instantiateTemplate(MUSIC_LOUNGE, FHD, {}, { layoutId: "l", sceneId: "s" })).toEqual({ error: "incomplete", unresolved: ["source"] });
    expect(instantiateTemplate(MUSIC_LOUNGE_CLOCK, FHD, { source: "spotify-player" }, { layoutId: "l", sceneId: "s" }))
      .toEqual({ error: "incomplete", unresolved: ["clock"] });
  });

  it("the clock variant instantiates both slots, one hidden facet and one visualization", () => {
    const r = instantiateTemplate(MUSIC_LOUNGE_CLOCK, FHD, { source: "spotify-player", clock: clockFacet.id }, { layoutId: "l", sceneId: "s", name: "Lounge" });
    if ("error" in r) throw new Error("expected an instance");
    expect(r.notes).toEqual([]);
    expect(r.layout.name).toBe("Lounge");
    expect(r.layout.slots.map((s) => `${s.id}:${s.class}`)).toEqual(["stage:16:9·XL", "clock:1:1·S"]);
    expect(r.scene.assign).toEqual({ stage: "viz-stage", clock: clockFacet.id });
    expect(r.scene.hidden).toEqual([{ facet: "spotify-player", audio: "exclusive" }]);
    expect(r.scene.visualizations!.map((v) => v.id)).toEqual(["viz-stage"]);
    expect(r.scene.settings!.clock).toEqual({ keepPresentation: false, onEnd: "none", audio: "mute", touch: "full" });
  });

  it("the scene it produces materializes: a visualization tile fed by the hidden facet's own tile", () => {
    const r = instantiateTemplate(MUSIC_LOUNGE, FHD, { source: player.id }, { layoutId: "l", sceneId: "s" });
    if ("error" in r) throw new Error("expected an instance");
    const { doc, notes } = sceneDocument({ scene: r.scene, layout: r.layout, facets: [player], apps: [spotify] }, "wall", FHD);
    expect(notes).toEqual([]);
    const stage = doc.tiles.find((t) => t.id === "stage")!;
    expect(stage.visualization).toEqual({ style: "prism-beams", source: player.id, artwork: "backdrop" });
    expect(stage.audio).toBe("mute");
    const hiddenTile = doc.tiles.find((t) => t.id === player.id)!;
    expect(hiddenTile.float?.hidden).toBe(true);
    expect(hiddenTile.audio).toBe("exclusive");
    expect(hiddenTile.url).toBe(player.url);
    // the visualization's source names the hidden facet's tile: one surface, one sound
    expect(stage.visualization!.source).toBe(hiddenTile.id);
  });

  it("through the store: the scene round-trips with its hidden facet and visualization intact", async () => {
    const store = new Map<string, string>();
    const m = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) });
    await m.load();
    expect(m.saveApp(spotify).ok).toBe(true);
    expect(m.saveFacet(player).ok).toBe(true);
    const r = m.instantiateTemplate("music-lounge", FHD, { source: player.id }, "Lounge");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected an instance");
    expect(r.warnings).toEqual([]);
    const again = new SceneModelStore({ get: (k) => store.get(k) ?? null, set: () => {} });
    await again.load();
    const scene = again.scene(r.value.scene.id)!;
    expect(scene.hidden).toEqual([{ facet: player.id, audio: "exclusive" }]);
    expect(scene.visualizations).toEqual([{ id: "viz-stage", source: player.id, style: "prism-beams", artwork: "backdrop", label: "The stage" }]);
    expect(scene.assign.stage).toBe("viz-stage");
  });
});

// ------------------------------------------------------ §7a the normalizers

describe("§7a — the untrusted normalizers drop a malformed visualization block, never throw", () => {
  it("a good block survives; a bad one is simply absent", () => {
    expect(normalizeTemplateVisualization({ style: "prism-beams", artwork: "backdrop", source: "source" }))
      .toEqual({ style: "prism-beams", artwork: "backdrop", source: "source" });
    for (const junk of [
      null, 7, "prism-beams", [],
      { style: "prism-beams", artwork: "backdrop" },              // no source
      { style: "beams-of-doom", artwork: "backdrop", source: "s" }, // not a shipped style
      { style: "prism-beams", artwork: "sideways", source: "s" },   // not an artwork mode
      { style: "prism-beams", artwork: "backdrop", source: "  " },  // blank source
    ]) expect(normalizeTemplateVisualization(junk), JSON.stringify(junk)).toBeUndefined();
  });

  it("the role keeps its kind when the block is dropped — a broken blueprint stays uninstantiable", () => {
    const role = normalizeTemplateRole({ id: "stage", label: "The stage", class: "16:9·XL", kind: "visualization", visualization: { style: "nope" } })!;
    expect(role.kind).toBe("visualization");
    expect(role.visualization).toBeUndefined();
    expect(role.suggestions).toEqual([]);
    expect(role.settings).toEqual({ keepPresentation: false, onEnd: "none" });
    expect(normalizeTemplateRole({ id: "x" })).toBeNull();                    // no class
    expect(normalizeTemplateRole({ class: "16:9·XL" })).toBeNull();           // no id
    expect(normalizeTemplateRole({ id: "x", class: "not a class" })).toBeNull();
    expect(() => normalizeTemplateRole(null)).not.toThrow();
  });

  it("a whole template normalizes: garbage roles, slots and hidden entries are dropped", () => {
    const t = normalizeSceneTemplate({
      id: "junk", roles: [
        null, { id: "stage", class: "16:9·XL", kind: "visualization", visualization: { style: "prism-beams", artwork: "focal", source: "source" } },
        { id: "nope" },
      ],
      slots: [{ role: "stage", rect: { x: 0, y: 0, w: 1, h: 1 } }, { role: "ghost", rect: { x: 0, y: 0, w: 1, h: 1 } }, { role: "stage", rect: "big" }],
      hidden: [{ id: "source", class: "16:9·XL", kind: "music", audio: "exclusive" }, "nonsense"],
    })!;
    expect(t.roles.map((r) => r.id)).toEqual(["stage"]);
    expect(t.slots.map((s) => s.role)).toEqual(["stage"]);
    expect(t.hidden!.map((r) => r.id)).toEqual(["source"]);
    expect(templateAudioOwner(t)).toBe("source");
    expect(templateCompletion(t, { source: "f" }).complete).toBe(true);
    expect(normalizeSceneTemplate({ id: "x", roles: [] })).toBeNull();
    expect(normalizeSceneTemplate("template")).toBeNull();
    expect(() => normalizeSceneTemplate({ roles: "none", slots: 3, hidden: 4 })).not.toThrow();
  });

  it("every shipped template survives its own normalizer unchanged in the parts §7a added", () => {
    for (const t of SCENE_TEMPLATES) {
      const n = normalizeSceneTemplate(JSON.parse(JSON.stringify(t)))!;
      expect(n, t.id).toBeTruthy();
      expect(n.roles.map((r) => `${r.id}:${r.kind}:${r.class}`), t.id).toEqual(t.roles.map((r) => `${r.id}:${r.kind}:${r.class}`));
      expect(n.hidden?.map((r) => r.id), t.id).toEqual(t.hidden?.map((r) => r.id));
      expect(n.roles.map((r) => r.visualization), t.id).toEqual(t.roles.map((r) => r.visualization));
      expect(templateAudioOwner(n), t.id).toBe(templateAudioOwner(t));
    }
  });

  it("a stored scene keeps a hidden music facet and its visualization (the §5 shape, unchanged)", () => {
    const scene = normalizeScene({
      id: "s", name: "Lounge", layout: "l", assign: { stage: "viz-stage" },
      hidden: [{ facet: "spotify-player", audio: "exclusive" }],
      visualizations: [{ id: "viz-stage", source: "spotify-player", style: "prism-beams", artwork: "backdrop" }, { id: "", source: "x" }],
    })!;
    expect(scene.hidden).toEqual([{ facet: "spotify-player", audio: "exclusive" }]);
    expect(scene.visualizations!.map((v) => v.id)).toEqual(["viz-stage"]);
  });
});

// ------------------------------------------------- the five that came before

describe("§7a is additive — the five templates that shipped before it are unchanged", () => {
  const BEFORE = [KITCHEN_COMMAND, SPORTS_MULTIVIEW, MOVIE_NIGHT, FAMILY_HUB, KITCHEN_CLASSIC];

  it("none of them grew a hidden role or a visualization role", () => {
    for (const t of BEFORE) {
      expect(t.hidden, t.id).toBeUndefined();
      expect(t.roles.some((r) => r.kind === "visualization"), t.id).toBe(false);
      expect(t.roles.some((r) => r.visualization), t.id).toBe(false);
      expect(JSON.stringify(t), t.id).not.toMatch(/visualization|hidden/);
    }
  });

  it("their completion, audio owner and instantiation are exactly what they were", () => {
    expect(templateAudioOwner(KITCHEN_COMMAND)).toBe("hero");
    expect(templateAudioOwner(SPORTS_MULTIVIEW)).toBe("game1");
    expect(templateAudioOwner(MOVIE_NIGHT)).toBe("screen");
    expect(templateAudioOwner(FAMILY_HUB)).toBeNull();
    expect(templateAudioOwner(KITCHEN_CLASSIC)).toBe("hero");
    for (const t of BEFORE) {
      expect(templateCompletion(t, {}).unresolved, t.id).toEqual(t.roles.map((r) => r.id));
      const resolved = Object.fromEntries(t.roles.map((r) => [r.id, `f-${r.id}`]));
      expect(templateCompletion(t, resolved), t.id).toEqual({ complete: true, unresolved: [] });
      const r = instantiateTemplate(t, t.canvasAspect === "9:16" ? { w: 1080, h: 1920 } : FHD, resolved, { layoutId: "l", sceneId: "s" });
      if ("error" in r) throw new Error(`${t.id}: expected an instance`);
      expect(r.scene.assign, t.id).toEqual(resolved);
      expect(r.scene.hidden, t.id).toEqual([]);                 // still no hidden placements
      expect(r.scene.visualizations, t.id).toBeUndefined();     // and no visualizations key at all
    }
  });
});

// ------------------------------------------------------------ catalog data

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "../../../prism-adapters/catalog");
const adaptersDir = join(here, "../../../prism-adapters/adapters");
const read = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

describe("§2.5.1 catalog data — the roles' suggestions and presets exist", () => {
  it("the clock role's tuned preset is a real prism-timer preset for 1:1·S", () => {
    const timer = read<CatalogEntryWithFacets>(join(catalogDir, "prism-timer.json"));
    const role = MUSIC_LOUNGE_CLOCK.roles.find((r) => r.id === "clock")!;
    const preset = tunedPresetFor(timer, role.class, role.tunedPreset!);
    expect(preset, `prism-timer has no ${role.tunedPreset} for ${role.class}`).not.toBeNull();
    expect(facetPresetsFor(timer, role.class).some((p) => p.id === role.tunedPreset), "a tuned (class) preset, not just the plain one").toBe(true);
    const selectors = read<{ selectors: Record<string, string> }>(join(adaptersDir, "prism-tiles.json")).selectors;
    const facet = presetFacet(timer, preset!, { id: "prism-timer" }, role.class, selectors);
    expect(facet.focus, "the preset resolves to a real selector").toBeTruthy();
    expect(facet.slotClass).toBe("1:1·S");
    // §1: one first-party suggestion with no account, so the wizard pre-fills it
    expect(timer.account).toBe("none");
  });

  it("the source role's three suggestions are catalog entries the Widevine-audio POC cleared for the tile", () => {
    for (const id of MUSIC_LOUNGE.hidden![0]!.suggestions) {
      const entry = read<CatalogEntryWithFacets & { drm?: { evidence?: string } }>(join(catalogDir, `${id}.json`));
      expect(entry.id, id).toBe(id);
      expect(entry.audio, id).toBe("exclusive");
      expect(entry.drm?.evidence, `${id}: the POC verdict is the catalog's evidence`).toMatch(/music-webview2-poc\.md/);
      expect(entry.account, `${id}: a music service is signed into, never pre-resolved`).not.toBe("none");
    }
  });
});
