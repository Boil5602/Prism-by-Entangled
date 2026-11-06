// The page of what the doctor found that wants a person (2026-11-04): every night's run read back (triage anomalies, selectors
// matching nothing, gate rows that did not pass), folded across nights, newest first, into one local page. Handled items are ticked
// on the page and remembered in the browser (localStorage; the page is static and carries nothing out). The night run writes it last.
//
//   node scripts/doctor/attention.mjs        writes scripts/doctor/out/attention.html and prints its address
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = join("scripts", "doctor", "out");
const nights = existsSync(OUT) ? readdirSync(OUT).filter((n) => /^nightly-\d{8}$/.test(n)).sort().reverse() : [];
const day = (n) => n.slice(8, 12) + "-" + n.slice(12, 14) + "-" + n.slice(14, 16);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

const anomalies = [];   // one per night and finding
const selectors = new Map();   // key surface|name -> {surface, adapter, name, selector, nights: []}
const gate = new Map();   // row -> {row, verdict, seen, nights: [], latest}
for (const n of nights) {
  const dir = join(OUT, n);
  const t = read(join(dir, "triage", "triage.json"));
  if (t) {
    try {
      const j = JSON.parse(t);
      for (const a of j.anomalies ?? []) if (a.severity === "look-now" || a.severity === "worth-a-look") anomalies.push({ night: n, key: `${n}|anomaly|${a.when}|${a.subsystem}`, ...a });
    } catch { /* a night without a parsable triage */ }
  }
  for (const h of readdirSync(dir).filter((x) => x.startsWith("health-"))) {
    const txt = read(join(dir, h, "health.txt")); if (!txt) continue;
    const surface = h.slice(7);
    const adapter = (/adapter ([a-z0-9-]+):/.exec(txt) ?? [])[1] ?? "";
    for (const line of txt.split("\n")) {
      const m = /^\s+0 ([\w.-]+): 0\s+(.*)$/.exec(line); if (!m) continue;   // a "~" line is state-bound, not judged on a dump (prove-adapter.mjs)
      if (/login|signin|sign-in|signedout|account\.signin/i.test(m[1])) continue;   // a sign-in control matching nothing on a signed-in page is expected
      const key = `${surface}|${m[1]}`;
      const e = selectors.get(key) ?? { key: `selector|${key}`, surface, adapter, name: m[1], selector: m[2], nights: [] };
      e.nights.push(n); selectors.set(key, e);
    }
  }
  const g = read(join(dir, "gate", "report.md"));
  if (g) for (const line of g.split("\n")) {
    const m = /^\| ([A-Z]{2}-\d+) \| (pass|fail|cannot-tell|person) \| (\d+) \| (.*?) \|?\s*$/.exec(line); if (!m) continue;
    const e = gate.get(m[1]) ?? { key: `gate|${m[1]}`, row: m[1], nights: [], latest: null };
    e.nights.push({ night: n, verdict: m[2], covers: m[3], seen: m[4] });
    if (!e.latest) e.latest = e.nights[0];
    gate.set(m[1], e);
  }
}
const openGate = [...gate.values()].filter((e) => e.latest && e.latest.verdict !== "pass" && e.latest.verdict !== "person");
const personGate = [...gate.values()].filter((e) => e.latest && e.latest.verdict === "person");

// the ad SDK builds (sdk-watch.mjs): a change in the last fourteen days is an item; a hooked name missing from the new build is "look now"
const sdkChanges = (() => { try { return JSON.parse(readFileSync(join(OUT, "sdk", "changes.json"), "utf8")); } catch { return []; } })()
  .filter((c) => Date.now() - Date.parse(c.at) < 14 * 86400e3);
const sdkState = (() => { try { return JSON.parse(readFileSync(join(OUT, "sdk", "state.json"), "utf8")); } catch { return {}; } })();

// promo examples gathered for the next retraining (2026-11-04): the hand-marked days' promos and the sampler's nights', by day, against the
// target the owner and Claude set (about three times the first three days' 3.1 hours before retraining with promos as show)
const promoDays = (() => {
  const G = join(process.env.LOCALAPPDATA || "", "Prism", "diagnostics", "golden"); const rows = [];
  const secs = (l) => (l || []).reduce((n, [a, b]) => { const f = (x) => x.split(":").reduce((t, v) => t * 60 + Number(v), 0); return n + Math.max(0, f(b) - f(a)); }, 0);
  try {
    for (const d of readdirSync(G).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort()) {
      let hand = 0, auto = 0, streaming = 0;
      try { hand = Object.values(JSON.parse(readFileSync(join(G, d, "labels.promos.json"), "utf8")).windows).reduce((n, w) => n + secs(w.promos), 0); } catch {}
      try { auto = Object.values(JSON.parse(readFileSync(join(G, d, "labels.auto.json"), "utf8")).windows).reduce((n, w) => n + secs(w.promos), 0); } catch {}
      // the promo time sorted again as a streaming service's advertising or a commercial (2026-11-05) is covered, so it is no promo example
      try { streaming = Object.values(JSON.parse(readFileSync(join(G, d, "labels.promos-recheck.json"), "utf8")).windows).reduce((n, w) => n + secs(w.ads), 0); } catch {}
      if (hand || auto) rows.push({ d, hand: Math.max(0, hand - streaming), auto: Math.max(0, auto - streaming) });
    }
  } catch {}
  return rows;
})();
const promoTotal = promoDays.reduce((n, r) => n + Math.max(r.hand, r.auto), 0);
// the live score and the closing promos (livescore.py, run by the night before this page, 2026-11-05): what Prism covered each sampled day
// against the day's automatic labels, and the promos that end a break - the examples the retraining needs most, counted apart against three
// times the hand-marked days' own
let live = { live: {}, hand: {} };
try { live = JSON.parse(readFileSync(join(OUT, "livescore.json"), "utf8")); } catch {}
const handClosing = Object.values(live.hand || {}).reduce((n, h) => n + (h.closing || 0), 0);
// the promo hours' target follows the hand-marked days' own promo time as it is now sorted (2026-11-05: the streaming and filler re-sorts
// moved much of it to ads, so three times the old 3.1 h asked for more than the same rule does today); 3 x 11194 s before any livescore
const handPromo = Object.values(live.hand || {}).reduce((n, h) => n + (h.promo_s || 0), 0), PROMO_TARGET = handPromo ? 3 * handPromo : 3 * 11194;
const closingTotal = handClosing + Object.values(live.live || {}).reduce((n, r) => n + (r.closing || 0), 0), CLOSING_TARGET = 3 * handClosing;

// the spend, for the top line (the same sums as spend.mjs)
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
let calls = 0, cost = 0;
const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/^usage.*\.json$/.test(name)) { try { const u = JSON.parse(readFileSync(p, "utf8")).usage ?? {}; calls++; cost += ((u.input_tokens ?? 0) * PRICE.input + (u.output_tokens ?? 0) * PRICE.output + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) / 1e6; } catch { /* not a record */ } } } };
if (existsSync(OUT)) walk(OUT);

const item = (key, head, body, meta) => `<li class="item" data-key="${esc(key)}"><label><input type="checkbox" class="done"> <span class="head">${head}</span></label><div class="body">${body}</div>${meta ? `<div class="meta">${meta}</div>` : ""}</li>`;
const fileLink = (p, text) => `<a href="file:///${esc(resolve(p).replace(/\\/g, "/"))}">${esc(text)}</a>`;
const sections = [];
const lookNow = anomalies.filter((a) => a.severity === "look-now"), worth = anomalies.filter((a) => a.severity === "worth-a-look");
const anomalyItem = (a) => item(a.key, `<b>${esc(day(a.night))} ${esc(a.when)}</b> &middot; ${esc(a.subsystem)}: ${esc(a.what)}`, `${esc(a.evidence)}${a.next ? `<div class="next">Next: ${esc(a.next)}</div>` : ""}`, fileLink(join(OUT, a.night, "triage", "triage.md"), "the night's triage"));
const sdkItem = (c) => item(`sdk|${c.name}|${c.at}`, `<b>${esc(c.name)}</b> changed ${esc(c.at.slice(0, 10))} &middot; ${esc(c.from.version ?? "?")} &rarr; ${esc(c.to.version ?? "?")}${c.missing.length ? ` &middot; <b>missing: ${esc(c.missing.join(", "))}</b>` : " &middot; every hooked name present"}`, c.missing.length ? "A name ima-hook.js relies on is not in the new build: read the build and play a hooked site in the harness before the next Veil release." : "Play a hooked site in the harness (Paramount+ for DAI, CNN for IMA) before the next Veil release; the names the hook relies on are all there.", fileLink(join(OUT, "sdk", `${c.name}-${c.at.slice(0, 10)}.js`), "the new build"));
const sdkLook = sdkChanges.filter((c) => c.missing.length), sdkNote = sdkChanges.filter((c) => !c.missing.length);
sections.push(`<h2>Look now <span class="n">${lookNow.length + sdkLook.length}</span></h2><ul>${[...sdkLook.map(sdkItem), ...lookNow.map(anomalyItem)].join("") || "<li class='none'>nothing</li>"}</ul>`);
sections.push(`<h2>Ad SDK builds <span class="n">${sdkNote.length}</span></h2><p class="hint">Google's IMA and DAI SDKs, fetched each night and compared (sdk-watch.mjs). Watched: ${esc(Object.entries(sdkState).map(([n, s]) => `${n} ${s.version ?? "?"} since ${s.at.slice(0, 10)}`).join("; ") || "nothing yet")}.</p><ul>${sdkNote.map(sdkItem).join("") || "<li class='none'>no change in fourteen days</li>"}</ul>`);
sections.push(`<h2>Selectors matching nothing <span class="n">${selectors.size}</span></h2><p class="hint">A selector in an adapter that found no element on the hidden page's dump. Read it against the page (docs/doctor.md); a sign-in control on a signed-in page is left out.</p><ul>${[...selectors.values()].sort((a, b) => b.nights.length - a.nights.length).map((e) => item(e.key, `<b>${esc(e.adapter)}</b> ${esc(e.name)} &middot; ${e.nights.length} night${e.nights.length === 1 ? "" : "s"}, since ${esc(day(e.nights[e.nights.length - 1]))}`, `<code>${esc(e.selector)}</code>`, `${esc(e.surface)} &middot; ${fileLink(join(OUT, e.nights[0], "health-" + e.surface, "health.txt"), "the latest check")}`)).join("") || "<li class='none'>nothing</li>"}</ul>`);
sections.push(`<h2>Release gate rows not passing <span class="n">${openGate.length}</span></h2><p class="hint">Judged by vision on a signed-out headless Firefox; evidence for the person walking the matrix, not a mark.</p><ul>${openGate.map((e) => item(e.key, `<b>${esc(e.row)}</b> ${esc(e.latest.verdict)} &middot; ${e.latest.covers} covers &middot; ${esc(day(e.latest.night))}`, esc(e.latest.seen), fileLink(join(OUT, e.latest.night, "gate", e.row + ".png"), "the screenshot") + " &middot; " + fileLink(join(OUT, e.latest.night, "gate", "report.md"), "the report"))).join("") || "<li class='none'>nothing</li>"}</ul>`);
sections.push(`<h2>Gate rows for a person on a real browser <span class="n">${personGate.length}</span></h2><p class="hint">A headless signed-out browser cannot reach these states; the matrix walk (docs/veil-release-checklist.md) judges them.</p><ul class="plain">${personGate.map((e) => `<li><b>${esc(e.row)}</b> &middot; ${esc(e.latest.seen.split(". ")[0])} &middot; ${fileLink(join(OUT, e.latest.night, "gate", e.row + ".png"), "the latest screenshot")}</li>`).join("") || "<li class='none'>none</li>"}</ul>`);
sections.push(`<h2>Worth a look <span class="n">${worth.length}</span></h2><ul>${worth.map(anomalyItem).join("") || "<li class='none'>nothing</li>"}</ul>`);
sections.push(`<h2>Promo examples for the next retraining <span class="n">${(promoTotal / 3600).toFixed(1)} of ${(PROMO_TARGET / 3600).toFixed(1)} h</span></h2><p class="hint">Network promos the doctor has told apart from commercials, by day; a retraining with promos as show waits for about three times the first three days'. ${promoTotal >= PROMO_TARGET ? "<b>Enough now: ask Claude to retrain.</b>" : ""}</p><ul class="plain">${promoDays.map((r) => `<li>${esc(r.d)} &middot; ${Math.round(Math.max(r.hand, r.auto) / 60)} min${r.auto ? " (sampled)" : ""}</li>`).join("") || "<li class='none'>none yet</li>"}</ul>`);
sections.push(`<h2>Closing promos <span class="n">${closingTotal} of ${CLOSING_TARGET}</span></h2><p class="hint">Promos that end a break, just before the show returns: the covers stay on through them, and the retraining needs them most. Counted from the hand-marked days and the sampled days of the last week. ${closingTotal >= CLOSING_TARGET && promoTotal >= PROMO_TARGET ? "<b>Both counts are in: ask Claude to retrain.</b>" : "The retraining waits for this count and the promo hours above."}</p>`);
sections.push(`<h2>Live covers <span class="n">${Object.keys(live.live || {}).length} days</span></h2><p class="hint">What Prism covered on each sampled day, against that day's automatic labels: of the covered time inside labelled spans, the share that was commercial, promo, show or unsure, and how much of the labelled commercial time was covered. A drop the morning after a change is the change. The labels reach only the spans some model covered, so a break nobody covered is never counted missed.</p><table class="plain"><tr><th>Day</th><th>Covered</th><th>Commercial</th><th>Promo</th><th>Show</th><th>Commercial time covered</th></tr>${Object.entries(live.live || {}).sort().reverse().map(([d, r]) => `<tr><td>${esc(d)}</td><td>${(r.covered / 3600).toFixed(1)} h</td><td>${r.commercial}%</td><td>${r.promo}%</td><td>${r.show}%</td><td>${r.commercial_covered}%</td></tr>`).join("") || "<tr><td colspan='6'>no sampled day yet</td></tr>"}</table>`);
sections.push(`<h2>The nights</h2><ul class="plain">${nights.map((n) => `<li>${esc(day(n))} &middot; ${fileLink(join(OUT, n, "summary.md"), "summary")}</li>`).join("") || "<li class='none'>no night run yet</li>"}</ul>`);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prism doctor: attention</title>
<style>
:root { --ink: #E8ECF2; --dim: #8A93A2; --amber: #F2B14C; --ground: #14171C; --card: #1C2027; --line: #2A2F38; }
body { margin: 0; padding: 24px 16px 60px; background: var(--ground); color: var(--ink); font: 15px/1.45 system-ui, Segoe UI, sans-serif; max-width: 960px; margin-inline: auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; color: var(--amber); } h2 .n { color: var(--dim); font-weight: normal; margin-left: 6px; }
.top { color: var(--dim); margin-bottom: 8px; } .hint { color: var(--dim); font-size: 13px; margin: 0 0 8px; }
ul { list-style: none; padding: 0; margin: 0; } li.item { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 0 0 8px; }
li.item.handled { opacity: .45; } li.item.handled .body, li.item.handled .meta { display: none; } li.none { color: var(--dim); padding: 4px 0; }
label { cursor: pointer; } input.done { accent-color: var(--amber); margin-right: 6px; } .body { color: var(--ink); margin: 6px 0 0 24px; font-size: 14px; white-space: pre-wrap; }
.next { color: var(--amber); margin-top: 4px; } .meta { color: var(--dim); font-size: 12.5px; margin: 6px 0 0 24px; } a { color: var(--amber); } code { color: var(--ink); background: #0f1216; padding: 1px 4px; border-radius: 3px; }
ul.plain li { padding: 2px 0; } .toggle { color: var(--dim); font-size: 13px; cursor: pointer; margin-left: 10px; }
</style></head><body>
<h1>Prism doctor: what wants a person</h1>
<div class="top">Written ${esc(new Date().toLocaleString())} from ${nights.length} night${nights.length === 1 ? "" : "s"} &middot; ${calls} model calls so far, about $${cost.toFixed(2)} at list price (<code>node scripts/doctor/spend.mjs</code>) &middot; tick an item when handled; the tick lives in this browser
<span class="toggle" id="showHandled">show handled</span></div>
${sections.join("\n")}
<script>
(function () {
  var KEY = "prism-doctor-attention";
  var done = {}; try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { done = {}; }
  var items = document.querySelectorAll("li.item"); var showAll = false;
  function paint() { items.forEach(function (li) { var k = li.getAttribute("data-key"); var h = !!done[k]; li.classList.toggle("handled", h); li.querySelector("input.done").checked = h; li.style.display = h && !showAll ? "none" : ""; }); }
  items.forEach(function (li) { li.querySelector("input.done").addEventListener("change", function (e) { var k = li.getAttribute("data-key"); if (e.target.checked) done[k] = new Date().toISOString(); else delete done[k]; try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (x) {} paint(); }); });
  document.getElementById("showHandled").addEventListener("click", function () { showAll = !showAll; this.textContent = showAll ? "hide handled" : "show handled"; paint(); });
  paint();
})();
</script>
</body></html>
`;
const out = join(OUT, "attention.html");
writeFileSync(out, html);
console.log("written " + out);
console.log("bookmark: file:///" + resolve(out).replace(/\\/g, "/"));
console.log(`${lookNow.length} look now, ${selectors.size} selectors, ${openGate.length} gate rows, ${worth.length} worth a look`);
