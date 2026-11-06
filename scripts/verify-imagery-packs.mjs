#!/usr/bin/env node
/**
 * Imagery-pack gate (docs/concept-scenes.md §3.3, dashboard-schema §5/§26/§27).
 *
 * "Every filter/label traceable to a named source; no unlabeled truth filters"
 * applies to imagery too: no unlabelled picture ever reaches a wall. This is
 * the check that makes that true, and it is a thin file-system wrapper around
 * core's own `validateImageryPack` (packages/core/src/imagery-pack.ts) so the
 * gate and the runtime agree by construction — the same posture as
 * verify-news-shelf.mjs, which regenerates through core's builder.
 *
 * FAILS when:
 *   I1  an image entry is missing a required field (file, title, credit,
 *       attribution, sourceUrl, license.{id,name,url}, sha256 — plus creator
 *       in a pack that declares requiresCreator)
 *   I2  license.id is outside the allowlist (public-domain, cc0, cc-by, cc-by-sa)
 *   I3  a file present in the pack directory has no manifest entry
 *   I4  a present file's sha256 does not match its manifest entry
 *   I5  bundled.txt names a file with no manifest entry
 *
 * NOT-YET (exit 2) when a declared pack has neither manifest entries nor bytes
 * — the fetcher has not been run for it yet and there is nothing to verify.
 *
 * PASS with a note when entries exist but their bytes do not: image bytes are
 * git-ignored and maintainer-fetched (§3.1 hosting decision), so a FRESH CLONE
 * gates green, including under `--require-all`. Absent bytes are reported on
 * every run; they are never a failure.
 *
 * Usage: node scripts/verify-imagery-packs.mjs [--packs=packs] [--json]
 * Exit:  0 pass · 1 FAIL · 2 NOT-YET
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const asJson = process.argv.includes("--json");
const packsDir = join(root, arg("packs", "packs"));
const validatorPath = join(root, "packages", "core", "dist", "imagery-pack.js");

if (!existsSync(packsDir)) {
  console.log(`imagery packs: no ${packsDir.replace(root, ".")} directory - nothing to verify yet`);
  process.exit(2);
}
if (!existsSync(validatorPath)) {
  console.log("imagery packs: packages/core/dist/imagery-pack.js absent - run the core dist build first (scripts/verify.mjs does)");
  process.exit(2);
}
const { validateImageryPack, unfetchedImages } = await import(pathToFileURL(validatorPath).href);

const IMAGE_RE = /\.(jpg|jpeg|png|webp|avif)$/i;
const ids = readdirSync(packsDir).filter((d) => { try { return statSync(join(packsDir, d)).isDirectory(); } catch { return false; } }).sort();

const report = [];
let fail = false;
let notYet = 0;

for (const id of ids) {
  const dir = join(packsDir, id);
  const manifestPath = join(dir, "pack.json");
  const files = readdirSync(dir).filter((f) => IMAGE_RE.test(f)).sort();

  if (!existsSync(manifestPath)) {
    if (files.length) {
      console.log(`  FAIL  ${id}: ${files.length} image file(s) with no pack.json - unlabelled imagery never ships`);
      fail = true;
    } else {
      report.push({ id, status: "NOT-YET", note: "no pack.json and no bytes" });
      notYet++;
    }
    continue;
  }

  let pack;
  try { pack = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { console.log(`  FAIL  ${id}/pack.json is not valid JSON: ${e.message}`); fail = true; continue; }

  const disk = files.map((name) => ({ name, sha256: createHash("sha256").update(readFileSync(join(dir, name))).digest("hex") }));
  const problems = validateImageryPack(pack, disk);

  // I5: bundled.txt is the build's copy list - a name with no entry would ship unlabelled.
  const bundledPath = join(dir, "bundled.txt");
  let bundled = [];
  if (existsSync(bundledPath)) {
    bundled = readFileSync(bundledPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
    const known = new Set((Array.isArray(pack.images) ? pack.images : []).map((i) => i?.file));
    for (const b of bundled) if (!known.has(b)) problems.push(`${id}/bundled.txt names ${JSON.stringify(b)}, which has no pack.json entry`);
  }

  const entries = Array.isArray(pack.images) ? pack.images.length : 0;
  if (!problems.length && entries === 0 && files.length === 0) {
    report.push({ id, status: "NOT-YET", entries: 0, files: 0, note: "manifest declared but empty - run node scripts/fetch-pack.mjs " + id });
    notYet++;
    console.log(`  NOT-YET  ${id}: manifest is empty and no bytes are present - node scripts/fetch-pack.mjs ${id}`);
    continue;
  }

  const missing = problems.length ? [] : unfetchedImages(pack, disk);
  const status = problems.length ? "FAIL" : "PASS";
  if (problems.length) fail = true;
  report.push({ id, status, entries, files: files.length, bundled: bundled.length, unfetched: missing.length, problems });
  const note = missing.length ? `  (${missing.length} entr${missing.length === 1 ? "y" : "ies"} not fetched here - bytes are git-ignored, node scripts/fetch-pack.mjs ${id})` : "";
  console.log(`  ${status.padEnd(7)} ${id}: ${entries} entries, ${files.length} files on disk, ${bundled.length} bundled${note}`);
  for (const p of problems) console.log(`           FAIL  ${p}`);
}

if (asJson) {
  console.log(JSON.stringify({ ok: !fail, packs: report }, null, 2));
  process.exit(fail ? 1 : notYet && notYet === report.length ? 2 : 0);
}

const total = report.filter((r) => r.status === "PASS").reduce((n, r) => n + r.entries, 0);
console.log(`imagery packs (§3.3): ${report.filter((r) => r.status === "PASS").length}/${ids.length} packs verified, ${total} attributed images`);
console.log(`RESULT: ${fail ? "FAIL" : notYet && notYet === report.length ? "NOT-YET" : "PASS"}`);
process.exit(fail ? 1 : notYet && notYet === report.length ? 2 : 0);
