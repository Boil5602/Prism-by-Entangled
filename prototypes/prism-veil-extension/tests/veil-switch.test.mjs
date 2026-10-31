/*
  The main switch (pv:ui.veilOff): off drops every display cover at once and
  keeps the sweep idle; on covers again at once. covers.js is loaded on top of
  the detection harness, with the two art hooks main.js provides stubbed.
*/
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadVeil } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;

function loadWithCovers() {
  const PV = loadVeil({ host: "example.com" });
  PV.pickArt = () => "chrome-extension://test/art/a.jpg";
  PV.artOnto = (el, url) => { el.style.backgroundImage = "url('" + url + "')"; };
  (0, eval)(readFileSync(join(here, "..", "src", "covers.js"), "utf8"));
  return PV;
}

describe("the main switch", () => {
  it("off drops every cover at once, keeps the sweep idle, and on covers again", () => {
    const PV = loadWithCovers();
    document.body.innerHTML = `<ins class="adsbygoogle" id="s1" ${R(0, 0, 300, 250)}></ins>`;
    PV.sweep();
    expect(PV.veils.size).toBe(1);
    expect(PV.veilOff()).toBe(false);

    PV.setVeilOff(true);
    expect(PV.veilOff()).toBe(true);
    expect(PV.veils.size).toBe(0);
    expect(document.querySelectorAll("[data-prism-veil]").length).toBe(0);
    PV.sweep();
    expect(PV.veils.size).toBe(0);

    PV.setVeilOff(false);
    expect(PV.veils.size).toBe(1);
  });

  it("tells the page UI each time it flips, not when set to what it already is", () => {
    const PV = loadWithCovers();
    const seen = [];
    PV.onVeilToggle = (off) => seen.push(off);
    PV.setVeilOff(false);
    PV.setVeilOff(true);
    PV.setVeilOff(true);
    PV.setVeilOff(false);
    expect(seen).toEqual([true, false]);
  });
});
