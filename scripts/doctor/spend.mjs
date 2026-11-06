// The record of every model call the doctor has made (2026-11-04): model.mjs writes usage.json beside each call's prompt; this sums them by job and prints
// the tokens and the list-price cost. The console (console.anthropic.com, Usage) is the authority for the balance; this is the project's
// own ledger, by call, so a job's cost can be read before the next one is spent.
//
//   node scripts/doctor/spend.mjs            the table, by job family and in all
//   node scripts/doctor/spend.mjs --calls    every call
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = join("scripts", "doctor", "out");
// list prices per million tokens for the model the doctor uses (claude-opus-5-5); a different model's usage.json names itself and is priced the same here, which is noted
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/^usage.*\.json$/.test(name)) acc.push(p);
  }
  return acc;
}
const family = (p) => {
  const job = p.split(/[\\/]/)[3] ?? p;
  const m = /^(label|triage|gate|election-exam|train|msn\.com|[a-z-]+-home-16x9-XL)/.exec(job);
  return m ? m[1].replace(/-home-16x9-XL$/, " (adapter)") : job.replace(/-\d{8}-\d{4}$/, "");
};
const rows = [];
for (const p of walk(OUT)) {
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    const u = j.usage ?? j;
    rows.push({ p, family: family(p), at: j.at ?? "", model: j.model ?? "", input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
  } catch { /* not a usage record */ }
}
const cost = (r) => (r.input * PRICE.input + r.output * PRICE.output + r.cacheRead * PRICE.cacheRead + r.cacheWrite * PRICE.cacheWrite) / 1e6;
const sum = (list) => list.reduce((a, r) => ({ calls: a.calls + 1, input: a.input + r.input, output: a.output + r.output, cacheRead: a.cacheRead + r.cacheRead, cacheWrite: a.cacheWrite + r.cacheWrite, cost: a.cost + cost(r) }), { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "K" : String(n);
const line = (name, s) => `${name.padEnd(22)} ${String(s.calls).padStart(5)} ${fmt(s.input).padStart(8)} ${fmt(s.output).padStart(8)} ${fmt(s.cacheRead).padStart(9)} ${fmt(s.cacheWrite).padStart(9)}   $${s.cost.toFixed(2)}`;
console.log(`${"job".padEnd(22)} ${"calls".padStart(5)} ${"input".padStart(8)} ${"output".padStart(8)} ${"cache rd".padStart(9)} ${"cache wr".padStart(9)}   list price`);
if (process.argv.includes("--calls")) {
  for (const r of rows.sort((a, b) => a.at.localeCompare(b.at))) console.log(line((r.at.slice(5, 16) + " " + r.family).slice(0, 22), sum([r])));
} else {
  const fams = new Map();
  for (const r of rows) fams.set(r.family, [...(fams.get(r.family) ?? []), r]);
  for (const [f, list] of [...fams].sort((a, b) => sum(b[1]).cost - sum(a[1]).cost)) console.log(line(f, sum(list)));
}
const all = sum(rows);
console.log(line("all", all));
const models = [...new Set(rows.map((r) => r.model))].filter(Boolean);
console.log(`\nmodel${models.length > 1 ? "s" : ""}: ${models.join(", ")}; prices per million: input $${PRICE.input}, output $${PRICE.output}, cache read $${PRICE.cacheRead}, cache write $${PRICE.cacheWrite}. The console's Usage page is the balance.`);
