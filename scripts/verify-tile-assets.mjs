#!/usr/bin/env node
/**
 * The zero-network check for the first-party micro-facets
 * (docs/concept-scenes.md §6, dashboard-schema §19/§22).
 *
 * The chores and timer pages are Prism's own, served from
 * targets/win-host/PrismHost/Assets/tiles at https://tiles.prism/. Their whole
 * point is that they need nothing: no CDN script, no web font, no analytics, no
 * external image. That is easy to promise and easy to lose - one `@import
 * url(https://fonts.googleapis.com/...)` pasted in for a nicer heading and a
 * kitchen panel is talking to Google every boot. So it is a gate, not a
 * convention.
 *
 * FAILS when a text asset under Assets/tiles:
 *   - names an absolute origin other than https://tiles.prism (the mapping the
 *     host serves these pages from - a same-origin link is fine)
 *   - uses a protocol-relative URL (//example.com/...)
 *   - reaches the network from script (fetch / XMLHttpRequest / WebSocket /
 *     EventSource / importScripts / navigator.sendBeacon / dynamic import of a URL)
 *
 * Also fails when the §24 chime is missing or no longer reproduces from its
 * generator (scripts/make-chime.mjs --check), so the bundled tone always has a
 * provenance that is a script in this repo rather than a file someone found.
 *
 * Exit: 0 clean · 1 a finding · 2 NOT-YET (the Assets/tiles folder is absent)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tilesDir = join(root, "targets", "win-host", "PrismHost", "Assets", "tiles");
const asJson = process.argv.includes("--json");

/** The one origin these pages may name: the host's own virtual host mapping. */
const OWN_ORIGIN = "https://tiles.prism";
const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md"]);

/** Each finding is a rule id, a human sentence, and a regex over the file text. */
const RULES = [
  {
    id: "absolute-url",
    what: "an absolute http(s) URL to something other than " + OWN_ORIGIN,
    // every http(s) origin in the file; filtered against OWN_ORIGIN below
    re: /https?:\/\/[A-Za-z0-9._~:\-[\]@]+/g,
    keep: (hit) => !hit.toLowerCase().startsWith(OWN_ORIGIN),
  },
  {
    id: "protocol-relative",
    what: "a protocol-relative URL (//host/...), which resolves to the page's scheme and leaves the device",
    re: /(?:^|[^:/\w])\/\/[A-Za-z0-9-]+\.[A-Za-z]{2,}\//g,
  },
  {
    id: "network-api",
    what: "a script call that reaches the network",
    re: /\b(?:fetch\s*\(|XMLHttpRequest\b|new\s+WebSocket\b|new\s+EventSource\b|importScripts\s*\(|navigator\.sendBeacon\b)/g,
  },
  {
    id: "css-import",
    what: "an @import, which pulls a stylesheet from wherever it points",
    re: /@import\b/g,
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(tilesDir)) {
  const msg = "tile assets: " + relative(root, tilesDir) + " does not exist yet";
  if (asJson) console.log(JSON.stringify({ ok: null, status: "NOT-YET", note: msg }, null, 2));
  else console.log(msg + "\nRESULT: NOT-YET");
  process.exit(2);
}

const findings = [];
const files = walk(tilesDir);
let scanned = 0;

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (!TEXT_EXT.has(extname(file).toLowerCase())) continue;   // the chime is binary and checked by its generator below
  scanned++;
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(rule.re)) {
        const hit = m[0].trim();
        if (rule.keep && !rule.keep(hit)) continue;
        findings.push({ file: rel, line: i + 1, rule: rule.id, what: rule.what, hit });
      }
    });
  }
}

// The §24 chime: present, and still what its generator produces.
const chime = join(tilesDir, "shared", "chime.wav");
if (!existsSync(chime)) {
  findings.push({ file: relative(root, chime).replace(/\\/g, "/"), line: 0, rule: "chime-missing", what: "the §24 chime is not bundled - run `node scripts/make-chime.mjs`", hit: "" });
} else {
  const r = spawnSync(process.execPath, [join(root, "scripts", "make-chime.mjs"), "--check"], { encoding: "utf8" });
  if (r.status !== 0) {
    findings.push({ file: "scripts/make-chime.mjs", line: 0, rule: "chime-drift", what: "the bundled chime is not what its generator writes - regenerate and commit it", hit: (r.stderr || r.stdout || "").trim().split(/\r?\n/)[0] ?? "" });
  }
}

if (asJson) {
  console.log(JSON.stringify({ ok: findings.length === 0, scanned, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

console.log(`tile assets (docs/concept-scenes.md §6 zero network) - ${scanned} text file(s) under ${relative(root, tilesDir).replace(/\\/g, "/")}`);
console.log(`allowed origin: ${OWN_ORIGIN} (the host's own mapping) - everything else is a finding`);
for (const f of findings) console.log(`  FAIL  ${f.file}:${f.line}  ${f.rule} - ${f.what}${f.hit ? "  ->  " + f.hit : ""}`);
console.log(findings.length ? "RESULT: FAIL" : "RESULT: PASS - the micro-facets reach nothing");
process.exit(findings.length ? 1 : 0);
