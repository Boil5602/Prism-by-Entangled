import { describe, expect, it } from "vitest";
import {
  ASPECT_BUCKETS,
  facetTile,
  CUSTOM_CLASS_NOTE,
  KITCHEN_CLASSIC,
  SCENE_TEMPLATES,
  archiveLayout,
  canvasClassMatches,
  canvasClassOf,
  classifyRect,
  classifySolvedLayout,
  denormalizeRect,
  duplicateFlag,
  facetFitsSlot,
  formatCanvasClass,
  formatSlotClass,
  instantiateTemplate,
  layoutDuplicates,
  layoutFromSolved,
  nearestAspectBucket,
  normalizeApp,
  normalizeFacet,
  normalizeLayout,
  normalizeRect,
  normalizeScene,
  orderFacetsForSlot,
  parseSlotClass,
  pickableLayouts,
  rectIoU,
  resolveAssignment,
  sceneDocument,
  sizeTier,
  slotClassesInLayouts,
  templateAudioOwner,
  templateCompletion,
  type App,
  type Facet,
  type Layout,
  type Scene,
} from "../src/scene-model.js";
import { layoutDashboard } from "../src/layout.js";
import { solveHero } from "../src/solver.js";

const FHD = { w: 1920, h: 1080 };

// ----------------------------------------------------------------- §2 App
describe("scene-model §2 App", () => {
  it("accepts the spec's JSON shape verbatim", () => {
    const app = normalizeApp({
      id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com",
      profileId: "hulu-family", catalogRef: "hulu", adapter: "hulu",
      setup: { status: "signed-in", lastVerified: "2026-08-30" },
    });
    expect(app).toEqual({
      id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/",
      profileId: "hulu-family", catalogRef: "hulu", adapter: "hulu",
      setup: { status: "signed-in", lastVerified: "2026-08-30" },
    });
  });
  it("refuses an app without an http(s) base URL, defaults the profile to the id", () => {
    expect(normalizeApp({ id: "x", baseUrl: "javascript:alert(1)" })).toBeNull();
    expect(normalizeApp({ id: "x", baseUrl: "https://x.example/" })?.profileId).toBe("x");
    expect(normalizeApp({ id: "x", baseUrl: "https://x.example/" })?.setup).toEqual({ status: "unknown" });
  });
});

// ------------------------------------------------- §3 slot classes
describe("scene-model §3 slot classes", () => {
  it("snaps a ratio to the nearest bucket in log space", () => {
    expect(nearestAspectBucket(16 / 9).bucket).toBe("16:9");
    expect(nearestAspectBucket(1.6).bucket).toBe("3:2");          // 16:10 laptop page
    expect(nearestAspectBucket(3.2).bucket).toBe("21:9-strip");   // 16:5 music control
    expect(nearestAspectBucket(12).bucket).toBe("8:1-ticker");
    expect(nearestAspectBucket(0.7).bucket).toBe("3:4");
    expect(nearestAspectBucket(0.55).bucket).toBe("9:16");
    expect(nearestAspectBucket(1.05).bucket).toBe("1:1");
    expect(ASPECT_BUCKETS.map((b) => b.id)).toEqual(["16:9", "4:3", "3:2", "1:1", "3:4", "9:16", "21:9-strip", "8:1-ticker"]);
  });
  it("tiers by share of canvas area: XL ≥35%, L 20–35%, M 8–20%, S <8% (B-10: the §8 default hero 0.62² = 38% is XL)", () => {
    expect(sizeTier(0.35)).toBe("XL");
    expect(sizeTier(0.62 * 0.62)).toBe("XL");
    expect(sizeTier(0.349)).toBe("L");
    expect(sizeTier(0.2)).toBe("L");
    expect(sizeTier(0.199)).toBe("M");
    expect(sizeTier(0.08)).toBe("M");
    expect(sizeTier(0.079)).toBe("S");
  });
  it("classes a normalized rect from its PIXEL aspect on the canvas", () => {
    // a 0.5×0.5 rect on a 16:9 canvas is 16:9 in pixels, not square
    expect(formatSlotClass(classifyRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, FHD))).toBe("16:9·L");   // 25% of the canvas: L
    expect(formatSlotClass(classifyRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, { w: 1080, h: 1920 }))).toBe("9:16·L");
    expect(formatSlotClass(classifyRect({ x: 0, y: 0.9, w: 1, h: 0.1 }, FHD))).toBe("8:1-ticker·M");
  });
  it("formats and parses class strings with the middle dot; custom classes parse as custom", () => {
    expect(formatSlotClass({ aspect: "16:9", tier: "XL" })).toBe("16:9·XL");
    expect(parseSlotClass("16:9·XL")).toEqual({ aspect: "16:9", tier: "XL" });
    expect(parseSlotClass("8:1-ticker·S")).toEqual({ aspect: "8:1-ticker", tier: "S" });
    expect(parseSlotClass("16:10·M")).toEqual({ aspect: "16:10", tier: "M", custom: true });
    expect(parseSlotClass("nonsense")).toBeNull();
    expect(parseSlotClass("16:9·XXL")).toBeNull();
    expect(CUSTOM_CLASS_NOTE).toBe("custom — limits facet reuse");
  });
  it("classes every slot of a solved hero layout", () => {
    const rects = solveHero([
      { id: "yt", hint: 16 / 9, weight: 1 },
      { id: "cal", hint: 3 / 4, weight: 0.6 },
      { id: "news", hint: 16 / 9, weight: 0.5 },
    ], "yt", 0.62, FHD.w, FHD.h);
    const slots = classifySolvedLayout(rects, FHD);
    expect(slots.map((s) => s.id)).toEqual(["yt", "cal", "news"]);
    const hero = slots.find((s) => s.id === "yt")!;
    expect(hero.rect).toEqual(normalizeRect(rects.yt!, FHD));
    expect(parseSlotClass(hero.class)?.aspect).toBe("16:9");
    for (const s of slots) expect(denormalizeRect(s.rect, FHD)).toEqual(rects[s.id]);
  });
});

// ----------------------------------------------- §3 canvas classes
describe("scene-model §3 canvas classes", () => {
  it("buckets aspect + resolution; portrait is the orientation", () => {
    expect(formatCanvasClass(canvasClassOf(1920, 1080))).toBe("16:9 @ 1080-class");
    expect(formatCanvasClass(canvasClassOf(3840, 2160))).toBe("16:9 @ 4K-class");
    expect(formatCanvasClass(canvasClassOf(2558, 1353))).toBe("16:9 @ 1440-class");
    expect(formatCanvasClass(canvasClassOf(1080, 1920))).toBe("9:16 portrait @ 1080-class");
    expect(formatCanvasClass(canvasClassOf(1920, 1200))).toBe("16:10 @ 1080-class");
  });
  it("matches within 2% aspect and the same resolution bucket", () => {
    expect(canvasClassMatches(canvasClassOf(1920, 1080), canvasClassOf(1366, 768))).toBe(true);
    expect(canvasClassMatches(canvasClassOf(1920, 1080), canvasClassOf(1920, 1200))).toBe(false);
    expect(canvasClassMatches(canvasClassOf(1920, 1080), canvasClassOf(3840, 2160))).toBe(false);
    expect(canvasClassMatches(canvasClassOf(1920, 1080), canvasClassOf(1900, 1080))).toBe(true); // 1.1% off
  });
});

// ------------------------------------------------- §4 compatibility
describe("scene-model §4 facet ↔ slot compatibility", () => {
  it("same bucket + same tier is exact; one step is compatible with a note; two steps never", () => {
    expect(facetFitsSlot("16:9·XL", "16:9·XL")).toEqual({ compatible: true, match: "exact" });
    expect(facetFitsSlot("16:9·L", "16:9·XL")).toEqual({ compatible: true, match: "one-step", note: "stretch" });
    expect(facetFitsSlot("16:9·XL", "16:9·L")).toEqual({ compatible: true, match: "one-step", note: "shrink" });
    expect(facetFitsSlot("16:9·S", "16:9·XL")).toEqual({ compatible: false, match: "none" });
    expect(facetFitsSlot("16:9·M", "16:9·XL")).toEqual({ compatible: false, match: "none" });
    expect(facetFitsSlot("4:3·M", "16:9·M")).toEqual({ compatible: false, match: "none" });
  });
  it("custom classes only match themselves", () => {
    expect(facetFitsSlot("16:10·M", "16:10·M").match).toBe("exact");
    expect(facetFitsSlot("16:10·M", "3:2·M").compatible).toBe(false);
  });
  it("orders a slot's picker: compatible only, exact first, one-step labeled, music facets never", () => {
    const facets: Facet[] = [
      { id: "a", app: "x", url: "https://x/", slotClass: "16:9·L", label: "a" },
      { id: "b", app: "x", url: "https://x/", slotClass: "16:9·XL", label: "b" },
      { id: "c", app: "x", url: "https://x/", slotClass: "3:4·M", label: "c" },
      { id: "d", app: "x", url: "https://x/", slotClass: "16:9·XL", label: "d", music: true },
      { id: "e", app: "x", url: "https://x/", slotClass: "16:9·S", label: "e" },
    ];
    const ordered = orderFacetsForSlot(facets, "16:9·XL");
    expect(ordered.map((o) => o.facet.id)).toEqual(["b", "a"]);
    expect(ordered[1]!.fit.note).toBe("stretch");
  });
  it("accepts the spec's facet JSON verbatim", () => {
    const facet = normalizeFacet({
      id: "hulu-livetv-16x9-XL", app: "hulu", url: "https://www.hulu.com/live", slotClass: "16:9·XL",
      focus: { selector: ".LiveGuide", pad: 8 }, zoom: 1.25, label: "Live TV guide",
    });
    expect(facet).toEqual({
      id: "hulu-livetv-16x9-XL", app: "hulu", url: "https://www.hulu.com/live", slotClass: "16:9·XL",
      focus: { selector: ".LiveGuide", pad: 8 }, zoom: 1.25, label: "Live TV guide",
    });
    expect(normalizeFacet({ id: "x", app: "x", url: "https://x/", slotClass: "16:9·XXL" })).toBeNull();
  });
});

// ------------------------------------------------- §3 layouts + dup detection
function twoSlot(id: string, name: string, heroW = 0.62, archived = false): Layout {
  const l = normalizeLayout({
    id, name, canvasSize: FHD,
    slots: [{ id: "hero", rect: { x: 0, y: 0, w: heroW, h: 1 } }, { id: "side", rect: { x: heroW, y: 0, w: 1 - heroW, h: 1 } }],
  })!;
  return archived ? archiveLayout(l) : l;
}

describe("scene-model §3 layouts", () => {
  it("normalizes a drawn layout, classing each slot; the canvas class comes with it", () => {
    const l = twoSlot("l1", "Two up");
    expect(formatCanvasClass(l.canvas)).toBe("16:9 @ 1080-class");
    expect(l.slots.map((s) => s.class)).toEqual(["1:1·XL", "3:4·XL"]);   // 0.62 of a 16:9 canvas ≈ 1.1, 0.38 ≈ 0.68; both ≥ 35% (B-10)
  });
  it("keeps a custom class as marked (tier re-derived), snaps everything else", () => {
    const l = normalizeLayout({ id: "c", name: "c", canvasSize: FHD, slots: [{ id: "a", rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, class: "16:10·S", custom: true }] })!;
    expect(l.slots[0]).toMatchObject({ class: "16:10·L", custom: true });
  });
  it("flags possible duplicates at IoU ≥ 0.85 (greedy distinct pairing); never blocks", () => {
    const a = twoSlot("a", "Kitchen two-up", 0.62);
    const b = twoSlot("b", "Nearly the same", 0.64);   // hero IoU 0.97, side IoU 0.95
    const c = twoSlot("c", "Different", 0.45);
    const dups = layoutDuplicates(b, [a, c]);
    expect(dups).toEqual([{ id: "a", name: "Kitchen two-up", archived: false }]);
    expect(duplicateFlag(dups)).toBe("possibly duplicates ⟨Kitchen two-up⟩");
    expect(duplicateFlag([])).toBeNull();
    expect(layoutDuplicates(c, [a, b])).toEqual([]);
  });
  it("ignores layouts of another canvas class and itself", () => {
    const a = twoSlot("a", "A");
    const portrait = normalizeLayout({ id: "p", name: "P", canvasSize: { w: 1080, h: 1920 }, slots: a.slots })!;
    expect(layoutDuplicates(a, [a, portrait])).toEqual([]);
  });
  it("IoU is scale-invariant", () => {
    const r1 = { x: 0, y: 0, w: 0.5, h: 0.5 }, r2 = { x: 0.1, y: 0, w: 0.5, h: 0.5 };
    expect(rectIoU(r1, r2)).toBeCloseTo(rectIoU(denormalizeRect(r1, FHD), denormalizeRect(r2, FHD)), 12);
  });
  it("archive hides from pickers, keeps the layout resolvable, and can be undone", () => {
    const a = twoSlot("a", "A"), b = twoSlot("b", "B", 0.5, true);
    expect(pickableLayouts([a, b]).map((l) => l.id)).toEqual(["a"]);
    expect(pickableLayouts([a, b], canvasClassOf(1080, 1920))).toEqual([]);
    expect(layoutDuplicates(twoSlot("d", "D", 0.5), [b])).toEqual([{ id: "b", name: "B", archived: true }]);
    expect(archiveLayout(b, false).archived).toBeUndefined();
  });
  it("lists the classes that exist in saved layouts with counts (archived excluded)", () => {
    const list = slotClassesInLayouts([twoSlot("a", "A"), twoSlot("b", "B", 0.63), twoSlot("c", "C", 0.5, true)]);
    expect(list).toEqual([{ class: "1:1·XL", layouts: 2, custom: false }, { class: "3:4·XL", layouts: 2, custom: false }]);   // 38% of the canvas: XL since B-10
  });
  it("builds a layout straight from solver output with provenance", () => {
    const rects = solveHero([{ id: "a", hint: 16 / 9, weight: 1 }, { id: "b", hint: 1, weight: 0.5 }], "a", 0.62, FHD.w, FHD.h);
    const l = layoutFromSolved("l", "L", rects, FHD, { mode: "hero", hero: "a", heroSize: 0.62, satellites: "auto" });
    expect(l.source).toEqual({ mode: "hero", hero: "a", heroSize: 0.62, satellites: "auto" });
    expect(l.slots).toHaveLength(2);
  });
});

// ------------------------------------------------- §5 scenes
describe("scene-model §5 scenes", () => {
  it("accepts the spec's scene JSON verbatim", () => {
    const scene = normalizeScene({
      id: "kitchen-evening", layout: "kitchen-3slot",
      assign: { hero: "hulu-livetv-16x9-XL", side1: "merge-week-3x4-M", side2: "radio-4x3-M" },
      floating: [{ facet: "cams-1x1-S", anchor: "top-right", size: 0.14 }],
      hidden: [{ facet: "spotify-controller", audio: "exclusive" }],
      schedule: null,
    });
    expect(scene).toEqual({
      id: "kitchen-evening", name: "Untitled scene", layout: "kitchen-3slot",
      assign: { hero: "hulu-livetv-16x9-XL", side1: "merge-week-3x4-M", side2: "radio-4x3-M" },
      floating: [{ facet: "cams-1x1-S", anchor: "top-right", size: 0.14 }],
      hidden: [{ facet: "spotify-controller", audio: "exclusive" }],
      schedule: null,
    });
  });
  it("carries per-assignment settings and visualizations; assignments resolve visualizations first", () => {
    const scene = normalizeScene({
      id: "s", name: "S", layout: "l",
      assign: { hero: "f1", side: "viz1" },
      settings: { hero: { keepPresentation: true, onEnd: "restart-fullscreen" } },
      visualizations: [{ id: "viz1", source: "spotify-hidden", style: "prism-beams", artwork: "backdrop" }],
    })!;
    expect(scene.settings).toEqual({ hero: { keepPresentation: true, onEnd: "restart-fullscreen" } });
    const facets: Facet[] = [{ id: "f1", app: "a", url: "https://a/", slotClass: "16:9·XL", label: "f1" }];
    expect(resolveAssignment(scene, "hero", facets)).toEqual({ kind: "facet", facet: facets[0] });
    expect(resolveAssignment(scene, "side", facets)).toEqual({ kind: "visualization", visualization: scene.visualizations![0] });
    expect(resolveAssignment(scene, "nope", facets)).toBeNull();
    expect(resolveAssignment({ ...scene, assign: { hero: "gone" } }, "hero", facets)).toEqual({ kind: "missing", ref: "gone" });
  });
  it("a visualization may opt into spilling past its tile; contained is the default and is not written", () => {
    const on = normalizeScene({ id: "s", name: "S", layout: "l", assign: { side: "viz1" }, visualizations: [{ id: "viz1", source: "m", style: "prism-beams", artwork: "backdrop", spill: true }] })!;
    const off = normalizeScene({ id: "s", name: "S", layout: "l", assign: { side: "viz1" }, visualizations: [{ id: "viz1", source: "m", style: "prism-beams", artwork: "backdrop" }] })!;
    expect(on.visualizations![0]!.spill).toBe(true);
    expect("spill" in off.visualizations![0]!).toBe(false);
    const layout = twoSlot("l", "L");
    const tileOn = sceneDocument({ scene: on, layout, facets: [], apps: [] }, "wall", FHD).doc.tiles.find((t) => t.id === "side")!;
    const tileOff = sceneDocument({ scene: off, layout, facets: [], apps: [] }, "wall", FHD).doc.tiles.find((t) => t.id === "side")!;
    expect(tileOn.visualization).toMatchObject({ style: "prism-beams", spill: true });
    expect("spill" in tileOff.visualization!).toBe(false);
  });
  it("materializes into a fixed-rect document the current renderer solves exactly", () => {
    const layout = twoSlot("l", "L");
    const apps: App[] = [{ id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", adapter: "hulu", setup: { status: "unknown" }, render: { intermission: { enabled: true }, veil: { mode: "veil-only" }, persist: true } }];
    const facets: Facet[] = [
      { id: "hulu-home", app: "hulu", url: "https://www.hulu.com/hub/home", slotClass: "1:1·XL", label: "Home", zoom: 1.25, focus: { selector: ".x", pad: 8 } },
      { id: "music", app: "hulu", url: "https://www.hulu.com/music", slotClass: "16:9·M", label: "Music", music: true },
    ];
    const scene: Scene = {
      id: "s", name: "Evening", layout: "l", assign: { hero: "hulu-home" }, settings: { hero: { keepPresentation: true, onEnd: "none", audio: "exclusive", touch: "full" } },
      floating: [{ facet: "hulu-home", anchor: "top-right", size: 0.2 }], hidden: [{ facet: "music", audio: "exclusive" }], schedule: null,
    };
    const { doc, notes } = sceneDocument({ scene, layout, facets, apps }, "wall", FHD);
    expect(notes).toEqual([]);
    expect(doc.layout).toEqual({ mode: "fixed", rects: { hero: layout.slots[0]!.rect, side: layout.slots[1]!.rect } });
    const hero = doc.tiles.find((t) => t.id === "hero")!;
    expect(hero).toMatchObject({ url: "https://www.hulu.com/hub/home", profile: "hulu", adapter: "hulu", zoom: 1.25, focus: { selector: ".x", pad: 8 }, audio: "exclusive", touch: "full", intermission: { enabled: true }, aspectHint: "1:1" });
    // section 26 ambient audio: a hidden placement's settings carry the soundscape; alone it rides the App's own intermission default
    const amb = facetTile("h", { id: "f", app: "pandora", url: "https://www.pandora.com/", slotClass: "16:9", region: null, zoom: 1 } as never, { id: "pandora", name: "Pandora", baseUrl: "https://www.pandora.com/", profileId: "pandora", setup: { status: "unknown" }, render: { intermission: { enabled: true } } } as never, { keepPresentation: false, onEnd: "none", audio: "exclusive", touch: "full", intermission: { ambient: "whales" } } as never);
    expect(amb.intermission).toMatchObject({ enabled: true, ambient: "whales" });
    // B-120: an App from the catalog (catalogRef, no adapter of its own) projects the catalog id as its adapter
    const fromCatalog: App = { id: "apple-music", name: "Apple Music", baseUrl: "https://music.apple.com/", profileId: "apple-music", catalogRef: "apple-music", setup: { status: "unknown" } };
    expect(facetTile("s", { id: "f", app: "apple-music", url: "https://music.apple.com/us/home", slotClass: "16:9", region: null, zoom: 1 } as never, fromCatalog, undefined).adapter).toBe("apple-music");
    expect(facetTile("s", { id: "f", app: "x", url: "https://x.example/", slotClass: "16:9", region: null, zoom: 1 } as never, { ...fromCatalog, id: "x", catalogRef: undefined, adapter: "custom" }, undefined).adapter).toBe("custom");
    expect(doc.tiles.find((t) => t.id === "side")).toMatchObject({ placeholder: true, aspectHint: "3:4" });
    const floating = doc.tiles.find((t) => t.kind === "floating" && !t.float?.hidden)!;
    expect(floating.float).toMatchObject({ x: 0.78, y: 0.02, w: 0.2 });   // anchored top-right, 2% margin
    expect(floating.float!.h).toBeCloseTo((0.2 * 1920) / 1 / 1080, 6);      // 1:1 content: h follows the aspect
    const hidden = doc.tiles.find((t) => t.float?.hidden)!;
    expect(hidden).toMatchObject({ kind: "floating", audio: "exclusive", url: "https://www.hulu.com/music" });
    const rects = layoutDashboard(doc, FHD);
    expect(rects.hero).toEqual(denormalizeRect(layout.slots[0]!.rect, FHD));
    expect(rects.side).toEqual(denormalizeRect(layout.slots[1]!.rect, FHD));
    expect(Object.keys(rects)).toEqual(["hero", "side"]);                   // floating/hidden never occupy a slot
  });
});

// ------------------------------------------------- §31 scene templates
describe("scene-model §31 scene templates", () => {
  it("Kitchen Classic names roles and classes, never apps", () => {
    const t = KITCHEN_CLASSIC;
    expect(SCENE_TEMPLATES).toContain(t);
    expect(t.roles.map((r) => `${r.id}:${r.class}`)).toEqual(["hero:16:9·XL", "calendar:3:4·M", "weather:4:3·M", "ticker:8:1-ticker·M"]);
    expect(t.roles.find((r) => r.id === "hero")!.suggestions).toEqual(["netflix", "hulu", "youtube", "twitch"]);
    expect(JSON.stringify(t)).not.toMatch(/"(app|facet)":/);
    expect(t.slots.map((s) => s.role).sort()).toEqual(t.roles.map((r) => r.id).sort());
  });
  it("the blueprint's rects derive exactly the roles' classes on a 16:9 canvas", () => {
    for (const s of KITCHEN_CLASSIC.slots) {
      const role = KITCHEN_CLASSIC.roles.find((r) => r.id === s.role)!;
      expect(formatSlotClass(classifyRect(s.rect, FHD)), role.id).toBe(role.class);
      expect(formatSlotClass(classifyRect(s.rect, { w: 3840, h: 2160 })), role.id).toBe(role.class);
    }
  });
  it("audio defaults: exactly one exclusive owner (the hero); utilities mute + scroll; hero keeps presentation", () => {
    expect(templateAudioOwner(KITCHEN_CLASSIC)).toBe("hero");
    for (const r of KITCHEN_CLASSIC.roles) {
      if (r.id === "hero") { expect(r.settings.keepPresentation).toBe(true); expect(r.audio).toBe("exclusive"); continue; }
      expect(r.audio).toBe("mute");
      expect(r.touch).toBe("scroll");
      expect(r.settings.keepPresentation).toBe(false);
    }
  });
  it("is instantiable only when every role is resolved", () => {
    expect(templateCompletion(KITCHEN_CLASSIC, { hero: "f" })).toEqual({ complete: false, unresolved: ["calendar", "weather", "ticker"] });
    const partial = instantiateTemplate(KITCHEN_CLASSIC, FHD, { hero: "f" }, { layoutId: "l", sceneId: "s" });
    expect(partial).toEqual({ error: "incomplete", unresolved: ["calendar", "weather", "ticker"] });
    const full = instantiateTemplate(KITCHEN_CLASSIC, FHD, { hero: "f1", calendar: "f2", weather: "f3", ticker: "f4" }, { layoutId: "l", sceneId: "s" });
    if ("error" in full) throw new Error("expected an instance");
    expect(full.notes).toEqual([]);
    expect(full.layout.slots.map((s) => `${s.id}:${s.class}`)).toEqual(["hero:16:9·XL", "ticker:8:1-ticker·M", "weather:4:3·M", "calendar:3:4·M"]);
    expect(full.layout.source).toEqual({ mode: "template", template: "kitchen-classic" });
    expect(full.scene.assign).toEqual({ hero: "f1", calendar: "f2", weather: "f3", ticker: "f4" });
    expect(full.scene.settings!.hero).toMatchObject({ keepPresentation: true, audio: "exclusive" });
    expect(full.scene.settings!.ticker).toMatchObject({ audio: "mute", touch: "scroll" });
  });
  it("notes class drift on a canvas the blueprint was not drawn for", () => {
    const r = instantiateTemplate(KITCHEN_CLASSIC, { w: 1080, h: 1920 }, { hero: "a", calendar: "b", weather: "c", ticker: "d" }, { layoutId: "l", sceneId: "s" });
    if ("error" in r) throw new Error("expected an instance");
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
