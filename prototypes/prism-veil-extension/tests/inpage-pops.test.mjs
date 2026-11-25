// In-page pops are held as popups (2026-11-21, decision: on a phone aether.ist's pop ads draw their units in the page, over
// everything and over the PRISM button, instead of opening windows). Held means clear (2026-11-22): src/inpage-pops.js leaves a
// unit at the top of the stack that links to another site loaded, opaque and at its own layout size, drawn as a speck under the
// PRISM button (a transform, the keyhole's way) with presses passing through to the page, so a
// site's ad-blocker check finds its ad; it counts it on the button with the popups and puts it back when the person allows its
// destination. Over a page that stopped scrolling, or with a video that sounds, the unit is covered instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", "src", f), "utf8");
const realAttach = Element.prototype.attachShadow;
const realRect = Element.prototype.getBoundingClientRect;
const OFFSETS = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"];
const realOffsets = OFFSETS.map((k) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, k));

function load() {
  window.__prismVeilNS = undefined;
  window.PrismPopups = undefined;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
  Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => null });
  Element.prototype.attachShadow = function () { return realAttach.call(this, { mode: "open" }); };
  // the test DOM lays nothing out: a box is read from the element's own data-box
  Element.prototype.getBoundingClientRect = function () {
    const b = (this.getAttribute && this.getAttribute("data-box") || "").split(",").map(Number);
    if (b.length !== 4) return realRect.call(this);
    return { left: b[0], top: b[1], width: b[2], height: b[3], right: b[0] + b[2], bottom: b[1] + b[3], x: b[0], y: b[1] };
  };
  // the layout box (no transform in it) from the same data-box
  OFFSETS.forEach((k, i) => Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get() {
    const b = (this.getAttribute && this.getAttribute("data-box") || "").split(",").map(Number);
    return b.length === 4 ? b[i] : 0;
  } }));
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  window.chrome = {
    storage: { local: { get: (k, cb) => cb({}), set: () => {}, remove: () => {} }, onChanged: { addListener: () => {} } },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {}, getURL: (p) => p },
  };
  (0, eval)(read("core-popups-iso.js"));
  (0, eval)(read("popups-ui.js"));
  (0, eval)(read("inpage-pops.js"));
  const label = () => { const h = document.querySelector("prism-popup-button"); return h ? h.shadowRoot.querySelector(".lbl").textContent : null; };
  return { PV: window.__prismVeilNS, label, pass: (ms) => vi.advanceTimersByTimeAsync(ms) };
}
function unit({ z = "2147483647", href = "https://ads.example/click", id = "", box = "0,0,390,800" } = {}) {
  const d = document.createElement("div");
  if (id) d.id = id;
  d.setAttribute("data-box", box);
  d.style.cssText = "position:fixed;top:0;left:0;width:390px;height:800px;z-index:" + z;
  const a = document.createElement("a"); a.href = href; a.textContent = "Open"; d.appendChild(a);
  document.body.appendChild(d);
  return d;
}

describe("in-page pops", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ""; document.body.style.cssText = ""; document.documentElement.style.cssText = ""; try { window.happyDOM.setURL("https://watch.example/"); } catch (e) {} });
  afterEach(() => {
    vi.useRealTimers(); Element.prototype.attachShadow = realAttach; Element.prototype.getBoundingClientRect = realRect;
    OFFSETS.forEach((k, i) => { if (realOffsets[i]) Object.defineProperty(HTMLElement.prototype, k, realOffsets[i]); });
    document.querySelectorAll("prism-popup-button").forEach((h) => h.remove());
  });
  const held = (u) => u.getAttribute("data-prism-held");
  // tucked: drawn as a speck under the PRISM button by a transform from its layout box; the unit itself stays opaque
  const isClear = (u) => /scale\(/.test(u.style.getPropertyValue("transform")) && u.style.getPropertyPriority("transform") === "important" && !/opacity/.test(u.style.cssText);
  const noPress = (n) => n.style.getPropertyValue("pointer-events") === "none";

  it("holds a unit at the top of the stack clear: loaded, displayed and in place, presses passing through, counted as a popup", async () => {
    const p = load(); await p.pass(0);
    const u = unit();
    const f = document.createElement("iframe"); f.style.pointerEvents = "auto"; u.appendChild(f);
    await p.pass(1100);
    expect(held(u)).toBe("clear");
    expect(isClear(u)).toBe(true);
    expect(u.style.getPropertyValue("display")).toBe("");        // never hidden: an ad-blocker check finds it displayed
    expect(u.style.getPropertyValue("left")).toBe("0px");        // and where it was
    expect(u.isConnected).toBe(true);
    [u, u.querySelector("a"), f].forEach((n) => expect(noPress(n)).toBe(true));   // a frame inside takes no tap either
    expect(p.label()).toBe("1 popup blocked");
    const row = p.PV.popupPolicy.ledger("watch.example")[0];
    expect(row.dest).toBe("ads.example");
  });

  it("draws the unit as a speck of 6 px under the PRISM button, its layout size and place untouched", async () => {
    const p = load(); await p.pass(0);
    const u = unit({ box: "0,680,390,120" }); await p.pass(1100);
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([\d.]+)\)/.exec(u.style.getPropertyValue("transform"));
    expect(m).not.toBeNull();
    const [tx, ty, k] = m.slice(1).map(Number);
    expect(u.style.getPropertyValue("transform-origin")).toBe("0 0");
    expect(Math.max(390 * k, 120 * k)).toBeCloseTo(6, 1);               // 6 px at most
    expect(0 + tx + (390 * k) / 2).toBeCloseTo(390 - 34, 0);            // its middle under the button's
    expect(680 + ty + (120 * k) / 2).toBeCloseTo(800 - 29, 0);
    expect(u.offsetWidth).toBe(390);                                    // layout size, as checks read it
    expect(u.style.getPropertyValue("display")).toBe("");
  });

  // aether.ist on a phone (2026-11-22): a corner unit at z-index 2147483646, a frame with no address filling it and a close control,
  // no link anywhere; the frame takes the press by a script
  function frameUnit({ title = "", inner = "" } = {}) {
    const d = document.createElement("div");
    d.setAttribute("data-box", "252,702,188,198");
    d.style.cssText = "position:fixed;right:0;bottom:0;z-index:2147483646";
    const f = document.createElement("iframe"); f.setAttribute("data-box", "252,712,188,188"); if (title) f.title = title;
    const x = document.createElement("div"); x.setAttribute("data-box", "420,702,20,20"); x.textContent = "x";
    d.appendChild(f); d.appendChild(x); document.body.appendChild(d);
    const doc = document.implementation.createHTMLDocument("f"); doc.body.innerHTML = inner;
    Object.defineProperty(f, "contentDocument", { value: doc, configurable: true });
    return d;
  }
  it("holds a unit that is a frame with no link, listed under the host of its picture", async () => {
    const p = load(); await p.pass(0);
    const u = frameUnit({ inner: `<img src="https://cdn.popnet.example/c/1.jpg">` });
    await p.pass(1100);
    expect(held(u)).toBe("clear");
    const row = p.PV.popupPolicy.ledger("watch.example")[0];
    expect(row.dest).toBe("cdn.popnet.example");
    expect(row.context).toMatch(/a frame with no link/);
  });
  // 2026-11-22, a report from aether.ist on an iPhone: a pop showed for a second or two before it was held. The page puts the
  // box in first and fills or shows it after; only the look once a second found it (991 and 609 ms in view, measured).
  it("holds a box put in empty or hidden as soon as it is filled or shown, not at the next look a second later", async () => {
    const p = load(); await p.pass(0);
    const d = document.createElement("div"); d.setAttribute("data-box", "0,0,390,800");
    d.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
    document.body.appendChild(d);
    await p.pass(1030);                       // seen empty: no pop yet, and the look once a second has just run
    expect(held(d)).toBe(null);
    const a = document.createElement("a"); a.href = "https://ads.example/click"; d.appendChild(a);
    await p.pass(20);
    expect(held(d)).toBe("clear");
    const h = unit(); h.style.display = "none";
    await p.pass(1030);
    expect(held(h)).toBe(null);
    h.style.display = "block";
    await p.pass(120);
    expect(held(h)).toBe("clear");
  });
  it("lists a frame it cannot read under a reserved name, and Always allow for it puts the unit back", async () => {
    const p = load(); await p.pass(0);
    const u = frameUnit();
    await p.pass(1100);
    expect(held(u)).toBe("clear");
    expect(p.PV.popupPolicy.ledger("watch.example")[0].dest).toBe("in-page-ad.invalid");
    p.PV.popupPolicy.allow("watch.example", "in-page-ad.invalid"); await p.pass(0);
    expect(held(u)).toBe(null);
  });
  it("leaves a chat widget of the same shape alone, and a top-level box whose frame is small", async () => {
    const p = load(); await p.pass(0);
    const chat = frameUnit({ title: "chat widget" });
    const d = document.createElement("div"); d.setAttribute("data-box", "0,0,390,200"); d.style.cssText = "position:fixed;z-index:2147483647";
    const f = document.createElement("iframe"); f.setAttribute("data-box", "0,0,40,40"); d.appendChild(f); document.body.appendChild(d);
    await p.pass(1100);
    expect(held(chat)).toBe(null);
    expect(held(d)).toBe(null);
  });

  it("keeps a held unit clear when it grows a new frame, and counts it once", async () => {
    const p = load(); await p.pass(0);
    const u = unit(); await p.pass(1100);
    const f = document.createElement("iframe"); u.appendChild(f); await p.pass(1100);
    expect(noPress(f)).toBe(true);
    expect(p.PV.popupPolicy.ledger("watch.example")[0].count).toBe(1);
  });

  it("leaves the page's own box, a lower one, a consent dialog, an accessibility tool, a chat widget and a tiny one", async () => {
    const p = load(); await p.pass(0);
    const own = unit({ href: "https://www.watch.example/settings" });
    const low = unit({ z: "1000" });
    const consent = unit({ id: "onetrust-banner-sdk" });
    const a11y = unit({ id: "userwayAccessibilityIcon", href: "https://userway.org/" });
    const chat = unit({ id: "intercom-container", href: "https://intercom.com/x" });
    const tiny = unit({ box: "0,0,10,10" });
    await p.pass(1100);
    [own, low, consent, a11y, chat, tiny].forEach((u) => { expect(held(u)).toBe(null); expect(u.style.cssText).not.toMatch(/transform/); });
    expect(p.PV.popupPolicy.ledger("watch.example").length).toBe(0);
  });

  it("leaves the site's own message that asks to allow ads, by its words, in a shadow tree too, and by a vendor's mark", async () => {
    const p = load(); await p.pass(0);
    const say = (u, t) => { const d = document.createElement("div"); d.textContent = t; u.appendChild(d); return u; };
    const plain = say(unit({ href: "https://help.vendor.example/not-using" }), "Please allow ads on this site. Our site is supported by ads.");
    const blocker = say(unit(), "It looks like you are using an ad blocker.");
    const shadow = unit(); const host = document.createElement("div"); shadow.appendChild(host);
    host.attachShadow({ mode: "open" }).innerHTML = "<p>Please disable your ad-blocker to continue</p>";
    const marked = unit({ id: "fc-ab-root" });
    const ad = say(unit({ href: "https://getblock.example/install" }), "Block ads everywhere. Install now.");   // an ad for a blocker is still an ad
    await p.pass(1100);
    [plain, blocker, shadow, marked].forEach((u) => { expect(held(u)).toBe(null); expect(u.style.cssText).not.toMatch(/transform/); });
    expect(held(ad)).not.toBe(null);
    expect(p.PV.popupPolicy.ledger("watch.example").map((r) => r.dest)).toEqual(["getblock.example"]);
  });
  it("holds a widget-marked unit when an ad server's element is in it, and names the signal", async () => {
    const p = load(); await p.pass(0);
    p.PV.adSignalIn = (el) => (el.querySelector("a[href*='doubleclick.net']") ? "a from ad.doubleclick.net" : "");
    const u = unit({ id: "jwplayer-float", href: "https://ad.doubleclick.net/click" });
    await p.pass(1100);
    expect(held(u)).toBe("clear");
    expect(p.PV.popupPolicy.ledger("watch.example")[0].context).toMatch(/a from ad\.doubleclick\.net/);
  });

  it("finds a fixed unit inside a page-level box of no size (GumGum's shape on Fox News)", async () => {
    const p = load(); await p.pass(0);
    const k = document.createElement("div"); k.setAttribute("data-box", "0,0,0,0"); document.body.appendChild(k);
    const u = document.createElement("div"); u.setAttribute("data-box", "0,676,440,120");
    u.style.cssText = "position:fixed;bottom:0;left:0;z-index:2147483647";
    const a = document.createElement("a"); a.href = "https://ads.example/click"; u.appendChild(a); k.appendChild(u);
    await p.pass(1100);
    expect(held(u)).toBe("clear");
  });

  it("covers instead over a page that stopped scrolling, and switches to a cover if the page locks later", async () => {
    const p = load(); await p.pass(0);
    document.documentElement.style.overflow = "hidden";
    const u = unit(); await p.pass(1100);
    expect(held(u)).toBe("cover");
    expect(p.PV.inpageCovers.has(u)).toBe(true);
    expect(u.style.cssText).not.toMatch(/transform/);
    document.documentElement.style.overflow = "";
    const v = unit({ href: "https://other-ads.example/x" }); await p.pass(1100);
    expect(held(v)).toBe("clear");
    document.body.style.overflow = "hidden"; await p.pass(1100);
    expect(held(v)).toBe("cover");
    expect(v.style.cssText).not.toMatch(/transform/);              // put back before the cover
    expect(noPress(v)).toBe(false);
  });

  // 2026-11-22, Fox News on an iPhone: the banner fixed to the bottom got a cover that stayed on the screen. The page hides its
  // sideways overflow only (body: overflow "hidden auto") and still scrolls, so the unit is tucked away like any other.
  it("tucks a unit away on a page that hides only its sideways overflow", async () => {
    const real = window.getComputedStyle;   // the test DOM does not give the two-word value a browser does
    window.getComputedStyle = function (el) { const cs = real.apply(window, arguments); return el === document.body ? new Proxy(cs, { get: (t, k) => (k === "overflow" ? "hidden auto" : k === "overflowY" ? "auto" : k === "overflowX" ? "hidden" : t[k]) }) : cs; };
    try {
      const p = load(); await p.pass(0);
      const u = unit({ box: "0,678,390,122" });
      await p.pass(1100);
      expect(held(u)).toBe("clear");
    } finally { window.getComputedStyle = real; }
  });
  // 2026-11-22, Fox News on an iPhone (0.9.66): the ad banner fixed to the bottom at z-index 999 kept a cover on it over the page.
  it("holds an ad the display rules covered when it sits in a small fixed layer at any z-index, and leaves a fixed layer that is mostly page", async () => {
    const p = load(); await p.pass(0);
    const mk = (box, z, adBox) => { const f = document.createElement("div"); f.setAttribute("data-box", box); f.style.cssText = "position:fixed;bottom:0;z-index:" + z;
      const ad = document.createElement("div"); ad.setAttribute("data-box", adBox); f.appendChild(ad); document.body.appendChild(f); return [f, ad]; };
    const [bar, ad] = mk("0,732,390,68", "999", "35,741,320,50");
    const [shell, ad2] = mk("0,0,390,300", "999", "35,10,320,50");   // a fixed header with a small ad in it: the header is the page's
    await p.pass(1100);
    expect(held(bar)).toBe(null);                                   // not at the top of the stack, and no display rule has named it
    p.PV.coveredEls = () => [ad, ad2]; p.PV.whyFor = () => "slot-selector: iframe[id^='google_ads_iframe']";
    await p.pass(1100);
    expect(held(bar)).toBe("clear");
    expect(held(shell)).toBe(null);
    expect(p.PV.popupPolicy.ledger("watch.example")[0].context).toMatch(/fixed over the page, slot-selector/);
  });
  it("puts everything back as it was when the person always allows its destination", async () => {
    const p = load(); await p.pass(0);
    const u = unit(); u.style.setProperty("opacity", "0.9");
    const f = document.createElement("iframe"); f.style.pointerEvents = "auto"; u.appendChild(f);
    await p.pass(1100);
    expect(held(u)).toBe("clear");
    expect(u.style.getPropertyValue("opacity")).toBe("0.9");       // the unit's own opacity is never touched
    p.PV.popupPolicy.allow("watch.example", "ads.example"); await p.pass(0);
    expect(held(u)).toBe(null);
    expect(u.style.getPropertyValue("opacity")).toBe("0.9");
    expect(u.style.cssText).not.toMatch(/transform/);
    expect(f.style.getPropertyValue("pointer-events")).toBe("auto");
    expect(u.style.getPropertyValue("pointer-events")).toBe("");
  });

  // The site's own offer (2026-11-24, USA Today: a subscribe offer in a dialog over the whole page, the page's scroll stopped under
  // it): tucked away like a pop, and the scroll it stopped is put back for as long as it is held.
  function offer({ close = true, cls = "site-modal" } = {}) {
    const d = document.createElement("div");
    d.className = cls; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("data-box", "0,0,390,800");
    d.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
    if (close) { const b = document.createElement("button"); b.setAttribute("aria-label", "Close Special Offer"); d.appendChild(b); }
    const f = document.createElement("iframe"); f.title = "Special offer"; f.src = "https://cm.watch.example/overlay/entrance"; f.setAttribute("data-box", "45,150,300,400"); d.appendChild(f);
    document.body.appendChild(d);
    return d;
  }
  it("tucks the site's own offer away and puts the page's scroll back while it is held", async () => {
    const p = load(); await p.pass(0);
    document.documentElement.style.overflow = "hidden";
    const u = offer(); await p.pass(1100);
    expect(held(u)).toBe("clear");
    expect(isClear(u)).toBe(true);
    expect(document.documentElement.style.getPropertyValue("overflow-y")).toBe("auto");
    expect(document.documentElement.style.getPropertyPriority("overflow-y")).toBe("important");
    expect(p.PV.popupPolicy.ledger("watch.example")[0].dest).toBe("site-offer.invalid");
    u.remove(); await p.pass(1100);                                   // the page closes it: the page's own style is back
    expect(document.documentElement.style.getPropertyPriority("overflow-y")).toBe("");
  });
  it("leaves a dialog with no close control, and one that names itself a paywall", async () => {
    const p = load(); await p.pass(0);
    const a = offer({ close: false }), b = offer({ cls: "site-paywall" });
    await p.pass(1100);
    expect(held(a)).toBe(null);
    expect(held(b)).toBe(null);
    expect(p.label()).not.toBe("1 popup blocked");
  });
  it("puts an offer back when the person allows it, with the page's own scroll style", async () => {
    const p = load(); await p.pass(0);
    document.documentElement.style.overflow = "hidden";
    const u = offer(); await p.pass(1100);
    p.PV.popupPolicy.allow("watch.example", "site-offer.invalid"); await p.pass(0);
    expect(held(u)).toBe(null);
    expect(u.style.cssText).not.toMatch(/transform/);
    expect(document.documentElement.style.getPropertyPriority("overflow-y")).toBe("");
  });

  // A video the page floats in a corner without sound (2026-11-24, USA Today's docked player): tucked away; with sound it is the
  // person's own and is put back.
  function player() {
    const d = document.createElement("div");
    d.setAttribute("data-box", "190,600,200,140"); d.style.cssText = "position:fixed;right:0;bottom:60px;z-index:5";
    const b = document.createElement("button"); b.setAttribute("aria-label", "Close docked video player"); d.appendChild(b);
    const w = document.createElement("div"); d.appendChild(w);
    const v = document.createElement("video"); v.setAttribute("data-box", "190,628,200,112"); w.appendChild(v);
    const state = { muted: true, paused: false };
    Object.defineProperty(v, "muted", { get: () => state.muted, configurable: true });
    Object.defineProperty(v, "paused", { get: () => state.paused, configurable: true });
    Object.defineProperty(v, "volume", { get: () => 1, configurable: true });
    document.body.appendChild(d);
    return { d, state };
  }
  it("tucks a docked video without sound away, and puts it back when it sounds or leaves its corner", async () => {
    const p = load(); await p.pass(0);
    const { d, state } = player(); await p.pass(1100);
    expect(held(d)).toBe("clear");
    expect(isClear(d)).toBe(true);
    expect(p.PV.popupPolicy.ledger("watch.example")[0].dest).toBe("floating-video.invalid");
    state.muted = false; await p.pass(1100);                          // the person gave it sound
    expect(d.style.cssText).not.toMatch(/transform/);
    state.muted = true; await p.pass(1100);                           // without sound again: tucked away again, counted once
    expect(isClear(d)).toBe(true);
    d.style.position = "static"; await p.pass(1100);                  // back in the article
    expect(d.style.cssText).not.toMatch(/transform/);
    expect(p.PV.popupPolicy.ledger("watch.example").length).toBe(1);
  });
  it("leaves a docked video that sounds, and a fixed video with no close control", async () => {
    const p = load(); await p.pass(0);
    const a = player(); a.state.muted = false;
    const b = player(); b.d.querySelector("button").remove();
    await p.pass(1100);
    expect(held(a.d)).toBe(null);
    expect(held(b.d)).toBe(null);
  });

  // A dialog below the top of the stack (2026-11-24, AP News: a marketing dialog with an ad link in it), and what the person opened
  function dialog({ href = "https://ads.example/x", z = "9000" } = {}) {
    const d = document.createElement("div");
    d.setAttribute("role", "dialog"); d.setAttribute("data-box", "0,0,390,0");
    const slab = document.createElement("div"); slab.setAttribute("data-box", "0,0,390,800"); slab.style.cssText = "position:fixed;top:0;left:0;z-index:" + z;
    const b = document.createElement("button"); b.innerHTML = "<span>close dialog</span>"; slab.appendChild(b);
    const a = document.createElement("a"); a.href = href; a.textContent = "See more"; slab.appendChild(a);
    d.appendChild(slab); document.body.appendChild(d);
    return slab;
  }
  it("holds a dialog over the page that leads to another site, at any z-index", async () => {
    const p = load(); await p.pass(0);
    const u = dialog(); await p.pass(1100);
    expect(held(u)).toBe("clear");
    expect(p.PV.popupPolicy.ledger("watch.example")[0].dest).toBe("ads.example");
  });
  it("leaves a dialog and an offer the person opened by a click", async () => {
    const p = load(); await p.pass(0);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const u = dialog(), o = offer(); await p.pass(1100);
    expect(held(u)).toBe(null);
    expect(held(o)).toBe(null);
    await p.pass(5000);                                               // and it stays theirs
    expect(held(u)).toBe(null);
    expect(held(o)).toBe(null);
  });

  // The panel's Preview and Show for a unit held in the page (2026-11-24)
  it("previews a tucked unit small and readable for a few seconds, then tucks it away again", async () => {
    const p = load(); await p.pass(0);
    const u = offer(); await p.pass(1100);
    const speck = u.style.getPropertyValue("transform");
    expect(p.PV.inpageHeld("site-offer.invalid")).toBe(true);
    expect(p.PV.inpagePreview("site-offer.invalid")).toBeTruthy();
    const m = /scale\(([\d.]+)\)/.exec(u.style.getPropertyValue("transform"));
    expect(390 * Number(m[1])).toBeGreaterThan(100);                  // readable, not a speck
    expect(u.style.getPropertyValue("outline")).toMatch(/solid/);
    expect(u.style.getPropertyValue("pointer-events")).toBe("none");  // it takes no press
    await p.pass(1100);                                               // the look once a second leaves the preview alone
    expect(u.style.getPropertyValue("outline")).toMatch(/solid/);
    await p.pass(6000);
    expect(u.style.getPropertyValue("transform")).toBe(speck);
    expect(u.style.getPropertyValue("outline")).toBe("");
    expect(held(u)).toBe("clear");
  });
  it("shows a held unit for this visit without remembering it", async () => {
    const p = load(); await p.pass(0);
    document.documentElement.style.overflow = "hidden";
    const u = offer(); await p.pass(1100);
    expect(p.PV.inpageShow("site-offer.invalid")).toBe(1);
    expect(held(u)).toBe(null);
    expect(u.style.cssText).not.toMatch(/transform/);
    expect(document.documentElement.style.getPropertyPriority("overflow-y")).toBe("");   // the page's own scroll style is back
    await p.pass(3000);
    expect(held(u)).toBe(null);                                       // not held again on this page
    expect(p.PV.popupPolicy.listAllowed().length).toBe(0);            // and nothing was allowed for later
    expect(p.PV.inpageHeld("site-offer.invalid")).toBe(false);
  });
});
