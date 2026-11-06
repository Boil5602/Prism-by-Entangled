/*
  The doctor's proof for the ADAPTER format (scripts/doctor, 2026-11-03, roadmap item 2): an adapter's selectors counted against a
  dump of the host's hidden page (dump-tile.mjs), before and after the proposed changes. No code runs here: a change is a JSON path
  and a value. A selector that names an element is proven by the count; a page-side script is listed as unproven and left to the
  reader. With no proposal at all this is the adapter health check (roadmap item 7): every selector, and the ones that match nothing.

  Selectors are read the way the host reads them: a plain selector in the light DOM; `a >>> b` as b inside the shadow root of each a
  (the host's deep query); and when a plain selector matches nothing in the light DOM, the count inside open shadow roots is shown
  beside it, as a hint and not a match.
*/
import { readFileSync } from "node:fs";
// no import of prove.mjs: it imports this module while its own top level is still running (a cycle that deadlocked the self-test,
// 2026-11-03), so the DOM loader and the dump builder come in as arguments

/** Every selector-valued string in an adapter, by JSON path: selectors.*, controls.*, loginPress, account.name, and any key named selector. */
export function selectorPaths(adapter) {
  const out = [];
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o || {})) {
      const p = path ? path + "." + k : k;
      if (typeof v === "string") {
        const top = p.split(".")[0];
        if (top === "selectors" || top === "controls" || p === "loginPress" || p === "account.name" || /(^|\.)selector$/i.test(p) || /Selector$/.test(k)) out.push({ path: p, selector: v });
      } else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p);
    }
  };
  walk(adapter, "");
  return out;
}

export function deepQuery(root, selector) {
  const parts = selector.split(">>>").map((s) => s.trim()).filter(Boolean);
  let scope = [root];
  for (let i = 0; i < parts.length; i++) {
    const next = [];
    for (const r of scope) {
      const base = i === 0 ? r : (r.shadowRoot || r);
      let found; try { found = [...base.querySelectorAll(parts[i])]; } catch { return { error: "not a selector the DOM accepts" }; }
      next.push(...found);
    }
    scope = next;
    if (!scope.length) break;
  }
  return { count: scope.length };
}

/** The same selector looked for inside every open shadow root (a hint when the light DOM has nothing). */
export function shadowCount(root, selector) {
  if (selector.includes(">>>")) return 0;
  let n = 0;
  const roots = [root]; let i = 0;
  while (i < roots.length) { const r = roots[i++]; for (const e of r.querySelectorAll("*")) if (e.shadowRoot) { roots.push(e.shadowRoot); try { n += e.shadowRoot.querySelectorAll(selector).length; } catch { return 0; } } }
  return n;
}

export function getPath(o, path) { return path.split(".").flatMap((p) => p.split("[").map((q) => q.replace("]", ""))).reduce((a, k) => (a == null ? a : a[k]), o); }
export function setPath(o, path, value) {
  const keys = path.split(".").flatMap((p) => p.split("[").map((q) => q.replace("]", ""))).filter(Boolean);
  let a = o;
  for (let i = 0; i < keys.length - 1; i++) { if (a[keys[i]] == null || typeof a[keys[i]] !== "object") a[keys[i]] = /^[0-9]+$/.test(keys[i + 1]) ? [] : {}; a = a[keys[i]]; }
  if (value === null) delete a[keys[keys.length - 1]]; else a[keys[keys.length - 1]] = value;
}

const looksLikeScript = (v) => typeof v === "string" && /function|=>|return |document\.|window\./.test(v);

/** @returns true when every changed selector matches at least one element on the dump and nothing proven before is lost. */
export function proveAdapter({ dump, adapter, changes = [], log = console.log, loadVeil, buildFromDump }) {
  const [vw, vh] = dump.viewport || [944, 1028];
  loadVeil({ host: dump.host || "example.test", width: vw, height: vh });
  buildFromDump(dump);
  const root = document;
  const before = selectorPaths(adapter);
  const after = JSON.parse(JSON.stringify(adapter));
  const unproven = [];
  for (const c of changes || []) {
    if (looksLikeScript(c.value) || looksLikeScript(getPath(adapter, c.path))) { unproven.push(c); continue; }
    setPath(after, c.path, c.value);
  }
  const afterPaths = selectorPaths(after);
  const countOf = (sel) => { const q = deepQuery(root, sel); return q.error ? { error: q.error } : { count: q.count, shadow: q.count === 0 ? shadowCount(root, sel) : 0 }; };
  let ok = true;
  log(`dump ${dump.page || dump.host} (${dump.surface || "page"}): ${dump.nodes.length} elements; adapter ${dump.adapter || "?"}: ${before.length} selectors${changes.length ? ", " + changes.length + " proposed changes" : ""}`);
  const changedPaths = new Set((changes || []).map((c) => c.path));
  const fmt = (r) => r.error ? "(" + r.error + ")" : r.count + (r.shadow ? " (0 in the light DOM, " + r.shadow + " inside shadow roots)" : "");
  for (const { path, selector } of before) {
    const b = countOf(selector);
    const a = afterPaths.find((x) => x.path === path);
    if (changedPaths.has(path)) {
      const ar = a ? countOf(a.selector) : { count: 0 };
      log(`  ~ ${path}: ${fmt(b)} -> ${fmt(ar)}   ${selector}  =>  ${a ? a.selector : "(removed)"}`);
      if (a && (ar.error || ar.count === 0)) { ok = false; log("    ! the changed selector matches nothing on this dump"); }
      if (!a && !b.error && b.count > 0) { ok = false; log("    ! removes a selector that matches; a change adds or replaces, never removes what works"); }
    } else if ((b.error || b.count === 0) && STATE_BOUND[path]) log(`  ~ ${path}: ${fmt(b)}   ${selector}   (state-bound: ${STATE_BOUND[path]}; not judged on a dump)`);
    else log(`  ${b.error || b.count === 0 ? "0" : "="} ${path}: ${fmt(b)}   ${selector}`);
  }
  for (const { path, selector } of afterPaths) if (!before.find((x) => x.path === path)) {
    const ar = countOf(selector);
    log(`  + ${path}: ${fmt(ar)}   ${selector}`);
    if (ar.error || ar.count === 0) { ok = false; log("    ! the new selector matches nothing on this dump"); }
  }
  for (const c of unproven) log(`  ? ${c.path}: a page-side script; not proven here, read it (${(c.why || "").slice(0, 120)})`);
  const missing = before.filter(({ selector }) => { const r = countOf(selector); return r.error || r.count === 0; });
  const dead = missing.filter((d) => !STATE_BOUND[d.path]); const bound = missing.filter((d) => STATE_BOUND[d.path]);
  const boundNote = bound.length ? `; state-bound, not judged: ${bound.map((d) => d.path).join(", ")}` : "";
  if (!changes.length) log(dead.length ? `health: ${dead.length} of ${before.length} selectors match nothing on this dump: ${dead.map((d) => d.path).join(", ")}${boundNote}` : `health: every selector matches something on this dump`);
  return ok;
}

/** Selectors that exist only in a state the hidden page is not in at 03:00 (2026-11-04, eight of the night's "match nothing" were these): judged
 * live, not on a dump. The name says the state. */
export const STATE_BOUND = {
  "controls.pause": "shown while something plays", "controls.wake": "the page's own prompt after hours of play", "controls.offer": "the service's offer at a limit",
  "controls.thumbUp": "with a song loaded", "controls.thumbDown": "with a song loaded", "selectors.now-playing": "with a song loaded",
  "controls.play": "the Play of a loaded, paused song", "controls.playPage": "a collection page", "controls.skip": "while an ad plays", "controls.dismiss": "while a dialog shows",
};
export function readAdapter(root, name) { return JSON.parse(readFileSync(`${root}/prism-adapters/adapters/${name}.json`, "utf8")); }
