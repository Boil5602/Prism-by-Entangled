import { describe, expect, it } from "vitest";
import {
  clampHeroSize,
  insetRects,
  layoutDashboard,
  parseArea,
  tileToSolverTile,
  DEFAULT_ASPECT_HINT,
  DEFAULT_ASPECT_WEIGHT,
} from "../src/layout.js";
import { solveHero } from "../src/solver.js";
import type { DashboardDocument } from "../src/types.js";

const gridDoc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "kitchen-main",
  name: "Kitchen",
  grid: { cols: 3, rows: 2, gap: 8 },
  tiles: [
    { id: "yt", area: "1 / 1 / 3 / 3", url: "https://www.youtube.com" },
    { id: "calendar", area: "1 / 3 / 2 / 4" },
    { id: "radio", area: "2 / 3 / 3 / 4" },
  ],
};

const heroDoc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "hero-dash",
  name: "Hero",
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "yt", aspectHint: "16:9", aspectWeight: 1.0 },
    { id: "calendar", aspectHint: "3:4", aspectWeight: 0.6 },
    { id: "radio", aspectHint: "4:3", aspectWeight: 0.2 },
  ],
};

describe("parseArea", () => {
  it("parses the spec's CSS grid-area syntax", () => {
    expect(parseArea("1 / 1 / 3 / 3")).toEqual({ rowStart: 1, colStart: 1, rowEnd: 3, colEnd: 3 });
    expect(parseArea("2/3/3/4")).toEqual({ rowStart: 2, colStart: 3, rowEnd: 3, colEnd: 4 });
  });

  it("rejects malformed or inverted areas", () => {
    expect(parseArea("1 / 1 / 1 / 3")).toBeNull(); // zero row span
    expect(parseArea("3 / 1 / 1 / 3")).toBeNull(); // inverted
    expect(parseArea("0 / 1 / 2 / 3")).toBeNull(); // 1-indexed
    expect(parseArea("a / b / c / d")).toBeNull();
    expect(parseArea("1 / 1 / 3")).toBeNull();
  });
});

describe("layoutDashboard — grid mode", () => {
  it("maps the kitchen example (§ Example 1) onto a 3×2 lattice", () => {
    const rects = layoutDashboard(gridDoc, { w: 1200, h: 800 });
    // cell = 400×400
    expect(rects["yt"]).toEqual({ x: 0, y: 0, w: 800, h: 800 });
    expect(rects["calendar"]).toEqual({ x: 800, y: 0, w: 400, h: 400 });
    expect(rects["radio"]).toEqual({ x: 800, y: 400, w: 400, h: 400 });
  });

  it("skips tiles without a valid area", () => {
    const doc: DashboardDocument = {
      ...gridDoc,
      tiles: [...gridDoc.tiles, { id: "floating" }],
    };
    const rects = layoutDashboard(doc, { w: 1200, h: 800 });
    expect(rects["floating"]).toBeUndefined();
  });
});

describe("layoutDashboard — hero mode", () => {
  it("delegates to solveHero with parsed hints", () => {
    const rects = layoutDashboard(heroDoc, { w: 1000, h: 625 });
    const expected = solveHero(
      [
        { id: "yt", hint: 16 / 9, weight: 1.0 },
        { id: "calendar", hint: 3 / 4, weight: 0.6 },
        { id: "radio", hint: 4 / 3, weight: 0.2 },
      ],
      "yt",
      0.62,
      1000,
      625,
    );
    expect(rects).toEqual(expected);
  });

  it("applies hero/heroSize overrides without touching the document", () => {
    const rects = layoutDashboard(heroDoc, { w: 1000, h: 625 }, { hero: "calendar", heroSize: 0.5 });
    const expected = solveHero(
      [
        { id: "yt", hint: 16 / 9, weight: 1.0 },
        { id: "calendar", hint: 3 / 4, weight: 0.6 },
        { id: "radio", hint: 4 / 3, weight: 0.2 },
      ],
      "calendar",
      0.5,
      1000,
      625,
    );
    expect(rects).toEqual(expected);
    expect(heroDoc.layout).toMatchObject({ hero: "yt", heroSize: 0.62 });
  });

  it("honors explicit satellite ordering", () => {
    const doc: DashboardDocument = {
      ...heroDoc,
      layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: ["radio", "calendar"], gap: 8 },
    };
    const rects = layoutDashboard(doc, { w: 1000, h: 625 });
    const expected = solveHero(
      [
        { id: "yt", hint: 16 / 9, weight: 1.0 },
        { id: "radio", hint: 4 / 3, weight: 0.2 },
        { id: "calendar", hint: 3 / 4, weight: 0.6 },
      ],
      "yt",
      0.62,
      1000,
      625,
    );
    expect(rects).toEqual(expected);
  });
});

describe("tileToSolverTile", () => {
  it("uses prototype defaults for missing hints", () => {
    expect(tileToSolverTile({ id: "x" })).toEqual({
      id: "x",
      hint: DEFAULT_ASPECT_HINT,
      weight: DEFAULT_ASPECT_WEIGHT,
    });
  });

  it("falls back to defaults on malformed hints", () => {
    expect(tileToSolverTile({ id: "x", aspectHint: "wat" }).hint).toBe(DEFAULT_ASPECT_HINT);
  });
});

describe("clampHeroSize", () => {
  it("clamps to the spec's 0.3–0.85 band", () => {
    expect(clampHeroSize(0.1)).toBe(0.3);
    expect(clampHeroSize(0.99)).toBe(0.85);
    expect(clampHeroSize(0.62)).toBe(0.62);
    expect(clampHeroSize(NaN)).toBe(0.62);
  });
});

describe("insetRects", () => {
  it("insets every rect by gap/2 on all sides", () => {
    const out = insetRects({ a: { x: 0, y: 0, w: 100, h: 50 } }, 8);
    expect(out["a"]).toEqual({ x: 4, y: 4, w: 92, h: 42 });
  });

  it("never inverts tiny rects", () => {
    const out = insetRects({ a: { x: 10, y: 10, w: 4, h: 4 } }, 8);
    expect(out["a"]!.w).toBeGreaterThan(0);
    expect(out["a"]!.h).toBeGreaterThan(0);
  });
});
