import { describe, it, expect } from "vitest";
import { loadVeil } from "./harness.mjs";

// The ring around an opening in a cover (a video ad's Skip, a display ad's close button), and the Button glow choice
// (pv:ui.ringGlow, 2026-11-20): Normal as before, Strong a thicker line set further out with a wider glow.
describe("the ring around an opening", () => {
  const box = { x: 100, y: 50, w: 120, h: 40, r: 6 };
  const ring = (cover) => cover.querySelector("[data-prism-veil]");

  it("is drawn as before by default: 2 px line, 3 px out", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    PV.uiPrefs = {};
    const cover = document.createElement("div"); document.body.appendChild(cover);
    PV.ringHoles(cover, [box]);
    const el = ring(cover);
    expect(el.style.borderWidth).toBe("2px");
    expect([el.style.left, el.style.top, el.style.width, el.style.height]).toEqual(["97px", "47px", "126px", "46px"]);
  });

  it("is bigger and brighter when Strong is chosen", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    PV.uiPrefs = { ringGlow: "strong" };
    const cover = document.createElement("div"); document.body.appendChild(cover);
    PV.ringHoles(cover, [box]);
    const el = ring(cover);
    expect(el.style.borderWidth).toBe("4px");
    expect([el.style.left, el.style.top, el.style.width, el.style.height]).toEqual(["94px", "44px", "132px", "52px"]);
    expect(el.style.boxShadow).toContain("26px");
  });

  it("follows a change of the choice while it is up, both ways", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    PV.uiPrefs = {};
    const cover = document.createElement("div"); document.body.appendChild(cover);
    PV.ringHoles(cover, [box]);
    PV.uiPrefs = { ringGlow: "strong" }; PV.restyleRings();
    expect(ring(cover).style.borderWidth).toBe("4px");
    expect(ring(cover).style.left).toBe("94px");
    PV.uiPrefs = {}; PV.restyleRings();
    expect(ring(cover).style.borderWidth).toBe("2px");
    expect(ring(cover).style.left).toBe("97px");
  });

  it("reads an unknown value as Normal, and goes with its opening", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    PV.uiPrefs = { ringGlow: "blinding" };
    const cover = document.createElement("div"); document.body.appendChild(cover);
    PV.ringHoles(cover, [box]);
    expect(ring(cover).style.borderWidth).toBe("2px");
    PV.ringHoles(cover, []);
    expect(ring(cover)).toBeNull();
  });
});
