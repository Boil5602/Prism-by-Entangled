#!/usr/bin/env node
/*
  The doctor's proof (scripts/doctor, 2026-11-03): a proposed Veil rule run against the very dump it was written from, under
  happy-dom, before anyone accepts it. Dev tooling only; no network.

    node scripts/doctor/prove.mjs <proposal dir>                 the ask step's folder: proposal.json beside the dump
    node scripts/doctor/prove.mjs --dump=<dump.json> --rule=<rule.js> [--fixture=<fixture.json>]
    node scripts/doctor/prove.mjs --self-test                    a built-in dump and rule (the verify step)

  The dump's elements are rebuilt as a DOM (tags, ids, classes, data-* attributes, shadow roots, a data-rect on every box, the
  short labels as text), the shipped rules run on it, the proposed rule is added and they run again, and the difference is the
  answer: what the rule would newly cover, what it would take away, each with the rule's own `why`. The fixture the proposal
  carries runs too, as tests/rules.test.mjs would run it. Exit 0 when the fixture passes and the rule covers something on the
  dump (or --allow-none), else 1. The rule is code a model wrote, so it runs in a sandboxed child (Node --permission: read the
  repo and the dump's folder only, no writes, no processes, no sockets, no keys in the environment); see sandboxed() below.
*/
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const veilSrc = join(root, "prototypes", "prism-veil-extension", "src");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };

/** The Veil's detection modules loaded into this process the way tests/harness.mjs loads them under vitest: one happy-dom window
 *  made global, layout faked from data-rect, the four modules evaluated as classic scripts sharing window.__prismVeilNS. */
export function loadVeil({ host = "example.com", width = 1600, height = 900 } = {}) {
  const w = new Window({ url: "https://" + host + "/", width, height, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, disableComputedStyleRendering: true } });
  const names = new Set();
  for (let o = w; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  for (const k of names) {
    if (k === "window" || k === "self" || k === "globalThis" || k === "top" || k === "parent" || k === "constructor") continue;
    if (k === "setTimeout" || k === "clearTimeout" || k === "setInterval" || k === "clearInterval" || k === "queueMicrotask" || k === "console" || k === "process" || k === "fetch") continue;
    let v; try { v = w[k]; } catch { continue; }
    try { globalThis[k] = (typeof v === "function" && !/^[A-Z]/.test(k)) ? v.bind(w) : v; } catch { /* a read-only global */ }
  }
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.location = w.location;
  Object.defineProperty(globalThis, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(globalThis, "innerHeight", { value: height, configurable: true, writable: true });
  w.__prismVeilNS = undefined; w.__prismVeil = undefined;
  globalThis.chrome = w.chrome = { runtime: { getURL: (p) => "chrome-extension://test/" + p, getManifest: () => ({ version: "doctor" }), sendMessage: () => {}, onMessage: { addListener: () => {} } }, storage: { local: { get: (k, cb) => cb && cb({}), set: () => {} } } };
  const zero = { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  w.Element.prototype.getBoundingClientRect = function () {
    const a = this.getAttribute && this.getAttribute("data-rect");
    if (!a) return zero;
    const [x, y, wd, h] = a.split(",").map(Number);
    return { x, y, left: x, top: y, width: wd, height: h, right: x + wd, bottom: y + h };
  };
  if (w.Range) w.Range.prototype.getBoundingClientRect = function () { const n = this.startContainer; const el = n && n.nodeType === 3 ? n.parentElement : n; return el ? el.getBoundingClientRect() : zero; };
  for (const f of ["art.js", "dom.js", "rules.js", "video.js"]) (0, eval)(readFileSync(join(veilSrc, f), "utf8"));
  return w.__prismVeilNS;
}

/** The dump rebuilt as a DOM under document.body; each element carries data-dx = its index in the dump. */
export function buildFromDump(dump) {
  const els = new Array(dump.nodes.length);
  const body = document.body;
  body.innerHTML = "";
  for (let i = 0; i < dump.nodes.length; i++) {
    const n = dump.nodes[i];
    if (n.t === "html" || n.t === "body") { els[i] = n.t === "html" ? document.documentElement : body; continue; }
    const el = document.createElement(n.t === "svg" ? "svg" : n.t);
    if (n.i) el.id = n.i;
    if (n.c) el.className = n.c.join(" ");
    if (n.a) for (const [k, v] of Object.entries(n.a)) {
      if (typeof v !== "string") continue;
      if (v.startsWith("host:")) { if (n.t === "iframe" || n.t === "video" || n.t === "img" || n.t === "a") el.setAttribute(k, "https://" + v.slice(5) + "/"); continue; }
      if (v.startsWith("~")) continue;
      try { el.setAttribute(k, v); } catch { /* an attribute name the parser refuses */ }
    }
    if (n.r && !n.hid && n.r[2] > 0 && n.r[3] > 0) el.setAttribute("data-rect", n.r.join(","));
    if (n.pos) el.setAttribute("data-pos", n.pos);
    el.setAttribute("data-dx", String(i));
    if (n.x) el.appendChild(document.createTextNode(n.x));
    else if (n.n === "m" || n.n === "l") el.appendChild(document.createTextNode(n.n === "m" ? "text of some length here, kept out of the dump" : "a long run of text, kept out of the dump, standing in for the content the page carried in this element at the time of the dump"));
    els[i] = el;
    const parent = n.p >= 0 ? els[n.p] : null;
    if (!parent) { body.appendChild(el); continue; }
    if (n.sh) { if (!parent.shadowRoot) parent.attachShadow({ mode: "open" }); parent.shadowRoot.appendChild(el); }
    else parent.appendChild(el);
  }
  return els;
}

function describe(el, why) {
  const n = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
  const r = el.getAttribute("data-rect") || "no box";
  return `${n} [${r}] dx=${el.getAttribute("data-dx") ?? "-"}  <- ${why}`;
}

function collect(PV) {
  const { targets, why } = PV.collectTargets();
  const m = new Map();
  for (const t of targets) m.set(t, why.get(t) || "");
  return m;
}

export function prove({ dump, ruleCode, fixture, allowNone = false, log = console.log }) {
  const host = dump.host || "example.com";
  const [vw, vh] = dump.viewport || [1600, 900];
  const PV = loadVeil({ host, width: vw, height: vh });
  let rule = null;
  if (ruleCode) {
    rule = (0, eval)("(" + ruleCode.trim().replace(/^[\s,]*|[\s,;]*$/g, "") + ")");
    if (!rule || typeof rule.run !== "function" || !rule.id) throw new Error("the rule must be an object { id, host?, run(root, ctx) }");
    if (rule.host && !(rule.host instanceof RegExp)) rule.host = new RegExp(rule.host, "i");
    if (rule.host && !rule.host.test(host)) log(`note: the rule's host ${rule.host} does not match the dump's host ${host}; it would not run there`);
  }
  let ok = true;
  // ---- the dump, before and after
  buildFromDump(dump);
  const before = collect(PV);
  let after = before;
  if (rule) { PV.SITE_RULES.push(rule); after = collect(PV); }
  const added = [...after].filter(([el]) => !before.has(el));
  const lost = [...before].filter(([el]) => !after.has(el));
  const changed = [...after].filter(([el, w]) => before.has(el) && before.get(el) !== w);
  log(`dump ${dump.page || host}: ${dump.nodes.length} elements; the shipped rules cover ${before.size} (the live page showed ${dump.covers?.length ?? "?"} Veil covers)`);
  if (rule) {
    log(`rule "${rule.id}": +${added.length} covered, -${lost.length} lost, ${changed.length} re-attributed`);
    for (const [el, w] of added) log("  + " + describe(el, w));
    for (const [el, w] of lost) log("  - " + describe(el, w));
    for (const [el, w] of changed) log("  ~ " + describe(el, w) + " (was: " + before.get(el) + ")");
    if (added.length === 0 && !allowNone) {
      ok = false; log("  the rule covers nothing on this dump that the shipped rules do not cover already:");
      for (const [el, w] of before) log("    = " + describe(el, w));
    }
    if (lost.length) { ok = false; log("  the rule takes covers away from the shipped rules; a rule adds, never removes"); }
    // nothing page-sized
    for (const [el, w] of added) { const r = el.getBoundingClientRect(); if (PV.pageSized(r)) { ok = false; log("  ! page-sized cover: " + describe(el, w)); } }
  }
  // ---- the fixture, as the test suite runs one
  if (fixture && fixture.html) {
    document.body.innerHTML = fixture.html;
    const got = [...collect(PV).keys()].map((t) => t.id || "(no id)").sort();
    const want = [...(fixture.expectIds || [])].sort();
    const same = JSON.stringify(got) === JSON.stringify(want);
    const stray = (fixture.notCoveredIds || []).filter((id) => got.includes(id));
    log(`fixture: covered ${JSON.stringify(got)}, expected ${JSON.stringify(want)}${stray.length ? ", must not cover " + JSON.stringify(stray) : ""} -> ${same && !stray.length ? "pass" : "FAIL"}`);
    if (!same || stray.length) ok = false;
  } else if (rule) log("fixture: none in the proposal");
  if (rule) PV.SITE_RULES.pop();
  return ok;
}

const SELF_DUMP = {
  host: "example-feed.test", page: "example-feed.test/", viewport: [1600, 900], covers: [],
  nodes: [
    { t: "html", p: -1, d: 0, r: [0, 0, 1600, 3000] }, { t: "body", p: 0, d: 1, r: [0, 0, 1600, 3000] },
    { t: "main", p: 1, d: 2, i: "feed", r: [300, 0, 1000, 3000] },
    { t: "article", p: 2, d: 3, i: "post1", c: ["card"], r: [300, 0, 1000, 400], n: "l" },
    { t: "x-promo-card", p: 2, d: 3, i: "promo", c: ["card"], a: { "data-promo": "1" }, r: [300, 420, 1000, 400], host: 1 },
    { t: "div", p: 4, d: 4, c: ["label"], r: [310, 430, 60, 16], x: "Partner story", sh: 1 },   // not a word the shipped label walker takes: the rule alone must cover the card
    { t: "article", p: 2, d: 3, i: "post2", c: ["card"], r: [300, 840, 1000, 400], n: "l" },
    { t: "aside", p: 1, d: 2, i: "rail", r: [1320, 0, 280, 3000] },
    { t: "ins", p: 7, d: 3, i: "slot", c: ["adsbygoogle"], r: [1320, 0, 280, 250] },
  ],
};
const SELF_ADAPTER_DUMP = {
  kind: "adapter-page", host: "player.test", surface: "self-test", adapter: "self", viewport: [944, 1028], covers: [],
  nodes: [
    { t: "html", p: -1, d: 0, r: [0, 0, 944, 1028] }, { t: "body", p: 0, d: 1, r: [0, 0, 944, 1028] },
    { t: "main", p: 1, d: 2, r: [0, 0, 944, 900] },
    { t: "div", p: 2, d: 3, c: ["card"], r: [0, 0, 300, 300] }, { t: "div", p: 2, d: 3, c: ["card"], r: [310, 0, 300, 300] },
    { t: "x-player", p: 1, d: 2, a: { "data-player": "1" }, r: [0, 900, 944, 128], host: 1 },
    { t: "button", p: 5, d: 3, c: ["next"], r: [500, 940, 40, 40], sh: 1 },
  ],
};
const SELF_RULE = `{
  id: "example-promo", host: /(^|\\.)example-feed\\.test$/i,
  run: function (root, ctx) { root.querySelectorAll("x-promo-card[data-promo]").forEach(function (el) { ctx.add(el, "example-promo", true); }); },
}`;
const SELF_FIXTURE = { html: `<x-promo-card id="p1" data-promo="1" data-rect="0,0,600,300"></x-promo-card><article id="a1" data-rect="0,320,600,300">story</article>`, expectIds: ["p1"], notCoveredIds: ["a1"] };

/** The proposed rule is code a model wrote from what a page showed it, run here before any person has read it. So the run happens
 *  in a child of this process under Node's permission model: it may read the repo and the dump's folder and nothing else, cannot
 *  write, spawn or open a socket, and sees an environment with no keys (ANTHROPIC_*, AWS_*, AMO_* and the like removed). The
 *  developer still reads rule.js before moving it into src/rules.js; this only keeps a bad proposal from doing more than fail. */
function sandboxed(extraReadDirs) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/KEY|TOKEN|SECRET|PASSWORD|^AWS_|^AMO_|^ANTHROPIC_|^GITHUB_|^NPM_/i.test(k)) env[k] = v;
  env.PRISM_DOCTOR_SANDBOXED = "1";
  const nodeArgs = ["--permission", "--allow-fs-read=" + root, ...extraReadDirs.filter(Boolean).map((d) => "--allow-fs-read=" + d), "--no-warnings", fileURLToPath(import.meta.url), ...args];
  const r = spawnSync(process.execPath, nodeArgs, { stdio: "inherit", env });
  if (r.error) { console.log("could not start the sandboxed run: " + r.error.message); process.exit(1); }
  process.exit(r.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.PRISM_DOCTOR_SANDBOXED !== "1") {
    const dir = args.find((a) => !a.startsWith("--"));
    sandboxed([dir && resolve(dir), opt("--dump", null) && dirname(resolve(opt("--dump", null))), opt("--rule", null) && dirname(resolve(opt("--rule", null))), opt("--fixture", null) && dirname(resolve(opt("--fixture", null)))]);
  }
  let ok;
  if (flag("--self-test")) {
    ok = prove({ dump: SELF_DUMP, ruleCode: SELF_RULE, fixture: SELF_FIXTURE });
    // the slot selector alone must already cover the rail's ins.adsbygoogle: the shipped rules run under this loader
    const PV = loadVeil({ host: "example-feed.test" }); buildFromDump(SELF_DUMP);
    const base = [...collect(PV).keys()].map((t) => t.id);
    if (!base.includes("slot")) { ok = false; console.log("self-test: the shipped slot selector did not cover #slot under the loader: " + JSON.stringify(base)); }
    // the adapter proof on a built-in page: a change that names a real marker passes, one that names nothing fails
    const { proveAdapter } = await import("./prove-adapter.mjs");
    const quiet = () => {};
    const adp = { selectors: { player: "#old-player", list: "main .card" }, controls: { next: "x-player >>> button.next" } };
    const good = proveAdapter({ dump: SELF_ADAPTER_DUMP, adapter: adp, changes: [{ path: "selectors.player", value: "x-player[data-player]", why: "renamed" }], log: quiet, loadVeil, buildFromDump });
    const bad = proveAdapter({ dump: SELF_ADAPTER_DUMP, adapter: adp, changes: [{ path: "selectors.player", value: "#still-missing", why: "a guess" }], log: quiet, loadVeil, buildFromDump });
    if (!good || bad) { ok = false; console.log("self-test: the adapter proof judged wrongly (good " + good + ", bad " + bad + ")"); }
    console.log(ok ? "doctor self-test: pass" : "doctor self-test: FAIL");
  } else {
    const dir = args.find((a) => !a.startsWith("--"));
    let dumpPath = opt("--dump", null), rulePath = opt("--rule", null), fixturePath = opt("--fixture", null), proposal = null;
    if (dir) {
      const pj = join(resolve(dir), "proposal.json");
      if (!existsSync(pj)) { console.log("no proposal.json in " + dir); process.exit(2); }
      proposal = JSON.parse(readFileSync(pj, "utf8"));
      dumpPath = dumpPath || proposal.dump || join(resolve(dir), "dump.json");
    }
    if (!dumpPath) { console.log("usage: node scripts/doctor/prove.mjs <proposal dir> | --dump=<dump.json> --rule=<rule.js> [--fixture=<fixture.json>] | --self-test"); process.exit(2); }
    const dump = JSON.parse(readFileSync(resolve(dumpPath), "utf8"));
    if (dump.kind === "adapter-page") {
      // the adapter format (prove-adapter.mjs): selectors counted on the hidden page's dump, before and after the proposed changes
      const { proveAdapter, readAdapter } = await import("./prove-adapter.mjs");
      const name = opt("--adapter", proposal?.adapter || dump.adapter);
      const cj = dir ? join(resolve(dir), "changes.json") : null;
      const changes = proposal?.changes || (cj && existsSync(cj) ? JSON.parse(readFileSync(cj, "utf8")) : []);
      if (!changes.length) console.log("no changes proposed: the adapter health check on the dump");
      ok = proveAdapter({ dump, adapter: readAdapter(root, name), changes, loadVeil, buildFromDump });
      console.log(ok ? "proof: pass" : "proof: FAIL");
      process.exit(ok ? 0 : 1);
    }
    const ruleCode = rulePath ? readFileSync(resolve(rulePath), "utf8") : proposal?.rule?.code ?? null;
    const fixture = fixturePath ? JSON.parse(readFileSync(resolve(fixturePath), "utf8")) : proposal?.fixture ?? null;
    if (!ruleCode) console.log("no rule to add: reporting what the shipped rules cover on the dump");
    ok = prove({ dump, ruleCode, fixture, allowNone: flag("--allow-none") });
    console.log(ok ? "proof: pass" : "proof: FAIL");
  }
  process.exit(ok ? 0 : 1);
}
