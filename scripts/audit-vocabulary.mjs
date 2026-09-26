#!/usr/bin/env node
/**
 * Vocabulary audit (CLAUDE.md "Vocabulary"):
 *
 *   - "whitelist" never appears in a UI string (the human verbs are Open /
 *     Always allow). Any hit in a UI-reaching string literal FAILS, strict or
 *     not. Hits in comments are listed as info (docs debt, not a UI violation).
 *   - "frame" means the physical device only. A UI string using "frame" for a
 *     slot / facet / tile / layout region is a violation. `--strict` makes it
 *     fail - the gate default since the SM-6 rename commit (scripts/verify.mjs
 *     passes --strict unless run with --lenient-vocab).
 *   - "view" is the pre-model word for a facet. REPORT-ONLY (it is not in
 *     CLAUDE.md's rule): listed so the next sweep can see it; never fails.
 *     Non-facet phrasings (web view, view pixels, viewport...) are allowed via
 *     `viewPatterns` in scripts/vocabulary.allow.json.
 *
 * What counts as a UI string:
 *   host C#   : literals assigned to Text / Content / Header / PlaceholderText /
 *               Title / Label / Description, passed to ToolTipService.SetToolTip,
 *               SetPill(...), Item("...") menu builders, ContentDialog fields -
 *               including the literal parts of $"..." interpolations
 *   host XAML : Text= / Content= / Header= / ToolTip= / PlaceholderText= attributes
 *   core TS   : string literals in modules that produce human sentences
 *               (popups.ts allow/allowed sentences, remote.ts error bodies,
 *               types.ts role descriptions, runtime.ts, catalog.ts) - every
 *               literal, since core has no UI-vs-log distinction; comments excluded
 *
 * Physical-device phrasings are allowed via scripts/vocabulary.allow.json
 * (`devicePatterns`, regexes) and exact-string exceptions (`exact`).
 *
 * Exit: 0 clean (or report-only with frame/view findings) · 1 whitelist-in-UI,
 *       or frame findings under --strict.
 *   --strict   frame misuse fails ("view" stays report-only)
 *   --json     machine-readable
 *   --all      include comment hits for "frame" too (noisy; docs debt)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const asJson = args.includes("--json");
const includeComments = args.includes("--all");

const allowPath = join(root, "scripts", "vocabulary.allow.json");
const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : { devicePatterns: [], exact: [] };
const devicePatterns = (allow.devicePatterns ?? []).map((p) => new RegExp(p, "i"));
const viewPatterns = (allow.viewPatterns ?? []).map((p) => new RegExp(p, "i"));
const exact = new Set(allow.exact ?? []);

const SCAN = [
  { dir: join(root, "targets", "win-host", "PrismHost"), ext: /\.(cs|xaml)$/, kind: "host" },
  { dir: join(root, "targets", "win-host", "PrismHost.Core"), ext: /\.cs$/, kind: "host" },
  { dir: join(root, "packages", "core", "src"), ext: /\.ts$/, kind: "core" },
];

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "bin" || name === "obj" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name) && !name.endsWith(".g.cs")) out.push(p);
  }
  return out;
}
function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

/** C# UI-reaching literal extractors: each yields the literal text (interpolation holes stripped). */
const CS_UI = [
  /\b(?:Text|Content|Header|PlaceholderText|Title|Label|Description|PrimaryButtonText|SecondaryButtonText|CloseButtonText)\s*=\s*\$?"((?:[^"\\]|\\.)*)"/g,
  /ToolTipService\.SetToolTip\([^,]+,\s*\$?"((?:[^"\\]|\\.)*)"/g,
  /\bSetPill\(\s*\$?"((?:[^"\\]|\\.)*)"/g,
  /\bItem\(\s*\$?"((?:[^"\\]|\\.)*)"/g,
];
const XAML_UI = [/\b(?:Text|Content|Header|ToolTip|PlaceholderText|Title|ToolTipService\.ToolTip)="([^"]*)"/g];
/** Core: every string literal (single, double, template) - core has no UI/log split, so all human sentences count. */
const TS_LIT = [/"((?:[^"\\\n]|\\.)*)"/g, /'((?:[^'\\\n]|\\.)*)'/g, /`((?:[^`\\]|\\.)*)`/g];

const stripHoles = (s) => s.replace(/\{[^}]*\}/g, " ").replace(/\$\{[^}]*\}/g, " ");
const FRAME = /\bframes?\b/i;
const VIEW = /\bviews?\b/i;   // the pre-model word for "facet" - report-only
const WHITELIST = /white-?list/i;

function stripComments(text, kind) {
  // keep line structure so line numbers survive: replace comment bodies with spaces
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}
function lineOf(text, idx) { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n; }

const findings = [];   // { kind, file, line, term, text, verdict }
const commentHits = [];
const identifierHits = [];   // "frame" as a key / schema id / injected JS source - a code contract, not a sentence (SM-6 decides those)
/** A literal that is code, not prose: a bare token, a schema id, or injected JS. */
const isCodeLiteral = (lit) => !/\s/.test(lit.trim()) || /^frame\.[\w-]+\/v/.test(lit) || /\bwindow\.|\bfunction\b|=>|\bPrismTile\b|\bvar\s|\breturn\b\s*[;'"]/.test(lit);
let literalsScanned = 0;

for (const s of SCAN) {
  for (const file of walk(s.dir, s.ext)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    const raw = decode(readFileSync(file));
    const code = file.endsWith(".xaml") ? raw : stripComments(raw, s.kind);
    const res = file.endsWith(".xaml") ? XAML_UI : s.kind === "host" ? CS_UI : TS_LIT;
    for (const re of res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        const lit = stripHoles(m[1]);
        literalsScanned++;
        const line = lineOf(code, m.index);
        if (WHITELIST.test(lit)) findings.push({ kind: s.kind, file: rel, line, term: "whitelist", text: m[1], verdict: "FAIL" });
        if (FRAME.test(lit)) {
          if (exact.has(m[1])) continue;
          if (devicePatterns.some((p) => p.test(lit))) continue;
          if (isCodeLiteral(lit)) { identifierHits.push({ kind: s.kind, file: rel, line, text: m[1].slice(0, 80) }); continue; }
          findings.push({ kind: s.kind, file: rel, line, term: "frame", text: m[1], verdict: strict ? "FAIL" : "REPORT" });
        }
        if (VIEW.test(lit) && !exact.has(m[1]) && !viewPatterns.some((p) => p.test(lit)) && !isCodeLiteral(lit)) {
          findings.push({ kind: s.kind, file: rel, line, term: "view", text: m[1], verdict: "REPORT" });
        }
      }
    }
    // comment hits (info): the rename's docs debt, never a UI violation
    const commentsOnly = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const cm of commentsOnly.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
      if (WHITELIST.test(cm[0])) commentHits.push({ file: rel, line: lineOf(commentsOnly, cm.index), term: "whitelist", text: cm[0].trim().slice(0, 120) });
      else if (includeComments && FRAME.test(cm[0]) && !devicePatterns.some((p) => p.test(cm[0]))) commentHits.push({ file: rel, line: lineOf(commentsOnly, cm.index), term: "frame", text: cm[0].trim().slice(0, 120) });
    }
  }
}

const whitelistUi = findings.filter((f) => f.term === "whitelist");
const frameUi = findings.filter((f) => f.term === "frame");
const viewUi = findings.filter((f) => f.term === "view");
const byFile = {};
for (const f of frameUi) byFile[f.file] = (byFile[f.file] ?? 0) + 1;
const viewByFile = {};
for (const f of viewUi) viewByFile[f.file] = (viewByFile[f.file] ?? 0) + 1;
const fail = whitelistUi.length > 0 || (strict && frameUi.length > 0);

if (asJson) { console.log(JSON.stringify({ ok: !fail, strict, literalsScanned, whitelistUi, frameUi, viewUi, identifierHits, commentHits, byFile, viewByFile }, null, 2)); process.exit(fail ? 1 : 0); }

console.log(`vocabulary audit (CLAUDE.md) - ${literalsScanned} UI-reaching literals scanned, mode: ${strict ? "STRICT (frame misuse fails)" : "report-only for 'frame'"}`);
console.log(`  "whitelist" in UI strings: ${whitelistUi.length}  ${whitelistUi.length ? "FAIL" : "(must be zero - ok)"}`);
for (const f of whitelistUi) console.log(`    ${f.file}:${f.line}  "${f.text}"`);
console.log(`  "frame" not meaning the device: ${frameUi.length} in ${Object.keys(byFile).length} file(s)  ${frameUi.length ? (strict ? "FAIL" : "(report-only; the gate runs --strict)") : "clean"}`);
for (const [file, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${file}`);
if (frameUi.length && !asJson) {
  console.log("  samples:");
  for (const f of frameUi.slice(0, 12)) console.log(`    ${f.file}:${f.line}  "${f.text.slice(0, 100)}"`);
  if (frameUi.length > 12) console.log(`    ... ${frameUi.length - 12} more (--json for all)`);
}
console.log(`  "view" (pre-model word for facet, report-only): ${viewUi.length} in ${Object.keys(viewByFile).length} file(s)`);
for (const [file, n] of Object.entries(viewByFile).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${file}`);
if (viewUi.length && !asJson) {
  for (const f of viewUi.slice(0, 8)) console.log(`    ${f.file}:${f.line}  "${f.text.slice(0, 100)}"`);
  if (viewUi.length > 8) console.log(`    ... ${viewUi.length - 8} more (--json for all)`);
}
if (identifierHits.length) console.log(`  info - "frame" as a key / schema id / injected-JS token (code contract, not a sentence; SM-6 decides): ${identifierHits.length}`);
if (commentHits.length) {
  console.log(`  info - "${includeComments ? "whitelist/frame" : "whitelist"}" in comments (not UI; docs debt): ${commentHits.length}`);
  for (const c of commentHits.slice(0, 8)) console.log(`    ${c.file}:${c.line}  ${c.text}`);
}
console.log(`RESULT: ${fail ? "FAIL" : "PASS"}`);
process.exit(fail ? 1 : 0);
