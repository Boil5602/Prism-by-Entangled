/*
  One copy of the scripts a page (B-614, src/main.js): Safari starts an updated extension's scripts in a page that is already
  open and leaves the old copy running, so three updates gave one page three PRISM buttons. A copy that reads another copy's
  mark on the page's root stands down: its covers and its own button go, and it idles.
*/
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadVeil } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", "src", f), "utf8");

let store = {};
function start() {
  const PV = loadVeil({ host: "example.com" });
  window.__prismVeil = false;
  window.chrome = {
    runtime: { id: "test", getManifest: () => ({ version: "0.0.0" }), getURL: (p) => "chrome-extension://test/" + p, onMessage: { addListener: () => {} }, sendMessage: () => {} },
    storage: { local: { get: (k, cb) => { if (cb) cb(typeof k === "string" && store[k] !== undefined ? { [k]: store[k] } : {}); }, set: (o) => { Object.assign(store, o); }, remove: () => {} }, onChanged: { addListener: () => {} } },
  };
  (0, eval)(read("covers.js"));
  (0, eval)(read("report.js"));
  (0, eval)(read("main.js"));
  return PV;
}
const root = () => document.documentElement;

describe("one copy of the scripts a page", () => {
  it("writes its mark as it starts, and keeps nothing in the store where no other copy was there", () => {
    store = {}; root().removeAttribute("data-prism-copy");
    const PV = start();
    expect(root().getAttribute("data-prism-copy")).toMatch(/^[a-z0-9]{4,}$/);
    expect(store["pv:copies"]).toBe(undefined);
    expect(PV.suppressed()).toBe(false);
  });
  it("is not switched off by a mark the page writes: a made-up mark, or an older copy's mark put back", () => {
    store = { "pv:copies": { oldcopy1: Date.now() - 60000 } }; root().removeAttribute("data-prism-copy");
    const PV = start();
    let removed = 0; PV.removePill = () => { removed++; };
    root().setAttribute("data-prism-copy", "madeup12");
    expect(PV.suppressed()).toBe(false); expect(PV.suppressed()).toBe(false);
    root().setAttribute("data-prism-copy", "oldcopy1");
    const real = Date.now; Date.now = () => real() + 3000;   // past the two seconds between questions to the store
    try { expect(PV.suppressed()).toBe(false); expect(PV.suppressed()).toBe(false); } finally { Date.now = real; }
    expect(removed).toBe(0);
    root().removeAttribute("data-prism-copy");
  });
  it("stands down for a newer copy that recorded its mark in the extension's store: its button goes, the newer copy's stays", () => {
    store = {}; root().removeAttribute("data-prism-copy");
    const PV = start();
    let removed = 0; PV.removePill = () => { removed++; };
    const newer = document.createElement("prism-popup-button"); root().appendChild(newer);
    store["pv:copies"] = { newercopy: Date.now() + 5 };
    root().setAttribute("data-prism-copy", "newercopy");
    PV.suppressed();                       // asks the store
    expect(PV.suppressed()).toBe(true);
    expect(removed).toBe(1);
    expect(newer.isConnected).toBe(true);
    expect(PV.suppressed()).toBe(true);   // and it stays down
    expect(removed).toBe(1);
    newer.remove(); root().removeAttribute("data-prism-copy");
  });
  it("records its own mark in the store when it starts in a page that carries another copy's mark", () => {
    store = {}; root().setAttribute("data-prism-copy", "oldcopy1");
    start();
    const mine = root().getAttribute("data-prism-copy");
    expect(mine).not.toBe("oldcopy1");
    expect(typeof store["pv:copies"][mine]).toBe("number");
    root().removeAttribute("data-prism-copy");
  });
});
