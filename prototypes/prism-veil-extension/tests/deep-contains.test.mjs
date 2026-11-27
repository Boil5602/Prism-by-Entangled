import { describe, it, expect } from "vitest";
import { loadVeil } from "./harness.mjs";

// 2026-11-27: deepContains asks the browser's own contains() and steps only at a shadow boundary. Its answers must be those of
// the climb it replaced, one parent at a time, for every pair of nodes of a tree with nested shadow roots.
const climb = (a, b) => {
  const up = (n) => { const p = n.parentNode; return !p ? null : (p.nodeType === 11 && p.host) ? p.host : p; };
  for (let n = up(b); n; n = up(n)) if (n === a) return true;
  return false;
};
describe("deepContains", () => {
  it("answers as the parent-by-parent climb did, across nested shadow roots, for every pair", () => {
    const PV = loadVeil();
    document.body.innerHTML = `<div id="a"><section id="b"><p id="c"><span id="d"></span></p><div id="host1"></div></section></div><aside id="e"><i id="f"></i></aside>`;
    const nodes = [document, document.documentElement, document.body, ...document.body.querySelectorAll("*")];
    const h1 = document.getElementById("host1"), r1 = h1.attachShadow({ mode: "open" });
    r1.innerHTML = `<div id="s1"><em id="s2"></em><div id="host2"></div></div>`;
    const h2 = r1.getElementById("host2"), r2 = h2.attachShadow({ mode: "open" });
    r2.innerHTML = `<b id="t1"><u id="t2"></u></b>`;
    nodes.push(r1, ...r1.querySelectorAll("*"), r2, ...r2.querySelectorAll("*"));
    const loose = document.createElement("div"); loose.innerHTML = `<p><span></span></p>`;   // a tree that is not in the page
    nodes.push(loose, loose.firstChild, loose.firstChild.firstChild);
    let asked = 0, yes = 0;
    for (const a of nodes) for (const b of nodes) { asked++; const want = climb(a, b); if (want) yes++; expect(PV.deepContains(a, b), `${a.id || a.nodeName} over ${b.id || b.nodeName}`).toBe(want); }
    expect(asked).toBe(nodes.length * nodes.length);
    expect(yes).toBeGreaterThan(60);
    // the cases the climb is known by: through two shadow roots, a host over its own shadow tree, and never a node over itself
    const t2 = r2.getElementById("t2");
    expect(PV.deepContains(document.getElementById("a"), t2)).toBe(true);
    expect(PV.deepContains(h2, t2)).toBe(true);
    expect(PV.deepContains(t2, t2)).toBe(false);
    expect(PV.deepContains(document.getElementById("e"), t2)).toBe(false);
    expect(PV.deepContains(null, t2)).toBe(false);
  });
});

// The walk for shadow roots finds one on every kind of element the standard allows as a host, and on a custom element.
// (2026-11-27: a walk that left out the elements that can never hold one was tried and measured slower in Firefox, 7.4 ms
// against 2.4 ms on a page of 6500 elements, and was not kept.)
describe("collectRoots", () => {
  it("finds a shadow root on every kind of element that may hold one, nested ones too", () => {
    const PV = loadVeil();
    const may = ["article", "aside", "blockquote", "div", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "main", "nav", "p", "section", "span", "my-widget", "x-card"];
    document.body.innerHTML = `<ul><li><a href="#"><img></a></li></ul>` + may.map((t) => `<${t} id="h-${t}"></${t}>`).join("");
    const made = may.map((t) => document.getElementById("h-" + t).attachShadow({ mode: "open" }));
    made[3].innerHTML = `<ul><li><span id="inner"></span></li></ul>`;
    const deep = made[3].getElementById("inner").attachShadow({ mode: "open" });
    const roots = PV.collectRoots();
    expect(roots[0]).toBe(document);
    for (const r of made.concat([deep])) expect(roots.includes(r)).toBe(true);
    expect(roots.length).toBe(may.length + 2);
  });
});
