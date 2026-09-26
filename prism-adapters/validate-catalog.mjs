/**
 * Catalog validator (§31) — the "CI" for prism-adapters while it lives in the
 * monorepo (runs from the root npm test; becomes a workflow when the repo
 * splits out). Fails on:
 *   - any non-text file anywhere in prism-adapters (no binaries: posters are
 *     fetched from the service's own site, never committed)
 *   - a catalog entry missing required fields, with an id ≠ filename, a DRM
 *     tier without evidence, an out-of-range zoom, or a bad audio value
 *   - focusPresets carrying raw CSS instead of adapter selector names
 *   - a first preset that is not "Whole page" (selector null)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const errors = [];
const TEXT_EXT = new Set([".json", ".md", ".css", ".js", ".mjs", ".txt"]);
const AUDIO = new Set(["exclusive", "mix", "mute"]);
const DRM = new Set(["hardware", "software", "none"]);
// a selector NAME, not CSS: letters/digits/dashes only
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
// the scene-model aspect buckets (packages/core/src/scene-model.ts ASPECT_BUCKETS) - facetPresets keys
const ASPECT_BUCKETS = new Set(["16:9", "4:3", "3:2", "1:1", "3:4", "9:16", "21:9-strip", "8:1-ticker"]);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const rel = relative(root, p);
    if (!TEXT_EXT.has(extname(name).toLowerCase()))
      errors.push(`${rel}: non-text file — binaries never ship in prism-adapters (§31)`);
    else if (readFileSync(p).includes(0))
      errors.push(`${rel}: contains NUL bytes — not a text file`);
  }
}
walk(root);

const catalogDir = join(root, "catalog");
for (const name of readdirSync(catalogDir).filter((f) => f.endsWith(".json"))) {
  const rel = "catalog/" + name;
  if (name.startsWith("_")) continue;                    // documentation examples
  let c;
  try { c = JSON.parse(readFileSync(join(catalogDir, name), "utf8")); }
  catch (e) { errors.push(`${rel}: unparseable JSON (${e.message})`); continue; }

  const need = (cond, msg) => { if (!cond) errors.push(`${rel}: ${msg}`); };
  need(c.id === name.replace(/\.json$/, ""), `id "${c.id}" must equal the filename`);
  for (const f of ["name", "url", "aspectHint"]) need(typeof c[f] === "string" && c[f], `missing ${f}`);
  need(/^https:\/\//.test(c.url ?? ""), "url must be https");
  need(AUDIO.has(c.audio), `audio must be one of ${[...AUDIO].join("|")}`);
  need(c.poster?.source === "site" && c.poster?.fallback === "wordmark",
    'poster must be { source: "site", fallback: "wordmark" } — posters are fetched, never bundled');
  need(typeof c.zoom === "number" && c.zoom >= 0.5 && c.zoom <= 3, "zoom must be 0.5–3");

  const tier = c.drm?.["windows-host"];
  need(DRM.has(tier), 'drm["windows-host"] must be hardware|software|none');
  need(typeof c.drm?.evidence === "string" && /docs\/reports\/|webview2-poc|win-host-m1/.test(c.drm.evidence),
    "drm needs an evidence pointer into docs/reports/ — no tier without a recorded run");

  const presets = c.focusPresets ?? [];
  need(Array.isArray(presets) && presets.length > 0, "focusPresets required (Whole page at minimum)");
  const referenced = new Set();
  if (presets.length) {
    need(presets[0].selector === null, 'first preset must be "Whole page" (selector null)');
    for (const p of presets) {
      need(typeof p.id === "string" && typeof p.label === "string", "preset needs id + label");
      if (p.selector !== null) {
        need(NAME_RE.test(p.selector ?? ""),
          `preset "${p.id}": selector must be an adapter selector NAME (letters/digits/dashes), not CSS — drift lives in the adapter`);
        referenced.add(p.selector);
      }
    }
  }

  // §31 utility facet presets: keyed by slot class ("4:3·M") or aspect bucket ("8:1-ticker" = any tier)
  if (c.facetPresets !== undefined) {
    need(c.facetPresets && typeof c.facetPresets === "object" && !Array.isArray(c.facetPresets), "facetPresets must be an object keyed by slot class / aspect bucket");
    for (const [key, list] of Object.entries(c.facetPresets ?? {})) {
      const m = key.match(/^(.+?)(?:·(XL|L|M|S))?$/u);
      need(m && ASPECT_BUCKETS.has(m[1]), `facetPresets["${key}"]: key must be an aspect bucket (${[...ASPECT_BUCKETS].join(" ")}) optionally ·XL|L|M|S`);
      need(Array.isArray(list) && list.length > 0, `facetPresets["${key}"]: must be a non-empty array`);
      for (const p of Array.isArray(list) ? list : []) {
        need(typeof p.id === "string" && typeof p.label === "string", `facetPresets["${key}"]: preset needs id + label`);
        if (p.selector !== null && p.selector !== undefined) {
          need(NAME_RE.test(p.selector ?? ""), `facetPresets["${key}"] "${p.id}": selector must be an adapter selector NAME, not CSS`);
          referenced.add(p.selector);
        }
        if (p.zoom !== undefined) need(typeof p.zoom === "number" && p.zoom >= 0.5 && p.zoom <= 3, `facetPresets["${key}"] "${p.id}": zoom must be 0.5–3`);
        if (p.pad !== undefined) need(typeof p.pad === "number" && p.pad >= 0, `facetPresets["${key}"] "${p.id}": pad must be ≥ 0`);
        if (p.url !== undefined && p.url !== null) need(/^https:\/\//.test(p.url), `facetPresets["${key}"] "${p.id}": url must be https`);
        if (p.fit !== undefined) need(["width", "height", "contain"].includes(p.fit), `facetPresets["${key}"] "${p.id}": fit must be width|height|contain`);
      }
    }
  }

  // every referenced NAME must exist in the adapter's selectors table (a dangling name would degrade to whole page silently)
  if (referenced.size) {
    need(typeof c.adapter === "string" && c.adapter, "presets reference selector names but the entry names no adapter");
    const ap = join(root, "adapters", (c.adapter ?? "") + ".json");
    let table = {};
    try { table = JSON.parse(readFileSync(ap, "utf8")).selectors ?? {}; } catch { need(false, `adapter "${c.adapter}" (adapters/${c.adapter}.json) is missing or unparseable`); }
    for (const n of referenced) need(Object.prototype.hasOwnProperty.call(table, n), `preset selector "${n}" is not in adapters/${c.adapter}.json selectors`);
  }
}

// adapter data blocks: known control / presentation names, non-empty values
const CONTROL_NAMES = new Set(["play", "pause", "next", "prev", "skip", "fullscreen", "normal", "close"]);
const PRESENTATION_NAMES = new Set(["enterFullscreen", "enterTheater", "play"]);
const adaptersDir = join(root, "adapters");
for (const name of readdirSync(adaptersDir).filter((f) => f.endsWith(".json"))) {
  const rel = "adapters/" + name;
  let a;
  try { a = JSON.parse(readFileSync(join(adaptersDir, name), "utf8")); }
  catch (e) { errors.push(`${rel}: unparseable JSON (${e.message})`); continue; }
  const need = (cond, msg) => { if (!cond) errors.push(`${rel}: ${msg}`); };
  need(Array.isArray(a.match) && a.match.length > 0 && a.match.every((h) => typeof h === "string" && /^[a-z0-9.-]+$/.test(h)), "match must be a non-empty list of hostnames");
  for (const [k, v] of Object.entries(a.controls ?? {})) {
    need(CONTROL_NAMES.has(k), `controls.${k}: unknown control name (${[...CONTROL_NAMES].join("|")})`);
    need(typeof v === "string" && v.trim(), `controls.${k}: empty`);
  }
  for (const [k, v] of Object.entries(a.presentation ?? {})) {
    need(PRESENTATION_NAMES.has(k), `presentation.${k}: unknown presentation action (${[...PRESENTATION_NAMES].join("|")})`);
    need(typeof v === "string" && v.trim(), `presentation.${k}: empty`);
  }
  for (const [k, v] of Object.entries(a.selectors ?? {})) {
    need(NAME_RE.test(k), `selectors["${k}"]: names are letters/digits/dashes`);
    need(typeof v === "string" && v.trim(), `selectors.${k}: empty`);
  }
  if (a.js !== undefined && a.js !== null) {
    need(typeof a.js === "string", "js must be a string or null");
    // §26 synthetic interaction ban (the same patterns core's lintAdapter rejects)
    for (const [id, re] of [["click", /\.click\s*\(/], ["dispatchEvent", /\.dispatchEvent\s*\(/], ["synthetic-event", /new\s+(Mouse|Pointer|Keyboard|Touch|Input|Focus|UI|Wheel)Event\s*\(/], ["form-submit", /\.submit\s*\(/], ["requestSubmit", /\.requestSubmit\s*\(/], ["showModal-close", /\.close\s*\(\s*\)/]])
      need(!re.test(a.js ?? ""), `js synthesizes interaction (${id}) — §26 forbids it; adapters observe, never interact`);
  }
}

if (errors.length) {
  console.error("catalog validation FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("catalog ok: " +
  readdirSync(catalogDir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).length + " entries, no binaries");
