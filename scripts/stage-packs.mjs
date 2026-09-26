#!/usr/bin/env node
/**
 * Stage the bundled subset of each imagery pack for a shell build
 * (concept-scenes §3.1: "`bundled.txt` pins the subset copied into the host's
 * `Assets/packs/<id>` at build").
 *
 *   node scripts/stage-packs.mjs --dest=targets/win-host/PrismHost/Assets/packs
 *
 * Copies, per pack: `pack.json` REWRITTEN to exactly the bundled entries, plus
 * those entries' bytes. The staged manifest is what the device reads, so it
 * can never promise an image the build did not ship — and it can never ship an
 * image the manifest does not describe (§5: unlabelled imagery never ships).
 *
 * Image bytes are git-ignored and maintainer-fetched, so on a fresh clone this
 * stages the manifests only, the host finds no files, and the veil degrades to
 * its dark substrate (§26) — never a broken veil, never a build failure.
 *
 * The destination is generated: it is safe to delete, and this script prunes
 * anything in it that the pins no longer name.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const src = resolve(root, arg("packs", "packs"));
const dest = resolve(root, arg("dest", join("targets", "win-host", "PrismHost", "Assets", "packs")));
const quiet = process.argv.includes("--quiet");
const log = (m) => { if (!quiet) console.log(m); };

if (!existsSync(src)) {
  log(`stage-packs: no ${src.replace(root, ".")} - nothing to stage`);
  process.exit(0);
}

const IMAGE_RE = /\.(jpg|jpeg|png|webp|avif)$/i;
const ids = readdirSync(src).filter((d) => { try { return statSync(join(src, d)).isDirectory(); } catch { return false; } }).sort();
mkdirSync(dest, { recursive: true });

let staged = 0;
for (const id of ids) {
  const from = join(src, id);
  const manifestPath = join(from, "pack.json");
  if (!existsSync(manifestPath)) continue;
  const pack = JSON.parse(readFileSync(manifestPath, "utf8"));

  const bundledPath = join(from, "bundled.txt");
  const pins = existsSync(bundledPath)
    ? readFileSync(bundledPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"))
    : (pack.images ?? []).map((i) => i.file);

  const byFile = new Map((pack.images ?? []).map((i) => [i.file, i]));
  const present = pins.filter((f) => byFile.has(f) && existsSync(join(from, f)));
  const to = join(dest, id);
  mkdirSync(to, { recursive: true });

  // The staged manifest describes exactly what the build ships - no more.
  writeFileSync(join(to, "pack.json"), JSON.stringify({ ...pack, images: present.map((f) => byFile.get(f)) }, null, 2) + "\n");
  for (const f of present) copyFileSync(join(from, f), join(to, f));

  // Prune: an image the pins no longer name would be unlabelled on the device.
  const keep = new Set(["pack.json", ...present]);
  for (const f of readdirSync(to)) if (!keep.has(f) && (IMAGE_RE.test(f) || f === "pack.json")) rmSync(join(to, f), { force: true });

  staged += present.length;
  log(`stage-packs: ${id} - ${present.length}/${pins.length} pinned image(s) staged to ${to.replace(root, ".")}`);
}

// Prune a whole pack directory that no longer exists upstream (directories
// only - the destination's own .gitignore is not ours to remove).
for (const d of readdirSync(dest)) {
  if (ids.includes(d)) continue;
  try { if (statSync(join(dest, d)).isDirectory()) rmSync(join(dest, d), { recursive: true, force: true }); } catch { /* gone already */ }
}

log(`stage-packs: ${ids.length} pack(s), ${staged} image file(s)${staged === 0 ? " - manifests only (bytes are maintainer-fetched; the veil degrades to its dark substrate)" : ""}`);
