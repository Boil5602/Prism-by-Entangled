import { describe, it, expect } from "vitest";
import { loadVeil } from "./harness.mjs";

// 2026-11-27 (B-601): the slot selectors and the ad-stack selectors are searched as one grouped query. It must find exactly the
// elements the plain comma list finds, in the same order.
const page = () => {
  const bits = [];
  const srcs = ["https://ad.doubleclick.net/x", "https://cdn.flashtalking.com/x", "https://www.youtube.com/embed/x", "https://tpc.googlesyndication.com/x", "https://example.com/", "https://syndicatedsearch.goog/afs/ads", "https://s.seedtag.com/c"];
  srcs.forEach((u, i) => bits.push(`<div class="wrap w${i}"><iframe id="f${i}" src="${u}"></iframe></div>`));
  ["ad-slot", "my-ad-slot-top", "header", "loaded shadow", "advertisement", "videoAd", "displayAd big", "adBanner", "trc_rbox x", "trc_related", "outbrain-unit", "celtra-banner", "bx-creative", "outstream", "padding", "ad_slot", "mv-ad-box", "htl-ad", "ssp-advert", "adthrive-ad", "bordeaux-filled-slot", "story"].forEach((c, i) => bits.push(`<div class="${c}" id="c${i}"><span class="${c}-inner"></span></div>`));
  ["div-gpt-ad-1", "div-gpt-2", "google_ads_iframe_1", "taboola-below", "outbrain_widget_3", "x_ad_bnr_1", "top_ad_rect", "my-ad-slot-9", "leftad", "rightad", "zergnet-widget-5", "AdThrive_Header_1", "freestar-1", "plain", "ScriptRootC123", "rcjsload_1"].forEach((id) => bits.push(`<div id="${id}"><p></p></div>`));
  bits.push(`<ins class="adsbygoogle"></ins><iframe id="google_ads_iframe_/1/x_0"></iframe><iframe id="_mN_main_1"></iframe><iframe class="taboola-connect-iframe"></iframe><iframe data-gg-moat-ifr="1"></iframe><iframe id="gfp_ad_1_tgt"></iframe>`);
  bits.push(`<li data-is-sponsored="true"></li><li data-is-sponsored="false"></li><div data-ad-slot="1"></div><div data-google-query-id="x"></div><div data-ad-unit="x"></div><div data-adunit="x"></div><div data-ad-type="x"></div><div aria-label="Advertisement"></div>`);
  bits.push(`<div class="TopAd"><div id="topchild"></div><p></p></div><div class="IL_BASE"></div><div data-qa="display_ad_container_1"></div><div data-widget-id="x-taboola-y"></div><div data-pw-desk="1"></div><div data-fuse="1"></div><vdo class="vdo_video_unit"></vdo><div data-openweb-ad=""></div>`);
  return bits.join("");
};
describe("the grouped query", () => {
  it("finds the same elements, in the same order, as the plain list of slot selectors", () => {
    const PV = loadVeil();
    document.body.innerHTML = page();
    const plain = PV.SLOT_SELECTORS.join(","), grouped = PV.groupedQuery(PV.SLOT_SELECTORS);
    const a = [...document.querySelectorAll(plain)], b = [...document.querySelectorAll(grouped)];
    expect(a.length).toBeGreaterThan(45);
    expect(b.map((e) => e.id || e.className || e.tagName)).toEqual(a.map((e) => e.id || e.className || e.tagName));
    expect(b.every((e, i) => e === a[i])).toBe(true);
    // each element answers matches() and closest() the same way with either query
    for (const el of document.body.querySelectorAll("*")) { expect(el.matches(grouped), el.outerHTML.slice(0, 60)).toBe(el.matches(plain)); expect(el.closest(grouped)).toBe(el.closest(plain)); }
  });
  it("is grouped where the browser knows :is(), and is the plain list where it does not", () => {
    const PV = loadVeil();
    const g = PV.groupedQuery(PV.SLOT_SELECTORS);
    if (g !== PV.SLOT_SELECTORS.join(",")) {
      expect(g).toContain("iframe:is(");
      expect(g).toContain("[class*='ad' i]:is(");
      expect(g).toContain("[id]:is(");
    }
    const real = document.querySelector;
    document.querySelector = function (q) { if (/:is\(/.test(q)) throw new Error("no :is()"); return real.call(this, q); };
    try { expect(PV.groupedQuery(["iframe[src*='a']", "iframe[src*='b']", "[class*='ad-x']", "[class*='ad-y']"])).toBe("iframe[src*='a'],iframe[src*='b'],[class*='ad-x'],[class*='ad-y']"); } finally { document.querySelector = real; }
  });
  it("splits a stack's list of selectors at its commas only", () => {
    const PV = loadVeil();
    const g = PV.groupedQuery(["[id^='a-'], .b, [data-x='1,2']", "vdo.unit, [id^='c']"]);
    document.body.innerHTML = `<div id="a-1"></div><p class="b"></p><i data-x="1,2"></i><vdo class="unit"></vdo><b id="cc"></b><u id="zz"></u>`;
    expect([...document.querySelectorAll(g)].map((e) => e.tagName.toLowerCase())).toEqual(["div", "p", "i", "vdo", "b"]);
  });
});
