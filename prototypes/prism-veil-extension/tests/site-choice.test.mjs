/*
  A setting for all sites that one site may answer for itself (pv:ui.siteChoice, src/report.js): the setting for all sites
  comes first, and a site's own answer wins on that site. report.js is loaded on top of the detection harness.
*/
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadVeil, setHost, detect } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function load(host) {
  const PV = loadVeil({ host });
  (0, eval)(readFileSync(join(here, "..", "src", "report.js"), "utf8"));
  PV.uiPrefsLoaded = false;   // nothing is written to a store in the test
  return PV;
}

describe("a site's own answer to a setting for all sites", () => {
  it("follows the setting for all sites where the site has no answer", () => {
    const PV = load("www.facebook.com");
    PV.uiPrefs = { aiVeil: true, suggestedVeil: false };
    expect(PV.siteChoice("aiVeil")).toBe(null);
    expect(PV.prefHere("aiVeil")).toBe(true);
    expect(PV.prefHere("suggestedVeil")).toBe(false);
  });

  it("wins on its own site, both ways, and not on another site", () => {
    const PV = load("www.facebook.com");
    PV.uiPrefs = { aiVeil: true, suggestedVeil: false, siteChoice: { "www.facebook.com": { aiVeil: false, suggestedVeil: true } } };
    expect(PV.prefHere("aiVeil")).toBe(false);
    expect(PV.prefHere("suggestedVeil")).toBe(true);
    setHost("www.linkedin.com");
    expect(PV.prefHere("aiVeil")).toBe(true);
    expect(PV.prefHere("suggestedVeil")).toBe(false);
  });

  it("is set, changed and taken away for this site alone, and other sites' answers are kept", () => {
    const PV = load("www.facebook.com");
    PV.uiPrefs = { aiVeil: true, siteChoice: { "www.youtube.com": { aiVeil: false } } };
    PV.setSiteChoice("aiVeil", false);
    expect(PV.uiPrefs.siteChoice).toEqual({ "www.youtube.com": { aiVeil: false }, "www.facebook.com": { aiVeil: false } });
    expect(PV.prefHere("aiVeil")).toBe(false);
    PV.setSiteChoice("aiVeil", null);
    expect(PV.uiPrefs.siteChoice).toEqual({ "www.youtube.com": { aiVeil: false } });
    expect(PV.prefHere("aiVeil")).toBe(true);
  });

  it("covers a shop's promoted products until the person shows them, for all sites or for the one shop; a news site's label is not this setting's", () => {
    const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;
    const grid = `<div ${R(0, 0, 1200, 900)}><div id="p1" class="item" ${R(0, 0, 280, 420)}><a href="/ip/1" ${R(0, 0, 280, 380)}><img ${R(0, 0, 280, 280)}><span ${R(0, 290, 70, 16)}>Sponsored</span><span ${R(0, 310, 280, 40)}>A kettle</span></a></div>` +
      `<div id="p2" class="item" ${R(300, 0, 280, 420)}><a href="/ip/2" ${R(300, 0, 280, 380)}><img ${R(300, 0, 280, 280)}><span ${R(300, 310, 280, 40)}>A toaster</span></a></div></div>`;
    const PV = load("www.walmart.com");
    PV.uiPrefs = {};
    expect(PV.prefAll("promotedVeil")).toBe(true);
    expect(detect(PV, grid).map((o) => o.id)).toEqual(["p1"]);
    PV.uiPrefs = { promotedVeil: false };
    expect(detect(PV, grid)).toEqual([]);
    PV.uiPrefs = { promotedVeil: false, siteChoice: { "www.walmart.com": { promotedVeil: true } } };
    expect(detect(PV, grid).map((o) => o.id)).toEqual(["p1"]);
    PV.uiPrefs = { siteChoice: { "www.walmart.com": { promotedVeil: false } } };
    expect(detect(PV, grid)).toEqual([]);
    setHost("www.cbsnews.com");
    PV.uiPrefs = { promotedVeil: false };
    expect(detect(PV, grid).map((o) => o.id)).toEqual(["p1"]);
  });

  it("leaves a feed's promoted post in view once the person shows promoted items (LinkedIn), and covers it until then", () => {
    const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;
    const post = (id, y, h, inner) => `<div ${R(0, y, 552, h)}><div id="${id}" role="listitem" ${R(0, y, 552, h)}><div ${R(0, y, 552, h)}>${inner}</div></div></div>`;
    const feed = `<div role="list" ${R(0, 0, 552, 5896)}>` +
      post("p1", 0, 700, `<div ${R(0, 0, 552, 60)}><span ${R(60, 10, 80, 20)}>Someone</span></div><div ${R(0, 60, 552, 640)}><img></div>`) +
      post("promo", 720, 600, `<div ${R(0, 720, 552, 60)}><span ${R(60, 730, 40, 20)}>A firm</span><span ${R(190, 754, 60, 16)}>Promoted</span></div><div ${R(0, 780, 550, 540)}><img ${R(0, 780, 550, 540)}></div>`) +
      `</div>`;
    const PV = load("www.linkedin.com");
    PV.uiPrefs = {};
    expect(detect(PV, feed).map((o) => o.id)).toEqual(["promo"]);
    PV.uiPrefs = { siteChoice: { "www.linkedin.com": { promotedVeil: false } } };
    expect(detect(PV, feed)).toEqual([]);
  });

  it("reads the one word Sponsored on Amazon, and the setting decides (amazon.co.uk search, 2026-11-27: a.puis-sponsored-label in the product's title row)", () => {
    const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;
    const card = (id, y, label) => `<div id="${id}" class="s-result-item" ${R(0, y, 803, 254)}><div class="puisg-col-inner" ${R(0, y, 803, 254)}><div ${R(0, y, 791, 69)}>` +
      (label ? `<a class="puis-label-popover" ${R(0, y, 67, 12)}><span class="puis-label-popover-default" ${R(0, y, 53, 12)}><span ${R(0, y, 53, 12)}>${label}</span></span></a>` : "") +
      `<a href="/dp/B0${id}" ${R(0, y + 20, 791, 40)}>A kettle</a></div><img ${R(0, y + 70, 200, 180)}></div></div>`;
    const list = `<div class="s-main-slot" ${R(0, 0, 1070, 7465)}>` + card("k1", 0, "Sponsored") + card("k2", 270, "") + card("k3", 540, "Promoted") + `</div>`;
    const PV = load("www.amazon.co.uk");
    PV.uiPrefs = {};
    expect(detect(PV, list).map((o) => [o.id, o.why])).toEqual([["k1", "badge-label: Sponsored"]]);
    PV.uiPrefs = { promotedVeil: false };
    expect(detect(PV, list)).toEqual([]);
    PV.uiPrefs = { promotedVeil: false, siteChoice: { "www.amazon.co.uk": { promotedVeil: true } } };
    expect(detect(PV, list).map((o) => o.id)).toEqual(["k1"]);
  });

  it("holds only for the settings a site may answer", () => {
    const PV = load("www.facebook.com");
    PV.uiPrefs = { veilOff: false, siteChoice: { "www.facebook.com": { veilOff: true } } };
    expect(PV.siteChoice("veilOff")).toBe(null);
    PV.setSiteChoice("veilOff", true);
    expect(PV.uiPrefs.siteChoice).toEqual({ "www.facebook.com": { veilOff: true } });
  });

  it("reaches the rules: a suggested post on Facebook is covered or left by the site's answer, against the setting for all sites", () => {
    const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;
    const post = `<div aria-posinset="1" id="s" ${R(0, 0, 680, 740)}><div data-virtualized="false"><div ${R(0, 0, 680, 60)}><h3 ${R(0, 0, 200, 20)}><strong>Some League</strong></h3>` +
      `<span ${R(210, 2, 50, 18)}>Follow</span><div ${R(0, 30, 200, 20)}><span>13h</span></div></div><div data-ad-rendering-role="story_message" ${R(0, 60, 680, 600)}></div></div></div>`;
    const PV = load("www.facebook.com");
    PV.uiPrefs = { suggestedVeil: false };
    expect(detect(PV, post)).toEqual([]);
    PV.uiPrefs = { suggestedVeil: false, siteChoice: { "www.facebook.com": { suggestedVeil: true } } };
    expect(detect(PV, post).map((o) => o.id)).toEqual(["s"]);
    PV.uiPrefs = { suggestedVeil: true, siteChoice: { "www.facebook.com": { suggestedVeil: false } } };
    expect(detect(PV, post)).toEqual([]);
    PV.uiPrefs = { suggestedVeil: true, siteChoice: { "www.linkedin.com": { suggestedVeil: false } } };
    expect(detect(PV, post).map((o) => o.id)).toEqual(["s"]);
  });
});

// B-615, a trial: the tag Safari draws its app banner from is taken out of the page while the setting is on, and put back when it goes off
describe("app banners", () => {
  const TAG = `<meta name="apple-itunes-app" content="app-id=123456789">`;
  const has = () => !!document.querySelector("meta[name='apple-itunes-app']");
  it("leaves the tag alone unless the person switched app banners off, for all sites or for this site", () => {
    const PV = load("www.newegg.com");
    document.head.innerHTML = TAG;
    PV.applyAppBanner({});
    expect(has()).toBe(true);
    expect(PV.appBannerSeen()).toBe(true);
    PV.applyAppBanner({ appBannerHide: true, siteChoice: { "www.newegg.com": { appBannerHide: false } } });
    expect(has()).toBe(true);
    PV.applyAppBanner({ appBannerHide: false, siteChoice: { "www.newegg.com": { appBannerHide: true } } });
    expect(has()).toBe(false);
    PV.applyAppBanner({});   // back on: the tag is put back
    expect(has()).toBe(true);
    PV.applyAppBanner({ appBannerHide: true });
    expect(has()).toBe(false);
    PV.applyAppBanner({}); document.head.innerHTML = "";
  });
  it("is not done while PRISM is off for the site", () => {
    const PV = load("www.newegg.com");
    document.head.innerHTML = TAG;
    PV.applyAppBanner({ appBannerHide: true, veilOffSites: { "www.newegg.com": true } });
    expect(has()).toBe(true);
    PV.applyAppBanner({ appBannerHide: true, veilOff: true });
    expect(has()).toBe(true);
    document.head.innerHTML = "";
  });
});
