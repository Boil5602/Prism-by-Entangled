#!/usr/bin/env node
/**
 * The SM-5 merge gate (docs/bugs/LEDGER.md, "How to run the gate").
 *
 * Every Scene Model branch must pass this before SM-5 signs off a merge.
 * Runs, in dependency order:
 *
 *   core typecheck       npx tsc --noEmit                         (packages/core)
 *   core tests           npx vitest run                           (packages/core)
 *   core dist            npx tsc -p tsconfig.json                 (feeds the generator)
 *   core bundles         npm run bundle                           (dist/prism-runtime.js + dist/prism-model-eval.js - the host copies both)
 *   channel repro        node scripts/generate-win-channel.mjs + git diff --exit-code on Channel.g.cs
 *   surface coverage     node scripts/verify-surface-coverage.mjs (win-host-spec §5 invariant)
 *   vocabulary           node scripts/audit-vocabulary.mjs --strict (CLAUDE.md vocabulary; strict since SM-6, --lenient-vocab to report only)
 *   button hover         node scripts/audit-button-hover.mjs      (a host Button with its own colour owns its hover: Chip() or OwnHover - memory: hover-loss-tooltips)
 *   companion install    node scripts/verify-companion-install.mjs (the phone page's Home Screen nudge: when it shows, what it shows, what it never sends)
 *   adapter selectors    node scripts/audit-adapter-selectors.mjs (an adapter script's literal selectors are valid CSS - an unquoted value with / throws)
 *   tile assets          node scripts/verify-tile-assets.mjs      (concept-scenes §6: the micro-facets reach no network; the §24 chime still reproduces)
 *   tile keys            node scripts/verify-tile-keys.mjs        (concept-scenes §6: a key core declares that the host allowlist misses fails the BUILD, not the wall)
 *   presentation         node scripts/verify-presentation-fixtures.mjs (dashboard-schema §26 fixtures)
 *   walk-test §6a        node scripts/walk-test-6a.mjs            (scene-model-spec §6a reach counts)
 *   news shelf           node scripts/verify-news-shelf.mjs       (dashboard-schema §31 derived shelf)
 *   imagery packs        node scripts/verify-imagery-packs.mjs    (concept-scenes §3.3 attribution gate)
 *   migration            node scripts/migration-roundtrip.mjs     (scene-model-spec §7, on a COPY)
 *   host tests           dotnet test PrismHost.Tests
 *   host build           dotnet build PrismHost -p:Platform=x64   ("Build succeeded", no error (CS|MSB|WMC))
 *
 * Exit codes of the sub-scripts: 0 pass · 1 FAIL · 2 NOT-YET (the export or
 * data the check needs is absent - reported, never fails the gate until
 * --require-all is passed, which SM-6 will).
 *
 * Usage:
 *   node scripts/verify.mjs                  full gate
 *   node scripts/verify.mjs --skip-host      core-only (no dotnet)
 *   node scripts/verify.mjs --only=core-tests,channel
 *   node scripts/verify.mjs --lenient-vocab  "frame" misuse reports instead of failing (local runs only; the gate is strict since SM-6)
 *   node scripts/verify.mjs --require-all    NOT-YET counts as FAIL (the post-SM-6 posture)
 *   node scripts/verify.mjs --no-known-gaps  coverage known gaps fail (reviewing the branch that owns them)
 *   node scripts/verify.mjs --report out.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = join(root, "packages", "core");
const host = join(root, "targets", "win-host");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : null; };
const skipHost = flag("--skip-host");
const strictVocab = !flag("--lenient-vocab");   // strict is the default since the SM-6 rename; --strict-vocab is accepted and redundant
const requireAll = flag("--require-all");
const noKnownGaps = flag("--no-known-gaps");   // forwarded to the coverage test: known gaps fail (the branch that owns them)
const only = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const reportPath = opt("--report");

const isWin = process.platform === "win32";
const NPX = isWin ? "npx.cmd" : "npx";

/** Run a command, capture output, return { code, out }. shell:true so .cmd shims resolve on Windows. */
function run(cmd, cmdArgs, cwd) {
  const r = spawnSync(cmd, cmdArgs, { cwd, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function tail(s, n = 12) {
  const lines = s.trim().split(/\r?\n/);
  return lines.slice(-n).join("\n");
}

const steps = [
  {
    id: "core-typecheck", title: "core typecheck (tsc --noEmit)",
    fn: () => { const r = run(NPX, ["tsc", "-p", "tsconfig.json", "--noEmit"], core); return { code: r.code === 0 ? 0 : 1, detail: r.code === 0 ? "clean" : tail(r.out) }; },
  },
  {
    id: "core-tests", title: "core tests (vitest run)",
    fn: () => {
      const r = run(NPX, ["vitest", "run"], core);
      const m = r.out.match(/Tests\s+(\d+) passed/);
      const failed = /\bfailed\b/i.test(r.out) && !/0 failed/.test(r.out);
      const ok = r.code === 0 && !failed;
      return { code: ok ? 0 : 1, detail: ok ? `${m ? m[1] : "?"} tests passed` : tail(r.out, 30) };
    },
  },
  {
    id: "core-dist", title: "core dist build (tsc, dist/ cleaned first)",
    fn: () => {
      // dist/ is gitignored and survives branch switches: a stale module from another branch
      // (e.g. scene-migration.js) would make the NOT-YET checks below run against the wrong code.
      rmSync(join(core, "dist"), { recursive: true, force: true });
      const r = run(NPX, ["tsc", "-p", "tsconfig.json"], core);
      return { code: r.code === 0 ? 0 : 1, detail: r.code === 0 ? "dist/ cleaned and rewritten" : tail(r.out) };
    },
  },
  {
    id: "runtime-bundle", title: "core bundles (npm run bundle - every --outfile the script names)",
    fn: () => {
      // the package's own bundle script is the single source of truth for which bundles the host copies
      // (PrismHost.csproj Content items + its EnsureRuntimeBundle target run the same command)
      const r = run(isWin ? "npm.cmd" : "npm", ["run", "bundle"], core);
      // required set = every --outfile the package's bundle script names (prism-runtime.js today; prism-model-eval.js once SM-2 lands)
      const script = JSON.parse(readFileSync(join(core, "package.json"), "utf8")).scripts?.bundle ?? "";
      const want = [...script.matchAll(/--outfile=(\S+)/g)].map((m) => join(core, m[1]));
      if (!want.length) return { code: 1, detail: "packages/core/package.json has no bundle script with --outfile targets" };
      const missing = want.filter((f) => !existsSync(f));
      const ok = r.code === 0 && missing.length === 0;
      return { code: ok ? 0 : 1, detail: ok ? want.map((f) => "dist/" + basename(f)).join(" + ") : (missing.length ? "missing: " + missing.join(", ") + "\n" : "") + tail(r.out) };
    },
  },
  {
    id: "channel", title: "win channel reproducibility (generate + git diff --exit-code)",
    fn: () => {
      const g = run("node", ["scripts/generate-win-channel.mjs"], root);
      if (g.code !== 0) return { code: 1, detail: "generator failed:\n" + tail(g.out) };
      const d = run("git", ["diff", "--exit-code", "--stat", "--", "targets/win-host/PrismHost.Core/Channel/Channel.g.cs"], root);
      return { code: d.code === 0 ? 0 : 1, detail: d.code === 0 ? "Channel.g.cs reproduces byte-for-byte" : "Channel.g.cs DRIFTED from win-channel.ts - regenerate and commit:\n" + tail(d.out) };
    },
  },
  {
    id: "surface-coverage", title: "surface coverage (win-host-spec §5 invariant)",
    fn: () => { const r = run("node", ["scripts/verify-surface-coverage.mjs", ...(noKnownGaps ? ["--no-known-gaps"] : [])], root); return { code: r.code, detail: tail(r.out, 40) }; },
  },
  {
    id: "vocabulary", title: `vocabulary audit (${strictVocab ? "strict" : "report-only for 'frame'; 'whitelist' always fails"})`,
    fn: () => { const r = run("node", ["scripts/audit-vocabulary.mjs", ...(strictVocab ? ["--strict"] : [])], root); const counts = r.out.split(/\r?\n/).filter((l) => /^  "(whitelist|frame|view)"/.test(l)).map((l) => l.trim()).join(" | "); return { code: r.code, detail: r.code === 0 ? counts : tail(r.out, 30) }; },
  },
  {
    id: "button-hover", title: "button hover audit (coloured host buttons own their hover)",
    fn: () => { const r = run("node", ["scripts/audit-button-hover.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "companion-install", title: "companion install nudge fixtures (docs/features/companion-install.md)",
    fn: () => { const r = run("node", ["scripts/verify-companion-install.mjs"], root); return { code: r.code, detail: tail(r.out, 16) }; },
  },
  {
    id: "adapter-selectors", title: "adapter selector audit (literal selectors are valid CSS)",
    fn: () => { const r = run("node", ["scripts/audit-adapter-selectors.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "tile-assets", title: "first-party micro-facets reach no network (concept-scenes §6)",
    fn: () => { const r = run("node", ["scripts/verify-tile-assets.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "tile-keys", title: "tile-key allowlist (core, the host bridge and the pages name the same keys)",
    fn: () => { const r = run("node", ["scripts/verify-tile-keys.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "presentation", title: "presentation-keeping fixtures (§26)",
    fn: () => { const r = run("node", ["scripts/verify-presentation-fixtures.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "walk-6a", title: "§6a walk-test (reach counts against the route registry)",
    fn: () => { const r = run("node", ["scripts/walk-test-6a.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "news-shelf", title: "news shelf reproducibility (§31)",
    fn: () => { const r = run("node", ["scripts/verify-news-shelf.mjs"], root); return { code: r.code, detail: tail(r.out, 12) }; },
  },
  {
    id: "imagery-packs", title: "imagery packs (concept-scenes §3.3 — every image traceable to a named source)",
    fn: () => { const r = run("node", ["scripts/verify-imagery-packs.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "migration", title: "migration round-trip on a COPY (scene-model-spec §7)",
    fn: () => { const r = run("node", ["scripts/migration-roundtrip.mjs"], root); return { code: r.code, detail: tail(r.out, 20) }; },
  },
  {
    id: "host-tests", title: "host tests (dotnet test PrismHost.Tests)", host: true,
    fn: () => {
      const r = run("dotnet", ["test", "PrismHost.Tests/PrismHost.Tests.csproj"], host);
      const m = r.out.match(/Passed!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+)/);
      const ok = r.code === 0 && m && m[1] === "0";
      return { code: ok ? 0 : 1, detail: ok ? `${m[2]} passed` : tail(r.out, 30) };
    },
  },
  {
    id: "host-build", title: "host build (dotnet build PrismHost -p:Platform=x64)", host: true,
    fn: () => {
      const r = run("dotnet", ["build", "PrismHost/PrismHost.csproj", "-p:Platform=x64"], host);
      const succeeded = /Build succeeded/.test(r.out);
      const errs = r.out.match(/error (CS|MSB|WMC)\d+/g) ?? [];
      const ok = r.code === 0 && succeeded && errs.length === 0;
      const detail = ok
        ? "Build succeeded, 0 error (CS|MSB|WMC)"
        : `succeeded=${succeeded} errors=${errs.length}${errs.some((e) => e.startsWith("error WMC9999")) ? " (WMC9999 = a cascade of C# errors above it)" : ""}\n` + tail(r.out.split(/\r?\n/).filter((l) => /error (CS|MSB|WMC)/.test(l)).join("\n") || r.out, 20);
      return { code: ok ? 0 : 1, detail };
    },
  },
];

const results = [];
const t0 = Date.now();
console.log(`SM-5 gate  ·  ${new Date().toISOString()}  ·  ${root}`);
console.log("");
for (const s of steps) {
  if (only && !only.includes(s.id)) continue;
  if (s.host && skipHost) { results.push({ id: s.id, title: s.title, status: "SKIP", detail: "--skip-host" }); console.log(`  SKIP   ${s.title}`); continue; }
  const tty = process.stdout.isTTY;
  if (tty) process.stdout.write(`  ...    ${s.title}`);
  const t = Date.now();
  let r;
  try { r = s.fn(); } catch (e) { r = { code: 1, detail: String(e?.stack ?? e) }; }
  const ms = Date.now() - t;
  const status = r.code === 0 ? "PASS" : r.code === 2 ? "NOT-YET" : "FAIL";
  process.stdout.write(`${tty ? "\r" : ""}  ${status.padEnd(8)}${s.title}  (${(ms / 1000).toFixed(1)}s)\n`);
  if (status !== "PASS") for (const line of r.detail.split(/\r?\n/)) console.log("         " + line);
  else if (r.detail) console.log("         " + r.detail.split(/\r?\n/)[0]);
  results.push({ id: s.id, title: s.title, status, ms, detail: r.detail });
}

const fails = results.filter((r) => r.status === "FAIL");
const notYet = results.filter((r) => r.status === "NOT-YET");
const passes = results.filter((r) => r.status === "PASS");
const gateFails = fails.length > 0 || (requireAll && notYet.length > 0);

console.log("");
console.log("── summary ─────────────────────────────────────────────");
console.log(`  PASS ${passes.length}   FAIL ${fails.length}   NOT-YET ${notYet.length}   SKIP ${results.filter((r) => r.status === "SKIP").length}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
if (notYet.length) console.log("  NOT-YET = the export/data that check needs is absent; " + (requireAll ? "counted as FAIL (--require-all)" : "not a failure until --require-all"));
console.log(`  GATE: ${gateFails ? "FAIL - do not merge" : "PASS"}`);

if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), root, gate: gateFails ? "FAIL" : "PASS", strictVocab, requireAll, results }, null, 2));
  console.log(`  report: ${reportPath}`);
}
process.exit(gateFails ? 1 : 0);
