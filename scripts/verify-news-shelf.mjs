#!/usr/bin/env node
/**
 * News-shelf reproducibility (dashboard-schema §31 "News defaults", normative):
 *
 *   "the news picker's default shelf is DERIVED, not curated: sources meeting
 *    a stated criterion on a named public dataset - v1: rated 'generally
 *    reliable' on Wikipedia's Perennial Sources list (CC BY-SA) - with that
 *    attribution displayed in the picker and each entry linking to its rating
 *    rationale ... Entangled adds and removes nothing by hand."
 *
 * The committed shelf must be a pure function of the committed dataset
 * snapshot + criterion. This script regenerates it through core's own builder
 * and diffs - an independent check from tests/news-shelf.test.ts (which does
 * the same in vitest), so the gate catches it even if that test is edited.
 *
 * Files (SM-1's names, packages/core):
 *   data/perennial-sources.<revision>.json   the dataset snapshot (list's real columns, revision, retrieved, license)
 *   data/news-shelf-criterion.json           the rule, as data
 *   dist/news-shelf.js                       buildNewsShelf(snapshot, criterion) -> NewsShelf   (pure)
 *   dist/news-shelf.data.js                  NEWS_SHELF (shipped, generated) + NEWS_SHELF_SNAPSHOT_FILE
 * Run the dist build first (scripts/verify.mjs does).
 *
 * Checks:
 *   N1  buildNewsShelf(snapshot named by NEWS_SHELF_SNAPSHOT_FILE, criterion) deep-equals NEWS_SHELF
 *   N2  NEWS_SHELF_SNAPSHOT_FILE is the NEWEST snapshot in data/ (a fresher snapshot without a regen is drift)
 *   N3  the attribution renders: the shelf's attributionLine states the criterion
 *       ("sources rated generally reliable on Wikipedia's Perennial Sources", quotes/case-insensitive)
 *       AND every entry's own attribution names the dataset, the rating "Generally reliable", the CC BY-SA license
 *   N4  every entry links its rating rationale: attribution.ratingUrl = <list page url>#<row anchor>
 *   N5  no hand additions / removals: every entry traces to a snapshot row with status exactly ["gr"] and not
 *       blacklisted; every such row with a usable domain is on the shelf
 *   N6  the snapshot names dataset url, license, revision, retrieved; the shelf's derivedFrom repeats them
 *
 * Exit: 0 pass · 1 fail · 2 builder/data absent
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreArg = process.argv.find((a) => a.startsWith("--core="))?.slice("--core=".length);
const core = coreArg ?? join(root, "packages", "core");   // --core=<dir> to check another checkout of packages/core (a branch under review)
const dataDir = join(core, "data");
const builderPath = join(core, "dist", "news-shelf.js");
const shippedPath = join(core, "dist", "news-shelf.data.js");
const criterionPath = join(dataDir, "news-shelf-criterion.json");
const asJson = process.argv.includes("--json");

const snapshots = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => /^perennial-sources\.\d+\.json$/.test(f)).sort((a, b) => Number(/\.(\d+)\./.exec(a)[1]) - Number(/\.(\d+)\./.exec(b)[1])) : [];
const missing = [["builder", builderPath], ["shipped shelf", shippedPath], ["criterion", criterionPath]].filter(([, p]) => !existsSync(p)).map(([k, p]) => `${k} (${p.replace(root, ".")})`);
if (!snapshots.length) missing.push("snapshot (packages/core/data/perennial-sources.<revision>.json)");
if (missing.length) {
  console.log(`news shelf: absent - ${missing.join(", ")} - waiting on SM-1's derived-shelf builder + dataset snapshot`);
  process.exit(2);
}

const { buildNewsShelf } = await import(pathToFileURL(builderPath).href);
const { NEWS_SHELF: shipped, NEWS_SHELF_SNAPSHOT_FILE: snapFile } = await import(pathToFileURL(shippedPath).href);
const problems = [];
const P = (m) => problems.push(m);
if (typeof buildNewsShelf !== "function") { console.log("news shelf: dist/news-shelf.js does not export buildNewsShelf"); process.exit(1); }
if (!shipped || !snapFile) { console.log("news shelf: dist/news-shelf.data.js does not export NEWS_SHELF + NEWS_SHELF_SNAPSHOT_FILE"); process.exit(1); }

const criterion = JSON.parse(readFileSync(criterionPath, "utf8"));
if (!existsSync(join(dataDir, snapFile))) { console.log(`news shelf: shipped shelf names snapshot ${snapFile}, which is not in data/`); process.exit(1); }
const snapshot = JSON.parse(readFileSync(join(dataDir, snapFile), "utf8"));

// N1
let regen;
try { regen = buildNewsShelf(structuredClone(snapshot), structuredClone(criterion)); } catch (e) { P("N1 builder threw: " + (e?.message ?? e)); }
if (regen && !isDeepStrictEqual(regen, shipped)) {
  const a = JSON.stringify(regen, null, 1).split("\n"), b = JSON.stringify(shipped, null, 1).split("\n");
  const i = a.findIndex((l, k) => l !== b[k]);
  P(`N1 regenerated shelf differs from the shipped one (first difference at line ${i + 1}: regen ${JSON.stringify(a[i])} vs shipped ${JSON.stringify(b[i])}) - run node scripts/regen-news-shelf.mjs and commit; never hand-edit`);
}

// N2
const newest = snapshots[snapshots.length - 1];
if (snapFile !== newest) P(`N2 shipped shelf derives from ${snapFile} but the newest snapshot in data/ is ${newest} - regen (or remove the stray snapshot)`);

// N3
const norm = (s) => String(s ?? "").toLowerCase().replace(/["“”']/g, "").replace(/\s+/g, " ");
const PHRASE = "sources rated generally reliable on wikipedia's perennial sources".replace(/'/g, "");
if (!norm(shipped.attributionLine).includes(PHRASE)) P(`N3 attributionLine does not state the criterion (${JSON.stringify(shipped.attributionLine)})`);
if (!/CC BY-SA/.test(shipped.attributionLine ?? "")) P("N3 attributionLine does not name the license");
const entries = shipped.entries ?? [];
if (entries.length < 50) P(`N3 only ${entries.length} entries - the derived shelf should span the list's wire services and outlets`);
for (const e of entries) {
  const a = e.attribution ?? {};
  if (norm(a.rating) !== "generally reliable") P(`N3 ${e.id}: attribution.rating ${JSON.stringify(a.rating)}`);
  if (!/perennial sources/i.test(a.dataset ?? "")) P(`N3 ${e.id}: attribution.dataset does not name the Perennial Sources list`);
  if (!/CC BY-SA/.test(a.license ?? "")) P(`N3 ${e.id}: attribution.license ${JSON.stringify(a.license)}`);
  // N4
  if (!(typeof a.ratingUrl === "string" && a.ratingUrl.startsWith(snapshot.dataset.url + "#") && a.ratingUrl.length > snapshot.dataset.url.length + 1)) P(`N4 ${e.id}: ratingUrl is not an anchor into the list page (${a.ratingUrl})`);
  if (!/^https:\/\/[a-z0-9.-]+/i.test(e.url ?? "")) P(`N4 ${e.id}: url ${JSON.stringify(e.url)}`);
}

// N5
const rows = snapshot.rows ?? [];
const qualifies = (r) => [...(r.status ?? [])].sort().join(",") === [...criterion.status].sort().join(",") && !(criterion.excludeBlacklisted && r.blacklisted);
const usable = (d) => { const s = String(d).trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""); return !!s && !/\s/.test(s) && !s.startsWith("*") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.split("/")[0]); };
const anchor = (u) => decodeURIComponent(String(u).split("#")[1] ?? "").replace(/_/g, " ");
const rowsByAnchor = new Map(rows.map((r) => [r.id, r]));
for (const e of entries) {
  const r = rowsByAnchor.get(anchor(e.attribution?.ratingUrl));
  if (!r) P(`N5 ${e.id}: no snapshot row for anchor ${JSON.stringify(anchor(e.attribution?.ratingUrl))} - a hand addition?`);
  else if (!qualifies(r)) P(`N5 ${e.id}: its row has status ${JSON.stringify(r.status)}${r.blacklisted ? " (blacklisted)" : ""} - does not meet the criterion`);
}
const shelfAnchors = new Set(entries.map((e) => anchor(e.attribution?.ratingUrl)));
let expected = 0;
for (const r of rows) {
  if (!qualifies(r)) continue;
  if (criterion.requireDomain && !(r.uses ?? []).some(usable)) continue;
  expected++;
  if (!shelfAnchors.has(r.id)) P(`N5 qualifying row ${JSON.stringify(r.id)} is not on the shelf - a hand removal?`);
}
if (entries.length !== expected) P(`N5 shelf has ${entries.length} entries; ${expected} rows qualify`);

// N6
const d = snapshot.dataset ?? {};
for (const k of ["url", "license", "revision", "retrieved", "name"]) if (!d[k]) P(`N6 snapshot.dataset.${k} missing`);
for (const k of ["url", "license", "revision", "retrieved", "dataset"]) if (shipped.derivedFrom?.[k] === undefined) P(`N6 shelf.derivedFrom.${k} missing`);
if (shipped.derivedFrom?.revision !== d.revision) P(`N6 shelf.derivedFrom.revision ${shipped.derivedFrom?.revision} != snapshot revision ${d.revision}`);
if (!isDeepStrictEqual(shipped.criterion, criterion)) P("N6 shelf.criterion differs from data/news-shelf-criterion.json");

const ok = problems.length === 0;
if (asJson) { console.log(JSON.stringify({ ok, snapshot: snapFile, rows: rows.length, entries: entries.length, expected, problems }, null, 2)); process.exit(ok ? 0 : 1); }
console.log(`news shelf (§31): ${entries.length} entries from ${rows.length} rows of ${snapFile} (revision ${d.revision}); ${expected} qualify under ${criterion.id}`);
console.log(`  attribution: ${shipped.attributionLine}`);
for (const p of problems) console.log("  FAIL  " + p);
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
