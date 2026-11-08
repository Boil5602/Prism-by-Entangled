#!/usr/bin/env node
/**
 * The host draws from one token sheet (2026-10-17, the designer's pass; targets/win-host/PrismHost/Tokens.cs). Two ambers, four inks
 * and two dims had grown across the files. This fails on a retired value anywhere in the host's sources or XAML, and on a colour
 * literal in the phone page's stylesheet outside its :root rule (the phone's colours are CSS custom properties with the same names).
 * The visualizations' art palettes (Tableaus, StylePacks, StyleRenderer) are pictures, not UI, and are left alone; so is a line
 * elsewhere marked "scene palette:" (the phone's port of a PC scene carries that scene's pack colours, 2026-10-28).
 *
 * Exit 0 pass, 1 fail (each offender listed as file:line).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostDir = join(root, "targets", "win-host", "PrismHost");
const art = new Set(["Tableaus.cs", "StylePacks.cs", "StyleRenderer.cs", "Tokens.cs"]);
const retired = [
  [/F0A83C/i, "the old amber #F0A83C (Tokens.Amber is #F2B14C)"],
  [/0xF0, 0xA8, 0x3C/, "the old amber (use Tokens.Amber, Tokens.AmberAt(alpha) or Tokens.AmberColorAt(alpha))"],
  [/ECECF0/i, "the old rail ink #ECECF0 (Tokens.Ink)"],
  [/0xEC, 0xEC, 0xF0/, "the old rail ink (Tokens.Ink)"],
  [/9A9CA8/i, "the old rail dim #9A9CA8 (Tokens.Dim)"],
  [/0x9A, 0x9C, 0xA8/, "the old rail dim (Tokens.Dim or Tokens.DimColorAt(alpha))"],
  [/C0C8D2/i, "the old muted ink #C0C8D2 (Tokens.Ink)"],
  [/0xC0, 0xC8, 0xD2/, "the old muted ink (Tokens.Ink)"],
];

function files(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    if (n === "bin" || n === "obj") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if ((n.endsWith(".cs") || n.endsWith(".xaml")) && !art.has(n)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const f of files(hostDir)) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((l, i) => { if (l.includes("scene palette:")) return; for (const [re, why] of retired) if (re.test(l)) { offenders.push(`${relative(root, f)}:${i + 1}  ${why}`); break; } });
}

// the phone page: colour literals in its stylesheet live in :root only
const phone = join(hostDir, "Services", "RemotePage.cs");
const src = readFileSync(phone, "utf8");
const a = src.indexOf("<style>"), b = src.indexOf("</style>");
if (a >= 0 && b > a) {
  const before = src.slice(0, a).split(/\r?\n/).length;
  src.slice(a, b).split(/\r?\n/).forEach((l, i) => {
    const body = l.replace(/:root\{[^}]*\}/g, "");   // the :root rule is where the literals belong
    if (/#[0-9a-f]{6}\b/i.test(body)) offenders.push(`${relative(root, phone)}:${before + i}  a colour literal in the phone's stylesheet (use var(--ink), var(--amber), ... from :root)`);
  });
}

if (offenders.length) {
  console.log(`colours off the token sheet (${offenders.length}) - Tokens.cs on the PC, :root on the phone:`);
  for (const o of offenders) console.log("  " + o);
  process.exit(1);
}
console.log("every host colour is a token");
