/**
 * The scene model's stores (docs/scene-model-spec.md §8): apps, facets,
 * layouts, scenes, the active scene — schema documents under their own keys
 * (`scene-model:*`), local only (§22). This service is what the runtime's
 * additive host calls talk to; it validates through the model's normalizers,
 * flags layout duplicates (never blocks), archives instead of deleting, and
 * materializes a scene for the wall. The pre-scene-model stores are never
 * read or written here: the two models coexist until the rename commit.
 */

import type { StoreDriver } from "./drivers.js";
import type { DashboardDocument } from "./types.js";
import {
  SCENE_TEMPLATES,
  archiveLayout,
  canvasClassOf,
  duplicateFlag,
  facetFitsSlot,
  instantiateTemplate,
  layoutDuplicates,
  normalizeApp,
  normalizeFacet,
  normalizeLayout,
  normalizeScene,
  pickableLayouts,
  resolveAssignment,
  sceneDocument,
  slotClassesInLayouts,
  type App,
  type CanvasSize,
  type Facet,
  type Layout,
  type LayoutDuplicate,
  type Scene,
  type SceneTemplate,
  type TemplateInstance,
} from "./scene-model.js";
import { SCENE_MODEL_KEYS, migrateStore, type MigrationReport } from "./scene-migration.js";

export interface SceneModelSnapshot {
  apps: App[];
  facets: Facet[];
  layouts: Layout[];
  scenes: Scene[];
  activeScene: string | null;
  /** Classes present in saved layouts with counts — the facet editor's list. */
  slotClasses: Array<{ class: string; layouts: number; custom: boolean }>;
  migrated: boolean;
}

export type SaveResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

export interface SceneModelStoreOptions {
  /** Every key the migration would read (the store's key→value map). Only needed for `migrate`. */
  readAll?: () => Record<string, string>;
}

export class SceneModelStore {
  private apps = new Map<string, App>();
  private facets = new Map<string, Facet>();
  private layouts = new Map<string, Layout>();
  private scenes = new Map<string, Scene>();
  private active: string | null = null;
  private migrated = false;
  private loaded = false;

  constructor(private store: StoreDriver | null, private options: SceneModelStoreOptions = {}) {}

  /** Read every store; unreadable state never breaks anything (§10 posture). */
  async load(): Promise<void> {
    this.loaded = true;
    if (!this.store) return;
    const list = async <T>(key: string, norm: (v: unknown) => T | null, into: Map<string, T & { id: string }>): Promise<void> => {
      try {
        const raw = await this.store!.get(key);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        for (const item of parsed) { const v = norm(item) as (T & { id: string }) | null; if (v && v.id) into.set(v.id, v); }
      } catch { /* §10 posture */ }
    };
    await list(SCENE_MODEL_KEYS.apps, normalizeApp, this.apps);
    await list(SCENE_MODEL_KEYS.facets, normalizeFacet, this.facets);
    await list(SCENE_MODEL_KEYS.layouts, normalizeLayout, this.layouts);
    await list(SCENE_MODEL_KEYS.scenes, normalizeScene, this.scenes);
    try {
      this.active = (await this.store.get(SCENE_MODEL_KEYS.activeScene)) || null;
      this.migrated = !!(await this.store.get(SCENE_MODEL_KEYS.migration));
    } catch { /* §10 posture */ }
  }

  isLoaded(): boolean { return this.loaded; }

  snapshot(): SceneModelSnapshot {
    return {
      apps: [...this.apps.values()],
      facets: [...this.facets.values()],
      layouts: [...this.layouts.values()],
      scenes: [...this.scenes.values()],
      activeScene: this.active,
      slotClasses: slotClassesInLayouts([...this.layouts.values()]),
      migrated: this.migrated,
    };
  }

  app(id: string): App | undefined { return this.apps.get(id); }
  facet(id: string): Facet | undefined { return this.facets.get(id); }
  layout(id: string): Layout | undefined { return this.layouts.get(id); }
  scene(id: string): Scene | undefined { return this.scenes.get(id); }
  activeScene(): string | null { return this.active; }
  templates(): readonly SceneTemplate[] { return SCENE_TEMPLATES; }

  /** Layouts a picker offers for this canvas (unarchived, matching class). */
  layoutsFor(canvas: CanvasSize): Layout[] {
    return pickableLayouts([...this.layouts.values()], canvasClassOf(canvas.w, canvas.h));
  }

  private persist(key: string, value: unknown): void {
    if (!this.store) return;
    try { void this.store.set(key, typeof value === "string" ? value : JSON.stringify(value)); } catch { /* non-fatal */ }
  }

  private nextId(prefix: string, taken: Map<string, unknown>): string {
    let n = 1;
    while (taken.has(`${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  }

  saveApp(input: unknown): SaveResult<App> {
    const app = normalizeApp(input);
    if (!app) return { ok: false, error: "invalid app (needs id and an http(s) baseUrl)" };
    const prev = this.apps.get(app.id);
    // §10: an app's profile is its session; a save never silently moves it
    const warnings: string[] = [];
    if (prev && prev.profileId !== app.profileId) warnings.push(`profile changed from "${prev.profileId}" to "${app.profileId}". The old profile folder is kept`);
    this.apps.set(app.id, app);
    this.persist(SCENE_MODEL_KEYS.apps, [...this.apps.values()]);
    return { ok: true, value: app, warnings };
  }

  saveFacet(input: unknown): SaveResult<Facet> {
    const facet = normalizeFacet(input);
    if (!facet) return { ok: false, error: "invalid facet (needs id, app, http(s) url, slotClass)" };
    const warnings: string[] = [];
    if (!this.apps.has(facet.app)) warnings.push(`app "${facet.app}" is not saved yet`);
    if (!facet.id) facet.id = this.nextId(`${facet.app}-facet`, this.facets);
    this.facets.set(facet.id, facet);
    this.persist(SCENE_MODEL_KEYS.facets, [...this.facets.values()]);
    return { ok: true, value: facet, warnings };
  }

  /** Remove a facet nothing references (a referenced one is refused - scenes keep working). */
  removeFacet(id: string): "ok" | "unknown" | "referenced" {
    if (!this.facets.has(id)) return "unknown";
    for (const s of this.scenes.values()) {
      if (Object.values(s.assign).includes(id) || s.floating.some((f) => f.facet === id) || s.hidden.some((h) => h.facet === id)) return "referenced";
    }
    this.facets.delete(id);
    this.persist(SCENE_MODEL_KEYS.facets, [...this.facets.values()]);
    return "ok";
  }

  /** Duplicate detection without saving — the save dialog's question. */
  duplicatesOf(input: unknown): LayoutDuplicate[] {
    const draft = normalizeLayout(input);
    return draft ? layoutDuplicates(draft, [...this.layouts.values()]) : [];
  }

  /** Upsert a layout; duplicates are FLAGGED in the result, never refused. */
  saveLayout(input: unknown): SaveResult<Layout & { duplicates: LayoutDuplicate[]; duplicateFlag: string | null }> {
    const layout = normalizeLayout(input);
    if (!layout) return { ok: false, error: "invalid layout (needs canvas or canvasSize and 1-24 slots with 0-1 rects)" };
    if (!layout.id) layout.id = this.nextId("layout", this.layouts);
    const duplicates = layoutDuplicates(layout, [...this.layouts.values()]);
    this.layouts.set(layout.id, layout);
    this.persist(SCENE_MODEL_KEYS.layouts, [...this.layouts.values()]);
    return { ok: true, value: { ...layout, duplicates, duplicateFlag: duplicateFlag(duplicates) }, warnings: duplicates.length ? [duplicateFlag(duplicates)!] : [] };
  }

  /** Archive hides from pickers; scenes referencing the layout keep working. There is no delete. */
  archiveLayout(id: string, archived = true): "ok" | "unknown" {
    const l = this.layouts.get(id);
    if (!l) return "unknown";
    this.layouts.set(id, archiveLayout(l, archived));
    this.persist(SCENE_MODEL_KEYS.layouts, [...this.layouts.values()]);
    return "ok";
  }

  /** Upsert a scene: the layout must exist; unknown or incompatible facets are warnings (placeholders render), not errors. */
  saveScene(input: unknown): SaveResult<Scene> {
    const scene = normalizeScene(input);
    if (!scene) return { ok: false, error: "invalid scene (needs layout)" };
    const layout = this.layouts.get(scene.layout);
    if (!layout) return { ok: false, error: `unknown layout "${scene.layout}"` };
    const warnings: string[] = [];
    for (const slot of layout.slots) {
      const a = resolveAssignment(scene, slot.id, this.facets);
      if (!a) continue;
      if (a.kind === "missing") warnings.push(`${slot.id}: "${a.ref}" is not a saved facet or a visualization of this scene`);
      else if (a.kind === "facet") {
        if (a.facet.music) { warnings.push(`${slot.id}: ${a.facet.id} is a music facet (hidden-only, §32); assign a visualization instead`); continue; }
        const fit = facetFitsSlot(a.facet.slotClass, slot.class);
        if (!fit.compatible) warnings.push(`${slot.id} (${slot.class}): facet ${a.facet.id} is cut for ${a.facet.slotClass}`);
        else if (fit.note) warnings.push(`${slot.id}: ${a.facet.id} ${fit.note === "stretch" ? "stretches" : "shrinks"} one tier`);
      }
    }
    for (const k of Object.keys(scene.assign)) if (!layout.slots.some((s) => s.id === k)) warnings.push(`assignment "${k}" names no slot of ${layout.id}`);
    for (const f of scene.floating) if (f.facet && !this.facets.has(f.facet)) warnings.push(`floating "${f.facet}" is not a saved facet`);
    for (const h of scene.hidden) if (!this.facets.has(h.facet)) warnings.push(`hidden "${h.facet}" is not a saved facet`);
    for (const v of scene.visualizations ?? []) if (!scene.hidden.some((h) => h.facet === v.source)) warnings.push(`visualization ${v.id}: source "${v.source}" is not a hidden facet of this scene (it idles dark)`);
    if (!scene.id) scene.id = this.nextId("scene", this.scenes);
    this.scenes.set(scene.id, scene);
    this.persist(SCENE_MODEL_KEYS.scenes, [...this.scenes.values()]);
    return { ok: true, value: scene, warnings };
  }

  removeScene(id: string): "ok" | "unknown" {
    if (!this.scenes.delete(id)) return "unknown";
    if (this.active === id) { this.active = null; this.persist(SCENE_MODEL_KEYS.activeScene, ""); }
    this.persist(SCENE_MODEL_KEYS.scenes, [...this.scenes.values()]);
    return "ok";
  }

  /** The document a scene renders as at a canvas (null when the scene or its layout is unknown). */
  materialize(sceneId: string, canvas: CanvasSize, dashId: string, base?: DashboardDocument): { doc: DashboardDocument; notes: string[] } | null {
    const scene = this.scenes.get(sceneId);
    const layout = scene && this.layouts.get(scene.layout);
    if (!scene || !layout) return null;
    return sceneDocument({ scene, layout, facets: this.facets, apps: this.apps }, dashId, canvas, base);
  }

  setActiveScene(id: string | null): void {
    this.active = id;
    this.persist(SCENE_MODEL_KEYS.activeScene, id ?? "");
  }

  /** Complete a template: saves the Layout and Scene it produces. Refused while any role is unresolved. */
  instantiateTemplate(templateId: string, canvas: CanvasSize, resolved: Record<string, string | undefined>, name?: string): SaveResult<TemplateInstance> {
    const t = SCENE_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return { ok: false, error: `unknown template "${templateId}"` };
    const layoutId = this.nextId(t.id, this.layouts), sceneId = this.nextId(t.id, this.scenes);
    const r = instantiateTemplate(t, canvas, resolved, { layoutId, sceneId, ...(name ? { name } : {}) });
    if ("error" in r) return { ok: false, error: `incomplete: unresolved roles ${r.unresolved.join(", ")}` };
    const warnings = [...r.notes];
    for (const [role, facetId] of Object.entries(resolved)) if (facetId && !this.facets.has(facetId)) warnings.push(`${role}: "${facetId}" is not a saved facet`);
    this.layouts.set(r.layout.id, r.layout);
    this.scenes.set(r.scene.id, r.scene);
    this.persist(SCENE_MODEL_KEYS.layouts, [...this.layouts.values()]);
    this.persist(SCENE_MODEL_KEYS.scenes, [...this.scenes.values()]);
    return { ok: true, value: r, warnings };
  }

  /**
   * The one-shot migration (spec §7), on an explicit call only. Writes new
   * keys exclusively (asserted inside `migrateStore`); refuses to run again
   * over an existing migration unless `force` (the human's post-migration
   * edits would be replaced - the source keys still are never touched).
   */
  migrate(canvas: CanvasSize | undefined, force = false): { status: "migrated" | "already-migrated" | "no-store"; report: MigrationReport | null } {
    if (!this.store || !this.options.readAll) return { status: "no-store", report: null };
    if (this.migrated && !force) return { status: "already-migrated", report: null };
    const data = this.options.readAll();
    const result = migrateStore(data, canvas ? { canvas } : {});
    for (const [k, v] of Object.entries(result.writes)) this.persist(k, v);
    this.apps = new Map(result.model.apps.map((a) => [a.id, a]));
    this.facets = new Map(result.model.facets.map((f) => [f.id, f]));
    this.layouts = new Map(result.model.layouts.map((l) => [l.id, l]));
    this.scenes = new Map(result.model.scenes.map((s) => [s.id, s]));
    this.active = result.model.activeScene;
    this.migrated = true;
    return { status: "migrated", report: result.report };
  }
}
