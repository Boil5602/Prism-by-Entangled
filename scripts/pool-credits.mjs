// The PRISM app's credits for the hand-picked photos (the signed pool): the same facts the PRISM extension carries in
// src/art-credits.js, written as data the app reads (2026-11-18: the app's small view under a cover had no credit for a pool photo).
// Run after prism-veil-art/fetch-art.py --credits has rewritten the extension's file:  node scripts/pool-credits.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "prototypes/prism-veil-extension/src/art-credits.js"), "utf8");
const window = {}; new Function("window", src)(window);
const all = window.__prismVeilNS.ART_CREDITS, out = {};
const DOT = " " + String.fromCharCode(0xB7) + " ";
for (const [file, text] of Object.entries(all)) {
  const [title, rest = ""] = String(text).split("\n");
  const parts = rest.split(DOT).map((s) => s.trim()).filter(Boolean);
  // "Photo: who . license . source" (the photos), or "owner, status . license" (the museum pictures)
  const credit = (parts[0] || "").replace(/^Photo:\s*/, "");
  out[file] = { title: title.trim(), credit, license: parts[1] || "", source: parts[2] || "" };
}
const to = join(root, "targets/win-host/PrismHost/Assets/credits/pool-credits.json");
writeFileSync(to, JSON.stringify(out, null, 1) + "\n");
console.log(Object.keys(out).length + " credits -> " + to);
