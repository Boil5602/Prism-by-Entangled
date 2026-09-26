/**
 * Migration to the scene model (docs/scene-model-spec.md §7).
 *
 * Existing configs map mechanically: every tile → one App + one Facet (slot
 * class inferred from the tile's SOLVED rect at the stored canvas size);
 * every dashboard → one Layout + one Scene; master layouts → Layouts; scenes
 * v0 → Scenes; shortcuts → Facets; floating / hidden tiles preserved as
 * scene-level placements. Runs once, on an explicit call.
 *
 * §10 posture, enforced by construction: this is a PURE function from the
 * store's key→value map to a set of NEW keys. It never deletes or rewrites a
 * source key (`assertWritesOnlyNewKeys` throws if it ever would), and it
 * writes a review report of every inference and every ambiguity for the
 * human to check. The old model keeps running from its own keys until the
 * rename commit.
 */

import type { AppRecord, DashboardDocument, FloatSpec, MasterLayout, Scene as SceneV0, Shortcut, TileSpec } from "./types.js";
import { parseAspectHint } from "./types.js";
import { hostSlug } from "./catalog.js";
import { clampHeroSize, layoutDashboard, type HeroOverride } from "./layout.js";
import { masterDocument, normalizeMasterLayout, normalizeScene as normalizeSceneV0 } from "./orchestrator.js";
import type { Rect, SolvedRects } from "./solver.js";
import {
  SCENE_MODEL_SCHEMA,
  canvasClassOf,
  classifyRect,
  formatSlotClass,
  nearestAspectBucket,
  normalizeRect,
  parseSlotClass,
  sizeTier,
  type App,
  type AppRenderDefaults,
  type AssignmentSettings,
  type CanvasSize,
  type Facet,
  type FloatAnchor,
  type FloatingPlacement,
  type HiddenPlacement,
  type Layout,
  type LayoutProvenance,
  type NormalizedRect,
  type Scene,
  type Slot,
} from "./scene-model.js";

/** SM-6: the pre-rename spelling of a wall slot's `tile.kind` (read as "slot" forever, never written). */
const PRE_RENAME_SLOT_KIND = "frame";
/** The new keys the migration writes — never any pre-existing key. */
export const SCENE_MODEL_KEYS = {
  apps: "scene-model:apps",
  facets: "scene-model:facets",
  layouts: "scene-model:layouts",
  scenes: "scene-model:scenes",
  activeScene: "scene-model:active-scene",
  migration: "scene-model:migration",
} as const;

export interface MigrationOptions {
  /** The canvas the dashboard was solved for (the window's client area). Inferred from `host.boot` when absent, else assumed 1920×1080. */
  canvas?: CanvasSize;
  /** ISO timestamp for the report (injectable for tests). */
  now?: string;
}

export interface InferredClass {
  facet: string;
  tile: string;
  dashboard: string;
  rect: NormalizedRect;
  class: string;
  /** |log(actual / bucket)| — how far the solved shape sat from its bucket. */
  deviation: number;
}

export interface MigrationReport {
  schema: "prism.scene-model-migration/v0.1";
  at: string;
  canvas: { w: number; h: number; source: "given" | "inferred:host.boot" | "assumed" };
  /** Source keys read (never written). */
  sourceKeys: string[];
  created: { apps: number; facets: number; layouts: number; scenes: number };
  inferred: InferredClass[];
  /** Human-readable notes: anything the migration had to decide or could not carry. */
  ambiguous: string[];
  /** Per tile, the last page the old model resumed on (tile:lasturl:*) — kept as data, not migrated into facets. */
  lastPages: Array<{ dashboard: string; tile: string; url: string; orphan: boolean }>;
  writes: string[];
}

export interface SceneModelBundle {
  schema: typeof SCENE_MODEL_SCHEMA;
  apps: App[];
  facets: Facet[];
  layouts: Layout[];
  scenes: Scene[];
  activeScene: string | null;
}

export interface MigrationResult {
  /** New keys only. */
  writes: Record<string, string>;
  report: MigrationReport;
  model: SceneModelBundle;
}

/** Accepts the store file's wrapper ({version, data}) or the bare key→value map. */
export function storeData(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const m = input as Record<string, unknown>;
  const data = m.data && typeof m.data === "object" && !Array.isArray(m.data) && typeof m.version === "number" ? (m.data as Record<string, unknown>) : m;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (typeof v === "string") out[k] = v;
  return out;
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** The same app key the old orchestrator uses: adapter id, else the site's host slug, else the tile id. */
export function appKeyOf(t: TileSpec): string {
  if (t.adapter) return t.adapter;
  const host = t.url ? hostnameOf(t.url) : "";
  return host ? hostSlug(host) : t.id;
}

function prettyName(id: string): string {
  return id.split(/[-_]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

function renderDefaults(t: TileSpec): AppRenderDefaults | undefined {
  const r: AppRenderDefaults = {};
  if (t.viewport !== undefined) r.viewport = t.viewport;
  if (t.uaPlatform !== undefined) r.uaPlatform = t.uaPlatform;
  if (t.intermission !== undefined) r.intermission = { ...t.intermission };
  if (t.veil !== undefined) r.veil = { ...t.veil };
  if (t.blocking !== undefined) r.blocking = t.blocking;
  if (t.persist !== undefined) r.persist = t.persist;
  if (t.audio !== undefined) r.audio = t.audio;
  return Object.keys(r).length ? r : undefined;
}

/** Canvas from the host's boot snapshot: rects are inset by gap/2 on every side, so min offset + max extent recovers the size. */
export function inferCanvasFromBoot(raw: string | undefined): CanvasSize | null {
  const boot = parseJson<Array<{ x: number; y: number; w: number; h: number }>>(raw);
  if (!Array.isArray(boot) || !boot.length) return null;
  const nums = boot.filter((b) => [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n)));
  if (!nums.length) return null;
  const minX = Math.min(...nums.map((b) => b.x)), minY = Math.min(...nums.map((b) => b.y));
  const w = Math.max(...nums.map((b) => b.x + b.w)) + minX;
  const h = Math.max(...nums.map((b) => b.y + b.h)) + minY;
  return w > 0 && h > 0 ? { w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000 } : null;
}

function nearestCorner(f: FloatSpec): FloatAnchor {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  return `${cy < 0.5 ? "top" : "bottom"}-${cx < 0.5 ? "left" : "right"}` as FloatAnchor;
}

class Builder {
  apps = new Map<string, App>();
  facets = new Map<string, Facet>();
  layouts = new Map<string, Layout>();
  scenes = new Map<string, Scene>();
  inferred: InferredClass[] = [];
  ambiguous: string[] = [];
  /** Registry names by app key (from the `apps` store). */
  private names = new Map<string, string>();

  constructor(private canvas: CanvasSize) {}

  /** An App from a tile; a tile whose profile differs from the app's is a second App (v1: one profile per App). */
  appFor(t: TileSpec, name?: string): App | null {
    if (!t.url) return null;
    const key = appKeyOf(t);
    const profile = t.profile ?? t.id;
    const existing = this.apps.get(key);
    if (existing && existing.profileId === profile) return existing;
    let id = key;
    if (existing) {
      id = `${key}-${profile}`;
      const alt = this.apps.get(id);
      if (alt) return alt;
      this.ambiguous.push(`app ${key}: tile ${t.id} uses profile "${profile}" (app profile is "${existing.profileId}") → separate App "${id}"; merge by hand if they are one account`);
    }
    const app: App = {
      id,
      name: name ?? this.names.get(key) ?? prettyName(key),
      baseUrl: t.url,
      profileId: profile,
      setup: { status: "unknown" },
    };
    if (t.adapter) { app.adapter = t.adapter; app.catalogRef = t.adapter; }
    const render = renderDefaults(t);
    if (render) app.render = render;
    if (t.launch) app.launch = { ...t.launch };
    this.apps.set(id, app);
    return app;
  }

  registerNames(records: AppRecord[]): void {
    for (const r of records) if (r?.id && r.name) this.names.set(r.id, r.name);
  }

  facetId(base: string, cls: string): string {
    const slug = cls.replace(":", "x").replace("·", "-").replace(/[^A-Za-z0-9-]+/g, "");
    let id = `${base}-${slug}`;
    for (let n = 2; this.facets.has(id); n++) id = `${base}-${slug}-${n}`;
    return id;
  }

  /** A Facet from a tile cut for a class; identical faces (same app, url, focus, zoom, class) are one facet. */
  facetFor(t: TileSpec, app: App, cls: string, label?: string): Facet {
    const url = t.url!;
    const same = [...this.facets.values()].find((f) => f.app === app.id && f.url === url && f.slotClass === cls
      && JSON.stringify(f.focus ?? null) === JSON.stringify(t.focus ?? null) && (f.zoom ?? 1) === (t.zoom ?? 1));
    if (same) return same;
    const facet: Facet = { id: this.facetId(t.id, cls), app: app.id, url, slotClass: cls, label: label ?? app.name };
    if (t.focus) facet.focus = { ...t.focus };
    if (t.zoom !== undefined && t.zoom !== 1) facet.zoom = t.zoom;
    if (t.audio !== undefined && t.audio !== app.render?.audio) facet.audio = t.audio;
    if (t.touch !== undefined) facet.touch = t.touch;
    if (t.refresh !== undefined) facet.refresh = t.refresh;
    if (t.aspectHint !== undefined) facet.aspectHint = t.aspectHint;
    this.facets.set(facet.id, facet);
    return facet;
  }

  classOf(rect: Rect): { cls: string; norm: NormalizedRect; deviation: number } {
    const norm = normalizeRect(rect, this.canvas);
    const ratio = rect.w / rect.h;
    const { deviation } = nearestAspectBucket(ratio);
    return { cls: formatSlotClass(classifyRect(norm, this.canvas)), norm, deviation };
  }

  provenance(doc: DashboardDocument, override: HeroOverride): LayoutProvenance {
    const l = doc.layout;
    if (l?.mode === "hero") return { mode: "hero", hero: override.hero ?? l.hero, heroSize: clampHeroSize(override.heroSize ?? l.heroSize), satellites: l.satellites };
    if (l?.mode === "grid" || !l) return { mode: "grid", cols: doc.grid?.cols ?? 1, rows: doc.grid?.rows ?? 1 };
    return { mode: "drawn" };
  }

  placementFor(t: TileSpec, app: App): { floating?: FloatingPlacement; hidden?: HiddenPlacement } {
    const f = t.float ?? { x: 0.62, y: 0.76, w: 0.36, h: 0.2 };
    const bucket = nearestAspectBucket(f.w * this.canvas.w / (f.h * this.canvas.h)).bucket;
    const cls = formatSlotClass({ aspect: bucket, tier: sizeTier(f.w * f.h) });
    const facet = this.facetFor(t, app, cls);
    if (f.hidden) return { hidden: { facet: facet.id, audio: t.audio ?? "exclusive" } };
    const p: FloatingPlacement = { facet: facet.id, anchor: nearestCorner(f), size: f.w, rect: { x: f.x, y: f.y, w: f.w, h: f.h } };
    if (f.face) p.face = f.face;
    return { floating: p };
  }

  /** A dashboard document → Layout + Scene (+ Apps + Facets for its tiles). */
  dashboard(doc: DashboardDocument, override: HeroOverride): Scene[] {
    const dashId = doc.id;
    // SM-6 read-alias: `kind: "frame"` is the pre-rename spelling of "slot"; the tile migrates as a wall slot and the human sees it in the report (the source document is never rewritten).
    for (const t of doc.tiles) if ((t.kind as unknown) === PRE_RENAME_SLOT_KIND) this.ambiguous.push(`${dashId}/${t.id}: tile kind ${JSON.stringify(PRE_RENAME_SLOT_KIND)} is the pre-rename spelling - read as "slot" (SM-6 alias); the stored document is left as is`);
    const solo = doc.layout?.mode === "solo";
    const wall = doc.tiles.filter((t) => t.kind !== "floating");
    const floats = doc.tiles.filter((t) => t.kind === "floating");
    const rects: SolvedRects = solo
      ? { solo: { x: 0, y: 0, w: this.canvas.w, h: this.canvas.h } }
      : layoutDashboard(doc, this.canvas, override);
    const layoutId = `${dashId}-layout`;
    const slots: Slot[] = [];
    const classes = new Map<string, string>();
    for (const [id, rect] of Object.entries(rects)) {
      const { cls, norm } = this.classOf(rect);
      slots.push({ id, rect: norm, class: cls });
      classes.set(id, cls);
    }
    const layout: Layout = { id: layoutId, name: solo ? `${doc.name} (solo)` : doc.name, canvas: canvasClassOf(this.canvas.w, this.canvas.h), slots, source: this.provenance(doc, override) };
    this.layouts.set(layoutId, layout);

    const floating: FloatingPlacement[] = [];
    const hidden: HiddenPlacement[] = [];
    for (const t of floats) {
      const app = this.appFor(t);
      if (!app) { this.ambiguous.push(`${dashId}/${t.id}: floating tile without a page (launch-only or placeholder) not carried`); continue; }
      const p = this.placementFor(t, app);
      if (p.floating) floating.push(p.floating);
      if (p.hidden) hidden.push(p.hidden);
    }

    const assignFor = (t: TileSpec, slotId: string): string | null => {
      if (t.placeholder) return null;
      const cls = classes.get(slotId);
      if (!cls) { this.ambiguous.push(`${dashId}/${t.id}: no solved rect (grid tile without an area?) — slot skipped`); return null; }
      const app = this.appFor(t);
      if (!app) { this.ambiguous.push(`${dashId}/${t.id}: native launch tile has no web face; slot left unassigned`); return null; }
      const facet = this.facetFor(t, app, cls);
      const slot = slots.find((s) => s.id === slotId)!;
      this.inferred.push({ facet: facet.id, tile: t.id, dashboard: dashId, rect: slot.rect, class: cls, deviation: Math.round(this.classOf({ x: 0, y: 0, w: slot.rect.w * this.canvas.w, h: slot.rect.h * this.canvas.h }).deviation * 1000) / 1000 });
      return facet.id;
    };

    if (solo) {
      const out: Scene[] = [];
      this.ambiguous.push(`${dashId}: solo layout → one full-canvas Layout and one Scene per app (${wall.length}); ◀ ▶ becomes a carousel of scenes`);
      for (const t of wall) {
        const f = assignFor(t, "solo");
        const scene: Scene = { id: `${dashId}-solo-${t.id}`, name: `${doc.name} · ${t.id}`, layout: layoutId, assign: f ? { solo: f } : {}, floating, hidden, schedule: doc.schedule ?? null };
        this.scenes.set(scene.id, scene);
        out.push(scene);
      }
      return out;
    }
    const assign: Record<string, string> = {};
    for (const t of wall) {
      if (!rects[t.id]) { if (!t.placeholder) this.ambiguous.push(`${dashId}/${t.id}: not placed by the layout — dropped`); continue; }
      const f = assignFor(t, t.id);
      if (f) assign[t.id] = f;
    }
    const scene: Scene = { id: dashId, name: doc.name, layout: layoutId, assign, floating, hidden, schedule: doc.schedule ?? null };
    this.scenes.set(scene.id, scene);
    return [scene];
  }

  /** A master layout (app-less slots) → Layout; its floating slots are scene-level and are noted. */
  masterLayout(ml: MasterLayout): Layout {
    const doc = masterDocument(ml, "preview", []);
    const rects = layoutDashboard(doc, this.canvas);
    const slots: Slot[] = [];
    for (const [id, rect] of Object.entries(rects)) slots.push({ id, rect: this.classOf(rect).norm, class: this.classOf(rect).cls });
    const floatingSlots = ml.slots.filter((s) => s.kind === "floating");
    if (floatingSlots.length) this.ambiguous.push(`master layout ${ml.id}: ${floatingSlots.length} floating slot(s) are scene-level in the new model — carried into scenes that assign them, not into the Layout`);
    const id = `ml-${ml.id}`;
    const layout: Layout = {
      id, name: ml.label, canvas: canvasClassOf(this.canvas.w, this.canvas.h), slots,
      source: ml.mode === "hero" ? { mode: "hero", hero: ml.slots.find((s) => s.hero)?.id ?? ml.slots.find((s) => s.kind !== "floating")?.id ?? "", heroSize: clampHeroSize(ml.heroSize ?? 0.62), satellites: "auto" } : { mode: "grid", cols: ml.cols ?? 2, rows: ml.rows ?? 2 },
    };
    this.layouts.set(id, layout);
    return layout;
  }

  /** A scene v0 ({app, view} per slot) → Scene over the migrated master layout. */
  sceneV0(s: SceneV0, ml: MasterLayout, registry: Map<string, AppRecord>, shortcuts: Map<string, Shortcut[]>): Scene | null {
    const layout = this.layouts.get(`ml-${ml.id}`);
    if (!layout) return null;
    const assign: Record<string, string> = {};
    const floating: FloatingPlacement[] = [];
    for (const slot of ml.slots) {
      const asg = s.slots[slot.id];
      if (!asg) continue;
      const rec = registry.get(asg.app);
      if (!rec) { this.ambiguous.push(`scene ${s.id}/${slot.id}: app "${asg.app}" is not in the registry — left unassigned`); continue; }
      const view = asg.view ? (shortcuts.get(asg.app) ?? []).find((v) => v.id === asg.view) : undefined;
      if (asg.view && !view) this.ambiguous.push(`scene ${s.id}/${slot.id}: view "${asg.view}" of ${asg.app} not found — using the app's home page`);
      const tile: TileSpec = { ...rec.tile, id: rec.id, profile: rec.tile.profile ?? rec.id };
      if (view) { tile.url = view.url; if (view.focus) tile.focus = view.focus; else delete tile.focus; }
      const app = this.appFor(tile, rec.name);
      if (!app) continue;
      if (slot.kind === "floating") {
        const f = { ...(slot.float ?? { x: 0.62, y: 0.76, w: 0.36, h: 0.2 }) };
        const p = this.placementFor({ ...tile, float: f, kind: "floating" }, app);
        if (p.floating) floating.push(p.floating);
        continue;
      }
      const cls = layout.slots.find((x) => x.id === slot.id)?.class;
      if (!cls) continue;
      assign[slot.id] = this.facetFor(tile, app, cls, view ? `${app.name} · ${view.label}` : undefined).id;
    }
    const scene: Scene = { id: `v0-${s.id}`, name: s.label, layout: layout.id, assign, floating, hidden: [], schedule: null };
    this.scenes.set(scene.id, scene);
    return scene;
  }

  /** A shortcut (named place on an app) → Facet; tier inferred from the largest migrated slot of that aspect, else L. */
  shortcut(appKey: string, sc: Shortcut, registry: Map<string, AppRecord>): void {
    const rec = registry.get(appKey);
    const base: TileSpec = rec ? { ...rec.tile, id: rec.id, profile: rec.tile.profile ?? rec.id } : { id: appKey, url: sc.url, profile: appKey };
    const tile: TileSpec = { ...base, url: sc.url };
    if (sc.focus) tile.focus = sc.focus; else delete tile.focus;
    const app = this.appFor(tile, rec?.name);
    if (!app) return;
    const ratio = (sc.aspectHint ? parseAspectHint(sc.aspectHint) : null) ?? (base.aspectHint ? parseAspectHint(base.aspectHint) : null) ?? 16 / 9;
    const bucket = nearestAspectBucket(ratio).bucket;
    let tier: string | null = null;
    let area = 0;
    for (const l of this.layouts.values()) for (const s of l.slots) {
      const p = parseSlotClass(s.class);
      if (p?.aspect === bucket && s.rect.w * s.rect.h > area) { area = s.rect.w * s.rect.h; tier = p.tier; }
    }
    const cls = `${bucket}·${tier ?? "L"}`;
    if (!tier) this.ambiguous.push(`shortcut ${appKey}/${sc.id}: no migrated slot of aspect ${bucket} — facet cut for ${cls} (tier assumed)`);
    else this.ambiguous.push(`shortcut ${appKey}/${sc.id}: facet cut for ${cls} (tier inferred from the largest ${bucket} slot)`);
    this.facetFor(tile, app, cls, `${app.name} · ${sc.label}`);
  }
}

/** Throws if any write targets a key that already exists — the §10 guarantee as an assertion. */
export function assertWritesOnlyNewKeys(data: Record<string, string>, writes: Record<string, string>): void {
  const clobber = Object.keys(writes).filter((k) => k in data);
  if (clobber.length) throw new Error("migration must never rewrite existing keys: " + clobber.join(", "));
}

/**
 * The migration. `data` is the store's key→value map (or the store file
 * object). Output: new keys only, the model, and the review report.
 */
export function migrateStore(input: unknown, options: MigrationOptions = {}): MigrationResult {
  const data = storeData(input);
  const sourceKeys: string[] = [];
  const read = (k: string): string | undefined => { if (k in data) sourceKeys.push(k); return data[k]; };

  let canvas: MigrationReport["canvas"];
  if (options.canvas) canvas = { ...options.canvas, source: "given" };
  else {
    const inferred = inferCanvasFromBoot(read("host.boot"));
    canvas = inferred ? { ...inferred, source: "inferred:host.boot" } : { w: 1920, h: 1080, source: "assumed" };
  }
  const b = new Builder({ w: canvas.w, h: canvas.h });
  if (canvas.source === "assumed") b.ambiguous.push("canvas size unknown (no host.boot): classes inferred at 1920×1080");

  // the registry: names, base pages, profiles
  const registryRaw = parseJson<AppRecord[]>(read("apps"));
  const registry = new Map<string, AppRecord>();
  if (Array.isArray(registryRaw)) for (const r of registryRaw) if (r && typeof r.id === "string" && r.tile && typeof r.tile === "object") registry.set(r.id, r);
  b.registerNames([...registry.values()]);

  // the dashboard(s): one Layout + one Scene each
  const doc = parseJson<DashboardDocument>(read("dashboard"));
  const docs: DashboardDocument[] = doc && Array.isArray(doc.tiles) ? [doc] : [];
  if (!docs.length) b.ambiguous.push("no `dashboard` document in the store — only the registry, master layouts, scenes and shortcuts migrate");
  const sceneByDash = new Map<string, string>();
  for (const d of docs) {
    const override = parseJson<HeroOverride>(read(`layout:${d.id}`)) ?? {};
    const scenes = b.dashboard(d, override);
    if (scenes[0]) sceneByDash.set(d.id, scenes[0].id);
  }

  // master layouts → Layouts
  const mls = (parseJson<unknown[]>(read("masterlayouts")) ?? []).map((m) => normalizeMasterLayout(m)).filter((m): m is MasterLayout => !!m && !!m.id);
  for (const ml of mls) b.masterLayout(ml);

  // shortcuts (per app) → Facets; scenes v0 → Scenes (shortcut keys are discovered from the store, not guessed)
  const shortcuts = new Map<string, Shortcut[]>();
  for (const key of Object.keys(data)) {
    if (!key.startsWith("shortcuts:")) continue;
    const list = parseJson<Shortcut[]>(read(key));
    if (Array.isArray(list)) shortcuts.set(key.slice("shortcuts:".length), list.filter((s) => s && typeof s.id === "string" && typeof s.url === "string"));
  }
  const v0 = (parseJson<unknown[]>(read("scenes")) ?? []).map((s) => normalizeSceneV0(s)).filter((s): s is SceneV0 => !!s && !!s.id);
  const v0Map = new Map<string, string>();
  for (const s of v0) {
    const ml = mls.find((m) => m.id === s.layoutId);
    if (!ml) { b.ambiguous.push(`scene ${s.id}: layout "${s.layoutId}" is not a saved master layout — skipped`); continue; }
    const scene = b.sceneV0(s, ml, registry, shortcuts);
    if (scene) v0Map.set(s.id, scene.id);
  }
  for (const [appKey, list] of shortcuts) for (const sc of list) b.shortcut(appKey, sc, registry);

  // every app the registry knows and nothing above created (apps not on any wall)
  for (const r of registry.values()) if (r.tile.url) b.appFor({ ...r.tile, id: r.id, profile: r.tile.profile ?? r.id }, r.name);

  // last pages: data for the report, never rewritten into facets (B-2 is a policy question)
  const lastPages: MigrationReport["lastPages"] = [];
  const tileIds = new Set(docs.flatMap((d) => d.tiles.map((t) => `${d.id}:${t.id}`)));
  for (const key of Object.keys(data)) {
    const m = /^tile:lasturl:([^:]+):(.+)$/.exec(key);
    if (!m) continue;
    const url = read(key)!;
    lastPages.push({ dashboard: m[1]!, tile: m[2]!, url, orphan: !tileIds.has(`${m[1]}:${m[2]}`) });
  }
  for (const p of lastPages.filter((p) => p.orphan)) b.ambiguous.push(`tile:lasturl:${p.dashboard}:${p.tile}: tile no longer on the dashboard (last page ${p.url}) — data kept, nothing created`);

  const current = read("scene:current");
  const activeScene = (current && v0Map.get(current)) ?? (docs[0] ? sceneByDash.get(docs[0].id) ?? null : null);

  const model: SceneModelBundle = {
    schema: SCENE_MODEL_SCHEMA,
    apps: [...b.apps.values()],
    facets: [...b.facets.values()],
    layouts: [...b.layouts.values()],
    scenes: [...b.scenes.values()],
    activeScene,
  };
  const report: MigrationReport = {
    schema: "prism.scene-model-migration/v0.1",
    at: options.now ?? new Date().toISOString(),
    canvas,
    sourceKeys: [...new Set(sourceKeys)].sort(),
    created: { apps: model.apps.length, facets: model.facets.length, layouts: model.layouts.length, scenes: model.scenes.length },
    inferred: b.inferred,
    ambiguous: b.ambiguous,
    lastPages,
    writes: [],
  };
  const writes: Record<string, string> = {
    [SCENE_MODEL_KEYS.apps]: JSON.stringify(model.apps),
    [SCENE_MODEL_KEYS.facets]: JSON.stringify(model.facets),
    [SCENE_MODEL_KEYS.layouts]: JSON.stringify(model.layouts),
    [SCENE_MODEL_KEYS.scenes]: JSON.stringify(model.scenes),
    [SCENE_MODEL_KEYS.activeScene]: activeScene ?? "",
  };
  report.writes = [...Object.keys(writes), SCENE_MODEL_KEYS.migration];
  writes[SCENE_MODEL_KEYS.migration] = JSON.stringify(report);
  assertWritesOnlyNewKeys(Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("scene-model:"))), writes);
  return { writes, report, model };
}

/** Default settings a migrated placement carries: none — standing instructions are the human's to set. */
export const MIGRATED_ASSIGNMENT_SETTINGS: Readonly<AssignmentSettings> = { keepPresentation: false, onEnd: "none" };
