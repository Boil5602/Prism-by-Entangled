#!/usr/bin/env node
/**
 * Host buttons keep their hover (2026-09-25; memory: hover-loss-tooltips). A WinUI Button with a Background colour of its own loses its hover look
 * ("lights up, then turns off") unless it owns its hover: it is made by Chip() or has OwnHover(name) called on it. This fails on any
 * `var x = new Button { ... Background = <a colour> ... };` in the host's sources that is followed by no OwnHover(x) within a few lines.
 * A see-through Background (HubClear, ClearHit, alpha 0) is fine - WinUI's own hover shows on those.
 *
 * Exit 0 pass, 1 fail (each offender listed as file:line).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostDir = join(root, "targets", "win-host", "PrismHost");
const clear = /Background\s*=\s*(HubClear|ClearHit|clear\b|null\b|new SolidColorBrush\(Windows\.UI\.Color\.FromArgb\((0|0x00),)/;

function files(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    if (n === "bin" || n === "obj") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (n.endsWith(".cs")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const f of files(hostDir)) {
  const s = readFileSync(f, "utf8");
  const re = /var (\w+) = new Button \{/g;
  let m;
  while ((m = re.exec(s))) {
    let depth = 0, q = m.index + m[0].length - 1;
    for (; q < s.length; q++) { if (s[q] === "{") depth++; else if (s[q] === "}" && --depth === 0) break; }
    const init = s.slice(m.index, q + 1);
    if (!/Background\s*=/.test(init) || clear.test(init)) continue;
    const after = s.slice(q, q + 600);
    if (after.includes(`OwnHover(${m[1]})`)) continue;
    const line = s.slice(0, m.index).split("\n").length;
    offenders.push(`${relative(root, f)}:${line}  ${m[1]}`);
  }
}
if (offenders.length) {
  console.log(`buttons with a colour of their own and no OwnHover (${offenders.length}) - build them with Chip() or call OwnHover(name):`);
  for (const o of offenders) console.log("  " + o);
  process.exit(1);
}
console.log("every coloured host button owns its hover");
