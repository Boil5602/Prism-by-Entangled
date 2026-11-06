#!/usr/bin/env node
/*
  The doctor's dump of a page of the RUNNING HOST (scripts/doctor, 2026-11-03, roadmap item 2): the same dump function as dump.mjs,
  run in a tile's page through the host's dev eval hook (PRISM_DEV_SHOT=1: `eval.request` = the surface id on the first line and
  JavaScript after it, the page's answer in `eval.done`; MainWindow.DevShot.cs), in strict mode, since the page is the household's
  own signed-in service. Structure only: tags, ids and markers without a space in them, boxes, hosts; a title or a name is its length.
  Dev tooling only; nothing leaves the machine. The adapter ask (ask.mjs --format=adapter) reads what this writes.

    node scripts/doctor/dump-tile.mjs <surface id> [--adapter=name] [--budget=7000] [--out=dir]
    node scripts/doctor/dump-tile.mjs --list            the host's surfaces (the "tiles" dev eval)

  Hidden pages only (memory: no visible utility work): the surface list says which are kind=Hidden.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DUMP_FN } from "./dumpfn.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const surface = args.find((a) => !a.startsWith("--"));
const diag = join(process.env.LOCALAPPDATA || "", "Prism", "diagnostics");
const log = (s) => console.log("[dump-tile] " + s);

async function devEval(id, js, waitMs = 20000) {
  const req = join(diag, "eval.request"), done = join(diag, "eval.done");
  try { unlinkSync(done); } catch {}
  writeFileSync(req, id + "\n" + js);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) { if (existsSync(done)) { await new Promise((r) => setTimeout(r, 150)); return readFileSync(done, "utf8"); } await new Promise((r) => setTimeout(r, 200)); }
  throw new Error("no eval.done in " + waitMs + " ms: is Prism running with PRISM_DEV_SHOT=1?");
}

if (flag("--list")) { console.log(await devEval("tiles", "")); process.exit(0); }
if (!surface) { console.log("usage: node scripts/doctor/dump-tile.mjs <surface id> [--adapter=name] [--budget=7000] [--out=dir] | --list"); process.exit(2); }

const tiles = await devEval("tiles", "");
const line = tiles.split("\n").find((l) => l.startsWith(surface + " "));
if (!line) { log("no surface " + surface + "; the host lists:\n" + tiles.split("\n").map((l) => "  " + l.split(" | ")[0]).join("\n")); process.exit(1); }
if (!/kind=Hidden/.test(line)) { log(surface + " is not a hidden page (" + line.split(" | ")[0] + "); the doctor reads hidden pages only"); process.exit(1); }

const raw = await devEval(surface, "(" + DUMP_FN + ")(" + Number(opt("--budget", "7000")) + ", 1)");
if (raw.startsWith("error=")) { log(raw); process.exit(1); }
let dump = JSON.parse(raw); if (typeof dump === "string") dump = JSON.parse(dump);   // WebView2 returns the value as JSON; the function returns a JSON string
const adapter = opt("--adapter", surface.replace(/-home-.*$|-\d+x\d+-\w+$/g, ""));
const now = new Date(), two = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
const outDir = resolve(root, opt("--out", join("scripts", "doctor", "out", surface + "-" + stamp)));
const out = { doctor: 1, kind: "adapter-page", at: now.toISOString(), surface, adapter, strict: 1, ...dump, page: dump.host };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "dump.json"), JSON.stringify(out));
log(`${surface} (${out.host}, adapter ${adapter}): ${out.nodes.length} elements (${out.pruned} pruned, ${out.shadows} shadow roots), ${out.frames.length} frames, ${out.videos.length} videos; viewport ${out.viewport.join("x")}, page ${out.docHeight} px tall`);
log("written " + join(outDir, "dump.json"));
