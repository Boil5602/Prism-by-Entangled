#!/usr/bin/env node
/**
 * Adapter selectors that cannot throw (2026-09-25). Tubi's press loop looked up `a[href^=/tv-shows/]` - an unquoted attribute value with
 * slashes is not valid CSS, querySelector throws, and the loop died whenever its first look missed (American Gods never started); Disney+'s
 * videoSearch held `a[href=/browse/search]` in a selector list, which made the whole list throw every time.
 *
 * Every string literal an adapter script hands to querySelector / querySelectorAll / closest / matches is checked: an attribute selector's
 * value must be quoted unless it is a plain identifier (letters, digits, - and _, not starting with a digit or --). A selector built at run
 * time is out of reach and skipped.
 *
 * Exit 0 pass, 1 fail (adapter, field and the selector listed).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "prism-adapters", "adapters");
const call = /\.(?:querySelector|querySelectorAll|closest|matches)\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g;
const attr = /\[\s*[-\w]+\s*[~|^$*]?=\s*([^\]'"\s][^\]]*?)\s*(?:\s[is])?\]/g;
const ident = /^-?[A-Za-z_][-\w]*$/;

const bad = [];
function scan(adapter, field, code) {
  let m;
  call.lastIndex = 0;
  while ((m = call.exec(code))) {
    const sel = m[2].replace(/\\(["'])/g, "$1");
    let a;
    attr.lastIndex = 0;
    while ((a = attr.exec(sel))) if (!ident.test(a[1])) bad.push(`${adapter} ${field}: ${sel}   <- unquoted value ${a[1]}`);
  }
}
for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
  let j;
  try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
  const walk = (v, path) => {
    if (typeof v === "string") { if (v.includes("querySelector") || v.includes(".closest(") || v.includes(".matches(")) scan(f, path, v); }
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? path + "." + k : k);
  };
  walk(j, "");
}
if (bad.length) {
  console.log(`adapter selectors that throw (${bad.length}) - quote the attribute value:`);
  for (const b of bad) console.log("  " + b);
  process.exit(1);
}
console.log("every literal adapter selector is valid");
