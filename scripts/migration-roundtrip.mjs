#!/usr/bin/env node
/**
 * Migration round-trip harness (scene-model-spec §7; CLAUDE.md: "round-trip
 * tested on a COPY of a real config"; dashboard-schema §10: never deletes).
 *
 * Takes a store.json, COPIES it into a temp dir (the source is opened
 * read-only; the live %LOCALAPPDATA%\Prism\store.json is refused outright),
 * runs SM-1's migration, and checks:
 *
 *   K1  §10: `writes` contains NEW keys only - none collides with a source key;
 *       the merged store (source + writes) keeps every source key byte-identical;
 *       the writes carry the model (scene-model:apps/facets/layouts/scenes parse to model.*)
 *   K2  every placed tile of every dashboard -> one App + one Facet: a report.inferred
 *       row names the tile; its facet exists; facet.url is the tile's url; facet.app is
 *       an App whose profileId is the tile's profile (tile.profile ?? tile.id) - a
 *       migration never re-homes a session
 *   K3  every dashboard -> one Layout (`<dash>-layout`: canvas class, normalized slots
 *       with a class each) + one Scene (`<dash>`, or `<dash>-solo-<tile>` per app for
 *       solo) referencing it; every wall tile with a solved rect is assigned; every
 *       floating tile has a floating (rect | anchor+size) or hidden placement
 *   K4  solved rects reproduce: each layout slot rect, scaled to the canvas, matches
 *       the rect the wall actually showed (store `host.boot`, boot rects re-expanded
 *       by the gap) within tolerance; without host.boot, against core's
 *       layoutDashboard at the persisted hero override
 *   K5  review report present: schema, canvas + its source, sourceKeys (every key the
 *       migration read), created counts matching the model, an inferred row per
 *       assigned facet, ambiguous[] (an array, possibly empty), lastPages for every
 *       tile:lasturl:* key (orphans flagged)
 *   K6  pure and deterministic: a second run on the same input produces identical writes
 *       (same `now`); a run on source+writes never writes over a SOURCE key (rewriting its
 *       own scene-model:* keys is allowed - the one-shot gate is SceneModelStore.migrate)
 *
 * SM-1's export (scene-model/sm1-model, packages/core/src/scene-migration.ts):
 *   migrateStore(input: {version,data} | Record<string,string>, options?: {canvas?, now?})
 *     -> { writes: Record<string,string>, report: MigrationReport, model: SceneModelBundle }
 *
 * Usage:
 *   node scripts/migration-roundtrip.mjs                       (default source below)
 *   node scripts/migration-roundtrip.mjs --store=<path> [--core=<packages/core dir>] [--module=<dist/scene-migration.js>]
 *   --tolerance=0.01   normalized-rect tolerance (default 1% of canvas)
 *   --json
 * Exit: 0 pass · 1 fail · 2 migration absent
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const asJson = args.includes("--json");
const tolerance = Number(opt("--tolerance", "0.01"));
const local = process.env.LOCALAPPDATA ?? "";
const DEFAULT_SOURCE = join(local, "Prism-backup-20260901-1624", "store.json");
const source = resolve(opt("--store", DEFAULT_SOURCE));
const core = opt("--core", join(root, "packages", "core"));
const modPath = opt("--module", join(core, "dist", "scene-migration.js"));

// never the live store
const live = resolve(join(local, "Prism", "store.json")).toLowerCase();
if (source.toLowerCase() === live) { console.log("migration round-trip: REFUSED - that is the live store. Point --store at a backup copy."); process.exit(1); }
if (!existsSync(source)) { console.log(`migration round-trip: source not found: ${source} (pass --store=<path to a backup store.json>)`); process.exit(2); }

// copy into a temp dir; only the copy is ever read from here on
const tmp = mkdtempSync(join(tmpdir(), "prism-migration-"));
const copy = join(tmp, "store.json");
copyFileSync(source, copy);
const input = JSON.parse(readFileSync(copy, "utf8"));
const inData = input.data ?? input;
const parse = (k) => { try { return JSON.parse(inData[k]); } catch { return null; } };

const dashboardKeys = Object.keys(inData).filter((k) => k === "dashboard" || k.startsWith("dashboard:"));
const dashboards = dashboardKeys.map((k) => ({ key: k, doc: parse(k) })).filter((d) => d.doc?.tiles);
const boot = parse("host.boot");
const inventory = {
  keys: Object.keys(inData).length,
  dashboards: dashboards.map((d) => ({ key: d.key, id: d.doc.id, tiles: d.doc.tiles.length, mode: d.doc.layout?.mode })),
  apps: parse("apps")?.length ?? 0,
  masterLayouts: parse("master-layouts")?.length ?? 0,
  scenesV0: parse("scenes")?.length ?? 0,
  shortcuts: Object.keys(inData).filter((k) => k.startsWith("shortcuts")).length,
  lastUrls: Object.keys(inData).filter((k) => k.startsWith("tile:lasturl:")).length,
  bootRects: Array.isArray(boot) ? boot.length : 0,
};

if (!existsSync(modPath)) {
  console.log(`migration round-trip: migration absent (${modPath.replace(root, ".")} - waiting on SM-1's migrateStore export)`);
  console.log(`  source copied to ${copy}`);
  console.log(`  inventory: ${JSON.stringify(inventory)}`);
  process.exit(2);
}

const mod = await import(pathToFileURL(modPath).href);
if (typeof mod.migrateStore !== "function") { console.log("migration round-trip: module present but does not export migrateStore(input, options)"); process.exit(1); }

const NOW = "2026-09-01T00:00:00.000Z";
let out;
try { out = mod.migrateStore(structuredClone(input), { now: NOW }); } catch (e) { console.log("migration round-trip: migrateStore threw: " + (e?.stack ?? e)); process.exit(1); }

const problems = [];
const notes = [];
const P = (m) => problems.push(m);
const writes = out?.writes ?? {};
const report = out?.report ?? {};
const model = out?.model ?? {};

// K1 ---------------------------------------------------------------------
for (const k of Object.keys(writes)) if (k in inData) P(`K1 write targets an existing source key: ${k}`);
const merged = { ...inData, ...writes };
for (const [k, v] of Object.entries(inData)) if (merged[k] !== v) P(`K1 source key altered in the merged store: ${k}`);
for (const [k, prop] of [["scene-model:apps", "apps"], ["scene-model:facets", "facets"], ["scene-model:layouts", "layouts"], ["scene-model:scenes", "scenes"]]) {
  if (!(k in writes)) { P(`K1 missing write ${k}`); continue; }
  try { if (JSON.stringify(JSON.parse(writes[k])) !== JSON.stringify(model[prop])) P(`K1 ${k} does not carry model.${prop}`); } catch { P(`K1 ${k} is not JSON`); }
}
if (!("scene-model:migration" in writes)) P("K1 missing write scene-model:migration (the report must persist)");
notes.push(`K1 ${Object.keys(inData).length} source keys untouched; ${Object.keys(writes).length} new keys written: ${Object.keys(writes).join(", ")}`);

// K2 / K3 -----------------------------------------------------------------
const apps = new Map((model.apps ?? []).map((a) => [a.id, a]));
const facets = new Map((model.facets ?? []).map((f) => [f.id, f]));
const layouts = new Map((model.layouts ?? []).map((l) => [l.id, l]));
const scenes = new Map((model.scenes ?? []).map((s) => [s.id, s]));
const inferred = report.inferred ?? [];

for (const { doc } of dashboards) {
  const solo = doc.layout?.mode === "solo";
  const wall = doc.tiles.filter((t) => t.kind !== "floating");
  const floats = doc.tiles.filter((t) => t.kind === "floating");
  const layout = layouts.get(`${doc.id}-layout`);
  if (!layout) { P(`K3 dashboard ${doc.id} has no Layout ${doc.id}-layout`); continue; }
  if (!(layout.canvas && layout.canvas.aspect && layout.canvas.resolution)) P(`K3 Layout ${layout.id} has no canvas class`);
  for (const s of layout.slots ?? []) {
    const r = s.rect ?? {};
    if (![r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && n >= -1e-9 && n <= 1 + 1e-9)) P(`K3 Layout ${layout.id} slot ${s.id} rect not normalized: ${JSON.stringify(r)}`);
    if (!s.class || !/·/.test(s.class)) P(`K3 Layout ${layout.id} slot ${s.id} has no aspect·tier class`);
  }
  const sceneList = solo ? wall.map((t) => scenes.get(`${doc.id}-solo-${t.id}`)) : [scenes.get(doc.id)];
  if (sceneList.some((s) => !s)) P(`K3 dashboard ${doc.id}: scene(s) missing (${solo ? "solo: one per app" : doc.id})`);
  for (const scene of sceneList.filter(Boolean)) if (scene.layout !== layout.id) P(`K3 Scene ${scene.id} references ${scene.layout}, expected ${layout.id}`);
  const scene = sceneList[0];
  const slotIds = new Set((layout.slots ?? []).map((s) => s.id));
  for (const t of wall) {
    if (t.placeholder) continue;
    const slotId = solo ? "solo" : t.id;
    if (!slotIds.has(slotId)) { notes.push(`K3 ${doc.id}/${t.id}: no slot (not placed by the layout)`); if (!(report.ambiguous ?? []).some((m) => m.includes(t.id))) P(`K3 ${doc.id}/${t.id} unplaced and not mentioned in report.ambiguous`); continue; }
    const sc = solo ? scenes.get(`${doc.id}-solo-${t.id}`) : scene;
    const fid = sc?.assign?.[slotId];
    if (!fid) { if (!t.url) { notes.push(`K3 ${doc.id}/${t.id}: launch-only tile left unassigned (expected)`); continue; } P(`K3 Scene ${sc?.id}: tile ${t.id} has no assignment in slot ${slotId}`); continue; }
    const row = inferred.find((r) => r.tile === t.id && r.dashboard === doc.id);
    if (!row) P(`K2/K5 no report.inferred row for tile ${t.id} (${doc.id})`);
    else if (row.facet !== fid) P(`K2 report.inferred says facet ${row.facet} for ${t.id}, scene assigns ${fid}`);
    const f = facets.get(fid);
    if (!f) { P(`K2 assigned facet ${fid} does not exist`); continue; }
    if (f.url !== t.url) P(`K2 facet ${f.id} url ${f.url} != tile url ${t.url}`);
    if (!/·/.test(f.slotClass ?? "")) P(`K2 facet ${f.id} has no slot class`);
    const app = apps.get(f.app);
    if (!app) { P(`K2 facet ${f.id} -> App ${f.app} does not exist`); continue; }
    const wantProfile = t.profile ?? t.id;
    if (app.profileId !== wantProfile) P(`K2 App ${app.id} profileId ${JSON.stringify(app.profileId)} != tile ${t.id}'s profile ${JSON.stringify(wantProfile)} (§10: never re-home a session)`);
    if (!app.baseUrl) P(`K2 App ${app.id} has no baseUrl`);
  }
  for (const t of floats) {
    const fl = (scene?.floating ?? []).find((p) => facets.get(p.facet)?.url === t.url) ?? null;
    const hd = (scene?.hidden ?? []).find((p) => facets.get(p.facet)?.url === t.url) ?? null;
    if (!fl && !hd) { if (!t.url) continue; P(`K3 Scene ${scene?.id}: floating tile ${t.id} has neither a floating nor a hidden placement`); continue; }
    if (fl && !fl.rect && !(fl.anchor && typeof fl.size === "number")) P(`K3 floating entry for ${t.id} has neither rect nor anchor+size`);
    if (t.float?.hidden && !hd) P(`K3 hidden floating tile ${t.id} did not become a hidden placement`);
  }

  // K4 -------------------------------------------------------------------
  let truth = null, W = 0, H = 0;
  if (Array.isArray(boot) && boot.length && !solo) {
    const minX = Math.min(...boot.map((b) => b.x)), minY = Math.min(...boot.map((b) => b.y));
    const gap = 2 * minX;   // insetRects shrinks each partition by gap/2 per side, so the first boot rect starts at gap/2
    W = Math.max(...boot.map((b) => b.x + b.w)) + minX;
    H = Math.max(...boot.map((b) => b.y + b.h)) + minY;
    truth = Object.fromEntries(boot.map((b) => [b.id, { x: (b.x - gap / 2) / W, y: (b.y - gap / 2) / H, w: (b.w + gap) / W, h: (b.h + gap) / H }]));
    notes.push(`K4 truth = host.boot rects (${boot.length}) at ${W.toFixed(0)}x${H.toFixed(0)}, gap ${gap}; migration canvas ${report.canvas?.w}x${report.canvas?.h} (${report.canvas?.source})`);
  } else if (!solo) {
    try {
      const c = await import(pathToFileURL(join(core, "dist", "index.js")).href);
      const win = parse("host.window") ?? { w: 1920, h: 1080 };
      W = win.w; H = win.h;
      const override = parse(`layout:${doc.id}`) ?? undefined;
      const rects = c.layoutDashboard(doc, { w: W, h: H }, override);
      truth = Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H }]));
      notes.push(`K4 truth = core layoutDashboard at ${W}x${H} with override ${JSON.stringify(override ?? null)}`);
    } catch (e) { P("K4 no host.boot and core dist unavailable: " + (e?.message ?? e)); }
  }
  if (truth) {
    for (const s of layout.slots ?? []) {
      const want = truth[s.id];
      if (!want) { notes.push(`K4 no truth rect for slot ${s.id}`); continue; }
      const r = s.rect;
      const d = Math.max(Math.abs(r.x - want.x), Math.abs(r.y - want.y), Math.abs(r.w - want.w), Math.abs(r.h - want.h));
      if (d > tolerance) P(`K4 slot ${s.id} rect off by ${(d * 100).toFixed(2)}% of canvas (> ${tolerance * 100}%): got ${JSON.stringify(r)} want ${JSON.stringify(want)}`);
      else notes.push(`K4 slot ${s.id} within ${(d * 100).toFixed(3)}% (${s.class})`);
    }
  }
}

// K5 ---------------------------------------------------------------------
if (report.schema !== "prism.scene-model-migration/v0.1") P(`K5 report.schema ${report.schema}`);
if (!report.canvas?.source) P("K5 report.canvas.source missing");
if (!Array.isArray(report.sourceKeys) || !report.sourceKeys.length) P("K5 report.sourceKeys missing");
else for (const k of ["dashboard", "host.boot", "apps"]) if (inData[k] && !report.sourceKeys.includes(k)) P(`K5 report.sourceKeys omits ${k}`);
if (!Array.isArray(report.ambiguous)) P("K5 report.ambiguous is not an array");
const created = report.created ?? {};
for (const [k, m] of [["apps", apps], ["facets", facets], ["layouts", layouts], ["scenes", scenes]]) if (created[k] !== m.size) P(`K5 report.created.${k} = ${created[k]} but model has ${m.size}`);
const assignedFacets = new Set([...scenes.values()].flatMap((s) => Object.values(s.assign ?? {})));
for (const fid of assignedFacets) if (!inferred.some((r) => r.facet === fid)) P(`K5 no inferred row for assigned facet ${fid}`);
for (const r of inferred) if (!r.class || !r.rect) P(`K5 inferred row for ${r.tile} lacks class/rect`);
const lastKeys = Object.keys(inData).filter((k) => k.startsWith("tile:lasturl:"));
if (!Array.isArray(report.lastPages)) P("K5 report.lastPages missing");
else {
  if (report.lastPages.length !== lastKeys.length) P(`K5 report.lastPages has ${report.lastPages.length} rows for ${lastKeys.length} tile:lasturl:* keys`);
  const tileIds = new Set(dashboards.flatMap((d) => d.doc.tiles.map((t) => t.id)));
  for (const lp of report.lastPages) if (lp.orphan !== !tileIds.has(lp.tile)) P(`K5 lastPages orphan flag wrong for ${lp.tile}`);
}

// K6 ---------------------------------------------------------------------
try {
  const again = mod.migrateStore(structuredClone(input), { now: NOW });
  if (JSON.stringify(again.writes) !== JSON.stringify(writes)) P("K6 second run produced different writes (not deterministic)");
  let rerun = null, threw = null;
  try { rerun = mod.migrateStore({ version: input.version ?? 1, data: merged }, { now: NOW }); } catch (e) { threw = e; }
  // §10 is about SOURCE keys: a re-run must never write over one. Rewriting its own scene-model:* keys is
  // allowed - the one-shot gate is upstream (SceneModelStore.migrate(canvas, force) answers "already-migrated").
  const sourceHits = threw ? [] : Object.keys(rerun?.writes ?? {}).filter((k) => k in inData);
  if (sourceHits.length) P(`K6 re-running on the migrated store would write over SOURCE key(s): ${sourceHits.join(", ")}`);
  const own = threw ? [] : Object.keys(rerun?.writes ?? {}).filter((k) => k in writes);
  notes.push(`K6 deterministic; re-run on the migrated store: ${threw ? "throws (" + String(threw.message ?? threw).slice(0, 90) + ")" : `${Object.keys(rerun?.writes ?? {}).length} write(s), 0 over source keys, ${own.length} over its own scene-model:* keys (a forced re-run rewrites the model; the one-shot gate is SceneModelStore.migrate)`}`);
} catch (e) { P("K6 " + (e?.message ?? e)); }

// persist the migrated copy + report beside the copy, for the human review
try { writeFileSync(join(tmp, "store.migrated.json"), JSON.stringify({ version: input.version ?? 1, data: merged }, null, 1)); writeFileSync(join(tmp, "migration-report.json"), JSON.stringify(report, null, 1)); } catch { }

const ok = problems.length === 0;
const summary = { apps: apps.size, facets: facets.size, layouts: layouts.size, scenes: scenes.size, ambiguous: (report.ambiguous ?? []).length };
if (asJson) { console.log(JSON.stringify({ ok, source, copy, inventory, summary, problems, notes, ambiguous: report.ambiguous }, null, 2)); process.exit(ok ? 0 : 1); }
console.log(`migration round-trip on a COPY of ${source}`);
console.log(`  copy: ${copy}  (store.migrated.json + migration-report.json written beside it)`);
console.log(`  source: ${JSON.stringify(inventory)}`);
console.log(`  migrated: ${apps.size} apps, ${facets.size} facets, ${layouts.size} layouts, ${scenes.size} scenes; ${(report.ambiguous ?? []).length} ambiguity note(s)`);
for (const a of report.ambiguous ?? []) console.log("  ambig " + a);
for (const n of notes) console.log("  note  " + n);
for (const p of problems) console.log("  FAIL  " + p);
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
