#!/usr/bin/env node
/*
  The doctor's night run (scripts/doctor, 2026-11-04, roadmap items 3 and 8): one command for what a night should leave for the
  morning. In order:
    1. the log triage of the day (triage.mjs; --prev for yesterday's rotated log), a model call, about fifty cents;
    2. the adapter health check of every HIDDEN page the running host lists (dump-tile.mjs then prove.mjs with no proposal): no
       model, no cost, the selectors of each adapter counted on its own page tonight;
    3. with --gate, the release gate's public rows (gate.mjs), about a quarter.
  Everything lands in scripts/doctor/out/nightly-<day>/summary.md with the pieces beside it. Nothing of a household's leaves the
  machine beyond what each step's own filter allows (docs/doctor.md).

    node scripts/doctor/nightly.mjs [--prev] [--gate] [--no-triage] [--no-health]

  Not scheduled by this script. To run it at 03:00 from Task Scheduler on the developer's PC (the host must be running with
  PRISM_DEV_SHOT=1 for the health step; it skips itself otherwise):
    schtasks /Create /TN "Prism doctor nightly" /SC DAILY /ST 03:00 /TR "cmd /c cd /d C:\Projects\prism && node scripts\doctor\nightly.mjs --prev --gate >> scripts\doctor\out\nightly.log 2>&1"
*/
import { spawnSync , execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// the doctor's own lock while it runs (2026-11-05): the break-watch sampler's idle runs wait on it, both read Prism through the one eval channel
const doctorLock = join(root, "scripts", "doctor", "out", "doctor.lock");
try { mkdirSync(dirname(doctorLock), { recursive: true }); writeFileSync(doctorLock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } catch {}
process.on("exit", () => { try { if (JSON.parse(readFileSync(doctorLock, "utf8")).pid === process.pid) unlinkSync(doctorLock); } catch {} });
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const log = (s) => console.log("[nightly] " + s);
const now = new Date(), two = (n) => String(n).padStart(2, "0");
const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
const outDir = resolve(root, "scripts", "doctor", "out", "nightly-" + day);
mkdirSync(outDir, { recursive: true });
const run = (script, extra = []) => { const r = spawnSync(process.execPath, [join(root, "scripts", "doctor", script), ...extra], { cwd: root, encoding: "utf8", timeout: 20 * 60 * 1000 }); return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const newest = (prefix) => readdirSync(join(root, "scripts", "doctor", "out")).filter((d) => d.startsWith(prefix)).map((d) => join(root, "scripts", "doctor", "out", d)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const summary = [`# The doctor's night run, ${day}`, ""];

// 1. the triage
if (!flag("--no-triage")) {
  const r = run("triage.mjs", [...(flag("--prev") ? ["--prev"] : []), "--out=" + join(outDir, "triage")]);
  const tj = join(outDir, "triage", "triage.json");
  if (r.code === 0 && existsSync(tj)) {
    const t = JSON.parse(readFileSync(tj, "utf8"));
    const by = { "look-now": [], "worth-a-look": [], noted: [] };
    for (const a of t.anomalies) (by[a.severity] || by.noted).push(a);
    summary.push("## Log triage", "", t.summary, "", `${t.anomalies.length} anomalies: ${by["look-now"].length} look now, ${by["worth-a-look"].length} worth a look, ${by.noted.length} noted. Full report: triage/triage.md`, "");
    for (const a of by["look-now"]) summary.push(`- **LOOK NOW ${a.when}** (${a.subsystem}): ${a.what}`);
    for (const a of by["worth-a-look"]) summary.push(`- ${a.when} (${a.subsystem}): ${a.what}`);
    log(`triage: ${t.anomalies.length} anomalies`);
  } else { summary.push("## Log triage", "", "failed:", "```", r.out.split("\n").slice(-6).join("\n"), "```"); log("triage failed"); }
  summary.push("");
}

// 2. the adapters' health on their hidden pages
// the break-watch sampler drives Prism through the same eval channel overnight: its lock, while its process lives, skips the health step
const samplerLock = join(root, "scripts", "doctor", "out", "sampler", "running.lock");
const samplerOn = (() => { try { const l = JSON.parse(readFileSync(samplerLock, "utf8")); process.kill(l.pid, 0); return true; } catch { return false; } })();
if (samplerOn) { summary.push("## Adapter health", "", "skipped: the break-watch sampler is driving Prism (scripts/doctor/out/sampler/running.lock)", ""); log("health: skipped, the sampler runs"); }
if (!flag("--no-health") && !samplerOn) {
  const list = run("dump-tile.mjs", ["--list"]);
  if (list.code !== 0) { summary.push("## Adapter health", "", "the host is not running with PRISM_DEV_SHOT=1, or did not answer; skipped", ""); log("health: no host"); }
  else {
    const hidden = list.out.split("\n").filter((l) => /kind=Hidden/.test(l)).map((l) => l.split(" ")[0]);
    summary.push("## Adapter health", "", `${hidden.length} hidden pages: ${hidden.join(", ") || "(none)"}`, "", "| surface | adapter | selectors | match nothing |", "|---|---|---|---|");
    for (const s of hidden) {
      const adapter = s.replace(/^app:/, "").replace(/:lookup$/, "").replace(/-home-.*$|-\d+x\d+-\w+$/g, "");   // a video service's lookup page is app:<id>:lookup (2026-11-04)
      if (!existsSync(join(root, "prism-adapters", "adapters", adapter + ".json"))) { summary.push(`| ${s} | ${adapter} | (no adapter file) | |`); continue; }
      const d = run("dump-tile.mjs", [s, "--out=" + join(outDir, "health-" + s)]);
      // a lookup page opens only while a lookup runs (2026-11-05: eleven "dump failed" rows a night were pages that were not open)
      if (d.code !== 0 && /no surface/.test(d.out ?? "")) { summary.push(`| ${s} | ${adapter} | not open now (opened while a lookup runs) | |`); continue; }
      if (d.code !== 0) { summary.push(`| ${s} | ${adapter} | dump failed | |`); continue; }
      const p = run("prove.mjs", ["--dump=" + join(outDir, "health-" + s, "dump.json"), "--adapter=" + adapter]);
      writeFileSync(join(outDir, "health-" + s, "health.txt"), p.out);
      const m = /health: (.*)/.exec(p.out); const n = /adapter [^:]+: (\d+) selectors/.exec(p.out);
      const dead = m ? (m[1].startsWith("every") ? "none" + (m[1].includes("state-bound") ? " (" + m[1].slice(m[1].indexOf("state-bound")) + ")" : "") : m[1].replace(/^\d+ of \d+ selectors match nothing on this dump: /, "").replace("; state-bound", " (state-bound").replace(/$/, m[1].includes("state-bound") ? ")" : "")) : "?";
      summary.push(`| ${s} | ${adapter} | ${n ? n[1] : "?"} | ${dead} |`);
      log(`health ${s}: ${m ? m[1] : "?"}`);
    }
    summary.push("", "A sign-in control matching nothing on a signed-in page is expected. Anything else is a selector to read against the page (docs/doctor.md).", "");
  }
}

// 3. the gate
if (flag("--gate")) {
  const r = run("gate.mjs", ["--out=" + join(outDir, "gate")]);
  const rep = join(outDir, "gate", "report.md");
  if (existsSync(rep)) { const t = readFileSync(rep, "utf8"); const table = t.split("\n").filter((l) => /^\| (row|---|[A-Z]{2}-\d)/.test(l)); summary.push("## Release gate, public rows", "", ...table, "", "Concerns and screenshots: gate/report.md", ""); log("gate: " + table.length + " lines"); }
  else { summary.push("## Release gate", "", "failed:", "```", r.out.split("\n").slice(-6).join("\n"), "```", ""); log("gate failed"); }
}

writeFileSync(join(outDir, "summary.md"), summary.join("\n") + "\n");
log("written " + join(outDir, "summary.md"));
// the sampler's nights labelled for promos (2026-11-04: the owner asked to sample as much as needed): the breaks today's model covered in the
// recorded days of today and yesterday (autobreaks.py, new spans only), sorted commercial / promo / show by the promo pass, merged into the
// day's labels.auto.json for the next retraining. At most --promo-sheets sheets a day (400 by default, about $8).
if (!flag("--no-promos")) {
  const days = [0, 1].map((d) => { const t = new Date(Date.now() - d * 86400e3); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); });
  summary.push("## Promo pass on the sampler's recordings", "");
  for (const d of days) {
    const gdir = join(process.env.LOCALAPPDATA || "", "Prism", "diagnostics", "golden", d);
    if (!existsSync(gdir)) { summary.push(`- ${d}: no recordings`); continue; }
    let r = spawnSync("python", [join("scripts", "doctor", "autobreaks.py"), d], { cwd: root, encoding: "utf8" });
    const found = (r.stdout || "").trim().split(String.fromCharCode(10)).pop();
    if (!/ [1-9]\d* new covered breaks/.test(found)) { summary.push(`- ${d}: ${found || "no candidates"}`); continue; }
    r = spawnSync(process.execPath, [join("scripts", "doctor", "promos.mjs"), d, "--labels=labels.candidates.json", "--max-sheets=" + opt("--promo-sheets", "400"), "--concurrency=4"], { cwd: root, encoding: "utf8", timeout: 3 * 3600e3 });
    const last = (r.stdout || "").split(String.fromCharCode(10)).filter((l) => l.startsWith("[promos]")).slice(-2).join(" / ");
    summary.push(`- ${d}: ${found}; ${last}`); log("promos " + d + ": " + last);
  }
  summary.push("");
}
// the ad SDKs the Veil hooks, watched for a new build (sdk-watch.mjs, roadmap item 6)
if (!flag("--no-sdk")) {
  const w = run("sdk-watch.mjs", []);
  summary.push("## Ad SDK builds", "", "```", w.out.trim(), "```", "");
  log("sdk watch: " + w.out.trim().split("\n").join(" | "));
}
// the live score and the closing promos (livescore.py, 2026-11-05): what the live model covered on the sampled days against their automatic
// labels, written for the attention page, and its lines in the summary
{
  const r = spawnSync("python", [join("scripts", "doctor", "livescore.py")], { cwd: root, encoding: "utf8" });
  const lines = (r.stdout || "").trim().split(String.fromCharCode(10)).filter(Boolean);
  summary.push("## Live covers and closing promos", "", ...(lines.length ? lines.map((l) => "- " + l.trim()) : ["- livescore.py said nothing: " + (r.stderr || "").trim().slice(0, 200)]), "");
  log("live score: " + (lines.find((l) => l.includes(" live: ")) ?? "no sampled day"));
}
// the page of what wants a person, folded across the nights (attention.mjs), written last so the bookmark is fresh by morning
try { execFileSync(process.execPath, [join("scripts", "doctor", "attention.mjs")], { stdio: "inherit" }); } catch (e) { log("attention page failed: " + (e && e.message)); }
console.log("\n" + summary.join("\n"));
