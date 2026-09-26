/**
 * The scene model (docs/scene-model-spec.md §1–§5, dashboard-schema §31/§32).
 *
 * Vocabulary is canonical: App (identity + session) · Slot (a classed region
 * of a Layout) · Layout (slots for a canvas class) · Facet (one face of an
 * App, cut for a slot class) · Scene (Layout + facet assignments + floating /
 * hidden + visualizations) · Canvas class (aspect + resolution bucket) ·
 * Visualization (placeable audio-reactive surface fed by a hidden music
 * facet). "Frame" is the physical device only.
 *
 * Everything here is pure data + pure functions: classing, compatibility,
 * duplicate detection, template completion, and the materialization of a
 * Scene into the dashboard document the renderer already consumes (mode
 * "fixed": the layout's normalized rects scaled to the viewport). The old
 * model (tiles, master layouts, scenes v0) keeps working beside it until the
 * rename commit; nothing here rewrites those stores.
 */

import type { AudioPolicy, DashboardDocument, FloatSpec, FocusSpec, ScheduleEntry, TapAction, TileSpec, TouchMode, ViewportMode } from "./types.js";
import { SCHEMA_VERSION, parseAspectHint } from "./types.js";
import { validRegion } from "./focus.js";
import type { Rect, SolvedRects } from "./solver.js";

export const SCENE_MODEL_SCHEMA = "prism.scene-model/v0.1";

/* ------------------------------------------------------------ rects ---- */

/** A rect in canvas fractions (0–1); scaling to any canvas of the class is exact. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasSize {
  w: number;
  h: number;
}

export function normalizeRect(rect: Rect, canvas: CanvasSize): NormalizedRect {
  return { x: rect.x / canvas.w, y: rect.y / canvas.h, w: rect.w / canvas.w, h: rect.h / canvas.h };
}

export function denormalizeRect(rect: NormalizedRect, canvas: CanvasSize): Rect {
  return { x: rect.x * canvas.w, y: rect.y * canvas.h, w: rect.w * canvas.w, h: rect.h * canvas.h };
}

/** Intersection over union; scale-invariant, so normalized and pixel rects agree. */
export function rectIoU(a: NormalizedRect, b: NormalizedRect): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function validNormalizedRect(r: unknown): r is NormalizedRect {
  if (!r || typeof r !== "object") return false;
  const m = r as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return num(m.x) && num(m.y) && num(m.w) && num(m.h) && (m.w as number) > 0 && (m.h as number) > 0
    && (m.x as number) >= -1e-9 && (m.y as number) >= -1e-9 && (m.x as number) + (m.w as number) <= 1 + 1e-6 && (m.y as number) + (m.h as number) <= 1 + 1e-6;
}

/* ------------------------------------------------- slot classes (§3) ---- */

/** The standardized aspect buckets — facets are cut for these, so they stay reusable. */
export type AspectBucket = "16:9" | "4:3" | "3:2" | "1:1" | "3:4" | "9:16" | "21:9-strip" | "8:1-ticker";

export const ASPECT_BUCKETS: ReadonlyArray<{ id: AspectBucket; ratio: number; label: string }> = [
  { id: "16:9", ratio: 16 / 9, label: "Widescreen 16:9" },
  { id: "4:3", ratio: 4 / 3, label: "Classic 4:3" },
  { id: "3:2", ratio: 3 / 2, label: "Photo 3:2" },
  { id: "1:1", ratio: 1, label: "Square 1:1" },
  { id: "3:4", ratio: 3 / 4, label: "Portrait 3:4" },
  { id: "9:16", ratio: 9 / 16, label: "Vertical 9:16" },
  { id: "21:9-strip", ratio: 21 / 9, label: "Strip 21:9" },
  { id: "8:1-ticker", ratio: 8, label: "Ticker 8:1" },
];

export type SizeTier = "XL" | "L" | "M" | "S";

/** Ascending order; "within one step" is measured on this scale. */
export const SIZE_TIERS: readonly SizeTier[] = ["S", "M", "L", "XL"];

/** Share of canvas area at which each tier begins (S is everything below M). */
export const TIER_SHARE: Readonly<Record<Exclude<SizeTier, "S">, number>> = { XL: 0.35, L: 0.2, M: 0.08 };

/** A slot's class: aspect bucket (or a custom "W:H") × size tier. */
export interface SlotClass {
  aspect: AspectBucket | string;
  tier: SizeTier;
  /** The human overrode the snapped bucket; the class only ever matches itself. */
  custom?: boolean;
}

/** The note shown beside a custom class (spec §3). */
export const CUSTOM_CLASS_NOTE = "custom — limits facet reuse";

/** The separator in a class string: "16:9·XL" (U+00B7). */
export const CLASS_SEPARATOR = "·";

export function formatSlotClass(c: SlotClass): string {
  return `${c.aspect}${CLASS_SEPARATOR}${c.tier}`;
}

const TIER_SET = new Set<string>(SIZE_TIERS);

export function parseSlotClass(s: string): SlotClass | null {
  const idx = s.lastIndexOf(CLASS_SEPARATOR);
  if (idx <= 0) return null;
  const aspect = s.slice(0, idx).trim();
  const tier = s.slice(idx + 1).trim();
  if (!aspect || !TIER_SET.has(tier)) return null;
  const bucket = ASPECT_BUCKETS.find((b) => b.id === aspect);
  if (bucket) return { aspect: bucket.id, tier: tier as SizeTier };
  if (!parseAspectHint(aspect)) return null;
  return { aspect, tier: tier as SizeTier, custom: true };
}

/** The ratio a class's aspect stands for (a bucket's ratio, or the custom W:H). */
export function slotClassRatio(c: SlotClass | string): number | null {
  const parsed = typeof c === "string" ? parseSlotClass(c) : c;
  if (!parsed) return null;
  const bucket = ASPECT_BUCKETS.find((b) => b.id === parsed.aspect);
  return bucket ? bucket.ratio : parseAspectHint(parsed.aspect);
}

/** Nearest bucket in log-space (16:10 → 3:2, 16:5 → 21:9-strip); ties go to the first listed. */
export function nearestAspectBucket(ratio: number): { bucket: AspectBucket; deviation: number } {
  let best = ASPECT_BUCKETS[0]!;
  let bestDev = Infinity;
  for (const b of ASPECT_BUCKETS) {
    const dev = Math.abs(Math.log(ratio / b.ratio));
    if (dev < bestDev - 1e-12) { best = b; bestDev = dev; }
  }
  return { bucket: best.id, deviation: bestDev };
}

export function sizeTier(share: number): SizeTier {
  if (share >= TIER_SHARE.XL) return "XL";
  if (share >= TIER_SHARE.L) return "L";
  if (share >= TIER_SHARE.M) return "M";
  return "S";
}

/**
 * Class a slot from its normalized rect on a canvas: the pixel aspect snaps
 * to the nearest bucket, the area share picks the tier.
 */
export function classifyRect(rect: NormalizedRect, canvas: CanvasSize): SlotClass {
  const ratio = (rect.w * canvas.w) / (rect.h * canvas.h);
  return { aspect: nearestAspectBucket(ratio).bucket, tier: sizeTier(rect.w * rect.h) };
}

/** Class every slot of a solved layout (pixel rects at the canvas). */
export function classifySolvedLayout(rects: SolvedRects | Record<string, Rect>, canvas: CanvasSize): Slot[] {
  return Object.entries(rects).map(([id, r]) => {
    const rect = normalizeRect(r, canvas);
    return { id, rect, class: formatSlotClass(classifyRect(rect, canvas)) };
  });
}

/* ---------------------------------------------- canvas classes (§3) ---- */

export type ResolutionBucket = "1080-class" | "1440-class" | "4K-class";

/** A layout runs on any display matching aspect within this and the same resolution bucket. */
export const CANVAS_ASPECT_TOLERANCE = 0.02;

export interface CanvasClass {
  /** The nearest named aspect ("16:9", "9:16", "21:9", "4:3", "16:10", …) — a label, not the exact ratio. */
  aspect: string;
  /** Exact w/h of the canvas the class was made from. */
  ratio: number;
  resolution: ResolutionBucket;
  orientation: "landscape" | "portrait";
}

const CANVAS_ASPECT_LABELS: ReadonlyArray<{ label: string; ratio: number }> = [
  { label: "16:9", ratio: 16 / 9 }, { label: "16:10", ratio: 1.6 }, { label: "4:3", ratio: 4 / 3 }, { label: "3:2", ratio: 1.5 },
  { label: "21:9", ratio: 21 / 9 }, { label: "32:9", ratio: 32 / 9 }, { label: "1:1", ratio: 1 },
  { label: "9:16", ratio: 9 / 16 }, { label: "10:16", ratio: 0.625 }, { label: "3:4", ratio: 0.75 }, { label: "2:3", ratio: 2 / 3 }, { label: "9:21", ratio: 9 / 21 },
];

/** Long-axis logical pixels: < 2200 → 1080-class, < 3200 → 1440-class, else 4K-class. */
export function resolutionBucket(w: number, h: number): ResolutionBucket {
  const long = Math.max(w, h);
  if (long >= 3200) return "4K-class";
  if (long >= 2200) return "1440-class";
  return "1080-class";
}

export function canvasClassOf(w: number, h: number): CanvasClass {
  const ratio = w / h;
  let label = CANVAS_ASPECT_LABELS[0]!;
  let best = Infinity;
  for (const c of CANVAS_ASPECT_LABELS) {
    const dev = Math.abs(Math.log(ratio / c.ratio));
    if (dev < best) { best = dev; label = c; }
  }
  return { aspect: label.label, ratio, resolution: resolutionBucket(w, h), orientation: w >= h ? "landscape" : "portrait" };
}

/** "16:9 @ 1080-class" / "9:16 portrait @ 1080-class". */
export function formatCanvasClass(c: CanvasClass): string {
  return `${c.aspect}${c.orientation === "portrait" ? " portrait" : ""} @ ${c.resolution}`;
}

export function canvasClassMatches(a: CanvasClass, b: CanvasClass): boolean {
  return a.resolution === b.resolution && Math.abs(a.ratio / b.ratio - 1) <= CANVAS_ASPECT_TOLERANCE;
}

/* --------------------------------------------------- layouts (§3) ---- */

export interface Slot {
  id: string;
  rect: NormalizedRect;
  /** Formatted class ("16:9·XL"); custom classes carry `custom: true`. */
  class: string;
  custom?: boolean;
  label?: string;
}

/** Where a layout's rects came from, so the solver editor can reopen it; the rects stay the truth. */
export type LayoutProvenance =
  | { mode: "hero"; hero: string; heroSize: number; satellites: "auto" | string[] }
  | { mode: "grid"; cols: number; rows: number }
  | { mode: "template"; template: string }
  | { mode: "drawn" };

export interface Layout {
  id: string;
  name: string;
  canvas: CanvasClass;
  slots: Slot[];
  /** Hidden from pickers; scenes referencing it keep working. Never deleted. */
  archived?: boolean;
  source?: LayoutProvenance;
}

/** Build a Layout from solver output (pixel rects at the canvas). */
export function layoutFromSolved(
  id: string,
  name: string,
  rects: SolvedRects | Record<string, Rect>,
  canvas: CanvasSize,
  source?: LayoutProvenance,
): Layout {
  return { id, name, canvas: canvasClassOf(canvas.w, canvas.h), slots: classifySolvedLayout(rects, canvas), ...(source ? { source } : {}) };
}

/** Re-class a layout's slots after edits (a drawn slot snaps; custom classes are kept as marked). */
export function reclassLayout(layout: Layout, canvas?: CanvasSize): Layout {
  const size = canvas ?? { w: layout.canvas.ratio * 1000, h: 1000 };
  return {
    ...layout,
    slots: layout.slots.map((s) => {
      if (s.custom) {
        const parsed = parseSlotClass(s.class);
        const tier = sizeTier(s.rect.w * s.rect.h);
        return parsed ? { ...s, class: formatSlotClass({ ...parsed, tier }) } : { ...s, custom: false, class: formatSlotClass(classifyRect(s.rect, size)) };
      }
      return { ...s, class: formatSlotClass(classifyRect(s.rect, size)) };
    }),
  };
}

/** Layouts a picker offers: unarchived, this canvas class only when one is given. */
export function pickableLayouts(layouts: readonly Layout[], canvas?: CanvasClass): Layout[] {
  return layouts.filter((l) => !l.archived && (!canvas || canvasClassMatches(l.canvas, canvas)));
}

export function archiveLayout(layout: Layout, archived = true): Layout {
  const { archived: _was, ...rest } = layout;
  return archived ? { ...rest, archived: true } : rest;
}

export const LAYOUT_DUPLICATE_IOU = 0.85;

export interface LayoutDuplicate {
  id: string;
  name: string;
  archived: boolean;
}

/** Greedy distinct pairing: every draft slot finds an unused counterpart at IoU ≥ the threshold. */
function slotSetsMatch(a: readonly Slot[], b: readonly Slot[], threshold: number): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  for (const s of a) {
    let best = -1, bestIou = 0;
    b.forEach((t, i) => {
      if (used.has(i)) return;
      const v = rectIoU(s.rect, t.rect);
      if (v > bestIou) { bestIou = v; best = i; }
    });
    if (best < 0 || bestIou < threshold) return false;
    used.add(best);
  }
  return true;
}

/**
 * Saved layouts a draft possibly duplicates: same canvas class, every slot
 * pairing at IoU ≥ 0.85. A flag for the save dialog — never a block.
 */
export function layoutDuplicates(draft: Layout, existing: readonly Layout[], threshold = LAYOUT_DUPLICATE_IOU): LayoutDuplicate[] {
  const out: LayoutDuplicate[] = [];
  for (const l of existing) {
    if (l.id === draft.id) continue;
    if (!canvasClassMatches(l.canvas, draft.canvas)) continue;
    if (slotSetsMatch(draft.slots, l.slots, threshold)) out.push({ id: l.id, name: l.name, archived: !!l.archived });
  }
  return out;
}

/** The sentence the save dialog shows (spec §3); null when nothing is flagged. */
export function duplicateFlag(dups: readonly LayoutDuplicate[]): string | null {
  if (!dups.length) return null;
  return `possibly duplicates ⟨${dups.map((d) => d.name).join("⟩, ⟨")}⟩`;
}

/** The classes that actually exist in saved (unarchived) layouts, with a layout count — the facet editor's list. */
export function slotClassesInLayouts(layouts: readonly Layout[]): Array<{ class: string; layouts: number; custom: boolean }> {
  const counts = new Map<string, { layouts: Set<string>; custom: boolean }>();
  for (const l of layouts) {
    if (l.archived) continue;
    for (const s of l.slots) {
      const e = counts.get(s.class) ?? { layouts: new Set<string>(), custom: !!s.custom };
      e.layouts.add(l.id);
      counts.set(s.class, e);
    }
  }
  return [...counts.entries()]
    .map(([cls, e]) => ({ class: cls, layouts: e.layouts.size, custom: e.custom }))
    .sort((a, b) => b.layouts - a.layouts || a.class.localeCompare(b.class));
}

/* ------------------------------------------------------ apps (§2) ---- */

export type AppSetupStatus = "signed-in" | "needs-attention" | "unknown";

export interface AppSetup {
  status: AppSetupStatus;
  /** ISO date of the last passive verification. */
  lastVerified?: string;
  /**
   * What the status rests on: "probe" - the adapter's session probe saw the account on the page;
   * "asserted" - a person said "I'm signed in"; "url" - only the page's address was seen (the App's
   * own site loaded, which a signed-out visitor gets too). Absent for old records = "url".
   */
  evidence?: "probe" | "asserted" | "url";
}

/** App-level rendering defaults every facet of the app inherits (the old base tile's behavior fields). */
export interface AppRenderDefaults {
  viewport?: ViewportMode;
  uaPlatform?: "windows" | "mac";
  intermission?: TileSpec["intermission"];
  veil?: TileSpec["veil"];
  blocking?: boolean;
  persist?: boolean;
  audio?: AudioPolicy;
}

export interface App {
  id: string;
  name: string;
  baseUrl: string;
  /** §10 profile the app's session lives in; never wiped. */
  profileId: string;
  catalogRef?: string;
  adapter?: string;
  setup: AppSetup;
  render?: AppRenderDefaults;
  /** §12 native launch (a both-ways app keeps its url as baseUrl). */
  launch?: { package: string; deepLink?: string };
}

/* ---------------------------------------------------- facets (§4) ---- */

export interface Facet {
  id: string;
  app: string;
  url: string;
  /** Formatted slot class the facet is cut for ("16:9·XL"). */
  slotClass: string;
  focus?: FocusSpec;
  zoom?: number;
  label: string;
  /** §32: a music facet is hidden-only — never occupies a slot, feeds visualizations. */
  music?: boolean;
  audio?: AudioPolicy;
  touch?: TouchMode;
  refresh?: number | null;
  /** The solver hint the facet wants when its slot reflows ("W:H"); default: the class's aspect. */
  aspectHint?: string;
}

export interface FacetFit {
  compatible: boolean;
  match: "exact" | "one-step" | "none";
  /** One-step matches carry the note the picker shows: an L facet in an XL slot stretches, XL in L shrinks. */
  note?: "stretch" | "shrink";
}

/**
 * Compatibility rule (spec §4): same aspect bucket AND size tier within one
 * step. Custom classes only match themselves.
 */
export function facetFitsSlot(facetClass: string | SlotClass, slotClass: string | SlotClass): FacetFit {
  const f = typeof facetClass === "string" ? parseSlotClass(facetClass) : facetClass;
  const s = typeof slotClass === "string" ? parseSlotClass(slotClass) : slotClass;
  if (!f || !s || f.aspect !== s.aspect) return { compatible: false, match: "none" };
  const fi = SIZE_TIERS.indexOf(f.tier), si = SIZE_TIERS.indexOf(s.tier);
  if (fi === si) return { compatible: true, match: "exact" };
  if (Math.abs(fi - si) === 1) return { compatible: true, match: "one-step", note: si > fi ? "stretch" : "shrink" };
  return { compatible: false, match: "none" };
}

/** The facets a slot's picker lists — compatible only, exact class first, one-step labeled; stable otherwise. */
export function orderFacetsForSlot<T extends { slotClass: string; music?: boolean }>(facets: readonly T[], slotClass: string): Array<{ facet: T; fit: FacetFit }> {
  const out: Array<{ facet: T; fit: FacetFit }> = [];
  for (const facet of facets) {
    if (facet.music) continue; // §32 hidden-only
    const fit = facetFitsSlot(facet.slotClass, slotClass);
    if (fit.compatible) out.push({ facet, fit });
  }
  return out.sort((a, b) => Number(b.fit.match === "exact") - Number(a.fit.match === "exact"));
}

/* ---------------------------------------------------- scenes (§5) ---- */

export type OnEnd = "none" | "restart" | "restart-fullscreen";

/** Standing human instructions per facet-in-slot (dashboard-schema §26). */
export interface AssignmentSettings {
  keepPresentation: boolean;
  onEnd: OnEnd;
  /** Runtime overrides for this placement (templates set these: hero exclusive, utilities mute + scroll). */
  audio?: AudioPolicy;
  touch?: TouchMode;
  /**
   * §25 living previews (docs/concept-scenes.md §4): this placement's still
   * advances on the peek cadence while it is not playing. Absent = no peeks.
   */
  preview?: { mode: "peek"; interval: number; playhead: "advance" | "hold" };
  /** §5 audio-follows-tap (concept-scenes): absent === "promote" (§6a unchanged). */
  tapAction?: TapAction;
  /** §26 imagery for this placement's ad breaks: "pack:gallery" | "pack:cosmos" | a photos ref; and, for a hidden music source, the ambient soundscape (opt-in, 2026-09-07). */
  intermission?: { source?: string; ambient?: string };
  /**
   * What this placement does when its Scene is applied. Absent = nothing, which
   * is every existing scene: this is opt-in and changes no wall until it is set.
   *
   * "play" runs the PAGE's own registered Media Session play handler once the
   * placement has loaded - the same function the OS media keys call and the same
   * one §32 transport pass-through uses. It is what makes "pick the scene and it
   * plays" true for a Music Lounge, whose hidden source otherwise sits loaded and
   * silent until a human reveals the player and presses play.
   *
   * See the *Decision (pending)* in docs/concept-scenes.md §2.5: §32 says
   * transport is pass-through on a HUMAN action, and whether choosing a scene is
   * that action is the maintainer's call. §4 schedules already start things with
   * nobody in the room, which is the argument for yes.
   */
  onActivate?: "play";
}

/**
 * The peek cadence a placement asks for when it names none (§25). The device
 * budget floors it at run time (`PREVIEW_BUDGETS`), so this is a request, not
 * a promise — 30s is the mini-PC / tablet floor.
 */
export const DEFAULT_PEEK_INTERVAL_SEC = 30;

/**
 * The three additions above default to ABSENT, and migration never sets them
 * (scene-model spec §9): an existing scene behaves exactly as it did.
 */
export const DEFAULT_ASSIGNMENT_SETTINGS: Readonly<AssignmentSettings> = { keepPresentation: false, onEnd: "none" };

export type FloatAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface FloatingPlacement {
  /** A facet id or a visualization id (one of the two). */
  facet?: string;
  visualization?: string;
  anchor: FloatAnchor;
  /** Width as a fraction of the canvas; height follows the content's aspect. */
  size: number;
  /** An exact place (canvas fractions) wins over anchor + size — what migration and a drag write. */
  rect?: NormalizedRect;
  face?: "control" | "page";
}

export interface HiddenPlacement {
  facet: string;
  audio: AudioPolicy;
}

/** The twenty shipped packs: the four originals, eight ENVIRONMENT tableaus, eight COMMUNITY tableaus (concept-scenes §2.5.2, decision 2026-09-06). */
export type VisualizationStyle =
  | "prism-beams"
  | "spectrum"
  | "ribbon"
  | "bloom"
  | "aurora-ridge"
  | "ocean-moon"
  | "forest-fireflies"
  | "rain-window"
  | "snow-village"
  | "desert-stars"
  | "storm-front"
  | "sunrise-meadow"
  | "campfire-circle"
  | "city-skyline"
  | "lantern-festival"
  | "fireworks-night"
  | "harbor-lights"
  | "night-train"
  | "street-fair"
  | "stadium-wave";
export type ArtworkMode = "off" | "backdrop" | "focal";

/** §32 placeable content whose `source` is a hidden music facet; idles dark with no playing source. */
export interface Visualization {
  id: string;
  source: string;
  style: VisualizationStyle | string;
  artwork: ArtworkMode;
  label?: string;
  /** Let the drawing spill past its tile over the neighbours (concept-scenes §2.5.2 decision 2026-09-05). Default: contained. */
  spill?: boolean;
}

export interface Scene {
  id: string;
  name: string;
  /** Layout id. */
  layout: string;
  /** slot id → facet id or visualization id (looked up in `visualizations` first). */
  assign: Record<string, string>;
  /** slot id → standing instructions for that placement. */
  settings?: Record<string, AssignmentSettings>;
  floating: FloatingPlacement[];
  hidden: HiddenPlacement[];
  visualizations?: Visualization[];
  schedule: ScheduleEntry[] | null;
}

export type Assignment =
  | { kind: "facet"; facet: Facet }
  | { kind: "visualization"; visualization: Visualization }
  | { kind: "missing"; ref: string };

export function resolveAssignment(scene: Scene, slotId: string, facets: ReadonlyMap<string, Facet> | readonly Facet[]): Assignment | null {
  const ref = scene.assign[slotId];
  if (!ref) return null;
  const viz = scene.visualizations?.find((v) => v.id === ref);
  if (viz) return { kind: "visualization", visualization: viz };
  const facet = Array.isArray(facets) ? (facets as readonly Facet[]).find((f) => f.id === ref) : (facets as ReadonlyMap<string, Facet>).get(ref);
  return facet ? { kind: "facet", facet } : { kind: "missing", ref };
}

export function assignmentSettings(scene: Scene, slotId: string): AssignmentSettings {
  return { ...DEFAULT_ASSIGNMENT_SETTINGS, ...(scene.settings?.[slotId] ?? {}) };
}

/* ------------------------------------------- scene templates (§31) ---- */

export type TemplateRoleKind = "video-hero" | "utility" | "news" | "music" | "any" | "visualization";

/** What a `visualization` role places (docs/concept-scenes.md §7a): a style, an artwork mode, and the HIDDEN role that feeds it. */
export interface TemplateVisualization {
  style: VisualizationStyle;
  artwork: ArtworkMode;
  /** A hidden role id — the role whose facet becomes the visualization's source. */
  source: string;
}

/** A role names a slot's purpose and class — never a concrete app. */
export interface TemplateRole {
  id: string;
  label: string;
  class: string;
  kind: TemplateRoleKind;
  /** Catalog refs the wizard suggests; "any app" is always offered beside them. */
  suggestions: string[];
  /** The utility preset (catalog `focusPresets` id) the wizard cuts the facet from, by NAME. */
  tunedPreset?: string;
  audio: AudioPolicy;
  touch: TouchMode;
  settings: AssignmentSettings;
  /**
   * §7a, `kind: "visualization"` only: this role resolves to a Visualization,
   * not to a facet. It is complete when the hidden role it names is — the
   * wizard never asks for it separately.
   */
  visualization?: TemplateVisualization;
}

export interface SceneTemplate {
  id: string;
  name: string;
  blurb: string;
  /** The canvas aspect the blueprint is drawn for. */
  canvasAspect: string;
  roles: TemplateRole[];
  /** The blueprint: one slot per role, rects in canvas fractions. */
  slots: Array<{ role: string; rect: NormalizedRect }>;
  /**
   * §7a: roles that resolve to HIDDEN facets (§5 `scene.hidden[]`) — loaded,
   * zero-size, in audio focus. Music Lounge is the first template whose audio
   * owner is not in a slot. Absent on every template that has none.
   */
  hidden?: TemplateRole[];
}

/** Every role a template asks about: its slot roles, then its hidden ones. */
function allRoles(template: SceneTemplate): TemplateRole[] {
  return [...template.roles, ...(template.hidden ?? [])];
}

/**
 * The id the Visualization a template role produces is written under
 * (`scene.visualizations[].id`, and the value `scene.assign[<role>]` carries).
 * Scene-scoped, so it needs no counter: one visualization per role.
 */
export function templateVisualizationId(roleId: string): string {
  return `viz-${roleId}`;
}

export const KITCHEN_CLASSIC: SceneTemplate = {
  id: "kitchen-classic",
  name: "Kitchen Classic",
  blurb: "A video hero with the week, the weather and a news ticker around it.",
  canvasAspect: "16:9",
  roles: [
    {
      id: "hero", label: "Video hero", class: "16:9·XL", kind: "video-hero",
      suggestions: ["netflix", "hulu", "youtube", "twitch"],
      audio: "exclusive", touch: "full",
      settings: { keepPresentation: true, onEnd: "none", audio: "exclusive", touch: "full" },
    },
    {
      id: "calendar", label: "Calendar", class: "3:4·M", kind: "utility",
      suggestions: ["prism-agenda"], tunedPreset: "agenda",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
    {
      id: "weather", label: "Weather", class: "4:3·M", kind: "utility",
      suggestions: ["weather"], tunedPreset: "current-conditions",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
    {
      id: "ticker", label: "News ticker", class: "8:1-ticker·M", kind: "news",
      suggestions: [], tunedPreset: "headline-river",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
  ],
  slots: [
    { role: "hero", rect: { x: 0, y: 0, w: 0.75, h: 0.8 } },
    { role: "ticker", rect: { x: 0, y: 0.8, w: 0.75, h: 0.2 } },
    { role: "weather", rect: { x: 0.75, y: 0, w: 0.25, h: 0.36 } },
    { role: "calendar", rect: { x: 0.75, y: 0.36, w: 0.25, h: 0.64 } },
  ],
};

/**
 * The kitchen wall by the fridge (docs/concept-scenes.md §2.1): something
 * playing, the day's shape beside it, and the list everyone argues about.
 * `chores` pre-resolves — its only suggestion is a first-party App — so five
 * roles are four real decisions.
 */
export const KITCHEN_COMMAND: SceneTemplate = {
  id: "kitchen-command",
  name: "Kitchen Command",
  blurb: "A video hero with the weather, the week, the family list and a news ticker around it. Personal calendars connect today, and work calendars are coming to Merge.",
  canvasAspect: "16:9",
  roles: [
    {
      id: "hero", label: "Video hero", class: "16:9·XL", kind: "video-hero",
      suggestions: ["netflix", "hulu", "youtube", "twitch"],
      audio: "exclusive", touch: "full",
      settings: { keepPresentation: true, onEnd: "none", audio: "exclusive", touch: "full", tapAction: "promote", intermission: { source: "pack:cosmos" } },
    },
    {
      id: "weather", label: "Weather", class: "4:3·M", kind: "utility",
      suggestions: ["weather"], tunedPreset: "current-conditions",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
    {
      id: "agenda", label: "Calendar", class: "4:3·M", kind: "utility",
      suggestions: ["prism-agenda"], tunedPreset: "agenda",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
    {
      id: "chores", label: "Chores & notes", class: "4:3·M", kind: "utility",
      suggestions: ["prism-chores"],
      audio: "mute", touch: "full",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full" },
    },
    {
      id: "ticker", label: "News ticker", class: "8:1-ticker·M", kind: "news",
      suggestions: [], tunedPreset: "headline-river",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
  ],
  slots: [
    { role: "hero", rect: { x: 0, y: 0, w: 0.75, h: 0.8 } },
    { role: "ticker", rect: { x: 0, y: 0.8, w: 0.75, h: 0.2 } },
    { role: "weather", rect: { x: 0.75, y: 0, w: 0.25, h: 0.34 } },
    { role: "agenda", rect: { x: 0.75, y: 0.34, w: 0.25, h: 0.33 } },
    { role: "chores", rect: { x: 0.75, y: 0.67, w: 0.25, h: 0.33 } },
  ],
};

/**
 * A main game with two beside it (docs/concept-scenes.md §2.2). The concept
 * that needs both pull-forwards: §25 peek keeps the silent games advancing,
 * and §5 audio-follows-tap moves the sound to the game you touched without
 * promoting it out of the grid. Peek is set on all three deliberately — the
 * scheduler never peeks a playing tile, so the setting manages itself as the
 * audio moves around.
 *
 * Hero-plus-two, not the 2x2 this template first shipped: four concurrent
 * games exceeded §18's concurrent-playing budget on every build but the mini
 * PC (maintainer decision 2026-09-03, charter §2.2). A household that can
 * drive a fourth adds the slot itself in the layout editor.
 *
 * The classes below are DERIVED, not chosen: a 16:9 slot on a 16:9 canvas
 * needs equal w/h fractions, so a true-16:9 hero-plus-two-stacked tiling
 * only closes at 2/3 + 1/3 — which forces a third of the wall to be ticker.
 * This blueprint stretches the games to fill 84% of the height instead and
 * takes the classes `classifyRect` derives from that (§1: a role's class
 * MUST equal `classifyRect(rect, canvas)`).
 */
export const SPORTS_MULTIVIEW: SceneTemplate = {
  id: "sports-multiview",
  name: "Sports Multiview",
  blurb: "A main game with two beside it. Tap one to move the sound to it. The others keep advancing as though you were watching. Add a fourth in the layout editor if your build can drive it.",
  canvasAspect: "16:9",
  roles: [
    {
      id: "game1", label: "Main game", class: "4:3·XL", kind: "video-hero",
      suggestions: ["youtube", "twitch", "hulu"],
      audio: "exclusive", touch: "full",
      settings: { keepPresentation: true, onEnd: "none", audio: "exclusive", touch: "full", tapAction: "audio", preview: { mode: "peek", interval: DEFAULT_PEEK_INTERVAL_SEC, playhead: "advance" } },
    },
    {
      id: "game2", label: "Game 2", class: "3:2·M", kind: "video-hero",
      suggestions: ["youtube", "twitch", "hulu"],
      audio: "mute", touch: "full",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full", tapAction: "audio", preview: { mode: "peek", interval: DEFAULT_PEEK_INTERVAL_SEC, playhead: "advance" } },
    },
    {
      id: "game3", label: "Game 3", class: "3:2·M", kind: "video-hero",
      suggestions: ["youtube", "twitch", "hulu"],
      audio: "mute", touch: "full",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full", tapAction: "audio", preview: { mode: "peek", interval: DEFAULT_PEEK_INTERVAL_SEC, playhead: "advance" } },
    },
    {
      id: "scores", label: "Scores ticker", class: "8:1-ticker·M", kind: "news",
      suggestions: [], tunedPreset: "headline-river",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
  ],
  slots: [
    { role: "game1", rect: { x: 0, y: 0, w: 0.665, h: 0.84 } },
    { role: "game2", rect: { x: 0.665, y: 0, w: 0.335, h: 0.42 } },
    { role: "game3", rect: { x: 0.665, y: 0.42, w: 0.335, h: 0.42 } },
    { role: "scores", rect: { x: 0, y: 0.84, w: 1, h: 0.16 } },
  ],
};
/**
 * One thing, edge to edge (docs/concept-scenes.md §2.3). One role by
 * decision: a template carries no floating or hidden extras (those are
 * scene-level, spec §5), so Movie Night ships as the full-canvas hero with
 * the settings that make a movie behave — presentation kept across ad
 * boundaries, nothing restarting at the end, the Gallery pack on the veil.
 */
export const MOVIE_NIGHT: SceneTemplate = {
  id: "movie-night",
  name: "Movie Night",
  blurb: "One screen, edge to edge. Ad breaks become paintings, and the player's fullscreen is put back the way you left it.",
  canvasAspect: "16:9",
  roles: [
    {
      id: "screen", label: "The movie", class: "16:9·XL", kind: "video-hero",
      suggestions: ["netflix", "hulu", "primevideo", "peacock", "paramountplus"],
      audio: "exclusive", touch: "full",
      settings: { keepPresentation: true, onEnd: "none", audio: "exclusive", touch: "full", tapAction: "promote", intermission: { source: "pack:gallery" } },
    },
  ],
  slots: [
    { role: "screen", rect: { x: 0, y: 0, w: 1, h: 1 } },
  ],
};

/**
 * The hallway panel, portrait (docs/concept-scenes.md §2.4): faces, the day,
 * the list, and a timer that isn't a phone. `timer` is the one role with
 * `audio: "mix"` — a countdown chime that cannot be heard is not a timer —
 * and it is NOT the exclusive owner: Family Hub has no exclusive role at all,
 * so `templateAudioOwner` returns null. That is legal for a template with no
 * video hero, not a bug.
 */
export const FAMILY_HUB: SceneTemplate = {
  id: "family-hub",
  name: "Family Hub",
  blurb: "A portrait panel for the hallway: photos, the week, the family list, a timer and the weather.",
  canvasAspect: "9:16",
  roles: [
    {
      id: "photos", label: "Photos", class: "4:3·XL", kind: "any",
      suggestions: [],
      audio: "mute", touch: "none",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "none" },
    },
    {
      id: "agenda", label: "Calendar", class: "1:1·M", kind: "utility",
      suggestions: ["prism-agenda"], tunedPreset: "agenda",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
    {
      id: "chores", label: "Chores & notes", class: "1:1·M", kind: "utility",
      suggestions: ["prism-chores"],
      audio: "mute", touch: "full",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full" },
    },
    {
      id: "timer", label: "Timer", class: "16:9·M", kind: "utility",
      suggestions: ["prism-timer"],
      audio: "mix", touch: "full",
      settings: { keepPresentation: false, onEnd: "none", audio: "mix", touch: "full" },
    },
    {
      id: "weather", label: "Weather", class: "16:9·M", kind: "utility",
      suggestions: ["weather"], tunedPreset: "current-conditions",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
    {
      id: "ticker", label: "News ticker", class: "8:1-ticker·M", kind: "news",
      suggestions: [], tunedPreset: "headline-river",
      audio: "mute", touch: "scroll",
      settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" },
    },
  ],
  slots: [
    { role: "photos", rect: { x: 0, y: 0, w: 1, h: 0.4 } },
    { role: "agenda", rect: { x: 0, y: 0.4, w: 0.5, h: 0.32 } },
    { role: "chores", rect: { x: 0.5, y: 0.4, w: 0.5, h: 0.32 } },
    { role: "timer", rect: { x: 0, y: 0.72, w: 0.5, h: 0.16 } },
    { role: "weather", rect: { x: 0.5, y: 0.72, w: 0.5, h: 0.16 } },
    { role: "ticker", rect: { x: 0, y: 0.88, w: 1, h: 0.12 } },
  ],
};

/**
 * The whole wall is the music (docs/concept-scenes.md §2.5): a white beam
 * enters a prism and leaves as the brand's four bands, bending with what is
 * playing. The first template whose audio owner is not in a slot —
 * `templateAudioOwner` returns the HIDDEN `source` role, which is new and
 * legal (§32: a music facet is hidden-only, never a slot candidate).
 *
 * `stage` is a `visualization` role: it resolves to a Visualization sourced to
 * whatever facet `source` resolves to, so the household makes ONE decision
 * (which service) and the wizard creates the hidden facet and the
 * visualization together.
 */
const MUSIC_LOUNGE_STAGE: TemplateRole = {
  id: "stage", label: "The stage", class: "16:9·XL", kind: "visualization",
  suggestions: [],
  visualization: { style: "prism-beams", artwork: "backdrop", source: "source" },
  audio: "mute", touch: "full",
  // §6a for a music item: a single tap reveals the native player (§32 layer 4),
  // a second tap sends it back. The verb is the same "promote".
  settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full", tapAction: "promote" },
};

/**
 * The hidden music facet: it supplies the audio and the Media Session state
 * the visualization draws from, and it is the scene's one exclusive owner.
 * Its class is the full-canvas one because a hidden facet is loaded off-canvas
 * at full size — it never enters a slot picker (`orderFacetsForSlot` skips
 * music facets), so the class only ever names the shape it is cut for.
 * Suggestions are the three services the Widevine-audio POC cleared for the
 * embedded tile (docs/reports/music-webview2-poc.md); "any app" sits beside
 * them as everywhere.
 */
const MUSIC_LOUNGE_SOURCE: TemplateRole = {
  id: "source", label: "Music service", class: "16:9·XL", kind: "music",
  suggestions: ["spotify", "apple-music", "pandora"],   // Amazon Music (catalog, 2026-09-09) joins once the tile has its POC verdict - the guard test holds the line
  audio: "exclusive", touch: "full",
  settings: { keepPresentation: false, onEnd: "none", audio: "exclusive", touch: "full" },
};

export const MUSIC_LOUNGE: SceneTemplate = {
  id: "music-lounge",
  name: "Music Lounge",
  blurb: "The whole wall is the music. Sign in to your service and the beams do the rest. Tap to bring up the player, and tap again to send it back.",
  canvasAspect: "16:9",
  roles: [MUSIC_LOUNGE_STAGE],
  slots: [
    { role: "stage", rect: { x: 0, y: 0, w: 1, h: 1 } },
  ],
  hidden: [MUSIC_LOUNGE_SOURCE],
};

/**
 * "Lounge + clock" (§2.5.1): the same stage with the time in the corner. The
 * timer micro-facet already knows how to be a clock face, so the role
 * pre-resolves (§1: one first-party suggestion, `account: "none"`) and the
 * household still makes exactly one decision.
 *
 * The clock's rect is square ON THE CANVAS, not in canvas fractions: a slot's
 * class comes from its PIXEL aspect (§9), so 0.14 × 0.25 of a 16:9 canvas is
 * what classes `1:1·S`. §2.5.1 first wrote `0.14, 0.14`, which is a 16:9 box;
 * the class it names is the normative half and the height follows it.
 */
const MUSIC_LOUNGE_CLOCK_ROLE: TemplateRole = {
  id: "clock", label: "Clock", class: "1:1·S", kind: "utility",
  suggestions: ["prism-timer"], tunedPreset: "clock",
  audio: "mute", touch: "full",
  settings: { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full" },
};

export const MUSIC_LOUNGE_CLOCK: SceneTemplate = {
  id: "music-lounge-clock",
  name: "Music Lounge + Clock",
  blurb: "The whole wall is the music, with the time in the corner. Sign in to your service and the beams do the rest. Tap to bring up the player, and tap again to send it back.",
  canvasAspect: "16:9",
  roles: [MUSIC_LOUNGE_STAGE, MUSIC_LOUNGE_CLOCK_ROLE],
  slots: [
    { role: "stage", rect: { x: 0, y: 0, w: 1, h: 1 } },
    { role: "clock", rect: { x: 0.83, y: 0.04, w: 0.14, h: 0.25 } },
  ],
  hidden: [MUSIC_LOUNGE_SOURCE],
};

/**
 * What the "New Scene" wizard offers, in order. Kitchen Command leads (the
 * fuller kitchen); Kitchen Classic stays as the minimal starter — SM-5's
 * golden path names it by id.
 */
export const SCENE_TEMPLATES: readonly SceneTemplate[] = [KITCHEN_COMMAND, SPORTS_MULTIVIEW, MOVIE_NIGHT, FAMILY_HUB, MUSIC_LOUNGE, MUSIC_LOUNGE_CLOCK, KITCHEN_CLASSIC];

export interface TemplateCompletion {
  complete: boolean;
  unresolved: string[];
}

/**
 * Instantiable only when every role — slot roles AND hidden roles (§7a) — is
 * resolved to a facet. A `visualization` role is the exception: it is complete
 * when the hidden role it names is resolved, and it never appears in
 * `unresolved` while that role is declared here, because it is not a second
 * question (the wizard creates the facet and the visualization together). A
 * visualization role naming a role this template does not declare is a
 * template bug, and stays unresolved forever so it cannot be instantiated.
 */
export function templateCompletion(template: SceneTemplate, resolved: Readonly<Record<string, string | undefined>>): TemplateCompletion {
  const roles = allRoles(template);
  const declared = new Set(roles.map((r) => r.id));
  const unresolved: string[] = [];
  for (const r of roles) {
    if (r.kind === "visualization") {
      const src = r.visualization?.source;
      if (!src || (!declared.has(src) && !resolved[src])) unresolved.push(r.id);
      continue;
    }
    if (!resolved[r.id]) unresolved.push(r.id);
  }
  return { complete: unresolved.length === 0, unresolved };
}

/**
 * The audio defaults a template sets: exactly one exclusive owner (the hero),
 * utilities mute. §7a: the owner may be a HIDDEN role — Music Lounge's one
 * exclusive role is the hidden music facet, not anything in a slot.
 */
export function templateAudioOwner(template: SceneTemplate): string | null {
  const owners = allRoles(template).filter((r) => r.audio === "exclusive");
  return owners.length === 1 ? owners[0]!.id : null;
}

export interface TemplateInstance {
  layout: Layout;
  scene: Scene;
  /** Roles whose derived class at this canvas differs from the role's class (a non-16:9 canvas). */
  notes: string[];
}

/**
 * Complete a template: the blueprint becomes a Layout for the canvas (slot
 * ids = role ids) and the resolutions become a Scene with the roles'
 * settings. Refuses while any role is unresolved.
 *
 * §7a: `resolved` carries a facet id for every slot role and every HIDDEN
 * role; a `visualization` role is never in it (the wizard never asks). Hidden
 * roles become `scene.hidden[]`, visualization roles become
 * `scene.visualizations[]` sourced to the facet their hidden role resolved to,
 * and `scene.assign[<viz role>]` carries the visualization's id — which
 * `resolveAssignment` looks up before it looks at facets. Slot-side settings
 * for a visualization role come from the role exactly like any other.
 */
export function instantiateTemplate(
  template: SceneTemplate,
  canvas: CanvasSize,
  resolved: Readonly<Record<string, string | undefined>>,
  ids: { layoutId: string; sceneId: string; name?: string },
): TemplateInstance | { error: "incomplete"; unresolved: string[] } {
  const completion = templateCompletion(template, resolved);
  if (!completion.complete) return { error: "incomplete", unresolved: completion.unresolved };
  const notes: string[] = [];
  const slots: Slot[] = template.slots.map((s) => {
    const role = template.roles.find((r) => r.id === s.role)!;
    const derived = formatSlotClass(classifyRect(s.rect, canvas));
    if (derived !== role.class) notes.push(`${role.id}: drawn for ${role.class}, classes as ${derived} on this canvas`);
    return { id: role.id, rect: s.rect, class: role.class, label: role.label };
  });
  const layout: Layout = {
    id: ids.layoutId, name: ids.name ?? template.name, canvas: canvasClassOf(canvas.w, canvas.h), slots,
    source: { mode: "template", template: template.id },
  };
  const assign: Record<string, string> = {};
  const settings: Record<string, AssignmentSettings> = {};
  const visualizations: Visualization[] = [];
  for (const role of template.roles) {
    if (role.kind === "visualization" && role.visualization) {
      const source = resolved[role.visualization.source];
      if (source) {
        const id = templateVisualizationId(role.id);
        visualizations.push({ id, source, style: role.visualization.style, artwork: role.visualization.artwork, label: role.label });
        assign[role.id] = id;
      }
    } else {
      assign[role.id] = resolved[role.id]!;
    }
    settings[role.id] = { ...role.settings };
  }
  // §5 hidden placements: loaded, zero-size, in audio focus with the role's policy.
  const hidden: HiddenPlacement[] = [];
  for (const role of template.hidden ?? []) hidden.push({ facet: resolved[role.id]!, audio: role.audio });
  const scene: Scene = { id: ids.sceneId, name: ids.name ?? template.name, layout: layout.id, assign, settings, floating: [], hidden, schedule: null };
  if (visualizations.length) scene.visualizations = visualizations;
  return { layout, scene, notes };
}

/* ---------------------------------------------- validation (untrusted) ---- */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const AUDIO = new Set(["exclusive", "mix", "mute"]);
const TOUCH = new Set(["full", "scroll", "none"]);
const ON_END = new Set(["none", "restart", "restart-fullscreen"]);
const ANCHORS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
const TAP_ACTIONS = new Set(["promote", "audio", "both"]);

function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeApp(input: unknown): App | null {
  if (!isRec(input)) return null;
  const id = str(input.id);
  const baseUrl = httpUrl(input.baseUrl);
  if (!id || !baseUrl) return null;
  const setupIn = isRec(input.setup) ? input.setup : {};
  const status = setupIn.status === "signed-in" || setupIn.status === "needs-attention" ? setupIn.status : "unknown";
  const app: App = {
    id,
    name: str(input.name) ?? id,
    baseUrl,
    profileId: str(input.profileId) ?? id,
    setup: {
      status,
      ...(str(setupIn.lastVerified) ? { lastVerified: str(setupIn.lastVerified)! } : {}),
      ...(setupIn.evidence === "probe" || setupIn.evidence === "asserted" || setupIn.evidence === "url" ? { evidence: setupIn.evidence } : {}),
    },
  };
  if (str(input.catalogRef)) app.catalogRef = str(input.catalogRef)!;
  if (str(input.adapter)) app.adapter = str(input.adapter)!;
  if (isRec(input.render)) {
    const r = input.render;
    const render: AppRenderDefaults = {};
    if (r.viewport === "auto" || r.viewport === "desktop" || r.viewport === "mobile" || r.viewport === "wide") render.viewport = r.viewport;
    if (r.uaPlatform === "windows" || r.uaPlatform === "mac") render.uaPlatform = r.uaPlatform;
    if (isRec(r.intermission) && typeof r.intermission.enabled === "boolean") render.intermission = r.intermission as AppRenderDefaults["intermission"];
    if (isRec(r.veil) && typeof r.veil.mode === "string") render.veil = r.veil as AppRenderDefaults["veil"];
    if (typeof r.blocking === "boolean") render.blocking = r.blocking;
    if (typeof r.persist === "boolean") render.persist = r.persist;
    if (typeof r.audio === "string" && AUDIO.has(r.audio)) render.audio = r.audio as AudioPolicy;
    if (Object.keys(render).length) app.render = render;
  }
  if (isRec(input.launch) && str(input.launch.package)) app.launch = { package: str(input.launch.package)!, ...(str(input.launch.deepLink) ? { deepLink: str(input.launch.deepLink)! } : {}) };
  return app;
}

function normalizeFocus(v: unknown): FocusSpec | undefined {
  if (!isRec(v)) return undefined;
  const out: FocusSpec = {};
  if (str(v.selector)) out.selector = str(v.selector)!;
  if (validRegion(v.region)) out.region = { x: v.region.x, y: v.region.y, w: v.region.w, h: v.region.h };
  if (isRec(v.viewport) && typeof v.viewport.w === "number" && typeof v.viewport.h === "number" && v.viewport.w > 0 && v.viewport.h > 0) out.viewport = { w: v.viewport.w, h: v.viewport.h };
  if (typeof v.pad === "number" && Number.isFinite(v.pad)) out.pad = v.pad;
  if (v.fit === "width" || v.fit === "height" || v.fit === "contain") out.fit = v.fit;
  return out.selector || out.region ? out : undefined;
}

export function normalizeFacet(input: unknown): Facet | null {
  if (!isRec(input)) return null;
  const id = str(input.id), app = str(input.app), url = httpUrl(input.url);
  const slotClass = str(input.slotClass) ? parseSlotClass(str(input.slotClass)!) : null;
  if (!id || !app || !url || !slotClass) return null;
  const facet: Facet = { id, app, url, slotClass: formatSlotClass(slotClass), label: str(input.label) ?? id };
  const focus = normalizeFocus(input.focus);
  if (focus) facet.focus = focus;
  if (typeof input.zoom === "number" && Number.isFinite(input.zoom) && input.zoom > 0) facet.zoom = Math.min(3, Math.max(0.5, input.zoom));
  if (input.music === true) facet.music = true;
  if (typeof input.audio === "string" && AUDIO.has(input.audio)) facet.audio = input.audio as AudioPolicy;
  if (typeof input.touch === "string" && TOUCH.has(input.touch)) facet.touch = input.touch as TouchMode;
  if (input.refresh === null || (typeof input.refresh === "number" && input.refresh > 0)) facet.refresh = input.refresh as number | null;
  if (str(input.aspectHint) && parseAspectHint(str(input.aspectHint)!)) facet.aspectHint = str(input.aspectHint)!;
  return facet;
}

export function normalizeLayout(input: unknown): Layout | null {
  if (!isRec(input)) return null;
  const id = str(input.id) ?? "";
  let canvas: CanvasClass | null = null;
  if (isRec(input.canvas) && typeof input.canvas.ratio === "number" && input.canvas.ratio > 0) {
    const c = input.canvas;
    const ratio = c.ratio as number;
    const res = c.resolution === "4K-class" || c.resolution === "1440-class" ? c.resolution : "1080-class";
    canvas = { aspect: str(c.aspect) ?? canvasClassOf(ratio * 1000, 1000).aspect, ratio, resolution: res, orientation: ratio >= 1 ? "landscape" : "portrait" };
  } else if (isRec(input.canvasSize) && typeof input.canvasSize.w === "number" && typeof input.canvasSize.h === "number") {
    canvas = canvasClassOf(input.canvasSize.w, input.canvasSize.h);
  }
  if (!canvas || !Array.isArray(input.slots)) return null;
  const size = { w: canvas.ratio * 1000, h: 1000 };
  const slots: Slot[] = [];
  const seen = new Set<string>();
  (input.slots as unknown[]).forEach((s, i) => {
    if (!isRec(s) || !validNormalizedRect(s.rect)) return;
    let sid = str(s.id) ?? `slot-${i + 1}`;
    for (let n = 2; seen.has(sid); n++) sid = `${sid}-${n}`;
    seen.add(sid);
    const rect: NormalizedRect = { x: Math.max(0, s.rect.x), y: Math.max(0, s.rect.y), w: Math.min(1, s.rect.w), h: Math.min(1, s.rect.h) };
    const custom = s.custom === true ? parseSlotClass(str(s.class) ?? "") : null;
    const cls = custom && custom.custom
      ? formatSlotClass({ ...custom, tier: sizeTier(rect.w * rect.h) })
      : formatSlotClass(classifyRect(rect, size));
    slots.push({ id: sid, rect, class: cls, ...(custom && custom.custom ? { custom: true } : {}), ...(str(s.label) ? { label: str(s.label)! } : {}) });
  });
  if (!slots.length || slots.length > 24) return null;
  const layout: Layout = { id, name: str(input.name) ?? "Untitled layout", canvas, slots };
  if (input.archived === true) layout.archived = true;
  if (isRec(input.source) && typeof input.source.mode === "string") {
    const src = input.source;
    if (src.mode === "hero" && str(src.hero)) layout.source = { mode: "hero", hero: str(src.hero)!, heroSize: typeof src.heroSize === "number" ? src.heroSize : 0.62, satellites: Array.isArray(src.satellites) ? (src.satellites as unknown[]).filter((x): x is string => typeof x === "string") : "auto" };
    else if (src.mode === "grid") layout.source = { mode: "grid", cols: Number(src.cols) || 1, rows: Number(src.rows) || 1 };
    else if (src.mode === "template" && str(src.template)) layout.source = { mode: "template", template: str(src.template)! };
    else if (src.mode === "drawn") layout.source = { mode: "drawn" };
  }
  return layout;
}

function normalizeSettings(v: unknown): AssignmentSettings | null {
  if (!isRec(v)) return null;
  const out: AssignmentSettings = {
    keepPresentation: v.keepPresentation === true,
    onEnd: typeof v.onEnd === "string" && ON_END.has(v.onEnd) ? (v.onEnd as OnEnd) : "none",
  };
  if (typeof v.audio === "string" && AUDIO.has(v.audio)) out.audio = v.audio as AudioPolicy;
  if (typeof v.touch === "string" && TOUCH.has(v.touch)) out.touch = v.touch as TouchMode;
  // §25 peek: only a well-formed { mode: "peek", interval, playhead } survives.
  // Anything else - a string, mode "off", a negative interval - is DROPPED, so
  // the placement simply has no living preview. Untrusted input never throws.
  if (isRec(v.preview) && v.preview.mode === "peek") {
    const interval = typeof v.preview.interval === "number" && Number.isFinite(v.preview.interval) && v.preview.interval > 0
      ? v.preview.interval
      : DEFAULT_PEEK_INTERVAL_SEC;
    out.preview = { mode: "peek", interval, playhead: v.preview.playhead === "hold" ? "hold" : "advance" };
  }
  if (typeof v.tapAction === "string" && TAP_ACTIONS.has(v.tapAction)) out.tapAction = v.tapAction as TapAction;
  if (isRec(v.intermission) && (str(v.intermission.source) || str(v.intermission.ambient))) out.intermission = { ...(str(v.intermission.source) ? { source: str(v.intermission.source)! } : {}), ...(str(v.intermission.ambient) ? { ambient: str(v.intermission.ambient)! } : {}) };
  // Only the exact literal survives: anything else leaves onActivate absent, so
  // an unknown value can never make a wall start playing on its own.
  if (v.onActivate === "play") out.onActivate = "play";
  return out;
}

export function normalizeScene(input: unknown): Scene | null {
  if (!isRec(input)) return null;
  const layout = str(input.layout);
  if (!layout) return null;
  const assign: Record<string, string> = {};
  if (isRec(input.assign)) for (const [k, v] of Object.entries(input.assign)) if (k && str(v)) assign[k] = str(v)!;
  const scene: Scene = { id: str(input.id) ?? "", name: str(input.name) ?? "Untitled scene", layout, assign, floating: [], hidden: [], schedule: null };
  if (isRec(input.settings)) {
    const settings: Record<string, AssignmentSettings> = {};
    for (const [k, v] of Object.entries(input.settings)) { const s = normalizeSettings(v); if (k && s) settings[k] = s; }
    if (Object.keys(settings).length) scene.settings = settings;
  }
  if (Array.isArray(input.floating)) {
    for (const f of input.floating as unknown[]) {
      if (!isRec(f)) continue;
      const facet = str(f.facet), visualization = str(f.visualization);
      if (!facet && !visualization) continue;
      const size = typeof f.size === "number" && f.size > 0 && f.size <= 1 ? f.size : 0.3;
      const p: FloatingPlacement = { ...(facet ? { facet } : {}), ...(visualization && !facet ? { visualization } : {}), anchor: typeof f.anchor === "string" && ANCHORS.has(f.anchor) ? (f.anchor as FloatAnchor) : "bottom-right", size };
      if (validNormalizedRect(f.rect)) p.rect = { x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h };
      if (f.face === "page" || f.face === "control") p.face = f.face;
      scene.floating.push(p);
    }
  }
  if (Array.isArray(input.hidden)) {
    for (const h of input.hidden as unknown[]) {
      if (!isRec(h) || !str(h.facet)) continue;
      if (scene.hidden.some((x) => x.facet === str(h.facet))) continue;   // B-164 (2026-09-08): one hidden entry per facet - "Add a music service" had listed Spotify twice
      scene.hidden.push({ facet: str(h.facet)!, audio: typeof h.audio === "string" && AUDIO.has(h.audio) ? (h.audio as AudioPolicy) : "exclusive" });
    }
  }
  if (Array.isArray(input.visualizations)) {
    const vizs: Visualization[] = [];
    for (const v of input.visualizations as unknown[]) {
      if (!isRec(v) || !str(v.id) || !str(v.source)) continue;
      vizs.push({ id: str(v.id)!, source: str(v.source)!, style: str(v.style) ?? "prism-beams", artwork: v.artwork === "backdrop" || v.artwork === "focal" ? v.artwork : "off", ...(str(v.label) ? { label: str(v.label)! } : {}), ...(v.spill === true ? { spill: true } : {}) });
    }
    if (vizs.length) scene.visualizations = vizs;
  }
  if (Array.isArray(input.schedule)) scene.schedule = (input.schedule as unknown[]).filter((e): e is ScheduleEntry => isRec(e) && typeof e.action === "string");
  return scene;
}

const VIZ_STYLES = new Set<string>(["prism-beams", "spectrum", "ribbon", "bloom", "aurora-ridge", "ocean-moon", "forest-fireflies", "rain-window", "snow-village", "desert-stars", "storm-front", "sunrise-meadow", "campfire-circle", "city-skyline", "lantern-festival", "fireworks-night", "harbor-lights", "night-train", "street-fair", "stadium-wave"]);
const ARTWORK_MODES = new Set<string>(["off", "backdrop", "focal"]);
const ROLE_KINDS = new Set<string>(["video-hero", "utility", "news", "music", "any", "visualization"]);

/**
 * §7a: a template role's visualization block, or `undefined` when it is
 * malformed — DROPPED, never thrown. A template's style must be one of the
 * four shipped packs (a community style is chosen in the scene builder, not
 * baked into a blueprint), the artwork mode one of the three §32 modes, and
 * the source a role id.
 */
export function normalizeTemplateVisualization(input: unknown): TemplateVisualization | undefined {
  if (!isRec(input)) return undefined;
  const style = str(input.style), artwork = str(input.artwork), source = str(input.source);
  if (!style || !VIZ_STYLES.has(style) || !artwork || !ARTWORK_MODES.has(artwork) || !source) return undefined;
  return { style: style as VisualizationStyle, artwork: artwork as ArtworkMode, source };
}

/** One role of an untrusted template (a shell reading `modelTemplates` JSON). Null = not a role at all. */
export function normalizeTemplateRole(input: unknown): TemplateRole | null {
  if (!isRec(input)) return null;
  const id = str(input.id);
  const cls = str(input.class) ? parseSlotClass(str(input.class)!) : null;
  if (!id || !cls) return null;
  const role: TemplateRole = {
    id,
    label: str(input.label) ?? id,
    class: formatSlotClass(cls),
    kind: typeof input.kind === "string" && ROLE_KINDS.has(input.kind) ? (input.kind as TemplateRoleKind) : "any",
    suggestions: Array.isArray(input.suggestions) ? (input.suggestions as unknown[]).map((s) => str(s)).filter((s): s is string => !!s) : [],
    audio: typeof input.audio === "string" && AUDIO.has(input.audio) ? (input.audio as AudioPolicy) : "mute",
    touch: typeof input.touch === "string" && TOUCH.has(input.touch) ? (input.touch as TouchMode) : "scroll",
    settings: normalizeSettings(input.settings) ?? { ...DEFAULT_ASSIGNMENT_SETTINGS },
  };
  if (str(input.tunedPreset)) role.tunedPreset = str(input.tunedPreset)!;
  // the kind is kept even when the block is dropped: the role then simply
  // never completes, which is the honest reading of a broken blueprint.
  const viz = normalizeTemplateVisualization(input.visualization);
  if (viz) role.visualization = viz;
  return role;
}

/** An untrusted Scene Template (§31/§7a): unreadable roles, slots and hidden roles are dropped, never thrown. */
export function normalizeSceneTemplate(input: unknown): SceneTemplate | null {
  if (!isRec(input)) return null;
  const id = str(input.id);
  if (!id || !Array.isArray(input.roles)) return null;
  const roles = (input.roles as unknown[]).map(normalizeTemplateRole).filter((r): r is TemplateRole => !!r);
  if (!roles.length) return null;
  const known = new Set(roles.map((r) => r.id));
  const slots: SceneTemplate["slots"] = [];
  if (Array.isArray(input.slots)) {
    for (const s of input.slots as unknown[]) {
      if (!isRec(s) || !str(s.role) || !known.has(str(s.role)!) || !validNormalizedRect(s.rect)) continue;
      slots.push({ role: str(s.role)!, rect: { x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h } });
    }
  }
  const template: SceneTemplate = {
    id, name: str(input.name) ?? id, blurb: str(input.blurb) ?? "",
    canvasAspect: str(input.canvasAspect) ?? "16:9", roles, slots,
  };
  if (Array.isArray(input.hidden)) {
    const hidden = (input.hidden as unknown[]).map(normalizeTemplateRole).filter((r): r is TemplateRole => !!r);
    if (hidden.length) template.hidden = hidden;
  }
  return template;
}

/* ------------------------------ materialization: Scene → document ---- */

const ANCHOR_RECT = (anchor: FloatAnchor, w: number, h: number, margin = 0.02): NormalizedRect => {
  const x = anchor.endsWith("left") ? margin : 1 - w - margin;
  const y = anchor.startsWith("top") ? margin : 1 - h - margin;
  return { x: Math.max(0, x), y: Math.max(0, y), w, h };
};

/** The float rect a floating placement lands at: the exact rect when present, else anchor + size at the content's aspect. */
export function floatingRect(p: FloatingPlacement, contentRatio: number, canvas: CanvasSize): NormalizedRect {
  if (p.rect) return p.rect;
  const w = Math.min(1, Math.max(0.12, p.size));
  const h = Math.min(1, (w * canvas.w) / contentRatio / canvas.h);
  return ANCHOR_RECT(p.anchor, w, h);
}

export interface SceneMaterials {
  scene: Scene;
  layout: Layout;
  facets: ReadonlyMap<string, Facet> | readonly Facet[];
  apps: ReadonlyMap<string, App> | readonly App[];
}

function lookup<T extends { id: string }>(coll: ReadonlyMap<string, T> | readonly T[], id: string): T | undefined {
  return Array.isArray(coll) ? (coll as readonly T[]).find((x) => x.id === id) : (coll as ReadonlyMap<string, T>).get(id);
}

/** The tile a facet renders as in a slot (the old renderer's unit); `id` = the slot id. */
export function facetTile(id: string, facet: Facet, app: App | undefined, settings: AssignmentSettings | undefined, aspectHint?: string): TileSpec {
  const tile: TileSpec = { id, url: facet.url, profile: app?.profileId ?? facet.app };
  const r = app?.render;
  // B-120: an App added from the catalog names no adapter of its own - the catalog entry and the adapter
  // file share an id by convention (prism-adapters/catalog/<id>.json <-> adapters/<id>.json), so the
  // catalogRef IS the adapter's name. Without this a wizard-built scene had no session probe, no
  // transport selectors and no music scripts at all. An unknown name is harmless: the registry has nothing.
  const adapter = app?.adapter ?? app?.catalogRef;
  if (adapter) tile.adapter = adapter;
  if (app?.launch) tile.launch = { ...app.launch };
  if (r?.viewport !== undefined) tile.viewport = r.viewport;
  if (r?.uaPlatform !== undefined) tile.uaPlatform = r.uaPlatform;
  if (r?.intermission !== undefined) tile.intermission = { ...r.intermission };
  if (r?.veil !== undefined) tile.veil = { ...r.veil };
  if (r?.blocking !== undefined) tile.blocking = r.blocking;
  if (r?.persist !== undefined) tile.persist = r.persist;
  const audio = settings?.audio ?? facet.audio ?? r?.audio;
  if (audio) tile.audio = audio;
  const touch = settings?.touch ?? facet.touch;
  if (touch) tile.touch = touch;
  // §26 standing instructions travel with the placement so the keeper can act on this surface alone
  if (settings && (settings.keepPresentation || settings.onEnd !== "none")) tile.presentation = { keepPresentation: settings.keepPresentation, onEnd: settings.onEnd };
  // §25 living previews: the placement's peek request reaches the orchestrator,
  // which already schedules peeks off `tile.preview` (concept-scenes §4).
  if (settings?.preview) tile.preview = { mode: "peek", interval: settings.preview.interval, playhead: settings.preview.playhead };
  // §5 audio-follows-tap: what a single tap on this placement means.
  if (settings?.tapAction) tile.tapAction = settings.tapAction;
  if (settings?.onActivate === "play") tile.onActivate = "play";
  // §26 imagery: naming a source for THIS placement turns intermission on for
  // it — the household asked for these pictures on this slot's ad breaks.
  if (settings?.intermission) {
    // naming a source turns intermission on for this placement; an ambient soundscape alone rides the App's own default
    const src = settings.intermission.source;
    tile.intermission = { ...(r?.intermission ?? {}), enabled: src ? true : (r?.intermission?.enabled ?? false), ...(src ? { source: src } : {}), ...(settings.intermission.ambient ? { ambient: settings.intermission.ambient } : {}) };
  }
  if (facet.refresh !== undefined) tile.refresh = facet.refresh;
  if (facet.zoom !== undefined) tile.zoom = facet.zoom;
  if (facet.focus) tile.focus = { ...facet.focus };
  const hint = facet.aspectHint ?? aspectHint;
  if (hint) tile.aspectHint = hint;
  return tile;
}

/**
 * The document a scene renders as, on the current renderer: one tile per
 * slot (assigned facet, or a placeholder), layout mode "fixed" carrying the
 * layout's normalized rects, floating and hidden facets as floating tiles.
 * Visualizations render as placeholders until the shell grows a
 * visualization surface (§32) — noted, not hidden.
 */
export function sceneDocument(m: SceneMaterials, dashId: string, canvas: CanvasSize, base?: DashboardDocument): { doc: DashboardDocument; notes: string[] } {
  const { scene, layout } = m;
  const notes: string[] = [];
  const tiles: TileSpec[] = [];
  const rects: Record<string, NormalizedRect> = {};
  const taken = new Set<string>();
  const uniq = (id: string) => { let out = id; for (let n = 2; taken.has(out); n++) out = `${id}-${n}`; taken.add(out); return out; };
  for (const slot of layout.slots) {
    rects[slot.id] = slot.rect;
    taken.add(slot.id);
    const parsed = parseSlotClass(slot.class);
    const aspectHint = parsed ? (ASPECT_BUCKETS.find((b) => b.id === parsed.aspect) ? bucketAspectHint(parsed.aspect as AspectBucket) : parsed.aspect) : undefined;
    const a = resolveAssignment(scene, slot.id, m.facets);
    if (a?.kind === "facet") {
      tiles.push(facetTile(slot.id, a.facet, lookup(m.apps, a.facet.app), assignmentSettings(scene, slot.id), aspectHint));
      continue;
    }
    if (a?.kind === "visualization") {
      // §32: a visualization surface; its source is the hidden facet's tile id (the facet id, uniq'd below in document order)
      tiles.push({ id: slot.id, visualization: { style: a.visualization.style, source: a.visualization.source, artwork: a.visualization.artwork, ...(a.visualization.spill ? { spill: true } : {}) }, audio: "mute", ...(aspectHint ? { aspectHint } : {}) });
      continue;
    }
    if (a?.kind === "missing") notes.push(`${slot.id}: assigned ${a.ref} is not a known facet`);
    tiles.push({ id: slot.id, placeholder: true, audio: "mute", ...(aspectHint ? { aspectHint } : {}), ...(slot.label ? { label: slot.label } : {}) });
  }
  for (const p of scene.floating) {
    if (!p.facet) {
      const viz = scene.visualizations?.find((v) => v.id === p.visualization);
      if (!viz) { notes.push(`floating visualization ${p.visualization ?? "?"}: not a visualization of this scene`); continue; }
      const fr = floatingRect(p, 16 / 9, canvas);
      tiles.push({ id: uniq(viz.id), kind: "floating", float: { x: fr.x, y: fr.y, w: fr.w, h: fr.h, face: "page" }, visualization: { style: viz.style, source: viz.source, artwork: viz.artwork, ...(viz.spill ? { spill: true } : {}) }, audio: "mute" });
      continue;
    }
    const facet = lookup(m.facets, p.facet);
    if (!facet) { notes.push(`floating ${p.facet}: not a known facet`); continue; }
    const ratio = slotClassRatio(facet.slotClass) ?? 16 / 9;
    const fr = floatingRect(p, ratio, canvas);
    const tile = facetTile(uniq(facet.id), facet, lookup(m.apps, facet.app), undefined);
    tile.kind = "floating";
    const float: FloatSpec = { x: fr.x, y: fr.y, w: fr.w, h: fr.h, face: p.face ?? "control" };
    tile.float = float;
    tiles.push(tile);
  }
  for (const h of scene.hidden) {
    const facet = lookup(m.facets, h.facet);
    if (!facet) { notes.push(`hidden ${h.facet}: not a known facet`); continue; }
    // A hidden placement carries settings too, keyed by its FACET id (it has no
    // slot to be keyed by). This was `undefined`, so a hidden source could not
    // carry ANY AssignmentSettings - including onActivate, which is exactly the
    // placement that needs it: Music Lounge's music source is hidden by section 32.
    const tile = facetTile(uniq(facet.id), facet, lookup(m.apps, facet.app), assignmentSettings(scene, h.facet));
    tile.kind = "floating";
    tile.float = { x: 0.62, y: 0.76, w: 0.36, h: 0.2, face: "control", hidden: true };
    tile.audio = h.audio;
    tiles.push(tile);
  }
  const doc: DashboardDocument = {
    ...(base ?? { schema: SCHEMA_VERSION, name: scene.name }),
    schema: SCHEMA_VERSION,
    id: dashId,
    name: scene.name,
    grid: { cols: 1, rows: 1, gap: base?.grid?.gap ?? 8 },
    layout: { mode: "fixed", rects },
    tiles,
    ...(scene.schedule ? { schedule: scene.schedule } : {}),
  };
  return { doc, notes };
}

/** The "W:H" hint the solver understands for a bucket. */
export function bucketAspectHint(bucket: AspectBucket): string {
  return bucket === "21:9-strip" ? "21:9" : bucket === "8:1-ticker" ? "8:1" : bucket;
}
