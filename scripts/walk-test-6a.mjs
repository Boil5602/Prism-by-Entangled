#!/usr/bin/env node
/**
 * §6a walk-test (scene-model-spec §6a, normative):
 *
 *   "no state a user can *see* on a scene may require more than one action to
 *    reach its *editor* and two to reach its *App settings*" - and Back
 *    returns exactly to the scene.
 *
 * Table-driven: scripts/fixtures/walk-6a.json lists every visible-on-scene
 * state with the destinations, max action counts, and the gestures §6a names.
 * This runner checks them against the prism:// ROUTE REGISTRY Agent 3 (SM-3)
 * ships. Until it exists the runner reports "registry absent" (exit 2).
 *
 * Registry location (first found wins):
 *   --registry=<path>
 *   packages/core/routes.registry.json
 *   packages/core/dist/routes.registry.json
 *
 * Registry shape (agreed here; Agent 3 conforms or proposes a change):
 * {
 *   "version": 1,
 *   "routes": [
 *     { "route": "prism://facet/:id/edit", "kind": "editor", "entity": "facet", "back": "scene" },
 *     { "route": "prism://app/:id/setup",  "kind": "settings", "entity": "app", "back": "scene" }
 *   ],
 *   "reach": [
 *     { "from": "video-facet", "to": "prism://facet/:id/edit", "actions": ["long-press", "sheet:Edit facet"] },
 *     { "from": "needs-attention-badge", "to": "prism://app/:id/setup", "actions": ["badge-tap"] }
 *   ]
 * }
 *
 *   routes[].route   pattern with :params (matched literally against the fixture)
 *   routes[].back    where Back lands - must be "scene" for every route the
 *                    fixture names (§6a: Back returns exactly to the scene)
 *   reach[].from     a state id from the fixture (`states[].id`)
 *   reach[].actions  the human gestures, in order, from the state to the route.
 *                    ACTION COUNT = actions not in the fixture's selectionGestures
 *                    (long-press / right-click / remote-hold open the sheet on an
 *                    item = SELECTION, count 0; each choice after it counts 1; a
 *                    tap / badge-tap / corner affordance counts 1). See the
 *                    fixture's `counting` note.
 *
 * Checks, per state × destination:
 *   1. the route exists in `routes`
 *   2. a `reach` entry exists from that state to that route
 *   3. reach.actions.length ≤ fixture max
 *   4. the route's `back` is "scene"
 *   5. (soft) reach.actions equals the fixture's `via` - a different gesture
 *      path with the same count is a WARN, not a fail (the spec fixes counts,
 *      the gesture names are its examples)
 *
 * Exit: 0 pass · 1 fail · 2 registry absent
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const regArg = args.find((a) => a.startsWith("--registry="))?.slice("--registry=".length);
const asJson = args.includes("--json");

const fixture = JSON.parse(readFileSync(join(root, "scripts", "fixtures", "walk-6a.json"), "utf8"));
const candidates = [regArg, join(root, "packages", "core", "routes.registry.json"), join(root, "packages", "core", "dist", "routes.registry.json")].filter(Boolean);
const regPath = candidates.find((p) => existsSync(p));

// The fixture itself must be well-formed regardless of the registry.
const fixtureErrors = [];
for (const s of fixture.states) {
  if (!s.id || !s.reach) fixtureErrors.push(`state without id/reach: ${JSON.stringify(s).slice(0, 80)}`);
  for (const [dest, r] of Object.entries(s.reach ?? {})) {
    if (!r.route?.startsWith("prism://")) fixtureErrors.push(`${s.id}.${dest}: route must be prism://`);
    if (typeof r.max !== "number") fixtureErrors.push(`${s.id}.${dest}: max missing`);
    if (dest === "editor" && r.max > 1) fixtureErrors.push(`${s.id}.editor: max ${r.max} > 1 violates §6a`);
    if (dest === "appSettings" && r.max > 2) fixtureErrors.push(`${s.id}.appSettings: max ${r.max} > 2 violates §6a`);
    for (const a of r.via ?? []) if (!fixture.actionsVocabulary.includes(a)) fixtureErrors.push(`${s.id}.${dest}: action "${a}" not in actionsVocabulary`);
  }
  if (s.back !== "scene") fixtureErrors.push(`${s.id}: back must be "scene"`);
}
const missingEditor = fixture.states.filter((s) => !s.reach.editor).map((s) => s.id);
const missingSettings = fixture.states.filter((s) => !s.reach.appSettings && s.id !== "placeholder-slot").map((s) => s.id);
if (missingEditor.length) fixtureErrors.push(`states without an editor reach: ${missingEditor.join(", ")}`);
if (missingSettings.length) fixtureErrors.push(`states without an appSettings reach: ${missingSettings.join(", ")}`);

if (fixtureErrors.length) {
  console.log("walk-test §6a: the FIXTURE is malformed:");
  for (const e of fixtureErrors) console.log("  " + e);
  process.exit(1);
}

if (!regPath) {
  console.log(`walk-test §6a: registry absent (looked for ${candidates.map((c) => c.replace(root, ".")).join(", ")})`);
  console.log(`  fixture ok: ${fixture.states.length} visible states, ${fixture.routesRequired.length} routes required - waiting on SM-3's prism:// route registry`);
  process.exit(2);
}

const reg = JSON.parse(readFileSync(regPath, "utf8"));
const routes = new Map((reg.routes ?? []).map((r) => [r.route, r]));
const reach = reg.reach ?? [];
const selection = new Set(fixture.selectionGestures ?? []);
const rows = [];
let fail = false;

for (const route of fixture.routesRequired) {
  if (!routes.has(route)) { rows.push({ state: "-", dest: "-", route, status: "FAIL", note: "required route missing from registry" }); fail = true; }
}
for (const s of fixture.states) {
  for (const [dest, r] of Object.entries(s.reach)) {
    const route = routes.get(r.route);
    if (!route) { rows.push({ state: s.id, dest, route: r.route, status: "FAIL", note: "route not in registry" }); fail = true; continue; }
    const paths = reach.filter((x) => x.from === s.id && x.to === r.route);
    if (!paths.length) { rows.push({ state: s.id, dest, route: r.route, status: "FAIL", note: "no reach entry from this state" }); fail = true; continue; }
    const count = (p) => p.actions.filter((a) => !selection.has(a)).length;
    // B-55: among minimal-count paths prefer the one whose gestures match the spec example, so two
    // destinations sharing a route (setupMode / appSettings -> app/:id/setup) each find their own entry
    const minCount = Math.min(...paths.map(count));
    const minimal = paths.filter((p) => count(p) === minCount);
    const best = minimal.find((p) => r.via && p.actions.join("|") === r.via.join("|")) ?? minimal[0];
    if (count(best) > r.max) { rows.push({ state: s.id, dest, route: r.route, status: "FAIL", note: `${count(best)} action(s) > max ${r.max}: ${best.actions.join(" → ")}` }); fail = true; continue; }
    if (route.back !== "scene") { rows.push({ state: s.id, dest, route: r.route, status: "FAIL", note: `Back lands on "${route.back}", must be scene` }); fail = true; continue; }
    const sameGestures = r.via && best.actions.join("|") === r.via.join("|");
    rows.push({ state: s.id, dest, route: r.route, status: sameGestures || !r.via ? "PASS" : "WARN", note: sameGestures ? `${count(best)} action(s)` : `${count(best)} action(s) via ${best.actions.join(" → ")} (spec example: ${r.via.join(" → ")})` });
  }
}

if (asJson) { console.log(JSON.stringify({ ok: !fail, registry: regPath, rows }, null, 2)); process.exit(fail ? 1 : 0); }
console.log(`walk-test §6a against ${regPath.replace(root, ".")}`);
for (const r of rows) console.log(`  ${r.status.padEnd(5)} ${r.state.padEnd(24)} ${r.dest.padEnd(12)} ${r.route.padEnd(40)} ${r.note}`);
console.log(`RESULT: ${fail ? "FAIL" : "PASS"}`);
process.exit(fail ? 1 : 0);
