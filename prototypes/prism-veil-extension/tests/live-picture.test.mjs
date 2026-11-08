// The live TV picture for the break watch (src/live-picture.js, opt-in pv:ui.livePicture, 2026-11-06): the frame is the one Prism for
// Windows scores (SurfaceManager.CaptureForWatchAsync / VideoArea): the middle 16:9 of the video's area, grey = (B*29 + G*150 + R*77) >> 8.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(here, "..", "src", "live-picture.js"), "utf8");

function load() {
  const root = {};
  new Function("globalThis", "chrome", CODE)(root, undefined);   // no chrome: the pure helpers only
  return root.PrismBreak.picture;
}

describe("YouTube TV picture frame", () => {
  it("keeps the middle 16:9 of a wider area, as the host's VideoArea", () => {
    const p = load();
    // 2550x1340 (the TBS window of 2026-10-07): 16:9 at its height is 2382.2 wide, 83.9 cut from each side
    const a = p.videoArea(2550, 1340);
    expect(a.y).toBe(0); expect(a.h).toBe(1340);
    expect(a.w).toBeCloseTo(1340 * 16 / 9, 6); expect(a.x).toBeCloseTo((2550 - 1340 * 16 / 9) / 2, 6);
  });
  it("keeps the middle rows of a taller area, and the whole of one within 1% of 16:9", () => {
    const p = load();
    const t = p.videoArea(1280, 960);
    expect(t.x).toBe(0); expect(t.w).toBe(1280); expect(t.h).toBeCloseTo(720, 6); expect(t.y).toBeCloseTo(120, 6);
    expect(p.videoArea(1282, 720)).toEqual({ x: 0, y: 0, w: 1282, h: 720 });
  });
  it("greys with the host's BGRA weights", () => {
    const p = load();
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 12, 200, 99, 255]);
    const g = p.grey(rgba);
    expect(Array.from(g)).toEqual([(255 * 77) >> 8, (255 * 150) >> 8, (255 * 29) >> 8, (255 * 256) >> 8, (99 * 29 + 200 * 150 + 12 * 77) >> 8]);
    expect(p.W * p.H).toBe(57600);
  });
  it("reads only the sites on the list of live TV sites, tv.youtube.com to start with", () => {
    const p = load();
    expect(p.sitesOf({})).toEqual(["tv.youtube.com"]);
    expect(p.onList("tv.youtube.com", p.sitesOf(undefined))).toBe(true);
    expect(p.onList("www.youtube.com", p.sitesOf({}))).toBe(false);
    expect(p.onList("watch.sling.com", ["sling.com"])).toBe(true);
    expect(p.onList("notsling.com", ["sling.com"])).toBe(false);
    expect(p.onList("tv.youtube.com", p.sitesOf({ liveTvSites: [] }))).toBe(false);
  });
  it("carries a frame between Veil's pages as base64, byte for byte", () => {
    const p = load();
    const u = new Uint8Array(57600); for (let i = 0; i < u.length; i++) u[i] = (i * 37) & 255;
    expect(Array.from(p.fromB64(p.toB64(u)))).toEqual(Array.from(u));
  });
  it("finds the tab's viewport in a letterboxed stream frame", () => {
    const p = load();
    expect(p.viewportInFrame(1280, 720, 1920, 1080)).toEqual({ s: 2 / 3, ox: 0, oy: 0 });
    const m = p.viewportInFrame(1280, 720, 1600, 1200);   // a 4:3 window into a 16:9 frame: bars left and right
    expect(m.s).toBeCloseTo(0.6, 9); expect(m.oy).toBeCloseTo(0, 9); expect(m.ox).toBeCloseTo((1280 - 960) / 2, 9);
  });
});
