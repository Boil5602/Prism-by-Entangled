// Where a cover's picture comes from (2026-11-22, measured on Facebook in Safari on an iPhone: the page's policy refused every
// hosted photo, so each cover cost one refused request and changed its picture after it was up). The art block is read out of
// main.js and run alone, with the browser's parts stubbed; covers.js is run against it for the cover's box.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVeil } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "..", "src", "main.js"), "utf8");
const block = main.slice(main.indexOf("  // ---- art\n"), main.indexOf("  // ---- human override"));
const HOSTED = ["https://prism.entangled.world/veil/art/a.jpg", "https://prism.entangled.world/veil/art/b.jpg"];
const BUNDLED = /^ext:\/\/id\/art\//;

// one page: its host, what the device remembers, its meta policy, and whether the page's policy lets a hosted photo load
function page({ host, remembered = {}, meta = "", loads = true, PV = { ART_FILES: ["art/one.jpg", "art/two.jpg"] } }) {
  const asked = [], store = { "pv:art": { at: 1, urls: HOSTED }, "pv:artRefused": remembered }, listeners = {};
  const chrome = { runtime: { getURL: (p) => "ext://id/" + p }, storage: { onChanged: { addListener() {} },
    local: { get: (k, cb) => cb(store), set: (o) => Object.assign(store, o) } } };
  const doc = { readyState: "complete", addEventListener: (t, f) => { listeners[t] = f; },
    querySelectorAll: () => (meta ? [{ getAttribute: () => meta }] : []) };
  class Img { set src(u) { asked.push(u); setTimeout(() => (loads ? this.onload && this.onload() : this.onerror && this.onerror()), 0); } }
  new Function("PV", "chrome", "location", "document", "Image", "navigator", block)(PV, chrome, { hostname: host }, doc, Img, { onLine: true });
  const el = () => ({ style: { backgroundImage: "" } });
  return { PV, asked, store, listeners, el };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("the picture on a cover", () => {
  it("is found in main.js", () => { expect(block.length).toBeGreaterThan(500); });

  it("is a bundled one from the start on a page known to refuse, with no request to the server", async () => {
    const pages = [page({ host: "m.facebook.com" }),                                              // measured to refuse
      page({ host: "news.example", remembered: { "news.example": Date.now() + 1e6 } }),          // remembered on this device
      page({ host: "strict.example", meta: "default-src 'self'; img-src 'self' data: *.cdn.example" })];   // its own readable policy
    for (const p of pages) {
      const art = p.PV.pickArt(), e = p.el();
      expect(art).toMatch(BUNDLED);
      p.PV.artOnto(e, HOSTED[0]);                              // even handed a hosted address (a picture kept from before)
      await tick();
      expect(e.style.backgroundImage.slice(5)).toMatch(BUNDLED);
      expect(e.__artUrl).toMatch(BUNDLED);                     // the credit names the picture on the screen
      expect(p.asked).toEqual([]);
    }
  });

  it("stays the hosted one on a page that allows it, and nothing is remembered", async () => {
    const p = page({ host: "open.example", meta: "img-src https: data:" });
    const art = p.PV.pickArt(), e = p.el();
    expect(HOSTED).toContain(art);
    p.PV.artOnto(e, art); await tick();
    expect(e.style.backgroundImage).toBe("url('" + art + "')");
    expect(p.asked).toEqual([art]);
    expect(p.store["pv:artRefused"]).toEqual({});
    expect(p.PV.artRefused()).toBe(false);
  });

  it("is learned at the first refusal: that cover swaps, the next asks for nothing, and the device remembers the site", async () => {
    const p = page({ host: "closed.example", loads: false });
    const a = p.el(), first = p.PV.pickArt();
    p.PV.artOnto(a, first);
    p.listeners.securitypolicyviolation({ blockedURI: first });   // the browser's own word
    await tick();
    expect(a.style.backgroundImage.slice(5)).toMatch(BUNDLED);
    expect(p.store["pv:artRefused"]["closed.example"]).toBeGreaterThan(Date.now() + 29 * 86400000);
    const b = p.el(); p.PV.artOnto(b, p.PV.pickArt()); await tick();
    expect(p.asked).toEqual([first]);                          // one request in all
    // a later visit: nothing asked for
    const again = page({ host: "closed.example", remembered: p.store["pv:artRefused"] });
    again.PV.artOnto(again.el(), again.PV.pickArt()); await tick();
    expect(again.asked).toEqual([]);
    // a failure with no word from the browser (it may be the server) is remembered for a day only; a lapsed entry is dropped
    const q = page({ host: "odd.example", loads: false, remembered: { "old.example": Date.now() - 5 } });
    q.PV.artOnto(q.el(), q.PV.pickArt()); await tick();
    const until = q.store["pv:artRefused"]["odd.example"];
    expect(until).toBeGreaterThan(Date.now() + 23 * 3600000); expect(until).toBeLessThan(Date.now() + 25 * 3600000);
    expect(q.store["pv:artRefused"]["old.example"]).toBeUndefined();
  });

  it("reads a policy as the browser would", () => {
    const { PV } = page({ host: "x.example" }), u = HOSTED[0];
    expect(PV.cspRefuses("script-src 'self'", u)).toBe(false);                       // says nothing of pictures
    expect(PV.cspRefuses("default-src 'self'", u)).toBe(true);
    expect(PV.cspRefuses("default-src 'self'; img-src *", u)).toBe(false);
    expect(PV.cspRefuses("img-src 'self' https://prism.entangled.world", u)).toBe(false);
    expect(PV.cspRefuses("img-src *.entangled.world", u)).toBe(false);
    expect(PV.cspRefuses("img-src http://prism.entangled.world data: blob:", u)).toBe(true);
    expect(PV.cspRefuses("img-src *.fbcdn.net *.facebook.com data: blob:", u)).toBe(true);   // Facebook's, in short
    expect(PV.cspRefuses("img-src 'none'", u)).toBe(true);
  });

  it("leaves the cover's box as it is, and a cover made again keeps its picture", () => {
    const boxOn = (host) => {
      const PV = loadVeil({ host, width: 1600, height: 900 });
      PV.ART_FILES = ["art/one.jpg"];
      (0, eval)(readFileSync(join(here, "..", "src", "covers.js"), "utf8"));
      const p = page({ host, PV });
      document.body.innerHTML = `<div class="ad-unit" id="u" data-rect="300,100,300,250"></div>`;
      PV.videoAdBreak = () => {}; PV.vidVeil = () => null;
      const real = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () { const u = this.hasAttribute && this.hasAttribute("data-prism-veil") && this.parentNode; return u && u.getAttribute ? real.call(u) : real.call(this); };
      try {
        PV.sweep();
        const c = document.querySelector("#u [data-prism-why]"), r = c.getBoundingClientRect(), pic = c.__artUrl;
        const box = [c.parentNode.id, c.__mode, c.style.position, c.style.inset, c.style.zIndex, r.left, r.top, r.width, r.height].join(" ");
        PV.sweep();
        document.body.innerHTML = `<div class="ad-unit" id="u" data-rect="300,100,300,250"></div>`;   // the page's new copy
        PV.sweep();
        return { box, pic, again: document.querySelector("#u [data-prism-why]").__artUrl, asked: p.asked };
      } finally { Element.prototype.getBoundingClientRect = real; }
    };
    const open = boxOn("www.example.com"), closed = boxOn("www.facebook.com");
    expect(open.pic).toMatch(/^https:\/\/prism\.entangled\.world\//);
    expect(closed.pic).toBe("ext://id/art/one.jpg");
    expect(closed.asked).toEqual([]);
    expect(closed.box).toBe(open.box);
    expect(closed.again).toBe(closed.pic); expect(open.again).toBe(open.pic);
  });
});
