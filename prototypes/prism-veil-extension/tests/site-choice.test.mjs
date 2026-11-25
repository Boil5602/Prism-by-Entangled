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
