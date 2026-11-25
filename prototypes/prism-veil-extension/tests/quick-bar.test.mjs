// The quick bar and the menu (2026-11-25, src/popups-ui.js): one press on the button opens the bar, More opens the menu of two
// tabs, and a site's own answer to a feed switch is shown by a globe (follows the setting for all sites) beside an eye.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", "src", f), "utf8");
const realAttach = Element.prototype.attachShadow;

function load(host) {
  try { window.happyDOM.setURL("https://" + host + "/"); } catch (e) {}
  window.__prismVeilNS = undefined;
  window.PrismPopups = undefined;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
  Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => null });
  Element.prototype.attachShadow = function () { return realAttach.call(this, { mode: "open" }); };
  window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {}, remove: () => {} }, onChanged: { addListener: () => {} } },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {}, getURL: (p) => p },
  };
  (0, eval)(read("core-popups-iso.js"));
  (0, eval)(read("popups-ui.js"));
  const PV = window.__prismVeilNS;
  // what src/report.js gives the button: the settings, the site's own answer, the switch for this site
  PV.uiPrefs = {};
  PV.setUiPref = (k, v) => { PV.uiPrefs[k] = v; };
  PV.veilSite = () => host;
  PV.siteChoice = (k) => { const s = (PV.uiPrefs.siteChoice || {})[host]; return s && typeof s[k] === "boolean" ? s[k] : null; };
  PV.prefHere = (k) => { const c = PV.siteChoice(k); return c === null ? !!PV.uiPrefs[k] : c; };
  PV.setSiteChoice = (k, v) => { const m = Object.assign({}, PV.uiPrefs.siteChoice), mine = Object.assign({}, m[host]); if (typeof v === "boolean") mine[k] = v; else delete mine[k]; if (Object.keys(mine).length) m[host] = mine; else delete m[host]; PV.uiPrefs.siteChoice = m; };
  let off = false;
  PV.veilOff = () => off;
  PV.setVeilOffHere = (v) => { off = !!v; if (PV.onVeilToggle) PV.onVeilToggle(); };
  const root = () => document.querySelector("prism-popup-button").shadowRoot;
  const $ = (sel) => root().querySelector(sel);
  const all = (sel) => [...root().querySelectorAll(sel)];
  return {
    PV, $, all,
    press: (sel) => { const e = typeof sel === "string" ? $(sel) : sel; e.click(); },
    cells: () => all(".qbar .qc").map((c) => c.getAttribute("data-q")),
    rows: () => all(".qrow .l").map((l) => l.textContent),
    block: (url) => document.dispatchEvent(new CustomEvent("prism-popup", { detail: { attempt: { site: host, url }, decision: { action: "intercept", reason: "opened without a click" } } })),
    pass: (ms) => vi.advanceTimersByTimeAsync(ms),
  };
}

describe("the quick bar and the menu", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ""; });
  afterEach(() => { vi.useRealTimers(); Element.prototype.attachShadow = realAttach; document.querySelectorAll("prism-popup-button").forEach((h) => h.remove()); });

  it("opens the bar on one press: Reveal, Report, the PRISM switch, More, and Popups in front only when something was stopped", async () => {
    const p = load("news.example"); await p.pass(0);
    p.press(".pill"); await p.pass(0);
    expect(p.cells()).toEqual(["reveal", "report", "prism", "more"]);
    expect(p.all(".qc").map((c) => c.textContent)).toEqual(["Reveal 15 s", "Report", "OnPRISM", "More"]);
    expect(p.$(".qstrip")).toBe(null);   // no feed switches on a plain site
    p.block("https://ads.example/a"); await p.pass(0);
    p.press(".pill"); await p.pass(0); if (!p.$(".qbar")) { p.press(".pill"); await p.pass(0); }
    expect(p.cells()).toEqual(["popups", "reveal", "report", "prism", "more"]);
    expect(p.$('[data-q="popups"] .qbd').textContent).toBe("1");
    p.press('[data-q="popups"]');
    expect(p.all(".qover .qrow .l").map((l) => l.textContent)).toEqual(["ads.example"]);
    expect(p.all(".qover .qmini").map((b) => b.textContent)).toEqual(["Open", "Allow"]);
  });

  it("turns PRISM off and on for this site from the bar", async () => {
    const p = load("news.example"); await p.pass(0);
    p.press(".pill"); await p.pass(0);
    expect(p.$('[data-q="prism"]').getAttribute("aria-checked")).toBe("true");
    p.press('[data-q="prism"]');
    expect(p.PV.veilOff()).toBe(true);
    expect(p.$('[data-q="prism"]').getAttribute("aria-checked")).toBe("false");
    p.press('[data-q="prism"]');
    expect(p.PV.veilOff()).toBe(false);
  });

  it("opens the menu from More: two tabs, the site's rows, the seven groups for all sites, and a page a tap in that writes its setting", async () => {
    const p = load("news.example"); await p.pass(0);
    p.press(".pill"); await p.pass(0);
    p.press('[data-q="more"]');
    expect(p.all(".qtabs button").map((b) => b.textContent)).toEqual(["This site", "All sites"]);
    expect(p.$(".qhead b").textContent).toBe("news.example");
    expect(p.rows()).toEqual(["Popups", "PRISM button"]);
    p.press(p.all(".qtabs button")[1]);
    expect(p.rows()).toEqual(["Video ads", "Live TV", "Feeds", "Source ratings", "Pictures", "Popups", "More"]);
    p.press(p.all(".qrow.go")[0]);
    expect(p.$(".qhead b").textContent).toBe("Video ads");
    p.press(p.all(".qseg")[0].querySelectorAll("button")[1]);
    expect(p.PV.uiPrefs.breakLook).toBe("mute");
    p.press(".qback");
    expect(p.rows().length).toBe(7);
    p.press(p.all(".qrow.go")[6]);
    expect(p.rows()).toEqual(["Small view", "Button glow", "Rule updates", "Ads covered", "Log"]);
  });

  it("shows a site's own answer: the globe lit and the eye greyed while the site follows all sites, the globe out and the eye lit once the site answers", async () => {
    const p = load("www.facebook.com"); await p.pass(0);
    p.PV.uiPrefs.aiVeil = true;
    p.press(".pill"); await p.pass(0);
    expect(p.all(".qchip").map((c) => c.getAttribute("aria-label"))).toEqual(["Suggested: shown", "AI-made: hidden"]);
    p.press('[data-q="more"]');
    expect(p.rows()).toEqual(["Suggested", "AI-made", "Popups", "PRISM button"]);
    const g = () => p.$('.qglb[data-k="aiVeil"]'), e = () => p.$('.qeye[data-k="aiVeil"]');
    expect(g().classList.contains("on")).toBe(true);
    expect(e().classList.contains("dim")).toBe(true);
    expect(e().getAttribute("data-hidden")).toBe("1");                 // the greyed eye shows the setting for all sites
    p.press(e());
    expect(p.PV.uiPrefs.siteChoice).toEqual({ "www.facebook.com": { aiVeil: false } });
    expect(g().classList.contains("on")).toBe(false);
    expect(e().classList.contains("own")).toBe(true);
    expect(e().getAttribute("data-hidden")).toBe("0");
    p.press(g());
    expect(p.PV.uiPrefs.siteChoice).toEqual({});
    expect(g().classList.contains("on")).toBe(true);
    expect(e().getAttribute("data-hidden")).toBe("1");
  });
});
