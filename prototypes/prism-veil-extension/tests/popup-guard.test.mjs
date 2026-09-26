import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", f), "utf8");

// The isolated-world guard: input aimed at the Prism button never reaches
// page listeners, yet the element inside the closed shadow root still gets it.
describe("popup guard (isolated world, document_start)", () => {
  it("stops page capture listeners and routes the event to the inner element", () => {
    window.__prismVeilNS = {};
    (0, eval)(read("src/popups-guard.js"));
    const PV = window.__prismVeilNS;
    const seen = [];
    document.addEventListener("mousedown", () => seen.push("page saw mousedown"), true);
    document.addEventListener("click", () => seen.push("page saw click"), true);
    document.body.innerHTML = "";
    const host = document.createElement("prism-popup-button");
    const root = host.attachShadow({ mode: "closed" });
    const btn = document.createElement("button"); btn.type = "button"; root.appendChild(btn);
    document.body.appendChild(host);
    PV.uiPick = () => btn;   // what popups-ui provides (elementFromPoint inside the root)
    let inner = 0; btn.addEventListener("click", () => inner++);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(seen).toEqual([]);
    expect(inner).toBe(1);
  });
  it("leaves form controls to their native activation (no second click)", () => {
    window.__prismVeilNS = {};
    (0, eval)(read("src/popups-guard.js"));
    const PV = window.__prismVeilNS;
    document.body.innerHTML = "";
    const host = document.createElement("prism-popup-button");
    const root = host.attachShadow({ mode: "closed" });
    const cb = document.createElement("input"); cb.type = "checkbox"; root.appendChild(cb);
    document.body.appendChild(host);
    PV.uiPick = () => cb;
    let clicks = 0; cb.addEventListener("click", () => clicks++);
    cb.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(clicks).toBe(0);   // the trusted click was stopped before the target; no synthetic one added
  });
  it("does not touch events outside the button", () => {
    window.__prismVeilNS = {};
    (0, eval)(read("src/popups-guard.js"));
    const seen = [];
    document.addEventListener("click", () => seen.push("page"), true);
    document.body.innerHTML = "<button id='b'>x</button>";
    document.getElementById("b").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual(["page"]);
  });
  it("claims a click by coordinates when a site paints an invisible layer over the button", () => {
    window.__prismVeilNS = {};
    (0, eval)(read("src/popups-guard.js"));
    const PV = window.__prismVeilNS;
    const seen = [];
    document.addEventListener("click", () => seen.push("page saw click"), true);
    document.body.innerHTML = "<div id='catcher'></div>";
    const host = document.createElement("prism-popup-button");
    const root = host.attachShadow({ mode: "closed" });
    const pillEl = document.createElement("div"); root.appendChild(pillEl);
    document.body.appendChild(host);
    let inner = 0; pillEl.addEventListener("click", () => inner++);
    PV.uiHit = (e) => e.clientX >= 2400 && e.clientY >= 1150;   // "inside the pill"
    PV.uiPick = () => pillEl;
    // the trusted click lands on the site's catcher, not on our host
    document.getElementById("catcher").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 2505, clientY: 1190 }));
    expect(seen).toEqual([]);
    expect(inner).toBe(1);
    // a checkbox claimed by coordinates DOES get the synthetic click (it never received the real one)
    const cb = document.createElement("input"); cb.type = "checkbox"; root.appendChild(cb);
    let cbClicks = 0; cb.addEventListener("click", () => cbClicks++);
    PV.uiPick = () => cb;
    document.getElementById("catcher").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 2505, clientY: 1190 }));
    expect(cbClicks).toBe(1);
    PV.uiPick = () => pillEl;
    // a click elsewhere is untouched
    document.getElementById("catcher").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    expect(seen).toEqual(["page saw click"]);
  });
});
