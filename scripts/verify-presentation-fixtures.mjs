#!/usr/bin/env node
/**
 * Presentation-keeping fixtures (dashboard-schema §26 "Presentation keeping").
 *
 * Fixtures: packages/core/tests/fixtures/presentation-keeping/*.json
 * Shape:    .../SHAPE.json (documentation; the event kinds, actions, invariants)
 *
 * Always: validates every fixture against the shape (exit 1 on a malformed one).
 * When SM-1's machine exists - packages/core/dist/presentation-keeper.js
 * exporting `step` + `initialKeeperState` (+ `keeperConfig`) - adapts the
 * fixture events onto it (see viaStep below) and checks:
 *   - the emitted actions equal `expect.actions` (order, action, facet, t within toleranceMs)
 *   - the INVARIANTS in SHAPE.json, independently of `expect`:
 *       I1 no action while an ad-break / intermission is active
 *       I2 enter* only with keepPresentation, play only with onEnd != none
 *       I3 after a user-caused drop, no enter* until a user re-entry
 *       I4 the restored state is the one the human last had
 * Otherwise: "machine absent" (exit 2).
 *
 * Run the dist build first (node scripts/verify.mjs does): the runner loads
 * compiled JS so it never depends on a TS loader.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "packages", "core", "tests", "fixtures", "presentation-keeping");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = modArg ?? join(root, "packages", "core", "dist", "presentation-keeper.js");   // --module=<path> to run another implementation
const asJson = process.argv.includes("--json");

const KINDS = new Set(["presentation", "input", "ad-break", "intermission", "ended", "playing", "tick"]);
const STATES = new Set(["fullscreen", "theater", "none"]);
const CAUSES = new Set(["user", "site", "unknown"]);
const ON_END = new Set(["none", "restart", "restart-fullscreen"]);
const ACTIONS = new Set(["enterFullscreen", "enterTheater", "play"]);

const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "SHAPE.json").map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));

// ---- 1. shape validation --------------------------------------------------
const shapeErrors = [];
for (const fx of fixtures) {
  const e = (m) => shapeErrors.push(`${fx.file}: ${m}`);
  if (!fx.name || fx.name + ".json" !== fx.file) e("name must equal the file name");
  if (!fx.spec) e("spec sentence missing");
  if (!fx.facet?.id || typeof fx.facet.keepPresentation !== "boolean" || !ON_END.has(fx.facet.onEnd)) e("facet must be {id, keepPresentation: boolean, onEnd: none|restart|restart-fullscreen}");
  if (!Array.isArray(fx.events) || !fx.events.length) e("events must be a non-empty array");
  let last = -1;
  for (const ev of fx.events ?? []) {
    if (typeof ev.t !== "number" || ev.t < last) e(`events must be sorted by t (at ${JSON.stringify(ev)})`);
    last = ev.t;
    if (!KINDS.has(ev.kind)) e(`unknown event kind ${ev.kind}`);
    if (ev.kind === "presentation" && (!STATES.has(ev.state) || !CAUSES.has(ev.cause))) e(`presentation needs state+cause (${JSON.stringify(ev)})`);
    if (ev.kind === "ad-break" && typeof ev.active !== "boolean") e("ad-break needs active:boolean");
    if (ev.kind === "intermission" && (typeof ev.active !== "boolean" || !ev.reason)) e("intermission needs active+reason");
    if (ev.kind === "input" && !ev.key) e("input needs key");
  }
  if (!Array.isArray(fx.expect?.actions)) e("expect.actions must be an array");
  for (const a of fx.expect?.actions ?? []) {
    if (typeof a.t !== "number" || !ACTIONS.has(a.action) || a.facet !== fx.facet?.id) e(`bad expected action ${JSON.stringify(a)}`);
    // the fixture must not itself contradict I2
    if (a.action.startsWith("enter") && !fx.facet?.keepPresentation) e(`expects ${a.action} without keepPresentation (I2)`);
    if (a.action === "play" && fx.facet?.onEnd === "none") e("expects play with onEnd none (I2)");
  }
}
if (shapeErrors.length) {
  console.log("presentation fixtures: SHAPE errors");
  for (const s of shapeErrors) console.log("  " + s);
  process.exit(1);
}

// ---- 2. the machine --------------------------------------------------------
if (!existsSync(modPath)) {
  console.log(`presentation fixtures: ${fixtures.length} fixture(s) well-formed; machine absent (${modPath.replace(root, ".")} - waiting on SM-1's presentation-keeper export)`);
  process.exit(2);
}
const mod = await import(pathToFileURL(modPath).href);
/**
 * SM-1's machine (src/presentation-keeper.ts): pure `step(state, event, config)`
 * over KeeperEvent = { type: "user-input" | "presentation" | "ad-break" | "ended" | "tick", at, ... }
 * returning PresentationAction = { kind: "enterFullscreen" | "enterTheater" | "play", reason }.
 * The fixtures' event vocabulary maps onto it:
 *   {kind, t}            -> {type, at}
 *   input                -> user-input            (the machine attributes a drop to the human by proximity, not by a cause field)
 *   presentation.cause   -> dropped               (documentation for the reader; the machine infers it)
 *   intermission{active} -> ad-break{active}      (the controller's veil boundary is a boundary)
 *   playing              -> tick                  (no keeper semantics)
 * Actions get `t` = the `at` of the event that produced them, and `facet` = the fixture's facet id.
 */
function viaStep(fx) {
  const config = mod.keeperConfig ? mod.keeperConfig(fx.facet) : { keepPresentation: fx.facet.keepPresentation, onEnd: fx.facet.onEnd };
  let state = mod.initialKeeperState();
  const out = [];
  for (const ev of fx.events) {
    const at = ev.t;
    const ke = ev.kind === "input" ? { type: "user-input", at }
      : ev.kind === "presentation" ? { type: "presentation", at, state: ev.state }
      : ev.kind === "ad-break" || ev.kind === "intermission" ? { type: "ad-break", at, active: ev.active }
      : ev.kind === "ended" ? { type: "ended", at }
      : { type: "tick", at };
    const r = mod.step(state, ke, config);
    state = r.state;
    for (const a of r.actions) out.push({ t: at, action: a.kind, facet: fx.facet.id, reason: a.reason });
  }
  return out;
}
const run = mod.step && mod.initialKeeperState ? viaStep
  : mod.runPresentationFixture ? (fx) => mod.runPresentationFixture(fx)
  : mod.simulatePresentationKeeping ? (fx) => mod.simulatePresentationKeeping(fx.facet, fx.events, fx.options)
  : null;
if (!run) { console.log("presentation fixtures: module present but exports none of step+initialKeeperState / runPresentationFixture / simulatePresentationKeeping"); process.exit(1); }

/** The invariants, computed from the event timeline, applied to the emitted actions. */
function invariantViolations(fx, actions) {
  const v = [];
  const inputWindow = fx.options?.inputWindowMs ?? 1500;
  // timeline state
  let adActive = false, veilActive = false, lastInput = -Infinity, humanState = "none", userExited = false, adEndedAt = -Infinity;
  const stateAt = [];   // [t, {adActive, veilActive, humanState, userExited}]
  for (const ev of fx.events) {
    if (ev.kind === "ad-break") { adActive = ev.active; if (!ev.active) adEndedAt = ev.t; }
    if (ev.kind === "intermission") { veilActive = ev.active; if (!ev.active) adEndedAt = ev.t; }
    if (ev.kind === "input") lastInput = ev.t;
    if (ev.kind === "presentation") {
      let cause = ev.cause;
      if (cause === "unknown") cause = ev.t - lastInput <= inputWindow ? "user" : "site";
      if (cause === "user") {
        if (ev.state === "none") userExited = true;
        else { humanState = ev.state; userExited = false; }
      }
    }
    stateAt.push([ev.t, { adActive, veilActive, humanState, userExited }]);
  }
  const at = (t) => { let s = { adActive: false, veilActive: false, humanState: "none", userExited: false }; for (const [tt, st] of stateAt) { if (tt <= t) s = st; else break; } return s; };
  for (const a of actions) {
    const s = at(a.t);
    if (a.action.startsWith("enter")) {
      if (!fx.facet.keepPresentation) v.push(`I2: ${a.action}@${a.t} without keepPresentation`);
      if (s.adActive || s.veilActive) {
        // an action exactly at the boundary event is at the boundary, not during
        const boundary = fx.events.some((e) => e.t === a.t && ((e.kind === "ad-break" && !e.active) || (e.kind === "intermission" && !e.active)));
        if (!boundary) v.push(`I1: ${a.action}@${a.t} while an ad/veil is active`);
      }
      if (s.userExited) v.push(`I3: ${a.action}@${a.t} after a user exit, before a user re-entry`);
      const want = s.humanState === "theater" ? "enterTheater" : s.humanState === "fullscreen" ? "enterFullscreen" : null;
      if (!want) v.push(`I4: ${a.action}@${a.t} but the human never established a state`);
      else if (want !== a.action) v.push(`I4: ${a.action}@${a.t} but the human's state was ${s.humanState}`);
    }
    if (a.action === "play" && fx.facet.onEnd === "none") v.push(`I2: play@${a.t} with onEnd none`);
  }
  return v;
}

const rows = [];
let fail = false;
for (const fx of fixtures) {
  let actions;
  try { actions = run(fx) ?? []; } catch (e) { rows.push({ name: fx.name, status: "FAIL", note: "threw: " + (e?.message ?? e) }); fail = true; continue; }
  const tol = fx.expect.toleranceMs ?? 0;
  const exp = fx.expect.actions;
  const problems = [];
  if (actions.length !== exp.length) problems.push(`emitted ${actions.length} action(s), expected ${exp.length}: got ${JSON.stringify(actions)}`);
  else exp.forEach((e, i) => {
    const a = actions[i];
    if (a.action !== e.action || a.facet !== e.facet || Math.abs(a.t - e.t) > tol) problems.push(`#${i}: got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);
  });
  problems.push(...invariantViolations(fx, actions));
  const status = problems.length ? (fx.contestable ? "FAIL (contestable)" : "FAIL") : "PASS";
  if (problems.length) fail = true;
  rows.push({ name: fx.name, status, note: problems.join("; ") });
}

if (asJson) { console.log(JSON.stringify({ ok: !fail, rows }, null, 2)); process.exit(fail ? 1 : 0); }
console.log(`presentation fixtures (§26) - ${fixtures.length} fixture(s) against ${modPath.replace(root, ".")}`);
for (const r of rows) console.log(`  ${r.status.padEnd(18)} ${r.name}${r.note ? "  - " + r.note : ""}`);
console.log(`RESULT: ${fail ? "FAIL" : "PASS"}`);
process.exit(fail ? 1 : 0);
