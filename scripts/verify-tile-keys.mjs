#!/usr/bin/env node
/**
 * The tile-key allowlist check (docs/concept-scenes.md §6).
 *
 * A first-party micro-facet keeps its state in a store key that THREE places
 * have to agree about:
 *
 *   1. core declares it in `TILES_KEYS` (packages/core/src/tiles-data.ts) and
 *      routes it in `readTilesDoc` / `applyTilesIntent`;
 *   2. the host allows it in `TilesBridge.Keys`
 *      (targets/win-host/PrismHost.Core/TilesBridge.cs), which is an ALLOWLIST:
 *      anything else is refused, not created;
 *   3. the page asks for it by literal (`PrismTiles.get("tiles:agenda")`).
 *
 * When (1) and (3) agree but (2) does not, nothing errors anywhere. The page
 * loads, the bridge silently refuses the read, and the facet renders its empty
 * state forever. No test sees it, no build breaks, and it is found by someone
 * looking at a wall. That happened in CS-10.3 and this check exists so it
 * fails the build instead (maintainer's order, 2026-09-03).
 *
 * FAILS when:
 *   - a key in core's TILES_KEYS is missing from the host's TilesBridge.Keys
 *     (or the other way round: the host allowing a key core cannot route is
 *     just as wrong, it just fails louder);
 *   - a `tiles:` key literal in a page under Assets/tiles is in neither list;
 *   - a catalog entry served from https://tiles.prism/ has no page directory
 *     under Assets/tiles (a facet pointing at a 404);
 *   - a page under Assets/tiles has no catalog entry pointing at it.
 *
 * Exit: 0 clean · 1 a finding · 2 NOT-YET (core's source or the host tree is absent)
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const asJson = process.argv.includes("--json");

const coreSrc = join(root, "packages", "core", "src", "tiles-data.ts");
const bridgeSrc = join(root, "targets", "win-host", "PrismHost.Core", "TilesBridge.cs");
const tilesDir = join(root, "targets", "win-host", "PrismHost", "Assets", "tiles");
const catalogDir = join(root, "prism-adapters", "catalog");

if (!existsSync(coreSrc) || !existsSync(bridgeSrc)) {
  console.log("tile keys: core's tiles-data.ts or the host's TilesBridge.cs is absent - nothing to check yet");
  process.exit(2);
}

const rel = (p) => relative(root, p).replace(/\\/g, "/");
const findings = [];
const fail = (file, what, hit = "") => findings.push({ file: rel(file), what, hit });

/* ---------------------------------------------------------- the two lists ---- */

// core: `export const TILES_KEYS = [CHORES_KEY, TIMER_KEY, AGENDA_KEY] as const;`
// resolved through the `export const X_KEY = "tiles:y"` constants beside it.
const coreText = readFileSync(coreSrc, "utf8");
const constByName = new Map();
for (const m of coreText.matchAll(/export const (\w+)\s*=\s*"(tiles:[a-z0-9-]+)"/g)) constByName.set(m[1], m[2]);
const coreListM = /export const TILES_KEYS\s*=\s*\[([^\]]*)\]/.exec(coreText);
const coreKeys = [];
if (!coreListM) fail(coreSrc, "no TILES_KEYS array found - this check cannot verify what core declares");
else {
  for (const raw of coreListM[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    const lit = /^"(tiles:[a-z0-9-]+)"$/.exec(raw);
    if (lit) coreKeys.push(lit[1]);
    else if (constByName.has(raw)) coreKeys.push(constByName.get(raw));
    else fail(coreSrc, `TILES_KEYS names ${raw}, which is not a "tiles:" constant in this file`, raw);
  }
}

// host: `public static readonly string[] Keys = { ChoresKey, TimerKey, AgendaKey };`
// resolved through the `public const string XKey = "tiles:y"` constants beside it.
const bridgeText = readFileSync(bridgeSrc, "utf8");
const csConstByName = new Map();
for (const m of bridgeText.matchAll(/public const string (\w+)\s*=\s*"(tiles:[a-z0-9-]+)"/g)) csConstByName.set(m[1], m[2]);
const hostListM = /public static readonly string\[\]\s+Keys\s*=\s*\{([^}]*)\}/.exec(bridgeText);
const hostKeys = [];
if (!hostListM) fail(bridgeSrc, "no TilesBridge.Keys array found - this check cannot verify the host's allowlist");
else {
  for (const raw of hostListM[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    const lit = /^"(tiles:[a-z0-9-]+)"$/.exec(raw);
    if (lit) hostKeys.push(lit[1]);
    else if (csConstByName.has(raw)) hostKeys.push(csConstByName.get(raw));
    else fail(bridgeSrc, `TilesBridge.Keys names ${raw}, which is not a "tiles:" constant in this file`, raw);
  }
}

// The invariant that would have caught CS-10.3's silent miss.
for (const k of coreKeys) {
  if (!hostKeys.includes(k)) {
    fail(bridgeSrc, `core declares ${k} but the host allowlist does not - the page would load and read NOTHING, silently`, k);
  }
}
for (const k of hostKeys) {
  if (!coreKeys.includes(k)) {
    fail(bridgeSrc, `the host allows ${k} but core's TILES_KEYS does not declare it - the bridge would forward a key core cannot route`, k);
  }
}

// Core must also actually route each key, not merely list it.
for (const k of coreKeys) {
  const name = [...constByName.entries()].find(([, v]) => v === k)?.[0];
  if (!name) continue;
  for (const fn of ["readTilesDoc", "applyTilesIntent"]) {
    const body = new RegExp(`export function ${fn}\\b[\\s\\S]*?\\n\\}`, "m").exec(coreText)?.[0] ?? "";
    if (body && !body.includes(name)) {
      fail(coreSrc, `${fn} does not handle ${k} - it is declared but unroutable, so the page reads null forever`, k);
    }
  }
}

/* -------------------------------------------------- pages, keys and catalog ---- */

const known = new Set([...coreKeys, ...hostKeys]);
const pageDirs = new Set();

if (existsSync(tilesDir)) {
  for (const entry of readdirSync(tilesDir)) {
    const dir = join(tilesDir, entry);
    if (!statSync(dir).isDirectory() || entry === "shared") continue;
    pageDirs.add(entry);
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(html?|js|mjs)$/i.test(f)) continue;
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/["'`](tiles:[a-z0-9-]+)["'`]/g)) {
          if (!known.has(m[1])) {
            fail(p, `references ${m[1]}, which is in neither core's TILES_KEYS nor the host's allowlist`, m[1]);
          }
        }
      }
    };
    walk(dir);
  }
}

// Catalog entries served from tiles.prism must have a page, and vice versa.
const catalogPages = new Set();
if (existsSync(catalogDir)) {
  for (const f of readdirSync(catalogDir).filter((n) => n.endsWith(".json"))) {
    const p = join(catalogDir, f);
    let entry;
    try { entry = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    const url = typeof entry?.url === "string" ? entry.url : "";
    const m = /^https:\/\/tiles\.prism\/([a-z0-9-]+)\/?/.exec(url);
    if (!m) continue;
    catalogPages.add(m[1]);
    if (existsSync(tilesDir) && !pageDirs.has(m[1])) {
      fail(p, `catalog entry "${entry.id}" points at ${url}, but there is no Assets/tiles/${m[1]} to serve`, url);
    }
  }
  for (const dir of pageDirs) {
    if (!catalogPages.has(dir)) {
      fail(join(tilesDir, dir), `Assets/tiles/${dir} is served but no catalog entry points at it - it can never be picked as a facet`, dir);
    }
  }
}

/* -------------------------------------------------------------- reporting ---- */

if (asJson) {
  console.log(JSON.stringify({ ok: findings.length === 0, coreKeys, hostKeys, pages: [...pageDirs], findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

console.log(`tile keys (docs/concept-scenes.md §6): core declares ${coreKeys.length}, the host allows ${hostKeys.length}, ${pageDirs.size} page(s) served`);
console.log(`  core: ${coreKeys.join(", ") || "(none)"}`);
console.log(`  host: ${hostKeys.join(", ") || "(none)"}`);
for (const f of findings) console.log(`  FAIL  ${f.file}  ${f.what}${f.hit ? "  ->  " + f.hit : ""}`);
console.log(findings.length ? "RESULT: FAIL" : "RESULT: PASS - core, the host allowlist and the pages name the same keys");
process.exit(findings.length ? 1 : 0);
