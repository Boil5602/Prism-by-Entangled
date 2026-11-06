#!/usr/bin/env node
/*
  The doctor's dump (scripts/doctor, 2026-11-03): a page's STRUCTURE, read by headless Firefox with the Veil installed, written
  as JSON for the ask step and the proof step. Dev tooling only.

    node scripts/doctor/dump.mjs <url> [--wait=8] [--scroll=2] [--out=scripts/doctor/out/<host>-<stamp>] [--no-veil] [--shot] [--show]
                                [--until=<selector> --until-s=90]

  What goes in the file, and what never does (the structure-only rule of docs/doctor.md): tags, ids, classes, data-* attribute
  names and short values, roles, each element's box, the HOSTNAME of a frame's or a video's address (never its path or query),
  the length bucket of an element's own text, and the text itself only when it is a short label an ad carries (Ad, Sponsored,
  Skip, Learn more ... up to 28 characters, from a fixed vocabulary). No article text, no names, no addresses, no cookies: the
  profile is fresh and signed in to nothing, so there is nothing of the household's on the page to begin with. The Veil's own
  covers (data-prism-veil) are listed with their boxes, so a reader can see what the shipped rules cover today, and the trace
  the Veil writes on <html data-prism-errors> comes along.
*/
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox } from "./bidi.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const url = args.find((a) => !a.startsWith("--"));
if (!url) { console.log("usage: node scripts/doctor/dump.mjs <url> [--wait=8] [--scroll=2] [--out=dir] [--no-veil] [--shot] [--show] [--until=<selector> --until-s=90]"); process.exit(2); }
const waitS = Number(opt("--wait", "8"));
const scrolls = Number(opt("--scroll", "2"));
const veilPath = flag("--no-veil") ? null : resolve(root, "prototypes/prism-veil-extension/dist/firefox");
const host = new URL(url).hostname;
const now = new Date(), two = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;   // local time, as the host log keeps it
const outDir = resolve(root, opt("--out", join("scripts", "doctor", "out", host.replace(/^www\./, "") + "-" + stamp)));
const log = (s) => console.log("[dump] " + s);

if (veilPath && !existsSync(join(veilPath, "manifest.json"))) { log("no built Firefox package at " + veilPath + " (run node build-firefox.mjs in the extension folder), reading without the Veil"); }

import { DUMP_FN } from "./dumpfn.mjs";   // the function run in the page, shared with dump-tile.mjs

const ff = await launchFirefox({ headless: !flag("--show"), log });
try {
  let veil = null;
  if (veilPath && existsSync(join(veilPath, "manifest.json"))) { veil = await ff.install(veilPath); log("Veil installed from dist/firefox (" + veil + ")"); }
  log("opening " + url);
  await ff.navigate(url);
  await new Promise((r) => setTimeout(r, waitS * 1000));
  // a few screens down and back: feeds load their ads as they come into view; the dump is taken at the top
  for (let i = 1; i <= scrolls; i++) { await ff.run("function (y) { scrollTo(0, y); return 1; }", [i * 800]); await new Promise((r) => setTimeout(r, 1500)); }
  if (scrolls > 0) { await ff.run("function () { scrollTo(0, 0); return 1; }"); await new Promise((r) => setTimeout(r, 2500)); }
  // --until=<selector>: wait for a state the page reaches on its own (a carousel on its sponsored slide), looking through every
  // open shadow root, then dump at once; --until-s bounds the wait (default 90) and the dump is taken anyway when it runs out
  const until = opt("--until", null);
  if (until) {
    const UNTIL_FN = `function (sel) { var roots = [document], i = 0; while (i < roots.length) { var r = roots[i++]; try { if (r.querySelector(sel)) return 1; } catch (e) { return -1; } var all = r.querySelectorAll("*"); for (var k = 0; k < all.length; k++) if (all[k].shadowRoot) roots.push(all[k].shadowRoot); } return 0; }`;
    const untilS = Number(opt("--until-s", "90")), t0 = Date.now(); let hit = 0;
    while (Date.now() - t0 < untilS * 1000) { hit = await ff.run(UNTIL_FN, [until]); if (hit) break; await new Promise((r) => setTimeout(r, 400)); }
    if (hit === 1) await new Promise((r) => setTimeout(r, Number(opt("--settle-ms", "1500"))));   // the Veil covers slowly by design; a dump at the instant of the match showed a half-faded cover
    log(hit === 1 ? `until "${until}" matched after ${((Date.now() - t0) / 1000).toFixed(1)} s` : hit === -1 ? `until "${until}" is not a selector the page accepts; dumping anyway` : `until "${until}" did not match in ${untilS} s; dumping anyway`);
  }
  const raw = await ff.run(DUMP_FN, [Number(opt("--budget", "7000")), 0]);
  const dump = JSON.parse(raw);
  const u = new URL(url);
  const out = {
    doctor: 1, kind: "veil-page", at: new Date().toISOString(), host: u.hostname, page: u.hostname + u.pathname,
    veil: veil ? JSON.parse((await import("node:fs")).readFileSync(join(veilPath, "manifest.json"), "utf8")).version : null,
    waitS, scrolls, until: opt("--until", null), ...dump,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "dump.json"), JSON.stringify(out));
  if (flag("--shot")) writeFileSync(join(outDir, "shot.png"), Buffer.from(await ff.screenshot(), "base64"));
  log(`${out.nodes.length} elements (${out.pruned} pruned, ${out.shadows} shadow roots), ${out.frames.length} frames, ${out.videos.length} videos, ${out.covers.length} Veil covers; viewport ${out.viewport.join("x")}, page ${out.docHeight} px tall`);
  if (out.marks["data-prism-errors"]) log("Veil trace: " + out.marks["data-prism-errors"].slice(0, 300));
  log("written " + join(outDir, "dump.json") + (flag("--shot") ? " and shot.png" : ""));
} finally {
  await ff.close();
}
