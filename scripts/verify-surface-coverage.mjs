#!/usr/bin/env node
/**
 * Surface-coverage test - the win-host-spec §5 coverage invariant, as static
 * analysis of the host's C#:
 *
 *   "the §26/§27/§30 engine runs in every web surface this app creates - no
 *    exceptions ... a coverage test enumerates every surface-creation path in
 *    the host and asserts engine injection + composition hookup on each; a new
 *    surface type that skips the engine fails the kit."
 *
 * A SITE is any place a web surface is created in targets/win-host/PrismHost:
 *   - `new WebView2`                                   (a WinUI control)
 *   - `CreateCoreWebView2ControllerAsync` /
 *     `CreateCoreWebView2CompositionControllerAsync`  (a raw controller)
 *   - `<WebView2` / `<controls:WebView2` in XAML        (a declared control)
 *
 * Each site is identified as `<file>::<enclosing method>` and must show, inside
 * that method, every HOOKUP below - or be listed in
 * scripts/surface-coverage.allowlist.json with a reason (legitimately no engine)
 * or as a known gap tied to a ledger bug row (debt, not permission).
 *
 * Exit: 0 all sites covered / allowlisted / known-gap-as-recorded
 *       1 an unlisted site lacks a hookup, or a known gap no longer matches
 *         reality (fixed -> remove the entry; worse -> fix it)
 *   --no-known-gaps   known gaps count as failures (use when reviewing the
 *                     branch that is supposed to close them)
 *   --json            machine-readable result
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostDir = join(root, "targets", "win-host", "PrismHost");
const allowPath = join(root, "scripts", "surface-coverage.allowlist.json");
const args = process.argv.slice(2);
const noKnownGaps = args.includes("--no-known-gaps");
const asJson = args.includes("--json");

/**
 * The engine hookups a covered surface must show inside its creation method.
 * Each is a regex over the method body. Names are what the allowlist's
 * `missing` arrays refer to.
 */
const HOOKUPS = [
  {
    id: "bootstrap",
    what: "TileBootstrapJs injected at document creation (readiness + PrismTile adapter bridge + Media Session capture)",
    re: /AddScriptToExecuteOnDocumentCreatedAsync\s*\(\s*TileBootstrapJs\s*\)/,
  },
  {
    id: "events-to-core",
    what: "WebMessageReceived forwarded to core as SurfaceEvents (ad-break / skip / now-playing / first-paint reach the brain)",
    re: /WebMessageReceived\s*\+=[\s\S]*?(ForwardWithId|_forwardEvent)\s*\(/,
  },
  {
    id: "popup-doctrine",
    what: "NewWindowRequested handled (§30: a popup is code - core decides, nothing opens silently)",
    re: /NewWindowRequested\s*\+=/,
  },
  {
    id: "inject-path",
    what: "the view is registered as the tile's View so surface.inject (adapters, §27 veil CSS/JS, framing) can reach it",
    re: /\b(tile|t)\.View\s*=\s*view\b/,
  },
  {
    id: "composition",
    what: "the view is placed in the tile's ViewHost beneath the overlay (dark substrate + snapshot + intermission scenery render above it)",
    re: /\.ViewHost\.Children\.Add\s*\(\s*view\s*\)/,
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "bin" || name === "obj") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(cs|xaml)$/.test(name)) out.push(p);
  }
  return out;
}

function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

/** Nearest preceding 4-space-indented member line with a parameter list = the enclosing method; its body ends at the next 4-space `}`. */
function enclosingMethod(lines, idx) {
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    const l = lines[i];
    if (/^ {4}\S/.test(l) && /\(/.test(l) && !/;\s*$/.test(l) && !/^\s*\/\//.test(l)) { start = i; break; }
    if (/^ {4}\}/.test(l)) break;
  }
  if (start < 0) return null;
  let end = lines.length - 1;
  for (let i = start + 1; i < lines.length; i++) { if (/^ {4}\}/.test(lines[i])) { end = i; break; } }
  const sig = lines[start].trim();
  const m = sig.match(/([A-Za-z_]\w*)\s*\(/g);
  const name = m ? m[m.length - 1].replace(/\s*\($/, "") : sig;
  return { name, start, end, body: lines.slice(start, end + 1).join("\n") };
}

const SITE_RES = [
  { kind: "new WebView2", re: /\bnew\s+WebView2\b/ },
  { kind: "CreateCoreWebView2Controller", re: /CreateCoreWebView2(Composition)?ControllerAsync/ },
];

const sites = [];
for (const file of walk(hostDir)) {
  const rel = relative(hostDir, file).replace(/\\/g, "/");
  const text = decode(readFileSync(file));
  const lines = text.split(/\r?\n/);
  if (file.endsWith(".xaml")) {
    lines.forEach((l, i) => { if (/<(\w+:)?WebView2\b/.test(l)) sites.push({ site: `${rel}::<xaml>`, kind: "xaml WebView2", file: rel, line: i + 1, body: text }); });
    continue;
  }
  lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;                       // a comment mentioning the ctor is not a site
    for (const s of SITE_RES) {
      if (!s.re.test(l)) continue;
      const m = enclosingMethod(lines, i);
      const site = `${rel}::${m ? m.name : "<unknown>"}`;
      if (sites.some((x) => x.site === site && x.kind === s.kind)) continue;   // one method, one site
      sites.push({ site, kind: s.kind, file: rel, line: i + 1, method: m?.name, body: m ? m.body : l });
    }
  });
}

const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : { allow: [], knownGaps: [] };
const allowed = new Map((allow.allow ?? []).map((a) => [a.site, a]));
const gaps = new Map((allow.knownGaps ?? []).map((g) => [g.site, g]));

let fail = false;
const rows = [];
for (const s of sites) {
  const missing = HOOKUPS.filter((h) => !h.re.test(s.body)).map((h) => h.id);
  const a = allowed.get(s.site);
  const g = gaps.get(s.site);
  let status, note = "";
  if (missing.length === 0) {
    status = "COVERED";
    if (g) { status = "FAIL"; note = `listed as a known gap (${g.bug}) but now fully covered - remove the knownGaps entry`; fail = true; }
    else if (a) { note = `allowlisted as no-engine but now shows every hookup - drop the allow entry? (${a.reason})`; }
  } else if (a) {
    status = "ALLOWED";
    note = a.reason;
  } else if (g) {
    const recorded = [...(g.missing ?? [])].sort().join(",");
    const actual = [...missing].sort().join(",");
    if (recorded !== actual) { status = "FAIL"; note = `known gap ${g.bug} recorded missing [${recorded}] but reality is [${actual}] - update the ledger row and the entry`; fail = true; }
    else if (noKnownGaps) { status = "FAIL"; note = `known gap ${g.bug} (${g.owner}) - --no-known-gaps: must be closed on this branch`; fail = true; }
    else { status = "KNOWN GAP"; note = `${g.bug} · ${g.owner} · missing: ${missing.join(", ")}`; }
  } else {
    status = "FAIL"; note = `unlisted surface lacks: ${missing.join(", ")} - either wire the engine (win-host-spec §5) or allowlist it WITH A REASON`; fail = true;
  }
  rows.push({ ...s, body: undefined, missing, status, note });
}
for (const [site] of allowed) if (!sites.some((s) => s.site === site)) rows.push({ site, status: "STALE", note: "allowlist entry names a site that no longer exists - remove it" });
for (const [site, g] of gaps) if (!sites.some((s) => s.site === site)) { rows.push({ site, status: "FAIL", note: `knownGaps entry (${g.bug}) names a site that no longer exists - remove it and close the bug row` }); fail = true; }
if (sites.length === 0) { rows.push({ site: "<none>", status: "FAIL", note: "no surface-creation sites found - the scanner is broken, not the host" }); fail = true; }

if (asJson) { console.log(JSON.stringify({ ok: !fail, hookups: HOOKUPS.map((h) => ({ id: h.id, what: h.what })), rows }, null, 2)); process.exit(fail ? 1 : 0); }

console.log(`surface coverage (win-host-spec §5) - ${sites.length} creation site(s) in targets/win-host/PrismHost`);
console.log(`hookups required: ${HOOKUPS.map((h) => h.id).join(" · ")}`);
for (const r of rows) {
  console.log(`  ${r.status.padEnd(10)} ${r.site}${r.line ? `  (line ${r.line}, ${r.kind})` : ""}`);
  if (r.note) console.log(`             ${r.note}`);
}
console.log(fail ? "RESULT: FAIL" : `RESULT: PASS${rows.some((r) => r.status === "KNOWN GAP") ? " (with known gaps - see ledger)" : ""}`);
process.exit(fail ? 1 : 0);
