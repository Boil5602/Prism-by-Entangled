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

let sent = [], listeners = [];
function start() {
  const PV = loadVeil({ host: "example.com" });
  window.__prismVeil = false; sent = []; listeners = [];
  window.chrome = {
    runtime: { id: "test", getManifest: () => ({ version: "0.0.0" }), getURL: (p) => "chrome-extension://test/" + p, onMessage: { addListener: (f) => listeners.push(f) }, sendMessage: (m) => { sent.push(m); } },
    storage: { local: { get: (k, cb) => { if (cb) cb({}); }, set: () => {}, remove: () => {} }, onChanged: { addListener: () => {} } },
  };
  (0, eval)(read("covers.js"));
  (0, eval)(read("report.js"));
  (0, eval)(read("main.js"));
  return PV;
}
const root = () => document.documentElement;
const tell = (msg, sender) => listeners.forEach((f) => f(msg, sender || {}, () => {}));

describe("one copy of the scripts a page", () => {
  it("writes its mark as it starts, and says nothing to the background where no other copy was there", () => {
    root().removeAttribute("data-prism-copy");
    const PV = start();
    expect(root().getAttribute("data-prism-copy")).toMatch(/^[a-z0-9]{6,}$/);
    expect(sent.filter((m) => m.type === "pv:copy-hello")).toEqual([]);
    expect(PV.suppressed()).toBe(false);
  });
  it("tells the background when it starts in a page that carries another copy's mark", () => {
    root().setAttribute("data-prism-copy", "oldcopy1");
    start();
    const hello = sent.filter((m) => m.type === "pv:copy-hello");
    expect(hello.length).toBe(1);
    expect(hello[0].copy).toBe(root().getAttribute("data-prism-copy"));
    expect(typeof hello[0].start).toBe("number");
    root().removeAttribute("data-prism-copy");
  });
  it("is not switched off by anything the page can do: a mark written on the root, or the message sent from a tab", () => {
    root().removeAttribute("data-prism-copy");
    const PV = start();
    let removed = 0; PV.removePill = () => { removed++; };
    root().setAttribute("data-prism-copy", "madeup12");
    expect(PV.suppressed()).toBe(false);
    tell({ type: "pv:copy-newer", copy: "madeup12", at: Date.now() + 5 }, { tab: { id: 3 } });   // not from the background
    expect(PV.suppressed()).toBe(false);
    expect(removed).toBe(0);
    root().removeAttribute("data-prism-copy");
  });
  it("stands down when the background tells it of a copy that started after it, and not for an older copy or for itself", () => {
    root().removeAttribute("data-prism-copy");
    const PV = start();
    let removed = 0; PV.removePill = () => { removed++; };
    const newer = document.createElement("prism-popup-button"); root().appendChild(newer);
    tell({ type: "pv:copy-newer", copy: "oldercopy", at: Date.now() - 60000 });
    tell({ type: "pv:copy-newer", copy: root().getAttribute("data-prism-copy"), at: Date.now() + 5 });
    expect(PV.suppressed()).toBe(false);
    tell({ type: "pv:copy-newer", copy: "newercopy", at: Date.now() + 5 });
    expect(PV.suppressed()).toBe(true);
    expect(removed).toBe(1);
    expect(newer.isConnected).toBe(true);
    expect(PV.suppressed()).toBe(true);   // and it stays down
    expect(removed).toBe(1);
    newer.remove(); root().removeAttribute("data-prism-copy");
  });
});
